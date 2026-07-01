import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { startRematch } from '../../battle/startRematch'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { VerifyPanel } from './VerifyPanel'
import { RevealCard } from './RevealCard'
import { useAliases } from '../../useAliases'
import { EmoteBar } from '../../emotes/EmoteBar'
import type { RevealVM, RevealPlayerVM, RevealCardVM } from './battleReveal'
import { shortWallet, tintFor, medalColor } from './royaleShared'

// Rarity palette for the little card chips / loot.
const RAR: Record<string, { tint: string; border: string; label: string }> = {
  common:    { tint: '#3a4250', border: 'rgba(255,255,255,.18)', label: 'COM' },
  uncommon:  { tint: '#2f6b4a', border: 'rgba(47,226,138,.5)',   label: 'UNC' },
  rare:      { tint: '#2a5a8f', border: 'rgba(78,168,255,.55)',  label: 'RARE' },
  epic:      { tint: '#5a3a9f', border: 'rgba(169,139,255,.6)',  label: 'EPIC' },
  legendary: { tint: '#8a6a1f', border: 'rgba(245,197,66,.65)',  label: 'LEGEND' },
  mythic:    { tint: '#8a6a1f', border: 'rgba(245,197,66,.65)',  label: 'MYTHIC' },
}
const rarOf = (r: string | null) => RAR[(r ?? '').toLowerCase()] ?? RAR.common

const TITLE = (
  <h1 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 700, letterSpacing: '-.02em' }}>
    Battle <span style={{ color: '#ff6bb5' }}>Royale</span>
  </h1>
)
const screenStyle = { padding: '18px clamp(14px,2.4vw,28px) 28px', display: 'flex', flexDirection: 'column' as const, gap: 18 }

function useRanked(vm: RevealVM) {
  // Finish ranking: still-alive (eliminatedRound null) on top by value; eliminated below by when they went out.
  return [...vm.players]
    .sort((a, b) => ((b.eliminatedRound ?? 1e9) - (a.eliminatedRound ?? 1e9)) || (b.total - a.total))
    .map((p, i) => ({ p, rank: i + 1 }))
}
const nameOf = (aliases: Record<string, string | null>) => (p: RevealPlayerVM) =>
  p.isMe ? aliases[p.wallet] ?? 'You' : aliases[p.wallet] ?? shortWallet(p.wallet)

// Round-by-round view — shown while the royale is running.
export function RoyaleReveal({ vm, battleId }: { vm: RevealVM; reducedMotion?: boolean; battleId?: string }) {
  const aliases = useAliases(vm.players.map((p) => p.wallet))
  const settled = vm.status === 'settled'
  const name = nameOf(aliases)
  const ranked = useRanked(vm)
  const alive = ranked.filter((r) => r.p.eliminatedRound == null)
  const leaderWallet = !settled && alive.length ? alive[0].p.wallet : null
  const atRiskWallet = !settled && alive.length > 1 ? alive[alive.length - 1].p.wallet : null
  const entry = vm.players.length ? vm.potValue / vm.players.length : 0

  return (
    <div style={screenStyle}>
      {TITLE}
      <RoundView
        vm={vm} name={name} ranked={ranked} alive={alive.length}
        leaderWallet={leaderWallet} atRiskWallet={atRiskWallet} settled={settled}
        entry={entry} currentRound={vm.rounds.length} totalRounds={Math.max(1, vm.players.length - 1)}
      />
      {vm.meWallet && <div style={{ display: 'flex' }}><EmoteBar meWallet={vm.meWallet} battleId={battleId} /></div>}
    </div>
  )
}

// Separate result screen — shown once every round has finished (battle settled).
export function RoyaleResult({ vm, battleId, onExit }: { vm: RevealVM; battleId?: string; onExit?: () => void }) {
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const aliases = useAliases(vm.players.map((p) => p.wallet))
  const [verifyOpen, setVerifyOpen] = useState(false)
  const name = nameOf(aliases)
  const ranked = useRanked(vm)
  const entry = vm.players.length ? vm.potValue / vm.players.length : 0

  return (
    <div style={screenStyle}>
      {TITLE}
      <ResultView
        vm={vm} name={name} ranked={ranked} entry={entry}
        onRematch={() => startRematch({ battleId, mode: 'royale', token: identityToken, navigate })} onExit={onExit} onVerify={() => setVerifyOpen(true)}
      />
      {verifyOpen && battleId && <VerifyPanel battleId={battleId} onClose={() => setVerifyOpen(false)} />}
    </div>
  )
}

// ─────────────────────────── ROUND VIEW ───────────────────────────
function RoundView({ vm, name, ranked, alive, leaderWallet, atRiskWallet, settled, entry, currentRound, totalRounds }: {
  vm: RevealVM; name: (p: RevealPlayerVM) => string; ranked: { p: RevealPlayerVM; rank: number }[]
  alive: number; leaderWallet: string | null; atRiskWallet: string | null; settled: boolean
  entry: number; currentRound: number; totalRounds: number
}) {
  const progress = vm.players.length > 1 ? (vm.players.length - alive) / (vm.players.length - 1) : 0
  return (
    <div>
      {/* battle bar */}
      <section style={{
        position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap',
        padding: '16px 22px', borderRadius: 18, marginBottom: 22,
        background: 'linear-gradient(135deg,rgba(255,46,151,.16),rgba(13,17,22,.55) 46%,rgba(0,255,196,.10))',
        border: `1px solid ${COLORS.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div style={{
            width: 50, height: 50, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(160deg,#2a1f47,#160f2b)', border: '1px solid rgba(255,46,151,.5)', boxShadow: '0 0 24px -8px rgba(255,46,151,.7)',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ff6bb5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></svg>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ fontFamily: FONTS.display, fontSize: 19, fontWeight: 700, letterSpacing: '-.01em' }}>ROYALE {Math.round(entry)}</span>
              {!settled && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', borderRadius: 7, background: 'rgba(255,94,122,.12)', border: '1px solid rgba(255,94,122,.32)', fontFamily: FONTS.mono, fontSize: 11, color: '#ff8198' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5e7a', boxShadow: '0 0 6px #ff5e7a' }} />LIVE
                </span>
              )}
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
              Battle Royale · entry {formatUsd(entry)} · last one standing
            </div>
          </div>
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 190 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.muted }}>
              {settled ? 'Battle complete' : <>Eliminating the lowest value<span style={{ color: '#ff5e7a', animation: 'ba-dots 1.2s infinite' }}>.</span><span style={{ color: '#ff5e7a', animation: 'ba-dots 1.2s .2s infinite' }}>.</span><span style={{ color: '#ff5e7a', animation: 'ba-dots 1.2s .4s infinite' }}>.</span></>}
            </span>
            <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>round <span style={{ color: COLORS.text, fontWeight: 700 }}>{Math.min(currentRound, totalRounds)}</span> / {totalRounds}</span>
          </div>
          <div style={{ height: 8, borderRadius: 8, background: '#ffffff10', overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
            <div style={{ height: '100%', width: `${Math.round(progress * 100)}%`, borderRadius: 8, background: GRADIENT, boxShadow: '0 0 16px -2px rgba(0,255,196,.7)' }} />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: COLORS.muted }}>ALIVE</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-.02em' }}><span style={{ color: COLORS.green }}>{alive}</span><span style={{ color: '#5c6675', fontSize: 16 }}> / {vm.players.length}</span></div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.18em', color: COLORS.muted }}>TOTAL POT</div>
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', background: GRADIENT, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(vm.potValue)}</div>
          </div>
        </div>
      </section>

      {/* player grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(208px,1fr))', gap: 14 }}>
        {ranked.map(({ p, rank }) => {
          const elim = p.eliminatedRound != null
          const leader = p.wallet === leaderWallet
          const atRisk = p.wallet === atRiskWallet
          const gold = rank === 1 && settled
          const topCard = [...p.cards].sort((a, b) => (b.insuredValue ?? 0) - (a.insuredValue ?? 0))[0]
          const year = topCard?.year ?? '—'
          return (
            <div key={p.wallet} data-player-anchor={p.wallet} style={{
              position: 'relative', borderRadius: 18, padding: 16, overflow: 'hidden',
              background: leader ? 'linear-gradient(180deg,rgba(0,255,196,.10),rgba(255,255,255,.012))'
                : atRisk ? 'linear-gradient(180deg,rgba(255,94,122,.08),rgba(255,255,255,.012))'
                : 'linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01))',
              border: `1px solid ${leader ? 'rgba(0,255,196,.5)' : atRisk ? 'rgba(255,94,122,.5)' : COLORS.border}`,
              boxShadow: leader ? '0 0 50px -16px rgba(0,255,196,.7)' : atRisk ? '0 0 40px -18px rgba(255,94,122,.7)' : 'none',
            }}>
              <div style={{ opacity: elim ? 0.4 : 1, filter: elim ? 'grayscale(.92)' : 'none' }}>
                {/* top row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', padding: '4px 9px', borderRadius: 8,
                    fontFamily: FONTS.mono, fontSize: 12, fontWeight: 700,
                    color: gold ? '#f5c542' : elim ? COLORS.muted : COLORS.text,
                    background: gold ? 'rgba(245,197,66,.14)' : '#ffffff0d',
                    border: `1px solid ${gold ? 'rgba(245,197,66,.4)' : '#ffffff1a'}`,
                  }}>#{rank}</span>
                  {leader && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#f5c542', fontSize: 11, fontWeight: 700 }}>👑 LEADER</span>}
                  {atRisk && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#ff8198', fontSize: 11, fontWeight: 700 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff5e7a', boxShadow: '0 0 6px #ff5e7a' }} />AT RISK</span>}
                </div>
                {/* identity */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <span
                    style={{ flex: 'none', width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#06170f', background: tintFor(p.wallet), border: `2px solid ${p.isMe ? 'rgba(0,255,196,.7)' : 'rgba(255,255,255,.12)'}` }}
                  >{name(p).slice(0, 1).toUpperCase()}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: p.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 96 }}>{name(p)}</span>
                      {p.isMe && <span style={{ flex: 'none', padding: '1px 6px', borderRadius: 5, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontSize: 9, fontWeight: 700, color: COLORS.green }}>YOU</span>}
                    </div>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, color: '#6c7682', marginTop: 2 }}>{p.cards.length} cards</div>
                  </div>
                </div>
                {/* pack mini */}
                <div style={{ position: 'relative', width: '100%', height: 128, borderRadius: 14, overflow: 'hidden', background: 'linear-gradient(165deg,#161b24,#0a0d13)', border: `1px solid ${COLORS.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <span style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(135deg,rgba(255,255,255,.04) 0 1px,transparent 1px 11px)', opacity: 0.7 }} />
                  <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '34%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.12),transparent)', animation: 'ba-sweep 3.8s infinite' }} />
                  <span style={{ position: 'relative', width: 42, height: 42, borderRadius: '50%', background: 'radial-gradient(circle at 35% 30%,#ff6bb5,#d4127a 55%,#00ffc4)', boxShadow: '0 0 24px -6px rgba(255,46,151,.8),inset 0 2px 5px rgba(255,255,255,.35)', animation: 'ba-orb 4s ease-in-out infinite', marginBottom: 8 }} />
                  <span style={{ position: 'relative', fontFamily: FONTS.display, fontSize: 26, fontWeight: 700, lineHeight: 1, letterSpacing: '-.02em', color: COLORS.text }}>{year}</span>
                  <span style={{ position: 'relative', fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.36em', color: '#9aa4b2', marginTop: 4 }}>TCG</span>
                </div>
                {/* value + chips */}
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.16em', color: COLORS.muted }}>VALUE</div>
                    <div style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.02em', color: leader ? COLORS.green : elim ? COLORS.muted : COLORS.text }}>{formatUsd(p.total)}</div>
                  </div>
                  <CardChips cards={p.cards} />
                </div>
              </div>

              {elim && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'rgba(6,8,11,.34)' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 15px', borderRadius: 10, background: 'rgba(255,94,122,.14)', border: '1px solid rgba(255,94,122,.45)', color: '#ff8198', fontSize: 12.5, fontWeight: 700, letterSpacing: '.06em' }}>✕ ELIMINATED</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: '#9aa4b2' }}>finished <span style={{ color: COLORS.text, fontWeight: 700 }}>#{rank}</span> · round {p.eliminatedRound}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────── RESULT VIEW ───────────────────────────
function ResultView({ vm, name, ranked, entry, onRematch, onExit, onVerify }: {
  vm: RevealVM; name: (p: RevealPlayerVM) => string; ranked: { p: RevealPlayerVM; rank: number }[]
  entry: number; onRematch: () => void; onExit?: () => void; onVerify: () => void
}) {
  const champ = ranked[0]?.p
  const iAmPlayer = vm.players.some((p) => p.isMe)
  const iWon = !!champ?.isMe
  const me = ranked.find((r) => r.p.isMe)
  const myRank = me?.rank
  const myElimRound = me?.p.eliminatedRound
  // The champion (winner takes all) gets EVERY card pulled in the match; commons are shown
  // auto-sold (buyback) via RevealCard's ⚡ marker. The pot = total value of all that loot.
  const allLoot = vm.players.flatMap((p) => p.cards)
  const lootTotal = allLoot.reduce((s, c) => s + (c.insuredValue ?? 0), 0)

  return (
    <div>
      {/* banner */}
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

      {/* champion hero */}
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
          <div style={{ flex: '1 1 320px', minWidth: 280 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.muted, marginBottom: 12 }}>CHAMPION LOOT · {formatUsd(lootTotal)}</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {allLoot.map((c, i) => (
                <RevealCard key={i} card={c} reducedMotion w={120} h={200} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* standings */}
      <div style={{ borderRadius: 18, overflow: 'hidden', border: `1px solid ${COLORS.border}`, background: 'linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,.008))' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: `1px solid ${COLORS.border}` }}>
          <span style={{ fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, letterSpacing: '-.01em' }}>Final standings</span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: COLORS.muted }}>{vm.players.length} players · pot {formatUsd(vm.potValue)}</span>
        </div>
        {ranked.map(({ p, rank }) => {
          const net = p.isMe || rank === 1 ? (rank === 1 ? vm.potValue - entry : -entry) : -entry
          const isWinnerRow = rank === 1
          return (
            <div key={p.wallet} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 18px', borderBottom: `1px solid #ffffff0a`, background: p.isMe ? 'rgba(0,255,196,.06)' : 'transparent' }}>
              <span style={{ flex: 'none', width: 30, textAlign: 'center', fontFamily: FONTS.mono, fontSize: 15, fontWeight: 700, color: medalColor(rank) }}>#{rank}</span>
              <span style={{ flex: 'none', width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#06170f', background: tintFor(p.wallet), border: `2px solid ${p.isMe ? 'rgba(0,255,196,.7)' : 'rgba(255,255,255,.12)'}` }}>{name(p).slice(0, 1).toUpperCase()}</span>
              <div style={{ flex: '1 1 120px', minWidth: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: p.isMe ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(p)}</span>
                {p.isMe && <span style={{ flex: 'none', padding: '1px 6px', borderRadius: 5, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontSize: 9, fontWeight: 700, color: COLORS.green }}>YOU</span>}
              </div>
              <div style={{ flex: 'none', width: 74, textAlign: 'right' }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.12em', color: '#6c7682' }}>LOOT</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#cdd4dd' }}>{formatUsd(p.total)}</div>
              </div>
              <div style={{ flex: 'none', width: 70, textAlign: 'right', fontSize: 14.5, fontWeight: 700, color: net >= 0 ? COLORS.green : '#ff8198' }}>
                {net >= 0 ? `+${formatUsd(net)}` : `-${formatUsd(Math.abs(net))}`}{!isWinnerRow && ''}
              </div>
            </div>
          )
        })}
      </div>

      {/* actions */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18, justifyContent: 'center' }}>
        <button onClick={onRematch} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 26px', borderRadius: 13, border: 0, cursor: 'pointer', fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, color: '#06170f', background: GRADIENT, boxShadow: '0 0 22px -6px rgba(0,255,196,.7)' }}>↻ Rematch</button>
        <button onClick={onVerify} style={{ padding: '13px 22px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.muted, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14, fontWeight: 600 }}>Verify (Provably Fair)</button>
        <button onClick={onExit} style={{ padding: '13px 26px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 15, fontWeight: 600 }}>Back to lobby</button>
      </div>
    </div>
  )
}

// Small rarity-tinted card chips shown on a round-view player card.
function CardChips({ cards }: { cards: RevealCardVM[] }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {cards.slice(0, 3).map((c, i) => {
        const r = rarOf(c.rarity)
        return <span key={i} style={{ width: 18, height: 25, borderRadius: 4, background: r.tint, border: `1px solid ${r.border}` }} />
      })}
    </div>
  )
}

export { shortWallet }
