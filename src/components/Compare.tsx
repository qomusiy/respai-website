import { Check, Cross } from './icons'
import { useT } from '../i18n'

function Cell({ ok, note }: { ok: boolean; note: string }) {
  return (
    <span className={ok ? 'yes' : 'no'}>
      {ok ? <Check /> : <Cross />}
      {note && <small>{note}</small>}
    </span>
  )
}

export function Compare() {
  const t = useT().compare
  return (
    <section className="section compare above" id="compare" aria-labelledby="compare-title">
      <div className="section-head">
        <span className="eyebrow">{t.eyebrow}</span>
        <h2 id="compare-title" className="h2">
          {t.title}
        </h2>
        <p className="lead">{t.lead}</p>
      </div>
      <div className="ctable__wrap">
        <table className="ctable ctable--3">
          <thead>
            <tr>
              <th className="label mute">{t.capability}</th>
              <th className="label us">RespAI</th>
              <th className="label mute">Hyfe</th>
              <th className="label mute">NuvoAir</th>
            </tr>
          </thead>
          <tbody>
            {t.rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className="us">
                  <Cell {...r.us} />
                </td>
                <td>
                  <Cell {...r.hyfe} />
                </td>
                <td>
                  <Cell {...r.nuvo} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
