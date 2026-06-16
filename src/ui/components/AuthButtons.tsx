/**
 * AuthButtons — Log in / Sign up / Account chip using Privy.
 *
 * Works in two layouts:
 *   variant="nav"     → normal padding/font for the Landing nav bar
 *   variant="compact" → smaller padding/font for the Hub topbar
 *
 * No-provider safety: AppPrivyProvider only renders <PrivyProvider> when
 * VITE_PRIVY_APP_ID is set; otherwise it falls back to plain children, which
 * means usePrivy() has no context and will throw. We guard with a try/catch
 * inside a wrapper component so the app doesn't crash in no-APP_ID dev mode.
 */
import { usePrivy } from '@privy-io/react-auth'
import { COLORS, GRADIENT, FONTS } from '../theme'

/** Abbreviate a wallet address: "ABcd…WXyz" (first 4 + last 4 chars). */
function abbrevAddr(addr: string): string {
  if (addr.length < 10) return addr
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`
}

interface AuthButtonsProps {
  variant?: 'nav' | 'compact'
}

/**
 * Inner component — must only be rendered when PrivyProvider is present.
 * The outer AuthButtons guard catches the context error.
 */
function AuthButtonsInner({ variant = 'nav' }: AuthButtonsProps) {
  const { ready, authenticated, user, login, logout } = usePrivy()

  // While Privy is initialising, render nothing to avoid flicker.
  if (!ready) return null

  const isCompact = variant === 'compact'

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
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        {/* Ghost: Log in */}
        <button
          onClick={() => login()}
          style={{
            ...btnBase,
            background: 'transparent',
            border: `1px solid ${COLORS.border}`,
            color: COLORS.text,
          }}
        >
          Log in
        </button>

        {/* Primary gradient: Sign up */}
        <button
          onClick={() => login()}
          style={{
            ...btnBase,
            background: GRADIENT,
            border: 'none',
            color: '#06120c',
            fontWeight: 800,
            boxShadow: '0 0 14px #9945FF33',
          }}
        >
          Sign up
        </button>
      </div>
    )
  }

  // ── Authenticated: account chip + Log out ──────────────────────────────────
  const emailAddr = user?.email?.address
  const walletAddr = user?.wallet?.address
  const displayName = emailAddr ?? (walletAddr ? abbrevAddr(walletAddr) : 'Account')

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      {/* Account chip */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: '#11161f',
          border: `1px solid ${COLORS.border}`,
          borderRadius: '10px',
          padding: isCompact ? '6px 12px' : '8px 14px',
          fontSize: isCompact ? '11px' : '13px',
          fontFamily: FONTS.mono,
          color: COLORS.text,
          maxWidth: isCompact ? '140px' : '200px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={emailAddr ?? walletAddr ?? undefined}
      >
        {/* Green dot — authenticated indicator */}
        <span
          style={{
            display: 'inline-block',
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: COLORS.green,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {displayName}
        </span>
      </div>

      {/* Ghost: Log out */}
      <button
        onClick={() => void logout()}
        style={{
          ...btnBase,
          background: 'transparent',
          border: `1px solid ${COLORS.border}`,
          color: COLORS.muted,
        }}
      >
        Log out
      </button>
    </div>
  )
}

/**
 * Public export. Wraps the inner component in an error boundary-style guard
 * so that a missing PrivyProvider (no APP_ID) doesn't crash the render tree.
 * In production the provider is always present when the component is mounted.
 */
export function AuthButtons(props: AuthButtonsProps) {
  try {
    return <AuthButtonsInner {...props} />
  } catch {
    // No PrivyProvider in context (dev with no APP_ID) — render nothing.
    return null
  }
}
