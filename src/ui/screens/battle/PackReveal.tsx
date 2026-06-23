import { Fragment, useCallback, useEffect, useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { RevealCard } from './RevealCard'
import { StagedCardReveal } from './StagedCardReveal'
import { shortWallet } from './RoyaleReveal'
import { useAliases } from '../../useAliases'
import { useCountUp } from '../../useCountUp'
import type { RevealVM, RevealPlayerVM, RevealCardVM } from './battleReveal'

export function PackReveal({ vm, reducedMotion }: { vm: RevealVM; reducedMotion: boolean }) {
  const revealed = vm.status === 'settled'
  const aliases = useAliases(vm.players.map((p) => p.wallet))
  const maxRounds = vm.players.reduce((m, p) => Math.max(m, p.cards.length), 0)

  // Round-by-round orchestration: both players reveal round `round` at once; when both
  // cards have landed we hold briefly (counter ticks up) then advance to the next round.
  const [round, setRound] = useState(reducedMotion ? Math.max(0, maxRounds - 1) : 0)
  const [doneCount, setDoneCount] = useState(0)

  const expectedThisRound = vm.players.filter((p) => p.cards[round]).length
  const cardShown = expectedThisRound === 0 ? true : doneCount >= expectedThisRound
  const handleCardShown = useCallback(() => setDoneCount((c) => c + 1), [])

  useEffect(() => {
    if (!revealed || !cardShown) return
    if (round >= maxRounds - 1) return
    const t = setTimeout(() => {
      setRound((r) => r + 1)
      setDoneCount(0)
    }, reducedMotion ? 0 : 1200)
    return () => clearTimeout(t)
  }, [revealed, cardShown, round, maxRounds, reducedMotion])

  const finished = revealed && round >= maxRounds - 1 && cardShown
  // How many rounds' cards are currently on screen (drives the running counter target).
  const shownRounds = revealed ? (cardShown ? round + 1 : round) : 0

  return (
    <div style={{ padding: '22px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '0.14em', color: COLORS.muted }}>
        {revealed ? `POT · ${formatUsd(vm.potValue)}` : 'ABRIENDO LOS PACKS…'}
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 16, flexWrap: 'wrap' }}>
        {vm.players.map((p, i) => (
          <Fragment key={p.wallet}>
            {i > 0 && (
              <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.muted, alignSelf: 'center' }}>VS</div>
            )}
            <PlayerColumn
              player={p}
              name={displayName(p, aliases[p.wallet])}
              revealed={revealed}
              round={round}
              shownRounds={shownRounds}
              isWinner={finished && p.wallet === vm.winner}
              reducedMotion={reducedMotion}
              onCardShown={handleCardShown}
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

function PlayerColumn({ player, name, revealed, round, shownRounds, isWinner, reducedMotion, onCardShown }: {
  player: RevealPlayerVM; name: string; revealed: boolean; round: number; shownRounds: number
  isWinner: boolean; reducedMotion: boolean; onCardShown: () => void
}) {
  // Running total = sum of insuredValue of the cards already shown.
  const target = player.cards.slice(0, shownRounds).reduce((s, c) => s + (c.insuredValue ?? 0), 0)
  const counted = useCountUp(target, revealed && !reducedMotion)
  const currentCard = player.cards[round]

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

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', minHeight: 252 }}>
        {!revealed ? (
          // pre-settle: a single face-down tile (no NFTs shown before the winner is decided)
          <RevealCard size="lg" reducedMotion={reducedMotion} card={faceDown(player, player.cards[0] ?? null)} />
        ) : (
          <>
            {/* already-revealed prior rounds */}
            {player.cards.slice(0, round).map((card, idx) => (
              <RevealCard key={`r${idx}`} size="lg" reducedMotion={reducedMotion} card={card} />
            ))}
            {/* current round — staged gacha reveal (year → grade → rarity → card) */}
            {currentCard && (
              <StagedCardReveal
                key={`stage-${round}`}
                year={currentCard.year}
                grade={currentCard.grade}
                rarity={currentCard.rarity}
                reduced={reducedMotion}
                onCardShown={onCardShown}
              >
                <RevealCard size="lg" reducedMotion={reducedMotion} card={currentCard} />
              </StagedCardReveal>
            )}
          </>
        )}
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
    grade: card?.grade ?? null, year: card?.year ?? null,
  }
}
