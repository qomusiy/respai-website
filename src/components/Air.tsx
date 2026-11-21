import { useEffect, useMemo, useRef } from 'react'
import { useApp, live, type TelemetrySample } from '../lib/live'
import { gsap } from '../lib/scroll'

function Spark({ data, k, color = 'var(--ink)', min, max }: { data: TelemetrySample[]; k: keyof TelemetrySample; color?: string; min?: number; max?: number }) {
  const W = 300
  const H = 56
  const { line, area } = useMemo(() => {
    const vals = data.map((d) => Number(d[k]))
    if (vals.length < 2) return { line: '', area: '' }
    const lo = min ?? Math.min(...vals) - 0.5
    const hi = max ?? Math.max(...vals) + 0.5
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, H - ((v - lo) / Math.max(0.001, hi - lo)) * H] as const)
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    return { line, area: `${line} L${W} ${H} L0 ${H} Z` }
  }, [data, k, min, max])
  const last = data.length ? Number(data[data.length - 1][k]) : 0
  const lo = min ?? Math.min(...data.map((d) => Number(d[k]))) - 0.5
  const hi = max ?? Math.max(...data.map((d) => Number(d[k]))) + 0.5
  const ly = H - ((last - lo) / Math.max(0.001, hi - lo)) * H
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <path d={area} fill={color} opacity="0.06" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {data.length > 1 && <circle cx={W} cy={ly} r="3.5" fill={color} />}
    </svg>
  )
}

export function Air() {
  const ref = useRef<HTMLElement>(null)
  const phone = useRef<HTMLDivElement>(null)
  const telemetry = useApp((s) => s.telemetry)
  const source = useApp((s) => s.telemetrySource)
  const coughs = useApp((s) => s.coughs)
  const cur = telemetry[telemetry.length - 1]
  const gasAlert = (cur?.mq6 ?? 0) > 12

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onMove = (e: PointerEvent) => {
      if (!phone.current) return
      const r = el.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width - 0.5
      const y = (e.clientY - r.top) / r.height - 0.5
      phone.current.style.transform = `rotateY(${(-14 + x * 16).toFixed(2)}deg) rotateX(${(6 - y * 10).toFixed(2)}deg)`
    }
    el.addEventListener('pointermove', onMove)
    const ctx = gsap.context(() => {
      gsap.from('.tile', { y: 40, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.06, scrollTrigger: { trigger: '.tiles', start: 'top 85%' } })
      gsap.from('.phone', { y: 80, opacity: 0, rotateY: -30, duration: 1.6, ease: 'expo.out', scrollTrigger: { trigger: '.phone-wrap', start: 'top 85%' } })
    }, el)
    return () => {
      el.removeEventListener('pointermove', onMove)
      ctx.revert()
    }
  }, [])

  const hourAgo = Date.now() - 3600_000
  const gases: Array<[string, string, number, number]> = cur
    ? [
        ['Methane', 'CH₄', cur.methane, 40],
        ['Propane', 'C₃H₈', cur.propane, 60],
        ['Butane', 'C₄H₁₀', cur.butane, 40],
        ['LPG', 'mix', cur.lpg, 60],
      ]
    : []

  return (
    <section className="section air" id="air" ref={ref} aria-labelledby="air-title">
      <div className="section-head above">
        <div className="label">05 — Air quality</div>
        <h2 id="air-title" className="h2">
          Air you can
          <br />
          finally see.
        </h2>
        <p className="lead">The same device that hears coughs reads the room — and warns you when the air turns dangerous.</p>
      </div>

      <div className="air__grid above">
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="chip">
              <span className={`dot ${source === 'live' ? 'dot--live' : ''}`} style={{ color: source === 'live' ? undefined : 'var(--mute)' }} />
              {source === 'live' ? 'Live device feed' : source === 'connecting' ? 'Connecting…' : 'Simulated feed · connect a device'}
            </span>
            <span className="chip chip--line">Updated {cur ? new Date(cur.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}</span>
          </div>
          <div className="tiles">
            <div className="tile">
              <div className="tile__head">
                <span className="label">Temperature</span>
                <span className="label mute">°C</span>
              </div>
              <div className="tile__v">
                {cur ? cur.temp.toFixed(1) : '—'}
                <small>°C</small>
              </div>
              <Spark data={telemetry} k="temp" />
            </div>
            <div className="tile">
              <div className="tile__head">
                <span className="label">Humidity</span>
                <span className="label mute">RH</span>
              </div>
              <div className="tile__v">
                {cur ? Math.round(cur.hum) : '—'}
                <small>%</small>
              </div>
              <Spark data={telemetry} k="hum" color="var(--blue)" />
            </div>
            <div className="tile tile--wide" style={{ background: gasAlert ? 'var(--ink)' : undefined, color: gasAlert ? '#fff' : undefined, transition: 'background .5s, color .5s' }}>
              <div className="tile__head">
                <span className="label">MQ‑6 gas sensor</span>
                <span className="chip" style={{ background: gasAlert ? 'var(--alert)' : undefined, color: gasAlert ? '#fff' : undefined }}>
                  {gasAlert ? 'Gas level rising — ventilate' : 'Safe'}
                </span>
              </div>
              <div className="gases">
                {gases.map(([name, f, v, max]) => (
                  <div className="gas" key={name}>
                    <span className="label" style={{ opacity: 0.6 }}>
                      {name} · {f}
                    </span>
                    <b>
                      {v.toFixed(1)}
                      <small style={{ fontSize: 13, marginLeft: 4, opacity: 0.6 }}>ppm</small>
                    </b>
                    <div className="meter">
                      <i style={{ width: `${Math.min(100, (v / max) * 100)}%`, background: gasAlert ? 'var(--alert)' : undefined }} />
                    </div>
                  </div>
                ))}
              </div>
              <Spark data={telemetry} k="mq6" color={gasAlert ? 'var(--alert)' : 'var(--ink)'} min={0} />
            </div>
          </div>
          <p className="label mute" style={{ marginTop: 14, maxWidth: '62ch', lineHeight: 1.6 }}>
            Gas values are estimated from the MQ‑6 reading. Without a connected device, this panel shows a realistic simulation.
          </p>
        </div>

        <div className="phone-wrap">
          <div className="phone" ref={phone} style={{ transform: 'rotateY(-14deg) rotateX(6deg)' }}>
            <div className="phone__screen" aria-label="RespAI mobile app preview">
              <div className="app__head">
                <div className="app__logo" aria-hidden>
                  🫁
                </div>
                <div className="app__title">
                  Smart Cough
                  <br />
                  Monitor
                </div>
                <div className="app__sub">AI-powered health &amp; air quality tracking</div>
              </div>
              <div className="app__card app__status">
                <div className={`app__big ${live.flash > 0.2 ? 'is-cough' : ''}`}>✓</div>
                <b style={{ fontFamily: 'var(--mono)', fontWeight: 400, fontSize: 14 }}>System Active</b>
                <span style={{ color: '#7b7f8a', fontSize: 10.5 }}>Monitoring your health in real-time</span>
              </div>
              <div className="app__stats">
                <div className="app__card">
                  🔊<b>{coughs.length}</b>
                  <span style={{ fontSize: 10 }}>Total coughs today</span>
                </div>
                <div className="app__card">
                  ⏰<b style={{ color: '#ff7a1a' }}>{coughs.filter((c) => c.wallTime > hourAgo).length}</b>
                  <span style={{ fontSize: 10 }}>Last hour</span>
                </div>
              </div>
              <div className="app__card">
                <h5>Gas levels</h5>
                {gases.slice(0, 3).map(([name, f, v]) => (
                  <div className="app__row" key={name}>
                    <span>
                      {name} ({f})
                    </span>
                    <b>
                      {Math.round(v)} ppm <span style={{ color: v > 25 ? '#ff5a1f' : '#27ae60' }}>●</span>
                    </b>
                  </div>
                ))}
              </div>
              <div className="app__card">
                <h5>Health status</h5>
                <div className="app__row">
                  <span>Respiratory</span>
                  <b style={{ color: '#27ae60' }}>Good</b>
                </div>
                <div className="app__row">
                  <span>Cough level</span>
                  <b style={{ color: '#b8860b' }}>{coughs.length > 8 ? 'High' : coughs.length > 2 ? 'Moderate' : 'Low'}</b>
                </div>
                <div className="app__row">
                  <span>Environment</span>
                  <b style={{ color: gasAlert ? '#ff5a1f' : '#2f80ed' }}>{gasAlert ? 'Ventilate' : 'Optimal'}</b>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
