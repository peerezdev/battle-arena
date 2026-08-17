import { RARITY } from '../../theme'
import type { Estado } from './evDial'

/**
 * El color con el que se viste una tarjeta del tracker.
 *
 * Un solo acento por tarjeta, y de él salen el borde, el tinte de la cabecera, el punto del
 * título, el relleno del arco, el número grande y la pastilla del veredicto. Que sea uno solo es lo
 * que hace que la rejilla se lea de un vistazo: verde va bien, rosa va mal, ámbar no se sabe.
 *
 * LA REGLA QUE MANDA SIGUE SIENDO LA MISMA: el color no puede afirmar lo que los datos no dicen.
 * Solo un veredicto confirmado se lleva verde o rosa. Todo lo que es "no se puede concluir" —el
 * intervalo cruzando el cero, la ventana a medias, un hueco dentro— se lleva ámbar, que llama la
 * atención sin sentenciar. Y sin muestra, gris: no hay nada que mirar todavía.
 */
export const ACENTO = {
  /** Confirmado que paga por encima de lo que cuesta. */
  bueno: '#3ce8a8',
  /** Confirmado que paga por debajo. Rosa y no rojo: el rojo está reservado en el tema para
   *  pérdida y eliminación en las batallas, y esto no es una derrota, es una medición. */
  malo: '#ff6ba4',
  /** No se puede concluir: intervalo cruzando el cero, ventana a medias o con huecos. */
  dudoso: '#ffd166',
  /** Nada que medir todavía. */
  sinDatos: '#7d8794',
} as const

export function acentoDe(estado: Estado): string {
  switch (estado) {
    case 'confirmado_pos': return ACENTO.bueno
    case 'confirmado_neg': return ACENTO.malo
    case 'sin_muestra': return ACENTO.sinDatos
    // sin_concluir, construyendo y con_hueco: los tres son "todavía no puedo decirlo", y los tres
    // van en ámbar. Se distinguen por su texto, no por su color: pintarlos distinto sugeriría que
    // unos están más cerca de una conclusión que otros, y eso no es cierto.
    default: return ACENTO.dudoso
  }
}

/** Si el acento está AFIRMANDO algo. Solo entonces se le deja vestir el número grande de color
 *  fuerte; en los demás casos el color es un aviso, no una conclusión. */
export function afirma(estado: Estado): boolean {
  return estado === 'confirmado_pos' || estado === 'confirmado_neg'
}

/** Tinte muy leve del acento, para fondos. `alfa` en hex de dos dígitos. */
export const tinte = (color: string, alfa: string): string => `${color}${alfa}`

/**
 * El color de cada rareza. Son los del TEMA y no los del mockup a propósito: la misma rareza tiene
 * que verse igual aquí, en el feed de ganadores y en el reveal de una tirada. Un Epic violeta en
 * una pantalla y dorado en otra obliga a reaprender la leyenda en cada sitio.
 */
export function colorRareza(nombre: string): string {
  return (RARITY as Record<string, string | undefined>)[nombre.toLowerCase()] ?? ACENTO.sinDatos
}

/** El fondo de una fila de la tabla: el color de su rareza desvaído hacia la derecha. Es lo que
 *  permite recorrer la columna de rarezas sin leerla. */
export function fondoFila(nombre: string): string {
  return `linear-gradient(90deg,${colorRareza(nombre)}14,transparent 60%)`
}
