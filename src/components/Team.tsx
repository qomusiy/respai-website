import { useState } from 'react'
import { Img } from './Img'
import { useT } from '../i18n'

/**
 * Where each person's face is in the photo (percent of width / height), left to right,
 * in the same order as t.team.members.
 */
const FACES: Array<[number, number]> = [
  [18.4, 41.5],
  [36.7, 43.5],
  [53.9, 53.5],
  [68.4, 50.5],
  [82.8, 43],
]

export function Team() {
  const t = useT().team
  const [focus, setFocus] = useState<number | null>(null)

  return (
    <section className="section team above" id="team" aria-labelledby="team-title">
      <div className="team__grid">
        <div className="team__copy">
          <span className="eyebrow">{t.eyebrow}</span>
          <h2 id="team-title" className="h2">
            {t.title}
          </h2>
          <p className="lead">{t.lead}</p>
        </div>

        <figure className="team__figure">
          <div className="team__photo">
            <Img name="team" alt={t.alt} sizes="(max-width: 900px) 100vw, 640px" widths={[700, 1280]} />
            {FACES.map(([x, y], i) => (
              <span key={i} className={`team__face ${focus === i ? 'is-on' : ''}`} style={{ left: `${x}%`, top: `${y}%` }} aria-hidden />
            ))}
          </div>
          <ol className="team__names" aria-label={t.namesAria}>
            {t.members.map((name, i) => (
              <li key={i} style={{ left: `${FACES[i][0]}%` }} tabIndex={0} onMouseEnter={() => setFocus(i)} onMouseLeave={() => setFocus(null)} onFocus={() => setFocus(i)} onBlur={() => setFocus(null)}>
                {name}
              </li>
            ))}
          </ol>
          <figcaption className="team__caption label mute">
            <span>{t.caption[0]}</span>
            <span>{t.caption[1]}</span>
          </figcaption>
        </figure>
      </div>
    </section>
  )
}
