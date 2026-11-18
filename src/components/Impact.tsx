import { useEffect, useRef, useState } from 'react'
import { gsap } from '../lib/scroll'
import { Clinic, Factory, Home, School } from './icons'
import { useT } from '../i18n'

const PRICE = 500_000 // soʻm per unit

/** unit thresholds; titles and texts come from the dictionary (same order) */
const MILESTONES = [100, 500, 1000]
const USE_ICONS = [Clinic, School, Home, Factory]

export function Impact() {
  const T = useT()
  const t = T.impact
  const fmt = (n: number, digits = 0) => n.toLocaleString(T.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })
  const ref = useRef<HTMLElement>(null)
  const [clinics, setClinics] = useState(1000)
  const [per, setPer] = useState(3)
  const units = clinics * per
  const turnover = units * PRICE
  const bn = turnover / 1e9

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.use', { y: 50, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.07, scrollTrigger: { trigger: '.uses', start: 'top 85%' } })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <section className="section impact above" id="impact" ref={ref} aria-labelledby="impact-title">
      <div className="section-head">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 id="impact-title" className="h2">
          {t.title}
        </h2>
        <p className="lead">{t.lead}</p>
      </div>

      <div className="calc">
        <div>
          <div className="range">
            <div className="range__head">
              <label className="label" htmlFor="clinics">
                {t.clinics}
              </label>
              <b>{fmt(clinics)}</b>
            </div>
            <input id="clinics" type="range" min={100} max={10000} step={100} value={clinics} onChange={(e) => setClinics(+e.target.value)} />
          </div>
          <div className="range">
            <div className="range__head">
              <label className="label" htmlFor="per">
                {t.perClinic}
              </label>
              <b>{per}</b>
            </div>
            <input id="per" type="range" min={1} max={6} step={1} value={per} onChange={(e) => setPer(+e.target.value)} />
          </div>
          <p className="label mute">
            {t.unitsLine(fmt(units), fmt(PRICE))}
          </p>
        </div>
        <div className="calc__out" aria-live="polite">
          {bn >= 1 ? fmt(bn, bn >= 10 ? 0 : 1) : fmt(turnover / 1e6)}
          <span style={{ fontSize: '0.4em', letterSpacing: '-0.03em' }}>
            {' '}
            {bn >= 1 ? t.bn : t.mln} {t.currency}
          </span>
          <small>{t.projected}</small>
        </div>
      </div>

      <div className="milestones">
        {MILESTONES.map((at, i) => (
          <div key={at} className={`milestone ${units >= at ? 'is-reached' : ''}`}>
            <span className="label mute">{t.units(at >= 1000 ? `${fmt(at)}+` : fmt(at))}</span>
            <b>{t.milestones[i].title}</b>
            <p className="mute" style={{ margin: 0, maxWidth: '30ch' }}>
              {t.milestones[i].text}
            </p>
          </div>
        ))}
      </div>

      <div className="uses">
        {t.uses.map(({ title, text }, i) => {
          const Icon = USE_ICONS[i]
          return (
          <article className="use" key={i}>
            <Icon />
            <div>
              <h4>{title}</h4>
              <p className="mute">{text}</p>
            </div>
          </article>
          )
        })}
      </div>
    </section>
  )
}
