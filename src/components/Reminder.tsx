import { useEffect, useRef, useState } from 'react'
import { View } from '@react-three/drei'
import { ReminderScene } from '../three/scenes'
import { live, setOledOverride } from '../lib/live'
import { gsap } from '../lib/scroll'
import { Bell } from './icons'

let actx: AudioContext | null = null
function audio() {
  if (!actx) actx = new AudioContext()
  if (actx.state === 'suspended') void actx.resume()
  return actx
}
/** Piezo-style buzzer pattern: beep-beep-beep, twice. */
function buzz() {
  const ctx = audio()
  const t0 = ctx.currentTime + 0.05
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 3; i++) {
      const t = t0 + r * 1.0 + i * 0.17
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'square'
      o.frequency.value = 2700
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.06, t + 0.005)
      g.gain.setValueAtTime(0.06, t + 0.1)
      g.gain.linearRampToValueAtTime(0, t + 0.11)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.12)
    }
}

export function Reminder() {
  const ref = useRef<HTMLElement>(null)
  const ringing = useRef(0)
  const [name, setName] = useState('PARACETAMOL')
  const [time, setTime] = useState(() => {
    const d = new Date(Date.now() + 60_000)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const [toast, setToast] = useState<string | null>(null)
  const [scheduled, setScheduled] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fire = (label: string, at: string) => {
    live.reminderText = label.toUpperCase().slice(0, 10) || 'MEDICINE'
    live.reminderTime = at
    setOledOverride('reminder', 9000)
    ringing.current = performance.now() + 2600
    buzz()
    setToast(`Time to take ${label.trim() || 'your medicine'}`)
    setTimeout(() => setToast(null), 6000)
    setScheduled(null)
    setCountdown(null)
  }

  const demo = () => {
    audio() // unlock audio within the click
    if (timer.current) clearTimeout(timer.current)
    let n = 3
    setCountdown(n)
    const tick = () => {
      n--
      if (n <= 0) return fire(name, time)
      setCountdown(n)
      timer.current = setTimeout(tick, 1000)
    }
    timer.current = setTimeout(tick, 1000)
  }

  const schedule = () => {
    audio()
    if (timer.current) clearTimeout(timer.current)
    const [h, m] = time.split(':').map(Number)
    const at = new Date()
    at.setHours(h, m, 0, 0)
    if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1)
    timer.current = setTimeout(() => fire(name, time), at.getTime() - Date.now())
    setScheduled(`${time}${at.getDate() !== new Date().getDate() ? ' tomorrow' : ''}`)
  }

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.reminder__copy > *', { y: 30, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.06, scrollTrigger: { trigger: ref.current, start: 'top 70%' } })
    }, ref)
    return () => {
      ctx.revert()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return (
    <section className="section" id="reminder" ref={ref} aria-labelledby="reminder-title">
      <div className="reminder__grid">
        <div className="reminder__copy above">
          <div className="label">06 — Medication reminder</div>
          <h2 id="reminder-title" className="h2" style={{ margin: '14px 0 22px' }}>
            Never miss
            <br />a dose.
          </h2>
          <p className="lead">Taking medicine late can reduce its effectiveness and delay recovery. Schedule doses in the app — RespAI beeps and shows the reminder on its screen.</p>
          <div className="reminder__form">
            <div className="field">
              <label className="label mute" htmlFor="med">
                Medicine
              </label>
              <input id="med" value={name} maxLength={10} onChange={(e) => setName(e.target.value.toUpperCase())} autoComplete="off" />
            </div>
            <div className="field">
              <label className="label mute" htmlFor="medtime">
                Time
              </label>
              <input id="medtime" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div className="reminder__actions">
              <button className="btn btn--dark" onClick={demo} disabled={countdown !== null}>
                <Bell /> {countdown !== null ? `Ringing in ${countdown}…` : 'Try it now'}
              </button>
              <button className="btn btn--ghost" onClick={schedule}>
                Schedule
              </button>
            </div>
            {scheduled && (
              <p className="label mute" style={{ gridColumn: '1 / -1', margin: '4px 0 0' }}>
                Scheduled for {scheduled} · keep this tab open
              </p>
            )}
          </div>
        </div>
        <div className="reminder__stage">
          <View className="view" index={5}>
            <ReminderScene ringing={ringing} />
          </View>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          <span className="toast__icon">
            <Bell width={18} height={18} />
          </span>
          <span>
            <b>{toast}</b>
            <span>RespAI · {live.reminderTime}</span>
          </span>
        </div>
      )}
    </section>
  )
}
