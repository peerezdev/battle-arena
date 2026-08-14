/**
 * Cómo se escribe la antigüedad de una racha.
 *
 * La racha se cuenta en TIRADAS, pero un "190" no se puede leer sin saber cuánto tiempo es: son
 * tres horas en `pokemon_50`, que hace unas mil al día, y un mes en `comic_25`, que hace tres.
 * Esa diferencia cambia por completo lo que significa el mismo número.
 */

/** Días transcurridos, en la unidad que se lee de un vistazo. `null` = esa rareza no salió nunca en
 *  el histórico, que no es lo mismo que "salió hace 0". */
export function desdeHace(dias: number | null | undefined): string {
  if (dias == null) return '—'
  if (dias < 1 / 24) return 'now'
  if (dias < 1) return `${Math.round(dias * 24)}h`
  return `${Math.round(dias)}d`
}
