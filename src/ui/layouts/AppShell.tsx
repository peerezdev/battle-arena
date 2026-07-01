import { useState, useEffect, useRef } from 'react'
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { COLORS, GRADIENT, FONTS, formatUsd } from '../theme'
import { useUsdcBalance } from '../../wallet/useUsdcBalance'
import { useReservedBalance, availableUsd } from '../../wallet/useReservedBalance'
import { useProfile } from '../../hooks/useProfile'
import { useReducedMotion } from '../useReducedMotion'
import { useIsWide } from '../useIsWide'
import { AuthButtons } from '../components/AuthButtons'
import { RadioPlayer } from '../components/RadioPlayer'
import { DepositModal } from '../components/DepositModal'
import { LeftRail, NAV_ICONS } from '../screens/Hub/LeftRail'
import { ChatDock } from '../screens/Hub/ChatDock'
import { useChat } from '../../hooks/useChat'
import { useRematchInvites } from '../../hooks/useRematchInvites'
import { LiveDropsStrip } from '../screens/Hub/LiveDropsStrip'
import { NAV_ITEMS, type HubNav } from '../screens/Hub/hubMockData'
import { NAV_ROUTES, activeNavFromPath } from './navRoutes'
import { Toaster } from '../toast'

const DOCK_KEY = 'ba.dockCollapsed'

// Compact Gimmighoul count for the tight mobile header (262,500,000 → 262.5M).
function fmtGh(n: number): string {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`
  return String(n)
}

export function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const reducedMotion = useReducedMotion()
  const { usdc } = useUsdcBalance()
  const { reserved, locked } = useReservedBalance()
  const { gimmighouls } = useProfile()
  const { authenticated } = usePrivy()

  // Breakpoints copied verbatim from Hub.tsx
  const wideRail = useIsWide('(min-width: 760px)')
  const wideDock = useIsWide('(min-width: 1100px)')

  const [depositOpen, setDepositOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(DOCK_KEY) === '1' } catch { return false }
  })

  function toggleDock() {
    setDockCollapsed((c) => {
      const next = !c
      try { localStorage.setItem(DOCK_KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }

  // ── Mobile chat unread dot ─────────────────────────────────────────────────
  // On mobile the chat is only mounted while open, so keep a persistent connection here to know
  // when a new message arrives while it's closed. Mark everything seen when the chat is open.
  useRematchInvites()   // app-wide rematch toast, even after leaving the result screen
  const { messages: chatMessages } = useChat(!wideRail)
  const [seenChat, setSeenChat] = useState(0)
  const seenInit = useRef(false)
  useEffect(() => {
    if (!seenInit.current && chatMessages.length > 0) { seenInit.current = true; setSeenChat(chatMessages.length) }
  }, [chatMessages.length])
  useEffect(() => {
    if (chatOpen) setSeenChat(chatMessages.length)   // viewing the chat clears the badge
  }, [chatOpen, chatMessages.length])
  const chatUnread = !wideRail && !chatOpen && chatMessages.length > seenChat

  const active: HubNav = activeNavFromPath(pathname) ?? 'lobby'

  // ── Grid columns — mirrors Hub.tsx logic + collapsible dock column ──────────
  const showDock = wideRail && wideDock
  const dockCol = showDock ? (dockCollapsed ? '36px' : '340px') : ''
  let gridCols: string
  if (wideRail && wideDock)  gridCols = `92px 1fr ${dockCol}`
  else if (wideRail)         gridCols = '92px 1fr'
  else                       gridCols = '1fr'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        gridTemplateRows: 'minmax(0, 1fr)', // cap the single row at the shell height so inner overflow:auto engages (instead of the auto row growing to content height and getting clipped)
        height: '100dvh',
        // Ambient colour wash (from the mockup): magenta + cyan + gold radials spread across the whole
        // viewport so the background reads coloured, not black. The shell is 100dvh so it stays put.
        background: 'radial-gradient(900px 620px at 12% 0%,rgba(255,46,151,.28),transparent 62%),radial-gradient(840px 580px at 92% 4%,rgba(0,255,196,.18),transparent 60%),radial-gradient(820px 660px at 82% 56%,rgba(52,211,224,.17),transparent 62%),radial-gradient(900px 680px at 4% 92%,rgba(255,46,151,.22),transparent 62%),radial-gradient(760px 560px at 56% 116%,rgba(245,197,66,.11),transparent 62%),#0a0710',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ── LEFT RAIL (desktop/tablet) o BOTTOM NAV (móvil) ───────────────── */}
      {wideRail ? (
        <LeftRail active={active} onProfile={() => navigate('/profile')} />
      ) : (
        <BottomNav
          active={active}
          onNavigate={() => setChatOpen(false)}
          onChat={() => setChatOpen((o) => !o)}
          chatActive={chatOpen}
          chatUnread={chatUnread}
        />
      )}

      {/* ── COLUMNA PRINCIPAL ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        {/* Global topbar — brand + balance + auth + deposit + mute */}
        <header
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            rowGap: 8,
            gap: 14,
            padding: '12px 18px',
            borderBottom: `1px solid ${COLORS.border}`,
            background: 'transparent',
          }}
        >
          {/* Brand */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 9,
              fontFamily: FONTS.display,
              fontWeight: 700,
              fontSize: 19,
              letterSpacing: '-.01em',
            }}
          >
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: 4,
                background: GRADIENT,
                boxShadow: '0 0 10px #ff2e9788',
              }}
            />
            {wideRail && <span>Collector <span style={{ color: COLORS.green }}>Arena</span></span>}
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Radio — global player, lives above the router so audio survives navigation */}
          <RadioPlayer />

          {/* Balance + Gimmighouls — labelled groups on desktop; one divided box on mobile */}
          {authenticated && (wideRail ? (
            // Desktop: USDC + Gimmighouls in ONE pill — image left (full height) + label above number.
            <div style={{ display: 'flex', alignItems: 'stretch', background: '#11161f', border: `1px solid ${COLORS.border}`, borderRadius: 13, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 15px' }}>
                <img src="/usdc.svg" alt="" style={{ height: 20, width: 'auto', display: 'block' }} />
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.1 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: '.18em', color: COLORS.muted, paddingBottom: '1px' }}>USDC</span>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 15 }}>
                      {availableUsd(usdc, reserved) != null ? formatUsd(availableUsd(usdc, reserved)!) : '—'}
                    </span>
                    {locked != null && locked > 0 && (
                      <span style={{ fontSize: 9, color: COLORS.muted }}>· {formatUsd(locked)} reserved</span>
                    )}
                  </div>
                </div>
              </div>
              <span style={{ width: 1, background: COLORS.border }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: '6px 15px' }} title="Gimmighouls">
                <img src="/gimmighoul.png" alt="" style={{ height: 23, width: 'auto', display: 'block' }} />
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.1 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: '.18em', color: COLORS.muted, paddingBottom: '1px' }}>GIMMIGHOULS</span>
                  <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 15 }}>
                    {gimmighouls != null ? gimmighouls.toLocaleString() : '—'}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            // Mobile: USDC | Gimmighouls in one box, split by a vertical divider.
            <div style={{ display: 'flex', alignItems: 'stretch', background: '#11161f', border: `1px solid ${COLORS.border}`, borderRadius: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px' }}>
                <img src="/usdc.svg" alt="" width={17} height={17} style={{ display: 'block' }} />
                <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 13 }}>
                  {availableUsd(usdc, reserved) != null ? formatUsd(availableUsd(usdc, reserved)!) : '—'}
                </span>
              </div>
              <span style={{ width: 1, background: COLORS.border }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px' }} title="Gimmighouls">
                <img src="/gimmighoul.png" alt="" width={17} height={17} style={{ display: 'block' }} />
                <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 13 }}>
                  {gimmighouls != null ? fmtGh(gimmighouls) : '—'}
                </span>
              </div>
            </div>
          ))}

          {/* Deposit (before the account pill, as in the mockup) */}
          {authenticated && (
            <button
              onClick={() => setDepositOpen(true)}
              style={{
                background: GRADIENT,
                border: 'none',
                borderRadius: 10,
                padding: wideRail ? '9px 16px' : '7px 14px',
                color: '#06120c',
                fontWeight: 800,
                fontSize: wideRail ? 13 : 12,
                fontFamily: FONTS.display,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                boxShadow: '0 0 18px -6px rgba(0,255,196,.7)',
              }}
            >
              + Deposit
            </button>
          )}

          {/* Account pill */}
          <AuthButtons variant="compact" />

        </header>

        {/* Routed page content */}
        <main
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: !wideRail ? 72 : 0, // space for bottom nav on mobile
          }}
        >
          {/* Mobile: Live Drops strip at the top of the scroll (scrolls away on scroll down) */}
          {!wideRail && <LiveDropsStrip />}
          <Outlet />
        </main>
      </div>

      {/* ── CHAT DOCK (ancho completo — desktop) ──────────────────────────── */}
      {showDock && <ChatDock collapsed={dockCollapsed} onToggle={toggleDock} />}

      {/* ── FLOATING CHAT BUTTON (tablet only — mobile opens chat from the bottom nav) ── */}
      {wideRail && !wideDock && (
        <button
          onClick={() => setChatOpen((o) => !o)}
          title="Chat"
          style={{
            position: 'fixed',
            bottom: 24,
            right: 20,
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: GRADIENT,
            border: 'none',
            color: '#06120c',
            fontSize: 20,
            cursor: 'pointer',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 16px #ff2e9755',
          }}
        >
          💬
        </button>
      )}

      {/* ── DEPOSIT MODAL ─────────────────────────────────────────────────── */}
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />

      {/* ── TOASTS ────────────────────────────────────────────────────────── */}
      <Toaster />

      {/* ── CHAT — tablet: side drawer (full dock) · mobile: full-screen chat-only over the nav ── */}
      {chatOpen && !(wideRail && wideDock) && (wideRail ? (
        <>
          <div onClick={() => setChatOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 110 }} />
          <div style={{
            position: 'fixed', top: 0, right: 0, width: 'min(340px, 100vw)', height: '100vh', zIndex: 120, overflowY: 'auto',
            transition: reducedMotion ? 'none' : 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
          }}>
            <ChatDock />
          </div>
        </>
      ) : (
        // Mobile: chat only, full screen except the bottom nav.
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 60, zIndex: 120, background: '#0c1019', display: 'flex', flexDirection: 'column' }}>
          <ChatDock chatOnly />
        </div>
      ))}
    </div>
  )
}

// ─── Bottom navigation bar (móvil) — mirrors Hub.tsx BottomNav verbatim ──────
function BottomNav({
  active,
  onNavigate,
  onChat,
  chatActive,
  chatUnread,
}: {
  active: HubNav
  onNavigate: () => void
  onChat: () => void
  chatActive: boolean
  chatUnread: boolean
}) {
  const btn = {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 3,
    background: 'transparent', border: 'none', cursor: 'pointer',
    padding: '8px 6px', borderRadius: 10, fontFamily: FONTS.body, flex: '1 1 0', minWidth: 0,
  }
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 60,
        background: 'rgba(9,11,16,.94)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderTop: `1px solid ${COLORS.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 50,
        overflowX: 'auto',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = !chatActive && item.id === active
        return (
          <Link key={item.id} to={NAV_ROUTES[item.id]} onClick={onNavigate} title={item.label}
            style={{ ...btn, textDecoration: 'none', color: isActive ? COLORS.text : COLORS.muted }}>
            {NAV_ICONS[item.id]}
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.02em' }}>{item.label}</span>
          </Link>
        )
      })}
      {/* Chat lives in the nav on mobile (no floating button) */}
      <button onClick={onChat} title="Chat" style={{ ...btn, color: chatActive ? COLORS.text : COLORS.muted }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
          {chatUnread && (
            <span aria-label="Unread messages" style={{ position: 'absolute', top: -3, right: -4, width: 9, height: 9, borderRadius: '50%', background: COLORS.red, border: '2px solid rgba(9,11,16,.94)', boxShadow: `0 0 6px ${COLORS.red}` }} />
          )}
        </span>
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.02em' }}>Chat</span>
      </button>
    </nav>
  )
}
