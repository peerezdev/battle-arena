import { useState } from 'react'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { MOCK_BATTLES, type LiveBattle, type BattleMode } from './hubMockData'

type ModeTile = { mode: 'pack' | 'royale' | 'gacha' | 'mana'; icon: string; name: string; sub: string }
const MODE_TILES: ModeTile[] = [
  { mode: 'pack',   icon: '⚔️', name: 'Pack Battle',   sub: '1v1 · winner takes both' },
  { mode: 'royale', icon: '👑', name: 'Battle Royale',  sub: '2–10 · last one wins' },
  { mode: 'gacha',  icon: '🎰', name: 'Gacha',          sub: 'Open packs · pull & play' },
  { mode: 'mana',   icon: '🎯', name: 'Mana Duel',      sub: 'Skill · value = edge' },
]

const MODE_LABEL: Record<BattleMode, string> = {
  pack:   'PACK BATTLE',
  royale: 'ROYALE',
  mana:   'MANA DUEL',
}

const FILTERS = ['All', 'Ready to join', 'Mine', 'Recent']

interface Props {
  battles?: LiveBattle[]
  onSelectMode: (mode: 'pack' | 'royale' | 'gacha' | 'mana') => void
  onBattleAction: (b: LiveBattle) => void
}

export function LiveBattles({ battles = MOCK_BATTLES, onSelectMode, onBattleAction }: Props) {
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
        {MODE_TILES.map((tile) => (
          <button
            key={tile.mode}
            onClick={() => onSelectMode(tile.mode)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 14,
              padding: '14px 16px',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'border-color 0.12s, transform 0.12s',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#9945FF44'
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLButtonElement).style.borderColor = COLORS.border
              ;(e.currentTarget as HTMLButtonElement).style.transform = 'translateY(0)'
            }}
          >
            {/* icon box */}
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 11,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 19,
                background: '#0c1019',
                border: `1px solid ${COLORS.border}`,
                flexShrink: 0,
              }}
            >
              {tile.icon}
            </div>
            <div>
              <div
                style={{
                  fontFamily: FONTS.display,
                  fontSize: 13.5,
                  fontWeight: 700,
                  color: COLORS.text,
                }}
              >
                {tile.name}
              </div>
              <div style={{ fontSize: 10, color: COLORS.muted, marginTop: 1 }}>
                {tile.sub}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* (b) Live battles header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
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
          Live battles
        </span>
        <span
          style={{
            background: '#14F19518',
            color: COLORS.green,
            border: '1px solid #14F19533',
            borderRadius: 20,
            fontFamily: FONTS.mono,
            fontSize: 11,
            padding: '2px 10px',
          }}
        >
          {battles.filter((b) => b.live).length} live
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
                  ? 'linear-gradient(90deg,#9945FF33,#14F19522)'
                  : 'transparent',
            }}
          >
            {f}
          </span>
        ))}
      </div>

      {/* (d) Battle rows */}
      {battles.map((b) => (
        <BattleRow key={b.id} battle={b} onAction={onBattleAction} />
      ))}
    </div>
  )
}

function BattleRow({ battle: b, onAction }: { battle: LiveBattle; onAction: (b: LiveBattle) => void }) {
  return (
    <div
      style={{
        background: b.live
          ? `linear-gradient(90deg,#14F1950c,${COLORS.panel} 40%)`
          : COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 16,
        padding: '16px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 20,
        marginBottom: 12,
        transition: 'border-color 0.12s',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.borderColor = '#ffffff22'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLDivElement).style.borderColor = COLORS.border
      }}
    >
      {/* Mode + title */}
      <div style={{ minWidth: 140, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 10.5,
            fontWeight: 700,
            color: '#b78cff',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {MODE_LABEL[b.mode]}
          {b.live && (
            <span
              style={{
                fontSize: 8.5,
                color: COLORS.green,
                border: '1px solid #14F19544',
                borderRadius: 5,
                padding: '1px 6px',
                letterSpacing: '0.05em',
              }}
            >
              LIVE
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.text }}>{b.title}</div>
        <div style={{ fontSize: 10, color: COLORS.muted }}>{b.sub}</div>
      </div>

      {/* Players */}
      <PlayerAvatars players={b.players} extra={b.extra} />

      {/* Cards */}
      <div style={{ display: 'flex', gap: 7 }}>
        {b.cards.map((emoji, i) => (
          <div
            key={i}
            style={{
              width: 38,
              height: 52,
              borderRadius: 7,
              background: 'linear-gradient(160deg,#1b2236,#11161f)',
              border: `1px solid ${COLORS.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 15,
            }}
          >
            {emoji}
          </div>
        ))}
      </div>

      {/* Cost + action */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontSize: 9,
              color: COLORS.muted,
              letterSpacing: '0.08em',
            }}
          >
            {b.costLabel}
          </div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 18,
              color: COLORS.green,
            }}
          >
            {formatUsd(b.costValue)}
          </div>
        </div>

        {b.action === 'watch' ? (
          <button
            onClick={() => onAction(b)}
            style={{
              border: `1px solid ${COLORS.border}`,
              background: '#0c1019',
              color: COLORS.text,
              borderRadius: 11,
              padding: '11px 18px',
              fontWeight: 600,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            👁 Watch
          </button>
        ) : (
          <button
            onClick={() => onAction(b)}
            style={{
              background: GRADIENT,
              color: '#06120c',
              border: 'none',
              borderRadius: 11,
              padding: '11px 22px',
              fontWeight: 800,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
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
