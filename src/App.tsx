import { Component, useEffect, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { View } from '@react-three/drei'
import * as THREE from 'three'
import { initScroll, ScrollTrigger } from './lib/scroll'
import { startOled } from './three/oled'
import { startTelemetry } from './lib/telemetry'
import { Loader } from './components/Loader'
import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { Problem } from './components/Problem'
import { ModelSection } from './components/ModelSection'
import { Playground } from './components/Playground'
import { DeviceSection } from './components/DeviceSection'
import { Team } from './components/Team'
import { Air } from './components/Air'
import { Reminder } from './components/Reminder'
import { Compare } from './components/Compare'
import { Impact } from './components/Impact'
import { Contact } from './components/Contact'
import { Footer } from './components/Footer'
import { ConsentModal } from './components/ConsentModal'
import { useLang } from './i18n'

/**
 * If WebGL is unavailable or a 3D scene throws, drop the 3D views and keep the
 * rest of the page working instead of unmounting the whole app.
 */
class GlBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[RespAI] 3D view disabled:', err)
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

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

  // translated text changes section heights: re-measure the scroll animations
  const lang = useLang((s) => s.lang)
  useEffect(() => {
    const id = requestAnimationFrame(() => ScrollTrigger.refresh())
    return () => cancelAnimationFrame(id)
  }, [lang])

  return (
    <>
      <Loader />
      <Nav />
      <main id="main">
        <Hero />
        <Problem />
        <ModelSection />
        <Playground />
        <DeviceSection />
        <Air />
        <Reminder />
        <Compare />
        <Impact />
        <Team />
        <Contact />
      </main>
      <Footer />
      <ConsentModal />
      {root && (
        <GlBoundary>
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
        </GlBoundary>
      )}
    </>
  )
}
