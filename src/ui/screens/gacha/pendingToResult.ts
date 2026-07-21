import {
  fetchCardMetadata,
  openPack,
  pollOpenPack,
  type OpenPackResult,
  type PendingPack,
} from '../../../onchain/gachaClient'

export type YoloResult = Extract<OpenPackResult, { pending: false }>

// Convierte un sobre pendiente en el resultado que pintan el reveal y el resumen.
//
// Vive aquí y no dentro de la vault porque lo usan DOS caminos: abrir desde la lista (con
// animación) y el Skip (sin ella). Duplicarlo es como se perdió el auto-sell la primera vez: una
// copia se actualiza y la otra se queda mintiendo sobre lo que el jugador tiene.

/** Un pendiente → resultado listo para pintar, o null si CC aún no lo ha resuelto.
 *
 *  Si el sobre ya tiene carta NO se reabre: se reconstruye con lo guardado más la metadata por
 *  mint. La rareza y el auto-sell salen de la fila, no de la metadata, porque
 *  `/gacha/nft/{mint}` devuelve rarity null y no sabe nada de recompras. */
export async function pendingPackToResult(
  token: string,
  p: PendingPack,
): Promise<YoloResult | null> {
  if (!p.nft_address) {
    const r = await pollOpenPack(() => openPack(token, p.memo))
    return r.pending ? null : r
  }
  const meta = await fetchCardMetadata(p.nft_address).catch(() => null)
  return {
    pending: false,
    nft_address: p.nft_address,
    name: meta?.name ?? p.name,
    rarity: p.rarity ?? meta?.rarity ?? null,
    image: meta?.image ?? null,
    images: meta?.image ? [meta.image] : [],
    insured_value: meta?.insured_value ?? p.insured_value,
    grade: meta?.grade ?? null,
    year: meta?.year ?? null,
    grading_company: meta?.grading_company ?? null,
    grading_id: meta?.grading_id ?? null,
    authenticated: meta?.authenticated ?? null,
    auto_sold: p.auto_sold,
    buyback_amount: p.buyback_amount,
  } as YoloResult
}

/** Resuelve un lote en orden, saltando los que no se puedan. Devuelve los resultados y el código
 *  de máquina de cada uno, para poder etiquetar de dónde vino cada carta. */
export async function pendingPacksToResults(
  token: string,
  packs: PendingPack[],
): Promise<{ results: YoloResult[]; machineCodes: string[] }> {
  const results: YoloResult[] = []
  const machineCodes: string[] = []
  for (const p of packs) {
    try {
      const r = await pendingPackToResult(token, p)
      if (r) { results.push(r); machineCodes.push(p.pack_type) }
    } catch { /* se salta: sigue pendiente y se reintenta */ }
  }
  return { results, machineCodes }
}
