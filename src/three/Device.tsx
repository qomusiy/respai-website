import { useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import * as THREE from 'three'
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js'
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js'
import { createOledMaterial } from './oled'
import { printLinesTexture, wireMeshTexture } from './textures'
import { live } from '../lib/live'

/**
 * Procedural, high-fidelity rebuild of the RespAI device (modelled in millimetres,
 * proportions taken from the team's GLB + photos):
 * 100×100×15 mm white PLA shell, light-grey printed lid, 0.96" OLED, MQ-6 gas sensor,
 * embossed "RespAI" + "by Laputa", rotary knob on top. Internals (ESP32, mic, buzzer,
 * DHT sensor, module PCBs) are modelled for the exploded view.
 */

const BASE = import.meta.env.BASE_URL

export type ExplodeRef = MutableRefObject<number>

export interface PartAnchor {
  id: string
  /** world-space point the label line should attach to */
  point: THREE.Vector3
  object: THREE.Object3D | null
}

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
  const pts = p.getPoints(8).reverse()
  return new THREE.Path(pts)
}

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

// ————————————————— materials (shared) —————————————————
function useMaterials() {
  return useMemo(() => {
    const lines = printLinesTexture()
    const mesh = wireMeshTexture()
    const shell = new THREE.MeshPhysicalMaterial({ color: '#f3f3f0', roughness: 0.48, clearcoat: 0.15, clearcoatRoughness: 0.6, sheen: 0.2, sheenColor: new THREE.Color('#ffffff') })
    const lid = new THREE.MeshStandardMaterial({ color: '#a9adb2', roughness: 0.66, bumpMap: lines, bumpScale: 0.6 })
    const emboss = new THREE.MeshStandardMaterial({ color: '#b2b6bb', roughness: 0.55, bumpMap: lines, bumpScale: 0.35 })
    const glass = new THREE.MeshPhysicalMaterial({ color: '#030405', roughness: 0.08, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.04 })
    const chrome = new THREE.MeshStandardMaterial({ color: '#dfe2e6', metalness: 1, roughness: 0.16 })
    const wire = new THREE.MeshStandardMaterial({ color: '#c9ccd1', metalness: 0.95, roughness: 0.32, alphaMap: mesh, alphaTest: 0.5, side: THREE.DoubleSide })
    mesh.repeat.set(2.4, 2.4)
    const dark = new THREE.MeshStandardMaterial({ color: '#0d0e10', roughness: 0.7 })
    const knob = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.45, metalness: 0.1 })
    const pcbBlue = new THREE.MeshStandardMaterial({ color: '#1d4ea6', roughness: 0.45 })
    const pcbBlack = new THREE.MeshStandardMaterial({ color: '#17191d', roughness: 0.42 })
    const pcbPurple = new THREE.MeshStandardMaterial({ color: '#4b2a86', roughness: 0.45 })
    const shield = new THREE.MeshStandardMaterial({ color: '#c3c7cd', metalness: 0.9, roughness: 0.28 })
    const gold = new THREE.MeshStandardMaterial({ color: '#d4aa52', metalness: 1, roughness: 0.25 })
    const bakelite = new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.6 })
    const dht = new THREE.MeshStandardMaterial({ color: '#2f8fd8', roughness: 0.5 })
    const oled = createOledMaterial()
    return { shell, lid, emboss, glass, chrome, wire, dark, knob, pcbBlue, pcbBlack, pcbPurple, shield, gold, bakelite, dht, oled }
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

function TextMesh({ text, italic, size, depth, mat, position }: { text: string; italic?: boolean; size: number; depth: number; mat: THREE.Material; position: [number, number, number] }) {
  const font = useLoader(FontLoader, `${BASE}fonts/${italic ? 'poppins-bold-italic' : 'poppins-bold'}.typeface.json`)
  const geo = useMemo(() => {
    const g = new TextGeometry(text, { font, size, depth, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.2, bevelSize: 0.16, bevelSegments: 2 })
    g.computeBoundingBox()
    return g
  }, [font, text, size, depth])
  return <mesh geometry={geo} material={mat} position={position} castShadow />
}

function CenteredText(props: { text: string; size: number; depth: number; mat: THREE.Material; y: number; z: number }) {
  const font = useLoader(FontLoader, `${BASE}fonts/poppins-bold.typeface.json`)
  const geo = useMemo(() => {
    const g = new TextGeometry(props.text, { font, size: props.size, depth: props.depth, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelSegments: 2 })
    g.computeBoundingBox()
    const bb = g.boundingBox!
    g.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, 0)
    return g
  }, [font, props.text, props.size, props.depth])
  return <mesh geometry={geo} material={props.mat} position={[0, props.y, props.z]} />
}

// ————————————————— parts —————————————————
const LID_Z = 0 // front face of the shell

function Lid({ m }: { m: Mats }) {
  const geo = useMemo(() => {
    const s = rrShape(93.5, 93.5, 9.5)
    s.holes.push(rrHole(29, 19.5, 1.2, 0, 8))
    return extrude(s, 1.0, 0.5, 3)
  }, [])
  return (
    <group>
      <mesh geometry={geo} material={m.lid} position={[0, 0, LID_Z + 0.5]} receiveShadow castShadow />
      <CenteredText text="RespAI" size={10.8} depth={0.9} mat={m.emboss} y={-15.5} z={LID_Z + 1.9} />
      <TextMesh text="by Laputa" italic size={4.4} depth={0.7} mat={m.emboss} position={[-41.5, 37.6, LID_Z + 1.9]} />
    </group>
  )
}

function OledModule({ m }: { m: Mats }) {
  // origin = front plane of the display glass
  return (
    <group>
      <mesh material={m.glass} position={[0, 0, -0.7]}>
        <boxGeometry args={[28.4, 18.8, 1.4]} />
      </mesh>
      {/* active area 128×64 → 24.6 × 12.3 mm, sits in the upper part of the glass */}
      <mesh material={m.oled} position={[0, 1.6, 0.01]}>
        <planeGeometry args={[24.6, 12.3]} />
      </mesh>
      <mesh material={m.pcbBlue} position={[0, 0, -2.0]}>
        <boxGeometry args={[27.3, 27.8, 1.2]} />
      </mesh>
      {[-3.81, -1.27, 1.27, 3.81].map((x) => (
        <mesh key={x} material={m.gold} position={[x, 12.2, -2.0]}>
          <cylinderGeometry args={[0.55, 0.55, 1.3, 10]} />
        </mesh>
      ))}
    </group>
  )
}

function GasSensor({ m }: { m: Mats }) {
  // MQ-6: bakelite base + chrome ring + stainless mesh dome, on a blue module PCB.
  // origin = lid surface at the sensor centre
  // shallow spherical cap: R=12, base radius ≈ 6.6 mm, base plane at z=2.6
  const dome = useMemo(() => {
    const g = new THREE.SphereGeometry(12, 48, 10, 0, Math.PI * 2, 0, 0.582)
    // planar projection so the wire grid reads as a woven mesh, not radial spokes
    const pos = g.attributes.position
    const uv = g.attributes.uv
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 7 + 0.5, pos.getZ(i) / 7 + 0.5)
    uv.needsUpdate = true
    return g
  }, [])
  return (
    <group>
      <mesh material={m.chrome} position={[0, 0, 1.4]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[8.6, 8.9, 2.8, 48]} />
      </mesh>
      <mesh material={m.chrome} position={[0, 0, 3.3]}>
        <torusGeometry args={[7.45, 1.05, 18, 48]} />
      </mesh>
      <mesh material={m.dark} position={[0, 0, 1.4]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[6.7, 6.7, 2.2, 32]} />
      </mesh>
      <mesh geometry={dome} material={m.wire} position={[0, 0, -7.4]} rotation={[Math.PI / 2, 0, 0]} />
      {/* body below the lid */}
      <mesh material={m.bakelite} position={[0, 0, -5]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[9.6, 9.6, 8, 40]} />
      </mesh>
      <mesh material={m.pcbBlue} position={[0, -2, -9.6]}>
        <boxGeometry args={[32, 22, 1.2]} />
      </mesh>
    </group>
  )
}

function Board({ m }: { m: Mats }) {
  // ESP32 DevKit-style board
  return (
    <group>
      <mesh material={m.pcbBlack} castShadow>
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

function Shell({ m }: { m: Mats }) {
  const walls = useMemo(() => {
    const s = rrShape(98, 98, 11)
    s.holes.push(rrHole(90, 90, 7.5))
    return extrude(s, 12.6, 1.0, 4)
  }, [])
  return (
    <group>
      <mesh geometry={walls} material={m.shell} position={[0, 0, -13.6]} castShadow receiveShadow />
      {/* knob on top edge, like the real rotary switch */}
      <group position={[30, 52, -6.5]}>
        <mesh material={m.knob}>
          <cylinderGeometry args={[4.6, 4.6, 8, 28]} />
        </mesh>
        <mesh material={m.knob} position={[0, 4.4, 0]}>
          <cylinderGeometry args={[4.1, 4.6, 0.8, 28]} />
        </mesh>
      </group>
      {/* USB-C on the left side */}
      <mesh material={m.dark} position={[-50.05, -18, -6.5]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[9, 3.4]} />
      </mesh>
    </group>
  )
}

function BackPanel({ m }: { m: Mats }) {
  const geo = useMemo(() => extrude(rrShape(96, 96, 10), 1.6, 0.6, 3), [])
  const vents = useMemo(() => new THREE.CapsuleGeometry(0.9, 26, 4, 12), [])
  return (
    <group>
      <mesh geometry={geo} material={m.shell} position={[0, 0, -15]} />
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

export function Device({ explode, internals = false, anchorsRef }: DeviceProps) {
  const m = useMaterials()
  const parts = useRef<Record<string, THREE.Group | null>>({})
  const base: Record<string, [number, number, number]> = {
    lid: [0, 0, 0],
    oled: [0, 8, 0.6],
    sensor: [25, -28, 1.5],
    mic: [-28, -28, -6],
    buzzer: [-30, 26, -8],
    dht: [28, 26, -9],
    board: [-2, -2, -10],
    shell: [0, 0, 0],
    back: [0, 0, 0],
  }

  useFrame(() => {
    const e = explode ? explode.current : 0
    for (const [id, g] of Object.entries(parts.current)) {
      if (!g) continue
      const cfg = EXPLODE[id]
      const b = base[id]
      const local = ease((e - cfg.delay) / (1 - cfg.delay))
      g.position.set(b[0], b[1], b[2] + cfg.dz * local)
    }
    // OLED flash brightness on cough
    const u = (m.oled.uniforms.intensity as { value: number })
    u.value = 1.35 + live.flash * 0.5
  })

  const reg = (id: string) => (g: THREE.Group | null) => {
    parts.current[id] = g
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
