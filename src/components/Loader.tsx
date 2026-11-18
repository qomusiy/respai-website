import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { lenis } from '../lib/scroll'
import { Mark } from './icons'

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
      // never slower than 7 s; no artificial minimum
      const cap = 100
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
    <div className={`loader ${done ? 'is-done' : ''}`} aria-hidden={done} role="status" aria-label="Loading">
      <div className="loader__inner">
        <span className="logo">
          <Mark /> RespAI
        </span>
        <div className="loader__bar" style={{ ['--p' as string]: shown / 100 }}>
          <i />
        </div>
      </div>
    </div>
  )
}
