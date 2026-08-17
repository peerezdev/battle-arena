/**
 * Cuándo se midió lo que se está viendo.
 *
 * Es la hora del CARRIL LENTO, no del rápido. Los números grandes de cada tarjeta —el edge, el
 * intervalo, el veredicto— salen de ahí; las rachas se refrescan cada diez segundos pero son un
 * detalle de la tabla. Poner la hora del rápido diría "actualizado hace 3 segundos" sobre un edge
 * calculado hace un minuto.
 *
 * Y lleva aviso de rancio a propósito. Ya pasó: la ingesta se quedó muda cinco horas con todo
 * aparentando estar bien, y lo que lo delató fue que las rachas no se movían. Una hora congelada en
 * pantalla lo habría dicho el primer minuto.
 */

/** Se da por rancio a partir de aquí. El carril lento va cada 60 s, así que cinco minutos son cinco
 *  refrescos perdidos: ya no es una tardanza, es que algo no está funcionando. */
export const LIMITE_RANCIO_S = 300

/** La hora local, como la leería un reloj. `—` si no se sabe: inventar una hora sería peor que no
 *  darla, porque el dato existe justo para poder desconfiar. */
export function horaActualizacion(unixSeg: number | null | undefined,
                                  ahora: Date = new Date()): string {
  if (!unixSeg) return '—'
  const d = new Date(unixSeg * 1000)
  // Fechas imposibles (un reloj mal puesto en el servidor) se tratan como desconocidas.
  if (Number.isNaN(d.getTime()) || d.getTime() > ahora.getTime() + 60_000) return '—'
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Si lo que se enseña lleva demasiado sin recalcularse. */
export function estaRancio(unixSeg: number | null | undefined, ahoraSeg: number,
                           limiteS: number = LIMITE_RANCIO_S): boolean {
  if (!unixSeg) return false      // sin dato no se acusa a nadie: ya se enseña un guion
  return ahoraSeg - unixSeg > limiteS
}
