import { useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { View } from '@react-three/drei'
import * as THREE from 'three'
import { initScroll, ScrollTrigger } from './lib/scroll'
import { startOled } from './three/oled'
import { startTelemetry } from './lib/telemetry'
import { Loader } from './components/Loader'
import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { Marquee } from './components/Marquee'
import { Problem } from './components/Problem'
import { ModelSection } from './components/ModelSection'
import { Playground } from './components/Playground'
import { DeviceSection } from './components/DeviceSection'
import { Gallery } from './components/Gallery'
import { Field } from './components/Field'
import { Air } from './components/Air'
import { Reminder } from './components/Reminder'
import { Compare } from './components/Compare'
import { Impact } from './components/Impact'
import { Contact } from './components/Contact'
import { Footer } from './components/Footer'
import { ConsentModal } from './components/ConsentModal'
import { FloatingAI } from './components/FloatingAI'

export default function App() {
  const [root, setRoot] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setRoot(document.getElementById('root'))
    initScroll()
    startOled()
    startTelemetry()
    const onLoad = () => ScrollTrigger.refresh()
    window.addEventListener('load', onLoad)
    return () => window.removeEventListener('load', onLoad)
  }, [])

  return (
    <>
      <Loader />
      <Nav />
      <main id="main">
        <Hero />
        <Marquee />
        <Problem />
        <ModelSection />
        <Playground />
        <DeviceSection />
        <Gallery />
        <Field />
        <Air />
        <Reminder />
        <Compare />
        <Impact />
        <Contact />
      </main>
      <Footer />
      <FloatingAI />
      <ConsentModal />
      {root && (
        <Canvas
          className="gl"
          eventSource={root}
          eventPrefix="client"
          dpr={[1, 1.75]}
          gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping
            gl.toneMappingExposure = 1.05
          }}
        >
          <View.Port />
        </Canvas>
      )}
    </>
  )
}
