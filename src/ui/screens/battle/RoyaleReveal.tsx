import { COLORS, FONTS, formatUsd } from '../../theme'
import { RevealCard } from './RevealCard'
import type { RevealVM } from './battleReveal'

export function shortWallet(w: string): string {
  return w.length > 9 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

export function RoyaleReveal({ vm, reducedMotion }: { vm: RevealVM; reducedMotion: boolean }) {
  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {vm.rounds.map((round) => (
        <div key={round.roundNumber}>
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, color: COLORS.text, marginBottom: 10 }}>
            Round {round.roundNumber}
            {round.eliminatedWallet && (
              <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red, marginLeft: 10 }}>
                {shortWallet(round.eliminatedWallet)} eliminated
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {round.cards.map((card) => {
              const isElim = card.wallet === round.eliminatedWallet
              const player = vm.players.find((p) => p.wallet === card.wallet)
              return (
                <div key={card.wallet} style={{ opacity: isElim ? 0.55 : 1, textAlign: 'center' }}>
                  <RevealCard card={card} reducedMotion={reducedMotion} />
                  <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: card.isMe ? COLORS.green : COLORS.muted, marginTop: 5 }}>
                    {card.isMe ? 'you' : shortWallet(card.wallet)}
                  </div>
                  {player && (
                    <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.muted }}>
                      {formatUsd(player.accumulatedValue)}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
