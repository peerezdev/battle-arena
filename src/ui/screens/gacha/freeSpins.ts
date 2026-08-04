/**
 * Cuántas tiradas gratis dan unos puntos EN UNA MÁQUINA CONCRETA.
 *
 * Una tirada gratis no cuesta lo mismo en todas: son 100.000 puntos en una máquina de 50 $ y sube
 * en proporción al precio, así que la de 5.000 $ pide 10 millones.
 *
 * El endpoint de Collector Crypt responde `freeSpinsLeft` y `pointsPerSpin`, pero están calculados
 * sobre el precio base y valen solo para una máquina de 50 $. Enseñarlos tal cual decía «te quedan
 * 3 tiradas» en una máquina donde no llegaba ni para una.
 *
 * Está duplicada en el backend (`tiradas_gratis`, en `app/services/gacha.py`) a propósito: aquí
 * decide qué se pinta, allí es la puerta que impide gastar una tirada que no existe. La de aquí
 * puede equivocarse sin consecuencias; la de allí, no.
 */
export const PUNTOS_TIRADA_BASE = 100_000
export const PRECIO_BASE = 50

export interface TiradasGratis {
  /** puntos que cuesta una tirada en esta máquina */
  required: number
  /** tiradas enteras que se pueden pagar ahora */
  count: number
  /** puntos que faltan para la siguiente; 0 si ya hay una pagada */
  untilNext: number
}

export function tiradasGratis(precio: number, puntos: number): TiradasGratis {
  const required = Math.round(PUNTOS_TIRADA_BASE * ((precio || PRECIO_BASE) / PRECIO_BASE))
  if (required <= 0) return { required: 0, count: 0, untilNext: 0 }   // precio 0: nada que valorar
  const p = Math.max(0, Math.floor(puntos))
  const resto = p % required
  return {
    required,
    count: Math.floor(p / required),
    // Con el saldo justo no falta nada; con saldo cero falta una tirada entera, no cero.
    untilNext: resto === 0 && p > 0 ? 0 : required - resto,
  }
}
