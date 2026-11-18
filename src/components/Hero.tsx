import { useEffect, useRef, useState } from 'react'
import { View } from '@react-three/drei'
import { HeroScene } from '../three/scenes'
import { useApp, live, type OledMode } from '../lib/live'
import { gsap, ScrollTrigger, scrollToId, useScrollProgress } from '../lib/scroll'
import { Arrow } from './icons'
import { useT } from '../i18n'

/** what the device screen shows for each hero feature (same order as t.hero.features) */
const OLED: OledMode[] = ['status', 'air', 'boot', 'reminder', 'privacy']
const COUNT = OLED.length

export function Hero() {
  const ref = useRef<HTMLElement>(null)
  const t = useT()
  const progress = useScrollProgress(ref, 'top top', 'bottom top')
  const index = useApp((s) => s.heroIndex)
  const setIndex = useApp((s) => s.setHeroIndex)
  const [auto, setAuto] = useState(true)

  // cycle through the features until the visitor picks one
  useEffect(() => {
    if (!auto) return
    const id = setInterval(() => setIndex((useApp.getState().heroIndex + 1) % COUNT), 5200)
    return () => clearInterval(id)
  }, [auto, setIndex])

  // the selected feature decides what the device screen shows, while the hero is on screen
  const inView = useRef(true)
  useEffect(() => {
    live.oledMode = inView.current ? OLED[index] : 'status'
  }, [index])
  useEffect(() => {
    const st = ScrollTrigger.create({
      trigger: ref.current,
      start: 'top bottom',
      end: 'bottom 30%',
      onToggle: (s) => {
        inView.current = s.isActive
        live.oledMode = s.isActive ? OLED[useApp.getState().heroIndex] : 'status'
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
          {t.hero.eyebrow}
        </p>
        <h1 className="display" data-hero-fade>
          {t.hero.title}
        </h1>
        <p className="hero__lead" data-hero-fade>
          {t.hero.lead}
        </p>
        <div className="hero__actions" data-hero-fade>
          <button className="btn btn--dark" onClick={() => scrollToId('try')}>
            {t.hero.ctaDemo} <Arrow />
          </button>
          <button className="btn btn--ghost" onClick={() => scrollToId('device')}>
            {t.hero.ctaHardware}
          </button>
        </div>
      </div>

      <div className="hero__features" data-hero-fade>
        <div role="tablist" aria-label={t.hero.featuresLabel}>
          {t.hero.features.map((f, i) => (
            <button key={i} role="tab" aria-selected={i === index} className={i === index ? 'is-active' : ''} onClick={() => pick(i)}>
              {f.name}
            </button>
          ))}
        </div>
        <p className="hero__desc" aria-live="polite">
          {t.hero.features[index].desc}
        </p>
      </div>
    </section>
  )
}
