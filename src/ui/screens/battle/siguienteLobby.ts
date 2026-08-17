import type { BattleMode, OpenBattle } from '../../../onchain/packBattleClient'

/**
 * De las salas que siguen llenándose, la que está MÁS CERCA de empezar.
 *
 * Estaba escrito dentro de `NextBattlePanel`, en el resultado de una partida. Se saca aquí porque
 * la puerta del Machine Tracker necesita exactamente lo mismo: "¿a qué puedo entrar ahora?". Con
 * dos copias, la de la puerta habría empezado a recomendar salas donde el jugador ya está sentado
 * en cuanto alguien tocara una y no la otra.
 *
 * El orden: menos plazas libres primero, porque es la que antes arranca. A igualdad, la sala más
 * grande, que es donde hay más en juego.
 */
export function siguienteLobby(battles: OpenBattle[], { mode, excluirId, meWallet }: {
  mode: BattleMode
  /** La partida que se acaba de jugar, para no recomendar volver a ella. */
  excluirId?: string | null
  meWallet?: string | null
}): OpenBattle | null {
  const candidatas = battles
    .filter((b) => b.mode === mode && b.id !== excluirId && b.players < b.max_players)
    // Nunca una en la que ya esté sentado: recomendarle entrar donde ya está es un callejón.
    .filter((b) => !meWallet || !(b.player_wallets ?? []).includes(meWallet))

  return [...candidatas].sort((a, b) => {
    const libresA = a.max_players - a.players, libresB = b.max_players - b.players
    return libresA - libresB || b.max_players - a.max_players
  })[0] ?? null
}
