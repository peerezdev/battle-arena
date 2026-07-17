import { useEffect, useMemo, useState } from 'react'
import { COLORS, FONTS, GRADIENT, RARITY, formatUsd } from '../../theme'
import { useIsWide } from '../../useIsWide'
import { useMachineList } from '../../useMachines'
import { fetchMachineCards, type MachineCard, type GachaMachine } from '../../../onchain/gachaClient'
import { CardPoolGrid } from '../gacha/CardPoolGrid'
import { shortWallet } from './RoyaleReveal'
import type { Battle } from '../../../onchain/packBattleClient'

const RARITY_ORDER = ['epic', 'rare', 'uncommon', 'common']
const RARITY_COLOR: Record<string, string> = {
  epic: RARITY.epic, rare: RARITY.rare, uncommon: RARITY.uncommon, common: RARITY.common,
}
const BASE = 1e6

interface PackGroup { code: string; qty: number; startOrder: number; endOrder: number; machine: GachaMachine | undefined }

/** Consecutive same-machine boxes grouped into packs, preserving opening order. */
function groupBundle(battle: Battle, byCode: Map<string, GachaMachine>): PackGroup[] {
  const boxes = (battle.packs && battle.packs.length)
    ? [...battle.packs].sort((a, b) => a.sequence - b.sequence).map((p) => p.machine_code)
    : [battle.machine_code]
  const groups: PackGroup[] = []
  boxes.forEach((code, i) => {
    const last = groups[groups.length - 1]
    if (last && last.code === code) { last.qty++; last.endOrder = i + 1 }
    else groups.push({ code, qty: 1, startOrder: i + 1, endOrder: i + 1, machine: byCode.get(code) })
  })
  return groups
}

function machineImg(m: GachaMachine | undefined): string | null {
  return m?.thumbnailUrl ?? m?.image ?? null
}

export function WaitingRoom({
  battle, meWallet, onJoinSelf, onJoinBot, onJoinAllBots, onCancel, onExit, onBack,
  joiningSelf, joiningBot, joiningAll, botError, cancelError,
}: {
  battle: Battle
  meWallet: string | null
  onJoinSelf: () => void
  onJoinBot: () => void
  onJoinAllBots: () => void
  onCancel: () => void
  onExit: () => void
  onBack: () => void        // ← navigate to the page the player came from (history back)
  joiningSelf: boolean
  joiningBot: boolean
  joiningAll: boolean
  botError: string | null
  cancelError: string | null
}) {
  const { machines } = useMachineList()
  const wide = useIsWide('(min-width: 820px)')
  const byCode = useMemo(() => new Map(machines.map((m) => [m.code, m])), [machines])

  const isPB = battle.mode === 'pack'
  const groups = useMemo(() => groupBundle(battle, byCode), [battle, byCode])
  const totalBoxes = groups.reduce((s, g) => s + g.qty, 0)

  const [sel, setSel] = useState(0)
  const selGroup = groups[Math.min(sel, groups.length - 1)] ?? groups[0]
  const selMachine = selGroup?.machine

  const isCreator = !!meWallet && battle.creator_wallet === meWallet
  const isParticipant = !!meWallet && battle.players.some((p) => p.wallet === meWallet)
  const spaceAvailable = battle.players.length < battle.max_players

  const entry = (battle.buyin ?? battle.price) / BASE
  const estPot = entry * battle.max_players
  const accent = isPB ? COLORS.violet : RARITY.epic   // pack = magenta, royale = violet/epic

  // ── card pool modal (lazy fetch per machine, cached) ──
  const [poolCode, setPoolCode] = useState<string | null>(null)
  const [pools, setPools] = useState<Record<string, { cards: MachineCard[]; loading: boolean; error: boolean }>>({})
  function openPool() {
    const code = selGroup?.code
    if (!code) return
    setPoolCode(code)
    if (!pools[code]) {
      setPools((p) => ({ ...p, [code]: { cards: [], loading: true, error: false } }))
      fetchMachineCards(code, { limit: 24 })
        .then((cards) => setPools((p) => ({ ...p, [code]: { cards, loading: false, error: false } })))
        .catch(() => setPools((p) => ({ ...p, [code]: { cards: [], loading: false, error: true } })))
    }
  }
  useEffect(() => { if (poolCode) { const h = (e: KeyboardEvent) => e.key === 'Escape' && setPoolCode(null); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h) } }, [poolCode])

  // odds of the selected machine
  const oddsEntries = Object.entries(selMachine?.odds ?? {}).sort(
    ([a], [b]) => RARITY_ORDER.indexOf(a.toLowerCase()) - RARITY_ORDER.indexOf(b.toLowerCase()))
  const totalOdds = oddsEntries.reduce((s, [, v]) => s + (v ?? 0), 0)

  const lbl: React.CSSProperties = { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.24em', color: COLORS.green }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'clamp(14px,2.4vw,28px)' }}>
      <div style={{ width: 1040, maxWidth: '100%', margin: '0 auto' }}>
        {/* back — return to the page the player came from */}
        <button
          type="button"
          onClick={onBack}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, margin: '0 24px 4px', padding: '4px 0', background: 'transparent', border: 0, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600, color: COLORS.muted, transition: 'color .12s' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = COLORS.text }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = COLORS.muted }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          Back
        </button>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px', borderBottom: `1px solid ${COLORS.border}`, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 999, background: `${accent}1f`, border: `1px solid ${accent}73`, fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.2em', color: accent }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: accent, boxShadow: `0 0 8px ${accent}`, animation: 'wr-pulse 1.6s infinite' }} />
            {(isPB ? 'PACK BATTLE' : 'BATTLE ROYALE')} · {formatUsd(entry)}
          </span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.12em', color: '#7a8492' }}>
            TABLE #{battle.id.slice(0, 4)}…{battle.id.slice(-4)} · WAITING FOR PLAYERS···
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: wide ? `minmax(0,1fr) ${battle.max_players > 5 ? 448 : 330}px` : '1fr' }}>
          {/* ── left: packs + odds ── */}
          <div style={{ padding: 'clamp(18px,2.2vw,26px) clamp(18px,2.4vw,30px)' }}>
            {/* lineup / sequence */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14, minHeight: 36, flexWrap: 'wrap' }}>
              <span style={lbl}>{isPB ? `OPENING SEQUENCE · ${totalBoxes} PACK${totalBoxes > 1 ? 'S' : ''}` : 'ROOM PACK'}</span>
              {isPB ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                  {(battle.packs && battle.packs.length ? [...battle.packs].sort((a, b) => a.sequence - b.sequence).map((p) => p.machine_code) : [battle.machine_code]).map((code, i, arr) => {
                    const img = machineImg(byCode.get(code))
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ position: 'relative', width: 26, height: 34, borderRadius: 6, overflow: 'hidden', background: 'linear-gradient(160deg,#1a1322,#0f0a16)', border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {img && <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                          <span style={{ position: 'absolute', bottom: -7, left: '50%', transform: 'translateX(-50%)', fontFamily: FONTS.mono, fontSize: 7.5, color: '#7a8492' }}>{i + 1}</span>
                        </div>
                        {i < arr.length - 1 && <span style={{ color: '#4a4456', fontSize: 10, marginBottom: 6 }}>▸</span>}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <span style={{ fontFamily: FONTS.mono, fontSize: 10.5, color: '#7a8492' }}>everyone opens the same pack</span>
              )}
            </div>

            {/* pack cards */}
            <div style={{ display: 'flex', gap: 14, marginBottom: 22, flexWrap: 'wrap' }}>
              {groups.map((g, i) => {
                const on = i === Math.min(sel, groups.length - 1)
                const m = g.machine
                const img = machineImg(m)
                const border = on ? `1.5px solid ${COLORS.green}8c` : `1.5px solid ${COLORS.border}`
                const order = g.startOrder === g.endOrder ? `${g.startOrder}º` : `${g.startOrder}º–${g.endOrder}º`
                return (
                  <button key={g.code + i} onClick={() => setSel(i)} style={{ position: 'relative', flex: 'none', width: 132, padding: 0, border: 0, background: 'transparent', cursor: 'pointer', textAlign: 'center', color: 'inherit', opacity: on ? 1 : 0.62, transition: 'opacity .2s,transform .2s', transform: on ? 'translateY(-4px)' : 'none' }}>
                    <div style={{ position: 'relative', width: 132, height: 172, borderRadius: 16, overflow: 'hidden', background: 'linear-gradient(160deg,#1a1322,#0f0a16)', border, boxShadow: on ? `0 18px 44px -14px ${COLORS.green}55` : '0 14px 34px -16px rgba(0,0,0,.7)' }}>
                      {img && <img src={img} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                      {isPB && <span style={{ position: 'absolute', top: 8, left: 8, padding: '3px 8px', borderRadius: 7, background: 'rgba(10,3,9,.62)', border: `1px solid ${accent}`, fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: accent }}>{order}</span>}
                      {isPB && g.qty > 1 && <span style={{ position: 'absolute', bottom: 8, right: 8, padding: '3px 8px', borderRadius: 7, background: `${COLORS.green}24`, border: `1px solid ${COLORS.green}66`, fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, color: COLORS.green }}>×{g.qty}</span>}
                      {on && <span style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20, borderRadius: '50%', background: COLORS.green, color: '#06170f', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>✓</span>}
                    </div>
                    <div style={{ marginTop: 8, fontFamily: FONTS.body, fontSize: 12.5, fontWeight: 700, color: on ? COLORS.text : COLORS.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m?.name ?? g.code}</div>
                    <div style={{ marginTop: 2, fontFamily: FONTS.mono, fontSize: 12, fontWeight: 700, color: on ? COLORS.green : COLORS.muted }}>{formatUsd(m?.price ?? 0)}</div>
                  </button>
                )
              })}
            </div>

            {/* odds of selected */}
            <div style={{ animation: 'wr-in .3s ease-out' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                <span style={lbl}>WHAT CAN YOU PULL</span>
                <span style={{ fontFamily: FONTS.mono, fontSize: 10.5, color: '#7a8492' }}>{(selMachine?.name ?? selGroup?.code)} · {formatUsd(selMachine?.price ?? 0)}</span>
                <span style={{ flex: 1 }} />
                <button onClick={openPool} disabled={!selGroup} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', color: '#cdd4dd', cursor: 'pointer', fontFamily: FONTS.body, fontSize: 12, fontWeight: 700 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="12" height="16" rx="2" /><path d="M8.5 3H17a2 2 0 0 1 2 2v12" /></svg>
                  View card pool
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 16 }}>
                {oddsEntries.length === 0 && <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>Odds unavailable for this machine.</div>}
                {oddsEntries.map(([rarity, pct]) => {
                  const rc = RARITY_COLOR[rarity.toLowerCase()] ?? COLORS.muted
                  const w = totalOdds > 0 ? Math.max(4, Math.round((pct / totalOdds) * 100)) : 4
                  const range = selMachine?.tierRanges?.[rarity.toLowerCase()]
                  return (
                    <div key={rarity} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span style={{ width: 96, fontFamily: FONTS.mono, fontSize: 10.5, color: rc, textTransform: 'capitalize' }}>{rarity.toLowerCase()}</span>
                      <span style={{ flex: 1, height: 8, borderRadius: 99, background: 'rgba(255,255,255,.06)', overflow: 'hidden' }}>
                        <span style={{ display: 'block', width: `${w}%`, height: '100%', background: rc, boxShadow: rarity.toLowerCase() === 'epic' ? `0 0 10px ${rc}99` : 'none' }} />
                      </span>
                      <span style={{ width: 128, fontFamily: FONTS.mono, fontSize: 11, color: '#cdd4dd', textAlign: 'right' }}>
                        {+(pct * 100).toFixed(2)}%{range ? ` · ${formatUsd(range.start)}–${formatUsd(range.end)}` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
              {selMachine?.ev != null && (
                <span style={{ display: 'inline-block', padding: '6px 12px', borderRadius: 999, background: 'rgba(255,255,255,.04)', border: `1px solid ${COLORS.border}`, fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>EV MACHINE · {formatUsd(selMachine.ev)}</span>
              )}
            </div>
          </div>

          {/* ── right rail: players ── */}
          <div style={{ padding: 'clamp(18px,2.2vw,26px) 24px', borderLeft: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.015)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.24em', color: COLORS.muted }}>PLAYERS</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.text, fontWeight: 700 }}>{battle.players.length}<span style={{ color: '#5c6675' }}>/{battle.max_players}</span></span>
            </div>
            {(() => {
              const slots = Array.from({ length: battle.max_players }, (_, i) => battle.players[i] ?? null)
              const renderSlot = (p: typeof slots[number], i: number) => {
                const isMe = !!p && !!meWallet && p.wallet === meWallet
                if (p) {
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 13, background: `${COLORS.green}12`, border: `1px solid ${COLORS.green}59` }}>
                      <span style={{ flex: 'none', width: 36, height: 36, borderRadius: '50%', background: GRADIENT, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: '#06170f' }}>{isMe ? 'P' : p.wallet.slice(0, 1).toUpperCase()}</span>
                      <div style={{ flex: 1, lineHeight: 1.25, minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{isMe ? 'You' : shortWallet(p.wallet)}</div>
                        <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: COLORS.green }}>READY</div>
                      </div>
                      <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: COLORS.green, boxShadow: `0 0 8px ${COLORS.green}` }} />
                    </div>
                  )
                }
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 13, border: `1px dashed ${COLORS.border}` }}>
                    <span style={{ flex: 'none', width: 36, height: 36, borderRadius: '50%', border: `1.5px dashed rgba(255,255,255,.2)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#5c6675', animation: 'wr-pulse 2.4s infinite' }}>?</span>
                    <div style={{ flex: 1, lineHeight: 1.25, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: COLORS.muted }}>Open slot</div>
                      <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: '#5c6675' }}>SLOT {i + 1}</div>
                    </div>
                    <button onClick={onJoinBot} disabled={joiningBot} style={{ flex: 'none', padding: '6px 11px', borderRadius: 9, border: `1px solid ${COLORS.violet}73`, background: `${COLORS.violet}1a`, color: COLORS.violet, cursor: joiningBot ? 'default' : 'pointer', fontFamily: FONTS.body, fontSize: 11.5, fontWeight: 700 }}>{joiningBot ? '…' : '+ Bot'}</button>
                  </div>
                )
              }
              // > 5 players → two columns: always 5 in the first, the rest in the second.
              if (slots.length > 5) {
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{slots.slice(0, 5).map((p, i) => renderSlot(p, i))}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{slots.slice(5).map((p, i) => renderSlot(p, i + 5))}</div>
                  </div>
                )
              }
              return <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>{slots.map((p, i) => renderSlot(p, i))}</div>
            })()}

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px', borderRadius: 14, background: 'rgba(255,255,255,.03)', border: `1px solid ${COLORS.border}`, marginBottom: 16 }}>
              <div style={{ flex: 1, lineHeight: 1.2 }}><div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.18em', color: COLORS.muted, marginBottom: 4 }}>ENTRY</div><div style={{ fontSize: 21, fontWeight: 700, color: COLORS.green }}>{formatUsd(entry)}</div></div>
              <span style={{ width: 1, height: 32, background: 'rgba(255,255,255,.1)' }} />
              <div style={{ flex: 1, lineHeight: 1.2 }}><div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.18em', color: COLORS.muted, marginBottom: 4 }}>ESTIMATED POT</div><div style={{ fontSize: 21, fontWeight: 700 }}>{formatUsd(estPot)}</div></div>
            </div>

            <span style={{ flex: 1, minHeight: 12 }} />

            {!isParticipant && spaceAvailable && (
              <button onClick={onJoinSelf} disabled={joiningSelf} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: 0, cursor: joiningSelf ? 'default' : 'pointer', fontFamily: FONTS.body, fontSize: 14.5, fontWeight: 700, color: '#06170f', background: GRADIENT, boxShadow: '0 12px 30px -10px rgba(0,255,196,.5)', marginBottom: 8, opacity: joiningSelf ? 0.7 : 1 }}>{joiningSelf ? 'Joining…' : 'Join battle'}</button>
            )}
            {spaceAvailable && (
              <button onClick={onJoinAllBots} disabled={joiningAll} style={{ position: 'relative', overflow: 'hidden', width: '100%', padding: '13px 0', borderRadius: 14, border: `1px solid ${COLORS.violet}59`, cursor: joiningAll ? 'default' : 'pointer', fontFamily: FONTS.body, fontSize: 14, fontWeight: 700, color: COLORS.violet, background: `${COLORS.violet}14`, marginBottom: 8 }}>{joiningAll ? 'Adding bots…' : 'Fill with bots & start'}</button>
            )}
            {isCreator && (
              <button onClick={onCancel} style={{ width: '100%', padding: '12px 0', borderRadius: 14, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.muted, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Cancel</button>
            )}
            <button onClick={onExit} style={{ width: '100%', padding: '10px 0', borderRadius: 14, border: 0, background: 'transparent', color: '#5c6675', cursor: 'pointer', fontFamily: FONTS.body, fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>Back to lobby</button>
            {(botError || cancelError) && <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red, textAlign: 'center', marginBottom: 6 }}>{botError || cancelError}</div>}
            <div style={{ textAlign: 'center', fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.06em', color: '#5c6675' }}>ENTRY IS REFUNDED IF YOU LEAVE BEFORE THE BATTLE STARTS</div>
          </div>
        </div>
      </div>

      {/* card pool modal */}
      {poolCode && (
        <div onClick={() => setPoolCode(null)} style={{ position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(3,5,8,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(16px,3vw,32px)' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 720, maxWidth: '100%', maxHeight: '82vh', display: 'flex', flexDirection: 'column', borderRadius: 20, background: 'linear-gradient(180deg,#12151c,#0c0f15)', border: `1px solid ${COLORS.border}`, boxShadow: '0 40px 120px -30px rgba(0,0,0,.9)', overflow: 'hidden', animation: 'wr-in .25s ease-out' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 22px', borderBottom: `1px solid ${COLORS.border}` }}>
              <div style={{ lineHeight: 1.25 }}>
                <div style={{ fontSize: 17, fontWeight: 700, color: COLORS.text }}>Card pool</div>
                <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.14em', color: '#7a8492' }}>{(selMachine?.name ?? poolCode)} · {formatUsd(selMachine?.price ?? 0)}</div>
              </div>
              <span style={{ flex: 1 }} />
              <button onClick={() => setPoolCode(null)} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 9, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.03)', color: COLORS.muted, cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', padding: '18px 22px' }}>
              <CardPoolGrid cards={pools[poolCode]?.cards ?? []} loading={pools[poolCode]?.loading ?? true} error={pools[poolCode]?.error} machineCode={poolCode} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
