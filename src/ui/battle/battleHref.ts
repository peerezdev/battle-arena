/**
 * La ruta de una batalla, decidiendo si se entra por el resultado o por el reveal.
 *
 * `?view=result` es el contrato que lee `BattleFlow`: sin él, una partida ya liquidada revive el
 * reveal desde la primera carta. Esa regla vivía repartida por cada sitio que enlazaba a una
 * batalla, y solo el modal de "While you were away" la aplicaba: los botones de **Result** de las
 * listas y los enlaces del chat abrían la partida por el principio, aunque el botón dijera
 * "Result". Aquí está en un solo sitio para que no se vuelvan a separar.
 *
 * - `battleHref(id, { status })` — decide sola: liquidada → resultado; el resto → reveal.
 * - `battleHref(id, { view: 'result' })` — al resultado, pase lo que pase.
 * - `battleHref(id)` — al reveal a propósito, que es lo que quiere un "Replay".
 */
export function battleHref(
  id: string,
  opts: { status?: string | null; view?: 'result' | 'reveal' } = {},
): string {
  const base = `/play/battle/${encodeURIComponent(id)}`
  if (opts.view === 'reveal') return base
  const alResultado = opts.view === 'result' || opts.status === 'settled'
  return alResultado ? `${base}?view=result` : base
}
