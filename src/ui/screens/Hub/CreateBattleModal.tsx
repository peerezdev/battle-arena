import { useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import { fetchMachines, type GachaMachine } from '../../../onchain/gachaClient'
import { createBattle, type BattleMode } from '../../../onchain/packBattleClient'
import { buildCreateBody } from './createBattleBody'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 8, 10]

export function CreateBattleModal({ onClose, onCreated }: {
  onClose: () => void; onCreated: (battleId: string) => void
}) {
  const { identityToken } = useIdentityToken()
  const gate = useDelegationGate()
  const [machines, setMachines] = useState<GachaMachine[]>([])
  const [machineCode, setMachineCode] = useState<string>('')
  const [mode, setMode] = useState<BattleMode>('pack')
  const [players, setPlayers] = useState(4)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchMachines()
      .then((m) => { if (!cancelled) { setMachines(m); setMachineCode((c) => c || m[0]?.code || '') } })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [])

  function submit() {
    if (!identityToken || !machineCode) return
    gate.requireDelegation(async () => {
      setBusy(true); setError(null)
      try {
        const body = buildCreateBody(mode, machineCode, players)
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
    <div
      role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: '#000000aa', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`,
          borderRadius: 14, padding: 22, maxWidth: 420, width: '100%' }}
      >
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 17, color: COLORS.text, marginBottom: 14 }}>
          Crear batalla
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['pack', 'royale'] as BattleMode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)}
              style={{ flex: 1, padding: '10px 0', borderRadius: 10, cursor: 'pointer',
                fontWeight: 700, fontFamily: FONTS.display,
                background: mode === m ? 'linear-gradient(90deg,#9945FF33,#14F19522)' : '#0c1019',
                color: mode === m ? COLORS.text : COLORS.muted,
                border: `1px solid ${mode === m ? '#9945FF44' : COLORS.border}` }}>
              {m === 'pack' ? 'Pack · 1v1' : 'Royale'}
            </button>
          ))}
        </div>

        {/* Machine picker */}
        <label style={{ fontSize: 11, color: COLORS.muted }}>Machine</label>
        <select value={machineCode} onChange={(e) => setMachineCode(e.target.value)}
          style={{ width: '100%', margin: '6px 0 14px', padding: '10px',
            background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`, borderRadius: 10 }}>
          {machines.map((m) => (
            <option key={m.code} value={m.code}>{m.name} · ${m.price}</option>
          ))}
        </select>

        {/* Player count */}
        <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: COLORS.muted }}>Jugadores</label>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {PLAYER_COUNTS.map((n) => (
                <button key={n} onClick={() => setPlayers(n)}
                  style={{ width: 44, padding: '8px 0', borderRadius: 9, cursor: 'pointer',
                    background: players === n ? COLORS.green : '#0c1019',
                    color: players === n ? '#03110a' : COLORS.muted,
                    border: `1px solid ${COLORS.border}`, fontWeight: 700 }}>
                  {n}
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
            Cancelar
          </button>
          <button onClick={submit} disabled={busy || !identityToken || !machineCode}
            style={{ background: busy ? COLORS.panel2 : COLORS.green, color: busy ? COLORS.muted : '#03110a',
              border: 'none', borderRadius: 10, padding: '10px 18px', fontWeight: 800,
              fontFamily: FONTS.display, cursor: busy ? 'wait' : 'pointer' }}>
            {busy ? 'Creando…' : 'Crear'}
          </button>
        </div>
      </div>
      <DelegationGate gate={gate} />
    </div>
  )
}
