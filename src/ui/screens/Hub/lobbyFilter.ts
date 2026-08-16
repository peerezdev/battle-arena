/**
 * Qué partidas se ven en el Lobby.
 *
 * Pack Battle y Battle Royale eran dos entradas de navegación que renderizaban EL MISMO componente
 * con un prop distinto. El problema no era la duplicación, era lo que hacía con la liquidez: en un
 * PvP con pocos jugadores a la vez, partir la lista en dos parte también lo que se ve. Alguien
 * entraba en Pack, veía cero partidas y se iba pensando que esto está muerto, sin llegar a saber
 * que había tres Royale abiertas al lado.
 *
 * Así que el modo pasa a ser un FILTRO y no un destino. Es lo que siempre fue: "qué veo aquí", no
 * "a dónde voy".
 *
 * Vive en la URL para que el filtro se pueda enlazar, compartir y recuperar con el botón de atrás.
 */
export type Filtro = 'all' | 'pack' | 'royale'

export const FILTROS: { id: Filtro; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pack', label: 'Pack Battle' },
  { id: 'royale', label: 'Battle Royale' },
]

/** `all` por defecto, que es el que enseña toda la actividad de golpe. */
export function leerFiltro(search: string): Filtro {
  const v = new URLSearchParams(search).get('mode')
  return v === 'pack' || v === 'royale' ? v : 'all'
}

/** La URL del Lobby con ese filtro. `all` va sin parámetro: es el estado limpio. */
export function hrefFiltro(f: Filtro): string {
  return f === 'all' ? '/play/lobby' : `/play/lobby?mode=${f}`
}

/** Si con este filtro toca enseñar ese modo. */
export function muestra(f: Filtro, modo: 'pack' | 'royale'): boolean {
  return f === 'all' || f === modo
}
