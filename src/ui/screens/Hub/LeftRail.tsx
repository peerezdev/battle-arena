import { COLORS, FONTS } from '../../theme'
import type { HubNav } from './hubMockData'

const ITEMS: { id: HubNav; icon: string; label: string }[] = [
  { id: 'lobby', icon: '⌂', label: 'Lobby' },
  { id: 'pack', icon: '⚔️', label: 'Pack' },
  { id: 'royale', icon: '👑', label: 'Royale' },
  { id: 'gacha', icon: '🎰', label: 'Gacha' },
  { id: 'mana', icon: '🎯', label: 'Mana' },
  { id: 'ranks', icon: '🏆', label: 'Ranks' },
]

export function LeftRail({ active, onSelect }: { active: HubNav; onSelect: (id: HubNav) => void }) {
  return (
    <nav
      style={{
        background: '#0c1019',
        borderRight: `1px solid ${COLORS.border}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '18px 0',
        gap: 6,
        height: '100vh',
      }}
    >
      {/* Logo dot */}
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          background: 'linear-gradient(135deg,#9945FF,#14F195)',
          boxShadow: '0 0 18px #9945FF55',
          marginBottom: 18,
          flexShrink: 0,
        }}
      />

      {/* Nav items */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 4,
          width: '100%',
        }}
      >
        {ITEMS.map((item) => {
          const isActive = item.id === active
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              style={{
                width: 64,
                padding: '11px 0',
                borderRadius: 13,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                cursor: 'pointer',
                color: isActive ? COLORS.text : COLORS.muted,
                background: isActive
                  ? 'linear-gradient(160deg,#9945FF26,#14F19514)'
                  : 'transparent',
                border: 'none',
                position: 'relative',
                transition: 'color .12s, background .12s',
                fontFamily: FONTS.body,
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  ;(e.currentTarget as HTMLButtonElement).style.background = '#ffffff08'
                  ;(e.currentTarget as HTMLButtonElement).style.color = COLORS.text
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
                  ;(e.currentTarget as HTMLButtonElement).style.color = COLORS.muted
                }
              }}
              title={item.label}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 14,
                    bottom: 14,
                    width: 3,
                    borderRadius: 3,
                    background: 'linear-gradient(#9945FF,#14F195)',
                  }}
                />
              )}
              <span style={{ fontSize: 19 }}>{item.icon}</span>
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  fontFamily: FONTS.body,
                }}
              >
                {item.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Bottom utility buttons */}
      <button
        style={{
          width: 64,
          padding: '11px 0',
          borderRadius: 13,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          color: COLORS.muted,
          background: 'transparent',
          border: 'none',
          transition: 'color .12s, background .12s',
        }}
        title="Settings"
      >
        <span style={{ fontSize: 19 }}>⚙</span>
      </button>
      <button
        style={{
          width: 64,
          padding: '11px 0',
          borderRadius: 13,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 5,
          cursor: 'pointer',
          color: COLORS.muted,
          background: 'transparent',
          border: 'none',
          transition: 'color .12s, background .12s',
        }}
        title="Profile"
      >
        <span style={{ fontSize: 19 }}>🧙</span>
      </button>
    </nav>
  )
}
