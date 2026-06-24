import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
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

const RAR: Record<string, { tint: string; border: string }> = {
  common:    { tint: '#3a4250', border: 'rgba(255,255,255,.18)' },
  uncommon:  { tint: '#2f6b4a', border: 'rgba(47,226,138,.5)' },
  rare:      { tint: '#2a5a8f', border: 'rgba(78,168,255,.55)' },
  epic:      { tint: '#5a3a9f', border: 'rgba(169,139,255,.6)' },
  legendary: { tint: '#8a6a1f', border: 'rgba(245,197,66,.65)' },
}
const rarOf = (r: string | null) => RAR[(r ?? '').toLowerCase()] ?? RAR.common
const TINTS = ['linear-gradient(135deg,#a98bff,#6a44e0)', 'linear-gradient(135deg,#4ea8ff,#6a5bff)', 'linear-gradient(135deg,#f5c542,#e8732c)', 'linear-gradient(135deg,#2fe28a,#1aa0d8)', 'linear-gradient(135deg,#ff6e8a,#d23a5e)']
const tintFor = (w: string) => TINTS[Math.abs([...w].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % TINTS.length]

export function PackReveal({ vm, reducedMotion, onComplete, onExit }: {
  vm: RevealVM; reducedMotion: boolean; onComplete?: () => void; onExit?: () => void
}) {
  const wide = useIsWide('(min-width: 560px)')
  const cardW = wide ? 168 : 128
  const cardH = wide ? 236 : 188

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

  function skip() {
    setRound(totalRounds - 1)
    setDoneCount(vm.players.length)
    if (settled) { setComplete(true); onComplete?.() }
  }

  return (
    <div style={{ padding: '18px clamp(14px,2.4vw,28px) 24px', display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
      {/* ── status bar ── */}
      <section style={{
        position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap',
        padding: '16px 22px', borderRadius: 18,
        background: 'linear-gradient(135deg,rgba(139,92,246,.14),rgba(13,17,22,.55) 46%,rgba(47,226,138,.10))',
        border: `1px solid ${COLORS.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div style={{
            width: 50, height: 50, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(160deg,#2a1f47,#160f2b)', border: '1px solid rgba(139,92,246,.5)', boxShadow: '0 0 24px -8px rgba(139,92,246,.7)', overflow: 'hidden',
          }}>
            {machine?.thumb
              ? <img src={machine.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a98bff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></svg>}
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
            <div style={{ height: '100%', width: `${Math.round((Math.min(round + (cardShown ? 1 : 0), totalRounds) / totalRounds) * 100)}%`, borderRadius: 8, background: GRADIENT, boxShadow: '0 0 16px -2px rgba(47,226,138,.7)' }} />
          </div>
        </div>

        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: COLORS.muted }}>TOTAL POT</div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', background: GRADIENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(vm.potValue)}</div>
        </div>
      </section>

      {/* ── player panels ── */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', justifyContent: 'center', gap: wide ? 14 : 8, flexWrap: 'wrap' }}>
        {vm.players.map((p, i) => (
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
            cardW={cardW}
            cardH={cardH}
            divider={i > 0}
          />
        ))}
      </div>

      {/* ── action bar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', paddingTop: 16, borderTop: `1px solid ${COLORS.border}` }}>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 9 }}>
          {onExit && (
            <button onClick={onExit} style={{ padding: '11px 20px', borderRadius: 12, border: '1px solid rgba(255,94,122,.3)', background: 'rgba(255,94,122,.08)', color: '#ff8198', cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14, fontWeight: 600 }}>
              Leave battle
            </button>
          )}
          {!complete && (
            <button onClick={skip} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 22px', borderRadius: 12, border: 0, cursor: 'pointer', fontFamily: FONTS.display, fontSize: 14, fontWeight: 700, color: '#06170f', background: GRADIENT, boxShadow: '0 0 22px -6px rgba(47,226,138,.7)' }}>
              ▶ Skip reveal
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function PlayerPanel({ player, name, round, roundReady, shownRounds, isLeader, isWinner, reducedMotion, onCardShown, cardW, cardH, divider }: {
  player: RevealPlayerVM; name: string; round: number; roundReady: boolean; shownRounds: number
  isLeader: boolean; isWinner: boolean; reducedMotion: boolean; onCardShown: () => void; cardW: number; cardH: number; divider: boolean
}) {
  const navigate = useNavigate()
  const shown = player.cards.slice(0, shownRounds)
  const target = shown.reduce((s, c) => s + (c.insuredValue ?? 0), 0)
  const counted = useCountUp(target, !reducedMotion)
  const delta = shown.length ? shown[shown.length - 1].insuredValue ?? 0 : 0
  const currentCard = player.cards[round]
  const hot = isLeader || isWinner

  return (
    <>
      {divider && (
        <div style={{ alignSelf: 'center', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '0 6px' }}>
          <div style={{ width: 1, height: 48, background: 'linear-gradient(180deg,transparent,rgba(255,255,255,.16),transparent)' }} />
          <div style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONTS.mono, fontSize: 13, fontWeight: 700, color: '#fff', background: '#0b0f14', borderRadius: '50%', border: '2px solid transparent', backgroundImage: `linear-gradient(#0b0f14,#0b0f14),${GRADIENT}`, backgroundOrigin: 'border-box', backgroundClip: 'padding-box,border-box', boxShadow: '0 0 26px -6px rgba(139,92,246,.7)' }}>VS</div>
          <div style={{ width: 1, height: 48, background: 'linear-gradient(180deg,transparent,rgba(255,255,255,.16),transparent)' }} />
        </div>
      )}
      <div style={{
        position: 'relative', flex: '1 1 280px', maxWidth: 360, minWidth: 240,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '22px 18px', borderRadius: 22,
        background: hot ? 'linear-gradient(180deg,rgba(47,226,138,.10),rgba(255,255,255,.012))' : 'linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.012))',
        border: `1px solid ${hot ? 'rgba(47,226,138,.5)' : COLORS.border}`,
        boxShadow: hot ? '0 0 60px -16px rgba(47,226,138,.6)' : 'none',
      }}>
        {hot && (
          <div style={{ position: 'absolute', top: -14, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: GRADIENT, color: '#06170f', fontFamily: FONTS.display, fontSize: 11.5, fontWeight: 700, boxShadow: '0 8px 24px -8px rgba(47,226,138,.8)', whiteSpace: 'nowrap' }}>
            👑 {isWinner ? 'WINNER' : 'WINNING'}
          </div>
        )}

        {/* identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ width: 38, height: 38, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#06170f', background: tintFor(player.wallet), border: `2px solid ${player.isMe ? 'rgba(47,226,138,.7)' : 'rgba(255,255,255,.12)'}` }}>{name.slice(0, 1).toUpperCase()}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span onClick={() => navigate(`/profile/${player.wallet}`)} title="View profile"
                style={{ fontSize: 15.5, fontWeight: 700, color: player.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 130, cursor: 'pointer' }}>{name}</span>
              {player.isMe && <span style={{ flex: 'none', padding: '2px 7px', borderRadius: 6, background: 'rgba(47,226,138,.14)', border: '1px solid rgba(47,226,138,.4)', fontSize: 9.5, fontWeight: 700, color: COLORS.green }}>YOU</span>}
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: '#6c7682', marginTop: 2 }}>{shown.length} cards opened</div>
          </div>
        </div>

        {/* card stage */}
        <div style={{ width: cardW, height: cardH }}>
          {roundReady && currentCard ? (
            <StagedCardReveal key={`stage-${round}`} year={currentCard.year} grade={currentCard.grade} rarity={currentCard.rarity}
              reduced={reducedMotion} width={cardW} height={cardH} onCardShown={onCardShown}>
              <RevealCard reducedMotion={reducedMotion} card={currentCard} w={cardW} h={cardH} />
            </StagedCardReveal>
          ) : (
            <CardBack width={cardW} height={cardH} accent={rarityColor(null)} label="opening…" />
          )}
        </div>

        {/* running total + delta */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.muted }}>TOTAL VALUE</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontFamily: FONTS.display, fontSize: 34, fontWeight: 700, letterSpacing: '-.02em', color: hot ? COLORS.green : COLORS.text }}>{formatUsd(counted)}</span>
            {delta > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.green }}>↑ {formatUsd(delta)}</span>}
          </div>
        </div>

        {/* revealed strip */}
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'center' }}>
          {shown.map((c, idx) => {
            const r = rarOf(c.rarity)
            return (
              <div key={idx} style={{ width: 42, height: 58, borderRadius: 8, background: `linear-gradient(160deg,${r.tint},rgba(8,10,14,.5))`, border: `1px solid ${r.border}`, boxShadow: 'inset 0 1px 0 rgba(255,255,255,.14)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 }}>
                <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.7)' }}>{formatUsd(c.insuredValue ?? 0)}</span>
              </div>
            )
          })}
          {shown.length < player.cards.length && (
            <div style={{ width: 42, height: 58, borderRadius: 8, border: '1px dashed rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c6675', fontSize: 18 }}>+</div>
          )}
        </div>
      </div>
    </>
  )
}
