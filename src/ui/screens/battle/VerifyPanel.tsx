import { useEffect, useState, type CSSProperties } from 'react'
import { COLORS, FONTS } from '../../theme'
import { verifyBattle, type Verification } from '../../../onchain/packBattleClient'
import { verifyCommit } from '../../../onchain/pfVerify'
import { shortWallet } from './RoyaleReveal'

type CommitState = 'pending' | 'ok' | 'mismatch' | 'unrevealed' | 'na'

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '.08em' }}>{label}</div>
      <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.text, wordBreak: 'break-all' }}>{value}</div>
    </div>
  )
}

export function VerifyPanel({ battleId, onClose }: { battleId: string; onClose: () => void }) {
  const [v, setV] = useState<Verification | null>(null)
  const [error, setError] = useState(false)
  const [commit, setCommit] = useState<CommitState>('pending')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await verifyBattle(battleId)
        if (!cancelled) setV(res)
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => { cancelled = true }
  }, [battleId])

  useEffect(() => {
    if (!v) return
    if (!v.server_seed_hash) { setCommit('na'); return }
    if (!v.server_seed) { setCommit('unrevealed'); return }
    let cancelled = false
    setCommit('pending')
    verifyCommit(v.server_seed, v.server_seed_hash).then((ok) => {
      if (!cancelled) setCommit(ok ? 'ok' : 'mismatch')
    })
    return () => { cancelled = true }
  }, [v])

  const verdictColor = commit === 'ok' ? COLORS.green : commit === 'mismatch' ? COLORS.red : COLORS.muted

  return (
    <div role="dialog" aria-modal="true" onClick={onClose} style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={panel}>
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.text, marginBottom: 12 }}>
          Verificación Provably-Fair
        </div>

        {error && <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.red }}>No se pudo cargar la verificación</div>}
        {!error && !v && <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>Cargando…</div>}

        {v && (
          <>
            <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, marginBottom: 12, color: verdictColor }}>
              {commit === 'ok' && '✓ Commit verificado'}
              {commit === 'mismatch' && '✗ El hash no coincide'}
              {commit === 'unrevealed' && '🔒 La semilla se revela al terminar la batalla'}
              {commit === 'pending' && 'verificando…'}
              {commit === 'na' && '—'}
            </div>

            <Field label="server_seed_hash" value={v.server_seed_hash ?? '—'} />
            {v.server_seed && <Field label="server_seed" value={v.server_seed} />}

            {v.mode === 'royale' ? (
              <div style={{ marginTop: 8 }}>
                {(v.rounds ?? []).map((r) => (
                  <div key={r.round_number} style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted, marginBottom: 6, wordBreak: 'break-all' }}>
                    Ronda {r.round_number} · eliminado {shortWallet(r.eliminated_wallet)} · tie {r.tie_break_index ?? '—'}
                    <div>client_seed: {r.client_seed}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ marginTop: 8 }}>
                <Field label="client_seed" value={v.client_seed ?? '—'} />
                <Field label="tie_break_index" value={String(v.tie_break_index ?? '—')} />
              </div>
            )}

            <div style={{ fontSize: 11, color: COLORS.muted, lineHeight: 1.5, marginTop: 12 }}>
              El operador se comprometió a <b>server_seed_hash</b> antes de la batalla. Al revelar el
              <b> server_seed</b> y comprobar que su SHA-256 coincide con ese hash, se prueba que la semilla no
              se cambió. Los <b>client_seed</b>/<b>tie_break_index</b> por ronda son los sorteos registrados.
            </div>
          </>
        )}

        <button onClick={onClose} style={closeBtn}>Volver</button>
      </div>
    </div>
  )
}

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, background: '#000000aa', zIndex: 50,
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
}
const panel: CSSProperties = {
  background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 14,
  padding: 22, maxWidth: 440, width: '100%', maxHeight: '80vh', overflowY: 'auto',
}
const closeBtn: CSSProperties = {
  marginTop: 16, background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
  borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
}
