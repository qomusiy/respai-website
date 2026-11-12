import * as THREE from 'three'

const cache = new Map<string, THREE.Texture>()

function make(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat = 1) {
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  draw(ctx, size)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 8
  t.colorSpace = THREE.NoColorSpace
  cache.set(key, t)
  return t
}

/** Diagonal FDM top-layer lines, like the 3D-printed lid of the real device. Used as a bump map (UVs are in mm). */
export function printLinesTexture() {
  return make(
    'print-lines',
    512,
    (ctx, s) => {
      ctx.fillStyle = '#808080'
      ctx.fillRect(0, 0, s, s)
      const lines = 40
      const pitch = (s * Math.SQRT2) / lines
      ctx.save()
      ctx.translate(s / 2, s / 2)
      ctx.rotate(Math.PI / 4)
      for (let i = -lines; i <= lines; i++) {
        const y = i * pitch
        const g = ctx.createLinearGradient(0, y - pitch / 2, 0, y + pitch / 2)
        const j = Math.random() * 18
        g.addColorStop(0, `rgb(${100 + j},${100 + j},${100 + j})`)
        g.addColorStop(0.5, `rgb(${165 + j},${165 + j},${165 + j})`)
        g.addColorStop(1, `rgb(${100 + j},${100 + j},${100 + j})`)
        ctx.fillStyle = g
        ctx.fillRect(-s, y - pitch / 2, s * 2, pitch)
      }
      ctx.restore()
    },
    1 / 14,
  )
}

/** Stainless wire mesh of the MQ-6 sensor cap (alpha map: white = wire). */
export function wireMeshTexture() {
  return make(
    'wire-mesh',
    256,
    (ctx, s) => {
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, s, s)
      const n = 16
      const step = s / n
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = step * 0.42
      for (let i = 0; i <= n; i++) {
        ctx.beginPath()
        ctx.moveTo(i * step, 0)
        ctx.lineTo(i * step, s)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(0, i * step)
        ctx.lineTo(s, i * step)
        ctx.stroke()
      }
    },
    1,
  )
}

/** Very soft radial gradient used for glows / fake shadows. */
export function radialTexture() {
  return make(
    'radial',
    128,
    (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
      g.addColorStop(0, 'rgba(255,255,255,1)')
      g.addColorStop(0.4, 'rgba(255,255,255,0.35)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, s, s)
    },
    1,
  )
}
