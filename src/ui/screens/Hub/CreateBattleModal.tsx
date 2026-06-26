import { useEffect, useState, type CSSProperties } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useMachineList } from '../../useMachines'
import { createBattle, type BattleMode } from '../../../onchain/packBattleClient'
import { buildCreateBody, bundleToPacks, totalBoxes, bundleCostUsd } from './createBattleBody'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 8, 10]
const MAX_BOXES = 10

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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Default the royale machine selection once the catalogue is available.
  useEffect(() => {
    setMachineCode((c) => c || machines[0]?.code || '')
  }, [machines])

  const boxes = totalBoxes(counts)
  const costUsd = bundleCostUsd(counts, machines)

  function step(code: string, delta: number) {
    setCounts((c) => {
      if (delta > 0 && totalBoxes(c) >= MAX_BOXES) return c
      return { ...c, [code]: Math.max(0, (c[code] ?? 0) + delta) }
    })
  }

  const createDisabled = busy || !identityToken
    || (mode === 'pack' ? boxes === 0 : !machineCode)

  function submit() {
    if (!identityToken) return
    if (mode === 'pack' && boxes === 0) return
    if (mode === 'royale' && !machineCode) return
    gate.requireDelegation(async () => {
      setBusy(true); setError(null)
      try {
        const body = mode === 'pack'
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

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`,
          borderRadius: 14, padding: 22, maxWidth: 420, width: '100%' }}>
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 17, color: COLORS.text, marginBottom: 14 }}>
          Create battle
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['pack', 'royale'] as BattleMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                fontWeight: 700, fontFamily: FONTS.display,
                background: mode === m ? 'linear-gradient(90deg,#8b5cf633,#2fe28a22)' : '#0c1019',
                color: mode === m ? COLORS.text : COLORS.muted,
                border: `1px solid ${mode === m ? '#8b5cf644' : COLORS.border}` }}>
              {m === 'pack' ? 'Pack' : 'Royale'}
            </button>
          ))}
        </div>

        {mode === 'pack' ? (
          /* Bundle builder */
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: COLORS.muted }}>Bundle boxes (max {MAX_BOXES})</label>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {machinesLoading && machines.length === 0 && (
                <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted, padding: '14px 4px' }}>Loading machines…</div>
              )}
              {machines.filter((m) => m.available !== false).map((m) => {
                const n = counts[m.code] ?? 0
                return (
                  <div key={m.code} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#0c1019',
                    border: `1px solid ${COLORS.border}`, borderRadius: 9, padding: '8px 10px' }}>
                    <span style={{ flex: 1, fontSize: 12, color: COLORS.text }}>{m.name}</span>
                    <span style={{ fontSize: 11, color: COLORS.muted }}>${m.price}</span>
                    <button aria-label="−" onClick={() => step(m.code, -1)} disabled={n === 0} style={stepBtn}>−</button>
                    <span style={{ width: 18, textAlign: 'center', fontFamily: FONTS.mono, color: COLORS.text }}>{n}</span>
                    <button aria-label="+" onClick={() => step(m.code, +1)} disabled={boxes >= MAX_BOXES} style={stepBtn}>+</button>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 8, fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>
              {boxes}/{MAX_BOXES} boxes · {formatUsd(costUsd)} total
            </div>
          </div>
        ) : (
          /* Royale: single machine */
          <>
            <label style={{ fontSize: 11, color: COLORS.muted }}>Machine</label>
            <select value={machineCode} onChange={(e) => setMachineCode(e.target.value)}
              style={{ width: '100%', margin: '6px 0 14px', padding: '10px',
                background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 10 }}>
              {machines.map((m) => (
                <option key={m.code} value={m.code}>{m.name} · ${m.price}</option>
              ))}
            </select>
          </>
        )}

        {/* Player count */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: COLORS.muted }}>Players</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {PLAYER_COUNTS.map((nn) => (
              <button key={nn} onClick={() => setPlayers(nn)}
                style={{ width: 44, padding: '8px 0', borderRadius: 9, cursor: 'pointer',
                  background: players === nn ? COLORS.green : '#0c1019',
                  color: players === nn ? '#03110a' : COLORS.muted,
                  border: `1px solid ${COLORS.border}`, fontWeight: 700 }}>
                {nn}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red, marginBottom: 12, wordBreak: 'break-word' }}>
            ERROR: {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}
            style={{ background: 'transparent', color: COLORS.muted, border: `1px solid ${COLORS.border}`,
              borderRadius: 10, padding: '10px 16px', fontWeight: 600, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={createDisabled}
            style={{ background: busy ? COLORS.panel2 : COLORS.green, color: busy ? COLORS.muted : '#03110a',
              border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 800,
              fontFamily: FONTS.display, cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
      <DelegationGate gate={gate} />
    </div>
  )
}

const stepBtn: CSSProperties = {
  width: 26, height: 26, borderRadius: 7, border: `1px solid ${COLORS.border}`,
  background: '#161b24', color: COLORS.text, cursor: 'pointer', fontWeight: 800, lineHeight: 1,
}
