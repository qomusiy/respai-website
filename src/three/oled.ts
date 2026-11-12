import * as THREE from 'three'
import { drawText, textWidth } from './font5x7'
import { live, type OledMode } from '../lib/live'

/**
 * A 128×64 SSD1306-style framebuffer. One canvas + one texture shared by every
 * 3D device instance and the 2D replicas in the page, so the "screen" is always in sync.
 */
export const OLED_W = 128
export const OLED_H = 64

const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : (null as unknown as HTMLCanvasElement)
if (canvas) {
  canvas.width = OLED_W
  canvas.height = OLED_H
}
const ctx = canvas?.getContext('2d') as CanvasRenderingContext2D

export const oledCanvas = canvas
export const oledTexture = canvas ? new THREE.CanvasTexture(canvas) : (null as unknown as THREE.CanvasTexture)
if (oledTexture) {
  oledTexture.magFilter = THREE.NearestFilter
  oledTexture.minFilter = THREE.NearestFilter
  oledTexture.generateMipmaps = false
  oledTexture.colorSpace = THREE.NoColorSpace
}

const listeners = new Set<() => void>()
export const onOledDraw = (fn: () => void) => {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

// ——— idle demo so the hero device feels alive before anyone uses the mic ———
const demo = { prob: 0.06, label: 'noise' as 'cough' | 'noise', count: 1, nextCough: 0, coughUntil: 0, hist: new Float32Array(64) }

function px(x: number, y: number, w = 1, h = 1) {
  ctx.fillRect(x, y, w, h)
}
function frame(x: number, y: number, w: number, h: number) {
  px(x, y, w, 1)
  px(x, y + h - 1, w, 1)
  px(x, y, 1, h)
  px(x + w - 1, y, 1, h)
}

function drawStatus(now: number, active: boolean) {
  const prob = active ? live.prob : demo.prob
  const label = active ? (live.label === 'cough' ? 'cough' : 'noise') : demo.label
  const count = active || live.coughCount > 0 ? live.coughCount : demo.count
  const hist = active ? live.levelHistory : demo.hist
  const level = active ? live.level : demo.hist[demo.hist.length - 1]

  drawText(ctx, `WiFi:${live.wifi ? 'OK' : '--'}  FB:${live.fb ? 'OK' : '--'}`, 0, 0)
  // mini plot box (the real firmware draws the probability trace here)
  frame(0, 10, 64, 14)
  for (let i = 0; i < 62; i++) {
    const v = hist[Math.floor((i / 62) * hist.length)]
    const y = 22 - Math.round(Math.min(1, v) * 10)
    px(1 + i, y, 1, 1)
  }
  drawText(ctx, `p=${prob.toFixed(2)}`, 67, 11)
  drawText(ctx, label, 67, 19)
  drawText(ctx, `C:${count}`, 67, 27)
  drawText(ctx, 'RMS:', 0, 27)
  frame(0, 36, 128, 4)
  px(1, 37, Math.round(Math.min(1, level * 1.1) * 126), 2)
  drawText(ctx, `T:${live.temp.toFixed(1)}C H:${Math.round(live.hum)}% MQ6:${live.mq6.toFixed(1)}`, 0, 47)
  // subtle heartbeat dot so it never looks frozen
  if (Math.floor(now / 500) % 2 === 0) px(125, 0, 2, 2)
}

function drawAlert(now: number) {
  const blink = Math.floor(now / 160) % 2 === 0
  if (blink) {
    ctx.fillRect(0, 0, OLED_W, 18)
    ctx.fillStyle = '#000'
    drawText(ctx, 'COUGH DETECTED', (OLED_W - textWidth('COUGH DETECTED')) / 2, 5)
    ctx.fillStyle = '#fff'
  } else {
    drawText(ctx, 'COUGH DETECTED', (OLED_W - textWidth('COUGH DETECTED')) / 2, 5)
  }
  const p = `p=${live.lastCoughProb.toFixed(2)}`
  drawText(ctx, p, (OLED_W - textWidth(p, 2)) / 2, 25, 2)
  const c = `TOTAL TODAY: ${live.coughCount}`
  drawText(ctx, c, (OLED_W - textWidth(c)) / 2, 50)
}

function drawReminder(now: number) {
  // bell icon
  const bx = 6
  const by = 6
  const ring = Math.sin(now / 90) > 0 ? 1 : 0
  ctx.save()
  ctx.translate(ring, 0)
  px(bx + 5, by, 2, 1)
  px(bx + 3, by + 1, 6, 1)
  px(bx + 2, by + 2, 8, 6)
  px(bx + 1, by + 8, 10, 1)
  px(bx, by + 9, 12, 1)
  px(bx + 5, by + 11, 2, 1)
  ctx.restore()
  drawText(ctx, 'TIME TO TAKE', 26, 8)
  drawText(ctx, live.reminderText, (OLED_W - textWidth(live.reminderText, 2)) / 2, 26, 2)
  drawText(ctx, live.reminderTime, 0, 52)
  drawText(ctx, 'OK > DONE', OLED_W - textWidth('OK > DONE'), 52)
}

function drawAir(now: number) {
  drawText(ctx, 'AIR QUALITY', 0, 0)
  const ok = live.mq6 < 25
  drawText(ctx, ok ? 'GOOD' : 'ALERT', OLED_W - textWidth(ok ? 'GOOD' : 'ALERT'), 0)
  const rows: Array<[string, number, number]> = [
    ['TEMP', live.temp, 40],
    ['HUM', live.hum, 100],
    ['MQ6', live.mq6, 50],
  ]
  rows.forEach(([name, v, max], i) => {
    const y = 14 + i * 14
    drawText(ctx, name, 0, y)
    frame(28, y, 70, 7)
    const w = Math.round(Math.max(0, Math.min(1, v / max)) * 68)
    px(29, y + 1, w, 5)
    const vs = name === 'HUM' ? `${Math.round(v)}%` : v.toFixed(1)
    drawText(ctx, vs, OLED_W - textWidth(vs), y)
  })
  if (Math.floor(now / 700) % 2 === 0) px(OLED_W - 2, 58, 2, 2)
}

function drawBoot(now: number) {
  drawText(ctx, 'RespAI', (OLED_W - textWidth('RespAI', 3)) / 2, 6, 3)
  drawText(ctx, 'by Laputa', (OLED_W - textWidth('by Laputa')) / 2, 34)
  const t = (now / 1400) % 1
  frame(14, 50, 100, 6)
  px(16, 52, Math.round(t * 96), 2)
}

function drawPrivacy(now: number) {
  drawText(ctx, 'ON-DEVICE AI', (OLED_W - textWidth('ON-DEVICE AI')) / 2, 4)
  drawText(ctx, 'OFFLINE', (OLED_W - textWidth('OFFLINE', 2)) / 2, 18, 2)
  drawText(ctx, 'audio never leaves', (OLED_W - textWidth('audio never leaves')) / 2, 40)
  drawText(ctx, 'the device', (OLED_W - textWidth('the device')) / 2, 50)
  if (Math.floor(now / 500) % 2 === 0) px(2, 2, 2, 2)
}

const DRAWERS: Record<OledMode, (now: number, active: boolean) => void> = {
  status: drawStatus,
  alert: drawAlert,
  reminder: drawReminder,
  air: drawAir,
  boot: drawBoot,
  privacy: drawPrivacy,
}

let lastHistPush = 0
let lastTick = 0
function tick(now: number) {
  // global decay of the cough flash (read by orb + device)
  const dt = Math.min(0.1, (now - lastTick) / 1000)
  lastTick = now
  live.flash = Math.max(0, live.flash - dt * 0.85)
  const active = now - live.lastFrameAt < 2500

  // level history for the mini plot (real audio)
  if (now - lastHistPush > 60) {
    lastHistPush = now
    live.levelHistory.copyWithin(0, 1)
    live.levelHistory[live.levelHistory.length - 1] = active ? live.prob * 0.7 + live.level * 0.3 : 0
    // demo values
    if (now > demo.nextCough) {
      demo.coughUntil = now + 900
      demo.nextCough = now + 7000 + Math.random() * 5000
      demo.count++
    }
    const coughing = now < demo.coughUntil
    const target = coughing ? 0.82 + Math.random() * 0.12 : 0.04 + Math.random() * 0.08
    demo.prob += (target - demo.prob) * (coughing ? 0.5 : 0.2)
    demo.label = demo.prob > 0.5 ? 'cough' : 'noise'
    demo.hist.copyWithin(0, 1)
    demo.hist[demo.hist.length - 1] = coughing ? 0.6 + Math.random() * 0.4 : 0.05 + Math.random() * 0.08
  }

  let mode = live.oledMode
  if (live.oledOverride && now < live.oledOverrideUntil) mode = live.oledOverride
  else live.oledOverride = null

  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, OLED_W, OLED_H)
  ctx.fillStyle = '#fff'
  DRAWERS[mode](now, active)
  oledTexture.needsUpdate = true
  listeners.forEach((fn) => fn())
}

let started = false
export function startOled() {
  if (started || !canvas) return
  started = true
  let last = 0
  const loop = (now: number) => {
    requestAnimationFrame(loop)
    if (now - last < 50) return // 20 fps, like the real I²C OLED refresh
    last = now
    tick(now)
  }
  requestAnimationFrame(loop)
}

/** Shader that turns the 1-bit framebuffer into a glowing cyan OLED panel with visible pixels. */
export function createOledMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: oledTexture },
      res: { value: new THREE.Vector2(OLED_W, OLED_H) },
      tint: { value: new THREE.Color('#5ff6ff') },
      intensity: { value: 1.35 },
    },
    toneMapped: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform vec2 res; uniform vec3 tint; uniform float intensity;
      varying vec2 vUv;
      void main(){
        vec2 p = vUv * res;
        vec2 cell = fract(p);
        vec2 base = floor(p) + 0.5;
        float c = texture2D(map, base / res).r;
        float g = 0.0;
        for (int i = -2; i <= 2; i++) for (int j = -2; j <= 2; j++) {
          g += texture2D(map, (base + vec2(float(i), float(j))) / res).r * exp(-float(i*i + j*j) / 2.5);
        }
        g /= 9.0;
        float m = smoothstep(0.0, 0.14, cell.x) * smoothstep(1.0, 0.86, cell.x) * smoothstep(0.0, 0.14, cell.y) * smoothstep(1.0, 0.86, cell.y);
        vec3 col = tint * (c * (0.45 + 0.55 * m) * intensity + g * 0.32);
        gl_FragColor = vec4(col + vec3(0.006, 0.008, 0.012), 1.0);
      }
    `,
  })
}
