import { Environment, Lightformer } from '@react-three/drei'

/** Studio lighting made only of procedural light-formers (no HDR downloads). */
export function StudioLights({ intensity = 1, cool = false }: { intensity?: number; cool?: boolean }) {
  return (
    <>
      <ambientLight intensity={0.35 * intensity} />
      <directionalLight position={[3, 6, 5]} intensity={1.4 * intensity} color="#ffffff" />
      <directionalLight position={[-6, 2, -3]} intensity={0.5 * intensity} color={cool ? '#9fd8ff' : '#dfe6ff'} />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.6} position={[0, 5, 3]} rotation-x={Math.PI / 2.4} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[-6, 1, 2]} rotation-y={Math.PI / 2.5} scale={[3, 8, 1]} />
        <Lightformer form="rect" intensity={1.8} position={[6, 0.5, 1]} rotation-y={-Math.PI / 2.5} scale={[3, 8, 1]} color={cool ? '#bfefff' : '#ffffff'} />
        <Lightformer form="ring" intensity={0.8} position={[0, -1, -6]} scale={6} color="#cfd6e4" />
        <Lightformer form="rect" intensity={0.6} position={[0, -5, 1]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} color="#e8e9eb" />
      </Environment>
    </>
  )
}
