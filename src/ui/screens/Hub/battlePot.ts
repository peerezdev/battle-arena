import type { LiveBattle } from './hubMockData'

export interface PotShown {
  /** Dólares a enseñar. */
  value: number
  /** Rótulo que va encima del número. */
  label: string
  /** true = es lo que cayó de verdad; false = una estimación. */
  real: boolean
}

/**
 * Qué bote enseña la card de una partida.
 *
 * Mientras la partida no ha terminado solo se puede estimar: `pot` es el precio de los sobres,
 * no lo que van a valer las cartas. Una vez liquidada existe `lootUsd`, que es el valor real del
 * botín que se llevó el ganador, y es lo que hay que enseñar — con la estimación puesta, una
 * partida terminada seguía anunciando un número que ya no significaba nada.
 *
 * `lootUsd` solo falta en filas guardadas por un backend anterior al campo. Ahí se cae a la
 * estimación **y se dice**: llamar "total" a un número estimado sería peor que no tenerlo.
 */
export function potShown(b: LiveBattle): PotShown {
  const real = b.battleStatus === 'settled' ? b.lootUsd : undefined
  return real != null
    ? { value: real, label: 'TOTAL POT', real: true }
    : { value: b.pot, label: 'ESTIMATED POT', real: false }
}

/** `×N` sobre la entrada. `null` si no hay nada que multiplicar. */
export function multLabel(entry: number, pot: number): string | null {
  if (entry <= 0 || pot <= 0) return null
  const mult = pot / entry
  return `×${Math.abs(mult - Math.round(mult)) < 0.05 ? Math.round(mult) : mult.toFixed(1)}`
}
