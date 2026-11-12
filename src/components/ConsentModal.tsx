import { useEffect, useRef, useState } from 'react'
import { useApp } from '../lib/live'
import { lenis } from '../lib/scroll'
import { Check, Mic, Shield } from './icons'

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
          <Shield width={12} height={12} /> Consent window
        </span>
        <h3 id="consent-title">Before Resp‑1 listens.</h3>
        <ul>
          <li>
            <Check />
            <span>
              Audio is analysed <b>locally in your browser</b> — nothing is uploaded.
            </span>
          </li>
          <li>
            <Check />
            <span>Nothing is recorded or stored. Closing the page erases everything.</span>
          </li>
          <li>
            <Check />
            <span>You can stop the microphone at any time.</span>
          </li>
          <li>
            <Check />
            <span>This is a demo, not a medical diagnosis.</span>
          </li>
        </ul>
        <label className="check">
          <input ref={checkRef} type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>I agree to let this page use my microphone for live cough detection.</span>
        </label>
        <div className="modal__actions">
          <button className="btn btn--dark" disabled={!agree} style={{ opacity: agree ? 1 : 0.45 }} onClick={() => close(true)}>
            <Mic /> Allow microphone
          </button>
          <button className="btn btn--ghost" onClick={() => close(false)}>
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}
