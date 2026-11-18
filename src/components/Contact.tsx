import { useState, type FormEvent } from 'react'
import { Arrow, Check } from './icons'
import { useT } from '../i18n'

const TELEGRAM = 'https://t.me/MUKHAMMAD_VMD'

/** Copies text synchronously (works inside the click, before a new tab steals focus). */
function copyText(text: string) {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    if (ok) return true
  } catch {
    /* fall through */
  }
  navigator.clipboard?.writeText(text).catch(() => {})
  return false
}

/**
 * Static-hosting friendly: no server. The request is composed into a message,
 * copied to the clipboard and the team's Telegram chat is opened.
 */
export function Contact() {
  const t = useT().contact
  /** index into t.types, so the choice survives a language switch */
  const [type, setType] = useState(0)
  const [sent, setSent] = useState<{ text: string; copied: boolean } | null>(null)

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const d = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>
    const text = [
      t.msgHello(t.types[type]),
      `${t.msgName}: ${d.name?.trim()}`,
      d.org?.trim() ? `${t.msgOrg}: ${d.org.trim()}` : '',
      `${t.msgContact}: ${d.contact?.trim()}`,
      d.message?.trim() ? `\n${d.message.trim()}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const copied = copyText(text)
    window.open(TELEGRAM, '_blank', 'noopener')
    setSent({ text, copied })
  }

  return (
    <section className="section above" id="contact" aria-labelledby="contact-title">
      <div className="contact__grid">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h2 id="contact-title" className="h2" style={{ margin: '0 0 22px' }}>
            {t.title}
          </h2>
          <p className="lead">{t.lead}</p>
          <div className="team">
            <div className="person">
              <span className="avatar">{t.initials}</span>
              <span>
                <b style={{ fontWeight: 500 }}>{t.person}</b>
                <br />
                <span className="label mute">{t.role}</span>
              </span>
              <a className="btn btn--sm" href={TELEGRAM} target="_blank" rel="noreferrer">
                Telegram <Arrow />
              </a>
            </div>
          </div>
        </div>

        <form className="form" onSubmit={submit}>
          <div className="field field--full">
            <span className="label mute">{t.typeLabel}</span>
            <div className="seg" role="radiogroup" aria-label={t.typeLabel}>
              {t.types.map((label, i) => (
                <button type="button" key={i} role="radio" aria-checked={type === i} className={type === i ? 'is-on' : ''} onClick={() => setType(i)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="label mute" htmlFor="c-name">
              {t.name}
            </label>
            <input id="c-name" name="name" required maxLength={80} autoComplete="name" />
          </div>
          <div className="field">
            <label className="label mute" htmlFor="c-org">
              {t.org}
            </label>
            <input id="c-org" name="org" maxLength={120} autoComplete="organization" />
          </div>
          <div className="field field--full">
            <label className="label mute" htmlFor="c-contact">
              {t.contact}
            </label>
            <input id="c-contact" name="contact" required maxLength={120} autoComplete="email" />
          </div>
          <div className="field field--full">
            <label className="label mute" htmlFor="c-msg">
              {t.message}
            </label>
            <textarea id="c-msg" name="message" maxLength={2000} placeholder={t.placeholder} />
          </div>
          <div className="form__foot">
            <span className="label mute" aria-live="polite">
              {sent ? (
                <span style={{ color: 'var(--good)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <Check width={14} height={14} /> {sent.copied ? t.copied : t.copyManual}
                </span>
              ) : (
                t.footIdle
              )}
            </span>
            <button className="btn btn--dark" type="submit">
              {t.submit} <Arrow />
            </button>
          </div>
          {sent && (
            <div className="field field--full">
              <label className="label mute" htmlFor="c-out">
                {t.yourMessage}
              </label>
              <textarea id="c-out" readOnly value={sent.text} onFocus={(e) => e.currentTarget.select()} />
              <a className="label" href={TELEGRAM} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', marginTop: 4 }}>
                {t.openAgain}
              </a>
            </div>
          )}
        </form>
      </div>
    </section>
  )
}
