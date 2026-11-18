import * as THREE from 'three'

/**
 * Procedural textures for the 3D device. Everything is drawn once on a canvas
 * and cached, so the three device instances on the page share the same GPU textures.
 * UVs on the extruded parts are in millimetres, so `repeat` = 1 / tile size in mm.
 */

const cache = new Map<string, THREE.Texture>()

interface MakeOpts {
  /** canvas height when it differs from the width */
  height?: number
  /** colour textures are sRGB; height/roughness data stays linear */
  srgb?: boolean
  repeat?: [number, number]
  wrap?: boolean
}

export function canvasTexture(key: string, width: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, opts: MakeOpts = {}) {
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = width
  c.height = opts.height ?? width
  const ctx = c.getContext('2d')!
  draw(ctx, c.width, c.height)
  const t = new THREE.CanvasTexture(c)
  if (opts.wrap !== false) t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1])
  t.anisotropy = 8
  t.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
  cache.set(key, t)
  return t
}

/** Small deterministic PRNG so the textures look the same on every visit. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Top-layer FDM lines of the printed lid: ~0.5 mm beads running diagonally ("/"),
 * slightly broken up like the ironed surface in the photos. Height map (bump).
 */
export function printLinesTexture() {
  return canvasTexture(
    'print-lines',
    512,
    (ctx, s) => {
      const rand = rng(7)
      ctx.fillStyle = '#7a7a7a'
      ctx.fillRect(0, 0, s, s)
      const lines = 40
      const pitch = (s * Math.SQRT2) / lines
      ctx.save()
      ctx.translate(s / 2, s / 2)
      ctx.rotate(-Math.PI / 4)
      for (let i = -lines; i <= lines; i++) {
        let x = -s
        // beads wander a little and vary in height, like a real top layer
        let wob = 0
        while (x < s) {
          const len = 6 + rand() * 30
          wob = Math.max(-0.14, Math.min(0.14, wob + (rand() - 0.5) * 0.08))
          const y = (i + wob) * pitch
          const j = (rand() - 0.5) * 26
          const hi = 150 + j
          const lo = 104 + j * 0.5
          const g = ctx.createLinearGradient(0, y - pitch / 2, 0, y + pitch / 2)
          g.addColorStop(0, `rgb(${lo},${lo},${lo})`)
          g.addColorStop(0.5, `rgb(${hi},${hi},${hi})`)
          g.addColorStop(1, `rgb(${lo},${lo},${lo})`)
          ctx.fillStyle = g
          ctx.fillRect(x, y - pitch / 2, len + 0.5, pitch)
          x += len
        }
      }
      ctx.restore()
    },
    { repeat: [1 / 14, 1 / 14] },
  )
}

/** Horizontal layer lines on the printed side walls (≈0.22 mm layers). Height map, varies along v only. */
export function layerLinesTexture() {
  return canvasTexture(
    'layer-lines',
    16,
    (ctx, w, h) => {
      const rand = rng(11)
      const n = 32
      const p = h / n
      for (let i = 0; i < n; i++) {
        const j = (rand() - 0.5) * 30
        const g = ctx.createLinearGradient(0, i * p, 0, (i + 1) * p)
        g.addColorStop(0, `rgb(${96 + j},${96 + j},${96 + j})`)
        g.addColorStop(0.5, `rgb(${168 + j},${168 + j},${168 + j})`)
        g.addColorStop(1, `rgb(${96 + j},${96 + j},${96 + j})`)
        ctx.fillStyle = g
        ctx.fillRect(0, i * p, w, p)
      }
    },
    { height: 256, repeat: [1 / 20, 1 / 7] },
  )
}

/**
 * Plain-weave stainless wire mesh of the MQ-6 cap: wires go over / under each other,
 * with the dark sensor interior showing through the gaps.
 * `kind` 'color' → albedo (sRGB), 'height' → bump map.
 */
export function wovenMeshTexture(kind: 'color' | 'height') {
  return canvasTexture(
    `woven-${kind}`,
    512,
    (ctx, s) => {
      const n = 16
      const p = s / n
      const wire = p * 0.56
      const color = kind === 'color'
      ctx.fillStyle = color ? '#0b0c0d' : '#000'
      ctx.fillRect(0, 0, s, s)
      const shade = (x0: number, y0: number, x1: number, y1: number, vertical: boolean, dip: number) => {
        // cylindrical cross-section shading, darker where the wire dives under
        const g = vertical ? ctx.createLinearGradient(x0, 0, x1, 0) : ctx.createLinearGradient(0, y0, 0, y1)
        const hi = color ? 205 - dip * 70 : 255 - dip * 120
        const lo = color ? 92 - dip * 40 : 70 - dip * 50
        g.addColorStop(0, `rgb(${lo},${lo},${lo + 2})`)
        g.addColorStop(0.45, `rgb(${hi},${hi},${hi + 3})`)
        g.addColorStop(1, `rgb(${lo},${lo},${lo + 2})`)
        ctx.fillStyle = g
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0)
      }
      const seg = 4
      // a wire is drawn as short segments so the "dip" can vary along its length
      const drawWire = (i: number, vertical: boolean) => {
        const c = i * p + p / 2
        for (let k = 0; k < n * seg; k++) {
          const a = (k / seg) * p
          const b = ((k + 1) / seg) * p
          const along = (k + 0.5) / seg // in pitches
          const cell = Math.floor(along)
          const over = (cell + i) % 2 === 0
          const f = Math.abs(along - cell - 0.5) * 2 // 0 at crossing centre, 1 midway
          const dip = over ? 0 : Math.max(0, 1 - f) * 0.9
          if (vertical) shade(c - wire / 2, a, c + wire / 2, b, true, dip)
          else shade(a, c - wire / 2, b, c + wire / 2, false, dip)
        }
      }
      for (let i = 0; i < n; i++) drawWire(i, true)
      for (let i = 0; i < n; i++) drawWire(i, false)
      // redraw the crossings where the vertical wire is on top
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          if ((i + j) % 2 === 0) continue
          const cx = i * p + p / 2
          const cy = j * p + p / 2
          ctx.save()
          ctx.beginPath()
          ctx.rect(cx - wire / 2, cy - wire / 2 - 1, wire, wire + 2)
          ctx.clip()
          shade(cx - wire / 2, cy - wire, cx + wire / 2, cy + wire, true, 0)
          ctx.restore()
        }
    },
    { srgb: kind === 'color' },
  )
}

/**
 * The OLED glass outside the lit area, as in the close-up photo: black glass, the
 * panel's lower edge, and the driver chip / flex cable showing through the bottom strip.
 * Drawn for a glass of `w`×`h` mm with the 24.6×12.3 mm active area centred at y = +`activeY`.
 */
export function oledGlassTexture(w: number, h: number, activeY: number) {
  const k = 20 // px per mm
  return canvasTexture(
    `oled-glass-${w}-${h}`,
    Math.round(w * k),
    (ctx, W, H) => {
      const X = (mm: number) => (mm + w / 2) * k
      const Y = (mm: number) => (h / 2 - mm) * k
      const g = ctx.createLinearGradient(0, 0, 0, H)
      g.addColorStop(0, '#0a0b0d')
      g.addColorStop(1, '#060708')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
      // display area (a hair darker than the surrounding glass)
      ctx.fillStyle = '#030304'
      ctx.fillRect(X(-13.2), Y(activeY + 7.2), 26.4 * k, 14.4 * k)
      // lower edge of the panel
      const edge = activeY - 8.55
      ctx.fillStyle = '#25272b'
      ctx.fillRect(X(-13.6), Y(edge), 27.2 * k, 0.28 * k)
      ctx.fillStyle = '#121316'
      ctx.fillRect(X(-13.6), Y(edge - 0.28), 27.2 * k, 0.5 * k)
      // driver IC / flex under the glass
      ctx.fillStyle = '#141518'
      ctx.fillRect(X(-6.2), Y(edge - 0.3), 12.8 * k, 2.5 * k)
      ctx.strokeStyle = '#26282c'
      ctx.lineWidth = 1.5
      ctx.strokeRect(X(-6.2), Y(edge - 0.3), 12.8 * k, 2.5 * k)
      ctx.fillStyle = '#1c1d20'
      ctx.fillRect(X(-8.4), Y(edge - 0.3), 0.6 * k, 2.6 * k)
    },
    { height: Math.round(h * 20), srgb: true, wrap: false },
  )
}

/** Very soft radial gradient used for glows / fake shadows. */
export function radialTexture() {
  return canvasTexture('radial', 128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.4, 'rgba(255,255,255,0.35)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, s, s)
  })
}
