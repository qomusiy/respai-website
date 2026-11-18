import { Img } from './Gallery'

/**
 * Team members, left to right as they stand in the photo.
 * Each entry: { name: 'First Last', role: 'What they do' } — role is optional.
 * The names row stays hidden until this list is filled in.
 */
const MEMBERS: Array<{ name: string; role?: string }> = []

export function Team() {
  return (
    <section className="section team above" id="team" aria-labelledby="team-title">
      <div className="section-head">
        <span className="eyebrow">The team</span>
        <h2 id="team-title" className="h2">
          We are Invenio.
        </h2>
        <p className="lead">Five people from Uzbekistan building RespAI end to end: the electronics and enclosure, the cough model and the mobile app.</p>
      </div>

      <figure className="team__figure">
        <div className="team__photo">
          <Img name="team" alt="The five members of team Invenio standing in front of the National AI Hackathon stage in Tashkent" sizes="(max-width: 800px) 100vw, 92vw" widths={[700, 1280]} />
        </div>
        {MEMBERS.length > 0 && (
          <ol className="team__names" aria-label="From left to right">
            {MEMBERS.map((m) => (
              <li key={m.name}>
                <b>{m.name}</b>
                {m.role && <span>{m.role}</span>}
              </li>
            ))}
          </ol>
        )}
        <figcaption className="team__caption label mute">
          <span>National AI Hackathon, Tashkent</span>
          <span>November 2026</span>
        </figcaption>
      </figure>
    </section>
  )
}
