import { useEffect, useRef, useState } from 'react'
import { View } from '@react-three/drei'
import { HeroScene } from '../three/scenes'
import { useApp, live, type OledMode } from '../lib/live'
import { gsap, ScrollTrigger, scrollToId, useScrollProgress } from '../lib/scroll'
import { Arrow } from './icons'

const FEATURES: Array<{ name: string; oled: OledMode; desc: string }> = [
  { name: 'Cough AI', oled: 'status', desc: 'Resp‑1 listens for coughs in real time, counts every event and shows the probability right on the device.' },
  { name: 'Air quality', oled: 'air', desc: 'Temperature, humidity and an MQ‑6 gas sensor watch the air around you — LPG, propane, butane and methane.' },
  { name: 'Edge AI · ESP32', oled: 'boot', desc: 'The neural network runs on a low-cost ESP32 microcontroller. No internet required, low power.' },
  { name: 'Med reminder', oled: 'reminder', desc: 'Schedule medicine in the app — RespAI beeps and shows “Time to take medicine” on its OLED.' },
  { name: 'Privacy', oled: 'privacy', desc: 'Audio is analysed on the device and never stored. A consent window always comes first.' },
]

export function Hero() {
  const ref = useRef<HTMLElement>(null)
  const progress = useScrollProgress(ref, 'top top', 'bottom top')
  const index = useApp((s) => s.heroIndex)
  const setIndex = useApp((s) => s.setHeroIndex)
  const [auto, setAuto] = useState(true)

  // auto-advance through features until the visitor picks one
  useEffect(() => {
    if (!auto) return
    const id = setInterval(() => setIndex((useApp.getState().heroIndex + 1) % FEATURES.length), 5200)
    return () => clearInterval(id)
  }, [auto, setIndex])

  // the hero picks what the device screen shows — only while the hero is on screen
  const inView = useRef(true)
  useEffect(() => {
    live.oledMode = inView.current ? FEATURES[index].oled : 'status'
  }, [index])
  useEffect(() => {
    const st = ScrollTrigger.create({
      trigger: ref.current,
      start: 'top bottom', // active from first paint, so leaving the hero always toggles
      end: 'bottom 30%',
      onToggle: (s) => {
        inView.current = s.isActive
        live.oledMode = s.isActive ? FEATURES[useApp.getState().heroIndex].oled : 'status'
      },
    })
    return () => st.kill()
  }, [])

  // intro choreography after the loader
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ctx = gsap.context(() => {
      gsap.set('.hero__title .split-line > span', { yPercent: 110 })
      gsap.set('[data-hero-fade]', { opacity: 0, y: 18 })
    }, el)
    const play = () => {
      ctx.add(() => {
        gsap.to('.hero__title .split-line > span', { yPercent: 0, duration: 1.25, ease: 'expo.out', stagger: 0.08 })
        gsap.to('[data-hero-fade]', { opacity: 1, y: 0, duration: 1, ease: 'expo.out', stagger: 0.06, delay: 0.35 })
      })
    }
    window.addEventListener('respai:ready', play, { once: true })
    return () => {
      window.removeEventListener('respai:ready', play)
      ctx.revert()
    }
  }, [])

  const pick = (i: number) => {
    setAuto(false)
    setIndex(i)
  }

  return (
    <section className="hero" id="top" ref={ref}>
      <div className="hero__bg" aria-hidden>
        <svg viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
          <g fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="742" y="236" width="248" height="150" rx="30" />
            <rect x="930" y="300" width="300" height="148" rx="30" fill="rgba(255,255,255,.22)" />
            <rect x="390" y="430" width="250" height="140" rx="30" />
            <rect x="1010" y="520" width="250" height="200" rx="30" fill="rgba(255,255,255,.3)" />
            <rect x="640" y="660" width="210" height="140" rx="30" fill="rgba(255,255,255,.18)" />
            <rect x="1160" y="160" width="190" height="110" rx="26" />
          </g>
        </svg>
      </div>

      <View className="view" index={1}>
        <HeroScene progress={progress} />
      </View>

      <div className="hero__title">
        <h1 className="display brackets">
          <span className="split-line">
            <span>Listen to</span>
          </span>
          <span className="split-line">
            <span className="indent">every</span>
          </span>
          <span className="split-line">
            <span>breath.</span>
          </span>
        </h1>
      </div>

      <div className="hero__features" role="tablist" aria-label="RespAI features" data-hero-fade>
        {FEATURES.map((f, i) => (
          <button key={f.name} role="tab" aria-selected={i === index} className={i === index ? 'is-active' : ''} onClick={() => pick(i)}>
            {f.name}
          </button>
        ))}
      </div>

      <div className="hero__cta hero__cta--try" data-hero-fade>
        <button className="btn" onClick={() => scrollToId('try')}>
          Try the AI <Arrow />
        </button>
      </div>

      <div className="hero__cta hero__cta--explore" data-hero-fade>
        <span className="ghost">Sensors</span>
        <button className="btn" onClick={() => scrollToId('device')}>
          Explore device <Arrow />
        </button>
        <span className="ghost">Specs —</span>
      </div>

      <span className="chip chip--line drag-hint" data-hero-fade>
        ⟲ Drag to rotate
      </span>

      <div className="hero__bottom">
        <div data-hero-fade>
          <div className="hero__uz" lang="uz">
            Har bir nafas muhim
          </div>
          <div className="label hero__tag">A smart cough detector with an air-quality monitor. Built in Uzbekistan.</div>
        </div>
        <div data-hero-fade>
          <p className="hero__desc" aria-live="polite">
            {FEATURES[index].desc}
          </p>
          <div className="slider">
            <span className="slider__n">0{index + 1}</span>
            <div className="slider__track">
              <span className="slider__thumb" style={{ left: `calc(${(index / (FEATURES.length - 1)) * 100}% - 4px)` }} />
              <div className="slider__ticks">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <span className="slider__n">0{FEATURES.length}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
