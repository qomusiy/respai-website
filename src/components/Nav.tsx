import { useEffect, useState } from 'react'
import { Arrow, Mark } from './icons'
import { scrollToId, lenis } from '../lib/scroll'
import { LANGS, useLang, useT } from '../i18n'

const NAV_IDS = ['model', 'try', 'device', 'air', 'team'] as const
export const DASHBOARD = `${import.meta.env.BASE_URL}dashboard/`

/** EN / UZ / RU switcher */
export function LangSwitch({ className = '' }: { className?: string }) {
  const lang = useLang((s) => s.lang)
  const setLang = useLang((s) => s.setLang)
  const t = useT()
  return (
    <div className={`lang ${className}`} role="group" aria-label={t.nav.language}>
      {LANGS.map((l) => (
        <button key={l.code} type="button" lang={l.html} aria-label={l.name} title={l.name} aria-pressed={lang === l.code} className={lang === l.code ? 'is-on' : ''} onClick={() => setLang(l.code)}>
          {l.short}
        </button>
      ))}
    </div>
  )
}

export function Nav() {
  const t = useT()
  const links = NAV_IDS.map((id) => ({ id, label: t.nav.links[id] }))
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
      for (const id of NAV_IDS) {
        const el = document.getElementById(id)
        if (!el) continue
        const r = el.getBoundingClientRect()
        if (r.top <= window.innerHeight * 0.4 && r.bottom > window.innerHeight * 0.4) cur = id
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
        <a href="#top" className="logo" onClick={go('top')} aria-label={t.nav.home}>
          <Mark />
          RespAI <small>{t.nav.by}</small>
        </a>
        <nav className="nav__links" aria-label={t.nav.primary}>
          {links.map((l) => (
            <a key={l.id} href={`#${l.id}`} onClick={go(l.id)} className={active === l.id ? 'is-active' : ''}>
              {l.label}
            </a>
          ))}
        </nav>
        <div className="nav__right">
          <LangSwitch />
          <a href={DASHBOARD} className={`btn btn--sm nav__cta nav__ai ${dark ? 'btn--night' : 'btn--ghost'}`}>
            {t.navAnalysis} <span className="nav__beta">{t.dash.beta}</span>
          </a>
          <a href="#contact" className={`btn btn--sm nav__cta ${dark ? 'btn--night' : 'btn--dark'}`} onClick={go('contact')}>
            {t.nav.cta} <Arrow />
          </a>
          <button className={`nav__burger ${open ? 'is-open' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={open ? t.nav.closeMenu : t.nav.openMenu} aria-expanded={open}>
            <span />
            <span />
          </button>
        </div>
      </header>
      <div className={`menu ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <nav>
          {[...links, { id: 'contact', label: t.nav.links.contact }].map((l) => (
            <a key={l.id} href={`#${l.id}`} onClick={go(l.id)} tabIndex={open ? 0 : -1}>
              {l.label}
            </a>
          ))}
          <a href={DASHBOARD} tabIndex={open ? 0 : -1}>
            {t.navAnalysis} <span className="nav__beta">{t.dash.beta}</span>
          </a>
        </nav>
        <div className="label" style={{ opacity: 0.6 }}>
          {t.nav.menuFoot}
        </div>
      </div>
    </>
  )
}
