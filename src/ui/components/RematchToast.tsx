import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../theme'
import { useEmbeddedSolanaAddress } from '../../wallet/embedded'
import { rematchBattle } from '../../onchain/packBattleClient'
import { showToast } from '../toastBus'
import { useServerEvents } from '../../hooks/useServerEvents'
import { useIsWide } from '../useIsWide'

export interface RematchInvite {
  challengerName: string
  gameMode: string           // "Pack Battle" | "Battle Royale"
  buyIn: string              // formatted "$50" (empty when unknown)
  finishedBattleId: string
  rematchBattleId: string
}

const TOAST_SECONDS = 15

function initials(s: string): string {
  const t = s.replace(/[^a-zA-Z0-9]/g, '')
  return (t.slice(0, 2) || '?').toUpperCase()
}
function shorten(w: string): string {
  return w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w
}

/** Bottom-centre rematch-challenge toast: avatar + crossed swords, mode + buy-in, Join / Later,
 *  and a shrinking countdown bar. Auto-dismisses after `seconds`. */
export function RematchToast({ invite, onJoin, onDismiss, seconds = TOAST_SECONDS }: {
  invite: RematchInvite
  onJoin: () => void
  onDismiss: () => void
  seconds?: number
}) {
  const wide = useIsWide('(min-width: 860px)')
  const [leaving, setLeaving] = useState(false)

  function close(after: () => void) {
    setLeaving(true)
    setTimeout(after, 250)
  }

  // Auto-dismiss when the countdown runs out.
  useEffect(() => {
    const t = setTimeout(() => close(onDismiss), seconds * 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{
      position: 'fixed', left: '50%', transform: 'translateX(-50%)',
      bottom: wide ? 28 : 84,   // clear the mobile bottom nav
      zIndex: 9998, width: 372, maxWidth: 'calc(100vw - 28px)', pointerEvents: 'auto',
      animation: leaving ? 'ba-rmt-out .25s ease-in forwards' : 'ba-rmt-in .38s cubic-bezier(.2,.9,.3,1.2)',
    }}>
      <div style={{
        position: 'relative', overflow: 'hidden', borderRadius: 18,
        background: 'rgba(13,16,22,.97)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        border: `1px solid ${COLORS.violet}61`,
        boxShadow: `0 24px 70px -22px ${COLORS.violet}80, 0 8px 30px -12px rgba(0,0,0,.8)`,
      }}>
        <div style={{ position: 'absolute', top: '-60%', right: '-20%', width: 260, height: 260, borderRadius: '50%', background: `radial-gradient(circle, ${COLORS.violet}38, transparent 62%)`, pointerEvents: 'none' }} />

        <div style={{ position: 'relative', display: 'flex', gap: 13, padding: '15px 15px 13px' }}>
          {/* avatar + swords badge */}
          <span style={{ position: 'relative', flex: 'none', width: 46, height: 46, borderRadius: '50%', background: 'linear-gradient(135deg,#4ea8ff,#6a5bff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#06170f', border: `2px solid ${COLORS.violet}8c` }}>
            {initials(invite.challengerName)}
            <span style={{ position: 'absolute', right: -5, bottom: -5, width: 21, height: 21, borderRadius: '50%', background: `linear-gradient(135deg,${COLORS.violet},#c2265e)`, border: '2px solid #0d1016', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'ba-swords 2.6s ease-in-out infinite' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" x2="19" y1="19" y2="13" /><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" /><line x1="5" x2="9" y1="14" y2="18" /></svg>
            </span>
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.18em', color: COLORS.violet, marginBottom: 4 }}>REMATCH CHALLENGE</div>
            <div style={{ fontSize: 14, lineHeight: 1.45, color: '#cdd4dd' }}>
              <span style={{ fontWeight: 700, color: COLORS.text }}>{invite.challengerName}</span> challenged you to a rematch
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 6, flexWrap: 'wrap' }}>
              <span style={{ display: 'inline-flex', padding: '3px 9px', borderRadius: 7, background: `${COLORS.green}1f`, border: `1px solid ${COLORS.green}52`, fontFamily: FONTS.mono, fontSize: 10, color: COLORS.green }}>{invite.gameMode.toUpperCase()}</span>
              {invite.buyIn && (
                <>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 12, fontWeight: 700, color: COLORS.text }}>{invite.buyIn}</span>
                  <span style={{ fontSize: 11.5, color: COLORS.muted }}>buy-in</span>
                </>
              )}
            </div>
          </div>

          <button onClick={() => close(onDismiss)} title="Dismiss" aria-label="Dismiss"
            style={{ flex: 'none', alignSelf: 'flex-start', width: 28, height: 28, borderRadius: 9, border: 0, background: 'transparent', color: COLORS.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>✕</button>
        </div>

        <div style={{ position: 'relative', display: 'flex', gap: 9, padding: '0 15px 14px' }}>
          <button onClick={() => close(onJoin)}
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '12px 0', borderRadius: 12, border: 0, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14, fontWeight: 700, color: '#06170f', background: GRADIENT, boxShadow: `0 10px 28px -12px ${COLORS.green}b3` }}>Join rematch</button>
          <button onClick={() => close(onDismiss)}
            style={{ flex: 'none', padding: '12px 18px', borderRadius: 12, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', color: COLORS.muted, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13.5, fontWeight: 600 }}>Later</button>
        </div>

        {/* countdown bar */}
        <div style={{ position: 'relative', height: 3, background: 'rgba(255,255,255,.07)' }}>
          <span style={{ position: 'absolute', inset: 0, transformOrigin: 'left', background: `linear-gradient(90deg,${COLORS.violet},${COLORS.green})`, animation: `ba-rmt-prog ${seconds}s linear forwards` }} />
        </div>
      </div>
    </div>
  )
}

/**
 * App-wide listener + host: when a battle you were in gets a rematch (created by someone else),
 * show the RematchToast — even after you left the result screen. Filters the WS broadcast to the
 * finished battle's participants and never re-notifies the creator. Join auto-joins the rematch.
 */
export function RematchToastHost() {
  const { identityToken } = useIdentityToken()
  const meWallet = useEmbeddedSolanaAddress()
  const navigate = useNavigate()
  const navRef = useRef(navigate); navRef.current = navigate
  const meRef = useRef(meWallet); meRef.current = meWallet
  const tokenRef = useRef(identityToken); tokenRef.current = identityToken

  const [invite, setInvite] = useState<RematchInvite | null>(null)

  useServerEvents((msg) => {
    const m = msg as {
      type?: string; from?: string; from_name?: string; players?: string[]
      finished_battle_id?: string; rematch_battle_id?: string; mode?: string; buyin?: number
    }
    if (m?.type !== 'rematch') return
    const me = meRef.current
    if (!me || m.from === me || !Array.isArray(m.players) || !m.players.includes(me)) return
    setInvite({
      challengerName: m.from_name || shorten(m.from || ''),
      gameMode: m.mode === 'royale' ? 'Battle Royale' : 'Pack Battle',
      buyIn: typeof m.buyin === 'number' ? formatUsd(m.buyin) : '',
      finishedBattleId: m.finished_battle_id || '',
      rematchBattleId: m.rematch_battle_id || '',
    })
  }, !!meWallet)

  async function join() {
    const inv = invite
    setInvite(null)
    if (!inv) return
    try {
      const r = await rematchBattle(tokenRef.current!, inv.finishedBattleId)
      navRef.current(`/play/battle/${r.battle_id}`)
    } catch (e) {
      navRef.current(`/play/battle/${inv.rematchBattleId}`)
      showToast(e instanceof Error ? e.message : 'Could not join the rematch')
    }
  }

  if (!invite) return null
  return <RematchToast key={invite.rematchBattleId} invite={invite} onJoin={join} onDismiss={() => setInvite(null)} />
}
