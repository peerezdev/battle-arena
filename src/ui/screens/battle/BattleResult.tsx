import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { shortWallet } from './RoyaleReveal'
import { RevealCard } from './RevealCard'
import { WinningsBuyback } from './WinningsBuyback'
import { useAliases } from '../../useAliases'
import { useIsWide } from '../../useIsWide'
import { NextBattlePanel } from './NextBattlePanel'
import { startRematch } from '../../battle/startRematch'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

const TINTS = ['linear-gradient(135deg,#5cffd8,#00c79a)', 'linear-gradient(135deg,#ff6bb5,#d4127a)', 'linear-gradient(135deg,#4ea8ff,#6a5bff)', 'linear-gradient(135deg,#f5c542,#e8732c)', 'linear-gradient(135deg,#ff6e8a,#d23a5e)']
const tintFor = (w: string) => TINTS[Math.abs([...(w || 'x')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % TINTS.length]
const CONF = ['#5cffd8', '#ff2e97', '#f5c542', '#4ea8ff', '#ff6e8a']
// Desktop standings rank ink: gold-ish green for #1, silver, bronze, then muted.
const RANK_INK = ['#3ce8a8', '#aab3bf', '#c98a3d', '#7d8794']

export function BattleResult({ vm, battleId, onExit }: { vm: RevealVM; battleId: string; onExit: () => void }) {
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const aliases = useAliases(vm.players.map((p) => p.wallet))
  const wide = useIsWide('(min-width: 1024px)')

  const iAmPlayer = vm.players.some((p) => p.isMe)
  const iWon = vm.winner != null && vm.winner === vm.meWallet
  // A player who lost — NOT the spectator "Battle over" case, which stays neutral. Drives the
  // magenta loss hero (the Next-Battle magenta), the counterpart to the green winner hero.
  const iLost = iAmPlayer && !iWon
  const name = (p: RevealPlayerVM) => (p.isMe ? aliases[p.wallet] ?? 'You' : aliases[p.wallet] ?? shortWallet(p.wallet))

  const ranked = [...vm.players].sort((a, b) => b.total - a.total)
  const winner = vm.players.find((p) => p.wallet === vm.winner) ?? ranked[0]
  const title = iWon ? 'You won!' : iAmPlayer ? 'You lost' : 'Battle over'

  // Winner takes ALL cards pulled in the battle; the prize = total insured value of that loot.
  const allLoot = vm.players.flatMap((p) => p.cards)
  const lootTotal = allLoot.reduce((s, c) => s + (c.insuredValue ?? 0), 0)

  // ── Desktop (≥1024px): hero + standings + next battle across the top, winnings below. ──
  if (wide) {
    const ret = vm.entry > 0 ? lootTotal / vm.entry : null
    return (
      <div style={{ padding: 36, display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 1440, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.5fr .9fr .7fr', gap: 20, alignItems: 'stretch' }}>
          {/* hero — green when I won, the Next-Battle magenta when I lost, neutral for a spectator */}
          <div style={{
            borderRadius: 20,
            border: `1px solid ${iWon ? 'rgba(60,232,168,.25)' : iLost ? 'rgba(255,46,126,.3)' : COLORS.border}`,
            background: iWon
              ? 'radial-gradient(600px 360px at 30% 0%,rgba(60,232,168,.12),transparent),linear-gradient(160deg,#0b1a16,#0a0d13)'
              : iLost
                ? 'radial-gradient(600px 360px at 30% 0%,rgba(255,46,126,.13),transparent),linear-gradient(160deg,#1a0a12,#0a0d13)'
                : 'radial-gradient(600px 360px at 30% 0%,rgba(255,255,255,.05),transparent),linear-gradient(160deg,#12151d,#0a0d13)',
            padding: '36px 42px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 11, fontWeight: 700, letterSpacing: '.22em', color: iWon ? COLORS.green : iLost ? '#ff6ba4' : COLORS.muted }}>
              PACK BATTLE · RESULT
            </span>
            <h1 style={{ margin: '12px 0 6px', fontFamily: FONTS.display, fontSize: 48, fontWeight: 700, lineHeight: 1.05 }}>
              {iWon ? (
                <>You won <span style={{ background: 'linear-gradient(90deg,#3ce8a8,#ff2e7e)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(lootTotal)}</span></>
              ) : title}
            </h1>
            {winner && (
              <p style={{ margin: 0, fontSize: 15, color: '#aab3bf' }}>
                <strong style={{ color: COLORS.text }}>{name(winner)}</strong> takes the pot
                {vm.entry > 0 && <> · entry {formatUsd(vm.entry)}</>}
                {ret != null && <> · <span style={{ color: COLORS.green, fontWeight: 700 }}>×{ret.toFixed(1)} return</span></>}
              </p>
            )}
            <div style={{ display: 'flex', gap: 10, marginTop: 26, flexWrap: 'wrap' }}>
              <button onClick={() => startRematch({ battleId, mode: 'pack', token: identityToken, navigate })}
                style={{ padding: '13px 22px', borderRadius: 12, border: 0, background: GRADIENT, color: '#06080b', fontFamily: FONTS.display, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>↻ Rematch</button>
              <button onClick={onExit}
                style={{ padding: '13px 22px', borderRadius: 12, border: `1px solid ${COLORS.border}`, background: 'transparent', color: '#aab3bf', fontFamily: FONTS.body, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Back to lobby</button>
            </div>
          </div>

          {/* final standings */}
          <div style={{ borderRadius: 20, border: `1px solid ${COLORS.border}`, background: '#0c0f15', padding: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 11, fontWeight: 700, letterSpacing: '.18em', color: '#7d8794' }}>FINAL STANDINGS</span>
            {ranked.map((p, i) => {
              const isW = p.wallet === vm.winner
              return (
                <div key={p.wallet} style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10,
                  background: isW ? 'rgba(60,232,168,.08)' : 'rgba(255,255,255,.03)',
                  border: `1px solid ${isW ? 'rgba(60,232,168,.35)' : 'rgba(255,255,255,.07)'}`,
                }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 11, fontWeight: 700, color: RANK_INK[i] ?? '#7d8794', width: 20 }}>#{i + 1}</span>
                  <div onClick={() => navigate(`/profile/${p.wallet}`)} title="View profile"
                    style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: isW ? COLORS.text : '#cdd4dd', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(p)}</span>
                    {p.isMe && <span style={{ flex: 'none', fontSize: 9, fontWeight: 700, color: '#06221a', background: COLORS.green, borderRadius: 5, padding: '2px 5px' }}>YOU</span>}
                  </div>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 700, color: isW ? COLORS.green : '#cdd4dd' }}>{formatUsd(p.total)}</span>
                </div>
              )
            })}
          </div>

          {/* next battle */}
          <NextBattlePanel mode="pack" currentBattleId={battleId} meWallet={vm.meWallet} />
        </div>

        {/* winnings (winner) — or the read-only haul for everyone else */}
        {allLoot.length > 0 && (iWon ? (
          <WinningsBuyback cards={allLoot} winnerWallet={vm.meWallet} lootTotal={lootTotal} wide />
        ) : (
          <section style={{ borderRadius: 20, border: `1px solid ${COLORS.border}`, background: '#0c0f15', padding: '24px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: 11, fontWeight: 700, letterSpacing: '.18em', color: COLORS.green }}>WINNER TAKES ALL · {formatUsd(lootTotal)}</span>
              <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(0,255,196,.25),transparent)' }} />
              <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>{allLoot.length} cards</span>
            </div>
            <div style={{ display: 'flex', gap: 14, overflowX: 'auto', padding: '4px 2px 6px' }}>
              {allLoot.map((c, i) => <div key={i} style={{ flexShrink: 0 }}><RevealCard card={c} reducedMotion w={150} h={210} /></div>)}
            </div>
          </section>
        ))}
      </div>
    )
  }

  // ── Mobile: compact hero, winnings, standings, next battle. ──
  const mRet = vm.entry > 0 ? lootTotal / vm.entry : null
  const mMargin = ranked.length > 1 ? ranked[0].total - ranked[1].total : null

  return (
    <div style={{ padding: '10px 14px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* compact hero — trophy + prize inline + actions. Green won / Next-Battle magenta lost / neutral spectator. */}
      <div style={{
        position: 'relative', overflow: 'hidden', borderRadius: 18, padding: '18px 16px 16px',
        background: iWon
          ? 'radial-gradient(120% 100% at 50% 0%,rgba(60,232,168,.12),transparent 60%),#0a0d13'
          : iLost
            ? 'radial-gradient(120% 100% at 50% 0%,rgba(255,46,126,.13),transparent 60%),#0a0d13'
            : 'radial-gradient(120% 100% at 50% 0%,rgba(255,255,255,.05),transparent 60%),#0a0d13',
        border: `1px solid ${iWon ? 'rgba(60,232,168,.3)' : iLost ? 'rgba(255,46,126,.3)' : COLORS.border}`,
      }}>
        {iWon && CONF.map((col, i) => (
          <span key={i} aria-hidden style={{
            position: 'absolute', top: 0, left: `${12 + i * 19}%`, width: 6, height: 9, borderRadius: 2,
            background: col, opacity: 0, animation: `ba-conf ${2.6 + (i % 3) * 0.4}s linear ${i * 0.35}s infinite`,
          }} />
        ))}

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            flex: 'none', width: 46, height: 46, borderRadius: 13, display: 'grid', placeItems: 'center', fontSize: 22,
            background: 'linear-gradient(160deg,#ffd166,#e8a12c)', boxShadow: '0 8px 28px rgba(255,209,102,.3)',
            ...(iWon ? { animation: 'ba-trophy 3.4s ease-in-out infinite' } : {}),
          }}>🏆</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, letterSpacing: '.2em', color: '#ff6ba4' }}>PACK BATTLE · RESULT</div>
            <div style={{ fontFamily: FONTS.display, fontSize: 24, fontWeight: 700, lineHeight: 1.15 }}>
              {iWon ? (
                <>You won <span style={{ background: 'linear-gradient(90deg,#3ce8a8,#ff2e7e)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(lootTotal)}</span></>
              ) : title}
            </div>
            {winner && (
              <div style={{ fontSize: 11.5, color: '#8b95a3' }}>
                <strong style={{ color: COLORS.text }}>{name(winner)}</strong> takes the pot
                {vm.entry > 0 && <> · entry {formatUsd(vm.entry)}</>}
                {mRet != null && <> · <span style={{ color: COLORS.green, fontWeight: 700 }}>×{mRet.toFixed(1)}</span></>}
              </div>
            )}
          </div>
        </div>

        <div style={{ position: 'relative', display: 'flex', gap: 7, marginTop: 14 }}>
          <button onClick={() => startRematch({ battleId, mode: 'pack', token: identityToken, navigate })}
            style={{ flex: 1.2, padding: '12px 8px', borderRadius: 12, border: 0, background: GRADIENT, color: '#06080b', fontFamily: FONTS.display, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>↻ Rematch</button>
          <button onClick={onExit}
            style={{ flex: 1, padding: '12px 8px', borderRadius: 12, border: `1px solid ${COLORS.border}`, background: 'transparent', color: '#8b95a3', fontFamily: FONTS.body, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Lobby</button>
        </div>
      </div>

      {/* winnings (winner) — or the read-only haul for everyone else */}
      {allLoot.length > 0 && (iWon ? (
        <WinningsBuyback cards={allLoot} winnerWallet={vm.meWallet} lootTotal={lootTotal} />
      ) : (
        <div style={{ borderRadius: 16, background: '#0a0d13', border: `1px solid ${COLORS.border}`, padding: '14px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', marginBottom: 10 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, letterSpacing: '.14em', color: COLORS.green }}>WINNER TAKES ALL · {formatUsd(lootTotal)}</span>
            <span style={{ marginLeft: 'auto', fontFamily: FONTS.mono, fontSize: 8.5, color: '#5c6673' }}>{allLoot.length} CARDS</span>
          </div>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 14px 2px' }}>
            {allLoot.map((c, i) => <div key={i} style={{ flex: 'none' }}><RevealCard card={c} reducedMotion w={104} h={146} /></div>)}
          </div>
        </div>
      ))}

      {/* next battle — above the standings on mobile: after the winnings, the useful next tap is
          jumping into another game, not scrolling past the full table to find it. */}
      <NextBattlePanel mode="pack" currentBattleId={battleId} meWallet={vm.meWallet} compact />

      {/* standings */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, letterSpacing: '.16em', color: COLORS.text }}>RESULTS · {vm.players.length} PLAYERS</span>
        <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(60,232,168,.3),transparent)' }} />
        {mMargin != null && <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, color: '#5c6673' }}>+{formatUsd(mMargin)} OVER #2</span>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {ranked.map((p, i) => {
          const isW = p.wallet === vm.winner
          return (
            <div key={p.wallet} style={{
              display: 'flex', alignItems: 'center', gap: 10, borderRadius: 13, padding: '11px 13px',
              background: isW ? 'rgba(60,232,168,.06)' : '#0c0f15',
              border: `1px solid ${isW ? 'rgba(60,232,168,.4)' : 'rgba(255,255,255,.08)'}`,
            }}>
              <span style={{
                flex: 'none', width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center',
                fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700,
                background: isW ? '#ffd166' : 'rgba(255,255,255,.08)', color: isW ? '#2b2005' : '#cdd4dd',
              }}>#{i + 1}</span>
              <span style={{ flex: 'none', width: 28, height: 28, borderRadius: '50%', background: tintFor(p.wallet), display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12, color: '#06170f' }}>{name(p).slice(0, 1).toUpperCase()}</span>
              <div onClick={() => navigate(`/profile/${p.wallet}`)} style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: isW ? COLORS.text : '#cdd4dd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name(p)}</span>
                {isW && <span style={{ flex: 'none', fontFamily: FONTS.mono, fontSize: 7.5, fontWeight: 700, color: '#2b2005', background: '#ffd166', borderRadius: 5, padding: '2px 6px' }}>🏆 WINNER</span>}
                {p.isMe && <span style={{ flex: 'none', fontFamily: FONTS.mono, fontSize: 7.5, fontWeight: 700, color: COLORS.green, border: '1px solid rgba(60,232,168,.4)', borderRadius: 5, padding: '2px 6px' }}>YOU</span>}
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right', lineHeight: 1.25, flex: 'none' }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 7.5, letterSpacing: '.12em', color: '#7a8492' }}>PACK VALUE</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 14, fontWeight: 700, color: isW ? COLORS.green : COLORS.text }}>{formatUsd(p.total)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
