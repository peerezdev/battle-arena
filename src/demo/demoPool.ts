// Muestreo del pool de una máquina para las demos. Vive aparte porque lo usan dos sitios: el
// flujo de demo de batallas y la página de pruebas.
import { fetchMachines, fetchMachineCards, type MachineCard, type GachaMachine } from '../onchain/gachaClient'

export const DEMO_MACHINE = 'pokemon_25'
/** Cartas por página al muestrear el pool de la demo. */
export const SAMPLE_PAGE_SIZE = 24

export interface DemoPool { machine: GachaMachine; cards: MachineCard[] }

/**
 * Trae una muestra del pool que abarque TODAS las rarezas.
 *
 * De cada rareza se piden dos páginas, una fija y otra al azar, porque CC devuelve las cartas
 * ORDENADAS POR VALOR: pedir solo la primera daba las N más caras, que en mainnet son idénticas
 * (las 24 primeras commons de pokemon_25 valen todas $29) y la demo parecía tener los importes
 * cableados. El stock por rareza dice cuántas páginas hay de verdad, así que se muestrea todo el
 * rango en vez de adivinar un tope.
 */
export async function fetchDemoPool(machineCode = DEMO_MACHINE): Promise<DemoPool> {
  const machines = await fetchMachines()
  const m = machines.find((x) => x.code === machineCode) ?? machines[0]
  if (!m) throw new Error('No machines available')

  const rarities = Object.keys(m.odds)
  const pages = rarities.flatMap((r) => {
    const maxPage = Math.max(1, Math.ceil((m.stock?.[r] ?? 0) / SAMPLE_PAGE_SIZE))
    const randomPage = () => 1 + Math.floor(Math.random() * maxPage)
    return maxPage === 1
      ? [{ rarity: r, page: 1 }]
      : [{ rarity: r, page: randomPage() }, { rarity: r, page: randomPage() }]
  })
  const byRarity = await Promise.all(pages.map(({ rarity, page }) =>
    fetchMachineCards(m.code, { rarity, page, limit: SAMPLE_PAGE_SIZE }).catch(() => [] as MachineCard[])))

  let cards: MachineCard[] = byRarity.flat()
  if (!cards.length) cards = await fetchMachineCards(m.code, { limit: 80 }).catch(() => [])
  if (!cards.length) throw new Error('No cards in the pool')
  return { machine: m, cards }
}

/** Orden de rarezas de las pruebas: de la más rara a la más común. */
export const FORCED_ORDER = ['epic', 'rare', 'uncommon', 'common'] as const
