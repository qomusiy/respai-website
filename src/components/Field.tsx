import { useEffect, useRef, useState } from 'react'
import { gsap, prefersReducedMotion } from '../lib/scroll'
import { Img } from './Gallery'
import { Arrow, Play } from './icons'

const VIDEOS = [
  {
    id: '5OMK_a5uNwc',
    thumb: 'video-demo',
    kicker: 'Product demo',
    title: 'RespAI, demonstrated by its founder.',
  },
  {
    id: 'j6bYZNkOpyU',
    thumb: 'video-award',
    kicker: 'Finalist · Community Health and Well-being Award (Youth)',
    title: 'Meet founder Muhammadjon Valiyev.',
  },
]

/** Click-to-play: nothing loads from YouTube until the visitor asks for it. */
function Video({ id, thumb, title }: { id: string; thumb: string; title: string }) {
  const [playing, setPlaying] = useState(false)
  return (
    <div className="vid__frame">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <button type="button" className="vid__poster" onClick={() => setPlaying(true)} aria-label={`Play video: ${title}`}>
          <Img name={thumb} alt="" sizes="(max-width: 800px) 100vw, 50vw" widths={[700, 1280]} />
          <span className="vid__play">
            <Play />
          </span>
        </button>
      )}
    </div>
  )
}

export function Field() {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (prefersReducedMotion()) return
    const ctx = gsap.context(() => {
      gsap.utils.toArray<HTMLElement>('.fshot, .vid__frame').forEach((el, i) => {
        gsap.fromTo(el, { clipPath: 'inset(100% 0 0 0)' }, { clipPath: 'inset(0% 0 0 0)', duration: 1.4, ease: 'expo.inOut', delay: (i % 2) * 0.08, scrollTrigger: { trigger: el, start: 'top 88%' } })
      })
      gsap.utils.toArray<HTMLElement>('.fshot__media').forEach((el) => {
        gsap.fromTo(el, { yPercent: -6 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } })
      })
    }, ref)
    return () => ctx.revert()
  }, [])

  return (
    <section className="section field above" id="field" ref={ref} aria-labelledby="field-title">
      <div className="section-head">
        <div className="label">In the field</div>
        <h2 id="field-title" className="h2">
          From the clinic
          <br />
          to the stage.
        </h2>
        <p className="lead">Out of the lab and into a working cardiology centre, checked by the clinicians who would use it — and pitched to competition juries by our founder, Muhammadjon Valiyev.</p>
      </div>

      <div className="field__grid">
        <figure className="fshot fshot--icu">
          <div className="fshot__media">
            <Img name="field-icu" alt="RespAI mounted on the wall of an intensive-care room, between medical posters, above a patient bed and an ECG cart" sizes="(max-width: 800px) 100vw, 58vw" widths={[700, 1024]} />
            {/* the device sits at the centre-top of this crop */}
            <span className="fshot__pin" style={{ left: '50%', top: '41.7%' }} aria-hidden>
              <i />
              <span className="chip">
                <span className="dot dot--cyan" /> RespAI
              </span>
            </span>
          </div>
          <figcaption className="shot__cap">
            <span className="chip">Intensive-care room</span>
          </figcaption>
        </figure>
        <figure className="fshot fshot--team">
          <div className="fshot__media">
            <Img name="field-team" alt="Founder Muhammadjon Valiyev (right) holding the RespAI device, standing with two clinicians at a cardiology centre" sizes="(max-width: 800px) 100vw, 42vw" widths={[600, 960]} />
          </div>
          <figcaption className="shot__cap">
            <span className="chip">Cardiology centre</span>
          </figcaption>
        </figure>
        <figure className="fshot fshot--doctor">
          <div className="fshot__media">
            <Img name="field-doctor" alt="Muhammadjon Valiyev (right) walking a doctor through the RespAI device in a hospital ward" sizes="(max-width: 800px) 100vw, 50vw" widths={[700, 1280]} />
          </div>
          <figcaption className="shot__cap">
            <span className="chip">Clinician feedback</span>
          </figcaption>
        </figure>
        <figure className="fshot fshot--stage">
          <div className="fshot__media">
            <Img name="field-stage" alt="Muhammadjon Valiyev (right) presenting the RespAI prototype to visitors taking notes at a competition stand" sizes="(max-width: 800px) 100vw, 50vw" widths={[700, 1280]} />
          </div>
          <figcaption className="shot__cap">
            <span className="chip">Competition demo</span>
          </figcaption>
        </figure>
      </div>
      <div className="gallery__caption label mute">
        <span>Checked by clinicians · Uzbekistan</span>
        <span>Founder · Muhammadjon Valiyev</span>
      </div>

      <div className="field__videos">
        {VIDEOS.map((v) => (
          <article className="vid" key={v.id}>
            <Video id={v.id} thumb={v.thumb} title={v.title} />
            <div className="vid__meta">
              <span className="label mute">{v.kicker}</span>
              <h3 className="h3">{v.title}</h3>
              <a className="label vid__link" href={`https://youtu.be/${v.id}`} target="_blank" rel="noreferrer">
                Watch on YouTube <Arrow />
              </a>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
