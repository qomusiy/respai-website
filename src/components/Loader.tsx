import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { lenis } from '../lib/scroll'

const LINES = ['Loading Resp‑1 neural network', 'Calibrating microphone', 'Warming up the MQ‑6 sensor', 'Booting OLED display']

export function Loader() {
  const { progress, active } = useProgress()
  const [shown, setShown] = useState(0)
  const [done, setDone] = useState(false)
  const start = useRef(performance.now())
  const target = useRef(0)
  target.current = active ? progress : 100

  useEffect(() => {
    document.documentElement.style.overflow = 'hidden'
    lenis?.stop()
    let raf = 0
    let v = 0
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      const dt = Math.min(0.25, (now - last) / 1000)
      last = now
      const elapsed = now - start.current
      // never faster than ~1.3 s, never slower than 7 s
      const cap = Math.min(100, (elapsed / 1300) * 100)
      const goal = elapsed > 7000 ? 100 : Math.min(cap, target.current)
      v += (goal - v) * (1 - Math.exp(-dt * 9))
      if (goal - v < 0.6) v = goal
      setShown(Math.round(v))
      if (v >= 100) {
        setTimeout(() => {
          setDone(true)
          document.documentElement.style.overflow = ''
          lenis?.start()
          window.dispatchEvent(new Event('respai:ready'))
        }, 250)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <div className={`loader ${done ? 'is-done' : ''}`} aria-hidden={done} role="status">
      <div className="label" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>RespAI · by Laputa</span>
        <span>{LINES[Math.min(LINES.length - 1, Math.floor(shown / 26))]}…</span>
      </div>
      <div>
        <div className="loader__num">{String(shown).padStart(3, '0')}</div>
        <div className="loader__bar" style={{ ['--p' as string]: shown / 100 }}>
          <i />
        </div>
        <div className="loader__row label">
          <span>Har bir nafas muhim</span>
          <span>Every breath matters</span>
        </div>
      </div>
    </div>
  )
}
