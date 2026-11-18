import { useEffect, useRef } from 'react'
import { gsap } from '../lib/scroll'

const B = import.meta.env.BASE_URL

export function Img({ name, alt, sizes, widths = [700, 1200, 2000] }: { name: string; alt: string; sizes: string; widths?: number[] }) {
  const src = (w: number, ext: string) => `${B}images/${name}-${w}.${ext} ${w}w`
  const fallback = widths.includes(1200) ? 1200 : widths[widths.length - 1]
  return (
    <picture>
      <source type="image/webp" srcSet={widths.map((w) => src(w, 'webp')).join(', ')} sizes={sizes} />
      <img src={`${B}images/${name}-${fallback}.jpg`}srcSet={widths.map((w) => src(w, 'jpg')).join(', ')} sizes={sizes} alt={alt} loading="lazy" decoding="async" />
    </picture>
  )
}

export function Gallery() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('.shot').forEach((el, i) => {
        gsap.fromTo(el, { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: 1.4, ease: 'expo.inOut', delay: i * 0.08, scrollTrigger: { trigger: el, start: 'top 88%' } })
        gsap.fromTo(el.querySelector('img'), { yPercent: -6 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } })
      })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <section className="section gallery above" ref={ref} aria-labelledby="gallery-title">
      <div className="section-head">
        <span className="eyebrow">Prototype</span>
        <h2 id="gallery-title" className="h2">
          The working prototype
        </h2>
        <p className="lead">Photos of the current RespAI unit. The screen is showing real detections: the word “cough”, its probability and the running count.</p>
      </div>
      <div className="gallery__row">
        <figure className="shot shot--a" style={{ margin: 0 }}>
          <Img name="device-front" alt="The RespAI prototype on a desk, OLED screen showing a cough detected with probability 0.84" sizes="(max-width: 800px) 100vw, 45vw" />
        </figure>
        <figure className="shot shot--b" style={{ margin: 0 }}>
          <Img name="device-closeup" alt="Close-up of the RespAI device with its embossed logo and MQ-6 gas sensor" sizes="(max-width: 800px) 50vw, 33vw" />
        </figure>
        <figure className="shot shot--c" style={{ margin: 0 }}>
          <Img name="oled-closeup" alt="The device OLED: WiFi OK, Firebase OK, p=0.84 cough, temperature 26.8°C, humidity 35%" sizes="(max-width: 800px) 50vw, 25vw" widths={[700, 1200]} />
        </figure>
      </div>
      <div className="gallery__caption label mute">
        <span>3D-printed PLA case, ESP32, 0.96″ OLED, MQ‑6 gas sensor</span>
        <span>Tashkent, 2026</span>
      </div>
    </section>
  )
}
