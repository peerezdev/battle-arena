import { useState, type ReactNode } from 'react'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import type { LiveBattle, BattleMode } from './hubMockData'

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  )
}

const SWORDS = <Svg><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" x2="19" y1="19" y2="13" /><line x1="16" x2="20" y1="16" y2="20" /><line x1="19" x2="21" y1="21" y2="19" /><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5" /><line x1="5" x2="9" y1="14" y2="18" /><line x1="7" x2="4" y1="17" y2="20" /><line x1="3" x2="5" y1="19" y2="21" /></Svg>
const CROWN = <Svg><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></Svg>
const GACHA = <Svg><rect x="3" y="3" width="12" height="17" rx="1.2" /><path d="M3 9h12M3 15h12M7 9v6M11 9v6" /><path d="M5.5 5.5h7M5.5 7h7" /><path d="M15 11h2v3h-2" /><circle cx="19.5" cy="6" r="2" /><path d="M19.5 8v3" /></Svg>
const TARGET = <Svg><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></Svg>

type ModeTile = { mode: 'pack' | 'royale' | 'gacha' | 'mana'; icon: ReactNode; name: string; sub: string; accent: 'green' | 'purple' }
const MODE_TILES: ModeTile[] = [
  { mode: 'pack',   icon: SWORDS, name: 'Pack Battle',   sub: '1v1 · winner takes both',  accent: 'green' },
  { mode: 'royale', icon: CROWN,  name: 'Battle Royale',  sub: '2–10 · last one wins',     accent: 'purple' },
  { mode: 'gacha',  icon: GACHA,  name: 'Gacha',          sub: 'Open packs · pull & play', accent: 'green' },
  { mode: 'mana',   icon: TARGET, name: 'Mana Duel',      sub: 'Skill · value = edge',     accent: 'purple' },
]

const MODE_LABEL: Record<BattleMode, string> = {
  pack:   'PACK BATTLE',
  royale: 'BATTLE ROYALE',
  mana:   'MANA DUEL',
}

const FILTERS = ['All', 'Ready to join', 'Mine', 'Recent']

interface Props {
  battles: LiveBattle[]
  onSelectMode: (mode: 'pack' | 'royale' | 'gacha' | 'mana') => void
  onBattleAction: (b: LiveBattle) => void
  onCancel?: (b: LiveBattle) => void
  onOpen: (b: LiveBattle) => void
}

export function LiveBattles({ battles, onSelectMode, onBattleAction, onCancel, onOpen }: Props) {
  const [activeFilter, setActiveFilter] = useState(0)

  return (
    <div>
      {/* (a) Mode strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 12,
          marginBottom: 28,
        }}
      >
        {MODE_TILES.map((tile) => {
          const green = tile.accent === 'green'
          const icoColor = green ? '#2fe28a' : '#a98bff'
          const icoBg = green ? 'rgba(47,226,138,.12)' : 'rgba(139,92,246,.14)'
          const icoBd = green ? 'rgba(47,226,138,.35)' : 'rgba(139,92,246,.4)'
          const cardBg = green
            ? 'linear-gradient(180deg,rgba(47,226,138,.06),rgba(255,255,255,.01))'
            : 'linear-gradient(180deg,rgba(139,92,246,.07),rgba(255,255,255,.01))'
          return (
          <button
            key={tile.mode}
            onClick={() => onSelectMode(tile.mode)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              background: cardBg,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 18,
              padding: 18,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'border-color 0.12s, transform 0.12s',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = icoBd
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-4px)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.border
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'
            }}
          >
            {/* icon badge */}
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: 13,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: icoColor,
                background: icoBg,
                border: `1px solid ${icoBd}`,
                boxShadow: `0 0 22px -8px ${icoColor}`,
                flexShrink: 0,
              }}
            >
              {tile.icon}
            </div>
            <div>
              <div
                style={{
                  fontFamily: FONTS.display,
                  fontSize: 16,
                  fontWeight: 700,
                  color: COLORS.text,
                }}
              >
                {tile.name}
              </div>
              <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
                {tile.sub}
              </div>
            </div>
          </button>
          )
        })}
      </div>

      {/* (b) Live battles header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
          flexWrap: 'wrap',
          rowGap: 8,
        }}
      >
        <span
          style={{
            fontFamily: FONTS.display,
            fontWeight: 800,
            fontSize: 17,
            color: COLORS.text,
          }}
        >
          Live games
        </span>
        <span
          style={{
            background: '#2fe28a18',
            color: COLORS.green,
            border: '1px solid #2fe28a33',
            borderRadius: 20,
            fontFamily: FONTS.mono,
            fontSize: 11,
            padding: '2px 10px',
          }}
        >
          {battles.length} live
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              color: COLORS.muted,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 9,
              padding: '7px 12px',
              cursor: 'pointer',
            }}
          >
            All games ▾
          </span>
          <span
            style={{
              fontSize: 11,
              color: COLORS.muted,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 9,
              padding: '7px 12px',
              cursor: 'pointer',
            }}
          >
            Newest ▾
          </span>
        </div>
      </div>

      {/* (c) Segmented control */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          background: '#0c1019',
          border: `1px solid ${COLORS.border}`,
          borderRadius: 11,
          padding: 4,
          marginBottom: 16,
          width: 'fit-content',
        }}
      >
        {FILTERS.map((f, i) => (
          <span
            key={f}
            onClick={() => setActiveFilter(i)}
            style={{
              fontSize: 12,
              color: activeFilter === i ? COLORS.text : COLORS.muted,
              padding: '7px 14px',
              borderRadius: 8,
              cursor: 'pointer',
              background:
                activeFilter === i
                  ? 'linear-gradient(90deg,#8b5cf633,#2fe28a22)'
                  : 'transparent',
            }}
          >
            {f}
          </span>
        ))}
      </div>

      {/* (d) Battle cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
        {battles.map((b) => (
          <BattleCard key={b.id} battle={b} onAction={onBattleAction} onCancel={onCancel} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

function BattleCard({ battle: b, onAction, onCancel, onOpen }: { battle: LiveBattle; onAction: (b: LiveBattle) => void; onCancel?: (b: LiveBattle) => void; onOpen: (b: LiveBattle) => void }) {
  const purple = b.mode === 'royale' || b.mode === 'mana'
  const modeColor = purple ? '#a98bff' : '#2fe28a'
  const modeBg = purple ? 'rgba(139,92,246,.14)' : 'rgba(47,226,138,.12)'
  const modeBd = purple ? 'rgba(139,92,246,.4)' : 'rgba(47,226,138,.35)'
  return (
    <div
      onClick={() => onOpen(b)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 18,
        padding: 18,
        background: 'linear-gradient(180deg,rgba(255,255,255,.035),rgba(255,255,255,.012))',
        border: `1px solid ${COLORS.border}`,
        cursor: 'pointer',
        transition: 'border-color 0.12s, transform 0.12s',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.borderColor = '#ffffff22'
        ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.borderColor = COLORS.border
        ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
      }}
    >
      {/* mode badge + status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, padding: '5px 11px', borderRadius: 8,
          fontFamily: FONTS.mono, fontSize: 11.5, fontWeight: 500,
          color: modeColor, background: modeBg, border: `1px solid ${modeBd}`,
        }}>
          {MODE_LABEL[b.mode]}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: b.statusColor }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: b.statusColor, boxShadow: `0 0 6px ${b.statusColor}` }} />
          {b.statusText}
        </span>
      </div>

      {/* pot + entry */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: '.04em', marginBottom: 3 }}>EST. POT</div>
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 28, letterSpacing: '-.02em', color: COLORS.text }}>
            {formatUsd(b.pot)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: COLORS.muted, letterSpacing: '.04em', marginBottom: 3 }}>{b.costLabel}</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.muted }}>{formatUsd(b.entry)}</div>
        </div>
      </div>

      {/* players + action */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PlayerAvatars players={b.players} extra={b.extra} />
          <span style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>{b.slots}</span>
        </div>

        {b.action === 'watch' ? (
          <button onClick={(e) => { e.stopPropagation(); onAction(b) }}
            style={{ border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.text, borderRadius: 11, padding: '9px 18px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer' }}>
            Watch
          </button>
        ) : b.canCancel && onCancel ? (
          <button onClick={(e) => { e.stopPropagation(); onCancel(b) }}
            style={{ border: `1px solid ${COLORS.red}55`, background: 'transparent', color: COLORS.red, borderRadius: 11, padding: '9px 16px', fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
            Cancel
          </button>
        ) : b.alreadyJoined ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted }}>You're in</span>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); onAction(b) }}
            style={{ background: GRADIENT, color: '#06120c', border: 'none', borderRadius: 11, padding: '9px 18px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', boxShadow: '0 0 18px -6px rgba(47,226,138,.7)' }}>
            Join
          </button>
        )}
      </div>
    </div>
  )
}

function PlayerAvatars({
  players,
  extra,
}: {
  players: { violet: boolean }[]
  extra?: string
}) {
  const hasVS = players.length === 2

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: hasVS ? 9 : 0 }}>
      {players.map((p, i) => (
        <div
          key={i}
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            border: `2px solid ${p.violet ? COLORS.violet : COLORS.green}`,
            background: p.violet ? '#1a1430' : '#0f2018',
            marginLeft: !hasVS && i > 0 ? -13 : 0,
          }}
        />
      ))}
      {extra && (
        <span
          style={{
            fontFamily: FONTS.display,
            fontWeight: 800,
            color: COLORS.muted,
            fontSize: 11,
            marginLeft: 5,
          }}
        >
          {extra}
        </span>
      )}
      {hasVS && (
        <span
          style={{
            fontFamily: FONTS.display,
            fontWeight: 800,
            color: COLORS.muted,
            fontSize: 11,
          }}
        >
          VS
        </span>
      )}
    </div>
  )
}
