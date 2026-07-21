import { motion } from 'framer-motion'
import { COLORS, FONTS, GRADIENT, SHADOW } from '../../theme'
import type { PendingPack } from '../../../onchain/gachaClient'
import { packTitle } from './GachaPackTilt'

// Sobres pagados y sin abrir.
//
// Aparece al entrar al gacha cuando quedan sobres pendientes: pasa si abres otra pestaña a mitad
// de una tirada, o si cierras la página antes de revelar. Hasta ahora esos sobres quedaban
// huérfanos —pagados y sin forma de llegar a ellos desde la interfaz—, así que esto no es solo
// comodidad: es la única vía de recuperar algo que el jugador ya ha pagado.
//
// Mientras está abierto, el saldo sigue congelado: si se actualizara aquí, el auto-buyback del
// turbo delataría lo que hay dentro antes de abrirlo.

export function PendingPacksModal({ packs, busy, onOpenOne, onOpenAll, onDismiss }: {
  packs: PendingPack[]
  busy: boolean
  onOpenOne: (memo: string) => void
  onOpenAll: () => void
  onDismiss: () => void
}) {
  const n = packs.length
  return (
    <motion.div key="pending-packs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,8,11,0.9)', zIndex: 210,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16,
        padding: '26px 22px', width: '100%', maxWidth: 420, boxShadow: SHADOW.panel,
        maxHeight: '86vh', display: 'flex', flexDirection: 'column', gap: 16 }}>

        <div>
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 20, color: COLORS.text }}>
            You have {n} pack{n === 1 ? '' : 's'} to open
          </div>
          <div style={{ fontFamily: FONTS.body, fontSize: 13, color: COLORS.muted, marginTop: 6 }}>
            {n === 1 ? "It's paid for and waiting." : "They're paid for and waiting."} Open{' '}
            {n === 1 ? 'it' : 'them'} whenever you like — nothing is lost.
          </div>
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0 }}>
          {packs.map((p) => {
            const [prefix, suffix] = packTitle(p.pack_type)
            return (
              <div key={p.memo} style={{ display: 'flex', alignItems: 'center', gap: 12,
                background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 10,
                padding: '10px 12px' }}>
                <span style={{ flex: 1, fontFamily: FONTS.display, fontWeight: 700, fontSize: 14, color: COLORS.text }}>
                  {prefix} {suffix}
                </span>
                <button onClick={() => onOpenOne(p.memo)} disabled={busy}
                  style={{ flexShrink: 0, borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 800,
                    fontFamily: FONTS.display, cursor: busy ? 'default' : 'pointer',
                    border: `1px solid ${COLORS.border}`, background: 'transparent',
                    color: busy ? COLORS.muted : COLORS.text }}>
                  Open
                </button>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {n > 1 && (
            <button onClick={onOpenAll} disabled={busy}
              style={{ width: '100%', borderRadius: 12, padding: '13px 18px', fontSize: 14, fontWeight: 800,
                fontFamily: FONTS.display, cursor: busy ? 'default' : 'pointer',
                border: busy ? `1px solid ${COLORS.border}` : 'none',
                background: busy ? COLORS.panel2 : GRADIENT, color: busy ? COLORS.muted : '#06120c' }}>
              {busy ? 'Opening…' : `Open all ${n}`}
            </button>
          )}
          <button onClick={onDismiss} disabled={busy}
            style={{ width: '100%', borderRadius: 12, padding: '11px 18px', fontSize: 13, fontWeight: 700,
              fontFamily: FONTS.body, cursor: busy ? 'default' : 'pointer',
              border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.muted }}>
            Later
          </button>
        </div>
      </div>
    </motion.div>
  )
}
