import type { GachaMachine } from '../../../onchain/gachaClient'

/**
 * Qué porcentaje de recompra se enseña en un reveal.
 *
 * Parece trivial y no lo es: aquí estaba el fallo. La pantalla usaba la recompra de la máquina que
 * el jugador tuviera ABIERTA en la vault, no la de la tirada que se estaba enseñando. Así que un
 * replay de una máquina al 90% se veía al 85% si en ese momento había una del 85% abierta, y sin
 * ninguna abierta no se veía recompra en absoluto.
 *
 * La regla es una sola: MANDA LO QUE TRAE LA TIRADA. La máquina abierta es solo el respaldo para el
 * caso normal —tirar desde su propia máquina—, donde las dos coinciden de todas formas.
 */

/** La recompra de una máquina por su código. `null` si no está en la lista.
 *
 *  Devolver `null` es lo importante: sin ese dato la pantalla no enseña recompra, y eso es mejor
 *  que enseñar el número de otra máquina, que era justo el fallo. */
export function recompraDe(
  code: string | null | undefined,
  machines: GachaMachine[] | null | undefined,
): number | null {
  if (!code || !machines) return null
  return machines.find((m) => m.code === code)?.instantBuyback ?? null
}

/**
 * La que se pinta, entre la de la tirada y la de la máquina abierta.
 *
 * El orden es la corrección: primero la de la tirada. Al revés —que es lo que hacía— una tirada
 * traída por enlace o un sobre pendiente se pintaban con la recompra de otra máquina.
 */
export function recompraMostrada(
  deLaTirada: number | null | undefined,
  deLaMaquinaAbierta: number | null | undefined,
): number | null {
  return deLaTirada ?? deLaMaquinaAbierta ?? null
}
