import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { COLORS, GRADIENT, FONTS } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import type { HubNav } from './hubMockData'
import { STAKE_OPTIONS } from './hubMockData'
import { LeftRail } from './LeftRail'
import { QuickMatch } from './QuickMatch'
import { LiveBattles } from './LiveBattles'
import { ChatDock } from './ChatDock'

// ─── Responsive helper — copiado del patrón de BattleBoard ───────────────────
function useIsWide(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  const [wide, setWide] = useState<boolean>(get)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const handler = () => setWide(mql.matches)
    handler()
    mql.addEventListener?.('change', handler)
    return () => mql.removeEventListener?.('change', handler)
  }, [query])
  return wide
}

// ─── Items del bottom nav móvil (mismos que LeftRail) ────────────────────────
const NAV_ITEMS: { id: HubNav; icon: string; label: string }[] = [
  { id: 'lobby',  icon: '⌂',  label: 'Lobby'  },
  { id: 'pack',   icon: '⚔️', label: 'Pack'   },
  { id: 'royale', icon: '👑', label: 'Royale' },
  { id: 'gacha',  icon: '🎰', label: 'Gacha'  },
  { id: 'mana',   icon: '🎯', label: 'Mana'   },
  { id: 'ranks',  icon: '🏆', label: 'Ranks'  },
]

export function Hub() {
  const navigate = useNavigate()
  const [active, setActive]       = useState<HubNav>('lobby')
  const [stake, setStake]         = useState<number>(STAKE_OPTIONS[1]) // 50
  const [chatOpen, setChatOpen]   = useState(false)

  const reducedMotion = useReducedMotion()
  const wideDock = useIsWide('(min-width: 1100px)')
  const wideRail = useIsWide('(min-width: 760px)')

  /** Router centralizado de navegación */
  function go(id: HubNav) {
    switch (id) {
      case 'mana':   return navigate('/play/mana')
      case 'royale': return navigate('/play/royale')
      case 'pack':
      case 'gacha':  return navigate('/play/arena')
      default:       return setActive(id)
    }
  }

  // ── Columnas del grid ──────────────────────────────────────────────────────
  let gridCols: string
  if (wideRail && wideDock)  gridCols = '92px 1fr 340px'
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
        <LeftRail active={active} onSelect={go} />
      ) : (
        <BottomNav active={active} onSelect={go} />
      )}

      {/* ── COLUMNA PRINCIPAL ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Topbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '16px 26px',
            borderBottom: `1px solid ${COLORS.border}`,
            position: 'sticky',
            top: 0,
            background: COLORS.bg,
            zIndex: 10,
          }}
        >
          {/* Título + players online */}
          <div>
            <span
              style={{
                fontFamily: FONTS.display,
                fontWeight: 800,
                fontSize: 20,
                letterSpacing: '-0.01em',
                color: COLORS.text,
              }}
            >
              Lobby
            </span>
            <span
              style={{
                color: COLORS.muted,
                fontWeight: 500,
                fontSize: 13,
                marginLeft: 10,
              }}
            >
              · 18 players online
            </span>
          </div>

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Balance pill — EJEMPLO — no es un saldo real */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: '#11161f',
              border: `1px solid ${COLORS.border}`,
              borderRadius: 12,
              padding: '8px 15px',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 9,
                  color: COLORS.muted,
                  letterSpacing: '0.1em',
                  fontFamily: FONTS.mono,
                }}
              >
                BALANCE
              </div>
              <div
                style={{
                  fontFamily: FONTS.display,
                  fontWeight: 800,
                  fontSize: 15,
                  color: COLORS.text,
                }}
              >
                {/* EJEMPLO — no es un saldo real */}
                $128.40
              </div>
            </div>
          </div>

          {/* + Deposit (no funcional, Coming soon) */}
          <button
            onClick={() => {/* no-op */}}
            title="Coming soon"
            style={{
              background: GRADIENT,
              color: '#06120c',
              border: 'none',
              borderRadius: 12,
              padding: '11px 20px',
              fontWeight: 700,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: FONTS.display,
            }}
          >
            + Deposit
          </button>

          {/* Sound (inert) */}
          <button
            title="Sound"
            style={{
              background: 'transparent',
              border: `1px solid ${COLORS.border}`,
              color: COLORS.muted,
              borderRadius: 10,
              width: 38,
              height: 38,
              cursor: 'default',
              fontSize: 16,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            🔊
          </button>
        </div>

        {/* Scroll area */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 26px 40px',
            paddingBottom: !wideRail ? 72 : 40, // espacio para bottom nav móvil
          }}
        >
          <QuickMatch
            selectedStake={stake}
            onStake={setStake}
            onFindMatch={() => navigate('/play/arena')}
            onCreate={() => navigate('/play/arena')}
          />
          <LiveBattles
            onSelectMode={go}
            onBattleAction={() => navigate('/play/arena')}
          />
        </div>
      </div>

      {/* ── CHAT DOCK (ancho completo — desktop) ──────────────────────────── */}
      {wideRail && wideDock && <ChatDock />}

      {/* ── FLOATING CHAT BUTTON (tablet / móvil) ─────────────────────────── */}
      {!(wideRail && wideDock) && (
        <button
          onClick={() => setChatOpen((o) => !o)}
          title="Chat"
          style={{
            position: 'fixed',
            bottom: !wideRail ? 80 : 24, // encima del bottom nav en móvil
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

// ─── Bottom navigation bar (móvil) ───────────────────────────────────────────
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
