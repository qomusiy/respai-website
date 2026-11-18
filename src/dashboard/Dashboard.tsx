import { useCallback, useEffect, useRef, useState } from 'react'
import { LangSwitch } from '../components/Nav'
import { Mark, Mic, Stop, Upload } from '../components/icons'
import { useT, type Dict } from '../i18n'
import { analyze, DEFAULT_SERVER, fetchHealth, getOverride, resolveServers, ServerError, setOverride, type Analysis, type AnalyzeResponse, type Health, type Metrics } from './api'

type D = Dict['dash']
const MAX_RECORD_S = 7
const HISTORY_KEY = 'respai-history'
const ORDER = ['healthy_cough', 'upper_infection', 'lower_infection', 'obstructive_disease', 'COVID-19']

const pct = (v: number, locale: string, digits = 0) => (v * 100).toLocaleString(locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }) + '%'
/** browsers format Uzbek dates oddly ("2026 M11 18"); use the usual 18.11.2026, 13:57 there */
const fmtDate = (t: number, locale: string) =>
  locale.startsWith('uz')
    ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : new Date(t).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
const level = (p: number): 'low' | 'moderate' | 'high' => (p < 0.4 ? 'low' : p < 0.65 ? 'moderate' : 'high')

// —————————————————— server status ——————————————————
type Conn = { state: 'checking' | 'offline' | Health['status']; health?: Health }

const RESOLVE_EVERY = 60_000 // look the address up again at most once a minute (GitHub rate limit)

/**
 * Finds the analysis server and keeps watching it: the laptop can be switched on or off at any
 * time, and its public address changes when it restarts.
 */
function useServer(): Conn & { server: string | null; refresh: (resolve?: boolean) => void } {
  const [conn, setConn] = useState<Conn>({ state: 'checking' })
  const [server, setServerUrl] = useState<string | null>(null)
  const current = useRef<string | null>(null)
  const lastResolve = useRef(0)
  const tick = useRef(0)

  const check = useCallback(async (forceResolve = false) => {
    const id = ++tick.current
    const done = (c: Conn, url: string | null) => {
      if (id !== tick.current) return
      current.current = url
      setServerUrl(url)
      setConn(c)
    }
    if (current.current && !forceResolve) {
      try {
        const h = await fetchHealth(current.current)
        return done({ state: h.status, health: h }, current.current)
      } catch {
        // fall through: maybe the address changed
      }
    }
    if (!forceResolve && Date.now() - lastResolve.current < RESOLVE_EVERY) return done({ state: 'offline' }, current.current)
    lastResolve.current = Date.now()
    for (const url of await resolveServers()) {
      try {
        const h = await fetchHealth(url)
        return done({ state: h.status, health: h }, url)
      } catch {
        // try the next one
      }
    }
    done({ state: 'offline' }, null)
  }, [])

  useEffect(() => {
    check(true)
    const id = setInterval(() => check(false), 5000)
    return () => clearInterval(id)
  }, [check])
  return { ...conn, server, refresh: check }
}

// —————————————————— recording ——————————————————
function pickMime(): string {
  const options = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']
  if (typeof MediaRecorder === 'undefined') return ''
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
}

function useRecorder(onDone: (blob: Blob, name: string) => void, onProblem: (key: keyof D['record']) => void) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [lvl, setLvl] = useState(0)
  const stopRef = useRef<() => void>(() => {})

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return onProblem('unsupported')
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    } catch (e) {
      const name = (e as { name?: string })?.name
      return onProblem(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'micMissing' : 'micBlocked')
    }
    const mime = pickMime()
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)

    // live level meter, and a check for a muted microphone (pure digital silence)
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 2048
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Float32Array(an.fftSize)
    let peak = 0
    let raf = 0
    const t0 = performance.now()
    const loop = () => {
      an.getFloatTimeDomainData(buf)
      let m = 0
      for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]))
      peak = Math.max(peak, m)
      setLvl(Math.min(1, m * 1.6))
      const s = (performance.now() - t0) / 1000
      setElapsed(s)
      if (s >= MAX_RECORD_S) return stop()
      raf = requestAnimationFrame(loop)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      if (rec.state !== 'inactive') rec.stop()
    }
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      void ctx.close()
      setRecording(false)
      setLvl(0)
      if (peak < 1e-4) return onProblem('micSilent')
      const type = rec.mimeType || mime || 'audio/webm'
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
      onDone(new Blob(chunks, { type }), `cough.${ext}`)
    }
    stopRef.current = stop
    rec.start()
    setRecording(true)
    setElapsed(0)
    raf = requestAnimationFrame(loop)
  }
  return { recording, elapsed, lvl, start, stop: () => stopRef.current() }
}

// —————————————————— history ——————————————————
interface Past {
  t: number
  illness: number
  top: string
  type: string
}
function loadHistory(): Past[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as Past[]
  } catch {
    return []
  }
}
function saveHistory(h: Past[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 12)))
  } catch {
    // private mode: history just isn't kept
  }
}

// —————————————————— page ——————————————————
export function Dashboard() {
  const T = useT()
  const t = T.dash
  const conn = useServer()
  const server = conn.server
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnalyzeResponse | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [history, setHistory] = useState<Past[]>(loadHistory)
  const ready = conn.state === 'ready'

  const run = async (blob: Blob, name: string) => {
    if (!server) return
    setProblem(null)
    setResult(null)
    setBusy(true)
    try {
      const r = await analyze(server, blob, name)
      setResult(r)
      if (r.ok && r.is_cough) {
        const top = Object.entries(r.condition).sort((a, b) => b[1] - a[1])[0][0]
        const next = [{ t: Date.now(), illness: r.illness_probability, top, type: r.cough_type.wet > r.cough_type.dry ? 'wet' : 'dry' }, ...history]
        setHistory(next)
        saveHistory(next)
      }
    } catch (e) {
      setProblem(e instanceof ServerError ? e.message : t.server.offlineText)
      conn.refresh(true)
    } finally {
      setBusy(false)
    }
  }

  const rec = useRecorder(run, (key) => setProblem(t.record[key] as string))

  return (
    <div className="dash">
      <header className="dash__top">
        <a className="logo" href={import.meta.env.BASE_URL}>
          <Mark /> RespAI <small>{T.nav.by}</small>
        </a>
        <div className="dash__top-right">
          <LangSwitch />
          <a className="btn btn--sm btn--ghost" href={import.meta.env.BASE_URL}>
            ← {t.back}
          </a>
        </div>
      </header>

      <main className="dash__main">
        <div className="dash__head">
          <span className="eyebrow">
            HeAR · Google Health AI <span className="chip">{t.beta}</span>
          </span>
          <h1 className="h2">{t.title}</h1>
          <p className="lead">{t.lead}</p>
        </div>

        <ServerStatus t={t} conn={conn} server={server} onChange={(url) => (setOverride(url), conn.refresh(true))} />

        <div className="dash__grid">
          <section className="card" aria-labelledby="rec-title">
            <h2 id="rec-title" className="card__title">
              {t.record.title}
            </h2>
            <p className="mute card__hint">{t.record.hint}</p>
            <div className="recorder">
              <button className={`mic__btn ${rec.recording ? 'is-on' : ''}`} style={{ ['--lvl' as string]: rec.lvl }} disabled={!ready || busy} onClick={rec.recording ? rec.stop : rec.start} aria-label={rec.recording ? t.record.stop : t.record.start}>
                {rec.recording ? <Stop /> : <Mic />}
              </button>
              <div>
                <strong className="recorder__label">{rec.recording ? t.record.recording(rec.elapsed.toLocaleString(T.locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })) : busy ? t.record.analysing : t.record.start}</strong>
                <div className="recorder__bar">
                  <i style={{ transform: `scaleX(${rec.recording ? rec.elapsed / MAX_RECORD_S : 0})` }} />
                </div>
              </div>
            </div>
            <div className="dash__or">
              <span>{t.record.or}</span>
            </div>
            <label className={`drop drop--light ${!ready || busy ? 'is-disabled' : ''}`}>
              <Upload />
              <span>
                <b style={{ fontWeight: 500 }}>{t.record.upload}</b>
                <br />
                <span className="mute" style={{ fontSize: 13 }}>
                  {t.record.uploadHint}
                </span>
              </span>
              <input
                type="file"
                accept="audio/*,.webm,.ogg,.m4a,.mp3,.wav"
                hidden
                disabled={!ready || busy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) run(f, f.name)
                }}
              />
            </label>
            {problem && (
              <p className="dash__problem" role="alert">
                {problem}
              </p>
            )}
            <p className="dash__consent mute">{t.record.consent}</p>
          </section>

          <section className="card card--result" aria-labelledby="res-title" aria-live="polite" aria-busy={busy}>
            <h2 id="res-title" className="card__title">
              {t.result.title}
            </h2>
            {busy ? <div className="dash__spinner" aria-label={t.record.analysing} /> : <ResultView t={t} locale={T.locale} result={result} />}
          </section>
        </div>

        {conn.health?.metrics && 'condition' in conn.health.metrics && <Accuracy t={t} locale={T.locale} m={conn.health.metrics as Metrics} />}

        <section className="card" aria-labelledby="hist-title">
          <div className="card__row">
            <h2 id="hist-title" className="card__title">
              {t.history.title}
            </h2>
            {history.length > 0 && (
              <button className="btn btn--sm btn--ghost" onClick={() => (setHistory([]), saveHistory([]))}>
                {t.history.clear}
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="mute">{t.history.empty}</p>
          ) : (
            <ul className="history">
              {history.map((h) => (
                <li key={h.t}>
                  <span className="mute">{fmtDate(h.t, T.locale)}</span>
                  <span className={`lvl lvl--${level(h.illness)}`}>
                    {t.result.level[level(h.illness)]} · {pct(h.illness, T.locale)}
                  </span>
                  <span>{t.result.conditions[h.top]?.name}</span>
                  <span className="mute">{h.type === 'wet' ? t.result.wet : t.result.dry}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mute" style={{ fontSize: 13, marginTop: 12 }}>
            {t.history.note}
          </p>
        </section>

        <p className="dash__foot mute">{T.footer.noteText}</p>
      </main>
    </div>
  )
}

// —————————————————— pieces ——————————————————
function ServerStatus({ t, conn, server, onChange }: { t: D; conn: Conn; server: string | null; onChange: (url: string | null) => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(getOverride() ?? '')
  useEffect(() => setValue(getOverride() ?? ''), [server])
  const label = { checking: t.server.checking, ready: t.server.ready, loading: t.server.loading, offline: t.server.offline, error: t.server.error }[conn.state]
  return (
    <div className={`status status--${conn.state}`}>
      <div className="status__row">
        <span className="status__pill">
          <span className="dot" /> {label}
        </span>
        <button className="status__toggle mute" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {t.server.settings}
        </button>
      </div>
      {conn.state === 'offline' && <p className="status__text">{t.server.offlineText}</p>}
      {conn.state === 'error' && conn.health?.error && <p className="status__text">{conn.health.error}</p>}
      {open && (
        <div className="status__settings">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onChange(value.trim() || null)
            }}
          >
            <input value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} aria-label={t.server.settings} placeholder={server ?? DEFAULT_SERVER} />
            <button className="btn btn--sm btn--dark" type="submit">
              {t.server.save}
            </button>
            <button className="btn btn--sm btn--ghost" type="button" onClick={() => onChange(null)}>
              {t.server.reset}
            </button>
          </form>
          <p className="mute" style={{ fontSize: 13, margin: '12px 0 6px' }}>
            <b style={{ fontWeight: 500 }}>{t.server.ownerTitle}</b> {t.server.ownerText}
          </p>
          <code className="status__code">systemctl --user start respai-ai respai-tunnel</code>
        </div>
      )}
    </div>
  )
}

function Bar({ value, tone = 'ink' }: { value: number; tone?: 'ink' | 'alert' | 'good' | 'mute' }) {
  return (
    <span className={`pbar pbar--${tone}`}>
      <i style={{ transform: `scaleX(${Math.max(0, Math.min(1, value))})` }} />
    </span>
  )
}

function ResultView({ t, locale, result }: { t: D; locale: string; result: AnalyzeResponse | null }) {
  if (!result) return <p className="mute">{t.result.empty}</p>
  if (!result.ok)
    return (
      <div className="result__notice">
        <h3>{t.result.silent}</h3>
        <p className="mute">{t.result.silentText}</p>
      </div>
    )
  const r = result as Analysis
  if (!r.is_cough)
    return (
      <div className="result__notice">
        <h3>{t.result.notCough}</h3>
        <p className="mute">{t.result.notCoughText}</p>
        <p className="mute" style={{ fontSize: 13 }}>
          {t.result.coughConfidence(pct(r.cough_probability, locale))}
        </p>
      </div>
    )
  const lv = level(r.illness_probability)
  const conds = ORDER.map((k) => [k, r.condition[k] ?? 0] as const).sort((a, b) => b[1] - a[1])
  const top = conds[0][0]
  return (
    <div className="result">
      <div className={`result__level lvl--${lv}`}>
        <span className="label mute">{t.result.signs}</span>
        <div className="result__big">
          {t.result.level[lv]}
          <small>{pct(r.illness_probability, locale)}</small>
        </div>
        <Bar value={r.illness_probability} tone={lv === 'low' ? 'good' : lv === 'moderate' ? 'ink' : 'alert'} />
        <p>{t.result.levelText[lv]}</p>
      </div>

      <div>
        <span className="label mute">{t.result.pattern}</span>
        <ul className="conds">
          {conds.map(([k, v]) => (
            <li key={k} className={k === top ? 'is-top' : ''}>
              <span>
                {t.result.conditions[k]?.name}
                {t.result.conditions[k]?.note && <small> · {t.result.conditions[k].note}</small>}
              </span>
              <Bar value={v} tone={k === top ? 'ink' : 'mute'} />
              <b>{pct(v, locale)}</b>
            </li>
          ))}
        </ul>
      </div>

      <div className="result__type">
        <span className="label mute">{t.result.type}</span>
        <span>
          {t.result.dry} <b>{pct(r.cough_type.dry ?? 0, locale)}</b>
        </span>
        <span>
          {t.result.wet} <b>{pct(r.cough_type.wet ?? 0, locale)}</b>
        </span>
      </div>

      <p className="mute" style={{ fontSize: 13, margin: 0 }}>
        {t.result.coughConfidence(pct(r.cough_probability, locale))} ·{' '}
        {t.result.timing(r.audio.seconds.toLocaleString(locale), (r.ms / 1000).toLocaleString(locale, { maximumFractionDigits: 1 }))}
      </p>

      <div className="result__warn">
        <b>{t.result.warningTitle}.</b> {t.result.warning}
      </div>
    </div>
  )
}

function Accuracy({ t, locale, m }: { t: D; locale: string; m: Metrics }) {
  const a = t.accuracy
  const num = (v: number, d = 2) => v.toLocaleString(locale, { maximumFractionDigits: d, minimumFractionDigits: d })
  const rows: Array<[string, string, string]> = [
    [a.cough, pct(m.cough.balanced_accuracy, locale), a.recordings(m.cough.n.toLocaleString(locale))],
    [a.illness, `AUC ${num(m.condition.illness_auc)}`, a.illnessNote],
    [a.condition, pct(m.condition.balanced_accuracy, locale), a.conditionNote(pct(m.condition.chance, locale))],
    [a.type, pct(m.type.balanced_accuracy, locale), a.recordings(m.type.n.toLocaleString(locale))],
  ]
  return (
    <section className="card" aria-labelledby="acc-title">
      <h2 id="acc-title" className="card__title">
        {a.title}
      </h2>
      <p className="mute card__hint">{a.lead}</p>
      <div className="acc">
        {rows.map(([label, value, note]) => (
          <div key={label}>
            <span className="label mute">{label}</span>
            <b>{value}</b>
            <small className="mute">{note}</small>
          </div>
        ))}
      </div>
      <span className="label mute">{a.perClass}</span>
      <ul className="conds conds--compact">
        {ORDER.map((k) => (
          <li key={k}>
            <span>
              {t.result.conditions[k]?.name} <small>· {a.recordings((m.condition.counts[k] ?? 0).toLocaleString(locale))}</small>
            </span>
            <Bar value={m.condition.recall[k] ?? 0} tone="mute" />
            <b>{pct(m.condition.recall[k] ?? 0, locale)}</b>
          </li>
        ))}
      </ul>
      <p className="acc__honest">{a.honest}</p>
      <p className="mute" style={{ fontSize: 13, margin: 0 }}>
        {a.source}
      </p>
    </section>
  )
}
