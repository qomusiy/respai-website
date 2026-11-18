import { Check, Cross } from './icons'
import { useT } from '../i18n'

type Cell = 'yes' | 'no' | 'partial' | 'soon'
/** phone apps, RespAI — row names come from the dictionary (same order) */
const ROWS: Array<[Cell, Cell]> = [
  ['yes', 'yes'],
  ['yes', 'yes'],
  ['yes', 'yes'],
  ['no', 'yes'],
  ['no', 'yes'],
  ['no', 'yes'],
  ['partial', 'yes'],
  ['no', 'yes'],
]

function Mark({ v }: { v: Cell }) {
  const t = useT().compare
  if (v === 'yes')
    return (
      <span className="yes">
        <Check /> {t.yes}
      </span>
    )
  if (v === 'partial') return <span className="no">◐ {t.partial}</span>
  if (v === 'soon') return <span className="chip">{t.soon}</span>
  return (
    <span className="no">
      <Cross /> {t.no}
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
      <div style={{ overflowX: 'auto' }}>
        <table className="ctable">
          <thead>
            <tr>
              <th className="label mute">{t.capability}</th>
              <th className="label mute">{t.apps}</th>
              <th className="label us">RespAI</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([a, b], i) => (
              <tr key={i}>
                <td>{t.rows[i]}</td>
                <td>
                  <Mark v={a} />
                </td>
                <td className="us">
                  <Mark v={b} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
