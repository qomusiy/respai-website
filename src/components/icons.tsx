import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement>
const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

export const Arrow = (p: P) => (
  <svg viewBox="0 0 14 14" {...base} strokeWidth={1.4} aria-hidden {...p}>
    <path d="M3 11 11 3M4.5 3H11v6.5" />
  </svg>
)
export const ArrowDown = (p: P) => (
  <svg viewBox="0 0 14 14" {...base} strokeWidth={1.4} aria-hidden {...p}>
    <path d="M7 2v10M2.5 7.5 7 12l4.5-4.5" />
  </svg>
)
export const Mic = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
)
export const Stop = (p: P) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden {...p}>
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
  </svg>
)
export const Play = (p: P) => (
  <svg viewBox="0 0 12 12" fill="currentColor" aria-hidden {...p}>
    <path d="M3 1.8v8.4L10 6z" />
  </svg>
)
export const Upload = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden {...p}>
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" />
  </svg>
)
export const Shield = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden {...p}>
    <path d="M12 3 5 6v5.5c0 4.2 2.9 7.8 7 9.5 4.1-1.7 7-5.3 7-9.5V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)
export const Check = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={2} aria-hidden {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)
export const Cross = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} strokeWidth={1.6} aria-hidden {...p}>
    <path d="M7 7l10 10M17 7 7 17" />
  </svg>
)
export const Bell = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0" />
  </svg>
)
export const School = (p: P) => (
  <svg viewBox="0 0 32 32" {...base} aria-hidden {...p}>
    <path d="M4 13 16 6l12 7-12 7z" />
    <path d="M9 16v6c2 2 4.5 3 7 3s5-1 7-3v-6M28 13v8" />
  </svg>
)
export const Home = (p: P) => (
  <svg viewBox="0 0 32 32" {...base} aria-hidden {...p}>
    <path d="M5 14 16 5l11 9M8 12v14h16V12" />
    <path d="M13 26v-7h6v7" />
  </svg>
)
export const Clinic = (p: P) => (
  <svg viewBox="0 0 32 32" {...base} aria-hidden {...p}>
    <rect x="5" y="5" width="22" height="22" rx="3" />
    <path d="M16 10v12M10 16h12" />
  </svg>
)
export const Factory = (p: P) => (
  <svg viewBox="0 0 32 32" {...base} aria-hidden {...p}>
    <path d="M4 27V14l7 4v-4l7 4v-4l7 4V5h3v22z" />
    <path d="M9 22h2M15 22h2M21 22h2" />
  </svg>
)
export const Flame = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden {...p}>
    <path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.6 3-5.6 3.7-9.3 2.3 1.4 3.4 3.3 3.5 5.2 1-.8 1.6-2 1.7-3.3 2.5 2 4.1 4.6 4.1 7.4 0 3.6-2.6 6.2-6.5 6.2z" />
  </svg>
)
export const Wave = (p: P) => (
  <svg viewBox="0 0 24 24" {...base} aria-hidden {...p}>
    <path d="M3 12h2l2-5 3 10 3-14 3 14 2-5h3" />
  </svg>
)

/** RespAI mark — the "((●))" listening glyph from the team's logo. */
export const Mark = (p: P) => (
  <svg viewBox="0 0 32 32" fill="none" aria-hidden {...p}>
    <circle cx="16" cy="16" r="4.6" fill="currentColor" />
    <path d="M10.2 9.6a9 9 0 0 0 0 12.8M21.8 9.6a9 9 0 0 1 0 12.8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M6.3 5.8a14.5 14.5 0 0 0 0 20.4M25.7 5.8a14.5 14.5 0 0 1 0 20.4" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" opacity="0.45" />
  </svg>
)
