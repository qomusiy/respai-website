import { useEffect, useRef } from 'react'
import { View } from '@react-three/drei'
import { ExplodedScene, PART_LABELS } from '../three/scenes'
import { gsap, ScrollTrigger, useScrollProgress } from '../lib/scroll'
import { useT } from '../i18n'

export function DeviceSection() {
  const t = useT().device
  // "00 / 08 parts" with the live count spliced into the translated phrase
  const [partsPre, partsPost] = t.parts('§', String(PART_LABELS.length).padStart(2, '0')).split('§')
  const ref = useRef<HTMLElement>(null)
  const progress = useScrollProgress(ref, 'top top', 'bottom bottom')
  const labels = useRef<Record<string, HTMLDivElement | null>>({})
  const bar = useRef<HTMLDivElement>(null)
  const count = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const st = ScrollTrigger.create({
      trigger: ref.current,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (s) => {
        bar.current?.style.setProperty('--p', s.progress.toFixed(3))
        if (count.current) {
          const n = PART_LABELS.filter((l) => s.progress * 1.0 > l.show * 0.62 + 0.04).length
          count.current.textContent = String(n).padStart(2, '0')
        }
      },
    })
    const ctx = gsap.context(() => {
      gsap.from('.device__copy > *', { y: 30, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.07, scrollTrigger: { trigger: ref.current, start: 'top 60%' } })
    }, ref)
    return () => {
      st.kill()
      ctx.revert()
    }
  }, [])

  return (
    <>
      <section className="section device" id="device" ref={ref} aria-labelledby="device-title">
        <div className="device__sticky">
          <div className="device__copy">
            <span className="eyebrow">{t.eyebrow}</span>
            <h2 id="device-title" className="h2">
              {t.title}
            </h2>
            <p className="lead">{t.lead}</p>
          </div>
          <View className="view" index={4}>
            <ExplodedScene progress={progress} labelEls={labels} />
          </View>
          <div className="view" style={{ pointerEvents: 'none', zIndex: 4 }} aria-hidden>
            {PART_LABELS.map((l) => (
              <div
                key={l.id}
                className="part-label"
                ref={(el) => {
                  labels.current[l.id] = el
                }}
              >
                <span className="part-label__dot" />
                <span className="part-label__line" />
                <div className="part-label__box">
                  <b>{t.labels[l.id]?.title}</b>
                  <span>{t.labels[l.id]?.text}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="device__progress label">
            <span>
              {partsPre}
              <span ref={count}>00</span>
              {partsPost}
            </span>
            <div className="bar" ref={bar}>
              <i />
            </div>
          </div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 0 }} aria-label={t.specsAria}>
        <div className="specsheet above">
          {t.specs.map(({ k, v }) => (
            <div key={k}>
              <span className="label mute">{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
