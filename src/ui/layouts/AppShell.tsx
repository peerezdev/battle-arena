import { useState, useEffect, useRef } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { COLORS, GRADIENT, FONTS, formatUsd } from '../theme'
import { useUsdcBalance } from '../../wallet/useUsdcBalance'
import { useReservedBalance, availableUsd } from '../../wallet/useReservedBalance'
import { useProfile } from '../../hooks/useProfile'
import { useReducedMotion } from '../useReducedMotion'
import { useIsWide } from '../useIsWide'
import { AuthButtons } from '../components/AuthButtons'
import { RadioPlayer } from '../components/RadioPlayer'
import { MobileRadioBar } from '../components/MobileRadioBar'
import { useRadio } from '../radio/useRadio'
import { DepositModal } from '../components/DepositModal'
import { LeftRail, NAV_ICONS } from '../screens/Hub/LeftRail'
import { ChatDock } from '../screens/Hub/ChatDock'
import { useChat } from '../../hooks/useChat'
import { RematchToastHost } from '../components/RematchToast'
import { OnboardingTutorial } from '../components/OnboardingTutorial'
import { NAV_ITEMS, type HubNav } from '../screens/Hub/hubMockData'
import { NAV_ROUTES, activeNavFromPath } from './navRoutes'
import { Toaster } from '../toast'

const DOCK_KEY = 'ba.dockCollapsed'
const ONBOARD_KEY = 'ba.onboarded'   // set once the first-visit tutorial is finished/skipped

// Compact Gimmighoul count for the tight mobile header (262,500,000 → 262.5M).
function fmtGh(n: number): string {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}k`
  return String(n)
}

export function AppShell() {
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

  // Radio is a singleton store — subscribing here only tells us whether the
  // mobile mini-player (bottom stack) will render, to size the content padding.
  const { tracks: radioTracks, collapsed: radioCollapsed } = useRadio()
  const mobileRadio = !wideRail && radioTracks.length > 0
  // When the mini-player is collapsed only the floating re-open button shows, so
  // the content only needs to clear the nav (not the full radio bar).
  const mobileRadioBar = mobileRadio && !radioCollapsed

  // First-visit onboarding — show the guided tour once per browser.
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    try { return localStorage.getItem(ONBOARD_KEY) !== '1' } catch { return false }
  })
  function dismissOnboarding() {
    try { localStorage.setItem(ONBOARD_KEY, '1') } catch { /* ignore */ }
    setShowOnboarding(false)
  }

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
  const dockCol = showDock ? (dockCollapsed ? '36px' : '320px') : ''
  let gridCols: string
  if (wideRail && wideDock)  gridCols = `92px 1fr ${dockCol}`
  else if (wideRail)         gridCols = '92px 1fr'
  else                       gridCols = '1fr'

  // ── Grid placement — the topbar (row 1) spans the full content width so it sits
  //    over the dock and pushes Recent Drops (row 2) down. Rail spans both rows.
  const contentStart = wideRail ? 2 : 1
  const totalCols = showDock ? 3 : (wideRail ? 2 : 1)
  const headerColumn = `${contentStart} / ${totalCols + 1}`
  const contentColumn = `${contentStart} / ${contentStart + 1}`

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        gridTemplateRows: 'auto minmax(0, 1fr)', // row 1 = full-width topbar, row 2 = content + dock (capped so inner overflow:auto engages)
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
        <div style={{ gridColumn: '1 / 2', gridRow: '1 / 3', minHeight: 0 }}>
          <LeftRail active={active} />
        </div>
      ) : (
        // Mobile bottom stack: radio mini-player floating above the tab bar.
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 50 }}>
          <MobileRadioBar />
          <BottomNav
            active={active}
            onNavigate={() => setChatOpen(false)}
            onChat={() => setChatOpen((o) => !o)}
            chatActive={chatOpen}
            chatUnread={chatUnread}
          />
        </div>
      )}

        {/* Global topbar (row 1) — spans the full content width, over the dock, so Recent Drops sits below it */}
        <header
          style={{
            gridColumn: headerColumn,
            gridRow: '1 / 2',
            // Topbar sits above page content so its dropdowns (profile menu, radio) overflow ON TOP.
            // Grid siblings paint in DOM order, and <main> comes after — without this the menu
            // renders under the content. Kept below the chat drawer / modals (z ≥ 100).
            position: 'relative',
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            rowGap: 8,
            gap: wideRail ? 14 : 10,
            padding: wideRail ? '12px 18px' : '12px 14px',
            borderBottom: '1px solid rgba(255,255,255,.07)',
            background: wideRail ? 'transparent' : 'rgba(8,10,14,.9)',
            backdropFilter: wideRail ? undefined : 'blur(14px)',
            WebkitBackdropFilter: wideRail ? undefined : 'blur(14px)',
          }}
        >
          {/* Brand — "Collector Arena" wordmark on desktop; logo dot on mobile (no rail there) */}
          {wideRail ? (
            <span style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 19, letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>
              Collector <span style={{ color: COLORS.green }}>Arena</span>
            </span>
          ) : (
            <img
              src="/logo-rail.png"
              alt="Collector Arena"
              width={32}
              height={32}
              style={{ flex: 'none', objectFit: 'contain', display: 'block' }}
            />
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Radio — global player in the header on desktop; on mobile it lives in the
              bottom stack (MobileRadioBar). The store is a singleton, so audio survives
              navigation and breakpoint changes either way. */}
          {wideRail && <RadioPlayer />}

          {/* Balance + Gimmighouls — labelled groups on desktop; one divided box on mobile */}
          {authenticated && (wideRail ? (
            // Desktop: USDC + Gimmighouls in ONE pill — image left (full height) + label above number.
            <div style={{ display: 'flex', alignItems: 'stretch', background: '#11161f', border: `1px solid ${COLORS.border}`, borderRadius: 13, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 15px' }}>
                <img src="/usdc.svg" alt="" style={{ height: 20, width: 'auto', display: 'block' }} />
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.1 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, fontWeight: 700, letterSpacing: '.18em', color: COLORS.muted, paddingBottom: '1px' }}>USDC</span>
                  <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 15 }}>
                    {availableUsd(usdc, reserved) != null ? formatUsd(availableUsd(usdc, reserved)!) : '—'}
                  </span>
                  {locked != null && locked > 0 && (
                    <span style={{ fontSize: 9, color: COLORS.muted }}>{formatUsd(locked)} reserved</span>
                  )}
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
            // Mobile: one pill — USDC | Gimmighouls | compact "+" deposit square.
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 6px 6px 12px', borderRadius: 11, background: 'rgba(255,255,255,.05)', border: `1px solid ${COLORS.border}` }}>
              <img src="/usdc.svg" alt="" width={15} height={15} style={{ display: 'block' }} />
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                {availableUsd(usdc, reserved) != null ? formatUsd(availableUsd(usdc, reserved)!) : '—'}
              </span>
              <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,.12)' }} />
              <img src="/gimmighoul.png" alt="" title="Gimmighouls" width={15} height={15} style={{ display: 'block' }} />
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                {gimmighouls != null ? fmtGh(gimmighouls) : '—'}
              </span>
              <button
                onClick={() => setDepositOpen(true)}
                title="Deposit"
                aria-label="Deposit"
                style={{ width: 26, height: 26, borderRadius: 8, border: 0, cursor: 'pointer', fontSize: 15, fontWeight: 700, color: '#06170f', background: 'linear-gradient(135deg,#3df0a0,#13c98a)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              >
                +
              </button>
            </div>
          ))}

          {/* Deposit (desktop — mobile has the compact "+" inside the balance pill) */}
          {authenticated && wideRail && (
            <button
              onClick={() => setDepositOpen(true)}
              style={{
                background: GRADIENT,
                border: 'none',
                borderRadius: 10,
                padding: '9px 16px',
                color: '#06120c',
                fontWeight: 800,
                fontSize: 13,
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

        {/* Routed page content (row 2, content column) */}
        <main
          style={{
            gridColumn: contentColumn,
            gridRow: '2 / 3',
            minWidth: 0,
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            paddingBottom: wideRail ? 0 : mobileRadioBar ? 128 : 72, // space for the mobile bottom stack (nav + optional radio bar)
          }}
        >
          {/* Mobile: Live Drops strip at the top of the scroll (scrolls away on scroll down) */}
          {/* Recent Drops strip removed from all screens (component kept: LiveDropsStrip.tsx).
              To restore on mobile: import it and render `{!wideRail && <LiveDropsStrip />}` here. */}
          <Outlet />
        </main>

      {/* ── CHAT DOCK (row 2, right column — desktop) ─────────────────────── */}
      {showDock && (
        <div style={{ gridColumn: '3 / 4', gridRow: '2 / 3', minHeight: 0 }}>
          <ChatDock collapsed={dockCollapsed} onToggle={toggleDock} />
        </div>
      )}

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
      {/* Los toasts van abajo, por encima de la pila móvil (nav + barra de radio si está) y
          dejando hueco al RematchToast, que vive en bottom 28/84 con z-index menor. */}
      <Toaster bottomOffset={wideRail ? 24 : mobileRadioBar ? 148 : 92} />
      <RematchToastHost />   {/* app-wide rematch challenge toast (bottom-centre) */}

      {/* ── ONBOARDING — first-visit guided tour ──────────────────────────── */}
      {showOnboarding && <OnboardingTutorial onClose={dismissOnboarding} reducedMotion={reducedMotion} />}

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
  const INACTIVE = '#5c6675'
  const btn = {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 3,
    background: 'transparent', border: 'none', cursor: 'pointer',
    padding: 0, fontFamily: FONTS.body, flex: '1 1 0', minWidth: 0, lineHeight: 1.5,
  }
  return (
    <nav
      style={{
        background: 'rgba(8,10,14,.95)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderTop: '1px solid rgba(255,255,255,.07)',
        display: 'flex',
        alignItems: 'center',
        padding: '9px 2px 12px',
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = !chatActive && item.id === active
        const color = isActive ? COLORS.green : INACTIVE
        return (
          <Link key={item.id} to={NAV_ROUTES[item.id]} onClick={onNavigate} title={item.label}
            style={{ ...btn, textDecoration: 'none', color }}>
            {NAV_ICONS[item.id]}
            <span style={{ fontSize: 9.5, fontWeight: isActive ? 600 : 400 }}>{item.label}</span>
          </Link>
        )
      })}
      {/* Chat lives in the nav on mobile (no floating button) */}
      <button onClick={onChat} title="Chat" style={{ ...btn, color: chatActive ? COLORS.green : INACTIVE }}>
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
          {chatUnread && (
            <span aria-label="Unread messages" style={{ position: 'absolute', top: -3, right: -4, width: 9, height: 9, borderRadius: '50%', background: COLORS.red, border: '2px solid rgba(8,10,14,.95)', boxShadow: `0 0 6px ${COLORS.red}` }} />
          )}
        </span>
        <span style={{ fontSize: 9.5, fontWeight: chatActive ? 600 : 400 }}>Chat</span>
      </button>
    </nav>
  )
}
