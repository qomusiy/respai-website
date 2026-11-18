import { useEffect, useRef, useState } from 'react'
import { gsap } from '../lib/scroll'
import { useT } from '../i18n'

const PRICE = 553_000 // soʻm per device (pitch deck, monetisation slide)
const ALL_INSTITUTIONS = 8_912 // medical institutions in Uzbekistan (TAM)

export function Impact() {
  const T = useT()
  const t = T.impact
  const fmt = (n: number, digits = 0) => n.toLocaleString(T.locale, { maximumFractionDigits: digits })
  const ref = useRef<HTMLElement>(null)
  const [clinics, setClinics] = useState(ALL_INSTITUTIONS)
  const [per, setPer] = useState(3)
  const units = clinics * per
  const turnover = units * PRICE
  const bn = turnover / 1e9

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.mseg', { y: 30, opacity: 0, duration: 0.9, ease: 'power2.out', stagger: 0.07, scrollTrigger: { trigger: '.msegs', start: 'top 85%' } })
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

      <h3 className="impact__sub">{t.segTitle}</h3>
      <div className="msegs">
        {t.segments.map((s) => (
          <div className="mseg" key={s.k}>
            <span className="mseg__k">{s.k}</span>
            <b>{s.value}</b>
            <p>{s.reach}</p>
          </div>
        ))}
      </div>
      <p className="label mute impact__note">{t.segNote}</p>

      <div className="impact__duo">
        <div className="calc">
          <h3 className="impact__sub">{t.calcTitle}</h3>
          <div className="range">
            <div className="range__head">
              <label className="label" htmlFor="clinics">
                {t.clinics}
              </label>
              <b>{fmt(clinics)}</b>
            </div>
            <input id="clinics" type="range" min={50} max={ALL_INSTITUTIONS} step={1} value={clinics} onChange={(e) => setClinics(+e.target.value)} />
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
          <p className="label mute">{t.unitsLine(fmt(units), fmt(PRICE))}</p>
          <div className="calc__out" aria-live="polite">
            {bn >= 1 ? fmt(bn, 3) : fmt(turnover / 1e6)}
            <span>
              {' '}
              {bn >= 1 ? t.bn : t.mln} {t.currency}
            </span>
            <small>{t.projected}</small>
          </div>
        </div>

        <div className="pricing">
          <span className="label mute">{t.pricing.who}</span>
          <p className="pricing__who">{t.pricing.whoText}</p>
          <div className="pricing__price">
            {t.pricing.price}
            <small>{t.pricing.priceUnit}</small>
          </div>
          <span className="label mute">{t.pricing.whyTitle}</span>
          <ul>
            {t.pricing.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      </div>

      <h3 className="impact__sub">{t.customersTitle}</h3>
      <ol className="customers">
        {t.customers.map((c, i) => (
          <li key={c}>
            <span>0{i + 1}</span>
            {c}
          </li>
        ))}
      </ol>

      <h3 className="impact__sub">{t.roadmapTitle}</h3>
      <ol className="roadmap">
        {t.roadmap.map((r, i) => (
          <li key={r.when} className={i === 0 ? 'is-now' : ''}>
            <span className="roadmap__when">{r.when}</span>
            <b>{r.a}</b>
            <span className="mute">{r.b}</span>
          </li>
        ))}
      </ol>
      <p className="label mute impact__note">{t.roadmapNote}</p>
    </section>
  )
}
