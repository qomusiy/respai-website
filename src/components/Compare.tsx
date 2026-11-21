import { Check, Cross } from './icons'

type Cell = 'yes' | 'no' | 'partial' | 'soon'
const ROWS: Array<[string, Cell, Cell]> = [
  ['Detects coughs', 'yes', 'yes'],
  ['Counts every cough', 'yes', 'yes'],
  ['Shows results in a mobile app', 'yes', 'yes'],
  ['Works as a standalone device — no phone needed', 'no', 'yes'],
  ['Measures air quality and dangerous gas', 'no', 'yes'],
  ['Medication reminders on the device', 'no', 'yes'],
  ['Complete health monitoring', 'partial', 'yes'],
  ['Recognises cough types — dry, wet, allergic, asthmatic', 'no', 'yes'],
]

function Mark({ v }: { v: Cell }) {
  if (v === 'yes')
    return (
      <span className="yes">
        <Check /> Yes
      </span>
    )
  if (v === 'partial') return <span className="no">◐ Partial</span>
  if (v === 'soon') return <span className="chip">In training</span>
  return (
    <span className="no">
      <Cross /> No
    </span>
  )
}

export function Compare() {
  return (
    <section className="section compare above" id="compare" aria-labelledby="compare-title">
      <div className="section-head">
        <div className="label">07 — Why RespAI</div>
        <h2 id="compare-title" className="h2">
          Not just another
          <br />
          cough app.
        </h2>
        <p className="lead">Phone apps can count coughs. RespAI is a dedicated device that also watches the air — and keeps working when your phone is in your pocket.</p>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="ctable">
          <thead>
            <tr>
              <th className="label mute">Capability</th>
              <th className="label mute">Phone-only cough apps</th>
              <th className="label us">RespAI</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([name, a, b]) => (
              <tr key={name}>
                <td>{name}</td>
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
