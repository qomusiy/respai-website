import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from '@react-three/drei'
import { OrbScene } from '../three/scenes'
import { getEngine, type RespEngine } from '../lib/audio/engine'
import type { AnalysisFrame, FileAnalysis, SampleKind } from '../lib/audio/types'
import { useApp, live } from '../lib/live'
import { oledCanvas, onOledDraw } from '../three/oled'
import { requestConsent } from './ConsentModal'
import { Mic, Play, Shield, Stop, Upload } from './icons'
import { drawColumn, fitCanvas } from './viz'
import { gsap } from '../lib/scroll'

const SAMPLES: Array<{ kind: SampleKind; label: string; hint: string }> = [
  { kind: 'cough', label: 'Cough', hint: 'single' },
  { kind: 'double-cough', label: 'Double cough', hint: 'x2' },
  { kind: 'speech', label: 'Speech', hint: 'should ignore' },
  { kind: 'clap', label: 'Claps', hint: 'should ignore' },
  { kind: 'noise', label: 'Fan noise', hint: 'should ignore' },
]

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
  const ring = useRef<SVGCircleElement>(null)
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
    if (ring.current) {
      ring.current.style.strokeDashoffset = String(1 - p)
      ring.current.style.stroke = p > 0.6 ? 'var(--alert)' : 'var(--cyan)'
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

  // idle spectrogram drift so the console never looks dead
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
      const vals = new Float32Array(40).map((_, i) => 0.05 + Math.random() * 0.06 * (1 - i / 50))
      drawColumn(ctx, colImg.current, vals, c.width - 1, c.height)
      if (ring.current) ring.current.style.strokeDashoffset = '1'
      if (stateEl.current && engineState !== 'listening' && engineState !== 'playing') {
        stateEl.current.textContent = 'Ready'
        stateEl.current.classList.remove('is-cough')
      }
    }
    raf = requestAnimationFrame(idle)
    return () => cancelAnimationFrame(raf)
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
          <div className="label mute">03 — Try it</div>
          <h2 id="try-title" className="h2">
            Cough.
            <br />
            We’ll hear it.
          </h2>
          <p className="lead">Turn on your microphone and cough — or play a sample. Resp‑1 runs right here in your browser, in real time.</p>

          <div style={{ marginTop: 22 }}>
            <span className="engine-badge" title={engineInfo?.name}>
              <span className={`dot ${isEI ? 'dot--live' : 'dot--cyan'}`} />
              {engineInfo ? (isEI ? 'Resp‑1 model · WebAssembly' : 'Preview engine · in-browser') : 'Loading engine…'}
            </span>
          </div>

          <div className="mic">
            <button ref={micBtn} className={`mic__btn ${listening ? 'is-on' : ''}`} onClick={toggleMic} aria-pressed={listening} aria-label={listening ? 'Stop microphone' : 'Start microphone'} disabled={!engine}>
              {listening ? <Stop /> : <Mic />}
            </button>
            <div className="mic__label">
              <strong>{listening ? 'Listening…' : engineState === 'loading' ? 'Starting…' : 'Start listening'}</strong>
              <span className="label mute">{listening ? 'Cough near your microphone' : 'Microphone · processed locally'}</span>
            </div>
          </div>
          {engineState === 'error' && engineError && (
            <p className="label" style={{ color: 'var(--alert)', marginTop: -10, marginBottom: 18 }}>
              {/denied|permission|notallowed/i.test(engineError) ? 'Microphone access was blocked — allow it in your browser settings, or try a sample below.' : engineError}
            </p>
          )}

          <div className="label mute">No mic? Play a sample</div>
          <div className="samples">
            {SAMPLES.map((s) => (
              <button key={s.kind} className={`sample ${playing === s.kind ? 'is-playing' : ''}`} onClick={() => play(s.kind)} disabled={!engine}>
                <Play /> {s.label} <em>{s.hint}</em>
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
              Resp‑1 console
            </span>
            <span className="label mute">{engineInfo ? `${engineInfo.sampleRate / 1000} kHz · ${engineInfo.windowMs} ms window` : '—'}</span>
          </div>

          <div className="console__stage">
            <View className="view" index={3}>
              <OrbScene scale={0.82} z={5.6} />
            </View>
            <svg className="console__ring" viewBox="0 0 100 100" aria-hidden>
              <circle cx="50" cy="50" r="48" fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="0.6" />
              <circle ref={ring} cx="50" cy="50" r="48" fill="none" stroke="var(--cyan)" strokeWidth="1.2" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="1" transform="rotate(-90 50 50)" style={{ transition: 'stroke-dashoffset .12s linear, stroke .3s' }} />
            </svg>
            <div className="console__oled" aria-label="Device screen replica">
              <canvas ref={oled} width={128} height={64} />
              <span className="label mute">What RespAI’s screen shows</span>
            </div>
            <div className="console__status">
              <div>
                <div className="label mute" style={{ marginBottom: 6 }}>
                  Status
                </div>
                <div ref={stateEl} className="console__state" aria-live="polite">
                  Ready
                </div>
              </div>
            </div>
          </div>

          <div className="spectro">
            <canvas ref={spectro} />
            <span className="label mute">Mel spectrogram · live</span>
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
