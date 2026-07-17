import { COLORS, FONTS, GRADIENT, formatUsd } from '../../theme'
import { useIsWide } from '../../useIsWide'
import { useMachineList } from '../../useMachines'
import { shortWallet, tintFor } from '../battle/royaleShared'
import type { GachaMachine } from '../../../onchain/gachaClient'
import type { LiveBattle } from './hubMockData'

const PINK = '#ff2e7e'
const PINK_L = '#ff5c98'

function machineImg(m: GachaMachine | undefined): string | null {
  return m?.thumbnailUrl ?? m?.image ?? null
}
function parseSlots(slots: string): { filled: number; total: number } {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(slots.trim())
  return m ? { filled: Number(m[1]), total: Number(m[2]) } : { filled: 0, total: 0 }
}
function multLabel(entry: number, pot: number): string | null {
  if (entry <= 0 || pot <= 0) return null
  const m = pot / entry
  return `×${Math.abs(m - Math.round(m)) < 0.05 ? Math.round(m) : m.toFixed(1)}`
}

/**
 * Wide, full-width Battle Royale lobby card (Battle Royale page only). Shows the money flow
 * (entry → ×N → est. pot), the room machine + per-round maths, and a seat grid of every player.
 * All values are derived from the live lobby. Pack Battle keeps the compact BattleCard.
 */
export function RoyaleBattleWide({ battle: b, meWallet, onAction, onCancel, onOpen }: {
  battle: LiveBattle; meWallet: string | null
  onAction: (b: LiveBattle) => void; onCancel?: (b: LiveBattle) => void; onOpen: (b: LiveBattle) => void
}) {
  const wideRow = useIsWide('(min-width: 1280px)')   // dividers + single-row top
  const wideSeats = useIsWide('(min-width: 1100px)') // all seats on one row vs 5-wide

  const { machines } = useMachineList()
  const byCode = new Map(machines.map((m) => [m.code, m]))

  const parsed = parseSlots(b.slots)
  const max = b.maxPlayers ?? parsed.total
  const filled = b.playerWallets?.length ?? parsed.filled
  const seatsLeft = Math.max(0, max - filled)
  const rounds = Math.max(1, max - 1)
  const mult = multLabel(b.entry, b.pot)

  const code = (b.machineCodes && b.machineCodes.length) ? b.machineCodes[0] : b.title
  const machine = byCode.get(code)
  const machinePrice = b.machinePrice ?? machine?.price ?? 0
  const machineName = (machine?.shortName ?? machine?.name ?? code).toUpperCase()
  const img = machineImg(machine)

  const potSoFar = filled * b.entry
  const fillPct = max > 0 ? Math.round((filled / max) * 100) : 0

  const seatName = (w: string) => (meWallet && w === meWallet ? 'You' : shortWallet(w))
  const seats = Array.from({ length: max }, (_, i) => (b.playerWallets ?? [])[i] ?? null)

  const divider = <span style={{ flex: 'none', width: 1, alignSelf: 'stretch', background: 'linear-gradient(180deg,transparent,rgba(255,255,255,.1),transparent)' }} />

  return (
    <section onClick={() => onOpen(b)} style={{
      position: 'relative', overflow: 'hidden', borderRadius: 20, cursor: 'pointer',
      border: '1px solid rgba(255,46,126,.28)',
      background: 'linear-gradient(120deg,rgba(255,46,126,.09),rgba(13,10,20,.6) 40%,rgba(60,232,168,.05))',
      boxShadow: '0 24px 60px -30px rgba(0,0,0,.8)',
    }}>
      <span aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '26%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.045),transparent)', animation: 'ba-sweep 3.6s infinite', pointerEvents: 'none' }} />

      {/* top row — identity · money · machine · CTA */}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'clamp(16px,2.2vw,30px)', padding: '20px clamp(18px,2.4vw,28px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
          <span style={{ display: 'inline-flex', padding: '5px 12px', borderRadius: 8, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.08em', color: PINK_L, background: 'rgba(255,46,126,.12)', border: '1px solid rgba(255,46,126,.4)' }}>BATTLE ROYALE</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 500, color: b.statusColor }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: b.statusColor, boxShadow: `0 0 6px ${b.statusColor}`, animation: 'ba-pulse 1.4s infinite' }} />{b.statusText}
          </span>
        </div>

        {wideRow && divider}

        {/* money — labels row over the figures row (the two figures + arrow share a vertical
            centre line, so the differently-sized numbers read as level and the arrow points
            through the middle of both), arrow (+ ×N) between */}
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto', alignItems: 'center', columnGap: 14, rowGap: 3, flex: 'none' }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.16em', color: '#7a8492', textAlign: 'center' }}>ENTRY</span>
          <span />
          <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.16em', color: '#7a8492', textAlign: 'center' }}>EST. POT</span>

          <span style={{ fontSize: 'clamp(20px,1.7vw,24px)', fontWeight: 700, color: COLORS.muted, whiteSpace: 'nowrap', textAlign: 'center' }}>{formatUsd(b.entry)}</span>
          <span style={{ position: 'relative', display: 'flex', alignItems: 'center', alignSelf: 'center', width: 'clamp(70px,7vw,100px)' }}>
            <span style={{ flex: 1, height: 2, background: `linear-gradient(90deg,rgba(139,149,163,.4),${PINK})`, borderRadius: 2 }} />
            <span style={{ flex: 'none', width: 0, height: 0, borderTop: '5px solid transparent', borderBottom: '5px solid transparent', borderLeft: `7px solid ${PINK}` }} />
            {mult && <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', padding: '2px 10px', borderRadius: 999, background: '#140a12', border: '1px solid rgba(255,46,126,.45)', fontFamily: FONTS.mono, fontSize: 10.5, fontWeight: 700, color: PINK_L }}>{mult}</span>}
          </span>
          <span style={{ fontSize: 'clamp(28px,2.4vw,36px)', fontWeight: 700, letterSpacing: '-.02em', color: PINK_L, whiteSpace: 'nowrap', textAlign: 'center' }}>{formatUsd(b.pot)}</span>
        </div>

        {wideRow && divider}

        {/* machine */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 'none' }}>
          <div style={{ width: 44, height: 58, borderRadius: 9, overflow: 'hidden', background: 'linear-gradient(160deg,#1a1322,#0f0a16)', border: '1px solid rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {img && <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
          </div>
          <div style={{ lineHeight: 1.35 }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 11.5, letterSpacing: '.05em', color: '#cdd4dd' }}>{machineName}</div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: '#7a8492' }}>{formatUsd(machinePrice)} · per round · {rounds} rounds</div>
          </div>
        </div>

        <span style={{ flex: 1, minWidth: 12 }} />

        {/* CTA */}
        <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
          {b.canCancel && onCancel ? (
            <button onClick={(e) => { e.stopPropagation(); onCancel(b) }} style={{ padding: '13px 26px', borderRadius: 13, border: `1px solid ${COLORS.red}59`, background: `${COLORS.red}14`, color: '#ff7a8f', cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14.5, fontWeight: 700 }}>Cancel</button>
          ) : b.alreadyJoined ? (
            <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.muted }}>You're in</span>
          ) : b.action === 'watch' ? (
            <button onClick={(e) => { e.stopPropagation(); onAction(b) }} style={{ padding: '13px 24px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14.5, fontWeight: 600 }}>Watch</button>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onAction(b) }} style={{ padding: '13px 28px', borderRadius: 13, border: 0, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 14.5, fontWeight: 700, color: '#06170f', background: GRADIENT, boxShadow: '0 0 26px -8px rgba(255,46,126,.6)' }}>Join · {formatUsd(b.entry)}</button>
          )}
        </div>
      </div>

      {/* seat zone */}
      <div style={{ position: 'relative', padding: '22px clamp(18px,2.4vw,28px) 24px', borderTop: `1px solid ${COLORS.border}`, background: 'radial-gradient(900px 200px at 50% 0%,rgba(255,46,126,.07),transparent 70%),rgba(0,0,0,.18)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${wideSeats ? max : Math.min(max, 5)},1fr)`, gap: 8, rowGap: 18, marginBottom: 18 }}>
          {seats.map((w, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9, minWidth: 0 }}>
              {w ? (
                <>
                  <span style={{ position: 'relative', width: 54, height: 54, borderRadius: '50%', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#06170f', background: tintFor(w), boxShadow: '0 0 24px -8px rgba(255,46,126,.4)' }}>
                    {seatName(w).slice(0, 1).toUpperCase()}
                    <span style={{ position: 'absolute', bottom: -3, right: -3, width: 18, height: 18, borderRadius: '50%', background: COLORS.green, border: '2.5px solid #0c0812', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#06170f' }}>✓</span>
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: meWallet && w === meWallet ? COLORS.green : COLORS.text }}>{seatName(w)}</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: '.08em', color: COLORS.green }}>{w === b.creatorWallet ? 'HOST · READY' : 'READY'}</span>
                </>
              ) : (
                <>
                  <span className="ba-slotpulse" style={{ width: 54, height: 54, borderRadius: '50%', flex: 'none', border: '2px dashed rgba(245,197,66,.45)' }} />
                  <span style={{ fontSize: 12, color: 'rgba(255,255,255,.35)' }}>Waiting…</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, color: 'transparent' }}>·</span>
                </>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: '#f5c542', flex: 'none' }}>
            {seatsLeft > 0 ? `${filled}/${max} · ${seatsLeft} SEAT${seatsLeft === 1 ? '' : 'S'} LEFT` : `${max}/${max} · FULL · STARTING…`}
          </span>
          <span style={{ flex: 1, height: 8, borderRadius: 99, background: 'rgba(255,255,255,.05)', border: `1px solid ${COLORS.border}`, overflow: 'hidden', position: 'relative' }}>
            <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${fillPct}%`, borderRadius: 99, background: GRADIENT }} />
          </span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: '#7a8492', flex: 'none' }}>POT {formatUsd(potSoFar)} / {formatUsd(b.pot)}</span>
        </div>
      </div>
    </section>
  )
}
