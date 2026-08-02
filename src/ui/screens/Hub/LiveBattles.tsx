import { Fragment, useMemo, useState } from 'react'
import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { useIsWide } from '../../useIsWide'
import { useMachineList } from '../../useMachines'
import type { GachaMachine } from '../../../onchain/gachaClient'
import type { LiveBattle, BattleMode } from './hubMockData'

function machineImg(m: GachaMachine | undefined): string | null {
  return m?.thumbnailUrl ?? m?.image ?? null
}

// Run-length groups of the pack bundle in opening order ([base,base,neo] → BASE ×2, NEO ×1).
// Royale rooms run a single machine, so they always collapse to one group.
function groupCodes(b: LiveBattle): { code: string; qty: number }[] {
  const codes = b.machineCodes && b.machineCodes.length ? b.machineCodes : [b.title]
  if (b.mode !== 'pack') return [{ code: codes[0], qty: 1 }]
  const groups: { code: string; qty: number }[] = []
  for (const c of codes) {
    const last = groups[groups.length - 1]
    if (last && last.code === c) last.qty++
    else groups.push({ code: c, qty: 1 })
  }
  return groups
}

/** Full-bleed pack strip: one cell per bundle group — machine image, ×qty badge, name, price. */
function PacksGrid({ battle: b, byCode }: { battle: LiveBattle; byCode: Map<string, GachaMachine> }) {
  const groups = groupCodes(b)
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${groups.length}, 1fr)`, borderTop: `1px solid ${COLORS.border}`, borderBottom: `1px solid ${COLORS.border}` }}>
      {groups.map((g, i) => {
        const m = byCode.get(g.code)
        const img = machineImg(m)
        return (
          <div key={i} style={{ textAlign: 'center', padding: '14px 8px', borderRight: i < groups.length - 1 ? `1px solid ${COLORS.border}` : 'none' }}>
            <div style={{ position: 'relative', width: 50, height: 66, margin: '0 auto 8px', borderRadius: 10, overflow: 'visible', background: 'linear-gradient(160deg,#1a1322,#0f0a16)', border: '1px solid rgba(255,255,255,.14)' }}>
              {img && <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 9, display: 'block' }} />}
              {b.mode === 'pack' && (
                <span style={{ position: 'absolute', top: -6, right: -6, padding: '2px 7px', borderRadius: 999, background: COLORS.green, color: '#06170f', fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700 }}>×{g.qty}</span>
              )}
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.06em', color: '#cdd4dd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {(m?.shortName ?? m?.name ?? g.code).toUpperCase()}
            </div>
            {m != null && <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: COLORS.green, marginTop: 2 }}>{formatUsd(m.price)}</div>}
          </div>
        )
      })}
    </div>
  )
}

const MODE_LABEL: Record<BattleMode, string> = {
  pack:   'PACK BATTLE',
  royale: 'BATTLE ROYALE',
  mana:   'MANA DUEL',
}

const FILTERS = ['All', 'Ready to join', 'Mine', 'Recent']
// 'Recent' es el único que enseña partidas TERMINADAS; los tres de antes miran a las que siguen
// en juego. Una rayita delante lo agrupa: el filtro que cambia de tiempo verbal no debería
// parecer uno más de la fila.
const FINISHED_FILTER = FILTERS.indexOf('Recent')

// Which battles each filter shows. Status is absent on legacy/open-only rows → treated as an
// open lobby. All = live or not-yet-started; Ready = joinable & not already in; Mine = created
// by me; Recent = finished (settled).
function matchesFilter(b: LiveBattle, filterIdx: number, meWallet: string | null): boolean {
  const s = b.battleStatus
  const finished = s === 'settled' || s === 'voided' || s === 'cancelled'
  switch (filterIdx) {
    case 1: { // Ready to join
      const { filled, total } = parseSlots(b.slots)
      return (!s || s === 'lobby') && total - filled > 0 && !b.alreadyJoined
    }
    case 2: // Mine — games I created that haven't finished yet (exclude settled/voided/cancelled)
      return !!meWallet && b.creatorWallet === meWallet && !finished
    case 3: // Recent
      return s === 'settled'
    default: // All — live or not yet started
      return !finished
  }
}

// Recent orders by finish time (newest first); everything else by creation time.
function sortForFilter(filterIdx: number, list: LiveBattle[]): LiveBattle[] {
  const t = (v?: string | null) => (v ? Date.parse(v) : 0)
  const key = filterIdx === 3 ? (b: LiveBattle) => t(b.settledAt) : (b: LiveBattle) => t(b.createdAt)
  return [...list].sort((a, b) => key(b) - key(a))
}

function emptyMessage(filterIdx: number, meWallet: string | null): string {
  switch (filterIdx) {
    case 1: return 'No games open to join right now.'
    case 2: return meWallet ? "You haven't created any games yet." : 'Sign in to see games you created.'
    case 3: return 'No finished games yet.'
    default: return 'No live games right now.'
  }
}

interface Props {
  battles: LiveBattle[]
  meWallet?: string | null
  onBattleAction: (b: LiveBattle) => void
  onCancel?: (b: LiveBattle) => void
  onOpen: (b: LiveBattle) => void
  /** Revivir el reveal de una partida ya terminada. Sin esto solo se ofrece el marcador. */
  onReplay?: (b: LiveBattle) => void
}

export function LiveBattles({ battles, meWallet = null, onBattleAction, onCancel, onOpen, onReplay }: Props) {
  const [activeFilter, setActiveFilter] = useState(0)
  const { machines } = useMachineList()
  const byCode = useMemo(() => new Map(machines.map((m) => [m.code, m])), [machines])
  const filtered = useMemo(
    () => sortForFilter(activeFilter, battles.filter((b) => matchesFilter(b, activeFilter, meWallet))),
    [battles, activeFilter, meWallet],
  )
  // Badge always reflects the count of active games (live or not started), not the current filter.
  const liveCount = useMemo(() => battles.filter((b) => matchesFilter(b, 0, meWallet)).length, [battles, meWallet])

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
          {liveCount} live
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
          <Fragment key={f}>
            {i === FINISHED_FILTER && (
              <span aria-hidden style={{
                alignSelf: 'stretch', width: 1, margin: '4px 5px',
                background: COLORS.border, flex: 'none',
              }} />
            )}
          <span
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
          </Fragment>
        ))}
      </div>

      {/* (d) Battle cards — filtered by the segmented control */}
      {filtered.length === 0 ? (
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted, padding: '18px 4px' }}>
          {emptyMessage(activeFilter, meWallet)}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
          {filtered.map((b) => (
            <BattleCard key={b.id} battle={b} byCode={byCode} onAction={onBattleAction} onCancel={onCancel} onOpen={onOpen} onReplay={onReplay} />
          ))}
        </div>
      )}
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

// The "×N" step from buy-in to full pot (3 players → ×3). One decimal when not whole
// (royale entry covers a variable pack count, so the ratio is rarely an integer).
function multLabel(entry: number, pot: number): string | null {
  if (entry <= 0 || pot <= 0) return null
  const mult = pot / entry
  return `×${Math.abs(mult - Math.round(mult)) < 0.05 ? Math.round(mult) : mult.toFixed(1)}`
}

/** Mobile body: packs panel + pot box side by side (no prices, tighter cells). */
function CompactPacksPot({ battle: b, byCode, modeColor, mult }: { battle: LiveBattle; byCode: Map<string, GachaMachine>; modeColor: string; mult: string | null }) {
  const groups = groupCodes(b)
  return (
    <div style={{ display: 'flex', gap: 12, padding: '0 16px', marginBottom: 14 }}>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', gap: 9, justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap', padding: '12px 8px', borderRadius: 13, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.07)' }}>
        {groups.map((g, i) => {
          const m = byCode.get(g.code)
          const img = machineImg(m)
          return (
            <div key={i} style={{ textAlign: 'center' }}>
              <div style={{ position: 'relative', width: 46, height: 62, margin: '0 auto 6px', borderRadius: 9, background: 'linear-gradient(160deg,#1a1322,#0f0a16)', border: '1px solid rgba(255,255,255,.14)' }}>
                {img && <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, display: 'block' }} />}
                {b.mode === 'pack' && (
                  <span style={{ position: 'absolute', top: -5, right: -5, padding: '1px 6px', borderRadius: 999, background: COLORS.green, color: '#06170f', fontFamily: FONTS.mono, fontSize: 8.5, fontWeight: 700 }}>×{g.qty}</span>
                )}
              </div>
              <div style={{ fontFamily: FONTS.mono, fontSize: 8.5, color: '#cdd4dd', maxWidth: 54, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {(m?.shortName ?? m?.name ?? g.code).toUpperCase()}
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ flex: 'none', width: 112, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8, padding: 12, borderRadius: 13, background: `${modeColor}0d`, border: `1px solid ${modeColor}38` }}>
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 9.5, color: '#7a8492', letterSpacing: '.06em', marginBottom: 2 }}>EST. POT</div>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-.02em', color: modeColor }}>{formatUsd(b.pot)}</div>
        </div>
        <div style={{ height: 1, background: 'rgba(255,255,255,.08)' }} />
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 9.5, color: '#7a8492', letterSpacing: '.06em', marginBottom: 2 }}>{b.costLabel}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#cdd4dd' }}>
            {formatUsd(b.entry)}{mult && <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: modeColor }}> {mult}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}

/** La card compacta de una partida. Exportada porque la pantalla de Battle Royale enseña sus
 *  partidas recientes con ESTA misma card: si se duplicara, las dos listas de "recientes"
 *  divergirían al primer retoque. */
export function BattleCard({ battle: b, byCode, onAction, onCancel, onOpen, onReplay }: { battle: LiveBattle; byCode: Map<string, GachaMachine>; onAction: (b: LiveBattle) => void; onCancel?: (b: LiveBattle) => void; onOpen: (b: LiveBattle) => void; onReplay?: (b: LiveBattle) => void }) {
  const wide = useIsWide('(min-width: 760px)')
  const modeColor = MODE_COLOR[b.mode]
  const { filled, total } = parseSlots(b.slots)
  const openSeats = Math.max(0, total - filled)
  const mult = multLabel(b.entry, b.pot)
  return (
    <div
      onClick={() => onOpen(b)}
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 20,
        background: '#0c0f15',
        border: `1px solid ${COLORS.border}`,
        boxShadow: '0 20px 60px -20px rgba(0,0,0,.8)',
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
      {/* header — mode badge + status; on wide also buy-in → ×N → estimated pot */}
      <div style={{ padding: wide ? '16px 18px 14px' : '16px 16px 14px', background: `linear-gradient(180deg,${modeColor}0f,transparent)` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: wide ? 14 : 0 }}>
          <span style={{
            display: 'inline-flex', padding: '5px 11px', borderRadius: 8,
            fontFamily: FONTS.mono, fontSize: 11, fontWeight: 500,
            color: modeColor, background: `${modeColor}1f`, border: `1px solid ${modeColor}59`,
          }}>
            {MODE_LABEL[b.mode]}
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: b.statusColor }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: b.statusColor, boxShadow: `0 0 6px ${b.statusColor}`, animation: 'ba-pulse 1.4s infinite' }} />
            {b.statusText}
          </span>
        </div>
        {wide && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ flex: 'none', fontSize: 18, fontWeight: 700, color: COLORS.muted, whiteSpace: 'nowrap' }}>{formatUsd(b.entry)}</span>
              <span style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', minWidth: 28 }}>
                <span style={{ flex: 1, height: 2, background: `linear-gradient(90deg,rgba(139,149,163,.4),${modeColor})`, borderRadius: 2 }} />
                <span style={{ flex: 'none', width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: `7px solid ${modeColor}` }} />
                {mult && (
                  <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', padding: '2px 9px', borderRadius: 999, background: '#0c0f15', border: `1px solid ${modeColor}66`, fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, color: modeColor }}>
                    {mult}
                  </span>
                )}
              </span>
              <span style={{ flex: 'none', fontSize: 'clamp(22px,2vw,28px)', fontWeight: 700, letterSpacing: '-.02em', color: modeColor, whiteSpace: 'nowrap' }}>{formatUsd(b.pot)}</span>
            </div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.1em', color: '#7a8492', marginTop: 4 }}>
              {b.costLabel} → ESTIMATED POT
            </div>
          </>
        )}
      </div>

      {/* packs opened — wide: full-bleed strip · mobile: packs panel + pot box */}
      {wide
        ? <PacksGrid battle={b} byCode={byCode} />
        : <CompactPacksPot battle={b} byCode={byCode} modeColor={modeColor} mult={mult} />}

      {/* footer — seats + action */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: wide ? '14px 18px 16px' : '0 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {b.players.map((p, i) => (
            <span key={i} style={{
              width: 32, height: 32, borderRadius: '50%', flex: 'none',
              background: p.violet ? 'linear-gradient(135deg,#ff6bb5,#c02579)' : 'linear-gradient(135deg,#3df0a0,#13c98a)',
              border: '2px solid #0c0f15',
              marginLeft: i > 0 ? -8 : 0,
            }} />
          ))}
          {/* dashed pulsing empty seats — cap the circles, the label carries the real count */}
          {Array.from({ length: Math.min(openSeats, 3) }, (_, i) => (
            <span key={`seat-${i}`} className="ba-slotpulse" style={{
              width: 32, height: 32, borderRadius: '50%', flex: 'none',
              border: '2px dashed rgba(245,197,66,.5)', background: 'transparent',
              marginLeft: -8, animationDelay: `${i * 0.35}s`,
            }} />
          ))}
          {b.extra && <span style={{ fontFamily: FONTS.display, fontWeight: 800, color: COLORS.muted, fontSize: 11, marginLeft: 6 }}>{b.extra}</span>}
          {wide ? (
            <span style={{ marginLeft: 9, fontFamily: FONTS.mono, fontSize: 12, color: openSeats > 0 ? '#f5c542' : COLORS.muted }}>
              {openSeats > 0 ? `${openSeats} seat${openSeats === 1 ? '' : 's'} left` : b.slots}
            </span>
          ) : (
            <span style={{ marginLeft: 9, fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>
              {b.slots}{openSeats > 0 && <> · <span style={{ color: '#f5c542' }}>{openSeats} left</span></>}
            </span>
          )}
        </div>

        {b.action === 'watch' ? (
          /* Terminada: las dos salidas conviven. "Result" va al marcador y "Replay" revive el
             reveal, que si no era inalcanzable — el enlace lleva al resultado por sí solo. */
          b.battleStatus === 'settled' && onReplay ? (
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={(e) => { e.stopPropagation(); onReplay(b) }} title="Watch the reveal again"
                style={{ border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.muted, borderRadius: 12, padding: '10px 15px', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ↻ Replay
              </button>
              <button onClick={(e) => { e.stopPropagation(); onAction(b) }}
                style={{ border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.text, borderRadius: 12, padding: '10px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                Result
              </button>
            </div>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onAction(b) }}
              style={{ border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.text, borderRadius: 12, padding: '10px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              {b.battleStatus === 'settled' ? 'Result' : 'Watch'}
            </button>
          )
        ) : b.canCancel && onCancel ? (
          <button onClick={(e) => { e.stopPropagation(); onCancel(b) }}
            style={{ border: `1px solid ${COLORS.red}59`, background: `${COLORS.red}14`, color: '#ff7a8f', borderRadius: 12, padding: '10px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            Cancel
          </button>
        ) : b.alreadyJoined ? (
          <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.muted }}>You're in</span>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); onAction(b) }}
            style={{ background: GRADIENT, color: '#06120c', border: 'none', borderRadius: 12, padding: '10px 20px', fontWeight: 800, fontSize: 14, cursor: 'pointer', boxShadow: '0 0 18px -6px rgba(0,255,196,.7)' }}>
            Join
          </button>
        )}
      </div>
    </div>
  )
}
