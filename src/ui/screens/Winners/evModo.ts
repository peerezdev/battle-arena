import type { EvRow } from '../../../onchain/gachaClient'

/**
 * Las dos formas de leer la misma medición.
 *
 * "¿Este sobre me ha salido bien?" tiene dos respuestas ciertas a la vez. Pagas 50 $ y sale una
 * carta de 55,77 $: si te la quedas vas +11,5%, y si se la revendes a Collector Crypt al 85% te
 * dan 47,40 $ y vas −5,2%. El coleccionista se queda las buenas; el que juega por valor las vende.
 *
 * NO SON DOS MEDICIONES, es una vista distinta de la misma. El backend mide siempre el valor de la
 * carta, y el modo `cashout` aplica la recompra aquí:
 *
 *     neto = buyback × (1 + bruto) − 1
 *
 * Como es lineal, los extremos del intervalo se convierten igual y NO hay que rehacer el
 * bootstrap. Lo que sí cambia es el veredicto: al bajar el intervalo entero, una máquina "sin
 * concluir" puede pasar a estar confirmada en negativo.
 */
export type Modo = 'keep' | 'cashout'

export const MODO_POR_DEFECTO: Modo = 'cashout'

const CLAVE = 'ba.evTracker.modo'

export function leerModo(): Modo {
  try {
    return localStorage.getItem(CLAVE) === 'keep' ? 'keep' : MODO_POR_DEFECTO
  } catch {
    return MODO_POR_DEFECTO
  }
}

export function guardarModo(m: Modo): void {
  try { localStorage.setItem(CLAVE, m) } catch { /* sin almacenamiento dura la pestaña */ }
}

/** Los tres veredictos que salen del intervalo. El resto describen la COBERTURA (ventana a medias,
 *  huecos, muestra corta) y no dependen de cómo se mire el valor, así que se respetan tal cual. */
const ESTADISTICOS = new Set(['CONFIDENT -EV', 'CONFIDENT +EV', 'unclear (CI crosses zero)'])

function veredicto(lo: number, hi: number): string {
  if (hi < 0) return 'CONFIDENT -EV'
  if (lo > 0) return 'CONFIDENT +EV'
  return 'unclear (CI crosses zero)'
}

const aNeto = (pct: number, bb: number) => (bb * (1 + pct / 100) - 1) * 100

/**
 * La fila tal y como hay que pintarla en ese modo.
 *
 * Sin `buyback_pct` no se puede convertir, así que se devuelve la fila intacta: inventar un 85% por
 * defecto daría un número con pinta de medido que no lo es.
 */
export function enModo(fila: EvRow, modo: Modo): EvRow {
  const bb = fila.buyback_pct
  if (modo === 'keep' || !bb) return fila

  const edge = fila.realized_edge_pct == null ? null : aNeto(fila.realized_edge_pct, bb)
  const lo = fila.realized_ci_lo_pct == null ? null : aNeto(fila.realized_ci_lo_pct, bb)
  const hi = fila.realized_ci_hi_pct == null ? null : aNeto(fila.realized_ci_hi_pct, bb)
  // El modelo se convierte con la MISMA regla. Llega en valor de carta justo para esto: si viniera
  // con la recompra ya puesta habría que hacerle algo distinto, y cualquier despiste ahí se vería
  // como una diferencia entre lo esperado y lo medido que en realidad no existe.
  const mEdge = fila.model_edge_pct == null ? null : aNeto(fila.model_edge_pct, bb)

  return {
    ...fila,
    realized_edge_pct: edge,
    realized_ci_lo_pct: lo,
    realized_ci_hi_pct: hi,
    model_edge_pct: mEdge,
    model_ratio: mEdge == null ? fila.model_ratio : 1 + mEdge / 100,
    model_ev: fila.model_ev == null ? null : fila.model_ev * bb,
    realized_verdict:
      fila.realized_verdict && ESTADISTICOS.has(fila.realized_verdict) && lo != null && hi != null
        ? veredicto(lo, hi)
        : fila.realized_verdict,
  }
}

/** Si esa máquina se puede mirar en modo recompra. Sin buyback conocido, no. */
export function convertible(fila: EvRow): boolean {
  return !!fila.buyback_pct
}
