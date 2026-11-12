import { useApp, live, type TelemetrySample } from './live'

/**
 * Device telemetry for the "Air quality" section — no backend required.
 *
 * Default: a realistic in-browser simulation (labelled "Simulated feed").
 * Optional live mode: set VITE_FIREBASE_DB_URL and VITE_FIREBASE_PATH at build time to poll
 * the Firebase Realtime Database node your ESP32 already writes to (the node must allow
 * public reads in your database rules). See README.
 */

const FIREBASE_URL = (import.meta.env.VITE_FIREBASE_DB_URL as string | undefined)?.replace(/\/$/, '')
const FIREBASE_PATH = (import.meta.env.VITE_FIREBASE_PATH as string | undefined)?.replace(/^\/|\/$/g, '')

let started = false

export function gasFromMq6(mq6: number) {
  // Rough split of the MQ-6 reading into the gases the app shows (demo calibration).
  return {
    lpg: +(mq6 * 2.4).toFixed(1),
    propane: +(mq6 * 3.1).toFixed(1),
    methane: +(mq6 * 0.9).toFixed(1),
    butane: +(mq6 * 0.6).toFixed(1),
  }
}

const state = { t: 0, temp: 25.6, hum: 36, mq6: 3.2, spike: 0 }
function simulate(): TelemetrySample {
  state.t += 1
  const t = state.t
  state.temp += (25.4 + Math.sin(t / 40) * 0.9 - state.temp) * 0.08 + (Math.random() - 0.5) * 0.08
  state.hum += (36 + Math.sin(t / 55 + 1) * 3 - state.hum) * 0.08 + (Math.random() - 0.5) * 0.4
  if (Math.random() < 0.012) state.spike = 8 + Math.random() * 10 // someone lights the stove
  state.spike *= 0.93
  state.mq6 += (2.6 + Math.sin(t / 23) * 0.5 + state.spike - state.mq6) * 0.25 + (Math.random() - 0.5) * 0.2
  const mq6 = Math.max(0, state.mq6)
  return { t: Date.now(), temp: +state.temp.toFixed(1), hum: +state.hum.toFixed(0), mq6: +mq6.toFixed(1), ...gasFromMq6(mq6), coughs: live.coughCount }
}

/** Accepts the key names used by the RespAI firmware / Android bridge. */
function normalize(body: Record<string, unknown>): TelemetrySample | null {
  const num = (...keys: string[]) => {
    for (const k of keys) {
      const v = body[k]
      if (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) return Number(v)
    }
    return undefined
  }
  const temp = num('temp', 'tempC', 'temperature', 'T')
  const hum = num('hum', 'humidity', 'H')
  const mq6 = num('mq6', 'MQ6', 'mq6_ppm', 'mq6_raw', 'gas')
  if (temp === undefined && hum === undefined && mq6 === undefined) return null
  const m = Math.max(0, mq6 ?? 0)
  return {
    t: Date.now(),
    temp: +(temp ?? live.temp).toFixed(1),
    hum: Math.round(hum ?? live.hum),
    mq6: +m.toFixed(1),
    ...gasFromMq6(m),
    coughs: num('coughs', 'count', 'C') ?? 0,
  }
}

function startSimulation() {
  const st = useApp.getState()
  // seed a short history so sparklines aren't empty
  for (let i = 0; i < 40; i++) {
    const s = simulate()
    s.t = Date.now() - (40 - i) * 2000
    st.pushTelemetry(s, 'simulated')
  }
  return setInterval(() => useApp.getState().pushTelemetry(simulate(), 'simulated'), 2000)
}

export function startTelemetry() {
  if (started || typeof window === 'undefined') return
  started = true
  let sim: ReturnType<typeof setInterval> | null = startSimulation()
  if (!FIREBASE_URL || !FIREBASE_PATH) return

  // Optional: live readings straight from Firebase (REST, no SDK, no server).
  const url = `${FIREBASE_URL}/${FIREBASE_PATH}.json`
  let lastJson = ''
  let lastLiveAt = 0
  const poll = async () => {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) return
      const text = await r.text()
      if (text === lastJson) return
      lastJson = text
      const s = normalize(JSON.parse(text) ?? {})
      if (!s) return
      lastLiveAt = Date.now()
      if (sim) {
        clearInterval(sim)
        sim = null
      }
      useApp.getState().pushTelemetry(s, 'live')
    } catch {
      /* offline or rules deny reads — keep the simulation */
    } finally {
      // device silent for 30 s → fall back to the simulation
      if (!sim && Date.now() - lastLiveAt > 30_000) sim = startSimulation()
    }
  }
  void poll()
  setInterval(poll, 3000)
}
