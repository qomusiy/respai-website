/**
 * RespEngine — the audio/AI engine behind the RespAI website.
 *
 *   const engine = await getEngine()
 *   const off = engine.on('frame', (f) => draw(f))
 *   engine.on('cough', (d) => log(d))
 *   button.onclick = () => engine.startMic()      // must be a user gesture
 *
 * Picks the team's Edge Impulse model when `public/model/` contains the
 * WebAssembly export, otherwise the acoustic preview engine. Audio from the
 * microphone, from synthesized demo samples (played through the speakers *and*
 * analysed live) or from files all goes through the same 16 kHz pipeline.
 *
 * Safe to import during SSR / in node: nothing touches `window` until a method
 * is called.
 */

import type {
  AnalysisFrame,
  AudioSource,
  CoughDetection,
  EngineEvents,
  EngineInfo,
  EngineState,
  FileAnalysis,
  SampleKind,
} from './types'
import { NUM_MEL_BANDS } from './types'
import { AcousticCoughDetector } from './detector'
import type { CoughEvent, DetectorFrame } from './detector'
import { EdgeImpulseModel, EdgeImpulseStream } from './edgeImpulse'
import { Resampler, SAMPLE_RATE, resample } from './dsp'
import { synthesize, toAudioBuffer } from './synth'

/** Common shape of the acoustic detector and the Edge Impulse stream. */
interface StreamAnalyzer {
  onFrame: ((f: DetectorFrame) => void) | null
  onEvent: ((e: CoughEvent) => void) | null
  push(x: Float32Array): void
  flush(): void
}

const CAPTURE_BATCH = 2048
const WORKLET_NAME = 'respai-capture'
const HOP_MS = 10
const WAVE_LEN = 1024
const WAVE_RING = 16384
const TAIL_MS = 1000
const PROB_HALF_LIFE_MS = 300

/**
 * Capture processor, loaded from a Blob URL so no extra file has to be served.
 * The node is created with channelCount 1 / 'explicit' / 'speakers', so the
 * browser already mixes the input down to mono. Samples are batched
 * (~43 ms at 48 kHz) and the buffers transferred, not copied.
 */
const WORKLET_SOURCE = `
class RespCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.size = o.batch || ${CAPTURE_BATCH};
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        if (this.n > 0) {
          const out = this.buf.slice(0, this.n);
          this.port.postMessage(out, [out.buffer]);
          this.n = 0;
        }
        this.port.postMessage('flushed');
      } else if (e.data === 'stop') {
        this.alive = false;
      }
    };
  }
  process(inputs) {
    if (!this.alive) return false;
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let i = 0;
      while (i < ch.length) {
        const take = Math.min(ch.length - i, this.size - this.n);
        this.buf.set(ch.subarray(i, i + take), this.n);
        this.n += take;
        i += take;
        if (this.n === this.size) {
          const full = this.buf;
          this.port.postMessage(full, [full.buffer]);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', RespCapture);
`

interface Capture {
  /** Deliver the partially filled batch (resolves when it has been posted). */
  flush(): Promise<void>
  stop(): void
}

/** Capture-rate audio → 16 kHz → analyzer. */
class Pipeline {
  readonly source: AudioSource
  readonly analyzer: StreamAnalyzer
  private readonly rs: Resampler

  constructor(source: AudioSource, analyzer: StreamAnalyzer, inRate: number) {
    this.source = source
    this.analyzer = analyzer
    this.rs = new Resampler(inRate, SAMPLE_RATE)
  }

  push(x: Float32Array): void {
    const y = this.rs.process(x)
    if (y.length) this.analyzer.push(y)
  }

  /** End of stream: a little silence so a trailing event can close, then flush. */
  finish(): void {
    this.analyzer.push(new Float32Array(Math.round(SAMPLE_RATE * 0.2)))
    this.analyzer.flush()
  }
}

interface HopRecord {
  mel: Float32Array
  db: number
  prob: number
  label: AnalysisFrame['label']
}

type ListenerMap = { [K in keyof EngineEvents]: Set<EngineEvents[K]> }

interface MicSession {
  stream: MediaStream
  src: MediaStreamAudioSourceNode
  cap: Capture
  pipe: Pipeline
}

interface SampleSession {
  src: AudioBufferSourceNode
  pipe: Pipeline
  token: number
}

function describeMicError(e: unknown): string {
  const name = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission was denied'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found'
  if (name === 'NotReadableError' || name === 'AbortError') return 'The microphone is busy or unavailable'
  return e instanceof Error ? e.message : String(e)
}

/** Yield to the event loop without the 1 s background-tab setTimeout clamp. */
function yieldToUI(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((r) => setTimeout(r, 0))
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      resolve()
    }
    ch.port2.postMessage(null)
  })
}

function decodeAudio(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  // Callback form too, for older Safari.
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(data, resolve, reject) as Promise<AudioBuffer> | undefined
    if (p && typeof p.then === 'function') p.then(resolve, reject)
  })
}

export class RespEngine {
  private readonly model: EdgeImpulseModel | null
  private readonly listeners: ListenerMap = { frame: new Set(), cough: new Set(), state: new Set() }
  private _state: EngineState = 'idle'
  private ctx: AudioContext | null = null
  private workletReady: Promise<boolean> | null = null
  private mic: MicSession | null = null
  private micStarting: Promise<void> | null = null
  private micToken = 0
  private sample: SampleSession | null = null
  private sampleToken = 0
  /** playSample() calls in flight (the context must not be suspended under them) */
  private pendingPlays = 0
  private micSuppressedUntil = 0
  private nextId = 0
  private disposed = false

  // Display (rAF) state
  private visual: Pipeline | null = null
  private queue: HopRecord[] = []
  private readonly waveRing = new Float32Array(WAVE_RING)
  private waveWrite = 0
  private captureRate = 48000
  private raf = 0
  private lastTick = 0
  private credit = 0
  private lastAudioAt = -Infinity
  private dispMel = new Float32Array(NUM_MEL_BANDS)
  private dispWave = new Float32Array(WAVE_LEN)
  private dispLevel = 0
  private dispDb = -120
  private dispProb = 0
  private dispLabel: AnalysisFrame['label'] = 'silence'

  private constructor(model: EdgeImpulseModel | null) {
    this.model = model
  }

  /** Detect and load the Edge Impulse model if deployed, else use the acoustic engine. */
  static async create(): Promise<RespEngine> {
    let model: EdgeImpulseModel | null = null
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      try {
        if (await EdgeImpulseModel.isAvailable()) model = await EdgeImpulseModel.load()
      } catch (err) {
        console.warn('[RespAI] Edge Impulse model found but could not be used — falling back to the acoustic preview engine:', err)
        model = null
      }
    }
    return new RespEngine(model)
  }

  get info(): EngineInfo {
    const m = this.model
    if (m) {
      return {
        kind: 'edge-impulse',
        name: 'RespAI Edge Impulse model (WebAssembly)',
        sampleRate: m.frequency,
        windowMs: Math.round((m.windowSamples / m.frequency) * 1000),
        labels: [...m.labels],
      }
    }
    return { kind: 'acoustic', name: 'Acoustic preview engine', sampleRate: SAMPLE_RATE, windowMs: 25, labels: ['cough', 'noise'] }
  }

  get state(): EngineState {
    return this._state
  }

  get micActive(): boolean {
    return this.mic !== null
  }

  on<K extends keyof EngineEvents>(evt: K, cb: EngineEvents[K]): () => void {
    const set = this.listeners[evt] as Set<EngineEvents[K]>
    set.add(cb)
    return () => {
      set.delete(cb)
    }
  }

  private emit<K extends keyof EngineEvents>(evt: K, ...args: Parameters<EngineEvents[K]>): void {
    const set = this.listeners[evt] as Set<(...a: Parameters<EngineEvents[K]>) => void>
    for (const cb of set) {
      try {
        cb(...args)
      } catch (err) {
        console.error(`[RespAI] '${evt}' listener threw`, err)
      }
    }
  }

  private setState(s: EngineState, error?: string): void {
    if (s === this._state && error === undefined) return
    this._state = s
    this.emit('state', s, error)
  }

  private idleState(): EngineState {
    return this.sample ? 'playing' : this.mic ? 'listening' : 'idle'
  }

  // -------------------------------------------------------------------------
  // Audio context & capture
  // -------------------------------------------------------------------------

  /**
   * Create / resume the AudioContext. Called synchronously at the top of the
   * gesture-driven methods, so autoplay policies see the user activation.
   * Runs at the device rate: Firefox cannot connect a mic to a 16 kHz context,
   * and resampling ourselves is cheap.
   */
  private ensureContext(): { ctx: AudioContext; resumed: Promise<void> } {
    if (this.disposed) throw new Error('RespEngine has been disposed')
    if (typeof window === 'undefined') throw new Error('Web Audio is not available in this environment')
    if (!this.ctx || this.ctx.state === 'closed') {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) throw new Error('This browser does not support the Web Audio API')
      this.ctx = new Ctor({ latencyHint: 'interactive' })
      this.workletReady = null
    }
    const ctx = this.ctx
    const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume().catch(() => undefined)
    return { ctx, resumed }
  }

  private ensureWorklet(ctx: AudioContext): Promise<boolean> {
    if (!this.workletReady) {
      this.workletReady = (async () => {
        if (!ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') return false
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }))
        try {
          await ctx.audioWorklet.addModule(url)
          return true
        } catch (err) {
          console.warn('[RespAI] AudioWorklet unavailable, using ScriptProcessorNode', err)
          return false
        } finally {
          URL.revokeObjectURL(url)
        }
      })()
    }
    return this.workletReady
  }

  /** Tap `input` and deliver mono capture-rate chunks to `onChunk`. */
  private async createCapture(ctx: AudioContext, input: AudioNode, onChunk: (x: Float32Array) => void): Promise<Capture> {
    if (await this.ensureWorklet(ctx)) {
      const node = new AudioWorkletNode(ctx, WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { batch: CAPTURE_BATCH },
      })
      let flushed: (() => void) | null = null
      node.port.onmessage = (e: MessageEvent) => {
        if (e.data instanceof Float32Array) onChunk(e.data)
        else if (e.data === 'flushed' && flushed) {
          const r = flushed
          flushed = null
          r()
        }
      }
      input.connect(node)
      node.connect(ctx.destination) // outputs silence; keeps the node pulled in every browser
      return {
        flush: () =>
          new Promise<void>((resolve) => {
            flushed = resolve
            node.port.postMessage('flush')
            setTimeout(() => {
              if (flushed === resolve) {
                flushed = null
                resolve()
              }
            }, 300)
          }),
        stop: () => {
          try {
            input.disconnect(node)
          } catch {
            // already disconnected
          }
          node.disconnect()
          node.port.postMessage('stop')
          node.port.onmessage = null
        },
      }
    }
    // Fallback for insecure origins (AudioWorklet needs a secure context) and old browsers.
    const sp = ctx.createScriptProcessor(CAPTURE_BATCH, 1, 1)
    sp.onaudioprocess = (e: AudioProcessingEvent) => {
      onChunk(new Float32Array(e.inputBuffer.getChannelData(0)))
      e.outputBuffer.getChannelData(0).fill(0)
    }
    input.connect(sp)
    sp.connect(ctx.destination)
    return {
      flush: () => Promise.resolve(),
      stop: () => {
        sp.onaudioprocess = null
        try {
          input.disconnect(sp)
        } catch {
          // already disconnected
        }
        sp.disconnect()
      },
    }
  }

  private createAnalyzer(): StreamAnalyzer {
    return this.model ? new EdgeImpulseStream(this.model) : new AcousticCoughDetector()
  }

  private createPipeline(source: AudioSource, inRate: number): Pipeline {
    const pipe = new Pipeline(source, this.createAnalyzer(), inRate)
    pipe.analyzer.onFrame = (f) => {
      if (this.visual === pipe) this.enqueue(f)
    }
    pipe.analyzer.onEvent = (e) => this.handleEvent(pipe, e)
    return pipe
  }

  private toDetection(e: CoughEvent, source: AudioSource): CoughDetection {
    return {
      id: ++this.nextId,
      t: performance.now(),
      wallTime: Date.now(),
      prob: Math.round(e.prob * 1000) / 1000,
      durationMs: Math.round(e.durationMs),
      peakDb: Math.round(e.peakDb * 10) / 10,
      centroidHz: Math.round(e.centroidHz),
      attackMs: Math.round(e.attackMs),
      source,
    }
  }

  private handleEvent(pipe: Pipeline, e: CoughEvent): void {
    if (!e.accepted || this.disposed) return
    // The mic hears our own sample playback (echo cancellation is off on purpose).
    if (pipe.source === 'mic' && (this.sample || performance.now() < this.micSuppressedUntil)) return
    this.emit('cough', this.toDetection(e, pipe.source))
  }

  private setVisual(pipe: Pipeline | null): void {
    if (this.visual === pipe) return
    this.visual = pipe
    this.queue = []
  }

  private echoTailMs(): number {
    const c = this.ctx
    return 350 + 1000 * ((c?.outputLatency || 0) + (c?.baseLatency || 0))
  }

  private onMicChunk(x: Float32Array): void {
    const m = this.mic
    if (!m) return
    const now = performance.now()
    // While a demo sample plays (and its echo dies down) the mic would just hear the speakers.
    if (this.sample || now < this.micSuppressedUntil) return
    this.lastAudioAt = now
    if (this.visual === m.pipe) this.pushWave(x)
    m.pipe.push(x)
    this.startLoop()
  }

  private pushWave(x: Float32Array): void {
    const ring = this.waveRing
    for (let i = 0; i < x.length; i++) ring[(this.waveWrite + i) % WAVE_RING] = x[i]
    this.waveWrite += x.length
  }

  // -------------------------------------------------------------------------
  // Microphone
  // -------------------------------------------------------------------------

  /**
   * Start listening. Call from a click/tap handler (autoplay + permission
   * policies). Resolves once audio is flowing; rejects (and emits
   * state 'error' with a readable message) if the mic cannot be opened.
   */
  startMic(): Promise<void> {
    if (this.mic) return Promise.resolve()
    if (!this.micStarting) {
      this.micStarting = this.openMic().finally(() => {
        this.micStarting = null
      })
    }
    return this.micStarting
  }

  private async openMic(): Promise<void> {
    let ctx: AudioContext
    let resumed: Promise<void>
    try {
      ;({ ctx, resumed } = this.ensureContext())
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(window.isSecureContext === false ? 'Microphone access needs HTTPS (or localhost)' : 'This browser cannot access the microphone')
      }
    } catch (err) {
      const msg = describeMicError(err)
      this.setState('error', msg)
      throw new Error(msg)
    }
    const token = ++this.micToken
    this.setState('loading')
    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Voice processing is tuned for calls and eats coughs: turn it all off.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 1 },
        },
        video: false,
      })
      await resumed
      if (token !== this.micToken || this.disposed) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const src = ctx.createMediaStreamSource(stream)
      const pipe = this.createPipeline('mic', ctx.sampleRate)
      const cap = await this.createCapture(ctx, src, (x) => this.onMicChunk(x))
      if (token !== this.micToken || this.disposed) {
        cap.stop()
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const session: MicSession = { stream, src, cap, pipe }
      this.mic = session
      this.captureRate = ctx.sampleRate
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (this.mic === session) {
          this.stopMic()
          this.setState('error', 'The microphone was disconnected')
        }
      })
      if (!this.sample) this.setVisual(pipe)
      this.setState(this.idleState())
      this.startLoop()
    } catch (err) {
      stream?.getTracks().forEach((t) => t.stop())
      const msg = describeMicError(err)
      if (token === this.micToken) this.setState('error', msg)
      throw new Error(msg)
    }
  }

  /** Stop listening and release the microphone. */
  stopMic(): void {
    this.micToken++ // cancels a pending startMic
    const m = this.mic
    this.mic = null
    if (m) {
      m.cap.stop()
      m.stream.getTracks().forEach((t) => t.stop())
      m.pipe.finish()
      if (this.visual === m.pipe) this.setVisual(null)
    }
    this.setState(this.idleState())
    this.maybeSuspend()
  }

  /** Suspend the audio thread when nothing uses it (saves battery on laptops/phones). */
  private maybeSuspend(): void {
    if (!this.mic && !this.sample && !this.micStarting && this.pendingPlays === 0 && this.ctx && this.ctx.state === 'running') {
      void this.ctx.suspend().catch(() => undefined)
    }
  }

  // -------------------------------------------------------------------------
  // Demo samples
  // -------------------------------------------------------------------------

  /**
   * Synthesize a demo sound, play it through the speakers and analyse the very
   * same audio live (frames + detections with source 'sample'). Works with or
   * without the mic. Starting a new sample cuts the previous one. Resolves when
   * playback (and analysis) is done. Call from a user gesture.
   */
  async playSample(kind: SampleKind): Promise<void> {
    let ctx: AudioContext
    let resumed: Promise<void>
    try {
      ;({ ctx, resumed } = this.ensureContext())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.setState('error', msg)
      throw err
    }
    this.stopSample()
    const token = ++this.sampleToken
    this.pendingPlays++
    try {
      await resumed
      if (token !== this.sampleToken || this.disposed) return
      await this.runSample(ctx, kind, token)
    } finally {
      this.pendingPlays--
      this.maybeSuspend()
    }
  }

  private async runSample(ctx: AudioContext, kind: SampleKind, token: number): Promise<void> {
    const data = synthesize(kind, ctx.sampleRate)
    const src = ctx.createBufferSource()
    src.buffer = toAudioBuffer(ctx, data, ctx.sampleRate)
    const pipe = this.createPipeline('sample', ctx.sampleRate)
    const session: SampleSession = { src, pipe, token }
    const cap = await this.createCapture(ctx, src, (x) => {
      if (this.sample !== session) return
      this.lastAudioAt = performance.now()
      this.pushWave(x)
      pipe.push(x)
    })
    if (token !== this.sampleToken || this.disposed) {
      cap.stop()
      return
    }
    src.connect(ctx.destination)
    const durationMs = (data.length / ctx.sampleRate) * 1000
    const ended = new Promise<void>((resolve) => {
      src.onended = () => resolve()
      setTimeout(resolve, durationMs + 3000) // never hang if the context dies
    })
    this.sample = session
    this.captureRate = ctx.sampleRate
    this.setVisual(pipe)
    this.setState('playing')
    this.startLoop()
    src.start()
    await ended
    await cap.flush()
    cap.stop()
    pipe.finish()
    if (this.sample === session) {
      this.sample = null
      this.micSuppressedUntil = performance.now() + this.echoTailMs()
      this.setVisual(this.mic?.pipe ?? null)
      this.setState(this.idleState())
    }
  }

  private stopSample(): void {
    const s = this.sample
    if (!s) return
    try {
      s.src.stop()
    } catch {
      // not started yet / already stopped
    }
  }

  // -------------------------------------------------------------------------
  // Files
  // -------------------------------------------------------------------------

  /**
   * Decode an audio file (anything the browser can decode), mix to mono,
   * resample to 16 kHz and run the active engine offline. Chunked with yields,
   * so a 60 s file does not freeze the UI. Does not emit 'cough' events —
   * detections are returned with `offsetSec`.
   */
  async analyzeFile(file: File | Blob): Promise<FileAnalysis> {
    if (typeof window === 'undefined') throw new Error('analyzeFile needs a browser')
    const bytes = await file.arrayBuffer()
    const x = await this.decodeMono16k(bytes)

    const analyzer = this.createAnalyzer()
    const detections: FileAnalysis['detections'] = []
    analyzer.onEvent = (e) => {
      if (e.accepted) detections.push({ ...this.toDetection(e, 'file'), offsetSec: Math.round((e.startSample / SAMPLE_RATE) * 1000) / 1000 })
    }
    const CHUNK = SAMPLE_RATE // 1 s
    let last = performance.now()
    for (let i = 0; i < x.length; i += CHUNK) {
      analyzer.push(x.subarray(i, Math.min(x.length, i + CHUNK)))
      if (performance.now() - last > 12) {
        await yieldToUI()
        last = performance.now()
      }
    }
    analyzer.push(new Float32Array(Math.round(SAMPLE_RATE * 0.2)))
    analyzer.flush()

    // ~600-point peak envelope, normalised to the file's peak.
    const points = Math.max(1, Math.min(600, x.length))
    const envelope = new Float32Array(points)
    let peak = 0
    for (let p = 0; p < points; p++) {
      const a = Math.floor((p * x.length) / points)
      const b = Math.max(a + 1, Math.floor(((p + 1) * x.length) / points))
      let m = 0
      for (let i = a; i < b && i < x.length; i++) {
        const v = Math.abs(x[i])
        if (v > m) m = v
      }
      envelope[p] = m
      if (m > peak) peak = m
    }
    if (peak > 0) for (let p = 0; p < points; p++) envelope[p] /= peak
    return { durationSec: x.length / SAMPLE_RATE, envelope, detections }
  }

  private async decodeMono16k(bytes: ArrayBuffer): Promise<Float32Array> {
    let audio: AudioBuffer
    try {
      // Decoding through a 16 kHz OfflineAudioContext lets the browser resample.
      const OAC = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext
      audio = await decodeAudio(new OAC(1, 1, SAMPLE_RATE), bytes.slice(0))
    } catch {
      let ctx = this.ctx
      if (!ctx) {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        ctx = new Ctor()
        this.ctx = ctx
      }
      try {
        audio = await decodeAudio(ctx, bytes)
      } catch (err) {
        throw new Error(`Could not decode this file as audio${err instanceof Error && err.message ? ` (${err.message})` : ''}`)
      }
    }
    const n = audio.length
    const mono = new Float32Array(n)
    const chans = audio.numberOfChannels
    for (let c = 0; c < chans; c++) {
      const d = audio.getChannelData(c)
      for (let i = 0; i < n; i++) mono[i] += d[i] / chans
    }
    return audio.sampleRate === SAMPLE_RATE ? mono : resample(mono, audio.sampleRate, SAMPLE_RATE)
  }

  // -------------------------------------------------------------------------
  // Display loop
  // -------------------------------------------------------------------------

  private enqueue(f: DetectorFrame): void {
    this.queue.push({ mel: f.mel.slice(), db: f.db, prob: f.prob, label: f.label })
    if (this.queue.length > 200) this.queue.splice(0, this.queue.length - 200) // hidden tab
  }

  private isFlowing(): boolean {
    return this.mic !== null || this.sample !== null
  }

  private startLoop(): void {
    if (this.raf || this.disposed || typeof requestAnimationFrame === 'undefined') return
    this.lastTick = 0
    this.raf = requestAnimationFrame(this.tick)
  }

  /**
   * One display frame. Analysis hops arrive in bursts (one worklet batch ≈ 4
   * hops), so they go through a small jitter buffer that releases them at the
   * real-time rate: the heatmap scrolls smoothly at ~60 fps with ≈ 60 ms delay.
   */
  private readonly tick = (now: number): void => {
    this.raf = 0
    if (this.disposed) return
    const dt = this.lastTick ? Math.min(100, now - this.lastTick) : 1000 / 60
    this.lastTick = now
    const flowing = this.isFlowing()
    const q = this.queue

    this.credit += dt / HOP_MS
    let n = Math.floor(this.credit)
    this.credit -= n
    if (q.length > 12) n = Math.max(n, q.length - 6) // catch up after a stall
    n = Math.min(n, q.length)
    if (q.length === 0) this.credit = Math.min(this.credit, 2)

    const mel = new Float32Array(NUM_MEL_BANDS)
    if (n > 0) {
      let db = -120
      for (let i = 0; i < n; i++) {
        const r = q[i]
        for (let b = 0; b < NUM_MEL_BANDS; b++) if (r.mel[b] > mel[b]) mel[b] = r.mel[b]
        if (r.db > db) db = r.db
      }
      const last = q[n - 1]
      q.splice(0, n)
      this.dispProb = last.prob
      this.dispLabel = last.label
      this.dispDb = db
      this.dispMel = mel
    } else if (flowing) {
      mel.set(this.dispMel) // between bursts: hold the last column
    } else {
      // Tail after the audio stopped: let everything fade out.
      for (let b = 0; b < NUM_MEL_BANDS; b++) mel[b] = this.dispMel[b] * 0.9
      this.dispMel = mel
      this.dispProb *= Math.pow(0.5, dt / PROB_HALF_LIFE_MS)
      this.dispDb = Math.max(-120, this.dispDb - dt * 0.08)
      this.dispLabel = 'silence'
    }

    const target = Math.min(1, Math.max(0, (this.dispDb + 70) / 60))
    this.dispLevel += (target - this.dispLevel) * (target > this.dispLevel ? 0.5 : 1 - Math.exp(-dt / 150))

    // Oscilloscope: 1024 capture-rate samples, delayed like the mel queue.
    const wave = new Float32Array(WAVE_LEN)
    if (flowing || q.length > 0) {
      const lag = Math.min(WAVE_RING - WAVE_LEN, Math.round(q.length * HOP_MS * 0.001 * this.captureRate))
      const end = this.waveWrite - lag
      for (let i = 0; i < WAVE_LEN; i++) {
        const idx = end - WAVE_LEN + i
        wave[i] = idx >= 0 ? this.waveRing[idx % WAVE_RING] : 0
      }
    } else {
      for (let i = 0; i < WAVE_LEN; i++) wave[i] = this.dispWave[i] * 0.85
    }
    this.dispWave = wave

    const done = !flowing && q.length === 0 && now - this.lastAudioAt > TAIL_MS
    if (done) {
      this.dispMel = new Float32Array(NUM_MEL_BANDS)
      this.dispWave = new Float32Array(WAVE_LEN)
      this.dispLevel = 0
      this.dispProb = 0
      this.dispDb = -120
      this.dispLabel = 'silence'
    }
    this.emit('frame', {
      t: now,
      level: this.dispLevel,
      db: this.dispDb,
      mel: done ? this.dispMel.slice() : mel,
      waveform: done ? this.dispWave.slice() : wave,
      prob: this.dispProb,
      label: this.dispLabel,
    })
    if (!done) this.raf = requestAnimationFrame(this.tick)
  }

  // -------------------------------------------------------------------------

  /** Stop everything and release the AudioContext. The instance is unusable afterwards. */
  dispose(): void {
    if (this.disposed) return
    this.stopMic()
    this.stopSample()
    this.sample = null
    this.disposed = true
    if (this.raf && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf)
    this.raf = 0
    this.queue = []
    if (this.ctx) void this.ctx.close().catch(() => undefined)
    this.ctx = null
    this.listeners.frame.clear()
    this.listeners.cough.clear()
    this.listeners.state.clear()
    if (singleton === this) {
      singleton = null
      enginePromise = null
    }
  }
}

let enginePromise: Promise<RespEngine> | null = null
let singleton: RespEngine | null = null

/** Shared engine instance (created on first call). */
export function getEngine(): Promise<RespEngine> {
  if (!enginePromise) {
    enginePromise = RespEngine.create().then(
      (e) => {
        singleton = e
        return e
      },
      (err) => {
        enginePromise = null
        throw err
      },
    )
  }
  return enginePromise
}

export type { AnalysisFrame, CoughDetection, EngineInfo, EngineState, FileAnalysis, SampleKind }
