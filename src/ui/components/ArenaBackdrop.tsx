// src/ui/components/ArenaBackdrop.tsx
// Animated battle background: layered radial gradients + subtle
// drifting particle layer (canvas). Very low contrast — never
// competes with foreground content. Respects reduced-motion.
// Cap 40 particles; DPR ≤ 2; canvas unmounts when reducedMotion.

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  reducedMotion: boolean
  /** Optional player accent for tinting the radial gradients. */
  accentA?: string
  accentB?: string
}

interface Particle {
  x: number; y: number
  vx: number; vy: number
  r: number; alpha: number
  color: string
}

const PARTICLE_COLORS = ['#00ffc4', '#ff2e97', '#5ad1ff', '#e7ecf5']

export function ArenaBackdrop({ children, reducedMotion, accentA = '#00ffc4', accentB = '#ff2e97' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (reducedMotion) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)

    const COUNT = 40
    const particles: Particle[] = []

    function initParticles() {
      if (!canvas) return
      particles.length = 0
      for (let i = 0; i < COUNT; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.4 * dpr,
          vy: (Math.random() - 0.5) * 0.4 * dpr,
          r: (Math.random() * 1.5 + 0.5) * dpr,
          alpha: Math.random() * 0.25 + 0.05,
          color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
        })
      }
    }

    function resize() {
      if (!canvas) return
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      initParticles()
    }
    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    function frame() {
      if (!canvas || !ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        // Wrap at edges
        if (p.x < 0) p.x += canvas.width
        if (p.x > canvas.width) p.x -= canvas.width
        if (p.y < 0) p.y += canvas.height
        if (p.y > canvas.height) p.y -= canvas.height

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = p.color
        ctx.globalAlpha = p.alpha
        ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [reducedMotion])

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: '100%', overflow: 'hidden' }}>
      {/* Layer 1: dark base */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: '#0a0e1a',
          zIndex: 0,
        }}
      />
      {/* Layer 2: two radial gradients (player A top-left, player B bottom-right) */}
      <div
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: `
            radial-gradient(ellipse 60% 40% at 15% 20%, ${accentA}0d 0%, transparent 70%),
            radial-gradient(ellipse 60% 40% at 85% 80%, ${accentB}0d 0%, transparent 70%)
          `,
          zIndex: 1,
        }}
      />
      {/* Layer 3: slow-drifting particle canvas (skipped when reduced-motion) */}
      {!reducedMotion && (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            zIndex: 2,
          }}
        />
      )}
      {/* Layer 4: content */}
      <div style={{ position: 'relative', zIndex: 3 }}>
        {children}
      </div>
    </div>
  )
}
