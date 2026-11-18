import { useMemo, type Ref } from 'react'
import * as THREE from 'three'
import { Environment, Lightformer } from '@react-three/drei'
import { canvasTexture } from './textures'

/** Soft, pre-blurred shadow blob: a dark core under the object fading into a wide penumbra. */
function shadowTexture() {
  return canvasTexture(
    'soft-shadow',
    256,
    (ctx, s) => {
      // alpha map: white = shadow
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, s, s)
      const blob = (alpha: number, w: number, h: number, blur: number) => {
        ctx.save()
        ctx.shadowColor = `rgba(255,255,255,${alpha})`
        ctx.shadowBlur = blur
        ctx.shadowOffsetX = s * 2
        ctx.translate(-s * 2, 0)
        ctx.beginPath()
        ctx.ellipse(s / 2, s / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
        ctx.fillStyle = '#fff'
        ctx.fill()
        ctx.restore()
      }
      blob(0.5, s * 0.5, s * 0.36, s * 0.2) // penumbra
      blob(0.45, s * 0.44, s * 0.2, s * 0.1) // contact core
    },
    { wrap: false },
  )
}

/**
 * A flat shadow on an invisible floor. Cheaper and steadier than a live depth pass,
 * and it stays put under the device inside the shared-canvas Views.
 */
export function SoftShadow({
  position,
  size,
  opacity = 0.5,
  meshRef,
}: {
  position: [number, number, number]
  /** [width, depth] in scene units */
  size: [number, number]
  opacity?: number
  meshRef?: Ref<THREE.Mesh>
}) {
  const mat = useMemo(() => new THREE.MeshBasicMaterial({ color: '#1d2026', alphaMap: shadowTexture(), transparent: true, opacity, depthWrite: false, toneMapped: false }), [opacity])
  return (
    <mesh ref={meshRef} position={position} rotation-x={-Math.PI / 2} scale={[size[0], size[1], 1]} material={mat} renderOrder={-1}>
      <planeGeometry args={[1, 1]} />
    </mesh>
  )
}

/**
 * Product-photo lighting made only of procedural light-formers (no HDR downloads):
 * a large soft box overhead, a tall strip on the left for the long edge highlights,
 * a weaker strip on the right, a low front fill, inside a mid-grey studio so metal
 * reflects something other than black.
 */
export function StudioLights({ intensity = 1, cool = false }: { intensity?: number; cool?: boolean }) {
  return (
    <>
      <hemisphereLight args={['#ffffff', '#8e9197', 0.3 * intensity]} />
      {/* key from top-left-front: gives the embossed letters and the sensor ring their relief */}
      <directionalLight position={[-4, 6, 6]} intensity={1.45 * intensity} color="#fff8ef" />
      <directionalLight position={[6, 1.5, 3]} intensity={0.32 * intensity} color={cool ? '#bfe6ff' : '#e4ebff'} />
      <directionalLight position={[1, 4, -6]} intensity={0.55 * intensity} color="#ffffff" />
      <Environment resolution={256} frames={1}>
        <mesh scale={40}>
          <sphereGeometry args={[1, 32, 16]} />
          <meshBasicMaterial color="#2c2f34" side={THREE.BackSide} toneMapped={false} />
        </mesh>
        <Lightformer form="rect" intensity={2.2} position={[0, 7, 2]} rotation-x={Math.PI / 2} scale={[14, 9, 1]} />
        <Lightformer form="rect" intensity={2.8} position={[-7, 1.5, 3]} rotation-y={Math.PI / 2.4} scale={[2.6, 11, 1]} />
        <Lightformer form="rect" intensity={1.3} position={[7, 1, 2]} rotation-y={-Math.PI / 2.4} scale={[3, 10, 1]} color={cool ? '#cdefff' : '#ffffff'} />
        <Lightformer form="rect" intensity={0.7} position={[0, -0.5, 9]} rotation-y={Math.PI} scale={[12, 3, 1]} />
        <Lightformer form="rect" intensity={0.45} position={[0, -6, 1]} rotation-x={-Math.PI / 2} scale={[16, 16, 1]} color="#e6e3dd" />
      </Environment>
    </>
  )
}
