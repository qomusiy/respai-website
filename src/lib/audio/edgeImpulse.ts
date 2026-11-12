/**
 * Adapter for the team's real Edge Impulse model (labels "cough" / "noise",
 * MFE features, 1 s windows at 16 kHz).
 *
 * Deployment: Edge Impulse Studio → Deployment → "WebAssembly (browser)" gives
 * `edge-impulse-standalone.js` + `edge-impulse-standalone.wasm`; both go into
 * `public/model/`. `EdgeImpulseModel.isAvailable()` detects them (guarding
 * against Vite/Express SPA fallbacks that answer 200 + index.html for any
 * path), `load()` boots the emscripten module and validates it.
 *
 * `EdgeImpulseStream` turns the window classifier into the same streaming
 * interface as the acoustic detector: the acoustic front-end still produces
 * the visual frames and segments events (so durationMs / peakDb / centroid /
 * attack are measured on the signal), while the decision whether an event is a
 * cough comes from the model, run on a sliding 1 s window every 250 ms.
 */

import { AcousticCoughDetector, HOP } from './detector'
import type { CoughEvent, DetectorFrame } from './detector'
import { Resampler, SAMPLE_RATE } from './dsp'

/* eslint-disable @typescript-eslint/no-explicit-any */
type EmModule = any

const JS_FILE = 'edge-impulse-standalone.js'
const WASM_FILE = 'edge-impulse-standalone.wasm'
const SENSOR_CAMERA = 3

export interface ClassifierResult {
  label: string
  value: number
}

function modelDir(): string {
  let base = '/'
  try {
    base = import.meta.env?.BASE_URL ?? '/'
  } catch {
    // not running under Vite
  }
  return (base.endsWith('/') ? base : base + '/') + 'model/'
}

/**
 * Does `url` really serve the asset? A dev server or an SPA fallback happily
 * returns 200 + index.html for missing files, so check the content type and,
 * when it is ambiguous, sniff the first bytes.
 */
async function probe(url: string, kind: 'js' | 'wasm'): Promise<boolean> {
  let res: Response
  try {
    res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (res.status === 405 || res.status === 501) res = await fetch(url, { cache: 'no-store' })
  } catch {
    return false
  }
  if (!res.ok) return false
  const type = (res.headers.get('content-type') ?? '').toLowerCase()
  if (type.includes('html')) return false
  if (kind === 'js' && /javascript|ecmascript/.test(type)) return true
  if (kind === 'wasm' && type.includes('wasm')) return true
  // Ambiguous (octet-stream, text/plain, missing): look at the bytes.
  try {
    const body = await (await fetch(url, { cache: 'no-store' })).arrayBuffer()
    const head = new Uint8Array(body, 0, Math.min(64, body.byteLength))
    if (kind === 'wasm') return head.length >= 4 && head[0] === 0x00 && head[1] === 0x61 && head[2] === 0x73 && head[3] === 0x6d
    const text = new TextDecoder().decode(head).trimStart()
    return text.length > 0 && !text.startsWith('<')
  } catch {
    return false
  }
}

function heapU8(M: EmModule): Uint8Array {
  if (M.HEAPU8 instanceof Uint8Array) return M.HEAPU8
  const buf: ArrayBuffer | undefined = M.HEAPF32?.buffer ?? M.wasmMemory?.buffer ?? M.asm?.memory?.buffer ?? M.wasmExports?.memory?.buffer
  if (!buf) throw new Error('cannot access the WebAssembly heap (HEAPU8 not exported)')
  return new Uint8Array(buf)
}

function isReady(M: EmModule): boolean {
  return !!M && typeof M === 'object' && typeof M.run_classifier === 'function' && typeof M._malloc === 'function'
}

/** A loaded, validated Edge Impulse WebAssembly classifier. */
export class EdgeImpulseModel {
  /** Model input rate, Hz */
  readonly frequency: number
  /** Raw samples per classification window */
  readonly windowSamples: number
  readonly labels: string[]
  readonly projectName: string
  /** Wall time of one classification on this machine, ms */
  readonly latencyMs: number
  private readonly M: EmModule
  private readonly coughLabel: string

  private constructor(M: EmModule, frequency: number, windowSamples: number, labels: string[], projectName: string, latencyMs: number) {
    this.M = M
    this.frequency = frequency
    this.windowSamples = windowSamples
    this.labels = labels
    this.projectName = projectName
    this.latencyMs = latencyMs
    this.coughLabel = labels.find((l) => /cough/i.test(l)) ?? 'cough'
  }

  /** Are both deployment files present in `public/model/`? */
  static async isAvailable(): Promise<boolean> {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return false
    const dir = modelDir()
    // Sequential: when the model is absent this costs a single (404 / HTML) request.
    if (!(await probe(dir + JS_FILE, 'js'))) return false
    if (await probe(dir + WASM_FILE, 'wasm')) return true
    console.warn(`[RespAI] Found ${dir}${JS_FILE} but not ${WASM_FILE} next to it; using the acoustic preview engine.`)
    return false
  }

  /** Inject the emscripten script, wait for the runtime, init and validate the model. */
  static async load(timeoutMs = 20000): Promise<EdgeImpulseModel> {
    if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('not in a browser')
    const M = await bootModule(modelDir(), timeoutMs)
    if (typeof M.init === 'function') M.init()

    const props: Record<string, unknown> = typeof M.get_properties === 'function' ? (M.get_properties() ?? {}) : {}
    if (props.sensor === SENSOR_CAMERA || props.sensor === 'camera') throw new Error('the deployed model is an image model, not audio')
    const frequency = Number(props.frequency) || SAMPLE_RATE
    const windowSamples = Number(props.input_features_count) || Number(props.frame_sample_count) || frequency
    if (frequency < 4000 || frequency > 48000) throw new Error(`unsupported model frequency ${frequency} Hz`)
    if (windowSamples < frequency * 0.1 || windowSamples > frequency * 10) throw new Error(`unexpected window of ${windowSamples} samples`)

    let projectName = ''
    try {
      const p = typeof M.get_project === 'function' ? M.get_project() : null
      if (p && typeof p.name === 'string') projectName = p.deploy_version ? `${p.name} v${p.deploy_version}` : p.name
    } catch {
      // optional
    }

    // Warm-up run: validates the classifier and tells us the labels.
    const tmp = new EdgeImpulseModel(M, frequency, windowSamples, [], projectName, 0)
    const t0 = performance.now()
    const res = tmp.classify(new Float32Array(windowSamples))
    const latencyMs = performance.now() - t0
    const labels = res.map((r) => r.label)
    if (!labels.some((l) => /cough/i.test(l))) throw new Error(`model has no "cough" label (labels: ${labels.join(', ') || 'none'})`)
    const model = new EdgeImpulseModel(M, frequency, windowSamples, labels, projectName, latencyMs)
    console.info(
      `[RespAI] Edge Impulse model loaded${projectName ? ` (${projectName})` : ''}: ${frequency} Hz, ` +
        `${Math.round((windowSamples / frequency) * 1000)} ms window, labels [${labels.join(', ')}], ${latencyMs.toFixed(1)} ms/inference`,
    )
    return model
  }

  /**
   * Classify one window of raw features (int16-range floats, −32768..32767,
   * length = windowSamples).
   */
  classify(features: Float32Array): ClassifierResult[] {
    const M = this.M
    const n = features.length
    const bytes = n * 4
    const ptr: number = M._malloc(bytes)
    if (!ptr) throw new Error('malloc failed')
    try {
      // Re-read the heap after malloc: memory growth detaches old views.
      const heap = heapU8(M)
      new Uint8Array(heap.buffer, ptr, bytes).set(new Uint8Array(features.buffer, features.byteOffset, bytes))
      const ret = M.run_classifier(ptr, n, false)
      try {
        if (ret.result !== 0) throw new Error(`run_classifier failed (error ${ret.result})`)
        const out: ClassifierResult[] = []
        if (typeof ret.size === 'function') {
          const size: number = ret.size()
          for (let i = 0; i < size; i++) {
            const c = ret.get(i)
            out.push({ label: String(c.label), value: Number(c.value) })
            if (typeof c.delete === 'function') c.delete()
          }
        } else if (Array.isArray(ret.results)) {
          for (const c of ret.results) out.push({ label: String(c.label), value: Number(c.value) })
        }
        return out
      } finally {
        if (ret && typeof ret.delete === 'function') ret.delete()
      }
    } finally {
      M._free(ptr)
    }
  }

  /** Cough probability of one window of features. */
  coughProb(features: Float32Array): number {
    const res = this.classify(features)
    const hit = res.find((r) => r.label === this.coughLabel) ?? res.find((r) => /cough/i.test(r.label))
    return hit ? Math.min(1, Math.max(0, hit.value)) : 0
  }
}

/** Load the (non-modularised or factory-style) emscripten module. */
function bootModule(dir: string, timeoutMs: number): Promise<EmModule> {
  const w = window as unknown as Record<string, any>
  return new Promise((resolve, reject) => {
    let settled = false
    let poll = 0
    let timer = 0
    const finish = (M: EmModule) => {
      if (settled) return
      settled = true
      window.clearInterval(poll)
      window.clearTimeout(timer)
      if (!isReady(M)) reject(new Error('module initialised but run_classifier is missing'))
      else resolve(M)
    }
    const fail = (e: unknown) => {
      if (settled) return
      settled = true
      window.clearInterval(poll)
      window.clearTimeout(timer)
      reject(e instanceof Error ? e : new Error(String(e)))
    }
    const locateFile = (path: string) => dir + path

    // Already loaded (e.g. engine re-created after HMR)?
    if (isReady(w.Module)) {
      finish(w.Module)
      return
    }
    // Classic emscripten output does `var Module = typeof Module != 'undefined' ? Module : {}`,
    // so a pre-defined global receives our hooks.
    const cfg: Record<string, any> = w.Module && typeof w.Module === 'object' ? w.Module : {}
    const prevInit = cfg.onRuntimeInitialized
    cfg.onRuntimeInitialized = () => {
      if (typeof prevInit === 'function') prevInit()
      // Resolve on the next tick so a just-assigned global is in place.
      window.setTimeout(() => finish(isReady(w.Module) ? w.Module : cfg), 0)
    }
    if (!cfg.locateFile) cfg.locateFile = locateFile
    const prevAbort = cfg.onAbort
    cfg.onAbort = (what: unknown) => {
      if (typeof prevAbort === 'function') prevAbort(what)
      fail(new Error(`WebAssembly runtime aborted: ${String(what)}`)) // e.g. the .wasm failed to load
    }
    if (typeof w.Module !== 'function') w.Module = cfg

    const script = document.createElement('script')
    script.src = dir + JS_FILE
    script.async = true
    script.onerror = () => fail(new Error(`could not load ${script.src}`))
    script.onload = () => {
      const M = w.Module
      if (typeof M === 'function') {
        // MODULARIZE build: Module is a factory returning a promise of the instance.
        Promise.resolve(M({ locateFile, onAbort: cfg.onAbort }))
          .then((inst: EmModule) => finish(inst))
          .catch(fail)
      } else if (isReady(M) && (M.calledRun || M.runtimeInitialized)) {
        finish(M) // initialised synchronously during script evaluation
      }
    }
    document.head.appendChild(script)
    // Safety net for builds that never call onRuntimeInitialized on our object.
    poll = window.setInterval(() => {
      if (isReady(w.Module) && (w.Module.calledRun || w.Module.runtimeInitialized)) finish(w.Module)
    }, 100)
    timer = window.setTimeout(() => fail(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs)
  })
}

// ---------------------------------------------------------------------------
// Streaming wrapper
// ---------------------------------------------------------------------------

interface WindowResult {
  /** 16 kHz sample indices covered by the window */
  start: number
  end: number
  p: number
}

const HIST_HOPS = 512 // ~5 s of per-hop history for events the segmenter missed
const PROB_DECAY = Math.pow(0.5, 10 / 300) // per 10 ms hop: 300 ms half-life

export interface EdgeImpulseStreamOptions {
  /** Classification interval, ms (default 250) */
  intervalMs?: number
  /** Cough probability threshold (default 0.6) */
  threshold?: number
}

/**
 * Same streaming interface as `AcousticCoughDetector` (16 kHz in, `onFrame`
 * per 10 ms hop, `onEvent` per segmented event), with the model making the
 * call. Every acoustic event gets the highest cough probability among the
 * windows that contain its first 400 ms. Windows that are confidently "cough"
 * but contain no segmented event still produce a detection (features are then
 * estimated from the per-hop history).
 */
export class EdgeImpulseStream {
  onFrame: ((f: DetectorFrame) => void) | null = null
  onEvent: ((e: CoughEvent) => void) | null = null
  readonly threshold: number

  private readonly model: EdgeImpulseModel
  private readonly det = new AcousticCoughDetector()
  private readonly rs: Resampler | null
  private readonly ring: Float32Array
  private readonly feat: Float32Array
  private readonly hopModel: number
  private readonly winLen16: number
  private ringPos = 0
  private sinceLast = 0
  private modelTotal = 0
  private windows: WindowResult[] = []
  private pending: CoughEvent[] = []
  private decided: Array<{ start: number; end: number; peakDb: number }> = []
  /** Run of confident windows with no segmented event: their intersection and union. */
  private orphan: { iStart: number; iEnd: number; uStart: number; uEnd: number; p: number } | null = null
  private lastDetectionEnd = -Infinity
  private lastDetectionPeak = 0
  private displayProb = 0
  private broken = false
  // Per-hop history (ring, indexed by hop number)
  private readonly histDb = new Float32Array(HIST_HOPS)
  private readonly histCent = new Float32Array(HIST_HOPS)
  private readonly histFloor = new Float32Array(HIST_HOPS)
  private hops = 0

  constructor(model: EdgeImpulseModel, opts: EdgeImpulseStreamOptions = {}) {
    this.model = model
    this.threshold = opts.threshold ?? 0.6
    this.rs = model.frequency === SAMPLE_RATE ? null : new Resampler(SAMPLE_RATE, model.frequency)
    this.ring = new Float32Array(model.windowSamples)
    this.feat = new Float32Array(model.windowSamples)
    this.hopModel = Math.max(1, Math.round((model.frequency * (opts.intervalMs ?? 250)) / 1000))
    this.winLen16 = Math.round((model.windowSamples * SAMPLE_RATE) / model.frequency)
    this.det.onEvent = (e) => this.pending.push(e)
    this.det.onFrame = (f) => this.handleFrame(f)
  }

  get prob(): number {
    return this.displayProb
  }

  reset(): void {
    this.det.reset()
    this.rs?.reset()
    this.ring.fill(0)
    this.ringPos = 0
    this.sinceLast = 0
    this.modelTotal = 0
    this.windows = []
    this.pending = []
    this.decided = []
    this.orphan = null
    this.lastDetectionEnd = -Infinity
    this.lastDetectionPeak = 0
    this.displayProb = 0
    this.broken = false
    this.hops = 0
  }

  /** Feed 16 kHz mono samples. */
  push(x16: Float32Array): void {
    this.det.push(x16)
    const xm = this.rs ? this.rs.process(x16) : x16
    let i = 0
    while (i < xm.length) {
      const n = Math.min(xm.length - i, this.hopModel - this.sinceLast)
      for (let k = 0; k < n; k++) {
        this.ring[this.ringPos] = xm[i + k]
        this.ringPos = this.ringPos + 1 === this.ring.length ? 0 : this.ringPos + 1
      }
      i += n
      this.sinceLast += n
      this.modelTotal += n
      if (this.sinceLast >= this.hopModel) {
        this.sinceLast = 0
        this.classifyWindow()
      }
    }
    this.decide(false)
  }

  /** End of stream: close the running event, classify the tail, decide everything. */
  flush(): void {
    this.det.flush()
    if (this.sinceLast > 0) {
      this.sinceLast = 0
      this.classifyWindow()
    }
    this.decide(true)
    this.endOrphan()
  }

  private handleFrame(f: DetectorFrame): void {
    const h = this.hops++ % HIST_HOPS
    this.histDb[h] = f.hopDb
    this.histCent[h] = f.centroidHz
    this.histFloor[h] = f.floorDb
    this.displayProb *= PROB_DECAY
    if (this.broken && f.prob > this.displayProb) this.displayProb = f.prob
    if (this.onFrame) {
      const label: DetectorFrame['label'] = this.displayProb >= 0.5 ? 'cough' : f.label === 'silence' ? 'silence' : 'noise'
      this.onFrame({ ...f, prob: this.displayProb, label })
    }
  }

  private classifyWindow(): void {
    if (this.broken) return
    const end = Math.round((this.modelTotal * SAMPLE_RATE) / this.model.frequency)
    const win: WindowResult = { start: end - this.winLen16, end, p: 0 }
    // Oldest → newest, scaled to the int16 range Edge Impulse audio models expect.
    const n = this.ring.length
    for (let k = 0; k < n; k++) {
      const v = this.ring[(this.ringPos + k) % n] * 32768
      this.feat[k] = v > 32767 ? 32767 : v < -32768 ? -32768 : v
    }
    try {
      win.p = this.model.coughProb(this.feat)
    } catch (err) {
      this.broken = true
      console.warn('[RespAI] Edge Impulse classification failed; using acoustic scores for this stream.', err)
      return
    }
    this.windows.push(win)
    if (this.windows.length > 24) this.windows.shift()
    if (win.p > this.displayProb) this.displayProb = win.p

    // Confident window without any segmented event in it → candidate orphan.
    if (win.p >= this.threshold && !this.hasEventIn(win.start, win.end)) {
      const o = this.orphan
      if (o) {
        o.iStart = Math.max(o.iStart, win.start)
        o.iEnd = Math.min(o.iEnd, win.end)
        o.uEnd = win.end
        o.p = Math.max(o.p, win.p)
      } else {
        this.orphan = { iStart: win.start, iEnd: win.end, uStart: win.start, uEnd: win.end, p: win.p }
      }
    } else {
      this.endOrphan()
    }
  }

  private hasEventIn(start: number, end: number): boolean {
    const active = this.det.activeEventStart
    if (active >= 0 && active < end) return true
    for (const e of this.pending) if (e.startSample < end && e.endSample > start) return true
    for (const e of this.decided) if (e.start < end && e.end > start) return true
    return false
  }

  private decide(force: boolean): void {
    const latest = this.windows.length ? this.windows[this.windows.length - 1].end : 0
    while (this.pending.length) {
      const ev = this.pending[0]
      const need = Math.min(ev.endSample, ev.startSample + 0.4 * SAMPLE_RATE)
      // Wait until at least two windows past the event (or none can still contain its start).
      const ready = force || this.broken || latest >= Math.min(ev.startSample + this.winLen16, ev.endSample + 0.5 * SAMPLE_RATE)
      if (!ready) break
      this.pending.shift()
      let p = -1
      let best: WindowResult | null = null
      for (const w of this.windows) {
        if (w.start <= ev.startSample + 0.05 * SAMPLE_RATE && w.end >= need && w.p > p) {
          p = w.p
          best = w
        }
      }
      if (p < 0) {
        // No window fully covers it (stream start/end): use overlapping windows.
        for (const w of this.windows) if (w.start < ev.endSample && w.end > ev.startSample && w.p > p) p = w.p
      }
      let prob: number
      let accepted: boolean
      if (this.broken || p < 0) {
        prob = ev.prob
        accepted = ev.accepted
      } else {
        prob = p
        // Attribution guard: a window that contains a cough also "contains"
        // the speech right next to it. Credit the window to events that are
        // acoustically plausible, or to the loudest event in it.
        // Also never accept an event that ran into the 900 ms limit (steady
        // sound), nor a much weaker event right after a detection (that is the
        // previous cough's own tail, split off by the segmenter).
        const isTail = ev.startSample - this.lastDetectionEnd < 0.3 * SAMPLE_RATE && ev.peakDb < this.lastDetectionPeak - 10
        accepted =
          p >= this.threshold &&
          !ev.features.truncated &&
          !isTail &&
          (ev.prob >= 0.25 || (best !== null && this.isLoudestIn(ev, best)))
      }
      this.decided.push({ start: ev.startSample, end: ev.endSample, peakDb: ev.peakDb })
      if (this.decided.length > 32) this.decided.shift()
      if (accepted) {
        this.lastDetectionEnd = ev.endSample
        this.lastDetectionPeak = ev.peakDb
      }
      if (this.onEvent) this.onEvent({ ...ev, prob, accepted })
    }
  }

  private isLoudestIn(ev: CoughEvent, w: WindowResult): boolean {
    for (const e of this.decided) if (e.start < w.end && e.end > w.start && e.peakDb > ev.peakDb) return false
    for (const e of this.pending) if (e !== ev && e.startSample < w.end && e.endSample > w.start && e.peakDb > ev.peakDb) return false
    return true
  }

  /** Emit a detection for a run of confident windows that had no segmented event. */
  private endOrphan(): void {
    const o = this.orphan
    this.orphan = null
    if (!o || this.broken || o.uEnd <= this.lastDetectionEnd || this.hasEventIn(o.uStart, o.uEnd)) return
    // The cough is most likely where all confident windows overlap; if they do
    // not all overlap (long run), search their union.
    const [s0, s1] = o.iEnd - o.iStart >= HOP ? [o.iStart, o.iEnd] : [o.uStart, o.uEnd]
    const firstHop = Math.max(0, this.hops - HIST_HOPS, Math.floor(s0 / HOP))
    const lastHop = Math.min(this.hops - 1, Math.floor(s1 / HOP))
    if (lastHop <= firstHop) return
    let peakHop = firstHop
    for (let h = firstHop; h <= lastHop; h++) if (this.histDb[h % HIST_HOPS] > this.histDb[peakHop % HIST_HOPS]) peakHop = h
    const peakDb = this.histDb[peakHop % HIST_HOPS]
    const floor = this.histFloor[peakHop % HIST_HOPS]
    if (peakDb < floor + 6) return // nothing audible to point at
    const thr = Math.max(peakDb - 20, floor + 6)
    let a = peakHop
    while (a > firstHop && this.histDb[(a - 1) % HIST_HOPS] >= thr) a--
    let b = peakHop
    while (b < lastHop && this.histDb[(b + 1) % HIST_HOPS] >= thr) b++
    const hopMs = (HOP / SAMPLE_RATE) * 1000
    const startSample = a * HOP
    const endSample = (b + 1) * HOP
    this.lastDetectionEnd = endSample
    this.lastDetectionPeak = peakDb
    if (!this.onEvent) return
    this.onEvent({
      startSample,
      endSample,
      peakSample: peakHop * HOP + HOP / 2,
      durationMs: (b - a + 1) * hopMs,
      attackMs: (peakHop - a) * hopMs,
      peakDb,
      centroidHz: this.histCent[peakHop % HIST_HOPS],
      prob: o.p,
      accepted: true,
      features: {
        durationMs: (b - a + 1) * hopMs,
        attackMs: (peakHop - a) * hopMs,
        riseMs: (peakHop - a) * hopMs,
        sustainRiseDb: 0,
        topMs: 0,
        tCentroid: 0,
        flatEarly: 0,
        hfEarly: 0,
        harmEarly: 0,
        harmPeak: 0,
        zcrEarly: 0,
        harmFrac: 0,
        centroidHz: this.histCent[peakHop % HIST_HOPS],
        peakDb,
        snrDb: peakDb - floor,
        sustainDb: 0,
        decayDb: 0,
        nowDb: 0,
        truncated: false,
        melEarly: [],
        melAll: [],
      },
    })
  }
}
