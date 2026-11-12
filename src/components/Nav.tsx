import { useEffect, useState } from 'react'
import { Arrow, Mark } from './icons'
import { scrollToId, lenis } from '../lib/scroll'

export const NAV_LINKS = [
  { id: 'model', label: 'Model' },
  { id: 'try', label: 'Try it' },
  { id: 'device', label: 'Device' },
  { id: 'air', label: 'Air' },
  { id: 'impact', label: 'Impact' },
]

export function Nav() {
  const [scrolled, setScrolled] = useState(false)
  const [dark, setDark] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [active, setActive] = useState('')
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let lastY = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 20)
      setHidden(y > window.innerHeight && y > lastY + 2)
      if (y < lastY - 2) setHidden(false)
      lastY = y
      const probe = 34
      let isDark = false
      document.querySelectorAll<HTMLElement>('[data-nav="dark"]').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.top <= probe && r.bottom >= probe) isDark = true
      })
      setDark(isDark)
      let cur = ''
      for (const l of NAV_LINKS) {
        const el = document.getElementById(l.id)
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.top <= window.innerHeight * 0.4 && r.bottom > window.innerHeight * 0.4) cur = l.id
      }
      setActive(cur)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (open) lenis?.stop()
    else lenis?.start()
  }, [open])

  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    setOpen(false)
    scrollToId(id)
  }

  return (
    <>
      <header className={`nav ${scrolled ? 'is-scrolled' : ''} ${dark ? 'is-dark' : ''} ${hidden && !open ? 'is-hidden' : ''} ${open ? 'menu-open' : ''}`}>
        <a href="#top" className="logo" onClick={go('top')} aria-label="RespAI home">
          <Mark />
          RespAI <small>by Laputa</small>
        </a>
        <nav className="nav__links" aria-label="Primary">
          {NAV_LINKS.map((l) => (
            <a key={l.id} href={`#${l.id}`} onClick={go(l.id)} className={active === l.id ? 'is-active' : ''}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="nav__right">
          <a href="#contact" className={`btn btn--sm nav__cta ${dark ? 'btn--night' : ''}`} onClick={go('contact')}>
            Get a pilot
          </a>
          <a href="#try" className="btn btn--sm btn--dark nav__cta" onClick={go('try')}>
            Try Resp‑1 <Arrow />
          </a>
          <button className={`nav__burger ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}>
            <span />
            <span />
          </button>
        </div>
      </header>
      <div className={`menu ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <nav>
          {[...NAV_LINKS, { id: 'contact', label: 'Contact' }].map((l, i) => (
            <a key={l.id} href={`#${l.id}`} onClick={go(l.id)} tabIndex={open ? 0 : -1}>
              <small>0{i + 1}</small>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="label" style={{ opacity: 0.6 }}>
          Har bir nafas muhim — every breath matters
        </div>
      </div>
    </>
  )
}
