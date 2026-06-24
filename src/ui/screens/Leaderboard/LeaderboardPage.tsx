import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import {
  fetchLeaderboard, fetchUser, applyReferralCode,
  type LeaderboardRow,
} from '../../../onchain/leaderboardClient'

function shortWallet(w: string): string {
  return w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

export function LeaderboardPage() {
  const navigate = useNavigate()
  const myWallet = useEmbeddedSolanaAddress()
  const { identityToken } = useIdentityToken()

  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [myGimmighouls, setMyGimmighouls] = useState<number | null>(null)
  const [myCode, setMyCode] = useState<string | null>(null)

  const [codeInput, setCodeInput] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchLeaderboard()
      .then((r) => { if (!cancelled) setRows(r) })
      .catch(() => { /* keep empty list */ })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!myWallet) return
    let cancelled = false
    fetchUser(myWallet)
      .then((u) => {
        if (cancelled) return
        setMyGimmighouls(u.gimmighouls)
        setMyCode(u.referred_by)
      })
      .catch(() => { /* ignore */ })
    return () => { cancelled = true }
  }, [myWallet])

  async function onApply() {
    if (!myWallet || !identityToken || !codeInput.trim()) return
    setApplying(true)
    setApplyMsg(null)
    try {
      const res = await applyReferralCode(identityToken, myWallet, codeInput.trim())
      setMyCode(res.code)
      setApplyMsg({ ok: true, text: `Applied ${res.code} — +${Math.round(res.boost_pct * 100)}% boost` })
      setCodeInput('')
    } catch (e) {
      setApplyMsg({ ok: false, text: (e as Error).message })
    } finally {
      setApplying(false)
    }
  }

  return (
    <div style={{ maxWidth: 880, width: '100%', margin: '0 auto', padding: '28px 22px' }}>
      <h1 style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 26, margin: '0 0 18px' }}>Leaderboard</h1>

      {/* Referral code section */}
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: '16px 18px', marginBottom: 22 }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.14em', color: COLORS.muted }}>YOUR GIMMIGHOULS</div>
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 28, color: COLORS.green, marginTop: 4 }}>
          {myGimmighouls ?? '—'}
        </div>

        <div style={{ marginTop: 14, fontFamily: FONTS.body, fontSize: 13, color: COLORS.text }}>
          {myCode ? (
            <span>Referral code applied: <strong>{myCode}</strong></span>
          ) : (
            <span style={{ color: COLORS.muted }}>Have a creator code? Apply it to boost your Gimmighouls.</span>
          )}
        </div>

        {!myCode && (
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <input
              aria-label="Referral code"
              placeholder="Referral code"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              disabled={!myWallet || applying}
              style={{
                flex: 1, minWidth: 160, background: COLORS.bg, border: `1px solid ${COLORS.border}`,
                borderRadius: 10, padding: '10px 12px', color: COLORS.text, fontFamily: FONTS.body, fontSize: 14,
              }}
            />
            <button
              type="button"
              onClick={onApply}
              disabled={!myWallet || applying || !codeInput.trim()}
              style={{
                background: COLORS.green, border: 'none', borderRadius: 10, padding: '10px 18px',
                color: '#04130c', fontFamily: FONTS.body, fontWeight: 700, fontSize: 14,
                cursor: !myWallet || applying || !codeInput.trim() ? 'default' : 'pointer',
                opacity: !myWallet || applying || !codeInput.trim() ? 0.5 : 1,
              }}
            >
              {applying ? 'Applying…' : 'Apply'}
            </button>
          </div>
        )}

        {applyMsg && (
          <div style={{ marginTop: 10, fontFamily: FONTS.body, fontSize: 13, color: applyMsg.ok ? COLORS.green : COLORS.red }}>
            {applyMsg.text}
          </div>
        )}
      </div>

      {/* Ranked list */}
      {loading ? (
        <div style={{ color: COLORS.muted, fontFamily: FONTS.body }}>Loading…</div>
      ) : rows.length === 0 ? (
        <div style={{ color: COLORS.muted, fontFamily: FONTS.body }}>No players yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r, i) => {
            const isMe = myWallet != null && r.wallet === myWallet
            return (
              <div
                key={r.wallet}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '40px 1fr auto auto',
                  alignItems: 'center',
                  gap: 12,
                  background: isMe ? 'linear-gradient(160deg,#2fe28a18,#8b5cf610)' : COLORS.panel,
                  border: `1px solid ${isMe ? '#2fe28a55' : COLORS.border}`,
                  borderRadius: 12,
                  padding: '12px 16px',
                }}
              >
                <div style={{ fontFamily: FONTS.mono, fontSize: 14, color: COLORS.muted }}>#{i + 1}</div>
                <button
                  type="button"
                  onClick={() => navigate(`/profile/${r.wallet}`)}
                  style={{
                    background: 'transparent', border: 'none', textAlign: 'left', padding: 0, cursor: 'pointer',
                    fontFamily: FONTS.body, fontWeight: 700, fontSize: 15, color: COLORS.text,
                  }}
                >
                  {r.alias ?? shortWallet(r.wallet)}
                </button>
                <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.green }}>
                  {r.gimmighouls}
                </div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>{r.elo} ELO</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
