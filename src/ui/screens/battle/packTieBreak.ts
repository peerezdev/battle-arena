import type { RevealVM } from './battleReveal'

export interface TieBreak {
  /** Los empatados en el total más alto, en el orden en que están sentados en la mesa. */
  tied: string[]
  /** El total que comparten, en dólares. */
  value: number
}

/**
 * ¿La partida la ganó alguien por sorteo?
 *
 * En una Pack Battle gana el valor acumulado más alto. Cuando varios lo comparten, el backend
 * decide con la semilla Provably-Fair (`determine_winner`, que además guarda el índice sorteado).
 * Aquí no se decide nada: se detecta que hubo empate para poder ENSEÑAR ese sorteo, y el ganador
 * se lee de `vm.winner`, que es el que ya salió.
 *
 * Devuelve `null` cuando no hay nada que animar, incluido el caso en que el ganador no aparece
 * entre los empatados. No debería ocurrir —el backend sortea entre los candidatos— pero con datos
 * que no cuadran la ruleta aterrizaría en alguien que no ganó, y no animar es mejor que mentir.
 */
export function tieBreakOf(vm: RevealVM): TieBreak | null {
  if (vm.status !== 'settled' || !vm.winner) return null
  if (vm.players.length < 2) return null

  const value = Math.max(...vm.players.map((p) => p.total))
  const tied = vm.players.filter((p) => p.total === value).map((p) => p.wallet)

  if (tied.length < 2) return null
  if (!tied.includes(vm.winner)) return null
  return { tied, value }
}
