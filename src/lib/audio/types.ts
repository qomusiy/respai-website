/**
 * Shared contract between the audio/AI engine and the UI.
 * The UI only imports from this file and from `engine.ts` (RespEngine).
 */

export type EngineKind = 'edge-impulse' | 'acoustic'

export type AudioSource = 'mic' | 'sample' | 'file'

export type SampleKind = 'cough' | 'double-cough' | 'speech' | 'clap' | 'noise'

/** Emitted ~60 times per second while audio is flowing (mic or sample playback). */
export interface AnalysisFrame {
  /** performance.now() timestamp, ms */
  t: number
  /** Smoothed RMS level mapped to 0..1 for visuals (≈ -70 dBFS → 0, ≈ -10 dBFS → 1) */
  level: number
  /** Instantaneous RMS in dBFS (negative number, e.g. -42) */
  db: number
  /** Latest log-mel column, NUM_MEL_BANDS values normalized to 0..1 (index 0 = lowest frequency) */
  mel: Float32Array
  /** Latest time-domain samples for an oscilloscope view (length 1024, -1..1) */
  waveform: Float32Array
  /** Current cough probability from the active engine, 0..1 */
  prob: number
  /** Current top label from the active engine */
  label: 'cough' | 'noise' | 'silence'
}

export interface CoughDetection {
  id: number
  /** performance.now() ms when the cough was confirmed */
  t: number
  /** Wall-clock Date.now() for logs */
  wallTime: number
  /** Peak cough probability during the event, 0..1 */
  prob: number
  durationMs: number
  peakDb: number
  /** Spectral centroid at the explosive phase, Hz */
  centroidHz: number
  /** Time from onset to energy peak, ms */
  attackMs: number
  source: AudioSource
}

export interface FileAnalysis {
  durationSec: number
  /** Downsampled absolute envelope (~600 points, 0..1) for drawing the file timeline */
  envelope: Float32Array
  /** Cough events with `offsetSec` = position inside the file */
  detections: Array<CoughDetection & { offsetSec: number }>
}

export type EngineState = 'idle' | 'loading' | 'listening' | 'playing' | 'error'

export interface EngineInfo {
  kind: EngineKind
  /** Human label, e.g. "RespAI Edge Impulse model (WebAssembly)" or "Acoustic preview engine" */
  name: string
  /** Model sample rate in Hz (16000 for EI audio projects) */
  sampleRate: number
  /** Classification window in ms */
  windowMs: number
  labels: string[]
}

export interface EngineEvents {
  frame: (f: AnalysisFrame) => void
  cough: (d: CoughDetection) => void
  state: (s: EngineState, error?: string) => void
}

export const NUM_MEL_BANDS = 40
