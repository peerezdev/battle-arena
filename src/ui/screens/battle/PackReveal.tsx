import { COLORS, FONTS } from '../../theme'
import { RevealCard } from './RevealCard'
import { shortWallet } from './RoyaleReveal'
import type { RevealVM } from './battleReveal'

export function PackReveal({ vm, reducedMotion }: { vm: RevealVM; reducedMotion: boolean }) {
  const cards = vm.rounds[0]?.cards ?? []
  const settled = vm.status === 'settled'
  return (
    <div style={{ padding: '16px', display: 'flex', gap: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
      {cards.map((card) => {
        const isWinner = settled && card.wallet === vm.winner
        return (
          <div key={card.wallet} style={{ textAlign: 'center' }}>
            <RevealCard card={card} reducedMotion={reducedMotion} />
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: card.isMe ? COLORS.green : COLORS.muted, marginTop: 5 }}>
              {card.isMe ? 'tú' : shortWallet(card.wallet)}
            </div>
            {isWinner && (
              <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 11, color: COLORS.green, marginTop: 2 }}>
                🏆 Ganador
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
