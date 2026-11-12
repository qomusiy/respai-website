/**
 * AcousticCoughDetector — streaming, signal-based cough detector (16 kHz mono).
 *
 * This is the "preview engine" used when the team's Edge Impulse model is not
 * deployed, and it is also the segmentation / feature front-end of the Edge
 * Impulse adapter (which replaces only the scoring step).
 *
 * Pipeline per 10 ms hop (25 ms Hann frame zero-padded to 512):
 *   hop energy, frame energy, spectral centroid / flatness / high-band ratio,
 *   ZCR, 40-band log-mel, and a harmonicity measure (Boersma-normalised
 *   autocorrelation peak over 80–500 Hz pitch lags on a 40 ms frame).
 *   → adaptive noise floor (minimum statistics over 1.5 s)
 *   → event segmentation (sharp onset → until energy settles near the floor)
 *   → event features (timing, voicing, spectral shape)
 *   → small neural network (coughModel.ts) → detection when prob ≥ threshold.
 *
 * The network was trained on real recordings (ESC-50 coughs vs. everyday sounds,
 * spoken words, Wikimedia Commons coughs) plus synthetic sounds, with 5-fold
 * cross-validation. Real-world accuracy is moderate; deploying the team's trained
 * Edge Impulse model (public/model/README.md) replaces this scorer.
 */

import { FFT, MelFilterbank, PowerSpectrum, NUM_BINS, SAMPLE_RATE, hannWindow, melToUnit, powerToDb } from './dsp'
import { NUM_MEL_BANDS } from './types'
import { COUGH_MLP } from './coughModel'

export const HOP = 160 // 10 ms
export const FRAME = 400 // 25 ms
const PITCH_FRAME = 640 // 40 ms: ≥ 3 periods at 80 Hz
const PITCH_FFT = 1024 // ≥ PITCH_FRAME + max lag, so the autocorrelation is not circularly aliased
const HOP_MS = (HOP / SAMPLE_RATE) * 1000
const BIN_HZ = SAMPLE_RATE / 512

// Segmentation constants (dB unless noted)
const ONSET_ABOVE_FLOOR = 12
const ONSET_RISE = 9 // rise vs. the minimum of the previous 3 hops (≤ 30 ms)
const ABS_MIN_DB = -62 // ignore anything quieter than this (hop RMS, dBFS)
const END_ABOVE_FLOOR = 6
const END_BELOW_PEAK = 30
const END_HANGOVER = 6 // hops (60 ms) below the end threshold to close an event
const MAX_EVENT_HOPS = 90 // 900 ms
const SPLIT_MIN_AGE = 10 // hops; a re-onset after 100 ms starts a new event
const SPLIT_DIP = 8 // the dip before a re-onset must be this far below the event peak
const SPLIT_CONFIRM = 3 // hops to look at before deciding a split (voiced re-onsets don't split)
const FLOOR_WINDOW = 150 // hops (1.5 s) for minimum statistics
const FLOOR_MIN = -80
const FLOOR_MAX = -15
const WARMUP_HOPS = 10 // let the floor estimate settle before accepting onsets
const PROB_DECAY = Math.pow(0.5, HOP_MS / 300) // 300 ms half-life for the UI probability

export interface DetectorFrame {
  /** Hop index since reset (hop = 10 ms) */
  index: number
  /** Sample index (16 kHz) at the end of this hop */
  sample: number
  /** RMS of the 25 ms frame, dBFS */
  db: number
  /** RMS of the newest 10 ms hop, dBFS */
  hopDb: number
  /** 0..1 log-mel column. Reused buffer — copy it if you keep it. */
  mel: Float32Array
  /** Smoothed cough probability for display */
  prob: number
  label: 'cough' | 'noise' | 'silence'
  floorDb: number
  /** Spectral centroid of this frame, Hz */
  centroidHz: number
  inEvent: boolean
}

export interface EventFeatures {
  durationMs: number
  /** Onset → energy peak */
  attackMs: number
  /** Onset → first hop within 6 dB of the peak (robust to cough plateaus) */
  riseMs: number
  /** Mean energy 50–150 ms after the rise point, relative to the peak */
  sustainRiseDb: number
  /** Time spent within 10 dB of the peak (impulses: < 30 ms) */
  topMs: number
  /** Energy-weighted temporal centroid, 0..1 of the duration (coughs peak early) */
  tCentroid: number
  /** Energy-weighted means over the first 100 ms (explosive phase) */
  flatEarly: number
  hfEarly: number
  harmEarly: number
  zcrEarly: number
  /** Harmonicity around the energy peak (a cough's loudest moment is unvoiced) */
  harmPeak: number
  /** Energy-weighted fraction of the event that is voiced (harmonicity > 0.5) */
  harmFrac: number
  centroidHz: number
  peakDb: number
  /** Peak hop energy above the noise floor */
  snrDb: number
  /** Mean energy 50–150 ms after the peak, relative to the peak (impulses: < −20 dB) */
  sustainDb: number
  /** Mean energy 100–200 ms after the peak, relative to the peak (negative) */
  decayDb: number
  /** Mean level of the latest 40 ms relative to the peak (live estimate only) */
  nowDb: number
  /** Event hit the 900 ms limit */
  truncated: boolean
  /** Spectral shape (8 mel groups, mean-removed log-mel) over the first 100 ms */
  melEarly: number[]
  /** Spectral shape over the whole event */
  melAll: number[]
}

export const MEL_GROUPS = 8

export interface CoughEvent {
  /** 16 kHz sample indices since reset */
  startSample: number
  endSample: number
  peakSample: number
  durationMs: number
  attackMs: number
  peakDb: number
  centroidHz: number
  /** Final cough probability from the acoustic scorer */
  prob: number
  accepted: boolean
  features: EventFeatures
}

export interface DetectorOptions {
  /** Final-probability threshold for a detection (default 0.6) */
  threshold?: number
}

// ---------------------------------------------------------------------------
// Harmonicity (voicing) estimator
// ---------------------------------------------------------------------------

/**
 * Normalised autocorrelation peak in the 80–500 Hz pitch range (Boersma 1993):
 * r_x(τ) ≈ r_xw(τ) / r_w(τ). The spectrum is band-limited to 70–3000 Hz and
 * pre-emphasised before the inverse transform so low-frequency rumble (whose
 * autocorrelation decays slowly) does not masquerade as voicing; only true
 * local maxima count. Voiced speech/humming → 0.7–0.95, coughs/noise → < 0.4.
 */
class Harmonicity {
  private readonly fft = new FFT(PITCH_FFT)
  private readonly win = hannWindow(PITCH_FRAME)
  private readonly re = new Float64Array(PITCH_FFT)
  private readonly im = new Float64Array(PITCH_FFT)
  private readonly weight = new Float64Array(PITCH_FFT / 2 + 1)
  private readonly rw = new Float64Array(PITCH_FFT / 2)
  private readonly minLag = Math.floor(SAMPLE_RATE / 500)
  private readonly maxLag = Math.ceil(SAMPLE_RATE / 80)

  constructor() {
    const binHz = SAMPLE_RATE / PITCH_FFT
    for (let k = 0; k <= PITCH_FFT / 2; k++) {
      const f = k * binHz
      let band = 0
      if (f >= 70 && f <= 3000) band = 1
      if (f >= 70 && f < 120) band = 0.5 - 0.5 * Math.cos((Math.PI * (f - 70)) / 50)
      if (f > 2500 && f <= 3000) band = 0.5 + 0.5 * Math.cos((Math.PI * (f - 2500)) / 500)
      const w = (2 * Math.PI * f) / SAMPLE_RATE
      const preEmph = 1 + 0.85 * 0.85 - 2 * 0.85 * Math.cos(w)
      this.weight[k] = band * preEmph
    }
    // Window autocorrelation through the same (unweighted) path.
    const { re, im } = this
    re.fill(0)
    im.fill(0)
    for (let i = 0; i < PITCH_FRAME; i++) re[i] = this.win[i]
    this.fft.transform(re, im)
    for (let k = 0; k < PITCH_FFT; k++) {
      re[k] = re[k] * re[k] + im[k] * im[k]
      im[k] = 0
    }
    this.fft.transform(re, im)
    for (let t = 0; t < PITCH_FFT / 2; t++) this.rw[t] = re[t] / re[0]
  }

  compute(x: Float64Array, offset: number): number {
    const { re, im, win } = this
    let mean = 0
    for (let i = 0; i < PITCH_FRAME; i++) mean += x[offset + i]
    mean /= PITCH_FRAME
    for (let i = 0; i < PITCH_FRAME; i++) re[i] = (x[offset + i] - mean) * win[i]
    re.fill(0, PITCH_FRAME)
    im.fill(0)
    this.fft.transform(re, im)
    const half = PITCH_FFT / 2
    for (let k = 0; k <= half; k++) {
      const p = (re[k] * re[k] + im[k] * im[k]) * this.weight[k]
      re[k] = p
      if (k > 0 && k < half) re[PITCH_FFT - k] = p
    }
    im.fill(0)
    this.fft.transform(re, im) // real-even input → real autocorrelation
    const r0 = re[0]
    if (!(r0 > 1e-20)) return 0
    let best = 0
    let prev = re[this.minLag - 1] / r0 / this.rw[this.minLag - 1]
    let cur = re[this.minLag] / r0 / this.rw[this.minLag]
    for (let t = this.minLag; t <= this.maxLag; t++) {
      const next = re[t + 1] / r0 / this.rw[t + 1]
      if (cur > prev && cur >= next && cur > best) best = cur
      prev = cur
      cur = next
    }
    return best > 1 ? 1 : best
  }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Linear ramp: 0 at x=a, 1 at x=b (works for a > b too), clamped. */
function ramp(x: number, a: number, b: number): number {
  const t = (x - a) / (b - a)
  return t < 0 ? 0 : t > 1 ? 1 : t
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z))
}

/** Model inputs, in the exact order the weights in coughModel.ts were trained on. */
export function featureVector(f: EventFeatures): number[] {
  const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)
  const mel = (a: number[]) => (a.length === MEL_GROUPS ? a : new Array<number>(MEL_GROUPS).fill(0))
  return [
    Math.log1p(f.durationMs),
    Math.log1p(f.attackMs),
    Math.log1p(f.riseMs),
    Math.log1p(f.topMs),
    f.tCentroid,
    Math.log(f.flatEarly + 1e-4),
    f.hfEarly,
    f.harmEarly,
    f.harmPeak,
    f.harmFrac,
    f.zcrEarly,
    Math.log(f.centroidHz + 50),
    clamp(f.snrDb, 0, 50),
    clamp(f.sustainDb, -60, 0),
    clamp(f.sustainRiseDb, -60, 0),
    clamp(f.decayDb, -60, 0),
    f.truncated ? 1 : 0,
    ...mel(f.melEarly),
    ...mel(f.melAll),
  ]
}

/** Raw network output (logit) of the cough MLP. */
function mlpLogit(f: EventFeatures): number {
  const m = COUGH_MLP
  const x = featureVector(f)
  for (let d = 0; d < m.inputs; d++) x[d] = (x[d] - m.mu[d]) / m.sd[d]
  let o: number = m.b2
  for (let j = 0; j < m.hidden; j++) {
    const w = m.w1[j]
    let a: number = m.b1[j]
    for (let d = 0; d < m.inputs; d++) a += w[d] * x[d]
    o += m.w2[j] * Math.tanh(a)
  }
  return o
}

/**
 * Cough score (logit). A small neural network over the event's timing, voicing and
 * spectral-shape features (see coughModel.ts), calibrated so p = 0.6 is the
 * operating point chosen in cross-validation on real recordings.
 * `final === false` is the live estimate while the event is still running.
 */
export function coughLogit(f: EventFeatures, final: boolean): number {
  let z = mlpLogit(f) - 1.0 + Math.log(0.6 / 0.4)
  if (final) {
    if (f.truncated) z -= 4
  } else {
    // Live estimate: an event that is still at full level after 150–300 ms is
    // not behaving like a cough (yet); one that has died away very early is too short.
    z -= 3 * ramp(f.nowDb, -8, -2) * ramp(f.durationMs, 150, 300)
    if (f.truncated || f.durationMs > 880) z -= 6
  }
  return z
}

export function coughProbability(f: EventFeatures, final = true): number {
  const p = sigmoid(coughLogit(f, final))
  // Live estimates start cautious: the first tens of ms of a clap, a plosive or
  // a door slam look exactly like a cough burst.
  return final ? p : p * ramp(f.durationMs, 30, 120)
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export class AcousticCoughDetector {
  onFrame: ((f: DetectorFrame) => void) | null = null
  onEvent: ((e: CoughEvent) => void) | null = null
  readonly threshold: number

  private readonly spec = new PowerSpectrum(FRAME)
  private readonly mel = new MelFilterbank()
  private readonly harm = new Harmonicity()
  private readonly power = new Float64Array(NUM_BINS)
  private readonly melPower = new Float64Array(NUM_MEL_BANDS)
  private readonly melUnit = new Float32Array(NUM_MEL_BANDS)
  /** Sliding analysis history: the newest PITCH_FRAME samples. */
  private readonly hist = new Float64Array(PITCH_FRAME)
  private readonly pending = new Float32Array(HOP)
  private pendingN = 0

  private hop = 0
  private uiProb = 0
  private floor = FLOOR_MIN
  private readonly floorRing = new Float64Array(FLOOR_WINDOW).fill(Infinity)
  private floorPos = 0
  private smoothPow = -1 // ~80 ms power smoother feeding the minimum tracker
  private readonly recentHopDb = new Float64Array(4).fill(-120)

  // Active event state (per-hop feature tracks)
  private active = false
  private evLen = 0
  private evStartHop = 0
  private evFloor = 0
  private evPeak = -200
  /** Event-relative hop index of a pending split candidate (-1 = none) */
  private splitAt = -1
  private splitGap = false
  private belowCount = 0
  private readonly evDb = new Float64Array(MAX_EVENT_HOPS + 4)
  /** 5 ms (half-hop) energies, dB — finer timing for the impulse measure */
  private readonly evHalfDb = new Float64Array(2 * (MAX_EVENT_HOPS + 4))
  private readonly evFlat = new Float64Array(MAX_EVENT_HOPS + 4)
  private readonly evHf = new Float64Array(MAX_EVENT_HOPS + 4)
  private readonly evHarm = new Float64Array(MAX_EVENT_HOPS + 4)
  private readonly evCent = new Float64Array(MAX_EVENT_HOPS + 4)
  private readonly evZcr = new Float64Array(MAX_EVENT_HOPS + 4)
  /** Per-hop 8-group log-mel (0..1 units) for the spectral-shape features */
  private readonly evMel = new Float64Array((MAX_EVENT_HOPS + 4) * MEL_GROUPS)
  private evProvisional = 0

  constructor(opts: DetectorOptions = {}) {
    this.threshold = opts.threshold ?? 0.6
  }

  get prob(): number {
    return this.uiProb
  }

  get floorDb(): number {
    return this.floor
  }

  /** Start sample (16 kHz) of the event being segmented right now, or -1. */
  get activeEventStart(): number {
    return this.active ? this.evStartHop * HOP : -1
  }

  /** Total 16 kHz samples consumed (including a partial hop). */
  get samplesProcessed(): number {
    return this.hop * HOP + this.pendingN
  }

  reset(): void {
    this.pendingN = 0
    this.hop = 0
    this.uiProb = 0
    this.floor = FLOOR_MIN
    this.floorRing.fill(Infinity)
    this.floorPos = 0
    this.smoothPow = -1
    this.recentHopDb.fill(-120)
    this.hist.fill(0)
    this.active = false
    this.evLen = 0
    this.splitAt = -1
  }

  /** Feed 16 kHz mono samples (any chunk size). */
  push(samples: Float32Array): void {
    let i = 0
    while (i < samples.length) {
      const take = Math.min(HOP - this.pendingN, samples.length - i)
      this.pending.set(samples.subarray(i, i + take), this.pendingN)
      this.pendingN += take
      i += take
      if (this.pendingN === HOP) {
        this.processHop(this.pending)
        this.pendingN = 0
      }
    }
  }

  /** Close any running event (end of file / end of a played sample). */
  flush(): void {
    if (this.active) this.finishEvent(this.evLen)
  }

  private processHop(x: Float32Array): void {
    // Slide history and append the new hop.
    const h = this.hist
    h.copyWithin(0, HOP)
    let halfA = 0
    let halfB = 0
    for (let i = 0; i < HOP; i++) {
      const v = x[i]
      h[PITCH_FRAME - HOP + i] = v
      if (i < HOP / 2) halfA += v * v
      else halfB += v * v
    }
    const hopPow = (halfA + halfB) / HOP
    const hopDb = powerToDb(hopPow)

    // 25 ms frame = newest FRAME samples of the history.
    const off = PITCH_FRAME - FRAME
    let framePow = 0
    let zc = 0
    for (let i = 0; i < FRAME; i++) {
      const v = h[off + i]
      framePow += v * v
      if (i > 0 && (v >= 0) !== (h[off + i - 1] >= 0)) zc++
    }
    framePow /= FRAME
    const frameDb = powerToDb(framePow)
    const zcr = zc / (FRAME - 1)

    this.spec.compute(h, off, this.power)
    const P = this.power
    // Centroid and high-band ratio over 62 Hz – 8 kHz; flatness over 250 Hz – 7.5 kHz.
    let sum = 0
    let wsum = 0
    let hi = 0
    for (let k = 2; k < NUM_BINS; k++) {
      sum += P[k]
      wsum += P[k] * k * BIN_HZ
      if (k >= 32) hi += P[k]
    }
    const centroid = sum > 0 ? wsum / sum : 0
    const hfRatio = sum > 0 ? hi / sum : 0
    let logSum = 0
    let linSum = 0
    const k0 = 8
    const k1 = 240
    for (let k = k0; k <= k1; k++) {
      const p = P[k] + 1e-14
      logSum += Math.log(p)
      linSum += p
    }
    const nf = k1 - k0 + 1
    const flatness = Math.exp(logSum / nf) / (linSum / nf)

    this.mel.apply(P, this.melPower)
    melToUnit(this.melPower, this.melUnit)

    // --- adaptive noise floor: minimum statistics over the last 1.5 s ---
    // The minimum is taken over an ~80 ms smoothed power track: raw 10 ms
    // energies of low-frequency-heavy noise (fans, rumble) swing ±4 dB, and their
    // minimum would sit far below the real background level.
    if (this.smoothPow < 0) this.smoothPow = hopPow
    else this.smoothPow += (hopPow - this.smoothPow) * 0.12
    const smoothDb = powerToDb(this.smoothPow)
    this.floorRing[this.floorPos] = smoothDb
    this.floorPos = (this.floorPos + 1) % FLOOR_WINDOW
    let mn = Infinity
    for (let i = 0; i < FLOOR_WINDOW; i++) if (this.floorRing[i] < mn) mn = this.floorRing[i]
    const candidate = Math.min(FLOOR_MAX, Math.max(FLOOR_MIN, mn + 1.5))
    // Fast down, ~100 ms up (the 1.5 s minimum window already makes rises slow).
    // During warm-up, simply take the running minimum.
    const warm = this.hop >= WARMUP_HOPS
    if (!warm || candidate < this.floor) this.floor = candidate
    else this.floor += (candidate - this.floor) * 0.1

    // Voicing only matters for audible frames; skip the extra FFTs otherwise.
    const harm = frameDb > this.floor + 6 ? this.harm.compute(h, 0) : 0

    // --- segmentation ---
    const rd = this.recentHopDb
    if (this.hop === 0) rd.fill(hopDb) // a stream start is not an onset
    const prevMin = Math.min(rd[1], rd[2], rd[3])
    const rise = hopDb - prevMin
    const loudEnough = hopDb >= this.floor + ONSET_ABOVE_FLOOR && hopDb >= ABS_MIN_DB

    if (this.active) {
      if (
        this.splitAt < 0 &&
        this.evLen >= SPLIT_MIN_AGE &&
        rise >= ONSET_RISE &&
        loudEnough &&
        prevMin <= this.evPeak - SPLIT_DIP
      ) {
        // Possible new cough inside a running event (cough bouts). Confirmed
        // after SPLIT_CONFIRM hops, once we know whether the re-onset is voiced.
        this.splitAt = this.evLen
        this.splitGap = prevMin <= this.floor + 8
      }
    } else if (warm && rise >= ONSET_RISE && loudEnough) {
      this.startEvent()
    }

    if (this.active) {
      const i = this.evLen++
      this.evDb[i] = hopDb
      this.evHalfDb[2 * i] = powerToDb((2 * halfA) / HOP)
      this.evHalfDb[2 * i + 1] = powerToDb((2 * halfB) / HOP)
      this.evFlat[i] = flatness
      this.evHf[i] = hfRatio
      this.evHarm[i] = harm
      this.evCent[i] = centroid
      this.evZcr[i] = zcr
      const per = NUM_MEL_BANDS / MEL_GROUPS
      for (let g = 0; g < MEL_GROUPS; g++) {
        let a = 0
        for (let b = g * per; b < (g + 1) * per; b++) a += this.melUnit[b]
        this.evMel[i * MEL_GROUPS + g] = a / per
      }
      if (hopDb > this.evPeak) this.evPeak = hopDb
      if (this.splitAt >= 0 && this.evLen - this.splitAt >= SPLIT_CONFIRM) {
        // Every cough starts with an unvoiced burst; a voiced re-onset that grows
        // out of the decaying sound is this cough's own voiced phase and stays in
        // the same event. After a real gap (back near the floor) always split.
        let hs = 0
        for (let k = this.splitAt; k < this.evLen; k++) hs += this.evHarm[k]
        if (this.splitGap || hs / (this.evLen - this.splitAt) < 0.45) {
          // Cut right after the quietest hop of the dip (the onset hop can be
          // detected one hop late when the new burst straddles a hop boundary).
          let k = this.splitAt
          for (let j = this.splitAt - 1; j >= Math.max(1, this.splitAt - 3); j--) if (this.evDb[j - 1] < this.evDb[k - 1]) k = j
          this.splitEvent(k)
        }
        this.splitAt = -1
      }
      const endThr = Math.max(this.evFloor + END_ABOVE_FLOOR, this.evPeak - END_BELOW_PEAK)
      this.belowCount = hopDb < endThr ? this.belowCount + 1 : 0
      if (this.belowCount >= END_HANGOVER || this.evLen >= MAX_EVENT_HOPS) {
        this.finishEvent(this.evLen)
      } else if (this.evLen >= 4 && (this.evLen & 1) === 0) {
        // Live probability while the event is still running.
        this.evProvisional = coughProbability(this.computeFeatures(this.trimmedLength(this.evLen), this.evLen, false), false)
      }
    }

    rd[0] = rd[1]
    rd[1] = rd[2]
    rd[2] = rd[3]
    rd[3] = hopDb

    // --- UI probability: follows the live estimate, then decays (300 ms half-life) ---
    this.uiProb *= PROB_DECAY
    if (this.active && this.evProvisional > this.uiProb) this.uiProb = this.evProvisional

    this.hop++
    if (this.onFrame) {
      let label: DetectorFrame['label'] = 'silence'
      if (this.uiProb >= 0.5) label = 'cough'
      else if (frameDb >= this.floor + 8 && frameDb > ABS_MIN_DB) label = 'noise'
      this.onFrame({
        index: this.hop - 1,
        sample: this.hop * HOP,
        db: frameDb,
        hopDb,
        mel: this.melUnit,
        prob: this.uiProb,
        label,
        floorDb: this.floor,
        centroidHz: centroid,
        inEvent: this.active,
      })
    }
  }

  private startEvent(): void {
    this.active = true
    this.evLen = 0
    this.evStartHop = this.hop
    this.evFloor = this.floor
    this.evPeak = -200
    this.belowCount = 0
    this.evProvisional = 0
    this.splitAt = -1
  }

  /** Close the event at hop `k` and continue with hops [k, evLen) as a new event. */
  private splitEvent(k: number): void {
    const moved = this.evLen - k
    const nextStart = this.evStartHop + k
    this.finishEvent(k)
    const tracks = [this.evDb, this.evFlat, this.evHf, this.evHarm, this.evCent, this.evZcr]
    for (const t of tracks) t.copyWithin(0, k, k + moved)
    this.evMel.copyWithin(0, k * MEL_GROUPS, (k + moved) * MEL_GROUPS)
    this.evHalfDb.copyWithin(0, 2 * k, 2 * (k + moved))
    this.active = true
    this.evLen = moved
    this.evStartHop = nextStart
    this.evPeak = -200
    for (let i = 0; i < moved; i++) if (this.evDb[i] > this.evPeak) this.evPeak = this.evDb[i]
    this.belowCount = 0
    this.evProvisional = 0
  }

  /**
   * Features over hops [0, len) of the current event. `avail` (≥ len) hops of
   * real measurements exist (the end-of-event hangover, or up to a split).
   */
  private computeFeatures(len: number, avail: number, final: boolean, truncated = false): EventFeatures {
    const db = this.evDb
    let peak = -200
    let peakIdx = 0
    for (let i = 0; i < len; i++) {
      if (db[i] > peak) {
        peak = db[i]
        peakIdx = i
      }
    }
    let pSum = 0
    let tSum = 0
    let halfPeak = -200
    for (let i = 0; i < 2 * len; i++) if (this.evHalfDb[i] > halfPeak) halfPeak = this.evHalfDb[i]
    let topHalves = 0
    for (let i = 0; i < 2 * len; i++) if (this.evHalfDb[i] >= halfPeak - 10) topHalves++
    let harmVoiced = 0
    for (let i = 0; i < len; i++) {
      const p = Math.pow(10, db[i] / 10)
      pSum += p
      tSum += p * i
      if (this.evHarm[i] > 0.5) harmVoiced += p
    }
    // Early (explosive) phase: first 100 ms, energy-weighted.
    const early = Math.min(len, 10)
    let ePow = 0
    let flat = 0
    let hf = 0
    let harm = 0
    let zcr = 0
    let cent = 0
    for (let i = 0; i < early; i++) {
      const p = Math.pow(10, db[i] / 10)
      ePow += p
      flat += p * this.evFlat[i]
      hf += p * this.evHf[i]
      harm += p * this.evHarm[i]
      zcr += p * this.evZcr[i]
      cent += p * this.evCent[i]
    }
    // Sustain / decay: mean power 50–150 / 100–200 ms after the peak, relative to
    // the peak. In the final call, hops past the measured data count at
    // noise-floor level; while the event is still running only the hops seen so
    // far are used (no data reads as a neutral 0 dB).
    const floorPow = Math.pow(10, this.evFloor / 10)
    const meanAfter = (from: number, to: number) => {
      let s = 0
      let n = 0
      for (let i = peakIdx + from; i < peakIdx + to; i++) {
        if (i < avail) s += Math.pow(10, db[i] / 10)
        else if (final) s += floorPow
        else continue
        n++
      }
      return n === 0 ? 0 : powerToDb(s / n) - peak
    }
    let riseIdx = 0
    while (riseIdx < peakIdx && db[riseIdx] < peak - 6) riseIdx++
    const meanAfterRise = (from: number, to: number) => {
      let s = 0
      let n = 0
      for (let i = riseIdx + from; i < riseIdx + to; i++) {
        if (i < avail) s += Math.pow(10, db[i] / 10)
        else if (final) s += floorPow
        else continue
        n++
      }
      return n === 0 ? 0 : powerToDb(s / n) - peak
    }
    const tc = len > 1 ? tSum / pSum / (len - 1) : 0
    let nowPow = 0
    const nowFrom = Math.max(0, len - 4)
    for (let i = nowFrom; i < len; i++) nowPow += Math.pow(10, db[i] / 10)
    const nowDb = powerToDb(nowPow / Math.max(1, len - nowFrom)) - peak
    // Spectral shape: energy-weighted mean of the 8-group log-mel, mean removed (level-invariant).
    const melShape = (from: number, to: number) => {
      const acc = new Array<number>(MEL_GROUPS).fill(0)
      let wt = 0
      for (let i = from; i < to; i++) {
        const p = Math.pow(10, db[i] / 10)
        wt += p
        for (let g = 0; g < MEL_GROUPS; g++) acc[g] += p * this.evMel[i * MEL_GROUPS + g]
      }
      let mean = 0
      for (let g = 0; g < MEL_GROUPS; g++) {
        acc[g] = wt > 0 ? acc[g] / wt : 0
        mean += acc[g] / MEL_GROUPS
      }
      return acc.map((v) => v - mean)
    }
    let harmPeak = 0
    let hn = 0
    for (let i = Math.max(0, peakIdx - 1); i <= Math.min(len - 1, peakIdx + 1); i++) {
      harmPeak += this.evHarm[i]
      hn++
    }
    return {
      durationMs: len * HOP_MS,
      attackMs: peakIdx * HOP_MS,
      riseMs: riseIdx * HOP_MS,
      sustainRiseDb: meanAfterRise(5, 15),
      topMs: topHalves * (HOP_MS / 2),
      tCentroid: tc,
      flatEarly: flat / ePow,
      hfEarly: hf / ePow,
      harmEarly: harm / ePow,
      zcrEarly: zcr / ePow,
      harmPeak: harmPeak / hn,
      harmFrac: harmVoiced / pSum,
      centroidHz: cent / ePow,
      peakDb: peak,
      snrDb: peak - this.evFloor,
      sustainDb: meanAfter(5, 15),
      decayDb: meanAfter(10, 20),
      nowDb,
      truncated,
      melEarly: melShape(0, early),
      melAll: melShape(0, len),
    }
  }

  /** Length without the trailing hangover / dip: up to the last hop above the end threshold. */
  private trimmedLength(avail: number): number {
    let peak = -200
    for (let i = 0; i < avail; i++) if (this.evDb[i] > peak) peak = this.evDb[i]
    const endThr = Math.max(this.evFloor + END_ABOVE_FLOOR, peak - END_BELOW_PEAK)
    let len = avail
    while (len > 1 && this.evDb[len - 1] < endThr) len--
    return len
  }

  /** Score and emit the event made of the first `avail` hops of the tracks. */
  private finishEvent(avail: number): void {
    const truncated = avail >= MAX_EVENT_HOPS
    const len = this.trimmedLength(avail)
    let peakIdx = 0
    for (let i = 1; i < len; i++) if (this.evDb[i] > this.evDb[peakIdx]) peakIdx = i
    const f = this.computeFeatures(len, avail, true, truncated)
    const prob = coughProbability(f, true)
    const accepted = prob >= this.threshold
    this.active = false
    this.splitAt = -1
    // Display probability: confirmations snap up, rejections pull the live estimate down.
    if (accepted) this.uiProb = Math.max(this.uiProb, prob)
    else this.uiProb = Math.min(this.uiProb, prob)
    this.evProvisional = 0
    if (this.onEvent) {
      const startSample = this.evStartHop * HOP
      this.onEvent({
        startSample,
        endSample: startSample + len * HOP,
        peakSample: startSample + peakIdx * HOP + HOP / 2,
        durationMs: f.durationMs,
        attackMs: f.attackMs,
        peakDb: f.peakDb,
        centroidHz: f.centroidHz,
        prob,
        accepted,
        features: f,
      })
    }
  }
}
