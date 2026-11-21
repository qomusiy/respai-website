import { useState, type FormEvent } from 'react'
import { Arrow, Check } from './icons'

const TYPES = ['Clinic', 'School', 'Home', 'Investor', 'Other']
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
  const [type, setType] = useState('Clinic')
  const [sent, setSent] = useState<{ text: string; copied: boolean } | null>(null)

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const d = Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>
    const text = [
      `Hello RespAI team! Pilot request (${type})`,
      `Name: ${d.name?.trim()}`,
      d.org?.trim() ? `Organisation: ${d.org.trim()}` : '',
      `Contact: ${d.contact?.trim()}`,
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
          <div className="label">09 — Contact</div>
          <h2 id="contact-title" className="h2" style={{ margin: '14px 0 22px' }}>
            Bring RespAI
            <br />
            to your clinic.
          </h2>
          <p className="lead">We’re looking for pilot clinics, schools and partners in Uzbekistan. Tell us about your space — we’ll get back within a few days.</p>
          <div className="team">
            <div className="person">
              <span className="avatar">VM</span>
              <span>
                <b style={{ fontWeight: 500 }}>Valiyev Muhammadjon</b>
                <br />
                <span className="label mute">Project manager · Team Laputa</span>
              </span>
              <a className="btn btn--sm" href={TELEGRAM} target="_blank" rel="noreferrer">
                Telegram <Arrow />
              </a>
            </div>
            <p className="label mute" style={{ marginTop: 8, lineHeight: 1.6 }}>
              Shaped by live interviews and feedback sessions.
              <br />
              Developed by team Laputa, Uzbekistan.
            </p>
          </div>
        </div>

        <form className="form" onSubmit={submit}>
          <div className="field field--full">
            <span className="label mute">I’m reaching out as</span>
            <div className="seg" role="radiogroup" aria-label="Organisation type">
              {TYPES.map((t) => (
                <button type="button" key={t} role="radio" aria-checked={type === t} className={type === t ? 'is-on' : ''} onClick={() => setType(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label className="label mute" htmlFor="c-name">
              Name
            </label>
            <input id="c-name" name="name" required maxLength={80} autoComplete="name" />
          </div>
          <div className="field">
            <label className="label mute" htmlFor="c-org">
              Organisation
            </label>
            <input id="c-org" name="org" maxLength={120} autoComplete="organization" />
          </div>
          <div className="field field--full">
            <label className="label mute" htmlFor="c-contact">
              Email or phone
            </label>
            <input id="c-contact" name="contact" required maxLength={120} autoComplete="email" />
          </div>
          <div className="field field--full">
            <label className="label mute" htmlFor="c-msg">
              Message
            </label>
            <textarea id="c-msg" name="message" maxLength={2000} placeholder="How many rooms or patients? What would you like RespAI to monitor?" />
          </div>
          <div className="form__foot">
            <span className="label mute" aria-live="polite">
              {sent ? (
                <span style={{ color: 'var(--good)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <Check width={14} height={14} /> {sent.copied ? 'Message copied — paste it into the Telegram chat.' : 'Copy the message below into the Telegram chat.'}
                </span>
              ) : (
                'Opens Telegram with your message ready to paste.'
              )}
            </span>
            <button className="btn btn--dark" type="submit">
              Request a pilot <Arrow />
            </button>
          </div>
          {sent && (
            <div className="field field--full">
              <label className="label mute" htmlFor="c-out">
                Your message
              </label>
              <textarea id="c-out" readOnly value={sent.text} onFocus={(e) => e.currentTarget.select()} />
              <a className="label" href={TELEGRAM} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', marginTop: 4 }}>
                Open Telegram again ↗
              </a>
            </div>
          )}
        </form>
      </div>
    </section>
  )
}
