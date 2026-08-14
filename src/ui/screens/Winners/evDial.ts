/**
 * La aguja del dial y cómo se lee cada estado de una fila del EV tracker.
 *
 * Puro y aparte del componente porque es donde está la decisión editorial: qué se puede afirmar y
 * qué no. Una tarjeta con veredicto retirado sigue enseñando su número, pero NO puede vestirlo de
 * conclusión, y eso se decide aquí una vez en vez de repartido por el JSX.
 */

/** Extremos del arco. Un pack que paga la mitad y otro que paga vez y media caben de sobra, y más
 *  rango solo aplastaría la zona donde de verdad se juega todo, que es alrededor de 1. */
export const RATIO_MIN = 0.75
export const RATIO_MAX = 1.25

export type Estado = 'confirmado_neg' | 'confirmado_pos' | 'sin_concluir' | 'construyendo' | 'con_hueco' | 'sin_muestra'

/** Grados de la aguja sobre un semicírculo, con 1.00 justo arriba. */
export function anguloAguja(ratio: number): number {
  const t = (ratio - RATIO_MIN) / (RATIO_MAX - RATIO_MIN)
  return -90 + Math.min(1, Math.max(0, t)) * 180
}

/** El ratio medido: cuánto devuelve el sobre por cada dólar que cuesta. */
export function ratioDesdeEdge(edgePct: number | null): number | null {
  return edgePct == null ? null : 1 + edgePct / 100
}

/**
 * Traduce el veredicto del backend a un estado de pantalla.
 *
 * Los tres estados de "no puedo afirmarlo" son distintos a propósito y no se colapsan en uno: para
 * el que mira no es lo mismo que llevemos poco midiendo, que hayamos perdido un trozo de la
 * ventana, o que esa máquina simplemente no se juegue.
 */
export function estadoDe(verdict: string | null): Estado {
  switch (verdict) {
    case 'CONFIDENT -EV': return 'confirmado_neg'
    case 'CONFIDENT +EV': return 'confirmado_pos'
    case 'GAP IN WINDOW': return 'con_hueco'
    case 'NOT ENOUGH DATA': return 'sin_muestra'
    case 'BUILDING': return 'construyendo'
    default: return 'sin_concluir'
  }
}

/** Si el número puede presentarse como una conclusión o solo como una lectura provisional. */
export function esConcluyente(e: Estado): boolean {
  return e === 'confirmado_neg' || e === 'confirmado_pos'
}

export interface Etiqueta { texto: string; detalle: string | null }

/** Lo que se escribe en el sitio del veredicto, que nunca se deja vacío. */
export function etiqueta(e: Estado, fila: {
  hours_covered: number; realized_window_hours: number
  realized_n_pulls: number; pulls_to_conclude: number | null
}): Etiqueta {
  switch (e) {
    case 'confirmado_neg': return { texto: 'CONFIRMED −EV', detalle: null }
    case 'confirmado_pos': return { texto: 'CONFIRMED +EV', detalle: null }
    case 'construyendo':
      return { texto: `BUILDING · ${fila.hours_covered}h / ${fila.realized_window_hours}h`,
               detalle: 'No verdict until the window is full.' }
    case 'con_hueco':
      return { texto: 'GAP IN WINDOW',
               detalle: 'Pulls are missing from this window, so the verdict is withheld.' }
    case 'sin_muestra':
      return { texto: 'NOT ENOUGH DATA',
               detalle: `Only ${fila.realized_n_pulls} pulls in the window.` }
    default:
      return { texto: 'UNCLEAR · CI CROSSES ZERO',
               detalle: fila.pulls_to_conclude
                 ? `About ${fila.pulls_to_conclude.toLocaleString('en-US')} pulls would settle it.`
                 : null }
  }
}
