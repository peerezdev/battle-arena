/**
 * Barra lateral pegajosa que SIGUE la dirección del scroll.
 *
 * Un `position: sticky; top: 16` normal ancla el panel por arriba: si el panel es más alto que la
 * ventana, su parte final —en el gacha, las odds— queda fuera y no hay manera de verla nunca.
 *
 * La idea: en vez de un `top` fijo, se mueve entre dos topes.
 *
 *   · bajando  → el `top` baja hasta que el FINAL del panel toca el fondo de la ventana y ahí se
 *                queda. Las odds acaban a la vista y se quedan.
 *   · subiendo → el `top` sube otra vez hacia el hueco de arriba, en proporción al scroll, así que
 *                el panel reacciona al primer gesto en vez de esperar a llegar arriba del todo.
 *
 * Si el panel cabe entero en la ventana no hay nada que resolver y se comporta como el sticky de
 * siempre.
 */

/** Tope superior: el panel pegado arriba, dejando `hueco`. */
export const TOPE_ARRIBA = (hueco: number) => hueco

/**
 * Tope inferior: el `top` con el que el final del panel queda justo en el fondo de la ventana.
 * Es negativo cuando el panel no cabe — que es justo el caso que esto resuelve.
 */
export function topeAbajo(alturaPanel: number, alturaVista: number, hueco: number): number {
  return Math.min(hueco, alturaVista - alturaPanel - hueco)
}

/**
 * El `top` que toca tras desplazarse `dy` (positivo = bajando).
 *
 * Se mueve al revés que el scroll y se recorta entre los dos topes, así que el panel "arrastra"
 * hasta que uno de sus extremos queda fijo. Un `dy` de cualquier tamaño se recorta igual: no hay
 * forma de pasarse de ninguno de los dos topes.
 */
export function siguienteTop(actual: number, dy: number, alturaPanel: number,
                             alturaVista: number, hueco = 16): number {
  const abajo = topeAbajo(alturaPanel, alturaVista, hueco)
  const arriba = TOPE_ARRIBA(hueco)
  return Math.max(abajo, Math.min(arriba, actual - dy))
}
