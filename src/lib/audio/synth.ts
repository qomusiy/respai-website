/**
 * Demo sound synthesis (mono Float32Array at any sample rate).
 *
 * Every call is randomised (pass a seeded `rng` for reproducible tests), so
 * repeated clicks on "play cough" never sound like the same loop.
 *
 *  - cough: explosive broadband burst (~5 ms attack, 30–50 ms) → turbulent,
 *    formant-shaped intermediate phase (100–250 ms, exponential decay, a bit of
 *    roughness) → optional short voiced tail (jittery glottal pulses, 150–250 Hz)
 *    → light synthetic room (Schroeder reverb).
 *  - double-cough: two coughs 250–400 ms apart (a short bout).
 *  - speech: vowel-like voiced syllables with formant transitions, plosive and
 *    fricative onsets, syllabic amplitude modulation and pitch declination.
 *  - clap: 2–3 hand claps (very short, multi-burst, band-passed).
 *  - noise: desk fan — pink + brown noise, blade-pass hum, slow fades.
 *
 * Everything is peak-normalised to about −3 dBFS.
 */

import type { SampleKind } from './types'

export type Rng = () => number

/** Small, fast, seedable PRNG (for reproducible tests). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const uni = (rng: Rng, a: number, b: number) => a + (b - a) * rng()

function gaussian(rng: Rng): number {
  let u = rng()
  if (u < 1e-12) u = 1e-12
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

function whiteNoise(n: number, rng: Rng): Float32Array {
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = gaussian(rng)
  return x
}

const dbToGain = (db: number) => Math.pow(10, db / 20)

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

type BiquadType = 'bandpass' | 'highpass' | 'lowpass'

/** RBJ-cookbook biquad applied in place (bandpass = constant 0 dB peak gain). */
function biquad(x: Float32Array, sr: number, type: BiquadType, f: number, q: number): Float32Array {
  const w0 = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr
  const cw = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  let b0: number
  let b1: number
  let b2: number
  if (type === 'bandpass') {
    b0 = alpha
    b1 = 0
    b2 = -alpha
  } else if (type === 'highpass') {
    b0 = (1 + cw) / 2
    b1 = -(1 + cw)
    b2 = (1 + cw) / 2
  } else {
    b0 = (1 - cw) / 2
    b1 = 1 - cw
    b2 = (1 - cw) / 2
  }
  const a0 = 1 + alpha
  const a1 = (-2 * cw) / a0
  const a2 = (1 - alpha) / a0
  b0 /= a0
  b1 /= a0
  b2 /= a0
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    x2 = x1
    x1 = xi
    y2 = y1
    y1 = y
    x[i] = y
  }
  return x
}

/** Klatt-style two-pole formant resonator (unity DC gain) with mutable state. */
class Resonator {
  private a = 1
  private b = 0
  private c = 0
  private y1 = 0
  private y2 = 0
  private readonly sr: number

  constructor(sr: number, f: number, bw: number) {
    this.sr = sr
    this.set(f, bw)
  }

  set(f: number, bw: number): void {
    const T = 1 / this.sr
    this.c = -Math.exp(-2 * Math.PI * bw * T)
    this.b = 2 * Math.exp(-Math.PI * bw * T) * Math.cos(2 * Math.PI * Math.min(f, this.sr * 0.45) * T)
    this.a = 1 - this.b - this.c
  }

  tick(x: number): number {
    const y = this.a * x + this.b * this.y1 + this.c * this.y2
    this.y2 = this.y1
    this.y1 = y
    return y
  }
}

function rms(x: Float32Array, from = 0, to = x.length): number {
  let s = 0
  for (let i = from; i < to; i++) s += x[i] * x[i]
  return Math.sqrt(s / Math.max(1, to - from))
}

function scaleTo(x: Float32Array, targetRms: number): Float32Array {
  const r = rms(x)
  if (r > 0) {
    const g = targetRms / r
    for (let i = 0; i < x.length; i++) x[i] *= g
  }
  return x
}

/** Peak-normalise in place (default −3 dBFS). */
export function normalizePeak(x: Float32Array, peakDb = -3): Float32Array {
  let peak = 0
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]))
  if (peak > 0) {
    const g = dbToGain(peakDb) / peak
    for (let i = 0; i < x.length; i++) x[i] *= g
  }
  return x
}

/**
 * Light Schroeder room: 4 damped feedback combs + 2 allpasses, with pre-delay.
 * Returns a new array that includes the reverb tail.
 */
function addRoom(dry: Float32Array, sr: number, rng: Rng, wet: number, rt60: number): Float32Array {
  if (wet <= 0) return dry
  const tail = Math.round(rt60 * sr)
  const n = dry.length + tail
  const out = new Float32Array(n)
  const wetSig = new Float32Array(n)
  const size = uni(rng, 0.8, 1.2)
  const combMs = [29.7, 37.1, 41.1, 43.7]
  const damp = uni(rng, 0.2, 0.4)
  for (const ms of combMs) {
    const d = Math.max(1, Math.round((ms * size * sr) / 1000))
    const g = Math.pow(10, (-3 * (d / sr)) / rt60)
    const buf = new Float32Array(d)
    let idx = 0
    let lp = 0
    for (let i = 0; i < n; i++) {
      const xin = i < dry.length ? dry[i] : 0
      const y = buf[idx]
      lp = y * (1 - damp) + lp * damp
      buf[idx] = xin + lp * g
      idx = idx + 1 === d ? 0 : idx + 1
      wetSig[i] += y
    }
  }
  for (const ms of [5.0, 1.7]) {
    const d = Math.max(1, Math.round((ms * sr) / 1000))
    const buf = new Float32Array(d)
    let idx = 0
    const g = 0.7
    for (let i = 0; i < n; i++) {
      const bufOut = buf[idx]
      const v = wetSig[i] + g * bufOut
      buf[idx] = v
      wetSig[i] = bufOut - g * v
      idx = idx + 1 === d ? 0 : idx + 1
    }
  }
  const pre = Math.round(uni(rng, 0.005, 0.015) * sr)
  const gain = (wet * rms(dry)) / Math.max(1e-9, rms(wetSig, 0, dry.length))
  for (let i = 0; i < n; i++) {
    const w = i - pre >= 0 ? wetSig[i - pre] * gain : 0
    out[i] = (i < dry.length ? dry[i] : 0) + w
  }
  return out
}

function withPadding(x: Float32Array, sr: number, preSec: number, postSec: number): Float32Array {
  const pre = Math.round(preSec * sr)
  const out = new Float32Array(pre + x.length + Math.round(postSec * sr))
  out.set(x, pre)
  return out
}

// ---------------------------------------------------------------------------
// Glottal source
// ---------------------------------------------------------------------------

/**
 * Differentiated Rosenberg glottal pulse train following `f0At(i)` (Hz),
 * with per-period jitter (period perturbation) and shimmer (amplitude).
 */
function glottalTrain(n: number, sr: number, rng: Rng, f0At: (i: number) => number, jitter: number, shimmer: number): Float32Array {
  const out = new Float32Array(n)
  let i = 0
  let prev = 0
  while (i < n) {
    const f0 = Math.max(50, f0At(i))
    const T = Math.max(8, Math.round((sr / f0) * (1 + jitter * gaussian(rng))))
    const amp = 1 + shimmer * gaussian(rng)
    const tp = 0.4 * T
    const tn = 0.16 * T
    for (let k = 0; k < T && i < n; k++, i++) {
      let g = 0
      if (k < tp) g = 0.5 * (1 - Math.cos((Math.PI * k) / tp))
      else if (k < tp + tn) g = Math.cos((Math.PI * (k - tp)) / (2 * tn))
      g *= amp
      out[i] = g - prev // lip radiation ≈ differentiation
      prev = g
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Cough
// ---------------------------------------------------------------------------

export interface CoughParams {
  /** Rise time of the explosive burst, ms (default 3–7) */
  attackMs?: number
  /** Explosive phase length, ms (default 30–50) */
  explosiveMs?: number
  /** Intermediate (turbulent) phase length, ms (default 100–250) */
  intermediateMs?: number
  /** Voiced tail length, ms; 0 disables (default: 55 % chance of 60–150 ms) */
  voicedMs?: number
  /** Voiced tail level relative to the explosive peak, dB (default −20..−14) */
  voicedLevelDb?: number
  /** Voiced tail pitch, Hz (default 150–250) */
  f0?: number
  /** Vocal-tract formants F1..F3, Hz (default ≈ open /a/–/ə/ region, randomised) */
  formants?: [number, number, number]
  /** Weight of the unshaped broadband component, 0..1 (default 0.35–0.6) */
  broadband?: number
  /** Low "chest" thump level relative to the burst, dB (default −10..−4) */
  chestDb?: number
  /** Reverb wet level (0 = dry; default 0.12–0.22) */
  reverb?: number
  /** Reverb RT60, s (default 0.25–0.45) */
  rt60?: number
}

/** One dry cough (no padding, no reverb, not normalised). */
function coughCore(sr: number, rng: Rng, p: CoughParams): Float32Array {
  const A = (p.attackMs ?? uni(rng, 3, 7)) / 1000
  const E = (p.explosiveMs ?? uni(rng, 30, 50)) / 1000
  const I = (p.intermediateMs ?? uni(rng, 100, 250)) / 1000
  const V = (p.voicedMs ?? (rng() < 0.55 ? uni(rng, 60, 150) : 0)) / 1000
  const fm = p.formants ?? [uni(rng, 450, 850), uni(rng, 1100, 1800), uni(rng, 2300, 3100)]
  const broadband = p.broadband ?? uni(rng, 0.35, 0.6)
  const chest = dbToGain(p.chestDb ?? uni(rng, -10, -4))

  const voicedStart = E + I * uni(rng, 0.55, 0.8)
  const total = Math.max(E + I, V > 0 ? voicedStart + V : 0) + 0.02
  const n = Math.round(total * sr)

  // Explosive burst: broadband turbulence (gentle high-pass) + low chest resonance.
  const burst = biquad(biquad(whiteNoise(n, rng), sr, 'highpass', uni(rng, 150, 250), 0.7), sr, 'lowpass', uni(rng, 5500, 7500), 0.7)
  scaleTo(burst, 1)
  const thump = scaleTo(biquad(whiteNoise(n, rng), sr, 'bandpass', uni(rng, 140, 260), 1.2), chest)

  // Turbulent airflow shaped by the vocal tract: parallel formant band-passes.
  const src = whiteNoise(n, rng)
  const tract = new Float32Array(n)
  const gains = [1, uni(rng, 0.5, 0.8), uni(rng, 0.25, 0.45)]
  const qs = [uni(rng, 3, 5), uni(rng, 5, 8), uni(rng, 6, 10)]
  for (let f = 0; f < 3; f++) {
    const b = biquad(src.slice(), sr, 'bandpass', fm[f], qs[f])
    scaleTo(b, gains[f])
    for (let i = 0; i < n; i++) tract[i] += b[i]
  }
  scaleTo(tract, 1)
  const broad = biquad(whiteNoise(n, rng), sr, 'highpass', 300, 0.7)
  scaleTo(broad, 1)

  // Roughness: slow irregular amplitude modulation (25–60 Hz) of the turbulent phase.
  const rough = biquad(whiteNoise(n, rng), sr, 'lowpass', uni(rng, 25, 60), 0.7)
  scaleTo(rough, uni(rng, 0.15, 0.35))

  const out = new Float32Array(n)
  const tauE = (E - A) / Math.log(dbToGain(8)) // burst falls ~8 dB by the end of the explosive phase
  const tauI = I / Math.log(dbToGain(26)) // turbulent phase decays ~26 dB over its length
  const interLevel = dbToGain(uni(rng, -7, -4))
  for (let i = 0; i < n; i++) {
    const t = i / sr
    // Explosive envelope: raised-cosine attack, exponential fall, then fast release.
    let eb: number
    if (t < A) eb = 0.5 - 0.5 * Math.cos((Math.PI * t) / A)
    else if (t < E) eb = Math.exp(-(t - A) / tauE)
    else eb = Math.exp(-(E - A) / tauE) * Math.exp(-(t - E) / 0.008)
    // Intermediate envelope: fades in under the burst, then decays exponentially.
    let ei: number
    if (t < A) ei = 0
    else if (t < E) ei = interLevel * ((t - A) / (E - A))
    else ei = interLevel * Math.exp(-(t - E) / tauI)
    const fadeOut = t > E + I ? Math.max(0, 1 - (t - E - I) / 0.03) : 1
    ei *= fadeOut * (1 + rough[i])
    const shaped = (1 - broadband) * tract[i] + broadband * broad[i]
    out[i] = eb * (burst[i] * 0.7 + tract[i] * 0.5 + thump[i]) + ei * shaped
  }

  if (V > 0) {
    // Short voiced tail: the glottis closes and briefly vibrates.
    const f0 = p.f0 ?? uni(rng, 150, 250)
    const vs = Math.round(voicedStart * sr)
    const vn = Math.min(n - vs, Math.round(V * sr))
    const glottal = glottalTrain(vn, sr, rng, (i) => f0 * (1 - 0.15 * (i / vn)), 0.03, 0.12)
    const r = [
      new Resonator(sr, fm[0], 90),
      new Resonator(sr, fm[1], 120),
      new Resonator(sr, fm[2], 160),
      new Resonator(sr, 3600, 250),
    ]
    const voiced = new Float32Array(vn)
    for (let i = 0; i < vn; i++) {
      let s = glottal[i]
      for (const res of r) s = res.tick(s)
      voiced[i] = s
    }
    scaleTo(voiced, 1)
    const level = dbToGain(p.voicedLevelDb ?? uni(rng, -20, -14))
    const fin = 0.02 * sr
    const fout = 0.04 * sr
    for (let i = 0; i < vn; i++) {
      const env = Math.min(1, i / fin, (vn - i) / fout)
      out[vs + i] += voiced[i] * level * env
    }
  }
  return out
}

/** A single randomised cough (padded, with room, −3 dBFS peak). */
export function synthCough(sr: number, rng: Rng = Math.random, params: CoughParams = {}): Float32Array {
  const core = coughCore(sr, rng, params)
  const roomed = addRoom(core, sr, rng, params.reverb ?? uni(rng, 0.12, 0.22), params.rt60 ?? uni(rng, 0.25, 0.45))
  return normalizePeak(withPadding(roomed, sr, 0.15, 0.3))
}

/** Two coughs 250–400 ms apart (onset to onset). */
export function synthDoubleCough(sr: number, rng: Rng = Math.random, params: CoughParams = {}): Float32Array {
  const gap = uni(rng, 0.25, 0.4)
  // In a bout the first cough is cut short by the next inhalation.
  const first = coughCore(sr, rng, { ...params, intermediateMs: params.intermediateMs ?? uni(rng, 90, (gap - 0.09) * 1000), voicedMs: 0 })
  const second = coughCore(sr, rng, params)
  const off = Math.round(gap * sr)
  const sum = new Float32Array(Math.max(first.length, off + second.length))
  const g2 = dbToGain(uni(rng, -4, 0))
  for (let i = 0; i < first.length; i++) sum[i] += first[i]
  for (let i = 0; i < second.length; i++) sum[off + i] += second[i] * g2
  const roomed = addRoom(sum, sr, rng, params.reverb ?? uni(rng, 0.12, 0.22), params.rt60 ?? uni(rng, 0.25, 0.45))
  return normalizePeak(withPadding(roomed, sr, 0.15, 0.3))
}

// ---------------------------------------------------------------------------
// Speech
// ---------------------------------------------------------------------------

const VOWELS: Array<[number, number, number]> = [
  [730, 1090, 2440], // a
  [530, 1840, 2480], // e
  [300, 2250, 3000], // i
  [570, 840, 2410], // o
  [320, 900, 2250], // u
  [500, 1500, 2500], // ə
]

/** ~1.5 s of vowel-like "speech": voiced syllables with consonant onsets. */
export function synthSpeech(sr: number, rng: Rng = Math.random): Float32Array {
  const female = rng() < 0.5
  const base = female ? uni(rng, 175, 235) : uni(rng, 100, 140)
  const durSec = uni(rng, 1.35, 1.65)
  const n = Math.round(durSec * sr)

  // Per-sample control tracks.
  const amp = new Float32Array(n)
  const f1 = new Float32Array(n)
  const f2 = new Float32Array(n)
  const f3 = new Float32Array(n)
  const accent = new Float32Array(n)
  const noise = new Float32Array(n)

  let t = uni(rng, 0.02, 0.06)
  let prev = VOWELS[Math.floor(rng() * VOWELS.length)]
  while (t < durSec - 0.15) {
    const v = VOWELS[Math.floor(rng() * VOWELS.length)]
    const syl = uni(rng, 0.13, 0.26)
    const start = Math.round(t * sr)
    const end = Math.min(n, Math.round((t + syl) * sr))
    const peak = uni(rng, 0.6, 1)
    const rise = uni(rng, 0.025, 0.045) * sr
    const fall = uni(rng, 0.04, 0.07) * sr
    const trans = 0.05 * sr
    const acc = rng() < 0.35 ? uni(rng, 1.08, 1.22) : 1
    for (let i = start; i < end; i++) {
      const k = i - start
      const e = Math.min(1, k / rise, (end - i) / fall)
      amp[i] = Math.max(amp[i], peak * (0.5 - 0.5 * Math.cos(Math.PI * e)))
      const m = Math.min(1, k / trans)
      f1[i] = prev[0] + (v[0] - prev[0]) * m
      f2[i] = prev[1] + (v[1] - prev[1]) * m
      f3[i] = prev[2] + (v[2] - prev[2]) * m
      accent[i] = acc
    }
    // Consonant onset (realistic, and a fair challenge for the detector).
    const c = rng()
    if (c < 0.3) {
      // Plosive release: short burst + aspiration right before voicing.
      const bl = Math.round(uni(rng, 0.006, 0.014) * sr)
      const asp = Math.round(uni(rng, 0.01, 0.03) * sr)
      const b0 = Math.max(0, start - bl - asp)
      const burst = biquad(whiteNoise(bl + asp, rng), sr, 'highpass', uni(rng, 1200, 3000), 0.7)
      scaleTo(burst, peak * dbToGain(uni(rng, -14, -8)))
      for (let i = 0; i < bl + asp && b0 + i < n; i++) {
        const env = i < bl ? Math.exp(-i / (0.004 * sr)) : 0.25 * Math.exp(-(i - bl) / (0.012 * sr))
        noise[b0 + i] += burst[i] * env
      }
    } else if (c < 0.5) {
      // Fricative (/s/, /ʃ/) leading into the vowel.
      const fl = Math.round(uni(rng, 0.05, 0.1) * sr)
      const f0 = Math.max(0, start - Math.round(fl * 0.7))
      const fc = rng() < 0.5 ? uni(rng, 4500, 6500) : uni(rng, 2500, 3800)
      const fr = biquad(whiteNoise(fl, rng), sr, 'bandpass', fc, 1.5)
      scaleTo(fr, peak * dbToGain(uni(rng, -20, -13)))
      for (let i = 0; i < fl && f0 + i < n; i++) noise[f0 + i] += fr[i] * Math.sin((Math.PI * i) / fl)
    }
    prev = v
    t += syl + (rng() < 0.25 ? uni(rng, 0.12, 0.22) : uni(rng, 0.02, 0.07))
  }

  const f0At = (i: number) => base * (1.1 - 0.2 * (i / n)) * (accent[i] || 1) * (1 + 0.02 * Math.sin((2 * Math.PI * 5.5 * i) / sr))
  const glottal = glottalTrain(n, sr, rng, f0At, 0.012, 0.06)
  const asp = biquad(whiteNoise(n, rng), sr, 'highpass', 1500, 0.7) // breathiness
  scaleTo(asp, rms(glottal) * 0.08)
  const r = [new Resonator(sr, 500, 80), new Resonator(sr, 1500, 100), new Resonator(sr, 2500, 140), new Resonator(sr, 3500, 220)]
  const voiced = new Float32Array(n)
  const block = 32
  for (let i = 0; i < n; i++) {
    if (i % block === 0) {
      r[0].set(f1[i] || 500, 80)
      r[1].set(f2[i] || 1500, 100)
      r[2].set(f3[i] || 2500, 140)
    }
    let s = (glottal[i] + asp[i]) * amp[i]
    for (const res of r) s = res.tick(s)
    voiced[i] = s
  }
  scaleTo(voiced, 0.25)
  // Noise (consonants) is defined relative to the syllable peak (≈ voiced peak).
  let vPeak = 0
  for (let i = 0; i < n; i++) vPeak = Math.max(vPeak, Math.abs(voiced[i]))
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = voiced[i] + noise[i] * vPeak * 0.9
  const roomed = addRoom(out, sr, rng, uni(rng, 0.08, 0.15), uni(rng, 0.25, 0.4))
  return normalizePeak(withPadding(roomed, sr, 0.1, 0.25))
}

// ---------------------------------------------------------------------------
// Claps
// ---------------------------------------------------------------------------

/** 2–3 hand claps: a few micro-bursts each, band-passed around 1–2.2 kHz. */
export function synthClaps(sr: number, rng: Rng = Math.random): Float32Array {
  const count = rng() < 0.5 ? 2 : 3
  const spacing = uni(rng, 0.2, 0.38)
  const n = Math.round((spacing * count + 0.15) * sr)
  const out = new Float32Array(n)
  for (let c = 0; c < count; c++) {
    const t0 = Math.round((c * spacing + uni(rng, -0.015, 0.015) + 0.01) * sr)
    const len = Math.round(0.06 * sr)
    const x = whiteNoise(len, rng)
    const bursts = 3 + Math.floor(rng() * 2)
    const env = new Float32Array(len)
    let bt = 0
    for (let b = 0; b < bursts; b++) {
      const amp = b === bursts - 1 ? 1 : uni(rng, 0.4, 0.8)
      const tau = (b === bursts - 1 ? uni(rng, 0.006, 0.011) : uni(rng, 0.0012, 0.0025)) * sr
      const s = Math.round(bt)
      for (let i = s; i < len; i++) env[i] = Math.max(env[i], amp * Math.exp(-(i - s) / tau))
      bt += uni(rng, 0.0008, 0.002) * sr
    }
    for (let i = 0; i < len; i++) x[i] *= env[i]
    biquad(x, sr, 'bandpass', uni(rng, 1000, 2200), uni(rng, 1.2, 2))
    biquad(x, sr, 'highpass', 300, 0.7)
    const g = uni(rng, 0.7, 1)
    for (let i = 0; i < len && t0 + i < n; i++) out[t0 + i] += x[i] * g
  }
  const roomed = addRoom(out, sr, rng, uni(rng, 0.12, 0.25), uni(rng, 0.3, 0.5))
  return normalizePeak(withPadding(roomed, sr, 0.15, 0.2))
}

// ---------------------------------------------------------------------------
// Fan / background noise
// ---------------------------------------------------------------------------

/** Desk fan: pink + brown noise, blade-pass hum with harmonics, slow wobble, soft fades. */
export function synthFanNoise(sr: number, rng: Rng = Math.random, seconds = 1.5): Float32Array {
  const n = Math.round(seconds * sr)
  const out = new Float32Array(n)
  // Pink noise (Paul Kellet's economy filter) + leaky-integrated brown noise.
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let brown = 0
  const blade = uni(rng, 90, 160)
  const wobbleHz = uni(rng, 2, 6)
  const humLevel = uni(rng, 0.04, 0.1)
  let ph = rng() * 2 * Math.PI
  for (let i = 0; i < n; i++) {
    const w = gaussian(rng)
    b0 = 0.99765 * b0 + w * 0.099046
    b1 = 0.963 * b1 + w * 0.2965164
    b2 = 0.57 * b2 + w * 1.0526913
    const pink = (b0 + b1 + b2 + w * 0.1848) * 0.11
    brown = 0.995 * brown + w * 0.02
    const wob = 1 + 0.08 * Math.sin((2 * Math.PI * wobbleHz * i) / sr)
    ph += (2 * Math.PI * blade * (1 + 0.004 * Math.sin((2 * Math.PI * 0.7 * i) / sr))) / sr
    const hum = Math.sin(ph) + 0.5 * Math.sin(2 * ph + 0.3) + 0.25 * Math.sin(3 * ph + 1.1)
    out[i] = (pink + brown * 0.6) * wob + hum * humLevel
  }
  biquad(out, sr, 'lowpass', uni(rng, 5000, 7000), 0.7)
  biquad(out, sr, 'highpass', 40, 0.7)
  const fade = Math.round(0.25 * sr)
  for (let i = 0; i < fade && i < n; i++) {
    const g = 0.5 - 0.5 * Math.cos((Math.PI * i) / fade)
    out[i] *= g
    out[n - 1 - i] *= g
  }
  return normalizePeak(withPadding(out, sr, 0.1, 0.2))
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Synthesize one demo sound at `sampleRate` (mono, −3 dBFS peak, padded with silence). */
export function synthesize(kind: SampleKind, sampleRate: number, rng: Rng = Math.random): Float32Array {
  switch (kind) {
    case 'cough':
      return synthCough(sampleRate, rng)
    case 'double-cough':
      return synthDoubleCough(sampleRate, rng)
    case 'speech':
      return synthSpeech(sampleRate, rng)
    case 'clap':
      return synthClaps(sampleRate, rng)
    case 'noise':
      return synthFanNoise(sampleRate, rng)
  }
}

/** How many coughs a sample contains (ground truth for UI hints and tests). */
export function expectedCoughs(kind: SampleKind): number {
  return kind === 'cough' ? 1 : kind === 'double-cough' ? 2 : 0
}

/** Wrap mono samples in an AudioBuffer. */
export function toAudioBuffer(ctx: BaseAudioContext, data: Float32Array, sampleRate: number = ctx.sampleRate): AudioBuffer {
  const buf = ctx.createBuffer(1, data.length, sampleRate)
  buf.getChannelData(0).set(data)
  return buf
}
