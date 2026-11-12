import { create } from 'zustand'
import type { CoughDetection, EngineInfo, EngineState } from './audio/types'

export type OledMode = 'status' | 'alert' | 'reminder' | 'air' | 'boot' | 'privacy'

/**
 * High-frequency mutable state shared by the 3D scene, OLED renderer and canvases.
 * Never put this in React state — it changes 60 times per second.
 */
export const live = {
  level: 0,
  prob: 0,
  label: 'silence' as 'cough' | 'noise' | 'silence',
  /** last time real audio frames arrived (performance.now) */
  lastFrameAt: -1e9,
  /** cough flash 0..1, decays in the render loop */
  flash: 0,
  coughCount: 0,
  lastCoughProb: 0,
  levelHistory: new Float32Array(64),
  // environment (updated by telemetry)
  temp: 26.8,
  hum: 35,
  mq6: 0.0,
  wifi: true,
  fb: true,
  // OLED
  oledMode: 'status' as OledMode,
  oledOverride: null as OledMode | null,
  oledOverrideUntil: 0,
  reminderText: 'MEDICINE',
  reminderTime: '08:00',
}

export function setOledOverride(mode: OledMode, ms: number) {
  live.oledOverride = mode
  live.oledOverrideUntil = performance.now() + ms
}

export interface TelemetrySample {
  t: number
  temp: number
  hum: number
  mq6: number
  /** gas estimates (ppm) derived from MQ-6 */
  lpg: number
  methane: number
  propane: number
  butane: number
  coughs: number
}

interface AppState {
  engineState: EngineState
  engineError?: string
  engineInfo?: EngineInfo
  consent: boolean
  consentOpen: boolean
  coughs: CoughDetection[]
  telemetry: TelemetrySample[]
  telemetrySource: 'simulated' | 'live' | 'connecting'
  heroIndex: number
  setEngineState: (s: EngineState, err?: string) => void
  setEngineInfo: (i: EngineInfo) => void
  setConsent: (v: boolean) => void
  setConsentOpen: (v: boolean) => void
  addCough: (c: CoughDetection) => void
  resetCoughs: () => void
  pushTelemetry: (s: TelemetrySample, source: 'simulated' | 'live') => void
  setHeroIndex: (i: number) => void
}

export const useApp = create<AppState>((set) => ({
  engineState: 'idle',
  consent: false,
  consentOpen: false,
  coughs: [],
  telemetry: [],
  telemetrySource: 'connecting',
  heroIndex: 0,
  setEngineState: (engineState, engineError) => set({ engineState, engineError }),
  setEngineInfo: (engineInfo) => set({ engineInfo }),
  setConsent: (consent) => set({ consent }),
  setConsentOpen: (consentOpen) => set({ consentOpen }),
  addCough: (c) =>
    set((s) => {
      live.coughCount = s.coughs.length + 1
      live.lastCoughProb = c.prob
      live.flash = 1
      setOledOverride('alert', 1800)
      return { coughs: [c, ...s.coughs].slice(0, 200) }
    }),
  resetCoughs: () => {
    live.coughCount = 0
    set({ coughs: [] })
  },
  pushTelemetry: (sample, source) =>
    set((s) => {
      live.temp = sample.temp
      live.hum = sample.hum
      live.mq6 = sample.mq6
      return { telemetry: [...s.telemetry, sample].slice(-90), telemetrySource: source }
    }),
  setHeroIndex: (heroIndex) => set({ heroIndex }),
}))
