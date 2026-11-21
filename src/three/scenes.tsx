import { useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Float, PerspectiveCamera, PresentationControls } from '@react-three/drei'
import * as THREE from 'three'
import { Device } from './Device'
import { Orb } from './Orb'
import { StudioLights } from './Stage'
import { useApp } from '../lib/live'

const S = 0.022 // mm → scene units (device ≈ 2.2 units wide)
const damp = THREE.MathUtils.damp

// —————————————————————————— HERO ——————————————————————————
// target device rotation per hero feature (x, y)
const HERO_POSES: Array<[number, number]> = [
  [-0.16, -0.52], // cough AI
  [-0.36, -0.2], // air (tilt to the gas sensor)
  [0.12, 0.62], // edge
  [-0.06, -0.12], // reminder (face the OLED)
  [-0.24, -0.78], // privacy
]

export function HeroScene({ progress }: { progress: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null)
  const size = useThree((s) => s.size)
  const aspect = size.width / Math.max(1, size.height)
  const mobile = aspect < 0.95
  // keep the device ~62% of the width on portrait screens
  const camZ = mobile ? Math.max(9, 1.5 / (aspect * Math.tan(THREE.MathUtils.degToRad(13)))) : 7.4

  useFrame((state, dt) => {
    const g = group.current
    if (!g) return
    const idx = useApp.getState().heroIndex
    const [rx, ry] = HERO_POSES[idx] ?? HERO_POSES[0]
    const p = progress.current
    const px = state.pointer.x
    const py = state.pointer.y
    g.rotation.x = damp(g.rotation.x, rx - py * 0.12 + p * 0.35, 3.2, dt)
    g.rotation.y = damp(g.rotation.y, ry + px * 0.22 + p * 1.1, 3.2, dt)
    g.rotation.z = damp(g.rotation.z, 0.05 - px * 0.03, 3, dt)
    const tx = mobile ? 0 : 0.42
    const ty = (mobile ? -0.35 : -0.08) + p * 1.6
    g.position.x = damp(g.position.x, tx, 4, dt)
    g.position.y = damp(g.position.y, ty, 4, dt)
  })

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, camZ]} fov={26} />
      <StudioLights />
      <PresentationControls global={false} cursor snap speed={1.4} polar={[-0.5, 0.5]} azimuth={[-1.4, 1.4]}>
        <Float speed={1.6} rotationIntensity={0.12} floatIntensity={0.35} floatingRange={[-0.05, 0.05]}>
          <group ref={group} scale={S}>
            <Device />
          </group>
        </Float>
      </PresentationControls>
      <ContactShadows position={[mobile ? 0 : 0.42, mobile ? -2 : -1.75, 0]} opacity={0.32} scale={7} blur={2.8} far={3.2} resolution={512} color="#2b2f36" />
    </>
  )
}

// —————————————————————————— ORB ——————————————————————————
export function OrbScene({ scale = 1, z = 5.2, mobileY = 0 }: { scale?: number; z?: number; mobileY?: number }) {
  const g = useRef<THREE.Group>(null)
  const size = useThree((s) => s.size)
  const aspect = size.width / Math.max(1, size.height)
  // orb + particles span ~2.4 units: shrink on narrow views so it never overflows
  const halfW = z * Math.tan(THREE.MathUtils.degToRad(16)) * aspect
  const fit = Math.min(scale, (halfW * 0.92) / 1.25)
  const portrait = aspect < 0.95
  useFrame((state, dt) => {
    if (!g.current) return
    g.current.rotation.x = damp(g.current.rotation.x, state.pointer.y * 0.15, 2, dt)
    g.current.rotation.y = damp(g.current.rotation.y, state.pointer.x * 0.25, 2, dt)
  })
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0, z]} fov={32} />
      <group position={[0, portrait ? mobileY : 0, 0]}>
        <group ref={g} scale={fit}>
          <Orb />
        </group>
      </group>
    </>
  )
}

// —————————————————————————— EXPLODED ——————————————————————————
export interface PartLabelDef {
  id: string
  title: string
  text: string
  /** anchor offset inside the part (mm) */
  at: [number, number, number]
  /** explode progress at which the label appears */
  show: number
}

export const PART_LABELS: PartLabelDef[] = [
  { id: 'lid', title: '3D-printed lid', text: 'PLA top with embossed RespAI branding, 94 × 94 mm.', at: [-38, -36, 1.5], show: 0.22 },
  { id: 'oled', title: '0.96″ OLED · 128×64', text: 'Live cough probability, count, temperature, humidity and gas.', at: [-12, 6, 0], show: 0.32 },
  { id: 'sensor', title: 'MQ‑6 gas sensor', text: 'Detects LPG, propane, butane and methane in the room.', at: [8, -7, 3.5], show: 0.42 },
  { id: 'mic', title: 'Digital microphone', text: 'Always-on listening. Audio is analysed locally, never stored.', at: [-6, 2, 0.6], show: 0.52 },
  { id: 'board', title: 'ESP32 microcontroller', text: 'Runs the Resp‑1 neural network on-device. Wi‑Fi + cloud sync.', at: [-4, 0, 3.6], show: 0.62 },
  { id: 'dht', title: 'Temperature & humidity', text: 'Room climate, shown on screen and in the app.', at: [5, 6, 2.8], show: 0.7 },
  { id: 'buzzer', title: 'Buzzer', text: 'Medication reminders and gas alerts.', at: [-5, 4, 4], show: 0.78 },
  { id: 'shell', title: 'Enclosure', text: '100 × 100 × 15 mm white PLA shell.', at: [47, -30, -6], show: 0.86 },
]

export function ExplodedScene({
  progress,
  labelEls,
}: {
  progress: MutableRefObject<number>
  labelEls: MutableRefObject<Record<string, HTMLDivElement | null>>
}) {
  const explode = useRef(0)
  const anchors = useRef<Record<string, THREE.Object3D | null>>({})
  const group = useRef<THREE.Group>(null)
  const size = useThree((s) => s.size)
  const camera = useThree((s) => s.camera)
  const mobile = size.width / Math.max(1, size.height) < 0.95
  const v = useMemo(() => new THREE.Vector3(), [])
  const c = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, dt) => {
    const p = progress.current
    const e = THREE.MathUtils.smoothstep(p, 0.05, 0.6)
    explode.current = damp(explode.current, e, 6, dt)
    const g = group.current
    if (g) {
      // start almost front-on, swing to a 3/4 view as it comes apart
      g.rotation.y = damp(g.rotation.y, -0.22 - e * 0.86 + state.pointer.x * 0.06, 3, dt)
      g.rotation.x = damp(g.rotation.x, 0.1 + e * 0.16 - state.pointer.y * 0.04, 3, dt)
      g.position.x = mobile ? 0.5 * e : 0.62 + e * 0.38
      g.position.y = mobile ? -0.9 : -0.05
    }
    // centre of the device on screen, to decide label sides
    c.set(0, 0, 0)
    g?.localToWorld(c)
    c.project(camera)
    const cx = (c.x * 0.5 + 0.5) * size.width

    // the "active" label is the last one revealed
    let activeId = ''
    for (const def of PART_LABELS) if (explode.current > def.show) activeId = def.id
    for (const def of PART_LABELS) {
      const el = labelEls.current[def.id]
      const obj = anchors.current[def.id]
      if (!el || !obj) continue
      v.set(def.at[0], def.at[1], def.at[2])
      obj.localToWorld(v)
      v.project(camera)
      const x = (v.x * 0.5 + 0.5) * size.width
      const y = (-v.y * 0.5 + 0.5) * size.height
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`
      const act = def.id === activeId && p < 0.9
      const on = explode.current > def.show - 0.02 && p < 0.985 && (!mobile || act)
      if (on !== el.classList.contains('is-on')) el.classList.toggle('is-on', on)
      if (act !== el.classList.contains('is-active')) el.classList.toggle('is-active', act)
      // side: away from the device centre, but never off-screen
      const box = el.lastElementChild as HTMLElement | null
      const bw = (box?.offsetWidth ?? 160) + (mobile ? 22 : 46) + 8
      let left = x < cx
      if (!left && x + bw > size.width) left = true
      if (left && x - bw < 0) left = false
      if (left !== el.classList.contains('part-label--left')) el.classList.toggle('part-label--left', left)
    }
  })

  return (
    <>
      <PerspectiveCamera makeDefault position={mobile ? [0, 0.6, Math.max(11, 2.3 / ((size.width / size.height) * Math.tan(THREE.MathUtils.degToRad(15))))] : [0, 0.5, 8.4]} fov={30} onUpdate={(cam) => cam.lookAt(mobile ? 0 : 0.35, mobile ? -0.4 : -0.05, 0)} />
      <StudioLights />
      <group ref={group} scale={S}>
        <Device explode={explode} internals anchorsRef={anchors} />
      </group>
      <ContactShadows position={[mobile ? 0 : 0.8, -1.7, 0]} opacity={0.22} scale={9} blur={3} far={4} resolution={512} color="#2b2f36" />
    </>
  )
}

// —————————————————————————— REMINDER ——————————————————————————
export function ReminderScene({ ringing }: { ringing: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null)
  const rings = useRef<THREE.Group>(null)
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#0b0c0e', transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }), [])
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.985, 1, 128), [])

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime
    const r = performance.now() < ringing.current
    if (group.current) {
      const shake = r ? Math.sin(t * 60) * 0.012 : 0
      group.current.rotation.y = damp(group.current.rotation.y, -0.32 + state.pointer.x * 0.25, 3, dt) + shake
      group.current.rotation.x = damp(group.current.rotation.x, -0.08 - state.pointer.y * 0.12, 3, dt)
      group.current.rotation.z = shake * 0.6
    }
    if (rings.current) {
      rings.current.children.forEach((m, i) => {
        const k = ((t * 0.7 + i / 3) % 1)
        m.scale.setScalar(1.3 + k * 2.4)
        ;((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = r ? (1 - k) * 0.22 : 0
      })
    }
  })

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 0.1, 5.6]} fov={30} />
      <StudioLights />
      <group ref={rings} position={[0, 0, -0.5]}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} geometry={ringGeo} material={ringMat.clone()} />
        ))}
      </group>
      <Float speed={1.2} rotationIntensity={0.05} floatIntensity={0.25}>
        <group ref={group} scale={S}>
          <Device />
        </group>
      </Float>
      <ContactShadows position={[0, -1.6, 0]} opacity={0.3} scale={7} blur={2.6} far={3} resolution={512} color="#2b2f36" />
    </>
  )
}

