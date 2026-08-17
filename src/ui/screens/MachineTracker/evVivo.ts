import type { EvLive, EvRow, EvTier } from '../../../onchain/gachaClient'

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
    const nuevas = porMaquina.get(f.machine)
    // Una máquina que el carril rápido no trae se queda con lo que tenía; vaciarle la tabla sería
    // decir "no hay datos" cuando lo cierto es "no han llegado todavía".
    if (!nuevas) return f
    return { ...f, tiers: fundirTiers(f.tiers, nuevas) }
  })
}

/**
 * Las rachas nuevas SIN perder lo que el carril rápido no trae.
 *
 * Aquí estaba el fallo: se sustituía la tabla entera. El carril rápido solo lleva rachas —es su
 * razón de ser, ser barato—, así que P, VALUE y GROSS se borraban en el primer tic de diez
 * segundos. Volvían un instante con el refresco del minuto y se borraban otra vez, o sea que en la
 * práctica desaparecían al entrar y no volvían.
 *
 * Se funde por rareza y no por posición: si algún día llegan en otro orden, cruzar por índice
 * mezclaría el valor de un Common con la racha de un Epic sin que nada fallara.
 */
function fundirTiers(previas: EvTier[], nuevas: EvTier[]): EvTier[] {
  const antes = new Map(previas.map((t) => [t.tier, t]))
  return nuevas.map((n) => {
    const p = antes.get(n.tier)
    if (!p) return n
    // Lo del modelo se conserva; lo observado se pisa con lo recién traído.
    return { ...n, probability: p.probability, n_cards: p.n_cards, value: p.value,
             gross: p.gross, min_value: p.min_value, max_value: p.max_value }
  })
}
