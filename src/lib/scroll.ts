import Lenis from 'lenis'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useLayoutEffect, useRef, type RefObject } from 'react'

gsap.registerPlugin(ScrollTrigger)

export let lenis: Lenis | null = null

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function initScroll() {
  if (lenis || prefersReducedMotion()) return
  lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 0.95 })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis?.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
}

export function scrollToId(id: string) {
  const el = document.getElementById(id)
  if (!el) return
  if (lenis) lenis.scrollTo(el, { offset: 0, duration: 1.5 })
  else el.scrollIntoView({ behavior: 'smooth' })
}

/** Mutable 0..1 progress of an element through the viewport (no re-renders). */
export function useScrollProgress(ref: RefObject<HTMLElement | null>, start = 'top bottom', end = 'bottom top') {
  const p = useRef(0)
  useLayoutEffect(() => {
    if (!ref.current) return
    const st = ScrollTrigger.create({
      trigger: ref.current,
      start,
      end,
      onUpdate: (s) => {
        p.current = s.progress
      },
      onRefresh: (s) => {
        p.current = s.progress
      },
    })
    return () => st.kill()
  }, [ref, start, end])
  return p
}

export { gsap, ScrollTrigger }
