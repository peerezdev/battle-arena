import { useState, type ReactNode } from 'react'
import { COLORS, FONTS, GRADIENT } from '../../theme'
import type { HubNav } from './hubMockData'

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: 'relative' }}>
      {children}
    </svg>
  )
}

export const NAV_ICONS: Record<HubNav, ReactNode> = {
  lobby: <Svg><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M9 22V12h6v10" /></Svg>,
  pack: <Svg><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" x2="19" y1="19" y2="13" /><line x1="16" x2="20" y1="16" y2="20" /><line x1="19" x2="21" y1="21" y2="19" /><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" /><line x1="5" x2="9" y1="14" y2="18" /><line x1="7" x2="4" y1="17" y2="20" /><line x1="3" x2="5" y1="19" y2="21" /></Svg>,
  royale: <Svg><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></Svg>,
  gacha: <Svg><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" /></Svg>,
  mana: <Svg><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Svg>,
  ranks: <Svg><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></Svg>,
}

const ITEMS: { id: HubNav; label: string }[] = [
  { id: 'lobby', label: 'Lobby' },
  { id: 'pack', label: 'Pack' },
  { id: 'royale', label: 'Royale' },
  { id: 'gacha', label: 'Gacha' },
  { id: 'mana', label: 'Mana' },
  { id: 'ranks', label: 'Ranks' },
]

export function LeftRail({ active, onSelect, onProfile }: { active: HubNav; onSelect: (id: HubNav) => void; onProfile?: () => void }) {
  const [hovered, setHovered] = useState<HubNav | null>(null)
  return (
    <nav
      style={{
        background: 'linear-gradient(180deg,rgba(255,255,255,.02),transparent)',
        borderRight: `1px solid ${COLORS.border}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '18px 0 14px',
        gap: 6,
        height: '100vh',
      }}
    >
      {/* Logo dot */}
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          background: GRADIENT,
          boxShadow: '0 0 26px -4px rgba(47,226,138,.6),inset 0 1px 0 rgba(255,255,255,.4)',
          marginBottom: 16,
          flexShrink: 0,
        }}
      />

      {/* Nav items */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: '100%' }}>
        {ITEMS.map((item) => {
          const isActive = item.id === active
          const isHover = !isActive && hovered === item.id
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              title={item.label}
              onMouseEnter={() => setHovered(item.id)}
              onMouseLeave={() => setHovered((h) => (h === item.id ? null : h))}
              style={{
                position: 'relative',
                width: 62,
                padding: '11px 0',
                borderRadius: 14,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                color: isActive || isHover ? COLORS.text : COLORS.muted,
                background: isHover ? '#ffffff0a' : 'transparent',
                border: 'none',
                transition: 'color .12s, background .12s',
                fontFamily: FONTS.body,
              }}
            >
              {isActive && (
                <span
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: 14,
                    background: 'linear-gradient(180deg,rgba(47,226,138,.18),rgba(47,226,138,.05))',
                    border: '1px solid rgba(47,226,138,.45)',
                    boxShadow: '0 0 22px -6px rgba(47,226,138,.7)',
                  }}
                />
              )}
              {NAV_ICONS[item.id]}
              <span style={{ position: 'relative', fontSize: 11, fontWeight: 500, letterSpacing: '.02em' }}>
                {item.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Settings */}
      <button
        style={{
          width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: 'none', background: 'transparent', color: COLORS.muted, cursor: 'pointer', borderRadius: 12,
        }}
        title="Settings"
      >
        <Svg><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></Svg>
      </button>

      {/* Profile avatar */}
      <button
        onClick={onProfile}
        title="Profile"
        style={{
          width: 38, height: 38, marginTop: 4, borderRadius: '50%', cursor: 'pointer',
          background: 'linear-gradient(135deg,#f5c542,#e8732c)',
          border: '2px solid rgba(255,255,255,.12)',
        }}
      />
    </nav>
  )
}
