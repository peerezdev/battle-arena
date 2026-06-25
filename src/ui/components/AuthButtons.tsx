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
import { showToast } from '../toast'

/** Abbreviate a wallet address: "ABcd…WXyz" (first 4 + last 4 chars). */
function abbrevAddr(addr: string): string {
  if (addr.length < 10) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

interface AuthButtonsProps {
  variant?: 'nav' | 'compact'
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 11, width: '100%', textAlign: 'left',
        background: hover ? '#ffffff0a' : 'transparent', border: 'none', borderRadius: 8,
        padding: '9px 11px', fontSize: 13.5, fontFamily: FONTS.body, fontWeight: 600,
        color: danger ? COLORS.red : COLORS.text, cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', color: danger ? COLORS.red : COLORS.muted, flexShrink: 0 }}>{icon}</span>
      {label}
    </button>
  )
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
            minWidth: 214,
            background: '#11161f',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 12,
            padding: 6,
            zIndex: 50,
            boxShadow: '0 8px 24px #00000066',
          }}
        >
          {/* identity header: avatar + name + wallet */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '9px 11px 11px' }}>
            <span style={{ width: 38, height: 38, borderRadius: '50%', background: GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: FONTS.display, fontWeight: 800, fontSize: 15, color: '#06120c' }}>{initial}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 14.5, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{username ?? idLine ?? 'Account'}</div>
              {walletAddr && (
                <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted, marginTop: 1 }}>{abbrevAddr(walletAddr)}</div>
              )}
            </div>
          </div>
          <div style={{ height: 1, background: COLORS.border, margin: '2px 0 6px' }} />

          <MenuItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></svg>}
            label="Withdraw"
            onClick={() => { setOpen(false); showToast('Withdrawals are coming soon.', 'info') }}
          />
          <MenuItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>}
            label="My Profile"
            onClick={() => { setOpen(false); navigate('/profile') }}
          />
          <MenuItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" /></svg>}
            label="Inventory"
            onClick={() => { setOpen(false); navigate('/profile?tab=inventory') }}
          />
          <div style={{ height: 1, background: COLORS.border, margin: '6px 0' }} />
          <MenuItem
            icon={<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" x2="9" y1="12" y2="12" /></svg>}
            label="Log out"
            danger
            onClick={() => { setOpen(false); void logout() }}
          />
        </div>
      )}
    </div>
  )
}
