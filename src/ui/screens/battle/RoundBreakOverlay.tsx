import { COLORS, FONTS } from '../../theme'
import { LiveLeaderboard } from './LiveLeaderboard'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

export function RoundBreakOverlay({ vm, name, upcomingRound, countdown }: {
  vm: RevealVM; name: (p: RevealPlayerVM) => string; upcomingRound: number; countdown: number
}) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: 24, background: 'rgba(6,8,11,.55)' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.28em', color: COLORS.muted, marginBottom: 10 }}>SIGUIENTE RONDA</div>
        <div style={{ fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 700, letterSpacing: '-.02em', color: COLORS.text }}>
          La ronda {upcomingRound} empezará en
        </div>
        <div key={countdown} className="ca-count-pop" style={{ fontFamily: FONTS.display, fontSize: 'clamp(56px,9vw,96px)', fontWeight: 800, lineHeight: 1, marginTop: 6, background: 'linear-gradient(135deg,#ff2e97,#00ffc4)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
          {Math.max(0, countdown)}
        </div>
      </div>
      <div style={{ width: 'min(420px,92%)' }}>
        <LiveLeaderboard vm={vm} name={name} title="CLASIFICACIÓN ACTUAL" />
      </div>
    </div>
  )
}
