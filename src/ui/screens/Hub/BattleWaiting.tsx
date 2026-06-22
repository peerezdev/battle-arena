import { COLORS, FONTS } from '../../theme'
import { useBattle } from '../../../onchain/useBattle'

export function BattleWaiting({ battleId, onClose }: { battleId: string; onClose: () => void }) {
  const { battle, error } = useBattle(battleId)
  const inLobby = !battle || battle.status === 'lobby'
  const joined = battle ? battle.players.length : 0
  const max = battle ? battle.max_players : 0

  return (
    <div
      role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`,
          borderRadius: 14, padding: 26, maxWidth: 380, width: '100%', textAlign: 'center' }}
      >
        {inLobby ? (
          <>
            <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 17, color: COLORS.text }}>
              Esperando jugadores
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 26, color: COLORS.green, margin: '14px 0' }}>
              {joined}/{max}
            </div>
          </>
        ) : (
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.text, lineHeight: 1.5 }}>
            La batalla empezó 🎴
            <div style={{ fontFamily: FONTS.body, fontWeight: 400, fontSize: 12.5, color: COLORS.muted, marginTop: 8 }}>
              Vista completa próximamente (#4b-3).
            </div>
          </div>
        )}
        {error && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted, marginTop: 8 }}>
            reintentando…
          </div>
        )}
        <button onClick={onClose}
          style={{ marginTop: 18, background: '#0c1019', color: COLORS.text,
            border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '10px 20px',
            fontWeight: 700, cursor: 'pointer' }}>
          Volver
        </button>
      </div>
    </div>
  )
}
