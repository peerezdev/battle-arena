import { useState, type ReactNode } from 'react'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import type { LiveBattle, BattleMode } from './hubMockData'

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
  )
}

const GACHA = <Svg><rect x="3" y="3" width="12" height="17" rx="1.2" /><path d="M3 9h12M3 15h12M7 9v6M11 9v6" /><path d="M5.5 5.5h7M5.5 7h7" /><path d="M15 11h2v3h-2" /><circle cx="19.5" cy="6" r="2" /><path d="M19.5 8v3" /></Svg>

// Pack/Royale/Mana modes are disabled for now — only Gacha remains as a mode entry.
type ModeTile = { mode: 'pack' | 'royale' | 'gacha' | 'mana'; icon: ReactNode; name: string; sub: string; accent: 'green' | 'purple' }
const MODE_TILES: ModeTile[] = [
  { mode: 'gacha',  icon: GACHA,  name: 'Gacha',          sub: 'Open packs · pull & play', accent: 'green' },
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
          const icoColor = green ? '#00ffc4' : '#ff6bb5'
          const icoBg = green ? 'rgba(0,255,196,.12)' : 'rgba(255,46,151,.14)'
          const icoBd = green ? 'rgba(0,255,196,.35)' : 'rgba(255,46,151,.4)'
          const cardBg = green
            ? 'linear-gradient(180deg,rgba(0,255,196,.06),rgba(255,255,255,.01))'
            : 'linear-gradient(180deg,rgba(255,46,151,.07),rgba(255,255,255,.01))'
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
            background: '#00ffc418',
            color: COLORS.green,
            border: '1px solid #00ffc433',
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
                  ? 'linear-gradient(90deg,#ff2e9733,#00ffc422)'
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
  const modeColor = purple ? '#ff6bb5' : '#00ffc4'
  const modeBg = purple ? 'rgba(255,46,151,.14)' : 'rgba(0,255,196,.12)'
  const modeBd = purple ? 'rgba(255,46,151,.4)' : 'rgba(0,255,196,.35)'
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
            style={{ background: GRADIENT, color: '#06120c', border: 'none', borderRadius: 11, padding: '9px 18px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer', boxShadow: '0 0 18px -6px rgba(0,255,196,.7)' }}>
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
