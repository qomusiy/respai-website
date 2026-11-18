import { useT } from '../i18n'

export function Problem() {
  const t = useT().problem
  return (
    <section className="section problem above" aria-labelledby="problem-title">
      <div className="section-head">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 id="problem-title" className="h2">
          {t.title}
        </h2>
        <p className="lead">{t.lead}</p>
      </div>
      <div className="stats">
        {t.stats.map((s) => (
          <div className="stat" key={s.n}>
            <div className="stat__n">{s.n}</div>
            <p>{s.text}</p>
            {s.source && (
              <cite>
                {t.source} {s.source}
              </cite>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
