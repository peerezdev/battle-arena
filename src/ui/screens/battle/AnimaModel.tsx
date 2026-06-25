import { Suspense, useEffect, useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { useGLTF, useAnimations, Bounds } from '@react-three/drei'
import * as THREE from 'three'

// jsdom (tests) has no WebGL — render nothing there so the result screen still mounts cleanly.
const HAS_WEBGL = (() => {
  try {
    return typeof document !== 'undefined' && !!document.createElement('canvas').getContext('webgl')
  } catch {
    return false
  }
})()

function AnimaScene() {
  const group = useRef<THREE.Group>(null)
  const { scene, animations } = useGLTF('/anima.glb')
  const { actions, names } = useAnimations(animations, group)

  useEffect(() => {
    const action = names[0] ? actions[names[0]] : null
    if (!action) return
    action.reset()
    action.setLoop(THREE.LoopOnce, 1)   // play exactly once…
    action.clampWhenFinished = true     // …and hold the final frame
    action.play()
    return () => { action.stop() }
  }, [actions, names])

  return (
    <group ref={group}>
      <primitive object={scene} />
    </group>
  )
}

/** Full-screen overlay that renders anima.glb once. Mount it on a screen that appears once
 *  (e.g. the result screen) so the clip plays a single time. pointer-events:none so it never
 *  blocks the UI under it. */
export function AnimaOverlay() {
  if (!HAS_WEBGL) return null
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, pointerEvents: 'none' }}>
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }} style={{ background: 'transparent' }}>
        <ambientLight intensity={1.4} />
        <directionalLight position={[4, 6, 4]} intensity={2} />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.2}>
            <AnimaScene />
          </Bounds>
        </Suspense>
      </Canvas>
    </div>
  )
}

useGLTF.preload('/anima.glb')
