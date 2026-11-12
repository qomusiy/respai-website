/**
 * Small, allocation-free DSP toolkit used by the cough detector and the visualizer.
 *
 * Everything here is precomputed once (twiddles, windows, filterbank weights,
 * resampling kernel) so the per-hop work on the main thread stays cheap.
 * Pure TypeScript with erasable syntax only, so node can run it directly in tests.
 */

import { NUM_MEL_BANDS } from './types'

/** Analysis rate of the whole pipeline (and of Edge Impulse audio models). */
export const SAMPLE_RATE = 16000
export const FFT_SIZE = 512
export const NUM_BINS = FFT_SIZE / 2 + 1

/** Log-mel dB range mapped to 0..1 for the heatmap (see `melToUnit`). */
export const MEL_DB_FLOOR = -80
export const MEL_DB_CEIL = -20

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** Mean square → dB (dBFS when the signal is in -1..1). */
export function powerToDb(p: number): number {
  return 10 * Math.log10(p + 1e-12)
}

// ---------------------------------------------------------------------------
// FFT
// ---------------------------------------------------------------------------

/**
 * Iterative radix-2 complex FFT with precomputed twiddles and bit-reversal table.
 * Real signals are transformed by passing a zeroed imaginary array; at the sizes
 * we use (512/1024, ~100 calls/s) this is far below 1% of a core.
 */
export class FFT {
  readonly n: number
  private readonly cos: Float64Array
  private readonly sin: Float64Array
  private readonly rev: Uint32Array

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT size must be a power of two, got ${n}`)
    this.n = n
    this.cos = new Float64Array(n / 2)
    this.sin = new Float64Array(n / 2)
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / n)
      this.sin[i] = -Math.sin((2 * Math.PI * i) / n)
    }
    const bits = Math.round(Math.log2(n))
    this.rev = new Uint32Array(n)
    for (let i = 0; i < n; i++) {
      let r = 0
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
      this.rev[i] = r
    }
  }

  /** In-place forward transform. */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.n
    const rev = this.rev
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]
        re[i] = re[j]
        re[j] = t
        t = im[i]
        im[i] = im[j]
        im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1
      const step = n / size
      for (let start = 0; start < n; start += size) {
        for (let k = 0, tw = 0; k < half; k++, tw += step) {
          const a = start + k
          const b = a + half
          const wr = this.cos[tw]
          const wi = this.sin[tw]
          const xr = re[b] * wr - im[b] * wi
          const xi = re[b] * wi + im[b] * wr
          re[b] = re[a] - xr
          im[b] = im[a] - xi
          re[a] += xr
          im[a] += xi
        }
      }
    }
  }
}

/** Periodic Hann window (the right choice for spectral analysis with overlap). */
export function hannWindow(length: number): Float64Array {
  const w = new Float64Array(length)
  for (let i = 0; i < length; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length)
  return w
}

/**
 * Windowed, zero-padded power spectrum of a short frame.
 * Scaled so that a full-scale sine reads ~0 dB in its peak bin, which makes the
 * mel dB values roughly comparable to dBFS.
 */
export class PowerSpectrum {
  readonly frameLength: number
  readonly fftSize: number
  private readonly fft: FFT
  private readonly window: Float64Array
  private readonly re: Float64Array
  private readonly im: Float64Array
  private readonly scale: number

  constructor(frameLength: number, fftSize: number = FFT_SIZE) {
    this.frameLength = frameLength
    this.fftSize = fftSize
    this.fft = new FFT(fftSize)
    this.window = hannWindow(frameLength)
    this.re = new Float64Array(fftSize)
    this.im = new Float64Array(fftSize)
    let sum = 0
    for (let i = 0; i < frameLength; i++) sum += this.window[i]
    this.scale = 4 / (sum * sum)
  }

  /** `frame` must hold `frameLength` samples starting at `offset`; `out` gets fftSize/2+1 bins. */
  compute(frame: ArrayLike<number>, offset: number, out: Float64Array): void {
    const { re, im, window } = this
    const L = this.frameLength
    for (let i = 0; i < L; i++) re[i] = frame[offset + i] * window[i]
    re.fill(0, L)
    im.fill(0)
    this.fft.transform(re, im)
    const bins = this.fftSize / 2 + 1
    for (let k = 0; k < bins; k++) out[k] = (re[k] * re[k] + im[k] * im[k]) * this.scale
  }
}

// ---------------------------------------------------------------------------
// Mel filterbank
// ---------------------------------------------------------------------------

const hzToMel = (hz: number) => 2595 * Math.log10(1 + hz / 700)
const melToHz = (mel: number) => 700 * (10 ** (mel / 2595) - 1)

/**
 * Triangular mel filterbank (HTK mel scale), ~60 Hz – 8 kHz at 16 kHz.
 * Weights are evaluated on the continuous frequency axis (not rounded to bins),
 * so the narrow low bands are never empty. Filters are not area-normalised:
 * like the Edge Impulse MFE block, wider high bands sum more bins, which keeps
 * broadband sounds (coughs!) visible across the whole heatmap.
 */
export class MelFilterbank {
  readonly numBands: number
  readonly centersHz: Float64Array
  private readonly starts: Int32Array
  private readonly weights: Float64Array[]

  constructor(
    numBands: number = NUM_MEL_BANDS,
    fftSize: number = FFT_SIZE,
    sampleRate: number = SAMPLE_RATE,
    fMin = 60,
    fMax = 8000,
  ) {
    this.numBands = numBands
    this.starts = new Int32Array(numBands)
    this.weights = []
    this.centersHz = new Float64Array(numBands)
    const binHz = sampleRate / fftSize
    const nBins = fftSize / 2 + 1
    const mMin = hzToMel(fMin)
    const mMax = hzToMel(Math.min(fMax, sampleRate / 2))
    const edges: number[] = []
    for (let i = 0; i < numBands + 2; i++) edges.push(melToHz(mMin + ((mMax - mMin) * i) / (numBands + 1)))
    for (let b = 0; b < numBands; b++) {
      const lo = edges[b]
      const c = edges[b + 1]
      const hi = edges[b + 2]
      this.centersHz[b] = c
      const k0 = Math.max(0, Math.floor(lo / binHz))
      const k1 = Math.min(nBins - 1, Math.ceil(hi / binHz))
      const w = new Float64Array(k1 - k0 + 1)
      let total = 0
      for (let k = k0; k <= k1; k++) {
        const f = k * binHz
        const v = f <= c ? (f - lo) / (c - lo) : (hi - f) / (hi - c)
        w[k - k0] = v > 0 ? v : 0
        total += w[k - k0]
      }
      if (total === 0) w[Math.min(w.length - 1, Math.max(0, Math.round(c / binHz) - k0))] = 1
      this.starts[b] = k0
      this.weights.push(w)
    }
  }

  /** Linear mel energies from a power spectrum. */
  apply(power: Float64Array, out: Float32Array | Float64Array): void {
    for (let b = 0; b < this.numBands; b++) {
      const w = this.weights[b]
      const k0 = this.starts[b]
      let s = 0
      for (let i = 0; i < w.length; i++) s += w[i] * power[k0 + i]
      out[b] = s
    }
  }
}

/**
 * Log-mel → 0..1 for display. A fixed dB window ([-80, -20] dB re full-scale sine)
 * instead of per-frame normalisation keeps the picture stable: a quiet room
 * (−65…−55 dBFS) maps to 0–0.2, a cough peaking around −18 dBFS lights its
 * explosive phase up to 0.7–0.8 (≈ 1.0 when close to the mic), and nothing
 * "pumps" when the level changes.
 */
export function melToUnit(melPower: ArrayLike<number>, out: Float32Array): void {
  const span = MEL_DB_CEIL - MEL_DB_FLOOR
  for (let b = 0; b < out.length; b++) {
    const db = 10 * Math.log10(melPower[b] + 1e-12)
    const u = (db - MEL_DB_FLOOR) / span
    out[b] = u < 0 ? 0 : u > 1 ? 1 : u
  }
}

// ---------------------------------------------------------------------------
// Streaming resampler
// ---------------------------------------------------------------------------

/**
 * Arbitrary-ratio streaming resampler (e.g. 48000 / 44100 → 16000).
 *
 * Band-limited interpolation: each output sample is a dot product with a
 * Blackman-windowed sinc whose cutoff sits at 0.92 × the lower Nyquist, i.e.
 * the anti-aliasing low-pass and the interpolation are one filter. The kernel
 * is tabulated (linear interpolation between table points), so there are no
 * trig calls per tap. Cost at 48 → 16 kHz: ~50 MACs per output sample.
 */
export class Resampler {
  readonly inRate: number
  readonly outRate: number
  private readonly step: number // input samples per output sample
  private readonly halfWidth: number // kernel half-width in input samples
  private readonly table: Float64Array
  private readonly tableRes: number // table points per input sample
  private buf: Float64Array
  private bufLen = 0
  /** Position of the next output sample, in input samples relative to buf[0]. */
  private pos: number

  constructor(inRate: number, outRate: number = SAMPLE_RATE, zeroCrossings = 8) {
    this.inRate = inRate
    this.outRate = outRate
    this.step = inRate / outRate
    const fc = Math.min(1, outRate / inRate) * 0.92 // cutoff as a fraction of the input Nyquist
    this.halfWidth = Math.ceil(zeroCrossings / fc)
    this.tableRes = 64
    const n = this.halfWidth * this.tableRes + 2
    this.table = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const t = i / this.tableRes // distance in input samples
      const x = fc * t
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const u = t / this.halfWidth // 0..1 across the half-window
      const win = u >= 1 ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * u) + 0.08 * Math.cos(2 * Math.PI * u)
      this.table[i] = fc * sinc * win
    }
    this.buf = new Float64Array(4096)
    // Start with half a kernel of (virtual) silence so output is aligned with input t=0.
    this.bufLen = this.halfWidth
    this.pos = this.halfWidth
  }

  reset(): void {
    this.buf.fill(0)
    this.bufLen = this.halfWidth
    this.pos = this.halfWidth
  }

  private kernel(d: number): number {
    const a = Math.abs(d) * this.tableRes
    const i = a | 0
    if (i >= this.table.length - 1) return 0
    const f = a - i
    return this.table[i] + (this.table[i + 1] - this.table[i]) * f
  }

  /** Feed a chunk at `inRate`; returns all output samples that are now computable. */
  process(input: Float32Array): Float32Array {
    if (this.inRate === this.outRate) return input.slice()
    const need = this.bufLen + input.length
    if (need > this.buf.length) {
      let size = this.buf.length
      while (size < need) size *= 2
      const nb = new Float64Array(size)
      nb.set(this.buf.subarray(0, this.bufLen))
      this.buf = nb
    }
    this.buf.set(input, this.bufLen)
    this.bufLen += input.length

    const hw = this.halfWidth
    const maxOut = Math.max(0, Math.floor((this.bufLen - hw - this.pos) / this.step) + 1)
    const out = new Float32Array(maxOut)
    let n = 0
    const buf = this.buf
    while (this.pos + hw < this.bufLen && n < maxOut) {
      const p = this.pos
      const center = Math.floor(p)
      let acc = 0
      const k0 = center - hw + 1
      const k1 = center + hw
      for (let k = k0; k <= k1; k++) acc += buf[k] * this.kernel(p - k)
      out[n++] = acc
      this.pos += this.step
    }
    // Drop consumed input, keeping `hw` samples of left context.
    const keepFrom = Math.max(0, Math.floor(this.pos) - hw)
    if (keepFrom > 0) {
      buf.copyWithin(0, keepFrom, this.bufLen)
      this.bufLen -= keepFrom
      this.pos -= keepFrom
    }
    return n === out.length ? out : out.subarray(0, n)
  }
}

/** One-shot convenience wrapper around `Resampler` (used for decoded files). */
export function resample(input: Float32Array, inRate: number, outRate: number = SAMPLE_RATE): Float32Array {
  if (inRate === outRate) return input.slice()
  const r = new Resampler(inRate, outRate)
  const body = r.process(input)
  // Flush the kernel's right half with silence.
  const tail = r.process(new Float32Array(Math.ceil(r.inRate / r.outRate) * 64))
  const total = Math.round((input.length * outRate) / inRate)
  const out = new Float32Array(total)
  out.set(body.subarray(0, Math.min(total, body.length)))
  if (body.length < total) out.set(tail.subarray(0, total - body.length), body.length)
  return out
}
