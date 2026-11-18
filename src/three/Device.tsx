import { useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { FontLoader, type Font } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { createOledMaterial } from './oled'
import { canvasTexture, layerLinesTexture, oledGlassTexture, printLinesTexture, wovenMeshTexture } from './textures'
import { live } from '../lib/live'

/**
 * Procedural rebuild of the RespAI prototype, modelled in millimetres from the
 * team's photos: a 100×100×15 mm white PLA shell with a light-grey printed lid set
 * just inside its rim, embossed "RespAI" + "by Invenio", a 0.96" OLED behind a window,
 * the MQ-6 gas sensor through the lid and a knurled rotary knob on the top edge.
 * Internals (ESP32, mic, buzzer, DHT sensor, module PCBs) are modelled for the exploded view.
 */

const BASE = import.meta.env.BASE_URL

export type ExplodeRef = MutableRefObject<number>

export interface PartAnchor {
  id: string
  /** world-space point the label line should attach to */
  point: THREE.Vector3
  object: THREE.Object3D | null
}

// ————————————————— dimensions (mm) —————————————————
// z = 0 is the front face of the white rim; +z points out of the device.
const SHELL = { size: 100, r: 12, bevel: 1.4, depth: 14.6 }
/** opening in the rim; its rounded edge curves down to the lid */
const RIM_OPEN = { size: 95.2, r: 9.3 }
const LID = { size: 92.2, r: 7.8, bevel: 0.4, thick: 2.4, recess: 0.5 }
const LID_FACE = -LID.recess
const LID_BACK = LID_FACE - LID.thick
const WIN = { w: 29, h: 19.5, r: 0.9, y: 8 }
const SENSOR = { x: 27, y: -28.5, hole: 9.0 }
const OLED = { glassW: 30.6, glassH: 21, activeW: 24.6, activeH: 12.3, activeY: 2.5 }
const TITLE = { text: 'RespAI', size: 12, y: -16.1 }
const BYLINE = { text: 'by Invenio', size: 4.6, x: -41.4, y: 39.2 }

// ————————————————— geometry helpers —————————————————
function roundedRectPath(path: THREE.Path, w: number, h: number, r: number, cx = 0, cy = 0) {
  const x = cx - w / 2
  const y = cy - h / 2
  path.moveTo(x + r, y)
  path.lineTo(x + w - r, y)
  path.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false)
  path.lineTo(x + w, y + h - r)
  path.absarc(x + w - r, y + h - r, r, 0, Math.PI / 2, false)
  path.lineTo(x + r, y + h)
  path.absarc(x + r, y + h - r, r, Math.PI / 2, Math.PI, false)
  path.lineTo(x, y + r)
  path.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false)
  return path
}
const rrShape = (w: number, h: number, r: number, cx = 0, cy = 0) => roundedRectPath(new THREE.Shape(), w, h, r, cx, cy) as THREE.Shape
const rrHole = (w: number, h: number, r: number, cx = 0, cy = 0) => {
  // holes must wind opposite to the outer shape
  const p = roundedRectPath(new THREE.Path(), w, h, r, cx, cy)
  const pts = p.getPoints(10).reverse()
  return new THREE.Path(pts)
}
const circleHole = (r: number, cx: number, cy: number) => new THREE.Path().absarc(cx, cy, r, 0, Math.PI * 2, true)

function extrude(shape: THREE.Shape, depth: number, bevel: number, segments = 4, curveSegments = 24) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segments,
    curveSegments,
  })
  g.computeVertexNormals()
  return g
}

// ————————————————— materials (shared per device) —————————————————
function useMaterials() {
  return useMemo(() => {
    const lines = printLinesTexture()
    const layers = layerLinesTexture()
    // white PLA: warm, satin, no clear-coat shine
    const shellCap = new THREE.MeshPhysicalMaterial({ color: '#efede7', roughness: 0.6, sheen: 0.35, sheenRoughness: 0.7, sheenColor: new THREE.Color('#ffffff') })
    const shellSide = shellCap.clone()
    shellSide.bumpMap = layers
    shellSide.bumpScale = 0.9
    // light-grey printed lid: matte with a directional sheen along the top-layer lines
    const lid = new THREE.MeshPhysicalMaterial({ color: '#a7abb0', roughness: 0.66, bumpMap: lines, bumpScale: 1.0, anisotropy: 0.5, anisotropyRotation: Math.PI / 4 })
    const lidSide = new THREE.MeshStandardMaterial({ color: '#a2a6ab', roughness: 0.75 })
    const glass = new THREE.MeshPhysicalMaterial({ map: oledGlassTexture(OLED.glassW, OLED.glassH, OLED.activeY), roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 })
    // reflections on top of the self-lit OLED pixels (adds only the specular part)
    const glare = new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.04, metalness: 0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    const chrome = new THREE.MeshStandardMaterial({ color: '#dfe2e6', metalness: 1, roughness: 0.16 })
    // satin stainless with circular brushing (anisotropy follows the lathe's u = around)
    const steel = new THREE.MeshPhysicalMaterial({ color: '#d3d6da', metalness: 1, roughness: 0.34, anisotropy: 0.7, side: THREE.DoubleSide })
    const wire = new THREE.MeshStandardMaterial({ map: wovenMeshTexture('color'), bumpMap: wovenMeshTexture('height'), bumpScale: 1.2, metalness: 0.85, roughness: 0.42 })
    const zinc = new THREE.MeshStandardMaterial({ color: '#b9bcc0', metalness: 0.9, roughness: 0.38 })
    const dark = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.7 })
    const knob = new THREE.MeshPhysicalMaterial({ color: '#16171a', roughness: 0.5, sheen: 0.4, sheenRoughness: 0.5, sheenColor: new THREE.Color('#4a4d55') })
    const pcbBlue = new THREE.MeshStandardMaterial({ color: '#1d4ea6', roughness: 0.45 })
    const pcbBlack = new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.42 })
    const pcbPurple = new THREE.MeshStandardMaterial({ color: '#4b2a86', roughness: 0.45 })
    const shield = new THREE.MeshStandardMaterial({ color: '#c3c7cd', metalness: 0.9, roughness: 0.28 })
    const gold = new THREE.MeshStandardMaterial({ color: '#d4aa52', metalness: 1, roughness: 0.25 })
    const bakelite = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.6 })
    const dht = new THREE.MeshStandardMaterial({ color: '#2f8fd8', roughness: 0.5 })
    const oled = createOledMaterial()
    return { shellCap, shellSide, lid, lidSide, glass, glare, chrome, steel, wire, zinc, dark, knob, pcbBlue, pcbBlack, pcbPurple, shield, gold, bakelite, dht, oled }
  }, [])
}

type Mats = ReturnType<typeof useMaterials>

// ————————————————— explode choreography —————————————————
// [id, assembled z offset, exploded extra offset (mm), stagger delay 0..1]
const EXPLODE: Record<string, { dz: number; delay: number }> = {
  lid: { dz: 66, delay: 0.0 },
  oled: { dz: 46, delay: 0.08 },
  sensor: { dz: 30, delay: 0.14 },
  mic: { dz: 15, delay: 0.2 },
  buzzer: { dz: 15, delay: 0.22 },
  dht: { dz: 15, delay: 0.24 },
  board: { dz: 0, delay: 0.3 },
  shell: { dz: -26, delay: 0.1 },
  back: { dz: -50, delay: 0.12 },
}

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

// ————————————————— lid —————————————————
type Pt = [number, number]

/** Shapes of a text line positioned on the lid (mm, y up), plus a matching TextGeometry. */
function lidText(font: Font, text: string, size: number, at: Pt, centred: boolean) {
  const shapes = font.generateShapes(text, size)
  const geo = new TextGeometry(text, { font, size, depth: 0.8, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.15, bevelSize: 0.12, bevelSegments: 2 })
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const off: Pt = centred ? [at[0] - (bb.max.x + bb.min.x) / 2, at[1] - (bb.max.y + bb.min.y) / 2] : at
  geo.translate(off[0], off[1], 0)
  return { shapes, geo, off }
}

/**
 * Baked shading for the lid face: contact shadows under the embossed letters and the
 * gas-sensor ring, and a little occlusion where the lid meets the rim. Multiplies the
 * lid colour, so it works under every light, at no runtime cost.
 */
function lidShading(texts: Array<{ shapes: THREE.Shape[]; off: Pt }>) {
  const half = 47
  const t = canvasTexture(
    'lid-shading-invenio',
    1024,
    (ctx, S) => {
      const k = S / (half * 2)
      const X = (x: number) => (x + half) * k
      const Y = (y: number) => (half - y) * k
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, S, S)

      // faint large-scale mottling so the surface is not perfectly uniform
      let seed = 3
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < 90; i++) {
        const r = (10 + rand() * 22) * k
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r)
        const a = 0.012 * rand()
        g.addColorStop(0, `rgba(0,0,0,${a})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.save()
        ctx.translate(rand() * S, rand() * S)
        ctx.fillStyle = g
        ctx.fillRect(-r, -r, r * 2, r * 2)
        ctx.restore()
      }

      // shadowBlur trick: draw the shape far off-canvas and let only its blurred shadow land
      const FAR = S * 3
      const shadow = (alpha: number, blurMm: number, dx: number, dy: number, path: () => void, rule: CanvasFillRule = 'nonzero') => {
        ctx.save()
        ctx.shadowColor = `rgba(0,0,0,${alpha})`
        ctx.shadowBlur = blurMm * k
        ctx.shadowOffsetX = FAR + dx * k
        ctx.shadowOffsetY = -dy * k
        ctx.translate(-FAR, 0)
        ctx.fillStyle = '#000'
        ctx.beginPath()
        path()
        ctx.fill(rule)
        ctx.restore()
      }
      const trace = (pts: THREE.Vector2[], off: Pt) => {
        pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x + off[0]), Y(p.y + off[1])) : ctx.moveTo(X(p.x + off[0]), Y(p.y + off[1]))))
        ctx.closePath()
      }

      // rim occlusion: everything outside the lid casts inwards
      const lidEdge = () => {
        ctx.rect(-S, -S, S * 3, S * 3)
        const h = LID.size / 2
        const r = LID.r
        ctx.moveTo(X(-h + r), Y(-h))
        ctx.arcTo(X(-h), Y(-h), X(-h), Y(-h + r), r * k)
        ctx.lineTo(X(-h), Y(h - r))
        ctx.arcTo(X(-h), Y(h), X(-h + r), Y(h), r * k)
        ctx.lineTo(X(h - r), Y(h))
        ctx.arcTo(X(h), Y(h), X(h), Y(h - r), r * k)
        ctx.lineTo(X(h), Y(-h + r))
        ctx.arcTo(X(h), Y(-h), X(h - r), Y(-h), r * k)
        ctx.closePath()
      }
      shadow(0.32, 2.2, 0, 0, lidEdge, 'evenodd')

      // gas-sensor ring (stands ~4 mm proud of the lid)
      const ring = () => ctx.arc(X(SENSOR.x), Y(SENSOR.y), (SENSOR.hole + 0.2) * k, 0, Math.PI * 2)
      shadow(0.5, 2.6, 0.5, -0.7, ring)
      shadow(0.35, 0.7, 0.15, -0.2, ring)

      // embossed letters: a tight contact shadow plus a wider soft one
      for (const { shapes, off } of texts) {
        for (const s of shapes) {
          const path = () => {
            trace(s.getPoints(6), off)
            for (const hole of s.holes) trace(hole.getPoints(6), off)
          }
          shadow(0.22, 1.6, 0.3, -0.45, path, 'evenodd')
          shadow(0.42, 0.35, 0.18, -0.26, path, 'evenodd')
        }
      }
    },
    { srgb: true, wrap: false },
  )
  t.repeat.set(1 / (half * 2), 1 / (half * 2))
  t.offset.set(0.5, 0.5)
  return t
}

function Lid({ m }: { m: Mats }) {
  const font = useLoader(FontLoader, `${BASE}fonts/poppins-bold.typeface.json`)
  const italic = useLoader(FontLoader, `${BASE}fonts/poppins-bold-italic.typeface.json`)
  const { plate, face, title, byline } = useMemo(() => {
    const s = rrShape(LID.size - LID.bevel * 2, LID.size - LID.bevel * 2, LID.r - LID.bevel)
    s.holes.push(rrHole(WIN.w, WIN.h, WIN.r, 0, WIN.y))
    s.holes.push(circleHole(SENSOR.hole, SENSOR.x, SENSOR.y))
    const plate = extrude(s, LID.thick - LID.bevel * 2, LID.bevel, 3, 40)
    const title = lidText(font, TITLE.text, TITLE.size, [0, TITLE.y], true)
    const byline = lidText(italic, BYLINE.text, BYLINE.size, [BYLINE.x, BYLINE.y], false)
    const face = m.lid.clone()
    face.map = lidShading([title, byline])
    return { plate, face, title: title.geo, byline: byline.geo }
  }, [font, italic, m.lid])
  // letters sit 0.05 mm into the lid face and stand ~1 mm proud
  const tz = LID_FACE + 0.1
  return (
    <group>
      <mesh geometry={plate} material={[face, m.lidSide]} position={[0, 0, LID_BACK + LID.bevel]} />
      <mesh geometry={title} material={m.lid} position={[0, 0, tz]} />
      <mesh geometry={byline} material={m.lid} position={[0, 0, tz]} />
    </group>
  )
}

// ————————————————— parts —————————————————
function OledModule({ m }: { m: Mats }) {
  // origin = front plane of the display glass, centred on the lid window
  return (
    <group>
      <mesh material={m.glass} position={[0, 0, -0.6]}>
        <boxGeometry args={[OLED.glassW, OLED.glassH, 1.2]} />
      </mesh>
      <mesh material={m.oled} position={[0, OLED.activeY, 0.01]}>
        <planeGeometry args={[OLED.activeW, OLED.activeH]} />
      </mesh>
      <mesh material={m.glare} position={[0, OLED.activeY, 0.03]} renderOrder={2}>
        <planeGeometry args={[OLED.activeW, OLED.activeH]} />
      </mesh>
      <mesh material={m.pcbBlue} position={[0, -1.5, -1.9]}>
        <boxGeometry args={[27.3, 27.8, 1.2]} />
      </mesh>
      {[-3.81, -1.27, 1.27, 3.81].map((x) => (
        <mesh key={x} material={m.gold} position={[x, 10.7, -1.9]}>
          <cylinderGeometry args={[0.55, 0.55, 1.3, 10]} />
        </mesh>
      ))}
    </group>
  )
}

function GasSensor({ m }: { m: Mats }) {
  // MQ-6: stainless cap (crimped rim + woven mesh dome) on a bakelite base, on a blue module PCB.
  // origin = lid face at the sensor centre, +z out of the lid
  const { cap, dome } = useMemo(() => {
    // lathe profile (x = radius, y = height): side wall up through the lid, rolled rim, lip into the mesh
    const pts: THREE.Vector2[] = [new THREE.Vector2(8.4, -6), new THREE.Vector2(8.4, 2.6)]
    for (let i = 1; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2)
      pts.push(new THREE.Vector2(7.6 + 0.8 * Math.cos(a), 2.6 + 0.8 * Math.sin(a)))
    }
    pts.push(new THREE.Vector2(7.0, 3.4), new THREE.Vector2(6.75, 3.32), new THREE.Vector2(6.55, 3.12), new THREE.Vector2(6.45, 2.9))
    const cap = new THREE.LatheGeometry(pts, 72)
    // shallow dome: base radius 6.45 at z 2.9, 0.9 mm rise
    const rise = 0.9
    const R = (6.45 * 6.45 + rise * rise) / (2 * rise)
    const g = new THREE.SphereGeometry(R, 72, 12, 0, Math.PI * 2, 0, Math.asin(6.45 / R))
    // planar projection so the weave reads as a flat woven mesh, not radial spokes
    const pos = g.attributes.position
    const uv = g.attributes.uv
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 7 + 0.5, pos.getZ(i) / 7 + 0.5)
    uv.needsUpdate = true
    g.translate(0, 2.9 + rise - R, 0)
    return { cap, dome: g }
  }, [])
  return (
    <group>
      <group rotation={[Math.PI / 2, 0, 0]}>
        <mesh geometry={cap} material={m.steel} />
        <mesh geometry={dome} material={m.wire} />
      </group>
      {/* bakelite body and module board below the lid */}
      <mesh material={m.bakelite} position={[0, 0, -6.4]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[9.6, 9.6, 7, 40]} />
      </mesh>
      <mesh material={m.pcbBlue} position={[0, -2, -10.6]}>
        <boxGeometry args={[32, 22, 1.2]} />
      </mesh>
    </group>
  )
}

function Board({ m }: { m: Mats }) {
  // ESP32 DevKit-style board
  return (
    <group>
      <mesh material={m.pcbBlack}>
        <boxGeometry args={[51, 28, 1.6]} />
      </mesh>
      <mesh material={m.shield} position={[-4, 0, 2.2]}>
        <boxGeometry args={[18, 16, 2.8]} />
      </mesh>
      <mesh material={m.pcbBlack} position={[-17.5, 0, 1.2]}>
        <boxGeometry args={[7, 18, 0.9]} />
      </mesh>
      {/* antenna trace */}
      <mesh material={m.gold} position={[-17.5, 0, 1.7]}>
        <boxGeometry args={[4.5, 0.6, 0.05]} />
      </mesh>
      {/* pin headers */}
      {[-12.2, 12.2].map((y) => (
        <mesh key={y} material={m.dark} position={[2, y, 1.6]}>
          <boxGeometry args={[46, 2.5, 2.4]} />
        </mesh>
      ))}
      {/* usb */}
      <mesh material={m.shield} position={[24.5, 0, 1.6]}>
        <boxGeometry args={[6, 8, 2.8]} />
      </mesh>
      {/* buttons + smd */}
      {[[18, 8], [18, -8]].map(([x, y]) => (
        <mesh key={`${x}${y}`} material={m.dark} position={[x, y, 1.2]}>
          <boxGeometry args={[3.5, 3, 1]} />
        </mesh>
      ))}
      {Array.from({ length: 10 }).map((_, i) => (
        <mesh key={i} material={i % 3 ? m.shield : m.gold} position={[8 + (i % 5) * 2.2, -4 + Math.floor(i / 5) * 6, 1]}>
          <boxGeometry args={[1.4, 0.8, 0.5]} />
        </mesh>
      ))}
    </group>
  )
}

function Mic({ m }: { m: Mats }) {
  return (
    <group>
      <mesh material={m.pcbPurple} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[7, 7, 1.2, 32]} />
      </mesh>
      <mesh material={m.shield} position={[0, 0, 1.2]}>
        <boxGeometry args={[4, 3, 1.2]} />
      </mesh>
      {[-2.54, 0, 2.54].map((x) => (
        <mesh key={x} material={m.gold} position={[x, -5, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.6, 0.6, 1.3, 8]} />
        </mesh>
      ))}
    </group>
  )
}

function Buzzer({ m }: { m: Mats }) {
  return (
    <group>
      <mesh material={m.knob} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[6, 6, 8, 32]} />
      </mesh>
      <mesh material={m.dark} position={[0, 0, 4.05]}>
        <circleGeometry args={[1.2, 16]} />
      </mesh>
    </group>
  )
}

function Dht({ m }: { m: Mats }) {
  return (
    <group>
      <mesh material={m.dht}>
        <boxGeometry args={[12, 15.5, 5.5]} />
      </mesh>
      {Array.from({ length: 4 }).map((_, r) =>
        Array.from({ length: 3 }).map((__, c) => (
          <mesh key={`${r}${c}`} material={m.dark} position={[-3.2 + c * 3.2, 4.5 - r * 3.2, 2.77]}>
            <planeGeometry args={[1.8, 1.8]} />
          </mesh>
        )),
      )}
    </group>
  )
}

/** Knurled rotary knob: a ridged profile extruded along its axis, rounded at the top. */
function useKnobGeometry() {
  return useMemo(() => {
    const ridges = 24
    const R = 4.7
    const depth = 0.32
    const s = new THREE.Shape()
    const N = ridges * 10
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2
      const k = THREE.MathUtils.clamp(0.5 + 1.6 * Math.sin(a * ridges), 0, 1)
      const r = R - depth * (1 - k)
      if (i === 0) s.moveTo(r * Math.cos(a), r * Math.sin(a))
      else s.lineTo(r * Math.cos(a), r * Math.sin(a))
    }
    const body = new THREE.ExtrudeGeometry(s, { depth: 6.4, bevelEnabled: true, bevelThickness: 0.7, bevelSize: 0.45, bevelSegments: 4, curveSegments: 1 })
    body.computeVertexNormals()
    // extrusion runs along +z: stand it up along +y, base at y = 0
    body.rotateX(-Math.PI / 2)
    body.translate(0, 0.7, 0)
    return body
  }, [])
}

function Shell({ m }: { m: Mats }) {
  const walls = useMemo(() => {
    const b = SHELL.bevel
    const s = rrShape(SHELL.size - b * 2, SHELL.size - b * 2, SHELL.r - b)
    s.holes.push(rrHole(RIM_OPEN.size, RIM_OPEN.size, RIM_OPEN.r))
    return extrude(s, SHELL.depth - b * 2, b, 5, 32)
  }, [])
  const knob = useKnobGeometry()
  const usb = useMemo(() => {
    const plug = new THREE.ShapeGeometry(rrShape(8.9, 3.2, 1.55), 8)
    const frameShape = rrShape(8.9, 3.2, 1.55)
    frameShape.holes.push(rrHole(8.0, 2.4, 1.15))
    const frame = new THREE.ShapeGeometry(frameShape, 8)
    return { plug, frame }
  }, [])
  return (
    <group>
      <mesh geometry={walls} material={[m.shellCap, m.shellSide]} position={[0, 0, -SHELL.depth + SHELL.bevel]} />
      {/* rotary knob on the top edge, on a zinc nut */}
      <group position={[26, SHELL.size / 2, -7.3]}>
        <mesh material={m.zinc} position={[0, 0.5, 0]}>
          <cylinderGeometry args={[4.1, 4.1, 1, 6]} />
        </mesh>
        <mesh geometry={knob} material={m.knob} position={[0, 1.1, 0]} />
      </group>
      {/* USB-C on the left side */}
      <group position={[-SHELL.size / 2 - 0.02, -18, -7.3]} rotation={[0, -Math.PI / 2, 0]}>
        <mesh geometry={usb.plug} material={m.dark} />
        <mesh geometry={usb.frame} material={m.zinc} position={[0, 0, 0.01]} />
        <mesh material={m.dark} position={[0, 0, 0.02]}>
          <planeGeometry args={[5.6, 0.7]} />
        </mesh>
      </group>
    </group>
  )
}

function BackPanel({ m }: { m: Mats }) {
  const geo = useMemo(() => extrude(rrShape(96, 96, 10), 1.6, 0.6, 3), [])
  const vents = useMemo(() => new THREE.CapsuleGeometry(0.9, 26, 4, 12), [])
  return (
    <group>
      <mesh geometry={geo} material={m.shellCap} position={[0, 0, -15]} />
      {[-10, -5, 0, 5, 10].map((y) => (
        <mesh key={y} geometry={vents} material={m.dark} position={[0, y, -15.62]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.1]} />
      ))}
    </group>
  )
}

// ————————————————— assembled device —————————————————
export interface DeviceProps {
  /** 0 = assembled, 1 = fully exploded */
  explode?: ExplodeRef
  internals?: boolean
  /** filled with label anchor objects when internals are shown */
  anchorsRef?: MutableRefObject<Record<string, THREE.Object3D | null>>
  /** pulse the shell glow on cough */
  reactive?: boolean
}

const PART_BASE: Record<string, [number, number, number]> = {
  lid: [0, 0, 0],
  oled: [0, WIN.y, LID_BACK - 0.05],
  sensor: [SENSOR.x, SENSOR.y, LID_FACE],
  mic: [-28, -28, -7],
  buzzer: [-30, 26, -8.5],
  dht: [28, 26, -9],
  board: [-2, -2, -10],
  shell: [0, 0, 0],
  back: [0, 0, 0],
}

export function Device({ explode, internals = false, anchorsRef }: DeviceProps) {
  const m = useMaterials()
  const parts = useRef<Record<string, THREE.Group | null>>({})

  useFrame(() => {
    const e = explode ? explode.current : 0
    for (const [id, g] of Object.entries(parts.current)) {
      if (!g) continue
      const cfg = EXPLODE[id]
      const b = PART_BASE[id]
      const local = ease((e - cfg.delay) / (1 - cfg.delay))
      g.position.set(b[0], b[1], b[2] + cfg.dz * local)
    }
    // OLED flash brightness on cough
    const u = m.oled.uniforms.intensity as { value: number }
    u.value = 1.35 + live.flash * 0.5
  })

  const reg = (id: string) => (g: THREE.Group | null) => {
    parts.current[id] = g
    if (g) {
      const b = PART_BASE[id]
      g.position.set(b[0], b[1], b[2])
    }
    if (anchorsRef) anchorsRef.current[id] = g
  }

  return (
    <group>
      <group ref={reg('shell')}>
        <Shell m={m} />
      </group>
      <group ref={reg('back')}>
        <BackPanel m={m} />
      </group>
      <group ref={reg('lid')}>
        <Lid m={m} />
      </group>
      <group ref={reg('oled')}>
        <OledModule m={m} />
      </group>
      <group ref={reg('sensor')}>
        <GasSensor m={m} />
      </group>
      {internals && (
        <>
          <group ref={reg('board')}>
            <Board m={m} />
          </group>
          <group ref={reg('mic')}>
            <Mic m={m} />
          </group>
          <group ref={reg('buzzer')}>
            <Buzzer m={m} />
          </group>
          <group ref={reg('dht')}>
            <Dht m={m} />
          </group>
        </>
      )}
    </group>
  )
}
