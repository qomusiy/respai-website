import { useEffect, useRef, useState } from 'react'
import { scrollToId } from '../lib/scroll'
import { useApp, live } from '../lib/live'

/** Persistent "Resp‑1" pill — keeps the AI one click away everywhere on the page. */
export function FloatingAI() {
  const [show, setShow] = useState(false)
  const orb = useRef<HTMLSpanElement>(null)
  const coughs = useApp((s) => s.coughs.length)
  const listening = useApp((s) => s.engineState === 'listening')

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      const play = document.getElementById('try')
      const r = play?.getBoundingClientRect()
      const inPlay = r ? r.top < window.innerHeight * 0.6 && r.bottom > window.innerHeight * 0.4 : false
      const footer = document.querySelector('.footer')?.getBoundingClientRect()
      const inFooter = footer ? footer.top < window.innerHeight * 0.9 : false
      setShow(y > window.innerHeight * 0.8 && !inPlay && !inFooter)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const active = performance.now() - live.lastFrameAt < 1500
      const s = 1 + (active ? live.level * 0.5 : 0) + live.flash * 0.35
      if (orb.current) {
        orb.current.style.transform = `scale(${s.toFixed(3)})`
        orb.current.style.setProperty('--alert', live.flash.toFixed(3))
      }
    }
    raf = requestAnimationFrame(tick)
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <button className={`fab ${show ? 'is-on' : ''}`} onClick={() => scrollToId('try')} aria-label="Try the Resp‑1 cough AI" tabIndex={show ? 0 : -1}>
      <span className="fab__orb" ref={orb} aria-hidden />
      <span className="fab__txt">
        <b>Resp‑1</b>
        <small>{listening ? 'Listening…' : coughs ? `${coughs} cough${coughs === 1 ? '' : 's'} detected` : 'Try the cough AI'}</small>
      </span>
    </button>
  )
}
