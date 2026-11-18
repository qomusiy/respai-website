import { useEffect, useRef, useState } from 'react'
import { View } from '@react-three/drei'
import { HeroScene } from '../three/scenes'
import { useApp, live, type OledMode } from '../lib/live'
import { gsap, ScrollTrigger, scrollToId, useScrollProgress } from '../lib/scroll'
import { Arrow } from './icons'

const FEATURES: Array<{ name: string; oled: OledMode; desc: string }> = [
  { name: 'Cough detection', oled: 'status', desc: 'Counts coughs in real time and shows the detection probability on the screen.' },
  { name: 'Air quality', oled: 'air', desc: 'Temperature, humidity and an MQ‑6 sensor for LPG, propane, butane and methane.' },
  { name: 'Runs on the device', oled: 'boot', desc: 'The model runs on an ESP32 microcontroller. It keeps working without internet.' },
  { name: 'Medication reminders', oled: 'reminder', desc: 'Doses scheduled in the app make the device beep and show a reminder.' },
  { name: 'Privacy', oled: 'privacy', desc: 'Sound is analysed on the device and never recorded or uploaded.' },
]

export function Hero() {
  const ref = useRef<HTMLElement>(null)
  const progress = useScrollProgress(ref, 'top top', 'bottom top')
  const index = useApp((s) => s.heroIndex)
  const setIndex = useApp((s) => s.setHeroIndex)
  const [auto, setAuto] = useState(true)

  // cycle through the features until the visitor picks one
  useEffect(() => {
    if (!auto) return
    const id = setInterval(() => setIndex((useApp.getState().heroIndex + 1) % FEATURES.length), 5200)
    return () => clearInterval(id)
  }, [auto, setIndex])

  // the selected feature decides what the device screen shows, while the hero is on screen
  const inView = useRef(true)
  useEffect(() => {
    live.oledMode = inView.current ? FEATURES[index].oled : 'status'
  }, [index])
  useEffect(() => {
    const st = ScrollTrigger.create({
      trigger: ref.current,
      start: 'top bottom',
      end: 'bottom 30%',
      onToggle: (s) => {
        inView.current = s.isActive
        live.oledMode = s.isActive ? FEATURES[useApp.getState().heroIndex].oled : 'status'
      },
    })
    return () => st.kill()
  }, [])

  // fade the copy in once the loader is gone
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ctx = gsap.context(() => {
      gsap.set('[data-hero-fade]', { opacity: 0, y: 12 })
    }, el)
    const play = () => {
      ctx.add(() => {
        gsap.to('[data-hero-fade]', { opacity: 1, y: 0, duration: 0.8, ease: 'power2.out', stagger: 0.06 })
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
      <View className="view" index={1}>
        <HeroScene progress={progress} />
      </View>

      <div className="hero__copy">
        <p className="eyebrow" data-hero-fade>
          RespAI · made in Uzbekistan
        </p>
        <h1 className="display" data-hero-fade>
          Cough and air monitoring in one small device
        </h1>
        <p className="hero__lead" data-hero-fade>
          RespAI counts coughs with a neural network that runs on the device itself and keeps track of the air in the room. We are building it for clinics first, then classrooms and homes.
        </p>
        <div className="hero__actions" data-hero-fade>
          <button className="btn btn--dark" onClick={() => scrollToId('try')}>
            Try the live demo <Arrow />
          </button>
          <button className="btn btn--ghost" onClick={() => scrollToId('device')}>
            See the hardware
          </button>
        </div>
      </div>

      <div className="hero__features" data-hero-fade>
        <div role="tablist" aria-label="What RespAI does">
          {FEATURES.map((f, i) => (
            <button key={f.name} role="tab" aria-selected={i === index} className={i === index ? 'is-active' : ''} onClick={() => pick(i)}>
              {f.name}
            </button>
          ))}
        </div>
        <p className="hero__desc" aria-live="polite">
          {FEATURES[index].desc}
        </p>
      </div>
    </section>
  )
}
