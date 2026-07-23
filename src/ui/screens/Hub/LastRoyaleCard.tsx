import { useMemo } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useMachineList } from '../../useMachines'
import type { LiveBattle } from './hubMockData'

const PINK = '#ff6bb5'

/**
 * How many times the entry the winner took home. This is a REALIZED return (entry → real loot),
 * not the ×N the open-lobby cards show, which projects a full lobby's estimated pot.
 */
function returnMult(entry: number, won: number): string | null {
  if (entry <= 0 || won <= 0) return null
  const m = won / entry
  return `×${Math.abs(m - Math.round(m)) < 0.05 ? Math.round(m) : m.toFixed(1)}`
}

function shortWallet(w?: string | null): string {
  return w ? `${w.slice(0, 4)}…${w.slice(-4)}` : '—'
}

/** "2 hours ago" style stamp; falls back to nothing when the row carries no usable timestamp. */
function agoLabel(iso?: string | null): string | null {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return null
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

/**
 * Recap of the last finished Battle Royale, sitting beside Quick Match. Same card language as the
 * Live-games grid, but it answers one question: what did the entry cost, and what did the winner
 * actually take home.
 */
export function LastRoyaleCard({ battle: b, onOpen, onReplay }: {
  battle: LiveBattle
  onOpen: (b: LiveBattle) => void      // straight to the final standings
  onReplay: (b: LiveBattle) => void    // play the round-by-round reveal again
}) {
  const { machines } = useMachineList()
  const machine = useMemo(() => {
    const code = b.machineCodes?.[0] ?? b.title
    return machines.find((m) => m.code === code)
  }, [machines, b.machineCodes, b.title])
  // lootUsd is only absent on rows from a backend that predates the field; the estimate is a
  // strictly better fallback than showing nothing.
  const won = b.lootUsd ?? b.pot
  const mult = returnMult(b.entry, won)
  const ago = agoLabel(b.settledAt ?? b.createdAt)
  const img = machine?.thumbnailUrl ?? machine?.image ?? null

  return (
    <div
      onClick={() => onOpen(b)}
      style={{
        position: 'relative', overflow: 'hidden', borderRadius: 20,
        background: '#0c0f15', border: `1px solid ${COLORS.border}`,
        boxShadow: '0 20px 60px -20px rgba(0,0,0,.8)',
        cursor: 'pointer', transition: 'border-color .12s, transform .12s',
        display: 'flex', flexDirection: 'column',
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
      {/* header — what this card is + when it happened */}
      <div style={{ padding: '16px 18px 14px', background: `linear-gradient(180deg,${PINK}0f,transparent)` }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
          <span style={{
            display: 'inline-flex', padding: '5px 11px', borderRadius: 8,
            fontFamily: FONTS.mono, fontSize: 11, fontWeight: 500,
            color: PINK, background: `${PINK}1f`, border: `1px solid ${PINK}59`,
          }}>
            LAST ROYALE
          </span>
          {ago && <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>{ago}</span>}
        </div>

        {/* entry → ×N → won: the same money-flow row the Live-games cards use */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ flex: 'none', fontSize: 18, fontWeight: 700, color: COLORS.muted, whiteSpace: 'nowrap' }}>
            {formatUsd(b.entry)}
          </span>
          <span style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', minWidth: 28 }}>
            <span style={{ flex: 1, height: 2, background: `linear-gradient(90deg,rgba(139,149,163,.4),${PINK})`, borderRadius: 2 }} />
            <span style={{ flex: 'none', width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: `7px solid ${PINK}` }} />
            {mult && (
              <span style={{
                position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)',
                padding: '2px 9px', borderRadius: 999, background: '#0c0f15',
                border: `1px solid ${PINK}66`, fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, color: PINK,
              }}>
                {mult}
              </span>
            )}
          </span>
          <span style={{ flex: 'none', fontSize: 'clamp(22px,2vw,28px)', fontWeight: 700, letterSpacing: '-.02em', color: PINK, whiteSpace: 'nowrap' }}>
            {formatUsd(won)}
          </span>
        </div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.1em', color: '#7a8492', marginTop: 4 }}>
          ENTRY → TOTAL WON
        </div>
      </div>

      {/* machine played + seat count */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderTop: `1px solid ${COLORS.border}`, borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ flex: 'none', width: 42, height: 56, borderRadius: 9, background: 'linear-gradient(160deg,#1a1322,#0f0a16)', border: '1px solid rgba(255,255,255,.14)' }}>
          {img && <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8, display: 'block' }} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.06em', color: '#cdd4dd', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {(machine?.shortName ?? machine?.name ?? b.machineCodes?.[0] ?? b.title).toUpperCase()}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted, marginTop: 3 }}>
            {b.slots} players
          </div>
        </div>
      </div>

      {/* winner + the way in */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 18px 16px' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.1em', color: '#7a8492' }}>WINNER</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4, minWidth: 0 }}>
            <span style={{ flex: 'none', width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg,#ff6bb5,#c02579)' }} />
            <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {shortWallet(b.winner)}
            </span>
          </div>
        </div>
        <div style={{ flex: 'none', display: 'flex', gap: 8 }}>
          {/* Replay = the battle route without ?view=result, which lets the reveal run again. */}
          <button
            onClick={(e) => { e.stopPropagation(); onReplay(b) }}
            title="Watch the reveal again"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.muted,
              borderRadius: 12, padding: '10px 14px', fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>
            Replay
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(b) }}
            style={{
              border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.text,
              borderRadius: 12, padding: '10px 16px', fontWeight: 600, fontSize: 13, cursor: 'pointer',
            }}
          >
            Result
          </button>
        </div>
      </div>
    </div>
  )
}
