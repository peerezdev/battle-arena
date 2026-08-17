import { COLORS, FONTS, formatUsd } from '../../theme'
import type { TrackerAccess } from '../../../onchain/gachaClient'

/**
 * El aviso de que todavía no se puede ver el tracker.
 *
 * Lo que dice, en este orden: cuánto falta, sobre cuánto, y por qué existe la puerta. El número que
 * el jugador necesita para decidir es "cuánto me falta", así que va primero y grande; el motivo va
 * al final, porque nadie lee la justificación antes de saber si le afecta.
 *
 * NO se disfraza de error. No se ha roto nada y el jugador no ha hecho nada mal: le falta jugar. Por
 * eso ni rojo ni iconos de alarma.
 */
export function TrackerGate({ acceso }: { acceso: TrackerAccess }) {
  const hecho = acceso.required_usd > 0
    ? Math.min(1, acceso.wagered_usd / acceso.required_usd)
    : 1

  return (
    <div style={{
      background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16,
      padding: 'clamp(20px,3vw,30px)', display: 'flex', flexDirection: 'column', gap: 18,
      maxWidth: 560,
    }}>
      <div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.muted }}>
          MACHINE TRACKER
        </div>
        <div style={{
          fontFamily: FONTS.display, fontSize: 'clamp(26px,4vw,34px)', fontWeight: 800,
          lineHeight: 1.1, marginTop: 8, color: COLORS.text,
        }}>
          {formatUsd(acceso.missing_usd)} to go
        </div>
        <p style={{ color: COLORS.muted, fontSize: 14, lineHeight: 1.6, margin: '10px 0 0' }}>
          The tracker opens once you have wagered {formatUsd(acceso.required_usd)} in Pack Battles or
          Battle Royale over the last {acceso.window_days} days. Gacha pulls do not count.
        </p>
      </div>

      {/* La barra no es decoración: convierte "me faltan 40" en "voy por dos tercios", que es lo
          que hace que valga la pena seguir en vez de abandonar. */}
      <div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', fontFamily: FONTS.mono,
          fontSize: 11, color: COLORS.muted, marginBottom: 7,
          fontVariantNumeric: 'tabular-nums',
        }}>
          <span>{formatUsd(acceso.wagered_usd)} wagered</span>
          <span>{formatUsd(acceso.required_usd)}</span>
        </div>
        <div style={{ height: 6, borderRadius: 4, background: '#ffffff12', overflow: 'hidden' }}>
          <div style={{
            width: `${hecho * 100}%`, height: '100%', borderRadius: 4,
            background: `linear-gradient(90deg,${COLORS.violet},${COLORS.green})`,
          }} />
        </div>
      </div>

      {/* Por qué la ventana es rodante. Se dice explícitamente porque la alternativa —creer que es
          un acceso que se gana una vez— lleva a la sorpresa de perderlo sin haber hecho nada. */}
      <p style={{
        fontFamily: FONTS.mono, fontSize: 11, lineHeight: 1.7, color: '#5d6774',
        margin: 0, paddingTop: 14, borderTop: `1px solid ${COLORS.border}`,
      }}>
        Rolling {acceso.window_days}-day window: what you wager today counts for the next{' '}
        {acceso.window_days} days, and anything older drops off.
      </p>
    </div>
  )
}
