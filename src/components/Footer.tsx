import type { MouseEvent } from 'react'
import { scrollToId } from '../lib/scroll'
import { Mark } from './icons'
import { useT } from '../i18n'

export function Footer() {
  const t = useT().footer
  const go = (id: string) => (e: MouseEvent) => {
    e.preventDefault()
    scrollToId(id)
  }
  return (
    <footer className="footer" data-nav="dark">
      <div className="footer__top">
        <div>
          <span className="logo">
            <Mark /> RespAI
          </span>
          <p className="mute" style={{ maxWidth: '36ch', marginTop: 14, color: 'var(--on-night-mute)' }}>
            {t.blurb}
          </p>
        </div>
        <div>
          <span className="label" style={{ color: 'var(--on-night-mute)' }}>
            {t.product}
          </span>
          <ul>
            <li>
              <a href="#model" onClick={go('model')}>
                {t.howItWorks}
              </a>
            </li>
            <li>
              <a href="#try" onClick={go('try')}>
                {t.demo}
              </a>
            </li>
            <li>
              <a href="#device" onClick={go('device')}>
                {t.hardware}
              </a>
            </li>
            <li>
              <a href="#air" onClick={go('air')}>
                {t.air}
              </a>
            </li>
          </ul>
        </div>
        <div>
          <span className="label" style={{ color: 'var(--on-night-mute)' }}>
            {t.company}
          </span>
          <ul>
            <li>
              <a href="#team" onClick={go('team')}>
                {t.team}
              </a>
            </li>
            <li>
              <a href="#impact" onClick={go('impact')}>
                {t.market}
              </a>
            </li>
            <li>
              <a href="#contact" onClick={go('contact')}>
                {t.pilot}
              </a>
            </li>
            <li>
              <a href="https://t.me/MUKHAMMAD_VMD" target="_blank" rel="noreferrer">
                Telegram ↗
              </a>
            </li>
          </ul>
        </div>
        <div>
          <span className="label" style={{ color: 'var(--on-night-mute)' }}>
            {t.note}
          </span>
          <p style={{ fontSize: 13, color: 'var(--on-night-mute)', marginTop: 14 }}>{t.noteText}</p>
        </div>
      </div>
      <div className="footer__legal label" style={{ color: 'var(--on-night-mute)' }}>
        <span>© {new Date().getFullYear()} Invenio</span>
        <span lang="uz">Har bir nafas muhim</span>
      </div>
    </footer>
  )
}
