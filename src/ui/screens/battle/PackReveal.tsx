import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { RevealCard, rarityColor } from './RevealCard'
import { EmoteDock } from '../../emotes/EmoteDock'
import { StagedCardReveal } from './StagedCardReveal'
import { CardBack } from './CardBack'
import { ccCardImageUrl } from '../../../onchain/gachaClient'
import { shortWallet } from './RoyaleReveal'
import { useAliases } from '../../useAliases'
import { useCountUp } from '../../useCountUp'
import { useMachines } from '../../useMachines'
import { useIsWide } from '../../useIsWide'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

// How long a round's revealed cards stay on screen before the next round replaces them.
const ROUND_HOLD_MS = 3000

const RAR: Record<string, { tint: string; border: string }> = {
  common:    { tint: '#3a4250', border: 'rgba(255,255,255,.18)' },
  uncommon:  { tint: '#2f6b4a', border: 'rgba(47,226,138,.5)' },
  rare:      { tint: '#2a5a8f', border: 'rgba(78,168,255,.55)' },
  epic:      { tint: '#5a3a9f', border: 'rgba(169,139,255,.6)' },
  legendary: { tint: '#8a6a1f', border: 'rgba(245,197,66,.65)' },
}
const rarOf = (r: string | null) => RAR[(r ?? '').toLowerCase()] ?? RAR.common
const TINTS = ['linear-gradient(135deg,#ff6bb5,#d4127a)', 'linear-gradient(135deg,#4ea8ff,#6a5bff)', 'linear-gradient(135deg,#f5c542,#e8732c)', 'linear-gradient(135deg,#00ffc4,#1aa0d8)', 'linear-gradient(135deg,#ff6e8a,#d23a5e)']
const tintFor = (w: string) => TINTS[Math.abs([...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % TINTS.length]

// Panel + card sizing scales with the player count so 2 players feel big and 10 stay legible.
function layoutFor(n: number, wide: boolean): { panelW: number; cardW: number; compact: boolean } {
  if (!wide) return n > 4 ? { panelW: 150, cardW: 100, compact: true } : { panelW: 230, cardW: 140, compact: false }
  if (n <= 2) return { panelW: 320, cardW: 168, compact: false }
  if (n <= 4) return { panelW: 248, cardW: 150, compact: false }
  if (n <= 6) return { panelW: 208, cardW: 128, compact: true }
  return { panelW: 178, cardW: 110, compact: true }
}

export function PackReveal({ vm, reducedMotion, onComplete, battleId }: {
  vm: RevealVM; reducedMotion: boolean; onComplete?: () => void; battleId?: string
}) {
  const wide = useIsWide('(min-width: 560px)')
  const { panelW, cardW, compact } = layoutFor(vm.players.length, wide)
  const cardH = Math.round(cardW * 1.4)

  const aliases = useAliases(vm.players.map((p) => p.wallet))
  const machines = useMachines()
  const settled = vm.status === 'settled'
  const totalRounds = Math.max(vm.machines.length, 1)

  const [round, setRound] = useState(0)
  const [doneCount, setDoneCount] = useState(0)
  const [complete, setComplete] = useState(false)

  const roundReady = vm.players.length > 0 && vm.players.every((p) => !!p.cards[round]?.nftAddress)
  const cardShown = doneCount >= vm.players.length
  const handleCardShown = useCallback(() => setDoneCount((c) => c + 1), [])

  useEffect(() => {
    if (!cardShown) return
    if (round < totalRounds - 1) {
      const t = setTimeout(() => { setRound((r) => r + 1); setDoneCount(0) }, reducedMotion ? 0 : ROUND_HOLD_MS)
      return () => clearTimeout(t)
    }
    if (settled && !complete) {
      const t = setTimeout(() => { setComplete(true); onComplete?.() }, reducedMotion ? 0 : ROUND_HOLD_MS)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardShown, round, totalRounds, settled, complete, reducedMotion])

  const shownRounds = cardShown ? round + 1 : round
  const machine = machines[vm.machines[round] ?? vm.machines[0] ?? '']
  const name = (p: RevealPlayerVM) => (p.isMe ? aliases[p.wallet] ?? 'You' : aliases[p.wallet] ?? shortWallet(p.wallet))

  // Mid-game leader = highest running total over the rounds shown so far; once complete, the winner.
  const totals = vm.players.map((p) => p.cards.slice(0, shownRounds).reduce((s, c) => s + (c.insuredValue ?? 0), 0))
  const leadIdx = totals.reduce((best, v, i) => (v > totals[best] ? i : best), 0)
  const leaderWallet = complete ? vm.winner : (shownRounds > 0 ? vm.players[leadIdx]?.wallet : null)

  // The pot builds up as cards are revealed (combined value of everything opened so far).
  const revealedPot = totals.reduce((s, v) => s + v, 0)
  const pot = useCountUp(revealedPot, !reducedMotion)

  // ── Mobile (<560px): compact match header + 2-up player grid. Desktop keeps the wide layout below. ──
  if (!wide) {
    const n = vm.players.length
    // 3 and 4 players are both 2 rows → same card size, sized so the grid still fits above the
    // emote dock (the panels are chrome-less, so the card gets most of the cell).
    const mCardW = n <= 2 ? 150 : 92
    const mCardH = Math.round(mCardW * 1.4)
    const pct = Math.round((Math.min(round + (cardShown ? 1 : 0), totalRounds) / totalRounds) * 100)
    return (
      <div style={{ padding: '10px 14px 0', display: 'flex', flexDirection: 'column', gap: 10, minHeight: '100%' }}>
        {/* compact match header */}
        <div style={{ flex: 'none', borderRadius: 15, background: 'linear-gradient(90deg,rgba(255,46,151,.10),rgba(0,255,196,.08))', border: '1px solid rgba(0,255,196,.25)', padding: '11px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
            <span style={{ flex: 'none', width: 30, height: 30, borderRadius: 9, overflow: 'hidden', background: 'linear-gradient(150deg,#2a2013,#171208)', border: '1px solid rgba(255,209,102,.35)', display: 'grid', placeItems: 'center' }}>
              {machine?.thumb && <img src={machine.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </span>
            <div style={{ minWidth: 0, lineHeight: 1.25 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>{machine?.name ?? 'PACK BATTLE'}</span>
                {!complete && <span style={{ flex: 'none', fontFamily: FONTS.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: '.08em', color: '#ff6ba4', border: '1px solid rgba(255,46,126,.45)', borderRadius: 999, padding: '2px 7px' }}>● LIVE</span>}
              </div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: COLORS.muted, marginTop: 1 }}>PACK BATTLE · {n} PLAYERS · CARD {Math.min(round + 1, totalRounds)}/{totalRounds}</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right', lineHeight: 1.2 }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: '.12em', color: COLORS.muted }}>TOTAL POT</div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 18, fontWeight: 700, color: COLORS.green }}>{formatUsd(pot)}</div>
            </div>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: GRADIENT, transition: 'width .5s ease' }} />
          </div>
          <div style={{ marginTop: 5, fontFamily: FONTS.mono, fontSize: 9, color: '#8b95a3' }}>
            {complete ? 'Battle complete' : 'Opening the packs…'}
          </div>
        </div>

        {/* player grid — 4:2×2 · 3:two + one centered · 2:side-by-side. Vertically centered when it
            fits; scrolls inside this box if it can't (so the emote dock never overlaps a row). */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', justifyContent: 'safe center', padding: '12px 0 6px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
            {vm.players.map((p, i) => (
              <MiniPanel
                key={p.wallet}
                player={p}
                name={name(p)}
                round={round}
                roundReady={roundReady}
                shownRounds={shownRounds}
                isHot={p.wallet === leaderWallet}
                isWinner={complete && p.wallet === vm.winner}
                reducedMotion={reducedMotion}
                onCardShown={handleCardShown}
                cardW={mCardW}
                cardH={mCardH}
                cellStyle={n === 3 && i === 2 ? { gridColumn: '1 / -1', justifySelf: 'center', width: 'calc(50% - 4px)' } : undefined}
              />
            ))}
          </div>
        </div>

        {vm.meWallet && <EmoteDock meWallet={vm.meWallet} battleId={battleId} />}
      </div>
    )
  }

  return (
    <div style={{ padding: '18px clamp(14px,2.4vw,28px) 0', display: 'flex', flexDirection: 'column', gap: 18, minHeight: '100%' }}>
      {/* ── status bar ── */}
      <section style={{
        position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap',
        padding: '16px 22px', borderRadius: 18,
        background: 'linear-gradient(135deg,rgba(255,46,151,.14),rgba(13,17,22,.55) 46%,rgba(0,255,196,.10))',
        border: `1px solid ${COLORS.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div style={{
            width: 50, height: 50, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(160deg,#2a1f47,#160f2b)', border: '1px solid rgba(255,46,151,.5)', boxShadow: '0 0 24px -8px rgba(255,46,151,.7)', overflow: 'hidden',
          }}>
            {machine?.thumb
              ? <img src={machine.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff6bb5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ fontFamily: FONTS.display, fontSize: 19, fontWeight: 700, letterSpacing: '-.01em' }}>{machine?.name ?? 'PACK BATTLE'}</span>
              {!complete && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 7, background: 'rgba(255,94,122,.12)', border: '1px solid rgba(255,94,122,.32)', fontFamily: FONTS.mono, fontSize: 11, color: '#ff8198' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5e7a', boxShadow: '0 0 6px #ff5e7a' }} />LIVE
                </span>
              )}
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
              Pack Battle · {vm.players.length} players
            </div>
          </div>
        </div>

        <div style={{ flex: '1 1 240px', minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.muted }}>
              {complete ? 'Battle complete' : <>Opening the packs<span style={{ color: COLORS.green, animation: 'ba-dots 1.2s infinite' }}>.</span><span style={{ color: COLORS.green, animation: 'ba-dots 1.2s .2s infinite' }}>.</span><span style={{ color: COLORS.green, animation: 'ba-dots 1.2s .4s infinite' }}>.</span></>}
            </span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>card <span style={{ color: COLORS.text, fontWeight: 700 }}>{Math.min(round + 1, totalRounds)}</span> / {totalRounds}</span>
          </div>
          <div style={{ height: 8, borderRadius: 8, background: '#ffffff10', overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
            <div style={{ height: '100%', width: `${Math.round((Math.min(round + (cardShown ? 1 : 0), totalRounds) / totalRounds) * 100)}%`, borderRadius: 8, background: GRADIENT, boxShadow: '0 0 16px -2px rgba(0,255,196,.7)' }} />
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: COLORS.muted }}>TOTAL POT</div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', background: GRADIENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(pot)}</div>
        </div>
      </section>

      {/* ── player panels — responsive grid, centered, scales with player count ── */}
      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'center', gap: wide ? 14 : 8 }}>
        {vm.players.map((p) => (
          <PlayerPanel
            key={p.wallet}
            player={p}
            name={name(p)}
            round={round}
            roundReady={roundReady}
            shownRounds={shownRounds}
            isLeader={p.wallet === leaderWallet}
            isWinner={complete && p.wallet === vm.winner}
            reducedMotion={reducedMotion}
            onCardShown={handleCardShown}
            panelW={panelW}
            cardW={cardW}
            cardH={cardH}
            compact={compact}
          />
        ))}
      </div>

      {/* emotes — fixed dock at the very bottom */}
      {vm.meWallet && <EmoteDock meWallet={vm.meWallet} battleId={battleId} />}
    </div>
  )
}

function PlayerPanel({ player, name, round, roundReady, shownRounds, isLeader, isWinner, reducedMotion, onCardShown, panelW, cardW, cardH, compact }: {
  player: RevealPlayerVM; name: string; round: number; roundReady: boolean; shownRounds: number
  isLeader: boolean; isWinner: boolean; reducedMotion: boolean; onCardShown: () => void
  panelW: number; cardW: number; cardH: number; compact: boolean
}) {
  const navigate = useNavigate()
  const shown = player.cards.slice(0, shownRounds)
  const target = shown.reduce((s, c) => s + (c.insuredValue ?? 0), 0)
  const counted = useCountUp(target, !reducedMotion)
  const currentCard = player.cards[round]
  const hot = isLeader || isWinner

  const chip = compact ? { w: 30, h: 42, f: 7 } : { w: 42, h: 58, f: 8.5 }

  return (
    <div data-player-anchor={player.wallet} style={{
      position: 'relative', flex: '0 0 auto', width: panelW,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: compact ? 11 : 16, padding: compact ? '16px 12px' : '22px 18px', borderRadius: compact ? 16 : 22,
      background: hot ? 'linear-gradient(180deg,rgba(0,255,196,.10),rgba(255,255,255,.012))' : 'linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012))',
      border: `1px solid ${hot ? 'rgba(0,255,196,.5)' : COLORS.border}`,
      boxShadow: hot ? '0 0 60px -16px rgba(0,255,196,.6)' : 'none',
    }}>
      {hot && (
        <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 5, padding: '4px 11px', borderRadius: 20, background: GRADIENT, color: '#06170f', fontFamily: FONTS.display, fontSize: compact ? 10 : 11.5, fontWeight: 700, boxShadow: '0 8px 24px -8px rgba(0,255,196,.8)', whiteSpace: 'nowrap' }}>
          👑 {isWinner ? 'WINNER' : 'WINNING'}
        </div>
      )}

      {/* identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, maxWidth: '100%' }}>
        <span style={{ flex: 'none', width: compact ? 30 : 38, height: compact ? 30 : 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: compact ? 12 : 14, fontWeight: 700, color: '#06170f', background: tintFor(player.wallet), border: `2px solid ${player.isMe ? 'rgba(0,255,196,.7)' : 'rgba(255,255,255,.12)'}` }}>{name.slice(0, 1).toUpperCase()}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span onClick={() => navigate(`/profile/${player.wallet}`)} title="View profile"
              style={{ fontSize: compact ? 13 : 15.5, fontWeight: 700, color: player.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: panelW - (compact ? 64 : 90), cursor: 'pointer' }}>{name}</span>
            {player.isMe && <span style={{ flex: 'none', padding: '2px 6px', borderRadius: 5, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontSize: 9, fontWeight: 700, color: COLORS.green }}>YOU</span>}
          </div>
          <div style={{ fontFamily: FONTS.display, fontSize: compact ? 14 : 16, fontWeight: 800, letterSpacing: '-.01em', color: hot ? COLORS.green : COLORS.text, marginTop: 2 }}>{formatUsd(counted)}</div>
        </div>
      </div>

      {/* card stage */}
      <div style={{ width: cardW, height: cardH }}>
        {roundReady && currentCard ? (
          <StagedCardReveal key={`stage-${round}`} year={currentCard.year} grade={currentCard.grade} rarity={currentCard.rarity}
            reduced={reducedMotion} width={cardW} height={cardH}
            preloadSrc={currentCard.nftAddress ? ccCardImageUrl(currentCard.nftAddress) : undefined}
            onCardShown={onCardShown}>
            <RevealCard reducedMotion={reducedMotion} card={currentCard} w={cardW} h={cardH} />
          </StagedCardReveal>
        ) : (
          <CardBack width={cardW} height={cardH} accent={rarityColor(null)} label="opening…" />
        )}
      </div>

      {/* revealed strip */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
        {shown.map((c, idx) => {
          const r = rarOf(c.rarity)
          return (
            <div key={idx} style={{ width: chip.w, height: chip.h, borderRadius: 7, background: `linear-gradient(160deg,${r.tint},rgba(8,10,14,.5))`, border: `1px solid ${r.border}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.14)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 3 }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: chip.f, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.7)' }}>{formatUsd(c.insuredValue ?? 0)}</span>
            </div>
          )
        })}
        {shown.length < player.cards.length && (
          <div style={{ width: chip.w, height: chip.h, borderRadius: 7, border: '1px dashed rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c6675', fontSize: 16 }}>+</div>
        )}
      </div>
    </div>
  )
}

// Mobile-only compact player card: identity + small staged reveal + pull chips, for the 2-up grid.
function MiniPanel({ player, name, round, roundReady, shownRounds, isHot, isWinner, reducedMotion, onCardShown, cardW, cardH, cellStyle }: {
  player: RevealPlayerVM; name: string; round: number; roundReady: boolean; shownRounds: number
  isHot: boolean; isWinner: boolean; reducedMotion: boolean; onCardShown: () => void
  cardW: number; cardH: number; cellStyle?: React.CSSProperties
}) {
  const navigate = useNavigate()
  const shown = player.cards.slice(0, shownRounds)
  const target = shown.reduce((s, c) => s + (c.insuredValue ?? 0), 0)
  const counted = useCountUp(target, !reducedMotion)
  const currentCard = player.cards[round]

  return (
    <div data-player-anchor={player.wallet} style={{
      position: 'relative', borderRadius: 15, background: 'transparent',
      border: `1.5px solid ${isHot ? 'rgba(60,232,168,.55)' : COLORS.border}`,
      padding: 5, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 0,
      animation: isHot && !reducedMotion ? 'ba-cardglow 2.4s infinite' : undefined,
      ...cellStyle,
    }}>
      {isHot && (
        <span style={{ position: 'absolute', top: -9, left: '50%', transform: 'translateX(-50%)', fontFamily: FONTS.mono, fontSize: 8, fontWeight: 700, letterSpacing: '.1em', color: '#06221a', background: '#3ce8a8', borderRadius: 999, padding: '3px 9px', whiteSpace: 'nowrap' }}>
          {isWinner ? '👑 WINNER' : '⚡ WINNING'}
        </span>
      )}

      {/* identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
        <span style={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', background: tintFor(player.wallet), display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 11, color: '#06170f', border: `2px solid ${player.isMe ? 'rgba(60,232,168,.7)' : 'rgba(255,255,255,.12)'}` }}>{name.slice(0, 1).toUpperCase()}</span>
        <div style={{ minWidth: 0, lineHeight: 1.2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span onClick={() => navigate(`/profile/${player.wallet}`)} title="View profile" style={{ fontSize: 11.5, fontWeight: 700, color: player.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80, cursor: 'pointer' }}>{name}</span>
            {player.isMe && <span style={{ flex: 'none', fontFamily: FONTS.mono, fontSize: 7.5, fontWeight: 700, color: COLORS.green, border: '1px solid rgba(60,232,168,.4)', borderRadius: 5, padding: '1px 4px' }}>YOU</span>}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, fontWeight: 700, color: isHot ? COLORS.green : '#cdd4dd', marginTop: 1 }}>{formatUsd(counted)}</div>
        </div>
      </div>

      {/* card stage */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: cardW, height: cardH }}>
          {roundReady && currentCard ? (
            <StagedCardReveal key={`stage-${round}`} year={currentCard.year} grade={currentCard.grade} rarity={currentCard.rarity}
              reduced={reducedMotion} width={cardW} height={cardH}
            preloadSrc={currentCard.nftAddress ? ccCardImageUrl(currentCard.nftAddress) : undefined}
            onCardShown={onCardShown}>
              <RevealCard reducedMotion={reducedMotion} card={currentCard} w={cardW} h={cardH} />
            </StagedCardReveal>
          ) : (
            <CardBack width={cardW} height={cardH} accent={rarityColor(null)} label="opening…" />
          )}
        </div>
      </div>

      {/* revealed chips */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
        {shown.map((c, idx) => {
          const r = rarOf(c.rarity)
          return (
            <span key={idx} style={{ flex: 'none', width: 24, height: 31, borderRadius: 6, background: `linear-gradient(160deg,${r.tint},rgba(8,10,14,.5))`, border: `1px solid ${r.border}`, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 2, fontFamily: FONTS.mono, fontSize: 7, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.7)' }}>{formatUsd(c.insuredValue ?? 0)}</span>
          )
        })}
        {shown.length < player.cards.length && (
          <span style={{ flex: 'none', width: 24, height: 31, borderRadius: 6, border: '1px dashed rgba(255,255,255,.16)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a525e', fontSize: 10 }}>+</span>
        )}
      </div>
    </div>
  )
}
