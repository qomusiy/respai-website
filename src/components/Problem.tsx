import { useEffect, useRef } from 'react'
import { gsap, ScrollTrigger } from '../lib/scroll'

const STATEMENT = "A cough is the body's earliest warning sign. Most of us ignore it — until it spreads through a classroom, or the air we breathe makes it worse."
const HIGHLIGHT = new Set(['warning', 'sign.'])

const STATS = [
  {
    n: '1.5–2',
    unit: 'M',
    label: 'Every year',
    text: 'people in Uzbekistan get influenza and acute respiratory viral infections, according to Ministry of Health statistics.',
  },
  {
    n: 'PM2.5',
    unit: ' & PM10',
    label: 'Rising',
    text: 'Fine-dust levels keep climbing in Tashkent, the Fergana Valley, Navoi and Almalyk — traffic, coal boilers, construction and agricultural dust.',
  },
  {
    n: 'Medium',
    unit: ' risk',
    label: 'WHO',
    text: 'Uzbekistan is classified as a medium-risk country for air quality, driving asthma, bronchitis, allergies and cardiovascular disease.',
  },
  {
    n: 'Schools',
    unit: '',
    label: 'Hotspot',
    text: 'Viruses spread fastest among school and college students. Detecting coughs early reduces epidemiological risk.',
  },
]

function Haze({ section }: { section: React.RefObject<HTMLElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvas.current
    const sec = section.current
    if (!c || !sec) return
    const ctx = c.getContext('2d')!
    let w = 0
    let h = 0
    const dpr = Math.min(window.devicePixelRatio, 2)
    const resize = () => {
      w = c.clientWidth
      h = c.clientHeight
      c.width = w * dpr
      c.height = h * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(c)
    const N = 260
    const ps = Array.from({ length: N }, (_, i) => ({
      x: Math.random(),
      y: Math.random(),
      r: i % 7 === 0 ? 2.4 + Math.random() * 2.2 : 0.6 + Math.random() * 1.2, // PM10 vs PM2.5
      vx: (Math.random() - 0.5) * 0.00012,
      vy: -0.00004 - Math.random() * 0.00012,
      a: Math.random(),
    }))
    let density = 0
    const st = ScrollTrigger.create({
      trigger: sec,
      start: 'top bottom',
      end: 'bottom top',
      onUpdate: (s) => (density = s.progress),
    })
    let raf = 0
    let visible = false
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting
      if (visible) loop()
    })
    io.observe(c)
    const loop = () => {
      cancelAnimationFrame(raf)
      if (!visible) return
      ctx.clearRect(0, 0, w, h)
      const count = Math.floor(N * (0.25 + Math.min(1, density * 1.6) * 0.75))
      for (let i = 0; i < count; i++) {
        const p = ps[i]
        p.x += p.vx + Math.sin((p.y + performance.now() / 9000) * 6) * 0.00008
        p.y += p.vy
        if (p.y < -0.02) p.y = 1.02
        if (p.x < -0.02) p.x = 1.02
        if (p.x > 1.02) p.x = -0.02
        ctx.beginPath()
        ctx.fillStyle = `rgba(80,84,92,${0.08 + p.a * 0.22})`
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2)
        ctx.fill()
      }
      raf = requestAnimationFrame(loop)
    }
    return () => {
      cancelAnimationFrame(raf)
      io.disconnect()
      ro.disconnect()
      st.kill()
    }
  }, [section])
  return <canvas className="haze" ref={canvas} aria-hidden />
}

export function Problem() {
  const ref = useRef<HTMLElement>(null)
  const statement = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const el = statement.current
    if (!el) return
    const words = Array.from(el.querySelectorAll<HTMLSpanElement>('.w'))
    const st = ScrollTrigger.create({
      trigger: el,
      start: 'top 82%',
      end: 'bottom 45%',
      onUpdate: (s) => {
        const k = s.progress * words.length * 1.15
        words.forEach((w, i) => (w.style.opacity = String(Math.max(0.14, Math.min(1, k - i)))))
      },
    })
    const ctx = gsap.context(() => {
      gsap.from('.stat', {
        y: 50,
        opacity: 0,
        duration: 1.1,
        ease: 'expo.out',
        stagger: 0.08,
        scrollTrigger: { trigger: '.stats', start: 'top 85%' },
      })
    }, ref)
    return () => {
      st.kill()
      ctx.revert()
    }
  }, [])

  return (
    <section className="section problem" ref={ref} aria-labelledby="problem-title">
      <Haze section={ref} />
      <div className="section-head above">
        <div className="label">01 — The problem</div>
      </div>
      <h2 id="problem-title" className="sr-only">
        The problem
      </h2>
      <p className="statement above" ref={statement}>
        {STATEMENT.split(' ').map((w, i) => (
          <span key={i} className={`w ${HIGHLIGHT.has(w) ? 'hl' : ''}`}>
            {w}{' '}
          </span>
        ))}
      </p>
      <div className="stats above">
        {STATS.map((s) => (
          <div className="stat" key={s.n}>
            <span className="chip">{s.label}</span>
            <div className="stat__n">
              {s.n}
              <small>{s.unit}</small>
            </div>
            <p>{s.text}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
