import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { shortWallet } from './RoyaleReveal'
import { RevealCard } from './RevealCard'
import { VerifyPanel } from './VerifyPanel'
import { useAliases } from '../../useAliases'
import { startRematch } from '../../battle/startRematch'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

const TINTS = ['linear-gradient(135deg,#5cffd8,#00c79a)', 'linear-gradient(135deg,#ff6bb5,#d4127a)', 'linear-gradient(135deg,#4ea8ff,#6a5bff)', 'linear-gradient(135deg,#f5c542,#e8732c)', 'linear-gradient(135deg,#ff6e8a,#d23a5e)']
const tintFor = (w: string) => TINTS[Math.abs([...(w || 'x')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0)) % TINTS.length]
const POS = [
  { bg: 'linear-gradient(135deg,#ffe08a,#f5b73d)', ink: '#06170f', border: 'rgba(245,197,66,.6)' },
  { bg: 'linear-gradient(135deg,#e6edf5,#b6c2d2)', ink: '#16202c', border: 'rgba(220,228,238,.5)' },
  { bg: 'linear-gradient(135deg,#e6a96a,#c07a3e)', ink: '#2a1a08', border: 'rgba(210,150,90,.5)' },
]
const CONF = ['#5cffd8', '#ff2e97', '#f5c542', '#4ea8ff', '#ff6e8a']

export function BattleResult({ vm, battleId, onExit }: { vm: RevealVM; battleId: string; onExit: () => void }) {
  const [verifyOpen, setVerifyOpen] = useState(false)
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const aliases = useAliases(vm.players.map((p) => p.wallet))

  const iAmPlayer = vm.players.some((p) => p.isMe)
  const iWon = vm.winner != null && vm.winner === vm.meWallet
  const name = (p: RevealPlayerVM) => (p.isMe ? aliases[p.wallet] ?? 'You' : aliases[p.wallet] ?? shortWallet(p.wallet))

  const ranked = [...vm.players].sort((a, b) => b.total - a.total)
  const winner = vm.players.find((p) => p.wallet === vm.winner) ?? ranked[0]
  const title = iWon ? 'You won!' : iAmPlayer ? 'You lost' : 'Battle over'

  // Winner takes ALL cards pulled in the battle; the prize = total insured value of that loot.
  const allLoot = vm.players.flatMap((p) => p.cards)
  const lootTotal = allLoot.reduce((s, c) => s + (c.insuredValue ?? 0), 0)

  return (
    <div style={{ padding: '22px clamp(14px,2.4vw,28px) 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      {/* winner hero */}
      <section style={{
        position: 'relative', overflow: 'hidden', borderRadius: 24, padding: 'clamp(26px,3vw,40px) clamp(20px,2.4vw,34px)', textAlign: 'center',
        background: iWon ? 'linear-gradient(180deg,rgba(0,255,196,.14),rgba(13,17,22,.55) 70%)' : 'linear-gradient(180deg,rgba(255,255,255,.04),rgba(13,17,22,.5))',
        border: `1px solid ${iWon ? 'rgba(0,255,196,.4)' : COLORS.border}`,
        ...(iWon ? { animation: 'ba-leadglow 5s ease-in-out infinite' } : {}),
      }}>
        {iWon && Array.from({ length: 16 }, (_, i) => (
          <span key={i} style={{
            position: 'absolute', top: -14, left: `${4 + i * 6}%`, width: 7, height: 11, borderRadius: 2,
            background: CONF[i % CONF.length], opacity: 0, animation: `ba-conf ${2.6 + (i % 4) * 0.5}s linear ${(i % 6) * 0.35}s infinite`,
          }} />
        ))}
        <div style={{ position: 'absolute', top: '-46%', left: '50%', transform: 'translateX(-50%)', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle,rgba(0,255,196,.18),transparent 65%)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 18, marginBottom: 16, background: 'linear-gradient(135deg,#ffe08a,#f5b73d)', boxShadow: '0 14px 40px -12px rgba(245,183,61,.8),inset 0 1px 0 rgba(255,255,255,.5)', animation: 'ba-trophy 3.4s ease-in-out infinite' }}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#5a3d00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
        </div>

        <div style={{ position: 'relative', fontFamily: FONTS.mono, fontSize: 11.5, letterSpacing: '.28em', color: COLORS.green, marginBottom: 6 }}>PACK BATTLE · RESULT</div>
        <h1 style={{ position: 'relative', margin: '0 0 4px', fontFamily: FONTS.display, fontSize: 'clamp(30px,4.4vw,46px)', fontWeight: 700, letterSpacing: '-.02em', lineHeight: 1, color: iWon ? COLORS.green : iAmPlayer ? COLORS.red : COLORS.text }}>{title}</h1>
        {winner && (
          <p style={{ position: 'relative', margin: '0 0 18px', fontSize: 14.5, color: COLORS.muted }}>
            <span style={{ color: COLORS.text, fontWeight: 700 }}>{name(winner)}</span> takes the pot
          </p>
        )}

        {winner && (
          <div style={{ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, animation: 'ba-prizein .6s cubic-bezier(.2,1.2,.4,1) both' }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.muted }}>PRIZE</div>
            <div style={{ fontFamily: FONTS.display, fontSize: 'clamp(46px,7vw,70px)', fontWeight: 700, letterSpacing: '-.03em', lineHeight: .9, background: 'linear-gradient(120deg,#5cffd8,#00c79a 60%,#ff2e97)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{formatUsd(lootTotal)}</div>
          </div>
        )}

        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 18, flexWrap: 'wrap' }}>
          <button onClick={() => startRematch({ battleId, mode: 'pack', token: identityToken, navigate })} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 26px', borderRadius: 13, border: 0, cursor: 'pointer', fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, color: '#06170f', background: GRADIENT, boxShadow: '0 12px 34px -10px rgba(0,255,196,.7)' }}>↻ Rematch</button>
          <button onClick={() => setVerifyOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 22px', borderRadius: 13, border: '1px solid rgba(0,255,196,.32)', background: 'rgba(0,255,196,.08)', color: COLORS.green, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14, fontWeight: 600 }}>Verify · Provably Fair</button>
          <button onClick={onExit} style={{ padding: '13px 22px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.muted, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14, fontWeight: 600 }}>Back to lobby</button>
        </div>
      </section>

      {/* winner's haul — every card pulled in the battle goes to the winner */}
      {allLoot.length > 0 && (
        <section style={{
          borderRadius: 22, padding: 'clamp(20px,2.4vw,30px)',
          background: 'linear-gradient(135deg,rgba(0,255,196,.08),rgba(13,17,22,.6) 55%,rgba(255,46,151,.06))',
          border: '1px solid rgba(0,255,196,.32)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color: COLORS.green }}>WINNER TAKES ALL · {formatUsd(lootTotal)}</span>
            <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(0,255,196,.25),transparent)' }} />
            <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>{allLoot.length} cards</span>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {allLoot.map((c, i) => <RevealCard key={i} card={c} reducedMotion w={120} h={200} />)}
          </div>
        </section>
      )}

      {/* standings */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '0 4px' }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color: COLORS.muted }}>RESULTS · {vm.players.length} PLAYERS</span>
          <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(255,255,255,.10),transparent)' }} />
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>sorted by value</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {ranked.map((p, i) => {
            const isWinner = p.wallet === vm.winner
            const ps = POS[i] ?? { bg: '#ffffff0d', ink: COLORS.muted, border: '#ffffff1f' }
            return (
              <div key={p.wallet} style={{
                position: 'relative', overflow: 'hidden', borderRadius: 18, padding: '18px 20px',
                background: isWinner ? 'linear-gradient(90deg,rgba(0,255,196,.10),rgba(255,255,255,.012))' : 'linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012))',
                border: `1px solid ${isWinner ? 'rgba(0,255,196,.5)' : COLORS.border}`,
                boxShadow: isWinner ? '0 0 50px -18px rgba(0,255,196,.5)' : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
                  <span style={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: '50%', fontFamily: FONTS.mono, fontSize: 14, fontWeight: 700, color: ps.ink, background: ps.bg, border: `1px solid ${ps.border}` }}>#{i + 1}</span>
                  <span style={{ flex: 'none', width: 34, height: 34, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#06170f', background: tintFor(p.wallet), border: `2px solid ${p.isMe ? 'rgba(0,255,196,.7)' : 'rgba(255,255,255,.12)'}` }}>{name(p).slice(0, 1).toUpperCase()}</span>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span onClick={() => navigate(`/profile/${p.wallet}`)} title="View profile"
                      style={{ fontFamily: FONTS.display, fontSize: 16, fontWeight: 700, color: isWinner ? COLORS.green : COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>{name(p)}</span>
                    {isWinner && <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 7, background: GRADIENT, color: '#06170f', fontSize: 10, fontWeight: 700, letterSpacing: '.04em' }}>🏆 WINNER</span>}
                    {p.isMe && <span style={{ flex: 'none', padding: '2px 8px', borderRadius: 6, background: 'rgba(0,255,196,.14)', border: '1px solid rgba(0,255,196,.4)', fontSize: 9.5, fontWeight: 700, color: COLORS.green }}>YOU</span>}
                  </div>
                  <div style={{ flex: 'none', textAlign: 'right' }}>
                    <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.16em', color: COLORS.muted }}>PACK VALUE</div>
                    <div style={{ fontFamily: FONTS.display, fontSize: 20, fontWeight: 700, letterSpacing: '-.02em', color: isWinner ? COLORS.green : COLORS.text }}>{formatUsd(p.total)}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* buyback footer */}
      {vm.buybackTotal > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '16px 20px', borderRadius: 16, background: '#ffffff08', border: `1px solid ${COLORS.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ width: 36, height: 36, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,255,196,.12)', border: '1px solid rgba(0,255,196,.32)', color: COLORS.green }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            </span>
            <div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.14em', color: COLORS.muted }}>INSTANT BUYBACK · COMMONS AUTO-SOLD</div>
              <div style={{ fontSize: 14, color: COLORS.muted, marginTop: 2 }}>Manage the rest of your cards in your inventory.</div>
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.16em', color: COLORS.muted }}>BUYBACK TOTAL</div>
              <div style={{ fontFamily: FONTS.display, fontSize: 22, fontWeight: 700, letterSpacing: '-.02em', color: COLORS.text }}>{formatUsd(vm.buybackTotal)}</div>
            </div>
            <button onClick={() => navigate('/profile')} style={{ padding: '12px 22px', borderRadius: 12, border: 0, cursor: 'pointer', fontFamily: FONTS.display, fontSize: 14, fontWeight: 700, color: '#06170f', background: GRADIENT, boxShadow: '0 0 22px -6px rgba(0,255,196,.7)' }}>View inventory</button>
          </div>
        </div>
      )}

      {verifyOpen && <VerifyPanel battleId={battleId} onClose={() => setVerifyOpen(false)} />}
    </div>
  )
}
