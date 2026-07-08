import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { startRematch } from '../../battle/startRematch'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { VerifyPanel } from './VerifyPanel'
import { RevealCard, rarityColor } from './RevealCard'
import { ccCardImageUrl } from '../../../onchain/gachaClient'
import { WinningsBuyback } from './WinningsBuyback'
import { StagedCardReveal } from './StagedCardReveal'
import { CardBack } from './CardBack'
import { useAliases } from '../../useAliases'
import { EmoteDock } from '../../emotes/EmoteDock'
import { shortWallet, tintFor, medalColor } from './royaleShared'
import { useIsWide } from '../../useIsWide'
import { useRoyaleReveal, totalRounds } from './useRoyaleReveal'
import { RoundBreakOverlay } from './RoundBreakOverlay'
import { TieBreakRoulette } from './TieBreakRoulette'
import type { RevealVM, RevealPlayerVM, RevealCardVM } from './battleReveal'

const TITLE = (
  <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 700, letterSpacing: '-.02em' }}>
    Battle <span style={{ color: '#ff6bb5' }}>Royale</span>
  </h1>
)
const screenStyle = { padding: '18px clamp(14px,2.4vw,28px) 28px', display: 'flex', flexDirection: 'column' as const, gap: 18 }

// ⏱️ Cuánto se queda la carta central mostrándose antes de pasar al siguiente jugador (ms).
// Cambia este número para ajustar el tiempo del reveal (3000 = 3 segundos).
const CARD_DWELL_MS = 1500

function useRanked(vm: RevealVM) {
  // Finish ranking: still-alive on top by value; eliminated below by when they went out.
  return [...vm.players]
    .sort((a, b) => ((b.eliminatedRound ?? 1e9) - (a.eliminatedRound ?? 1e9)) || (b.total - a.total))
    .map((p, i) => ({ p, rank: i + 1 }))
}
const nameOf = (aliases: Record<string, string | null>) => (p: RevealPlayerVM) =>
  p.isMe ? aliases[p.wallet] ?? 'You' : aliases[p.wallet] ?? shortWallet(p.wallet)

// Round-by-round cinematic reveal — shown while the royale is running (and until the final
// round finishes animating, at which point onComplete lets BattleFlow show RoyaleResult).
export function RoyaleReveal({ vm, reducedMotion = false, battleId, onComplete }: {
  vm: RevealVM; reducedMotion?: boolean; battleId?: string; onComplete?: () => void
}) {
  const aliases = useAliases(vm.players.map((p) => p.wallet))
  const name = nameOf(aliases)
  const rv = useRoyaleReveal(vm, { reducedMotion, onComplete })
  const proj = rv.projection
  const alive = proj.players.filter((p) => p.eliminatedRound == null).length
  const entry = vm.players.length ? vm.potValue / vm.players.length : 0
  const blurred = (rv.phase === 'roundBreak' || rv.phase === 'tieBreak') && !reducedMotion

  // The one card revealing right now — shown big + centered in the spotlight while the grid
  // below tracks standings. openingWallet = its pull hasn't resolved yet; stagingWallet = its
  // year→grade→rarity→card ceremony is playing.
  const activeWallet = rv.stagingWallet ?? rv.openingWallet
  const activePlayer = activeWallet ? proj.players.find((p) => p.wallet === activeWallet) ?? null : null
  const activeName = activePlayer ? name(activePlayer) : null
  const isOpening = !!rv.openingWallet && !rv.stagingWallet
  const nameByWallet = (w: string) => {
    const p = vm.players.find((x) => x.wallet === w)
    return p ? name(p) : shortWallet(w)
  }

  const wide = useIsWide('(min-width: 860px)')

  return (
    <div style={{ ...screenStyle, position: 'relative', minHeight: '100%' }}>
      <div style={{ filter: blurred ? 'blur(6px)' : 'none', transition: 'filter .3s ease' }}>
        {/* vertical battle bar (left) · stage (center) · standings (right) */}
        <div style={{ display: 'grid', gridTemplateColumns: wide ? '224px minmax(0,1fr) 300px' : '1fr', gap: 16, alignItems: 'stretch', marginBottom: 16 }}>
          <BattleBar proj={proj} totalPlayers={vm.players.length} alive={alive} entry={entry}
            revealRound={rv.revealRound} rounds={totalRounds(vm)} settled={vm.status === 'settled'} />
          <Stage activePlayer={activePlayer} activeName={activeName} isOpening={isOpening}
            stagingCard={rv.stagingCard} revealKey={rv.stagingKey} reducedMotion={reducedMotion}
            onCardShown={rv.onCardShown} />
          <Standings vm={proj} name={name} activeWallet={activeWallet} />
        </div>
        {/* 1a · fila de chips de jugador (uno por jugador, ancla de emotes) */}
        <ChipsRow players={proj.players} name={name} activeWallet={activeWallet} justEliminated={rv.justEliminated} reducedMotion={reducedMotion} />
      </div>
      {rv.phase === 'roundBreak' && !reducedMotion && <RoundBreakOverlay vm={proj} name={name} upcomingRound={rv.upcomingRound} countdown={rv.countdown} />}
      {rv.phase === 'tieBreak' && !reducedMotion && <TieBreakRoulette tied={rv.tiedWallets} eliminated={rv.tieEliminated} nameOf={nameByWallet} reducedMotion={reducedMotion} />}
      {vm.meWallet && <EmoteDock meWallet={vm.meWallet} battleId={battleId} />}
    </div>
  )
}

// Separate result screen — shown once every round has finished (battle settled + reveal done).
export function RoyaleResult({ vm, battleId, onExit }: { vm: RevealVM; battleId?: string; onExit?: () => void }) {
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const aliases = useAliases(vm.players.map((p) => p.wallet))
  const [verifyOpen, setVerifyOpen] = useState(false)
  const name = nameOf(aliases)
  const ranked = useRanked(vm)

  return (
    <div style={screenStyle}>
      {TITLE}
      <ResultView
        vm={vm} name={name} ranked={ranked}
        onRematch={() => startRematch({ battleId, mode: 'royale', token: identityToken, navigate })} onExit={onExit} onVerify={() => setVerifyOpen(true)}
      />
      {verifyOpen && battleId && <VerifyPanel battleId={battleId} onClose={() => setVerifyOpen(false)} />}
    </div>
  )
}

// ─────────────────────────── BATTLE BAR (vertical, left of the stage) ───────────────────────────
function BattleBar({ proj, totalPlayers, alive, entry, revealRound, rounds, settled }: {
  proj: RevealVM; totalPlayers: number; alive: number; entry: number; revealRound: number; rounds: number; settled: boolean
}) {
  const progress = totalPlayers > 1 ? (totalPlayers - alive) / (totalPlayers - 1) : 0
  const rule = <span style={{ height: 1, background: COLORS.border }} />
  return (
    <section style={{
      display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 18px', borderRadius: 16,
      background: 'linear-gradient(160deg,rgba(255,46,151,.16),rgba(13,17,22,.55) 55%,rgba(0,255,196,.10))',
      border: `1px solid ${COLORS.border}`,
    }}>
      {/* mark + LIVE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 'none', width: 42, height: 42, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg,#2a1f47,#160f2b)', border: '1px solid rgba(255,46,151,.5)', boxShadow: '0 0 24px -8px rgba(255,46,151,.7)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ff6bb5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></svg>
        </div>
        {!settled && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 7, background: 'rgba(255,94,122,.12)', border: '1px solid rgba(255,94,122,.32)', fontFamily: FONTS.mono, fontSize: 11, color: '#ff8198' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5e7a', boxShadow: '0 0 6px #ff5e7a' }} />LIVE
          </span>
        )}
      </div>

      {/* title + sub */}
      <div>
        <div style={{ fontFamily: FONTS.display, fontSize: 18, fontWeight: 700, letterSpacing: '-.01em' }}>Battle Royale</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted, marginTop: 3 }}>entry {formatUsd(entry)} · last one standing</div>
      </div>

      {rule}

      {/* round + progress */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: COLORS.muted }}>{settled ? 'Battle complete' : 'Revealing'}</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>round <span style={{ color: COLORS.text, fontWeight: 700 }}>{Math.min(revealRound, rounds)}</span> / {rounds}</span>
        </div>
        <div style={{ height: 8, borderRadius: 8, background: '#ffffff10', overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
          <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, borderRadius: 8, background: GRADIENT, boxShadow: '0 0 16px -2px rgba(0,255,196,.7)', transition: 'width .4s ease' }} />
        </div>
      </div>

      {rule}

      {/* alive + pot */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: COLORS.muted }}>ALIVE</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em' }}><span style={{ color: COLORS.green }}>{alive}</span><span style={{ color: '#5c6675', fontSize: 16 }}> / {totalPlayers}</span></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: COLORS.muted }}>POT</div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', background: GRADIENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(proj.potValue)}</div>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────── STAGE ───────────────────────────
// Centre stage: the opener sits above the single card, which plays its full staged ceremony
// (year → grade → rarity → card).
function Stage({ activePlayer, activeName, isOpening, stagingCard, revealKey, reducedMotion, onCardShown }: {
  activePlayer: RevealPlayerVM | null; activeName: string | null; isOpening: boolean
  stagingCard: RevealCardVM | null; revealKey: string | null; reducedMotion: boolean; onCardShown: () => void
}) {
  const W = 200, H = 280
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
      borderRadius: 16, minHeight: H + 88, padding: 'clamp(16px,2vw,24px)',
      background: 'radial-gradient(60% 90% at 50% 40%,rgba(0,255,196,.08),transparent 70%)', border: `1px solid ${COLORS.border}`,
    }}>
      {/* opener — above the card */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36 }}>
        <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: '50%', fontSize: 13, fontWeight: 700, color: '#06170f', background: activePlayer ? tintFor(activePlayer.wallet) : '#2a3340', border: '2px solid #06080b' }}>
          {activeName ? activeName.slice(0, 1).toUpperCase() : ''}
        </span>
        <span style={{ fontSize: 16, fontWeight: 700, color: activePlayer?.isMe ? COLORS.green : COLORS.text }}>{activeName ?? '—'}</span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.12em', color: COLORS.green, padding: '3px 8px', borderRadius: 7, background: 'rgba(0,255,196,.1)', border: '1px solid rgba(0,255,196,.3)' }}>
          {activeName ? (isOpening ? 'OPENING NOW' : 'REVEALING') : 'WAITING'}
        </span>
      </div>

      {/* card ceremony */}
      {stagingCard
        ? <StagedCardReveal key={revealKey ?? stagingCard.nftAddress} year={stagingCard.year} grade={stagingCard.grade}
            rarity={stagingCard.rarity} reduced={reducedMotion} width={W} height={H} dwellMs={CARD_DWELL_MS} onCardShown={onCardShown}>
            <RevealCard reducedMotion={reducedMotion} card={stagingCard} w={W} h={H} />
          </StagedCardReveal>
        : <CardBack width={W} height={H} accent={COLORS.muted} label={activeName ? 'opening…' : ''} />}
    </div>
  )
}

// ─────────────────────────── STANDINGS ───────────────────────────
// Live ranking by revealed value — one row per player (replaces the old grid+leaderboard pair).
function Standings({ vm, name, activeWallet }: {
  vm: RevealVM; name: (p: RevealPlayerVM) => string; activeWallet: string | null
}) {
  // Alive on top by value; eliminated sink to the bottom (most-recent first) so a living
  // player never ranks below an out one. #1 = leader; the last alive is at risk this round.
  const sorted = [...vm.players].sort((a, b) =>
    ((b.eliminatedRound ?? 1e9) - (a.eliminatedRound ?? 1e9)) || (b.total - a.total) || a.wallet.localeCompare(b.wallet))
  const aliveCount = vm.players.filter((p) => p.eliminatedRound == null).length
  const atRiskWallet = aliveCount > 1 ? [...sorted].reverse().find((p) => p.eliminatedRound == null)?.wallet ?? null : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, borderRadius: 16, background: '#0c0f15', border: `1px solid ${COLORS.border}`, padding: '16px 18px', overflow: 'hidden' }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.1em', color: '#7a8492', marginBottom: 10 }}>STANDINGS</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, overflowY: 'auto', minHeight: 0 }}>
        {sorted.map((p, i) => {
          const cur = p.wallet === activeWallet
          const elim = p.eliminatedRound != null
          const atRisk = p.wallet === atRiskWallet
          const leader = i === 0
          return (
            <div key={p.wallet} style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '6px 9px', borderRadius: 8,
              border: `1px solid ${leader ? 'rgba(245,197,66,.4)' : atRisk ? 'rgba(255,94,122,.45)' : 'transparent'}`,
              background: atRisk ? 'rgba(255,94,122,.07)' : leader ? 'rgba(245,197,66,.09)' : cur ? 'rgba(0,255,196,.07)' : 'transparent',
              animation: atRisk ? 'ba-atrisk 1.1s ease-in-out infinite' : undefined,
            }}>
              <span style={{ width: 14, fontFamily: FONTS.mono, fontSize: 10.5, fontWeight: 700, color: leader ? '#f5c542' : atRisk ? '#ff5e7a' : '#7a8492' }}>{i + 1}</span>
              <span style={{ flex: 'none', width: 18, height: 18, borderRadius: '50%', background: tintFor(p.wallet), opacity: elim ? 0.5 : 1 }} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: cur ? COLORS.green : elim ? '#5d6674' : '#cdd4dd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: elim ? 'line-through' : 'none' }}>{name(p)}</span>
              {p.isMe && <span style={{ flex: 'none', padding: '1px 5px', borderRadius: 5, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontFamily: FONTS.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: '.06em', color: COLORS.green }}>YOU</span>}
              <span style={{ fontFamily: FONTS.mono, fontSize: 11, fontWeight: 700, color: p.total > 0 ? COLORS.text : '#7a8492' }}>{formatUsd(p.total)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The card box inside a player chip: shows the image of the player's latest pull once it's
// resolved (falling back to its name if the image fails), else the opening/waiting state.
function ChipCardBox({ latest, cur, hasPull }: { latest: RevealCardVM | null; cur: boolean; hasPull: boolean }) {
  const [imgError, setImgError] = useState(false)
  const showImg = hasPull && !!latest?.nftAddress && !imgError
  const rc = rarityColor(latest?.rarity ?? null)   // rarity tint for the card box (border/bg/glow)
  return (
    <div style={{
      height: 56, borderRadius: 7, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 6,
      background: hasPull ? `${rc}14` : 'linear-gradient(150deg,#141a24,#0b0e14)',
      border: `1px solid ${cur ? 'rgba(0,255,196,.45)' : hasPull ? rc : COLORS.border}`,
      boxShadow: hasPull ? `0 0 14px -8px ${rc}` : 'none',
    }}>
      {showImg
        ? <img src={ccCardImageUrl(latest!.nftAddress!)} alt="" onError={() => setImgError(true)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        : <span style={{ fontSize: 9, lineHeight: 1.25, padding: '0 5px', color: cur ? COLORS.green : hasPull ? '#cdd4dd' : '#4a525e', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {cur ? 'opening…' : hasPull ? (latest?.name ?? 'card') : 'waiting'}
          </span>}
    </div>
  )
}

// ─────────────────────────── CHIPS ROW ───────────────────────────
// One compact chip per player along the bottom — carries data-player-anchor so thrown emotes
// still land on a player. Shows their latest pull, "opening…" for the active opener, dimmed if out.
function ChipsRow({ players, name, activeWallet, justEliminated, reducedMotion }: {
  players: RevealPlayerVM[]; name: (p: RevealPlayerVM) => string; activeWallet: string | null
  justEliminated: string | null; reducedMotion: boolean
}) {
  return (
    <div className="hidescroll" style={{ display: 'flex', gap: 8, overflowX: 'auto' }}>
      {players.map((p) => {
        const cur = p.wallet === activeWallet
        const out = p.eliminatedRound != null
        const beat = !reducedMotion && p.wallet === justEliminated
        const latest = p.cards[p.cards.length - 1] ?? null
        const hasPull = !!latest && !cur
        return (
          <div key={p.wallet} data-player-anchor={p.wallet} style={{
            flex: '1 0 96px', minWidth: 0, padding: '9px 8px', borderRadius: 12, textAlign: 'center', lineHeight: 1.3,
            opacity: out ? 0.55 : 1, transition: 'box-shadow .3s, border-color .3s',
            background: cur ? 'rgba(0,255,196,.08)' : 'rgba(255,255,255,.025)',
            border: `1px solid ${beat ? 'rgba(255,94,122,.6)' : cur ? 'rgba(0,255,196,.45)' : out ? 'rgba(255,46,126,.25)' : COLORS.border}`,
            boxShadow: beat ? '0 0 30px -12px rgba(255,94,122,.8)' : cur ? '0 0 24px -12px rgba(0,255,196,.7)' : 'none',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
              <span style={{ flex: 'none', width: 16, height: 16, borderRadius: '50%', background: tintFor(p.wallet) }} />
              <span style={{ fontSize: 10.5, fontWeight: 600, color: p.isMe ? COLORS.green : '#cdd4dd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(p)}</span>
            </div>
            <ChipCardBox latest={latest} cur={cur} hasPull={hasPull} />
            <div style={{ fontFamily: FONTS.mono, fontSize: 11.5, fontWeight: 700, color: cur ? COLORS.green : hasPull ? COLORS.green : '#4a525e' }}>
              {cur ? '···' : hasPull ? formatUsd(latest!.insuredValue ?? 0) : '—'}
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, color: '#ff6ba4', minHeight: 12 }}>
              {out ? `OUT · R${p.eliminatedRound}` : ''}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────── RESULT VIEW ───────────────────────────
function ResultView({ vm, name, ranked, onRematch, onExit, onVerify }: {
  vm: RevealVM; name: (p: RevealPlayerVM) => string; ranked: { p: RevealPlayerVM; rank: number }[]
  onRematch: () => void; onExit?: () => void; onVerify: () => void
}) {
  const champ = ranked[0]?.p
  const iAmPlayer = vm.players.some((p) => p.isMe)
  const iWon = !!champ?.isMe
  const me = ranked.find((r) => r.p.isMe)
  const myRank = me?.rank
  const myElimRound = me?.p.eliminatedRound
  const allLoot = vm.players.flatMap((p) => p.cards)
  const lootTotal = allLoot.reduce((s, c) => s + (c.insuredValue ?? 0), 0)

  return (
    <div>
      <section style={{
        position: 'relative', overflow: 'hidden', borderRadius: 22, padding: 'clamp(26px,3vw,40px)', marginBottom: 22, textAlign: 'center',
        background: iWon ? 'linear-gradient(135deg,rgba(245,197,66,.14),rgba(13,17,22,.6) 50%,rgba(0,255,196,.12))' : 'linear-gradient(135deg,rgba(255,94,122,.10),rgba(13,17,22,.6) 50%,rgba(255,46,151,.08))',
        border: `1px solid ${iWon ? 'rgba(245,197,66,.4)' : 'rgba(255,94,122,.32)'}`,
      }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, letterSpacing: '.3em', color: iWon ? '#f5c542' : '#ff8198', marginBottom: 12 }}>
          {iWon ? 'LAST ONE STANDING' : iAmPlayer ? `ELIMINATED${myElimRound != null ? ` · ROUND ${myElimRound}` : ''}` : 'BATTLE OVER'}
        </div>
        <h2 style={{ margin: '0 0 12px', fontFamily: FONTS.display, fontSize: 'clamp(34px,5.5vw,60px)', fontWeight: 700, lineHeight: 1, letterSpacing: '-.03em', color: iWon ? '#f5c542' : COLORS.text }}>
          {iWon ? 'VICTORY!' : iAmPlayer ? 'You lost' : 'Battle over'}
        </h2>
        <p style={{ margin: 0, fontSize: 16, color: '#9aa4b2' }}>
          {iWon ? `You outlasted everyone and take the full ${formatUsd(vm.potValue)} pot.`
            : iAmPlayer ? `You finished #${myRank ?? '—'} · ${champ ? name(champ) : 'the winner'} took the ${formatUsd(vm.potValue)} pot.`
            : `${champ ? name(champ) : 'The winner'} took the ${formatUsd(vm.potValue)} pot.`}
        </p>
      </section>

      {champ && (
        <section style={{
          position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 'clamp(22px,3vw,44px)', flexWrap: 'wrap', justifyContent: 'center',
          borderRadius: 22, padding: 'clamp(22px,2.6vw,34px)', marginBottom: 22,
          background: 'linear-gradient(135deg,rgba(245,197,66,.10),rgba(13,17,22,.6) 50%,rgba(245,197,66,.05))', border: '1px solid rgba(245,197,66,.4)',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, minWidth: 200 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 14px', borderRadius: 20, background: 'linear-gradient(135deg,#f5c542,#e8964e)', color: '#1a1206', fontSize: 12, fontWeight: 700, letterSpacing: '.04em', boxShadow: '0 8px 26px -8px rgba(245,197,66,.8)' }}>👑 CHAMPION</span>
            <span style={{ width: 88, height: 88, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700, color: '#06170f', background: tintFor(champ.wallet), border: '3px solid rgba(245,197,66,.7)', boxShadow: '0 0 40px -8px rgba(245,197,66,.8)' }}>{name(champ).slice(0, 1).toUpperCase()}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: champ.isMe ? COLORS.green : COLORS.text }}>{name(champ)}</span>
              {champ.isMe && <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontSize: 10, fontWeight: 700, color: COLORS.green }}>YOU</span>}
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.muted }}>TAKES THE POT</div>
              <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-.02em', background: 'linear-gradient(120deg,#f5c542,#5cffd8)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(lootTotal)}</div>
            </div>
          </div>
          {!iWon && (
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.muted, marginBottom: 12 }}>CHAMPION LOOT · {formatUsd(lootTotal)}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {allLoot.map((c, i) => (
                  <RevealCard key={i} card={c} reducedMotion w={120} h={200} />
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Champion (me) can keep or sell each won card back for USDC */}
      {iWon && allLoot.length > 0 && (
        <div style={{ marginBottom: 22 }}>
          <WinningsBuyback cards={allLoot} winnerWallet={vm.meWallet} lootTotal={lootTotal} />
        </div>
      )}

      <div style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${COLORS.border}`, background: 'linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.008))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: `1px solid ${COLORS.border}` }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, letterSpacing: '-.01em' }}>Final standings</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.muted }}>{vm.players.length} players · pot {formatUsd(vm.potValue)}</span>
        </div>
        {ranked.map(({ p, rank }) => {
          return (
            <div key={p.wallet} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderBottom: `1px solid #ffffff0a`, background: p.isMe ? 'rgba(0,255,196,.06)' : 'transparent' }}>
              <span style={{ flex: 'none', width: 30, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 15, fontWeight: 700, color: medalColor(rank) }}>#{rank}</span>
              <span style={{ flex: 'none', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#06170f', background: tintFor(p.wallet), border: `2px solid ${p.isMe ? 'rgba(0,255,196,.7)' : 'rgba(255,255,255,.12)'}` }}>{name(p).slice(0, 1).toUpperCase()}</span>
              <div style={{ flex: '1 1 120px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: p.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(p)}</span>
                {p.isMe && <span style={{ flex: 'none', padding: '1px 6px', borderRadius: 5, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontSize: 9, fontWeight: 700, color: COLORS.green }}>YOU</span>}
              </div>
              <div style={{ flex: 'none', width: 74, textAlign: 'right' }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.12em', color: '#6c7682' }}>LOOT</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#cdd4dd' }}>{formatUsd(p.total)}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18, justifyContent: 'center' }}>
        <button onClick={onRematch} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 26px', borderRadius: 13, border: 0, cursor: 'pointer', fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, color: '#06170f', background: GRADIENT, boxShadow: '0 0 22px -6px rgba(0,255,196,.7)' }}>↻ Rematch</button>
        <button onClick={onVerify} style={{ padding: '13px 22px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.muted, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14, fontWeight: 600 }}>Verify (Provably Fair)</button>
        <button onClick={onExit} style={{ padding: '13px 26px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 15, fontWeight: 600 }}>Back to lobby</button>
      </div>
    </div>
  )
}

export { shortWallet }
