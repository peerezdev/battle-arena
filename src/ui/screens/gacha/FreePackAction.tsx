import { COLORS, FONTS } from '../../theme'
import type { GachaMachine } from '../../../onchain/gachaClient'
import { tiradasGratis } from './freeSpins'

/** Qué se le dice al jugador cuando no se han podido leer sus puntos. Cada uno dice qué pasa Y qué
 *  hacer, porque cada uno se arregla de una forma distinta: volver a entrar solo sirve para el
 *  primero, y para el segundo es justo lo que NO funciona.
 *
 *  El motivo crudo del backend ("ImmatureSignatureError" y compañía) es para quien desarrolla. */
export const FREE_SPINS_ERROR_MSG: Record<'sesion' | 'sin_wallet' | 'no_disponible' | 'fallo', string> = {
  sesion: 'Log in again to see your free spins.',
  sin_wallet: 'This session has no in-app wallet, so free spins are not available. Log in with email or a social account instead of an external wallet.',
  no_disponible: 'Free spins are unavailable right now.',
  fallo: 'Could not load your points. Try again in a moment.',
}

/**
 * La tirada gratis de UNA máquina: el botón si llega, y cuánto falta si no.
 *
 * Estaba escrito dentro del panel de escritorio, así que en MÓVIL no existía: la maqueta pequeña
 * usa una barra fija abajo con el contador y el Open, y ese bloque nunca se pintaba. O sea que un
 * jugador de móvil no tenía forma de saber que tenía tiradas gratis, ni de gastarlas.
 *
 * Extraído para que las dos maquetas usen LA MISMA lógica. Si se hubiera copiado, la de móvil se
 * habría quedado atrás en el primer cambio: son cuatro casos y tres de ellos son avisos que ya
 * costaron un fallo cada uno.
 *
 * LOS CUATRO CASOS, y ninguno se puede colapsar con otro:
 *
 *  · no se pudieron leer los puntos → se dice. Callarlo ERA el bug: la máquina ofrecía tiradas
 *    gratis, el jugador tenía puntos, y la pantalla no enseñaba nada porque el dato venía nulo.
 *  · Collector Crypt las tiene pausadas → se dice, y que los puntos están a salvo. Sin esto, un
 *    cierre temporal se veía exactamente igual que una máquina que no las ofrece nunca.
 *  · llegan los puntos → botón.
 *  · no llegan → TEXTO con cuánto falta, no un botón apagado. Un botón que no se puede pulsar
 *    invita a mirar los puntos, no a jugar.
 *
 * Y las dos condiciones para que esto aparezca son DE LA MÁQUINA, no del jugador: que ella las
 * ofrezca (muchas no) y que sus puntos lleguen a lo que cuesta AQUÍ, que sube con el precio. Con
 * puntos de sobra para la de 50 $ puede no haber ni para una en la de 250 $.
 */
export function FreePackAction({ machine, freeSpins, freeSpinsError, freeSpinsDetalle, onFreePack,
                                compacto = false }: {
  machine: GachaMachine
  freeSpins?: { points_available: number } | null
  freeSpinsError?: 'sesion' | 'sin_wallet' | 'no_disponible' | 'fallo' | null
  freeSpinsDetalle?: string | null
  onFreePack?: () => void
  /** En la barra de móvil: sin margen propio y algo más bajo, que ahí el alto se paga caro. */
  compacto?: boolean
}) {
  if (!onFreePack) return null

  const margen = compacto ? 0 : 10
  const aviso = (texto: React.ReactNode) => (
    <div style={{
      marginTop: margen, textAlign: 'center', fontFamily: FONTS.mono,
      fontSize: compacto ? 10.5 : 11, color: COLORS.muted, lineHeight: 1.4,
    }}>
      {texto}
    </div>
  )

  if (!freeSpins && freeSpinsError && machine.freeSpins) {
    return aviso(
      <>
        {FREE_SPINS_ERROR_MSG[freeSpinsError]}
        {freeSpinsDetalle && import.meta.env.DEV && (
          <div style={{ marginTop: 3, fontSize: 10, opacity: 0.7 }}>{freeSpinsDetalle}</div>
        )}
      </>,
    )
  }

  if (machine.freeSpinsClosed) {
    return aviso('Free packs are paused right now. Your points are safe.')
  }

  if (!freeSpins || !machine.freeSpins) return null

  const gratis = tiradasGratis(machine.price, freeSpins.points_available ?? 0)
  if (gratis.count > 0) {
    return (
      <button
        onClick={onFreePack}
        style={{
          width: '100%', marginTop: margen, borderRadius: 12,
          padding: compacto ? '9px 14px' : '11px 18px',
          fontSize: compacto ? 13 : 13.5, fontWeight: 800, fontFamily: FONTS.display,
          cursor: 'pointer', whiteSpace: 'nowrap',
          border: `1px solid ${COLORS.green}66`, background: `${COLORS.green}14`, color: COLORS.green,
        }}
      >
        ★ Free pack · {gratis.count} left
      </button>
    )
  }
  return aviso(`${gratis.untilNext.toLocaleString('en-US')} points to a free pack here`)
}
