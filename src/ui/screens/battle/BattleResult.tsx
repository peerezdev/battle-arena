import { COLORS, FONTS, formatUsd } from '../../theme'
import { shortWallet } from './RoyaleReveal'
import type { RevealVM } from './battleReveal'

export function BattleResult({ vm, onExit }: { vm: RevealVM; onExit: () => void }) {
  const iWon = vm.winner != null && vm.winner === vm.meWallet
  return (
    <div style={{ padding: '24px 16px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: iWon ? COLORS.green : COLORS.text }}>
        {iWon ? '🏆 ¡Ganaste!' : 'Batalla terminada'}
      </div>
      {!iWon && vm.winner && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>
          Ganador: {shortWallet(vm.winner)}
        </div>
      )}
      <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>Bote</div>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 28, color: COLORS.green }}>
        {formatUsd(vm.potValue)}
      </div>
      <button onClick={onExit} style={{
        marginTop: 12, background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
        borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
      }}>
        Volver
      </button>
    </div>
  )
}
