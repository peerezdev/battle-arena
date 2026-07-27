import { motion } from 'framer-motion'
import { COLORS, FONTS, GRADIENT, SHADOW, formatUsd } from '../theme'
import type { PendingPack } from '../../onchain/gachaClient'
import type { UnseenBattle } from '../../onchain/packBattleClient'
import { packTitle } from '../screens/gacha/GachaPackTilt'

// Un solo modal al entrar con TODO lo que el jugador no ha visto: sobres pagados sin abrir y
// batallas terminadas sin ver. Una interrupción, no dos modales apilados.
//
// El modal es un índice: cada cosa es una acción que te lleva a verla. Abrir un sobre navega al
// gacha (donde vive su reveal); ver una batalla navega a la batalla. El detalle de por qué
// existe cada lista está en sus servicios; aquí solo se listan y se lanzan.

export function UnseenModal({
  packs, battles, busy,
  onOpenPack, onOpenAllPacks, onSkipPacks,
  onWatchBattle, onResultBattle, onSeeAllBattles,
}: {
  packs: PendingPack[]
  battles: UnseenBattle[]
  busy: boolean
  onOpenPack: (memo: string) => void
  onOpenAllPacks: () => void
  onSkipPacks: () => void
  onWatchBattle: (b: UnseenBattle) => void      // ver la batalla completa (reveal)
  onResultBattle: (b: UnseenBattle) => void     // ir directo al resultado
  onSeeAllBattles: () => void                   // darlas todas por vistas sin entrar en ninguna
}) {
  const np = packs.length
  const nb = battles.length
  // Sin ninguna jugada (todo anuladas/canceladas) no hay resultado que asumir: la salida es un
  // simple "Continue". Con alguna jugada, el botón dice que estás dando por vistos resultados.
  const allRefunded = nb > 0 && battles.every((b) => b.status === 'voided' || b.status === 'cancelled')

  const sectionLabel = (t: string) => (
    <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.16em', color: COLORS.muted,
      textTransform: 'uppercase', marginBottom: 2 }}>{t}</div>
  )
  const ghost = (label: string, onClick: () => void, key?: string) => (
    <button key={key} className="ba-ghostbtn" onClick={onClick} disabled={busy}
      style={{ flexShrink: 0, borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 800,
        fontFamily: FONTS.display, cursor: busy ? 'default' : 'pointer',
        border: `1px solid ${COLORS.border}`, background: 'transparent',
        color: busy ? COLORS.muted : COLORS.text }}>{label}</button>
  )

  return (
    <motion.div key="unseen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,8,11,0.9)', zIndex: 210,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16,
        padding: '26px 22px', width: '100%', maxWidth: 440, boxShadow: SHADOW.panel,
        maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 18 }}>

        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 20, color: COLORS.text }}>
          You've got things waiting
        </div>

        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
          {/* ── Batallas sin ver ─────────────────────────────────────────── */}
          {nb > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sectionLabel(`${nb} battle${nb === 1 ? '' : 's'} to see`)}
              {battles.map((b) => {
                const [prefix, suffix] = packTitle(b.machine_code)
                // Anulada y cancelada comparten trato: entrada devuelta, nada que revelar → una
                // sola acción ("View"), que sólo confirma qué pasó con la partida.
                const refunded = b.status === 'voided' || b.status === 'cancelled'
                const tint = refunded ? COLORS.muted : b.won ? COLORS.green : COLORS.red
                const label = b.status === 'cancelled' ? 'Cancelled · refunded'
                  : b.status === 'voided' ? 'Voided · refunded'
                  : b.won ? 'You won' : 'You lost'
                return (
                  <div key={b.battle_id} style={{ display: 'flex', alignItems: 'center', gap: 10,
                    background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '10px 12px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 13, color: COLORS.text }}>
                        {b.mode === 'royale' ? 'Royale' : 'Pack Battle'} · {prefix} {suffix}
                      </div>
                      <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, color: tint, marginTop: 2 }}>
                        {label}{!refunded && ` · ${b.amount_usd >= 0 ? '+' : '−'}${formatUsd(Math.abs(b.amount_usd))}`}
                      </div>
                    </div>
                    {refunded
                      ? ghost('View', () => onResultBattle(b))
                      : (<div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          {ghost('Watch', () => onWatchBattle(b), 'w')}
                          {ghost('Result', () => onResultBattle(b), 'r')}
                        </div>)}
                  </div>
                )
              })}
              {/* Salida en bloque. Cada fila YA dice qué pasó ("You won · +$160"), así que no hay
                  nada que revelar aquí: entrar en cada batalla es opcional, no un peaje. El texto
                  cambia según lo que hay — si todo son reembolsos no hay resultado que asumir. */}
              <button className="ba-ghostbtn" onClick={onSeeAllBattles} disabled={busy}
                style={{ width: '100%', borderRadius: 12, padding: '11px 18px', fontSize: 13, fontWeight: 700,
                  fontFamily: FONTS.body, cursor: busy ? 'default' : 'pointer', marginTop: 2,
                  border: `1px solid ${COLORS.border}`, background: 'transparent',
                  color: busy ? COLORS.muted : COLORS.text }}>
                {allRefunded ? 'Continue' : nb > 1 ? `Resolve all ${nb}` : 'Resolve'}
              </button>
            </div>
          )}

          {/* ── Sobres sin abrir ─────────────────────────────────────────── */}
          {np > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {sectionLabel(`${np} pack${np === 1 ? '' : 's'} to open`)}
              {packs.map((p) => {
                const [prefix, suffix] = packTitle(p.pack_type)
                return (
                  <div key={p.memo} style={{ display: 'flex', alignItems: 'center', gap: 12,
                    background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '10px 12px' }}>
                    <span style={{ flex: 1, fontFamily: FONTS.display, fontWeight: 700, fontSize: 14, color: COLORS.text }}>
                      {prefix} {suffix}
                    </span>
                    {ghost('Open', () => onOpenPack(p.memo))}
                  </div>
                )
              })}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 2 }}>
                {np > 1 && (
                  <button className="ba-ghostbtn" onClick={onOpenAllPacks} disabled={busy}
                    style={{ width: '100%', borderRadius: 12, padding: '12px 18px', fontSize: 14, fontWeight: 800,
                      fontFamily: FONTS.display, cursor: busy ? 'default' : 'pointer',
                      border: busy ? `1px solid ${COLORS.border}` : 'none',
                      background: busy ? COLORS.panel2 : GRADIENT, color: busy ? COLORS.muted : '#06120c' }}>
                    {busy ? 'Opening…' : `Open all ${np}`}
                  </button>
                )}
                <button className="ba-ghostbtn" onClick={onSkipPacks} disabled={busy}
                  style={{ width: '100%', borderRadius: 12, padding: '11px 18px', fontSize: 13, fontWeight: 700,
                    fontFamily: FONTS.body, cursor: busy ? 'default' : 'pointer',
                    border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text }}>
                  {busy ? 'Skipping…' : 'Skip — just tell me what I got'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
