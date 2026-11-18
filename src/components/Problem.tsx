const STATS = [
  {
    n: '1.5–2 million',
    text: 'cases of influenza and acute respiratory infections are recorded in Uzbekistan every year.',
    source: 'Ministry of Health of Uzbekistan',
  },
  {
    n: 'PM2.5 and PM10',
    text: 'levels keep rising in Tashkent, the Fergana Valley, Navoi and Almalyk, driven by traffic, coal boilers, construction and farm dust.',
  },
  {
    n: 'Medium risk',
    text: 'is how Uzbekistan is classified for air quality. Poor air is linked to asthma, bronchitis, allergies and heart disease.',
    source: 'WHO',
  },
  {
    n: 'Classrooms',
    text: 'are where respiratory viruses spread fastest. Noticing a rise in coughing early gives a school time to act.',
  },
]

export function Problem() {
  return (
    <section className="section problem above" aria-labelledby="problem-title">
      <div className="section-head">
        <span className="eyebrow">The problem</span>
        <h2 id="problem-title" className="h2">
          Coughing is the first sign of infection, and nobody counts it.
        </h2>
        <p className="lead">In a hospital ward or a classroom, nobody keeps track of how often people cough or what is in the air they breathe. RespAI measures both, continuously.</p>
      </div>
      <div className="stats">
        {STATS.map((s) => (
          <div className="stat" key={s.n}>
            <div className="stat__n">{s.n}</div>
            <p>{s.text}</p>
            {s.source && <cite>Source: {s.source}</cite>}
          </div>
        ))}
      </div>
    </section>
  )
}
