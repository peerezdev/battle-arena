import { motion } from 'framer-motion'
import { COLORS, FONTS, formatUsd } from '../theme'
import type { PendingPack } from '../../onchain/gachaClient'
import type { UnseenBattle } from '../../onchain/packBattleClient'
import { packTitle, priceFromCode } from '../screens/gacha/GachaPackTilt'

// Un solo modal al entrar con TODO lo que el jugador no ha visto: sobres pagados sin abrir y
// batallas terminadas sin ver. Una interrupción, no dos modales apilados.
//
// El modal es un índice SIN spoilers: una batalla jugada dice "Finished — result unseen", nunca
// el resultado — para eso están sus botones (revivirla o ir al resultado). Los sobres van
// agrupados en una tarjeta (abanico + total pagado), no fila a fila: lo que importa es cuántos
// quedan y cuánto valen, y las salidas son abrirlos todos o saltar al resumen.

const GREEN_GRAD = 'linear-gradient(135deg,#3df0a0,#13c98a)'
const PURPLE = '184,78,240'

const swordIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4l5.5 5.5L9.5 20 4 14.5 14.5 4z" /></svg>
)
const crownIcon = (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.52l4.276 3.664a1 1 0 0 0 1.516-.294z" /><path d="M5 21h14" /></svg>
)

export function UnseenModal({
  packs, battles, busy,
  onOpenAllPacks, onSkipPacks,
  onWatchBattle, onResultBattle, onSeeAllBattles,
}: {
  packs: PendingPack[]
  battles: UnseenBattle[]
  busy: boolean
  onOpenAllPacks: () => void
  onSkipPacks: () => void
  onWatchBattle: (b: UnseenBattle) => void      // revivir la batalla completa (reveal)
  onResultBattle: (b: UnseenBattle) => void     // ir directo al resultado
  onSeeAllBattles: () => void                   // darlas todas por vistas sin entrar en ninguna
}) {
  const np = packs.length
  const nb = battles.length
  // Sin ninguna jugada (todo anuladas/canceladas) no hay resultado que asumir: la salida es un
  // simple "Continue". Con alguna jugada, el botón dice que estás dando por vistos resultados.
  const allRefunded = nb > 0 && battles.every((b) => b.status === 'voided' || b.status === 'cancelled')

  // Sobres agrupados por máquina — el título del bloque depende de si hay una o varias.
  const byMachine = new Map<string, number>()
  for (const p of packs) byMachine.set(p.pack_type, (byMachine.get(p.pack_type) ?? 0) + 1)
  const packsValue = packs.reduce((s, p) => s + (priceFromCode(p.pack_type) ?? 0), 0)
  const machineTitle = (code: string) => packTitle(code).join(' ').trim()
  const packsHeading = byMachine.size === 1
    ? `${np} × ${machineTitle(packs[0].pack_type)}`
    : `${np} packs`
  const packsMix = byMachine.size > 1
    ? [...byMachine.entries()].map(([c, n]) => `${n} × ${machineTitle(c)}`).join(' · ')
    : null

  const sub = [
    nb > 0 ? `${nb} battle${nb === 1 ? '' : 's'} to see` : null,
    np > 0 ? `${np} pack${np === 1 ? '' : 's'} unopened` : null,
  ].filter(Boolean).join(' · ')

  const ghostBtn = (label: string, onClick: () => void, opts?: { grow?: boolean; key?: string }) => (
    <button key={opts?.key} className="ba-ghostbtn" onClick={onClick} disabled={busy}
      style={{ flex: opts?.grow ? 1 : 'none', padding: opts?.grow ? '10px 0' : '9px 16px', borderRadius: 11,
        cursor: busy ? 'default' : 'pointer', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600,
        color: busy ? COLORS.muted : '#cdd4dd', background: 'rgba(255,255,255,.04)',
        border: '1px solid rgba(255,255,255,.12)' }}>{label}</button>
  )
  const primaryBtn = (label: React.ReactNode, onClick: () => void) => (
    <button onClick={onClick} disabled={busy}
      style={{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 7,
        padding: '10px 0', borderRadius: 11, border: 0, cursor: busy ? 'default' : 'pointer',
        fontFamily: FONTS.body, fontSize: 13, fontWeight: 700, color: '#06170f',
        background: busy ? COLORS.panel2 : GREEN_GRAD,
        boxShadow: busy ? 'none' : '0 0 18px -6px rgba(47,226,138,.7)',
        ...(busy ? { color: COLORS.muted, border: `1px solid ${COLORS.border}` } : {}) }}>{label}</button>
  )

  return (
    <motion.div key="unseen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(3,4,6,.72)', backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)', zIndex: 210,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: 460, maxWidth: '100%', maxHeight: '88vh', overflowY: 'auto',
        borderRadius: 20, background: 'linear-gradient(180deg,#12161e,#0c0f15)',
        border: '1px solid rgba(255,255,255,.1)', boxShadow: '0 30px 80px -20px rgba(0,0,0,.8)',
        padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>

        <div>
          <div style={{ fontFamily: FONTS.display, fontSize: 21, fontWeight: 700, letterSpacing: '-.01em', color: COLORS.text }}>
            While you were away…
          </div>
          {sub && <div style={{ fontSize: 13, color: '#7a8492', marginTop: 4 }}>{sub}</div>}
        </div>

        {/* ── Batallas sin ver ─────────────────────────────────────────────── */}
        {battles.map((b) => {
          const refunded = b.status === 'voided' || b.status === 'cancelled'
          return (
            <div key={b.battle_id} style={{ padding: 14, borderRadius: 14,
              background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 12, display: 'grid', placeItems: 'center',
                  background: 'linear-gradient(135deg,#b84ef0,#ff5c98)',
                  boxShadow: refunded ? 'none' : '0 0 18px -6px rgba(255,92,152,.7)',
                  opacity: refunded ? 0.55 : 1 }}>
                  {b.mode === 'royale' ? crownIcon : swordIcon}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: COLORS.text,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {b.mode === 'royale' ? 'Royale' : 'Pack Battle'} · {machineTitle(b.machine_code)}
                  </span>
                  {/* Sin spoiler: una batalla jugada solo dice que terminó. El resultado se ve
                      entrando — o se asume al pulsar Resolve. */}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: FONTS.mono, fontSize: 11.5,
                    color: '#7a8492', marginTop: 2 }}>
                    {!refunded && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f5c542',
                      boxShadow: '0 0 6px #f5c542', animation: 'ba-pulse 1.6s infinite' }} />}
                    {refunded
                      ? (b.status === 'cancelled' ? 'Cancelled · refunded' : 'Voided · refunded')
                      : 'Finished — result unseen'}
                  </span>
                </span>
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                {refunded
                  ? ghostBtn('View', () => onResultBattle(b), { grow: true })
                  : (<>
                      {primaryBtn(<><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>Replay battle</>, () => onWatchBattle(b))}
                      {ghostBtn('See result', () => onResultBattle(b), { grow: true })}
                    </>)}
              </div>
            </div>
          )
        })}

        {/* Salida en bloque. Entrar en cada batalla es opcional, no un peaje: esto las da todas
            por vistas. Si todo son reembolsos no hay resultado que asumir → "Continue". */}
        {nb > 0 && (
          <button className="ba-ghostbtn" onClick={onSeeAllBattles} disabled={busy}
            style={{ width: '100%', borderRadius: 12, padding: '11px 18px', fontSize: 13, fontWeight: 700,
              fontFamily: FONTS.body, cursor: busy ? 'default' : 'pointer', marginTop: -6,
              border: `1px solid ${COLORS.border}`, background: 'transparent',
              color: busy ? COLORS.muted : COLORS.text }}>
            {allRefunded ? 'Continue' : nb > 1 ? `Resolve all ${nb}` : 'Resolve'}
          </button>
        )}

        {/* ── Sobres sin abrir — una tarjeta con el abanico y el total ─────── */}
        {np > 0 && (
          <div style={{ padding: '16px 14px 14px', borderRadius: 14,
            background: `linear-gradient(180deg,rgba(${PURPLE},.07),rgba(255,255,255,.02))`,
            border: `1px solid rgba(${PURPLE},.25)` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* abanico de sobres */}
              <span style={{ flex: 'none', position: 'relative', width: 64, height: 66 }}>
                <span style={{ position: 'absolute', left: 2, top: 6, width: 38, height: 54, borderRadius: 6,
                  background: 'linear-gradient(160deg,#2a1e42,#171026)', border: `1px solid rgba(${PURPLE},.4)`, transform: 'rotate(-10deg)' }} />
                <span style={{ position: 'absolute', left: 12, top: 3, width: 38, height: 54, borderRadius: 6,
                  background: 'linear-gradient(160deg,#33254e,#1b1330)', border: `1px solid rgba(${PURPLE},.5)`, transform: 'rotate(-1deg)' }} />
                <span style={{ position: 'absolute', left: 22, top: 5, width: 38, height: 54, borderRadius: 6, display: 'grid', placeItems: 'center',
                  background: 'linear-gradient(160deg,#3d2c5e,#211739)', border: `1px solid rgba(${PURPLE},.65)`, transform: 'rotate(9deg)',
                  boxShadow: `0 6px 18px -6px rgba(${PURPLE},.6)` }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#d9b8f5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="13" rx="2" /><circle cx="12" cy="9" r="3" /></svg>
                </span>
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 15, fontWeight: 700, color: COLORS.text }}>{packsHeading}</span>
                {packsMix && <span style={{ display: 'block', fontSize: 11.5, color: '#9a86b8', marginTop: 2 }}>{packsMix}</span>}
                {packsValue > 0 && (
                  <span style={{ display: 'block', fontSize: 12, color: '#9a86b8', marginTop: 2 }}>
                    {formatUsd(packsValue)} in packs to reveal
                  </span>
                )}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              {primaryBtn(busy ? 'Opening…' : np > 1 ? `Open all ${np}` : 'Open pack', onOpenAllPacks)}
              {ghostBtn(busy ? 'Skipping…' : 'Skip to results', onSkipPacks, { grow: true })}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
