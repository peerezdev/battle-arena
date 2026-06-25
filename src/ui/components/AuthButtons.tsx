/**
 * AuthButtons — Log in / Account chip using Privy.
 *
 * Works in two layouts:
 *   variant="nav"     → normal padding/font for the Landing nav bar
 *   variant="compact" → smaller padding/font for the Hub topbar
 *
 * No-provider safety: when VITE_PRIVY_APP_ID is unset, AppPrivyProvider renders
 * plain children (no <PrivyProvider>). Privy's context has a non-null default
 * with `ready: false`, so usePrivy() returns safely and the `!ready` early
 * return below renders nothing — no crash, no provider required for build/tests.
 */
import { useState, useRef, useEffect } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useNavigate } from 'react-router-dom'
import { COLORS, GRADIENT, FONTS } from '../theme'
import { useProfile } from '../../hooks/useProfile'
import { useIsWide } from '../useIsWide'

/** Abbreviate a wallet address: "ABcd…WXyz" (first 4 + last 4 chars). */
function abbrevAddr(addr: string): string {
  if (addr.length < 10) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

interface AuthButtonsProps {
  variant?: 'nav' | 'compact'
}

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: '#e9edf5',
  borderRadius: 7,
  padding: '9px 11px',
  fontSize: 13,
  fontFamily: 'Inter, system-ui, sans-serif',
  cursor: 'pointer',
}

export function AuthButtons({ variant = 'nav' }: AuthButtonsProps) {
  const { ready, authenticated, user, login, logout } = usePrivy()

  // ── All hooks must be called unconditionally, before any early return ──────
  const navigate = useNavigate()
  const { username } = useProfile()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const isCompact = variant === 'compact'
  const wide = useIsWide('(min-width: 760px)')

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // While Privy is initialising, render nothing to avoid flicker.
  if (!ready) return null

  const btnBase: React.CSSProperties = {
    borderRadius: '10px',
    cursor: 'pointer',
    fontFamily: FONTS.body,
    fontWeight: 700,
    letterSpacing: '.01em',
    transition: 'opacity 0.15s',
    whiteSpace: 'nowrap',
    padding: isCompact ? '7px 14px' : '10px 20px',
    fontSize: isCompact ? '12px' : '14px',
  }

  if (!authenticated) {
    return (
      <button
        onClick={() => login()}
        style={{
          ...btnBase,
          background: GRADIENT,
          border: 'none',
          color: '#06120c',
          fontWeight: 800,
          boxShadow: '0 0 14px #8b5cf633',
        }}
      >
        Log in
      </button>
    )
  }

  // ── Authenticated: avatar pill (initial + name + caret) + dropdown ──────────
  const emailAddr = user?.email?.address
  const walletAddr = user?.wallet?.address
  const idLine = emailAddr ?? (walletAddr ? abbrevAddr(walletAddr) : null)
  const displayName = username ?? idLine ?? 'Account'
  const initial = (username ?? emailAddr ?? walletAddr ?? '?').slice(0, 1).toUpperCase()
  const showName = wide
  const avatar = isCompact ? 30 : 34

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={displayName}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#11161f',
          border: `1px solid ${COLORS.border}`,
          borderRadius: 999,
          padding: showName ? '4px 12px 4px 4px' : 4,
          color: COLORS.text,
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <span style={{
          position: 'relative', width: avatar, height: avatar, borderRadius: '50%', background: GRADIENT,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          fontFamily: FONTS.display, fontWeight: 800, fontSize: 13, color: '#06120c',
        }}>
          {initial}
          {/* online dot */}
          <span style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: '50%', background: COLORS.green, border: '2px solid #11161f', boxShadow: `0 0 6px ${COLORS.green}` }} />
        </span>
        {showName && (
          <span style={{ fontFamily: FONTS.body, fontWeight: 700, fontSize: 13, color: COLORS.text, maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {displayName}
          </span>
        )}
        <span style={{ color: COLORS.muted, fontSize: 10, marginRight: showName ? 2 : 3 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 200,
            background: '#11161f',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: 6,
            zIndex: 50,
            boxShadow: '0 8px 24px #00000066',
          }}
        >
          {/* identity header */}
          <div style={{ padding: '8px 11px 10px' }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.16em', color: COLORS.muted }}>SIGNED IN AS</div>
            <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 14, color: COLORS.text, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {username ?? idLine ?? 'Account'}
            </div>
            {username && idLine && (
              <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{idLine}</div>
            )}
          </div>
          <div style={{ height: 1, background: COLORS.border, margin: '2px 0 6px' }} />

          <button
            onClick={() => { setOpen(false); navigate('/profile') }}
            style={menuItemStyle}
          >
            View profile
          </button>
          <button
            onClick={() => { setOpen(false); void logout() }}
            style={{ ...menuItemStyle, color: COLORS.muted }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
