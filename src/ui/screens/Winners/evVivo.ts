import type { EvLive, EvRow } from '../../../onchain/gachaClient'

/**
 * Los dos carriles del refresco.
 *
 * La pantalla mezcla dos cosas que se mueven a ritmos muy distintos, y refrescarlas juntas obliga
 * a elegir entre ir lento o pagar de más:
 *
 *   - el edge y su intervalo salen de 4.000 remuestreos por máquina (~9 s las 48) y NO se mueven:
 *     medido en mainnet, en diez segundos `pokemon_50` desplaza su edge 0.027 pp, cuando la tarjeta
 *     lo enseña con una décima y el intervalo mide 2 pp de ancho;
 *   - las rachas cambian con CADA tirada y cuestan una consulta (~370 ms las 48).
 *
 * Así que van por separado: lo caro y quieto cada minuto, lo barato y vivo cada diez segundos.
 * Refrescarlo todo a diez segundos costaría casi un núcleo entero para enseñar el temblor de un
 * número que no ha cambiado.
 */
export const LENTO_MS = 60_000
export const RAPIDO_MS = 10_000

/**
 * Las filas con las rachas recién traídas.
 *
 * Solo se tocan los `tiers`. El edge, el intervalo y el veredicto se quedan como estaban a
 * propósito: vienen del carril lento y son coherentes entre sí, así que sustituir uno solo dejaría
 * la tarjeta enseñando un intervalo calculado sobre una muestra que ya no es la que dice.
 *
 * No reordena. El servidor las manda ordenadas por edge, y como el edge no viaja por aquí, mover
 * las tarjetas de sitio cada diez segundos sería puro baile.
 */
export function aplicarVivo(filas: EvRow[], vivas: EvLive[]): EvRow[] {
  const porMaquina = new Map(vivas.map((v) => [v.machine, v.tiers]))
  return filas.map((f) => {
    const tiers = porMaquina.get(f.machine)
    // Una máquina que el carril rápido no trae se queda con lo que tenía; vaciarle la tabla sería
    // decir "no hay datos" cuando lo cierto es "no han llegado todavía".
    return tiers ? { ...f, tiers } : f
  })
}
