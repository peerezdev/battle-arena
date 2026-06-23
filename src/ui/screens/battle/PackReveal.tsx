import { useCallback, useEffect, useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { RevealCard, rarityColor } from './RevealCard'
import { StagedCardReveal } from './StagedCardReveal'
import { CardBack } from './CardBack'
import { shortWallet } from './RoyaleReveal'
import { useAliases } from '../../useAliases'
import { useCountUp } from '../../useCountUp'
import { useMachines } from '../../useMachines'
import { useIsWide } from '../../useIsWide'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

// How long a round's revealed cards stay on screen before the next round replaces them.
const ROUND_HOLD_MS = 3000

export function PackReveal({ vm, reducedMotion, onComplete }: {
  vm: RevealVM; reducedMotion: boolean; onComplete?: () => void
}) {
  const wide = useIsWide('(min-width: 560px)')
  const cardW = wide ? 168 : 128
  const cardH = wide ? 236 : 188

  const aliases = useAliases(vm.players.map((p) => p.wallet))
  const machines = useMachines()
  const settled = vm.status === 'settled'
  const totalRounds = Math.max(vm.machines.length, 1)

  // Live, round-by-round: reveal round `round` once BOTH players' pulls for it have resolved;
  // while it animates the backend keeps pulling later rounds. The running total absorbs each
  // round as it lands; the winner/result waits for settle.
  const [round, setRound] = useState(0)
  const [doneCount, setDoneCount] = useState(0)
  const [complete, setComplete] = useState(false)

  const roundReady = vm.players.length > 0 && vm.players.every((p) => !!p.cards[round]?.nftAddress)
  const cardShown = doneCount >= vm.players.length
  const handleCardShown = useCallback(() => setDoneCount((c) => c + 1), [])

  useEffect(() => {
    if (!cardShown) return
    if (round < totalRounds - 1) {
      // hold the revealed round on screen before swapping in the next round's cards
      const t = setTimeout(() => { setRound((r) => r + 1); setDoneCount(0) }, reducedMotion ? 0 : ROUND_HOLD_MS)
      return () => clearTimeout(t)
    }
    // last round shown — reveal the result once the battle has settled
    if (settled && !complete) {
      const t = setTimeout(() => { setComplete(true); onComplete?.() }, reducedMotion ? 0 : 600)
      return () => clearTimeout(t)
    }
    // onComplete fires once, guarded by `complete`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardShown, round, totalRounds, settled, complete, reducedMotion])

  const shownRounds = cardShown ? round + 1 : round
  const machine = machines[vm.machines[round] ?? vm.machines[0] ?? '']

  return (
    <div style={{ padding: '22px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, width: '100%' }}>
      {/* round header: machine thumbnail + name + round indicator */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        {machine && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {machine.thumb && (
              <img src={machine.thumb} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', border: `1px solid ${COLORS.border}` }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.25 }}>
              <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 13, color: COLORS.text }}>{machine.name}</span>
              {totalRounds > 1 && (
                <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.12em', color: COLORS.muted }}>
                  RONDA {Math.min(round + 1, totalRounds)}/{totalRounds}
                </span>
              )}
            </div>
          </div>
        )}
        <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '0.14em', color: COLORS.muted }}>
          {complete ? `POT · ${formatUsd(vm.potValue)}` : 'ABRIENDO LOS PACKS…'}
        </div>
      </div>

      {/* VS row — horizontal, centered, never wraps */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: wide ? 18 : 10, width: '100%' }}>
        {vm.players.map((p, i) => (
          <PlayerColumn
            key={p.wallet}
            player={p}
            name={displayName(p, aliases[p.wallet])}
            round={round}
            roundReady={roundReady}
            shownRounds={shownRounds}
            isWinner={complete && p.wallet === vm.winner}
            reducedMotion={reducedMotion}
            onCardShown={handleCardShown}
            cardW={cardW}
            cardH={cardH}
            divider={i > 0}
          />
        ))}
      </div>
    </div>
  )
}

function displayName(p: RevealPlayerVM, alias: string | null | undefined): string {
  if (p.isMe) return alias ?? 'Tú'
  return alias ?? shortWallet(p.wallet)
}

function PlayerColumn({ player, name, round, roundReady, shownRounds, isWinner, reducedMotion, onCardShown, cardW, cardH, divider }: {
  player: RevealPlayerVM; name: string; round: number; roundReady: boolean; shownRounds: number
  isWinner: boolean; reducedMotion: boolean; onCardShown: () => void; cardW: number; cardH: number; divider: boolean
}) {
  const target = player.cards.slice(0, shownRounds).reduce((s, c) => s + (c.insuredValue ?? 0), 0)
  const counted = useCountUp(target, !reducedMotion)
  const currentCard = player.cards[round]

  return (
    <>
      {divider && (
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 15, color: COLORS.muted, alignSelf: 'center', flexShrink: 0 }}>VS</div>
      )}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: 12, flexShrink: 0,
        borderRadius: 16, border: `1px solid ${isWinner ? COLORS.green : COLORS.border}`,
        background: isWinner ? `linear-gradient(180deg,#14F1950e,${COLORS.panel})` : COLORS.panel,
        boxShadow: isWinner ? `0 0 22px ${COLORS.green}33` : 'none',
      }}>
        <div style={{
          fontFamily: FONTS.display, fontWeight: 800, fontSize: 13, maxWidth: cardW,
          color: player.isMe ? COLORS.green : COLORS.text,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {name}
        </div>

        <div style={{ width: cardW, height: cardH }}>
          {roundReady && currentCard ? (
            <StagedCardReveal
              key={`stage-${round}`}
              year={currentCard.year}
              grade={currentCard.grade}
              rarity={currentCard.rarity}
              reduced={reducedMotion}
              width={cardW}
              height={cardH}
              onCardShown={onCardShown}
            >
              <RevealCard reducedMotion={reducedMotion} card={currentCard} w={cardW} h={cardH} />
            </StagedCardReveal>
          ) : (
            <CardBack width={cardW} height={cardH} accent={rarityColor(null)} label="abriendo…" />
          )}
        </div>

        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: isWinner ? COLORS.green : COLORS.text }}>
          {formatUsd(counted)}
        </div>

        {isWinner && (
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 12, color: COLORS.green }}>🏆 Gana</div>
        )}
      </div>
    </>
  )
}
