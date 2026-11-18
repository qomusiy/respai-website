import type { MouseEvent } from 'react'
import { scrollToId } from '../lib/scroll'
import { Mark } from './icons'

export function Footer() {
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
            A cough detector and air-quality monitor, built by Invenio in Uzbekistan.
          </p>
        </div>
        <div>
          <span className="label" style={{ color: 'var(--on-night-mute)' }}>
            Product
          </span>
          <ul>
            <li>
              <a href="#model" onClick={go('model')}>
                How it works
              </a>
            </li>
            <li>
              <a href="#try" onClick={go('try')}>
                Live demo
              </a>
            </li>
            <li>
              <a href="#device" onClick={go('device')}>
                Hardware
              </a>
            </li>
            <li>
              <a href="#air" onClick={go('air')}>
                Air quality
              </a>
            </li>
          </ul>
        </div>
        <div>
          <span className="label" style={{ color: 'var(--on-night-mute)' }}>
            Company
          </span>
          <ul>
            <li>
              <a href="#team" onClick={go('team')}>
                Team
              </a>
            </li>
            <li>
              <a href="#impact" onClick={go('impact')}>
                Market
              </a>
            </li>
            <li>
              <a href="#contact" onClick={go('contact')}>
                Pilot programme
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
            Note
          </span>
          <p style={{ fontSize: 13, color: 'var(--on-night-mute)', marginTop: 14 }}>RespAI is a research prototype, not a medical device. It does not diagnose disease. If a cough persists, see a doctor.</p>
        </div>
      </div>
      <div className="footer__legal label" style={{ color: 'var(--on-night-mute)' }}>
        <span>© {new Date().getFullYear()} Invenio</span>
        <span lang="uz">Har bir nafas muhim</span>
      </div>
    </footer>
  )
}
