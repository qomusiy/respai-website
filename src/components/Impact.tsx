import { useEffect, useRef, useState } from 'react'
import { gsap } from '../lib/scroll'
import { Arrow, Clinic, Factory, Home, School } from './icons'

const PRICE = 500_000 // soʻm per unit

const MILESTONES = [
  { at: 100, title: 'Payback', text: 'The project returns its investment at 100 units.' },
  { at: 500, title: 'Sustainable income', text: 'Stable revenue from 500 installed devices.' },
  { at: 1000, title: 'Expansion', text: '1,000+ units: scale to new regions and sectors.' },
]

const USES = [
  { icon: Clinic, title: 'Clinics', text: 'Objective cough counts between visits, synced to the app.' },
  { icon: School, title: 'Schools & colleges', text: 'Spot cough outbreaks in classrooms early — where viruses spread fastest.' },
  { icon: Home, title: 'Homes', text: 'Remote monitoring of a patient’s condition, plus gas-leak alerts in the kitchen.' },
  { icon: Factory, title: 'Workplaces', text: 'Safer air and early warning for teams working near gas.' },
]

const PRINCIPLES: Array<[string, string]> = [
  ['Medical precision', 'AI model & sound analysis'],
  ['Technical reliability', 'ESP32 hardware system'],
  ['Marketability', 'Affordable, local production'],
  ['Privacy & ethics', 'Consent window & data encryption'],
  ['User experience', 'Mobile app & interface for Uzbekistan'],
]

const fmt = (n: number) => n.toLocaleString('en-US')

export function Impact() {
  const ref = useRef<HTMLElement>(null)
  const [clinics, setClinics] = useState(1000)
  const [per, setPer] = useState(3)
  const units = clinics * per
  const turnover = units * PRICE
  const bn = turnover / 1e9

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.use', { y: 50, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.07, scrollTrigger: { trigger: '.uses', start: 'top 85%' } })
      gsap.from('.principle', { x: -30, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.06, scrollTrigger: { trigger: '.principles', start: 'top 80%' } })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <section className="section impact above" id="impact" ref={ref} aria-labelledby="impact-title">
      <div className="section-head">
        <div className="label">08 — Impact</div>
        <h2 id="impact-title" className="h2">
          Built for Uzbekistan’s
          <br />
          clinics first.
        </h2>
        <p className="lead">Affordable, locally produced and designed for clinics — then schools, homes and workplaces.</p>
      </div>

      <div className="calc">
        <div>
          <div className="range">
            <div className="range__head">
              <label className="label" htmlFor="clinics">
                Clinics
              </label>
              <b>{fmt(clinics)}</b>
            </div>
            <input id="clinics" type="range" min={100} max={10000} step={100} value={clinics} onChange={(e) => setClinics(+e.target.value)} />
          </div>
          <div className="range">
            <div className="range__head">
              <label className="label" htmlFor="per">
                Devices per clinic
              </label>
              <b>{per}</b>
            </div>
            <input id="per" type="range" min={1} max={6} step={1} value={per} onChange={(e) => setPer(+e.target.value)} />
          </div>
          <p className="label mute">
            {fmt(units)} units × {fmt(PRICE)} soʻm per device
          </p>
        </div>
        <div className="calc__out" aria-live="polite">
          {bn >= 1 ? bn.toFixed(bn >= 10 ? 0 : 1) : (turnover / 1e6).toFixed(0)}
          <span style={{ fontSize: '0.4em', letterSpacing: '-0.03em' }}>{bn >= 1 ? ' bn' : ' mln'} soʻm</span>
          <small>Projected turnover · e.g. 3 units in 1,000 clinics = 1.5 billion soʻm</small>
        </div>
      </div>

      <div className="milestones">
        {MILESTONES.map((m) => (
          <div key={m.at} className={`milestone ${units >= m.at ? 'is-reached' : ''}`}>
            <span className="label mute">{m.at >= 1000 ? '1,000+' : m.at} units</span>
            <b>{m.title}</b>
            <p className="mute" style={{ margin: 0, maxWidth: '30ch' }}>
              {m.text}
            </p>
          </div>
        ))}
      </div>

      <div className="uses">
        {USES.map(({ icon: Icon, title, text }) => (
          <article className="use" key={title}>
            <Icon />
            <div>
              <h4>{title}</h4>
              <p className="mute">{text}</p>
            </div>
          </article>
        ))}
      </div>

      <div className="principles">
        <div className="section-head" style={{ marginBottom: 32 }}>
          <div className="label">Design principles · axiomatic design</div>
        </div>
        {PRINCIPLES.map(([fr, dp], i) => (
          <div className="principle" key={fr}>
            <span className="label mute">FR{i + 1}</span>
            <span>{fr}</span>
            <Arrow />
            <span className="mute">{dp}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
