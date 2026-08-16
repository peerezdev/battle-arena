import type { BattleMode } from './hubMockData'

/**
 * Qué modos se ven en Live games.
 *
 * Las partidas de los dos modos van EN LA MISMA REJILLA y con la misma tarjeta: `LiveBattles` ya
 * pintaba una rejilla uniforme que sirve para cualquier modo, y la propia tarjeta lleva su chapa
 * de Pack Battle o Battle Royale. Sacar las royale a una tarjeta ancha aparte partía la lista en
 * dos alturas distintas y obligaba a bajar para ver la otra mitad.
 *
 * El modo es un filtro, no un destino, y por eso vive en la URL: así se puede enlazar, compartir y
 * recuperar con el botón de atrás, y las rutas viejas (/play/arena, /play/royale) pueden seguir
 * funcionando redirigiendo aquí con su casilla ya marcada.
 */
export type Modo = Extract<BattleMode, 'pack' | 'royale'>

export const MODOS: { id: Modo; label: string }[] = [
  { id: 'pack', label: 'Pack Battle' },
  { id: 'royale', label: 'Battle Royale' },
]

const TODOS = new Set<Modo>(['pack', 'royale'])

/** Los modos marcados según la URL. Sin parámetro, todos: es el estado que enseña la actividad. */
export function leerModos(search: string): Set<Modo> {
  const v = new URLSearchParams(search).get('mode')
  if (!v) return new Set(TODOS)
  // `none` es un valor de verdad y no basura: el usuario apagó los dos, y recargar tiene que
  // respetarlo en vez de devolverle lo que acababa de quitar.
  if (v === 'none') return new Set<Modo>()
  const pedidos = v.split(',').filter((x): x is Modo => x === 'pack' || x === 'royale')
  // Un valor inventado NO deja el lobby vacío: se cae a todos, que es lo que menos daño hace.
  return pedidos.length ? new Set(pedidos) : new Set(TODOS)
}

/** El parámetro que toca. Con todos marcados va sin nada: es el estado limpio. */
export function paramModos(modos: Set<Modo>): Record<string, string> {
  if (modos.size === 0) return { mode: 'none' }
  if (modos.size >= TODOS.size) return {}
  return { mode: [...modos].join(',') }
}

export function alternar(modos: Set<Modo>, m: Modo): Set<Modo> {
  const s = new Set(modos)
  if (s.has(m)) s.delete(m)
  else s.add(m)
  return s
}

/**
 * Lo que se lee en el botón del desplegable.
 *
 * Con los dos marcados dice "All games" y no "2 modes": es lo mismo y se entiende sin contar.
 */
export function etiquetaModos(modos: Set<Modo>): string {
  if (modos.size === 0) return 'No modes'
  if (modos.size >= TODOS.size) return 'All games'
  return MODOS.find((m) => modos.has(m.id))!.label
}

export function conModos<T extends { mode: BattleMode }>(filas: T[], modos: Set<Modo>): T[] {
  return filas.filter((f) => modos.has(f.mode as Modo))
}
