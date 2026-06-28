import { useEffect, useState, type CSSProperties } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useMachineList } from '../../useMachines'
import { createBattle, type BattleMode } from '../../../onchain/packBattleClient'
import { buildCreateBody, bundleToPacks, totalBoxes, bundleCostUsd, royaleTotalPulls, royaleEntryUsd } from './createBattleBody'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 8, 10]
const MAX_BOXES = 10

// Art/holo/ring per card, cycled by index (mirrors the gacha rarity palette).
const TINTS = [
  { art: 'linear-gradient(160deg,#5a481c,#1a1206)', holo: 'linear-gradient(115deg,rgba(255,120,90,0) 22%,rgba(245,197,66,.6),rgba(255,120,90,0) 78%)', ring: 'rgba(245,197,66,.5)', accent: '#f5c542' },
  { art: 'linear-gradient(160deg,#33245e,#160f2b)', holo: 'linear-gradient(115deg,rgba(196,173,255,0) 22%,rgba(196,173,255,.55),rgba(196,173,255,0) 78%)', ring: 'rgba(139,92,246,.5)', accent: '#c4adff' },
  { art: 'linear-gradient(160deg,#1d3a5c,#0a1622)', holo: 'linear-gradient(115deg,rgba(124,193,255,0) 26%,rgba(124,193,255,.5),rgba(124,193,255,0) 74%)', ring: 'rgba(78,168,255,.45)', accent: '#7cc1ff' },
  { art: 'linear-gradient(160deg,#173f32,#08160f)', holo: 'linear-gradient(115deg,rgba(92,224,180,0) 32%,rgba(92,224,180,.45),rgba(92,224,180,0) 68%)', ring: 'rgba(47,226,138,.45)', accent: '#5ce0b4' },
]

const miniBtn: CSSProperties = {
  width: 26, height: 26, borderRadius: 7, border: 0, background: 'transparent', color: '#cdd4dd',
  cursor: 'pointer', fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
}

export function CreateBattleModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (battleId: string) => void
}) {
  const { identityToken } = useIdentityToken()
  const gate = useDelegationGate()
  const { machines, loading: machinesLoading } = useMachineList()   // shared/cached → instant on reopen
  const [machineCode, setMachineCode] = useState<string>('')   // royale single machine
  const [counts, setCounts] = useState<Record<string, number>>({})   // pack bundle
  const [mode, setMode] = useState<BattleMode>('pack')
  const [players, setPlayers] = useState(4)
  const [sort, setSort] = useState<'low' | 'high'>('low')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isRoyale = mode === 'royale'

  // Default the royale machine selection once the catalogue is available.
  useEffect(() => { setMachineCode((c) => c || machines[0]?.code || '') }, [machines])

  const boxes = totalBoxes(counts)
  const costUsd = bundleCostUsd(counts, machines)
  const royalePrice = machines.find((m) => m.code === machineCode)?.price ?? 0
  // Royale entry per player accounts for every pack opened (1 elimination/round), split across players.
  const royalePulls = royaleTotalPulls(players)
  const total = isRoyale ? royaleEntryUsd(players, royalePrice) : costUsd

  const visible = machines
    .filter((m) => m.available !== false)
    .slice()
    .sort((a, b) => (sort === 'low' ? a.price - b.price : b.price - a.price))

  function step(code: string, delta: number) {
    setCounts((c) => {
      if (delta > 0 && totalBoxes(c) >= MAX_BOXES) return c
      const next = { ...c, [code]: Math.max(0, (c[code] ?? 0) + delta) }
      if (next[code] === 0) delete next[code]
      return next
    })
  }

  const createDisabled = busy || !identityToken || (isRoyale ? !machineCode : boxes === 0)

  function submit() {
    if (!identityToken) return
    if (!isRoyale && boxes === 0) return
    if (isRoyale && !machineCode) return
    gate.requireDelegation(async () => {
      setBusy(true); setError(null)
      try {
        const body = !isRoyale
          ? { packs: bundleToPacks(counts), max_players: players, mode: 'pack' as BattleMode }
          : buildCreateBody('royale', machineCode, players)
        const b = await createBattle(identityToken, body)
        onCreated(b.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    })
  }

  const sectionLabel: CSSProperties = { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.muted, textAlign: 'center', marginBottom: 10 }

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(12px,2.5vw,30px)', background: 'rgba(4,6,9,.74)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ position: 'relative', width: '100%', maxWidth: 780, maxHeight: '92vh', display: 'flex', flexDirection: 'column', borderRadius: 24, background: 'linear-gradient(180deg,#0e1118,#0a0c12)', border: `1px solid ${COLORS.border}`, boxShadow: '0 50px 130px -40px #000', overflow: 'hidden' }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '20px clamp(20px,2.6vw,28px) 18px', borderBottom: `1px solid ${COLORS.border}` }}>
          <span style={{ flex: 'none', width: 44, height: 44, borderRadius: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#8b5cf6,#2fe28a)', boxShadow: '0 0 22px -6px rgba(47,226,138,.7)' }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#06170f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5" /><line x1="13" x2="19" y1="19" y2="13" /><line x1="16" x2="20" y1="16" y2="20" /><line x1="19" x2="21" y1="21" y2="19" /></svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontFamily: FONTS.display, fontSize: 21, fontWeight: 700, letterSpacing: '-.01em' }}>Create battle</h2>
            <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 2 }}>{isRoyale ? 'Pick a machine and player count' : 'Pick your packs and how many of each'}</div>
          </div>
          {!isRoyale && (
            <button onClick={() => setSort((s) => (s === 'low' ? 'high' : 'low'))}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 13px', borderRadius: 11, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: '#cdd4dd', cursor: 'pointer', fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.04em' }}>
              {sort === 'low' ? '↑ Price' : '↓ Price'}
            </button>
          )}
          <button onClick={onClose} aria-label="Close"
            style={{ flex: 'none', width: 36, height: 36, borderRadius: 11, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px clamp(20px,2.6vw,28px)' }}>
          {/* battle mode */}
          <div style={sectionLabel}>BATTLE MODE</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', maxWidth: 480, margin: '0 auto 22px' }}>
            {([['pack', 'Pack', 'Winner takes all'], ['royale', 'Royale', 'Last one standing']] as const).map(([k, label, sub]) => {
              const on = mode === k
              return (
                <button key={k} onClick={() => setMode(k)}
                  style={{ flex: 1, textAlign: 'center', padding: '13px 16px', borderRadius: 13, cursor: 'pointer', fontFamily: FONTS.body,
                    background: on ? 'linear-gradient(180deg,rgba(139,92,246,.22),rgba(139,92,246,.05))' : '#ffffff08',
                    border: `1px solid ${on ? 'rgba(139,92,246,.55)' : COLORS.border}` }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: on ? COLORS.text : '#cdd4dd' }}>{label}</div>
                  <div style={{ fontSize: 11.5, color: on ? '#b3a3e6' : COLORS.muted, marginTop: 3 }}>{sub}</div>
                </button>
              )
            })}
          </div>

          {/* players */}
          <div style={sectionLabel}>PLAYERS</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 22 }}>
            {PLAYER_COUNTS.map((n) => {
              const on = players === n
              return (
                <button key={n} onClick={() => setPlayers(n)}
                  style={{ width: 46, height: 42, borderRadius: 11, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 15, fontWeight: 700,
                    background: on ? COLORS.green : '#ffffff0a', color: on ? '#06170f' : '#cdd4dd',
                    border: `1px solid ${on ? COLORS.green : COLORS.border}` }}>{n}</button>
              )
            })}
          </div>

          {/* packs / machines */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.muted }}>{isRoyale ? 'CHOOSE A MACHINE' : `PACKS · MAX ${MAX_BOXES}`}</span>
            {!isRoyale && <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: boxes >= MAX_BOXES ? '#f5c542' : COLORS.muted }}>{boxes}/{MAX_BOXES}</span>}
          </div>

          {machinesLoading && machines.length === 0 ? (
            <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted, padding: '24px 4px', textAlign: 'center' }}>Loading machines…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(152px,1fr))', gap: 12 }}>
              {visible.map((m, i) => {
                const t = TINTS[i % TINTS.length]
                const count = counts[m.code] ?? 0
                const selected = isRoyale ? machineCode === m.code : count > 0
                const thumb = m.thumbnailUrl ?? m.image ?? null
                const onCard = () => (isRoyale ? setMachineCode(m.code) : step(m.code, +1))
                return (
                  <div key={m.code} style={{ position: 'relative', overflow: 'hidden', borderRadius: 15, border: `1px solid ${selected ? 'rgba(47,226,138,.5)' : COLORS.border}`, background: 'linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.01))' }}>
                    {selected && (
                      <span style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, minWidth: 22, height: 22, padding: '0 6px', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: '#06170f', background: COLORS.green, boxShadow: '0 0 14px -4px rgba(47,226,138,.9)' }}>{isRoyale ? '✓' : count}</span>
                    )}
                    {/* art */}
                    <button onClick={onCard} style={{ display: 'block', width: '100%', border: 0, padding: 0, margin: 0, cursor: 'pointer', background: 'transparent' }}>
                      <div style={{ position: 'relative', height: 108, overflow: 'hidden', background: t.art, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {thumb ? (
                          <img src={thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 5, width: '62%' }}>
                            {Array.from({ length: 6 }).map((_, k) => (
                              <span key={k} style={{ aspectRatio: '0.7', borderRadius: 3, background: 'linear-gradient(160deg,rgba(255,255,255,.16),rgba(255,255,255,.02))', border: `1px solid ${t.ring}` }} />
                            ))}
                          </div>
                        )}
                        <span style={{ position: 'absolute', inset: 0, background: t.holo, backgroundSize: '220% 220%', mixBlendMode: 'color-dodge', opacity: 0.45, animation: 'ba-holo 7s ease-in-out infinite', pointerEvents: 'none' }} />
                        <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '34%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent)', animation: 'ba-sweep 4.2s infinite', pointerEvents: 'none' }} />
                      </div>
                    </button>
                    {/* info */}
                    <div style={{ padding: '11px 12px 12px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e7ecf2', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 9, minHeight: 30 }}>
                        <span style={{ fontFamily: FONTS.mono, fontSize: 13, fontWeight: 700, color: t.accent }}>${m.price}</span>
                        {isRoyale ? (
                          <button onClick={() => setMachineCode(m.code)}
                            style={{ padding: '6px 14px', borderRadius: 9, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 12.5, fontWeight: 600,
                              border: `1px solid ${selected ? 'rgba(47,226,138,.55)' : 'rgba(255,255,255,.12)'}`,
                              background: selected ? 'linear-gradient(180deg,rgba(47,226,138,.20),rgba(47,226,138,.05))' : '#ffffff08',
                              color: selected ? COLORS.green : '#cdd4dd' }}>{selected ? 'Chosen' : 'Choose'}</button>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 1, padding: 2, borderRadius: 9, background: '#ffffff0d', border: '1px solid #ffffff17' }}>
                            <button aria-label="−" onClick={() => step(m.code, -1)} disabled={count === 0} style={{ ...miniBtn, opacity: count === 0 ? 0.4 : 1 }}>−</button>
                            <span style={{ minWidth: 18, textAlign: 'center', fontSize: 13, fontWeight: 700 }}>{count}</span>
                            <button aria-label="+" onClick={() => step(m.code, +1)} disabled={boxes >= MAX_BOXES} style={{ ...miniBtn, opacity: boxes >= MAX_BOXES ? 0.4 : 1 }}>+</button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {error && (
            <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red, marginTop: 14, wordBreak: 'break-word' }}>ERROR: {error}</div>
          )}
        </div>

        {/* footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', padding: '15px clamp(20px,2.6vw,28px)', borderTop: `1px solid ${COLORS.border}`, background: '#ffffff05' }}>
          <div style={{ marginRight: 'auto' }}>
            <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, letterSpacing: '.06em', color: COLORS.muted }}>
              {isRoyale
                ? `entry per player · ${royalePulls} packs over ${Math.max(0, players - 1)} rounds`
                : `${boxes}/${MAX_BOXES} packs · entry per player`}
            </div>
            <div style={{ fontFamily: FONTS.display, fontSize: 21, fontWeight: 700, letterSpacing: '-.01em', color: COLORS.green, marginTop: 2 }}>{formatUsd(total)}</div>
          </div>
          <button onClick={onClose} disabled={busy}
            style={{ padding: '13px 22px', borderRadius: 13, border: `1px solid ${COLORS.border}`, background: '#ffffff08', color: COLORS.text, cursor: busy ? 'default' : 'pointer', fontFamily: FONTS.body, fontSize: 14.5, fontWeight: 600 }}>Cancel</button>
          <button onClick={submit} disabled={createDisabled}
            style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 8, padding: '13px 28px', borderRadius: 13, border: 0, cursor: createDisabled ? 'default' : 'pointer', fontFamily: FONTS.display, fontSize: 15, fontWeight: 700, color: '#06170f', background: 'linear-gradient(120deg,#8b5cf6,#2fe28a)', boxShadow: '0 12px 34px -12px rgba(47,226,138,.6)', opacity: createDisabled ? 0.5 : 1 }}>
            {!createDisabled && <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent)', animation: 'ba-sweep 3.4s infinite' }} />}
            <span style={{ position: 'relative' }}>{busy ? 'Creating…' : 'Create battle'}</span>
          </button>
        </div>
      </div>
      <DelegationGate gate={gate} />
    </div>
  )
}
