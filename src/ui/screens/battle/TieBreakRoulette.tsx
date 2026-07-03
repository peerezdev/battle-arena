import { useEffect, useMemo, useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { tintFor } from './royaleShared'

// A tie for last place is broken by a random pick (provably-fair on-chain, seat tie-break in the
// demo). This overlay makes that visible: it spins through the tied players and lands on the one
// that was already chosen to be eliminated — so the outcome is faithful, just animated.
export function TieBreakRoulette({ tied, eliminated, nameOf, reducedMotion }: {
  tied: string[]; eliminated: string | null; nameOf: (w: string) => string; reducedMotion: boolean
}) {
  // Build a spin sequence over the tied wallets that ENDS on `eliminated`.
  const seq = useMemo<string[]>(() => {
    const base = tied.length ? tied : (eliminated ? [eliminated] : [])
    if (base.length === 0) return []
    const endAt = Math.max(0, base.indexOf(eliminated ?? base[base.length - 1]))
    const s: string[] = []
    const CYCLES = 4
    for (let c = 0; c < CYCLES; c++) for (const w of base) s.push(w)
    for (let i = 0; i <= endAt; i++) s.push(base[i])   // decelerate onto the loser
    return s
  }, [tied, eliminated])

  const [i, setI] = useState(reducedMotion ? Math.max(0, seq.length - 1) : 0)
  const landed = seq.length === 0 || i >= seq.length - 1

  useEffect(() => {
    if (reducedMotion || landed) return
    const progress = i / Math.max(1, seq.length - 1)
    const delay = Math.round(55 + progress * progress * 300)   // 55ms → ~355ms, ease-out
    const t = setTimeout(() => setI((n) => n + 1), delay)
    return () => clearTimeout(t)
  }, [i, seq.length, landed, reducedMotion])

  const current = seq[Math.min(i, Math.max(0, seq.length - 1))] ?? eliminated ?? ''

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 24, background: 'rgba(6,8,11,.72)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.28em', color: COLORS.muted, marginBottom: 8 }}>EMPATE EN EL ÚLTIMO PUESTO</div>
        <div style={{ fontFamily: FONTS.display, fontSize: 'clamp(18px,2.4vw,24px)', fontWeight: 700, color: COLORS.text }}>
          {landed ? 'Eliminado al azar' : 'Eligiendo un jugador al azar…'}
        </div>
      </div>

      <div style={{
        minWidth: 'min(340px,86%)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14,
        padding: '20px 26px', borderRadius: 16,
        border: `2px solid ${landed ? 'rgba(255,94,122,.7)' : COLORS.border}`,
        background: landed ? 'rgba(255,94,122,.12)' : 'rgba(255,255,255,.04)',
        boxShadow: landed ? '0 0 50px -14px rgba(255,94,122,.85)' : 'none',
        transition: 'border-color .2s, box-shadow .2s, background .2s',
      }}>
        <span style={{ flex: 'none', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 800, color: '#06170f', background: tintFor(current) }}>
          {(nameOf(current) || '?').slice(0, 1).toUpperCase()}
        </span>
        <span style={{ fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800, letterSpacing: '-.01em', color: landed ? COLORS.red : COLORS.text }}>
          {nameOf(current)}
        </span>
      </div>

      <div style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.16em', color: landed ? '#ff8198' : COLORS.muted, minHeight: 16 }}>
        {landed ? '✕ ELIMINADO' : `${tied.length} empatados`}
      </div>
    </div>
  )
}
