/** Shared colour map for spectrograms: night → blue → cyan → white, with an orange "cough" accent. */
const STOPS: Array<[number, [number, number, number]]> = [
  [0, [13, 15, 19]],
  [0.3, [24, 52, 160]],
  [0.58, [31, 120, 230]],
  [0.8, [56, 232, 245]],
  [1, [245, 255, 255]],
]
export const LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 3)
  for (let i = 0; i < 256; i++) {
    const t = i / 255
    let k = 0
    while (k < STOPS.length - 2 && t > STOPS[k + 1][0]) k++
    const [t0, c0] = STOPS[k]
    const [t1, c1] = STOPS[k + 1]
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * f
  }
  return lut
})()

/** Draws one spectrogram column (values 0..1, index 0 = low freq) at x, scrolling handled by caller. */
export function drawColumn(ctx: CanvasRenderingContext2D, img: ImageData, values: ArrayLike<number>, x: number, h: number, alert = 0) {
  const n = values.length
  for (let y = 0; y < h; y++) {
    const band = Math.min(n - 1, Math.floor(((h - 1 - y) / h) * n))
    const v = Math.max(0, Math.min(1, values[band]))
    const i = Math.round(v * 255) * 3
    const o = (y * img.width + 0) * 4
    let r = LUT[i]
    let g = LUT[i + 1]
    let b = LUT[i + 2]
    if (alert > 0 && v > 0.45) {
      r = r + (255 - r) * alert
      g = g + (110 - g) * alert
      b = b + (40 - b) * alert
    }
    img.data[o] = r
    img.data[o + 1] = g
    img.data[o + 2] = b
    img.data[o + 3] = 255
  }
  ctx.putImageData(img, x, 0)
}

/** Runs `frame` on rAF only while the element is on screen. */
export function whileVisible(el: Element, frame: (t: number) => void) {
  let raf = 0
  let on = false
  const loop = (t: number) => {
    if (!on) return
    frame(t)
    raf = requestAnimationFrame(loop)
  }
  const io = new IntersectionObserver(([e]) => {
    on = e.isIntersecting
    cancelAnimationFrame(raf)
    if (on) raf = requestAnimationFrame(loop)
  })
  io.observe(el)
  return () => {
    on = false
    cancelAnimationFrame(raf)
    io.disconnect()
  }
}

/** Fits a canvas to its CSS box at device pixel ratio; returns css size. */
export function fitCanvas(c: HTMLCanvasElement, maxDpr = 2) {
  const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
  const w = c.clientWidth
  const h = c.clientHeight
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
  }
  return { w, h, dpr }
}
