import { Outlet, useNavigate } from 'react-router-dom'
import { COLORS, GRADIENT, FONTS } from '../theme'
import { MuteButton } from '../components/MuteButton'

export function GameLayout() {
  const navigate = useNavigate()
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: COLORS.bg, color: COLORS.text, overflow: 'hidden' }}>
      <header style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 18px', borderBottom: `1px solid ${COLORS.border}`, background: '#0c1019' }}>
        <button onClick={() => navigate('/app')}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600 }}>
          ← Lobby
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONTS.display, fontWeight: 800, fontSize: 15, letterSpacing: '-.01em' }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: GRADIENT, boxShadow: '0 0 10px #9945FF88' }} /> BattleArena
        </div>
        <div style={{ flex: 1 }} />
        {/* Balance — EJEMPLO, no es un saldo real */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#11161f', border: `1px solid ${COLORS.border}`, borderRadius: 11, padding: '7px 13px' }}>
          <span style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '.1em' }}>BALANCE</span>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14 }}>$128.40</span>
        </div>
        <MuteButton />
      </header>
      <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  )
}
