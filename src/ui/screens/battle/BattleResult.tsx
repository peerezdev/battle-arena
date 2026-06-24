import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { shortWallet } from './RoyaleReveal'
import { RevealCard } from './RevealCard'
import { VerifyPanel } from './VerifyPanel'
import { useAliases } from '../../useAliases'
import type { RevealVM, RevealPlayerVM } from './battleReveal'

export function BattleResult({ vm, battleId, onExit }: { vm: RevealVM; battleId: string; onExit: () => void }) {
  const [verifyOpen, setVerifyOpen] = useState(false)
  const navigate = useNavigate()
  const aliases = useAliases(vm.players.map((p) => p.wallet))

  const iAmPlayer = vm.players.some((p) => p.isMe)
  const iWon = vm.winner != null && vm.winner === vm.meWallet
  const winner = vm.players.find((p) => p.wallet === vm.winner)

  const title = iWon ? '🏆 You won!' : iAmPlayer ? '💀 You lost' : 'Battle over'
  const titleColor = iWon ? COLORS.green : iAmPlayer ? COLORS.red : COLORS.text
  const name = (p: RevealPlayerVM) => (p.isMe ? aliases[p.wallet] ?? 'You' : aliases[p.wallet] ?? shortWallet(p.wallet))

  return (
    <div style={{ padding: '20px 16px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%' }}>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 24, color: titleColor }}>{title}</div>

      {winner && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.12em', color: COLORS.muted }}>
            {name(winner).toUpperCase()} WINS · TAKES
          </div>
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 30, color: COLORS.green }}>
            {formatUsd(winner.total)}
          </div>
        </div>
      )}

      {/* per-player recap: name, total insuredValue, and all their cards ("hits") */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: 560 }}>
        {vm.players.map((p) => {
          const isWinner = p.wallet === vm.winner
          return (
            <div key={p.wallet} style={{
              border: `1px solid ${isWinner ? COLORS.green : COLORS.border}`, borderRadius: 14, padding: '12px 14px',
              background: isWinner ? `linear-gradient(180deg,#2fe28a0c,${COLORS.panel})` : COLORS.panel,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 }}>
                <span
                  onClick={() => navigate(`/profile/${p.wallet}`)}
                  title="View profile"
                  style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, color: p.isMe ? COLORS.green : COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: `${COLORS.muted}66` }}>
                  {name(p)}{isWinner ? ' 🏆' : ''}
                </span>
                <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: isWinner ? COLORS.green : COLORS.text, flexShrink: 0 }}>
                  {formatUsd(p.total)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {p.cards.map((c, idx) => <RevealCard key={idx} card={c} reducedMotion size="sm" />)}
              </div>
            </div>
          )
        })}
      </div>

      {vm.buybackTotal > 0 && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>
          Buyback total: <span style={{ color: COLORS.text, fontWeight: 700 }}>{formatUsd(vm.buybackTotal)}</span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={() => setVerifyOpen(true)} style={{
          background: 'transparent', color: COLORS.muted, border: `1px solid ${COLORS.border}`,
          borderRadius: 10, padding: '10px 18px', fontWeight: 700, cursor: 'pointer',
        }}>
          Verify (Provably Fair)
        </button>
        <button onClick={onExit} style={{
          background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
          borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
        }}>
          Back
        </button>
      </div>
      {verifyOpen && <VerifyPanel battleId={battleId} onClose={() => setVerifyOpen(false)} />}
    </div>
  )
}
