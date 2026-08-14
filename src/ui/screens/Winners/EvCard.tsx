import { COLORS, FONTS } from '../../theme'
import type { EvRow } from '../../../onchain/gachaClient'
import { RATIO_MAX, RATIO_MIN, anguloAguja, esConcluyente, estadoDe, etiqueta, ratioDesdeEdge }
  from './evDial'

/**
 * Una máquina del gacha medida sobre el feed público de Collector Crypt.
 *
 * El dial marca el ratio MEDIDO: cuánto devuelve el sobre por cada dólar que cuesta, con 1.00
 * justo arriba. Se eligió por ser comparable de un vistazo entre tarjetas sin leer una cifra.
 *
 * Cuando llegue el pool de cartas (fase 2), el ratio del MODELO entra como una marca fija en este
 * mismo arco, y la distancia entre marca y aguja responde a "¿se comporta como debería?".
 *
 * Regla que manda sobre el color: si el veredicto no se sostiene —ventana a medias, hueco dentro,
 * muestra corta— el número se pinta en gris aunque sea malísimo. Un rojo fuerte sobre seis horas de
 * datos afirma algo que los datos no dicen.
 */
export function EvCard({ fila, nota }: { fila: EvRow; nota?: string }) {
  const estado = estadoDe(fila.realized_verdict)
  const concluyente = esConcluyente(estado)
  const ratio = ratioDesdeEdge(fila.realized_edge_pct)
  const lab = etiqueta(estado, fila)

  const tinta = !concluyente ? COLORS.muted
    : (fila.realized_edge_pct ?? 0) < 0 ? COLORS.red : COLORS.green
  const ambar = '#f5c542'
  const tintaEtiqueta = estado === 'construyendo' || estado === 'con_hueco' ? ambar : tinta

  return (
    <article style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 14,
      boxShadow: '0 8px 24px #00000055', display: 'flex', flexDirection: 'column',
    }}>
      <header style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8,
        padding: '13px 15px 11px', borderBottom: `1px solid ${COLORS.border}`,
      }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, letterSpacing: '-.01em' }}>{fila.name}</span>
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted, whiteSpace: 'nowrap' }}>
          ${fila.pack_price}
          {fila.buyback_pct ? ` · bb ${Math.round(fila.buyback_pct * 100)}%` : ''}
        </span>
      </header>

      <div style={{ padding: '13px 15px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <Dial ratio={ratio} tinta={tinta} />
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: FONTS.mono, fontSize: 25, fontWeight: 700, lineHeight: 1, color: tinta,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {ratio == null ? '—' : ratio.toFixed(3)}
          </div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.muted, marginTop: 5, lineHeight: 1.55 }}>
            {fila.realized_edge_pct == null ? 'no measurement yet' : (
              <>
                edge {fila.realized_edge_pct > 0 ? '+' : ''}{fila.realized_edge_pct.toFixed(2)}%<br />
                {fila.realized_ci_lo_pct != null && (
                  <>95% CI {fila.realized_ci_lo_pct.toFixed(2)} … {fila.realized_ci_hi_pct?.toFixed(2)}</>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Rachas por rareza. Se enseñan SIEMPRE, también sin veredicto: se miden sobre las tiradas
          observadas y no dependen de que la ventana esté completa.

          Dice "cold", nunca "due". El gacha usa VRF y cada tirada es independiente: una rareza que
          lleva 60 sin salir tiene la misma probabilidad en la 61. Presentarlo como que le toca
          empujaría a la gente a perseguirlo, que es justo lo contrario de lo que hace esta página. */}
      {fila.tiers?.length > 0 && (
        <div style={{ padding: '0 15px 11px' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONTS.mono, fontSize: 10 }}>
              <thead>
                <tr>
                  {['TIER', 'SEEN', 'SINCE', 'AVG'].map((h, i) => (
                    <th key={h} style={{
                      textAlign: i === 0 ? 'left' : 'right', fontWeight: 400, fontSize: 8.5,
                      letterSpacing: '.1em', color: '#5d6774', padding: '0 0 4px',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fila.tiers.map((t) => (
                  <tr key={t.tier}>
                    <td style={{ color: colorTier(t.tier), padding: '2px 0' }}>{t.tier}</td>
                    <td style={{ textAlign: 'right', color: COLORS.muted, fontVariantNumeric: 'tabular-nums' }}>{t.seen}</td>
                    <td style={{
                      textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      color: t.cold ? '#f5c542' : COLORS.text,
                    }}>{t.current == null ? `${t.sample}+` : t.current}</td>
                    <td style={{ textAlign: 'right', color: COLORS.muted, fontVariantNumeric: 'tabular-nums' }}>
                      {t.average == null ? '—' : t.average}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ padding: '0 15px 13px' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          borderTop: `1px solid ${COLORS.border}`, paddingTop: 10,
        }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 8.5, letterSpacing: '.14em', color: '#5d6774' }}>
            {fila.realized_window_hours}H · N={fila.realized_n_pulls.toLocaleString('en-US')}
            {/* Sin esto el mismo 0.938 significaría dos cosas distintas según el interruptor, y
                nadie sabría cuál está mirando. */}
            {nota ? ` · ${nota}` : ''}
          </span>
          <span style={{ fontFamily: FONTS.mono, fontSize: 9, fontWeight: 700, letterSpacing: '.08em', color: tintaEtiqueta }}>
            {lab.texto}
          </span>
        </div>
        {/* El detalle no es decoración: es lo único que distingue "no sé" de "no sé TODAVÍA", y sin
            él las tres formas de no concluir se leen igual. */}
        {lab.detalle && (
          <div style={{ fontFamily: FONTS.mono, fontSize: 9, color: COLORS.muted, marginTop: 6, lineHeight: 1.5 }}>
            {lab.detalle}
          </div>
        )}
      </div>
    </article>
  )
}

/** Colores de rareza del tema, para que la tabla se lea igual que el resto de la app. */
function colorTier(nombre: string): string {
  return ({ Common: '#8b95a3', Uncommon: '#2fe28a', Rare: '#5ad1ff', Epic: '#a98bff' } as Record<string, string>)[nombre]
    ?? COLORS.muted
}

/** El arco. Sin ratio no se dibuja aguja: una aguja en el centro se leería como "paga justo". */
function Dial({ ratio, tinta }: { ratio: number | null; tinta: string }) {
  const ang = ratio == null ? null : anguloAguja(ratio)
  const rad = ang == null ? 0 : (ang - 90) * (Math.PI / 180)
  const x = 56 + 32 * Math.cos(rad)
  const y = 60 + 32 * Math.sin(rad)
  return (
    <svg width="112" height="68" viewBox="0 0 112 68" style={{ flex: 'none' }} aria-hidden="true">
      <path d="M8 60 A48 48 0 0 1 104 60" fill="none" stroke="#ffffff14" strokeWidth="9" strokeLinecap="round" />
      {/* La marca del 1.00, que es lo que convierte el arco en una escala legible. */}
      <line x1="56" y1="8" x2="56" y2="18" stroke="#ffffff40" strokeWidth="1.5" />
      <text x="56" y="6" textAnchor="middle" fill="#5d6774" fontFamily="monospace" fontSize="7">1.00</text>
      <text x="8" y="68" textAnchor="start" fill="#5d6774" fontFamily="monospace" fontSize="6.5">{RATIO_MIN}</text>
      <text x="104" y="68" textAnchor="end" fill="#5d6774" fontFamily="monospace" fontSize="6.5">{RATIO_MAX}</text>
      {ang != null && (
        <>
          <line x1="56" y1="60" x2={x} y2={y} stroke={tinta} strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="56" cy="60" r="3.5" fill={tinta} />
        </>
      )}
    </svg>
  )
}
