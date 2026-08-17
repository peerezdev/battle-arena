/**
 * A dónde manda la puerta del tracker.
 *
 * Aparte para que la puerta no tenga que conocer la forma de la URL del Lobby, que ya cambió una vez
 * (`/play/arena` y `/play/royale` pasaron a ser un solo `/play/lobby` con el modo como filtro).
 */
export function hrefLobby(modo: 'pack' | 'royale'): string {
  return `/play/lobby?mode=${modo}`
}
