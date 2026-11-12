import { useEffect, useRef } from 'react'
import { View } from '@react-three/drei'
import { OrbScene } from '../three/scenes'
import { gsap, ScrollTrigger, scrollToId } from '../lib/scroll'
import { ArrowDown } from './icons'
import { drawColumn, fitCanvas, whileVisible } from './viz'

const SPECS = [
  { v: 83.6, d: 1, unit: '%', label: 'Validation accuracy · float32' },
  { v: 80.4, d: 1, unit: '%', label: 'Test accuracy · float32' },
  { v: 164, d: 0, unit: 'ms', label: 'Latency · int8 on‑device' },
  { v: 15.4, d: 1, unit: 'KB', label: 'Peak RAM · int8' },
  { v: 80, d: 0, unit: 'MHz', label: 'Benchmark MCU · Cortex‑M4F' },
  { v: 0, d: 0, unit: 'bytes', label: 'Audio sent to the cloud' },
]

const STEPS = [
  { t: 'Listen', p: 'A digital microphone on the device hears the room continuously.' },
  { t: 'Waveform', p: 'Audio is cut into short, overlapping windows of sound.' },
  { t: 'Spectrogram', p: 'Each window becomes a mel spectrogram — a picture of the sound’s energy.' },
  { t: 'Neural network', p: 'A compact, int8-quantised network scores the picture.' },
  { t: 'Decision', p: 'Cough or noise. Coughs are counted, logged and synced to the app.' },
]

// ——— small looping visualisations for each pipeline step ———
function StepViz({ kind }: { kind: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')!
    let col: ImageData | null = null
    const cough = (t: number) => {
      const k = (t / 2600) % 1
      return k < 0.16 ? Math.sin((k / 0.16) * Math.PI) : 0
    }
    return whileVisible(c, (t) => {
      const { w, h, dpr } = fitCanvas(c)
      if (kind === 2) {
        // scrolling spectrogram, 1 px column per frame
        const W = c.width
        const H = c.height
        const column = (tt: number, x: number) => {
          const vals = new Float32Array(32)
          const cg = cough(tt)
          for (let i = 0; i < 32; i++) {
            const base = 0.12 + 0.12 * Math.random() * (1 - i / 40)
            vals[i] = base + cg * (0.55 + 0.35 * Math.random()) * (i > 3 ? 1 : 0.6)
          }
          drawColumn(ctx, col!, vals, x, H, cg > 0.2 ? 0.6 : 0)
        }
        if (!col || col.height !== H) {
          // (re)fill the whole history so it never starts empty
          col = ctx.createImageData(1, H)
          for (let x = 0; x < W; x++) column(t - (W - x) * 16, x)
          return
        }
        ctx.drawImage(c, -1, 0)
        column(t, W - 1)
        return
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (kind === 0) {
        // mic with expanding rings
        const cx = w / 2
        const cy = h / 2
        for (let i = 0; i < 4; i++) {
          const k = ((t / 1800 + i / 4) % 1)
          ctx.strokeStyle = `rgba(56,232,245,${(1 - k) * 0.5})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(cx, cy, 14 + k * Math.min(w, h) * 0.45, 0, Math.PI * 2)
          ctx.stroke()
        }
        ctx.fillStyle = '#eceef2'
        ctx.beginPath()
        ctx.roundRect(cx - 7, cy - 16, 14, 24, 7)
        ctx.fill()
        ctx.strokeStyle = '#eceef2'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(cx, cy - 2, 13, 0.15 * Math.PI, 0.85 * Math.PI)
        ctx.moveTo(cx, cy + 11)
        ctx.lineTo(cx, cy + 18)
        ctx.stroke()
      } else if (kind === 1) {
        ctx.strokeStyle = '#eceef2'
        ctx.lineWidth = 1.2
        ctx.beginPath()
        for (let x = 0; x < w; x++) {
          const tt = t / 1000 - (w - x) / 120
          const k = ((tt * 1000) / 2600) % 1
          const burst = k > 0 && k < 0.16 ? Math.sin((k / 0.16) * Math.PI) * Math.exp(-k * 8) * 2.2 : 0
          const v = (Math.sin(x * 1.7 + t / 50) * 0.5 + Math.sin(x * 0.63) * 0.5) * (0.06 + burst)
          const y = h / 2 + v * h * 0.45
          if (x === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.stroke()
        // window brackets
        const ww = w * 0.28
        const wx = ((t / 14) % (w + ww)) - ww
        ctx.fillStyle = 'rgba(56,232,245,0.08)'
        ctx.fillRect(wx, 10, ww, h - 20)
        ctx.strokeStyle = 'rgba(56,232,245,0.6)'
        ctx.strokeRect(wx + 0.5, 10.5, ww, h - 21)
      } else if (kind === 3) {
        const layers = [3, 5, 5, 2]
        const xs = layers.map((_, i) => 24 + (i * (w - 48)) / (layers.length - 1))
        const pos = layers.map((n, i) => Array.from({ length: n }, (_, j) => [xs[i], h / 2 + (j - (n - 1) / 2) * Math.min(24, (h - 30) / n)] as [number, number]))
        const pulse = (t / 900) % 1
        for (let i = 0; i < pos.length - 1; i++) {
          for (const a of pos[i])
            for (const b of pos[i + 1]) {
              const k = Math.max(0, 1 - Math.abs(pulse * 3 - i - 0.5) * 2)
              ctx.strokeStyle = `rgba(120,160,255,${0.12 + k * 0.45})`
              ctx.lineWidth = 0.8
              ctx.beginPath()
              ctx.moveTo(a[0], a[1])
              ctx.lineTo(b[0], b[1])
              ctx.stroke()
            }
        }
        pos.forEach((layer, i) =>
          layer.forEach(([x, y], j) => {
            const k = Math.max(0, 1 - Math.abs(pulse * 3 - i + 0.2) * 2)
            ctx.fillStyle = i === 3 && j === 0 ? '#ff5a1f' : k > 0.3 ? '#38e8f5' : '#2a3142'
            ctx.beginPath()
            ctx.arc(x, y, i === 3 ? 6 : 5, 0, Math.PI * 2)
            ctx.fill()
          }),
        )
      } else if (kind === 4) {
        const cg = cough(t) > 0.05 ? 1 : 0
        const pc = 0.06 + cg * 0.85 + Math.sin(t / 200) * 0.02
        const rows: Array<[string, number, string]> = [
          ['Cough', pc, '#ff5a1f'],
          ['Noise', 1 - pc, '#38e8f5'],
        ]
        rows.forEach(([label, v, color], i) => {
          const y = h / 2 - 22 + i * 36
          ctx.fillStyle = '#8b919c'
          ctx.font = '12px "Geist Mono Variable", monospace'
          ctx.fillText(label.toUpperCase(), 16, y)
          ctx.fillText(v.toFixed(2), w - 46, y)
          ctx.fillStyle = 'rgba(255,255,255,0.08)'
          ctx.fillRect(16, y + 8, w - 32, 6)
          ctx.fillStyle = color
          ctx.fillRect(16, y + 8, (w - 32) * Math.max(0, Math.min(1, v)), 6)
        })
      }
    })
  }, [kind])
  return <canvas ref={ref} />
}

export function ModelSection() {
  const ref = useRef<HTMLElement>(null)
  const pipe = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const ctx = gsap.context(() => {
      // count-up specs
      ref.current?.querySelectorAll<HTMLElement>('[data-count]')?.forEach((el) => {
        const to = parseFloat(el.dataset.count || '0')
        const d = parseInt(el.dataset.dec || '0')
        const o = { v: 0 }
        gsap.to(o, {
          v: to,
          duration: 1.8,
          ease: 'expo.out',
          scrollTrigger: { trigger: el, start: 'top 90%' },
          onUpdate: () => (el.firstChild!.textContent = o.v.toFixed(d)),
        })
      })
      gsap.from('.model__corner', { opacity: 0, y: 20, duration: 1.2, ease: 'expo.out', stagger: 0.08, scrollTrigger: { trigger: '.model__stage', start: 'top 70%' } })
    }, ref)

    const steps = pipe.current ? Array.from(pipe.current.querySelectorAll('.step')) : []
    const st = ScrollTrigger.create({
      trigger: pipe.current,
      start: 'top 78%',
      end: 'bottom 50%',
      onUpdate: (s) => {
        pipe.current?.style.setProperty('--p', s.progress.toFixed(3))
        steps.forEach((el, i) => el.classList.toggle('is-on', s.progress >= i / steps.length - 0.02))
      },
    })
    return () => {
      ctx.revert()
      st.kill()
    }
  }, [])

  return (
    <section className="section section--night model" id="model" data-nav="dark" ref={ref} aria-labelledby="model-title">
      <div className="section-head">
        <div className="label">02 — The model</div>
      </div>

      <div className="model__stage">
        <div className="model__glow" />
        <div className="model__name" aria-hidden>
          Resp‑1
        </div>
        <View className="view" index={2}>
          <OrbScene scale={1.05} z={5.4} mobileY={-0.55} />
        </View>
        <div className="model__corner model__corner--tl">
          <span className="chip">
            <span className="dot dot--cyan" /> Model · v1
          </span>
          <h2 id="model-title" className="model__title">
            Meet Resp‑1.
          </h2>
          <p className="lead">A tiny neural network that recognises coughs — small enough to run on a low-cost microcontroller, fully offline.</p>
        </div>
        <div className="model__corner model__corner--tr label mute">
          Trained on labelled cough & noise recordings
          <br />
          Edge Impulse · quantised int8
        </div>
        <div className="model__corner model__corner--bl">
          <button className="btn btn--night" onClick={() => scrollToId('try')}>
            Try it live <ArrowDown />
          </button>
        </div>
        <div className="model__corner model__corner--br label mute">
          Audio in → cough / noise out
          <br />
          Every window, every second
        </div>
      </div>

      <div className="specs">
        {SPECS.map((s) => (
          <div className="spec" key={s.label}>
            <span className="label mute">{s.label}</span>
            <div className="spec__v" data-count={s.v} data-dec={s.d}>
              <span>0</span>
              <small>{s.unit}</small>
            </div>
          </div>
        ))}
      </div>

      <div className="pipeline">
        <div className="section-head" style={{ marginBottom: 48 }}>
          <h3 className="h2" style={{ gridColumn: '1 / span 8' }}>
            How Resp‑1 hears a cough.
          </h3>
          <p className="lead">Five steps, a few hundred milliseconds, zero bytes sent to the cloud.</p>
        </div>
        <div className="pipe" ref={pipe}>
          <div className="pipe__rail">
            <i />
            <b />
          </div>
          {STEPS.map((s, i) => (
            <div className="step" key={s.t}>
              <span className="step__n">0{i + 1}</span>
              <div className="step__viz">
                <StepViz kind={i} />
              </div>
              <h4>{s.t}</h4>
              <p>{s.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
