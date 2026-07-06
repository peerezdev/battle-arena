import { useMemo, useState } from 'react'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { useMachineList } from '../../useMachines'
import type { GachaMachine } from '../../../onchain/gachaClient'
import type { LiveBattle, BattleMode } from './hubMockData'

function machineImg(m: GachaMachine | undefined): string | null {
  return m?.thumbnailUrl ?? m?.image ?? null
}

/** "OPENS N · [pack images]" strip — the bundle for pack, the single machine for royale. */
function OpensRow({ battle: b, byCode }: { battle: LiveBattle; byCode: Map<string, GachaMachine> }) {
  const isPack = b.mode === 'pack'
  const codes = b.machineCodes && b.machineCodes.length ? b.machineCodes : [b.title]
  const shown = isPack ? codes : codes.slice(0, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: `1px solid ${COLORS.border}`, marginBottom: 16 }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.14em', color: COLORS.muted, whiteSpace: 'nowrap' }}>{isPack ? `OPENS ${codes.length}` : 'ROOM PACK'}</span>
      <div className="hidescroll" style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0, overflowX: 'auto' }}>
        {shown.map((code, i) => {
          const img = machineImg(byCode.get(code))
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              <div style={{ width: 24, height: 31, borderRadius: 5, overflow: 'hidden', background: '#0f0a16', border: `1px solid ${COLORS.border}` }}>
                {img && <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
              </div>
              {i < shown.length - 1 && <span style={{ color: '#4a4456', fontSize: 9 }}>›</span>}
            </div>
          )
        })}
      </div>
      <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.muted, whiteSpace: 'nowrap' }}>
        {isPack ? `${codes.length} pack${codes.length === 1 ? '' : 's'} / player` : (byCode.get(codes[0])?.name ?? '')}
      </span>
    </div>
  )
}

const MODE_LABEL: Record<BattleMode, string> = {
  pack:   'PACK BATTLE',
  royale: 'BATTLE ROYALE',
  mana:   'MANA DUEL',
}

const FILTERS = ['All', 'Ready to join', 'Mine', 'Recent']

interface Props {
  battles: LiveBattle[]
  onBattleAction: (b: LiveBattle) => void
  onCancel?: (b: LiveBattle) => void
  onOpen: (b: LiveBattle) => void
}

export function LiveBattles({ battles, onBattleAction, onCancel, onOpen }: Props) {
  const [activeFilter, setActiveFilter] = useState(0)
  const { machines } = useMachineList()
  const byCode = useMemo(() => new Map(machines.map((m) => [m.code, m])), [machines])

  return (
    <div>
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
          <BattleCard key={b.id} battle={b} byCode={byCode} onAction={onBattleAction} onCancel={onCancel} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

const MODE_COLOR: Record<BattleMode, string> = {
  pack: COLORS.green,
  royale: '#ff6bb5',
  mana: '#a98bff',
}

// Parses a "x/y" slots string into { filled, total }. Falls back to 0/0 on malformed input.
function parseSlots(slots: string): { filled: number; total: number } {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(slots.trim())
  if (!m) return { filled: 0, total: 0 }
  return { filled: Number(m[1]), total: Number(m[2]) }
}

function BattleCard({ battle: b, byCode, onAction, onCancel, onOpen }: { battle: LiveBattle; byCode: Map<string, GachaMachine>; onAction: (b: LiveBattle) => void; onCancel?: (b: LiveBattle) => void; onOpen: (b: LiveBattle) => void }) {
  const modeColor = MODE_COLOR[b.mode]
  const modeBg = `${modeColor}22`
  const modeBd = `${modeColor}66`
  const { filled, total } = parseSlots(b.slots)
  const openSeats = Math.max(0, total - filled)
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

      {/* opens sequence */}
      <OpensRow battle={b} byCode={byCode} />

      {/* players + action */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <PlayerAvatars players={b.players} extra={b.extra} openSeats={openSeats} />
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

      {openSeats > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13, paddingTop: 12, borderTop: '1px dashed rgba(245,197,66,.25)' }}>
          <span style={{ flex: 'none', width: 6, height: 6, borderRadius: '50%', background: '#f5c542', boxShadow: '0 0 6px #f5c542', animation: 'ba-pulse 1.4s infinite' }} />
          <span style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: '#f5c542' }}>
            {openSeats} seat{openSeats === 1 ? '' : 's'} left · starts when full
          </span>
        </div>
      )}
    </div>
  )
}

function PlayerAvatars({
  players,
  extra,
  openSeats = 0,
}: {
  players: { violet: boolean }[]
  extra?: string
  openSeats?: number
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
      {/* Open seats — pulsing empty rings, only meaningful for fillable (non-1v1) lobbies */}
      {!hasVS && Array.from({ length: openSeats }, (_, i) => (
        <div
          key={`seat-${i}`}
          className="ba-slotpulse"
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            border: '2px dashed rgba(245,197,66,.5)',
            background: 'transparent',
            marginLeft: -13,
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
