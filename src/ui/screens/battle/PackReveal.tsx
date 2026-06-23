import { Fragment } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { RevealCard } from './RevealCard'
import { shortWallet } from './RoyaleReveal'
import { useAliases } from '../../useAliases'
import { useCountUp } from '../../useCountUp'
import type { RevealVM, RevealPlayerVM, RevealCardVM } from './battleReveal'

export function PackReveal({ vm, reducedMotion }: { vm: RevealVM; reducedMotion: boolean }) {
  const revealed = vm.status === 'settled'
  const aliases = useAliases(vm.players.map((p) => p.wallet))

  return (
    <div style={{ padding: '22px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '0.14em', color: COLORS.muted }}>
        {revealed ? `POT · ${formatUsd(vm.potValue)}` : 'ABRIENDO LOS PACKS…'}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
        {vm.players.map((p, i) => (
          <Fragment key={p.wallet}>
            {i > 0 && (
              <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.muted }}>VS</div>
            )}
            <PlayerColumn
              player={p}
              name={displayName(p, aliases[p.wallet])}
              revealed={revealed}
              isWinner={revealed && p.wallet === vm.winner}
              reducedMotion={reducedMotion}
            />
          </Fragment>
        ))}
      </div>
    </div>
  )
}

function displayName(p: RevealPlayerVM, alias: string | null | undefined): string {
  if (p.isMe) return alias ?? 'Tú'
  return alias ?? shortWallet(p.wallet)
}

function PlayerColumn({ player, name, revealed, isWinner, reducedMotion }: {
  player: RevealPlayerVM; name: string; revealed: boolean; isWinner: boolean; reducedMotion: boolean
}) {
  const counted = useCountUp(player.total, revealed && !reducedMotion)
  const cards: (RevealCardVM | null)[] = player.cards.length ? player.cards : [null]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: 16, minWidth: 204,
      borderRadius: 16, border: `1px solid ${isWinner ? COLORS.green : COLORS.border}`,
      background: isWinner ? `linear-gradient(180deg,#14F1950e,${COLORS.panel})` : COLORS.panel,
    }}>
      <div style={{
        fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, maxWidth: 200,
        color: player.isMe ? COLORS.green : COLORS.text,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {name}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
        {cards.map((card, idx) => (
          <RevealCard
            key={idx}
            size="lg"
            reducedMotion={reducedMotion}
            // Stay face-down until the battle is settled (losers don't see NFTs early; all flip at once).
            card={card && revealed ? card : faceDown(player, card)}
          />
        ))}
      </div>

      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: isWinner ? COLORS.green : COLORS.text }}>
        {revealed ? formatUsd(counted) : '—'}
      </div>

      {isWinner && (
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 12, color: COLORS.green }}>🏆 Gana</div>
      )}
    </div>
  )
}

function faceDown(player: RevealPlayerVM, card: RevealCardVM | null): RevealCardVM {
  return {
    wallet: player.wallet, isMe: player.isMe, nftAddress: null,
    rarity: card?.rarity ?? null, insuredValue: card?.insuredValue ?? null, autoSold: card?.autoSold ?? false,
  }
}
