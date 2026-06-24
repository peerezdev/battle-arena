import { useEffect, useRef } from 'react'

const DEFAULT_COLORS = ['#2fe28a', '#8b5cf6', '#e7ecf5', '#5ad1ff']

interface Props {
  /** Confetti colors (defaults to the neon palette). */
  colors?: string[]
  /** Skip entirely under reduced motion. */
  active: boolean
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  rot: number
  vrot: number
}

/** Lightweight canvas confetti burst — no asset images. Auto-stops after ~2.4s. */
export function Confetti({ colors = DEFAULT_COLORS, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = (canvas.width = window.innerWidth * dpr)
    const H = (canvas.height = window.innerHeight * dpr)
    canvas.style.width = '100%'
    canvas.style.height = '100%'

    const COUNT = 90
    const particles: Particle[] = Array.from({ length: COUNT }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.3,
      y: H * 0.32,
      vx: (Math.random() - 0.5) * 14 * dpr,
      vy: (Math.random() * -10 - 6) * dpr,
      size: (Math.random() * 6 + 4) * dpr,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 0.3,
    }))

    const gravity = 0.35 * dpr
    const start = performance.now()
    let raf = 0

    function frame(now: number) {
      const elapsed = now - start
      ctx!.clearRect(0, 0, W, H)
      for (const p of particles) {
        p.vy += gravity
        p.x += p.vx
        p.y += p.vy
        p.rot += p.vrot
        p.vx *= 0.99
        ctx!.save()
        ctx!.translate(p.x, p.y)
        ctx!.rotate(p.rot)
        ctx!.globalAlpha = Math.max(0, 1 - elapsed / 2400)
        ctx!.fillStyle = p.color
        ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6)
        ctx!.restore()
      }
      if (elapsed < 2400) raf = requestAnimationFrame(frame)
      else ctx!.clearRect(0, 0, W, H)
    }
    raf = requestAnimationFrame(frame)

    return () => cancelAnimationFrame(raf)
  }, [active, colors])

  if (!active) return null

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 40,
      }}
    />
  )
}
