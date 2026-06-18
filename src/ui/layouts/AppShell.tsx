import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import { COLORS, GRADIENT, FONTS, formatUsd } from '../theme'
import { useUsdcBalance } from '../../wallet/useUsdcBalance'
import { useReducedMotion } from '../useReducedMotion'
import { useIsWide } from '../useIsWide'
import { AuthButtons } from '../components/AuthButtons'
import { DepositModal } from '../components/DepositModal'
import { LeftRail } from '../screens/Hub/LeftRail'
import { ChatDock } from '../screens/Hub/ChatDock'
import { NAV_ITEMS, type HubNav } from '../screens/Hub/hubMockData'
import { NAV_ROUTES, activeNavFromPath } from './navRoutes'

const DOCK_KEY = 'ba.dockCollapsed'

export function AppShell() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const reducedMotion = useReducedMotion()
  const { usdc } = useUsdcBalance()
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

  const active: HubNav = activeNavFromPath(pathname) ?? 'lobby'
  const onSelect = (id: HubNav) => navigate(NAV_ROUTES[id])

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
        height: '100vh',
        background: COLORS.bg,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* ── LEFT RAIL (desktop/tablet) o BOTTOM NAV (móvil) ───────────────── */}
      {wideRail ? (
        <LeftRail active={active} onSelect={onSelect} onProfile={() => navigate('/profile')} />
      ) : (
        <BottomNav active={active} onSelect={onSelect} />
      )}

      {/* ── COLUMNA PRINCIPAL ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Global topbar — brand + balance + auth + deposit + mute */}
        <header
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '10px 18px',
            borderBottom: `1px solid ${COLORS.border}`,
            background: '#0c1019',
          }}
        >
          {/* Brand */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: '-.01em',
            }}
          >
            <span
              style={{
                width: 13,
                height: 13,
                borderRadius: 4,
                background: GRADIENT,
                boxShadow: '0 0 10px #9945FF88',
              }}
            />
            BattleArena
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Balance + Deposit — solo con sesión */}
          {authenticated && (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: '#11161f',
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 11,
                  padding: '7px 13px',
                }}
              >
                <span style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '.1em' }}>BALANCE</span>
                <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14 }}>
                  {usdc != null ? formatUsd(usdc) : '—'}
                </span>
              </div>
            </>
          )}

          {/* Auth buttons */}
          <AuthButtons variant="compact" />

          {authenticated && (
            <button
              onClick={() => setDepositOpen(true)}
              style={{
                background: GRADIENT,
                border: 'none',
                borderRadius: 10,
                padding: '7px 14px',
                color: '#06120c',
                fontWeight: 700,
                fontSize: 12,
                fontFamily: FONTS.display,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              + Deposit
            </button>
          )}

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
          <Outlet />
        </main>
      </div>

      {/* ── CHAT DOCK (ancho completo — desktop) ──────────────────────────── */}
      {showDock && <ChatDock collapsed={dockCollapsed} onToggle={toggleDock} />}

      {/* ── FLOATING CHAT BUTTON (tablet / móvil) ─────────────────────────── */}
      {!(wideRail && wideDock) && (
        <button
          onClick={() => setChatOpen((o) => !o)}
          title="Chat"
          style={{
            position: 'fixed',
            bottom: !wideRail ? 80 : 24, // above bottom nav on mobile
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
            boxShadow: '0 4px 16px #9945FF55',
          }}
        >
          💬
        </button>
      )}

      {/* ── DEPOSIT MODAL ─────────────────────────────────────────────────── */}
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />

      {/* ── CHAT DRAWER OVERLAY (tablet / móvil) ──────────────────────────── */}
      {!(wideRail && wideDock) && chatOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setChatOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.55)',
              zIndex: 110,
            }}
          />
          {/* Drawer */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              right: 0,
              width: 340,
              height: '100vh',
              zIndex: 120,
              transform: reducedMotion ? 'none' : 'translateX(0)',
              transition: reducedMotion ? 'none' : 'transform 0.22s cubic-bezier(0.4,0,0.2,1)',
              overflowY: 'auto',
            }}
          >
            <ChatDock />
          </div>
        </>
      )}
    </div>
  )
}

// ─── Bottom navigation bar (móvil) — mirrors Hub.tsx BottomNav verbatim ──────
function BottomNav({
  active,
  onSelect,
}: {
  active: HubNav
  onSelect: (id: HubNav) => void
}) {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        height: 60,
        background: '#0c1019',
        borderTop: `1px solid ${COLORS.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-around',
        zIndex: 50,
      }}
    >
      {NAV_ITEMS.map((item) => {
        const isActive = item.id === active
        return (
          <button
            key={item.id}
            onClick={() => onSelect(item.id)}
            title={item.label}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3,
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: isActive ? COLORS.text : COLORS.muted,
              padding: '8px 10px',
              borderRadius: 10,
              fontFamily: FONTS.body,
            }}
          >
            <span style={{ fontSize: 18 }}>{item.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.02em' }}>
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
