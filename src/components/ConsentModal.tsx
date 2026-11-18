import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/live'
import { lenis } from '../lib/scroll'
import { Check, Mic, Shield } from './icons'
import { useT } from '../i18n'

let onAllow: (() => void) | null = null

/**
 * Opens the consent window (FR4 — privacy & ethics). `allow` runs synchronously inside the
 * "Allow microphone" click, so audio can start within the user gesture (required by Safari).
 * If consent was already given, `allow` runs immediately (still inside the caller's gesture).
 */
export function requestConsent(allow: () => void) {
  const st = useApp.getState()
  if (st.consent) return allow()
  onAllow = allow
  st.setConsentOpen(true)
}

export function ConsentModal() {
  const t = useT().consent
  const open = useApp((s) => s.consentOpen)
  const [agree, setAgree] = useState(false)
  const checkRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    lenis?.stop()
    const t = setTimeout(() => checkRef.current?.focus(), 50)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(false)
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey)
      lenis?.start()
    }
  }, [open])

  const close = (ok: boolean) => {
    const st = useApp.getState()
    if (ok) st.setConsent(true)
    st.setConsentOpen(false)
    const cb = onAllow
    onAllow = null
    if (ok) cb?.()
  }

  if (!open) return null
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-title" onClick={(e) => e.target === e.currentTarget && close(false)}>
      <div className="modal__card">
        <span className="chip">
          <Shield width={12} height={12} /> {t.chip}
        </span>
        <h3 id="consent-title">{t.title}</h3>
        <ul>
          <li>
            <Check />
            <span>
              {t.local.pre}
              <b>{t.local.b}</b>
              {t.local.post}
            </span>
          </li>
          {t.items.map((item) => (
            <li key={item}>
              <Check />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <label className="check">
          <input ref={checkRef} type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{t.agree}</span>
        </label>
        <div className="modal__actions">
          <button className="btn btn--dark" disabled={!agree} style={{ opacity: agree ? 1 : 0.45 }} onClick={() => close(true)}>
            <Mic /> {t.allow}
          </button>
          <button className="btn btn--ghost" onClick={() => close(false)}>
            {t.notNow}
          </button>
        </div>
      </div>
    </div>
  )
}
