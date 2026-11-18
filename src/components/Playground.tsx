import { useEffect, useMemo, useRef, useState } from 'react'
import { getEngine, type RespEngine } from '../lib/audio/engine'
import type { AnalysisFrame, FileAnalysis, SampleKind } from '../lib/audio/types'
import { useApp, live } from '../lib/live'
import { oledCanvas, onOledDraw } from '../three/oled'
import { requestConsent } from './ConsentModal'
import { Mic, Play, Shield, Stop, Upload } from './icons'
import { drawColumn, fitCanvas } from './viz'
import { gsap } from '../lib/scroll'

const SAMPLES: Array<{ kind: SampleKind; label: string; hint: string }> = [
  { kind: 'cough', label: 'Cough', hint: '' },
  { kind: 'double-cough', label: 'Double cough', hint: '' },
  { kind: 'speech', label: 'Speech', hint: 'should be ignored' },
  { kind: 'clap', label: 'Claps', hint: 'should be ignored' },
  { kind: 'noise', label: 'Fan noise', hint: 'should be ignored' },
]

/** A muted or disconnected input delivers exact zeros (≈ −120 dBFS); a real room never drops below ≈ −95. */
const SILENT_DB = -105
const SILENT_CHECK_MS = 2500
const SILENCE = new Float32Array(40)

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function Playground() {
  const ref = useRef<HTMLElement>(null)
  const [engine, setEngine] = useState<RespEngine | null>(null)
  const engineRef = useRef<RespEngine | null>(null)
  const engineState = useApp((s) => s.engineState)
  const engineInfo = useApp((s) => s.engineInfo)
  const engineError = useApp((s) => s.engineError)
  const coughs = useApp((s) => s.coughs)
  const [playing, setPlaying] = useState<SampleKind | null>(null)
  const [file, setFile] = useState<{ name: string; result?: FileAnalysis; busy: boolean; error?: string } | null>(null)
  const [over, setOver] = useState(false)

  const spectro = useRef<HTMLCanvasElement>(null)
  const oled = useRef<HTMLCanvasElement>(null)
  const stateEl = useRef<HTMLDivElement>(null)
  const levelBar = useRef<HTMLElement>(null)
  const micPeakDb = useRef(-200)
  const silentRef = useRef(false)
  const [silentMic, setSilentMic] = useState(false)
  const barCough = useRef<HTMLElement>(null)
  const barNoise = useRef<HTMLElement>(null)
  const valCough = useRef<HTMLSpanElement>(null)
  const valNoise = useRef<HTMLSpanElement>(null)
  const micBtn = useRef<HTMLButtonElement>(null)
  const lastFrame = useRef(0)

  // ——— engine bootstrap ———
  useEffect(() => {
    let alive = true
    const offs: Array<() => void> = []
    getEngine()
      .then((e) => {
        if (!alive) return
        setEngine(e)
        engineRef.current = e
        const st = useApp.getState()
        st.setEngineInfo(e.info)
        st.setEngineState(e.state) // state is not replayed to new subscribers
        offs.push(
          e.on('state', (s, err) => useApp.getState().setEngineState(s, err)),
          e.on('cough', (d) => useApp.getState().addCough(d)),
          e.on('frame', onFrame),
        )
      })
      .catch((err) => useApp.getState().setEngineState('error', String(err?.message ?? err)))
    return () => {
      alive = false
      offs.forEach((f) => f())
      // release the mic / AudioContext on unmount and hot-reload
      if (engineRef.current) {
        engineRef.current.dispose()
        engineRef.current = null
        useApp.getState().setEngineState('idle')
      }
    }
  }, [])

  // ——— per-frame visuals (no React re-render) ———
  const colImg = useRef<ImageData | null>(null)
  function onFrame(f: AnalysisFrame) {
    live.level = f.level
    live.prob = f.prob
    live.label = f.label
    live.lastFrameAt = performance.now()
    lastFrame.current = performance.now()
    const c = spectro.current
    if (c) {
      fitCanvas(c, 1.5)
      const ctx = c.getContext('2d')!
      const step = 2
      if (!colImg.current || colImg.current.height !== c.height) colImg.current = ctx.createImageData(1, c.height)
      ctx.drawImage(c, -step, 0)
      const alert = f.prob > 0.6 ? Math.min(1, (f.prob - 0.6) * 3) : 0
      for (let i = step; i > 0; i--) drawColumn(ctx, colImg.current, f.mel, c.width - i, c.height, alert)
    }
    const p = f.prob
    if (levelBar.current) levelBar.current.style.transform = `scaleX(${f.level.toFixed(3)})`
    if (f.db > micPeakDb.current) micPeakDb.current = f.db
    if (silentRef.current && f.db > SILENT_DB) {
      silentRef.current = false
      setSilentMic(false)
    }
    if (barCough.current) barCough.current.style.transform = `scaleX(${p})`
    if (barNoise.current) barNoise.current.style.transform = `scaleX(${f.label === 'silence' ? 0 : 1 - p})`
    if (valCough.current) valCough.current.textContent = p.toFixed(2)
    if (valNoise.current) valNoise.current.textContent = (f.label === 'silence' ? 0 : 1 - p).toFixed(2)
    if (stateEl.current) {
      const cough = f.label === 'cough' || p > 0.6
      const txt = cough ? 'Cough detected' : f.label === 'silence' ? 'Listening…' : 'Noise'
      if (stateEl.current.textContent !== txt) stateEl.current.textContent = txt
      stateEl.current.classList.toggle('is-cough', cough)
    }
    micBtn.current?.style.setProperty('--lvl', f.level.toFixed(3))
  }

  // with no audio flowing, keep scrolling silence so the graph only ever shows real data
  useEffect(() => {
    const c = spectro.current
    if (!c) return
    let raf = 0
    const idle = () => {
      raf = requestAnimationFrame(idle)
      if (performance.now() - lastFrame.current < 400) return
      fitCanvas(c, 1.5)
      const ctx = c.getContext('2d')!
      if (!colImg.current || colImg.current.height !== c.height) colImg.current = ctx.createImageData(1, c.height)
      ctx.drawImage(c, -1, 0)
      drawColumn(ctx, colImg.current, SILENCE, c.width - 1, c.height)
      if (levelBar.current) levelBar.current.style.transform = 'scaleX(0)'
      if (stateEl.current && engineState !== 'listening' && engineState !== 'playing') {
        stateEl.current.textContent = 'Ready'
        stateEl.current.classList.remove('is-cough')
      }
    }
    raf = requestAnimationFrame(idle)
    return () => cancelAnimationFrame(raf)
  }, [engineState])

  // A mic that only ever delivers digital silence is muted or unplugged at the OS level:
  // the browser reports it as working, so say so instead of looking broken.
  useEffect(() => {
    if (engineState !== 'listening') {
      silentRef.current = false
      setSilentMic(false)
      return
    }
    micPeakDb.current = -200
    const id = setInterval(() => {
      const silent = micPeakDb.current <= SILENT_DB
      if (silent !== silentRef.current) {
        silentRef.current = silent
        setSilentMic(silent)
      }
      micPeakDb.current = -200
    }, SILENT_CHECK_MS)
    return () => clearInterval(id)
  }, [engineState])

  // OLED replica (same framebuffer as the 3D device)
  useEffect(() => {
    const c = oled.current
    if (!c || !oledCanvas) return
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    return onOledDraw(() => {
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(oledCanvas, 0, 0)
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = '#5ff6ff'
      ctx.fillRect(0, 0, 128, 64)
      ctx.globalCompositeOperation = 'source-over'
    })
  }, [])

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from('.console', { y: 60, opacity: 0, duration: 1.3, ease: 'expo.out', scrollTrigger: { trigger: '.console', start: 'top 85%' } })
    }, ref)
    return () => ctx.revert()
  }, [])

  // ——— actions ———
  const listening = engineState === 'listening'
  // startMic() must be called synchronously inside the click (autoplay / Safari rules)
  const toggleMic = () => {
    if (!engine) return
    if (listening) return engine.stopMic()
    requestConsent(() => {
      engine.startMic().catch((e: unknown) => useApp.getState().setEngineState('error', e instanceof Error ? e.message : String(e)))
    })
  }
  const play = async (k: SampleKind) => {
    if (!engine || playing) return
    setPlaying(k)
    try {
      await engine.playSample(k)
    } finally {
      setPlaying(null)
    }
  }
  const analyze = async (f: File) => {
    if (!engine) return
    setFile({ name: f.name, busy: true })
    try {
      const result = await engine.analyzeFile(f)
      setFile({ name: f.name, busy: false, result })
    } catch (e) {
      setFile({ name: f.name, busy: false, error: e instanceof Error ? e.message : 'Could not decode this file' })
    }
  }

  const stats = useMemo(() => {
    const hourAgo = Date.now() - 3600_000
    const lastHour = coughs.filter((c) => c.wallTime > hourAgo).length
    const avg = coughs.length ? coughs.reduce((a, c) => a + c.prob, 0) / coughs.length : 0
    return { total: coughs.length, lastHour, avg }
  }, [coughs])

  const isEI = engineInfo?.kind === 'edge-impulse'

  return (
    <section className="section section--night play" id="try" data-nav="dark" ref={ref} aria-labelledby="try-title">
      <div className="play__grid">
        <div className="play__intro">
          <span className="eyebrow">Live demo</span>
          <h2 id="try-title" className="h2">
            Try the detector in your browser
          </h2>
          <p className="lead" style={{ marginTop: 20 }}>
            Turn on your microphone and cough, or play one of the sample sounds. Detection runs inside this browser tab in real time, and no audio is uploaded.
          </p>

          <div style={{ marginTop: 22 }}>
            <span className="engine-badge" title={isEI ? engineInfo?.name : 'A lightweight detector built for this website. The device itself runs the Resp‑1 model.'}>
              <span className={`dot ${isEI ? 'dot--live' : 'dot--cyan'}`} />
              {engineInfo ? (isEI ? 'Resp‑1 model, WebAssembly build' : 'Browser version of the detector') : 'Loading…'}
            </span>
          </div>

          <div className="mic">
            <button ref={micBtn} className={`mic__btn ${listening ? 'is-on' : ''}`} onClick={toggleMic} aria-pressed={listening} aria-label={listening ? 'Stop microphone' : 'Start microphone'} disabled={!engine}>
              {listening ? <Stop /> : <Mic />}
            </button>
            <div className="mic__label">
              <strong>{listening ? 'Listening…' : engineState === 'loading' ? 'Starting…' : 'Start listening'}</strong>
              <span className="label mute">{listening ? 'Cough near your microphone' : 'Uses your microphone, processed on this device'}</span>
            </div>
          </div>
          {engineState === 'error' && engineError && (
            <p className="mic-warning" role="alert">
              {/denied/i.test(engineError) ? (
                <>
                  <b>Microphone access was blocked.</b> Allow it for this site in your browser settings, or play a sample below.
                </>
              ) : /HTTPS/i.test(engineError) ? (
                <>
                  <b>The microphone needs a secure connection.</b> Open the site over https:// (or on localhost). The samples below still work.
                </>
              ) : /found/i.test(engineError) ? (
                <>
                  <b>No microphone was found.</b> Connect one, or check that your system detects it, then try again.
                </>
              ) : (
                engineError
              )}
            </p>
          )}
          {silentMic && (
            <p className="mic-warning" role="alert">
              <b>No sound is reaching the page.</b> Your microphone is on but only sending silence. It is most likely muted in your computer&rsquo;s sound settings (or with a mic-mute key), or a different input device is selected.
            </p>
          )}

          <div className="label mute">Or play a sample sound</div>
          <div className="samples">
            {SAMPLES.map((s) => (
              <button key={s.kind} className={`sample ${playing === s.kind ? 'is-playing' : ''}`} onClick={() => play(s.kind)} disabled={!engine}>
                <Play /> {s.label} {s.hint && <em>{s.hint}</em>}
              </button>
            ))}
          </div>

          <label
            className={`drop ${over ? 'is-over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              const f = e.dataTransfer.files?.[0]
              if (f) analyze(f)
            }}
          >
            <Upload />
            <span>
              <b style={{ fontWeight: 500 }}>Analyse a recording</b>
              <br />
              <span className="mute" style={{ fontSize: 13 }}>
                Drop an audio file (wav, mp3, m4a, ogg) or click to choose
              </span>
            </span>
            <input type="file" accept="audio/*" hidden onChange={(e) => e.target.files?.[0] && analyze(e.target.files[0])} />
          </label>

          <p className="privacy-note">
            <Shield /> Audio never leaves your device. Resp‑1 is a screening aid, not a medical diagnosis.
          </p>
        </div>

        <div className="console">
          <div className="console__top">
            <span className="label">
              <span className="dot dot--live" style={{ marginRight: 8, verticalAlign: '1px', opacity: listening ? 1 : 0.3 }} />
              Detector output
            </span>
            <span className="label mute">{engineInfo ? `${engineInfo.sampleRate / 1000} kHz · ${engineInfo.windowMs} ms window` : ''}</span>
          </div>

          <div className="console__stage">
            <div>
              <div className="label mute">Status</div>
              <div ref={stateEl} className="console__state" aria-live="polite">
                Ready
              </div>
              <div className="level">
                <span className="label mute">Input level</span>
                <span className="level__bar">
                  <i ref={levelBar} />
                </span>
              </div>
            </div>
            <figure className="console__oled">
              <div className="bezel">
                <canvas ref={oled} width={128} height={64} aria-label="Replica of the device screen" />
              </div>
              <figcaption className="label mute">Same view as the device screen</figcaption>
            </figure>
          </div>

          <div className="spectro">
            <canvas ref={spectro} />
            <span className="label mute">Mel spectrogram, live</span>
            <div className="spectro__axis">
              <span>8k</span>
              <span>2k</span>
              <span>0</span>
            </div>
          </div>

          <div className="console__grid">
            <div>
              <span className="label mute">Classification</span>
              <div className="probs">
                <div className="prob__row">
                  <span>Cough</span>
                  <span className="prob__bar">
                    <i ref={barCough} style={{ background: 'var(--alert)', transform: 'scaleX(0)' }} />
                  </span>
                  <span ref={valCough}>0.00</span>
                </div>
                <div className="prob__row">
                  <span>Noise</span>
                  <span className="prob__bar">
                    <i ref={barNoise} style={{ background: 'var(--cyan)', transform: 'scaleX(0)' }} />
                  </span>
                  <span ref={valNoise}>0.00</span>
                </div>
              </div>
              <div className="counters">
                <div className="counter">
                  <b>{stats.total}</b>
                  <span className="label mute">Total</span>
                </div>
                <div className="counter">
                  <b>{stats.lastHour}</b>
                  <span className="label mute">Last hour</span>
                </div>
                <div className="counter">
                  <b>{stats.total ? Math.round(stats.avg * 100) : '—'}</b>
                  <span className="label mute">Avg conf. %</span>
                </div>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="label mute">Activity</span>
                {coughs.length > 0 && (
                  <button className="label mute" onClick={() => useApp.getState().resetCoughs()}>
                    Reset
                  </button>
                )}
              </div>
              {coughs.length === 0 ? (
                <div className="log__empty">No coughs yet. Try the mic or a sample.</div>
              ) : (
                <ul className="log">
                  {coughs.slice(0, 30).map((c) => (
                    <li key={c.id}>
                      <span className="dot" />
                      <span>
                        Cough detected <small>· {c.source}</small>
                        <br />
                        <small>
                          p={c.prob.toFixed(2)} · {Math.round(c.durationMs)} ms · {Math.round(c.peakDb)} dB
                        </small>
                      </span>
                      <small>{fmtTime(c.wallTime)}</small>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {file && (
            <div className="file-result">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                <span className="label">{file.name}</span>
                <span className="label mute">
                  {file.busy ? 'Analysing…' : file.error ? 'Error' : `${file.result!.detections.length} cough${file.result!.detections.length === 1 ? '' : 's'} · ${file.result!.durationSec.toFixed(1)} s`}
                </span>
              </div>
              {file.error && <p className="label" style={{ color: 'var(--alert)' }}>{file.error}</p>}
              {file.result && <FileTimeline result={file.result} />}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function FileTimeline({ result }: { result: FileAnalysis }) {
  const W = 600
  const H = 64
  const env = result.envelope
  const d = useMemo(() => {
    let s = `M0 ${H / 2}`
    for (let i = 0; i < env.length; i++) {
      const x = (i / (env.length - 1)) * W
      s += ` L${x.toFixed(1)} ${(H / 2 - env[i] * (H / 2 - 2)).toFixed(1)}`
    }
    for (let i = env.length - 1; i >= 0; i--) {
      const x = (i / (env.length - 1)) * W
      s += ` L${x.toFixed(1)} ${(H / 2 + env[i] * (H / 2 - 2)).toFixed(1)}`
    }
    return s + 'Z'
  }, [env])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Recording timeline with detected coughs">
      <path d={d} fill="rgba(255,255,255,.22)" />
      {result.detections.map((det) => {
        const x = (det.offsetSec / Math.max(0.01, result.durationSec)) * W
        const w = Math.max(3, (det.durationMs / 1000 / Math.max(0.01, result.durationSec)) * W)
        return <rect key={det.id} x={x} y={0} width={w} height={H} fill="rgba(255,90,31,.45)" />
      })}
    </svg>
  )
}
