export interface DasGrouping {
  group_key: string
  group_value: string
}

export interface DasAsset {
  id: string
  grouping?: DasGrouping[]
  content?: {
    metadata?: { name?: string; attributes?: Array<{ trait_type?: string; value?: unknown }> }
    links?: { image?: string }
  }
}

export interface InventoryCard {
  mint: string
  name: string
  image: string | null
  insuredValue: number | null
}

/** Keep only assets that belong to the given Collector Crypt collection (DAS grouping). */
export function filterCollectorCryptAssets(assets: DasAsset[], collectionMint: string): DasAsset[] {
  return assets.filter((a) =>
    (a.grouping ?? []).some((g) => g.group_key === 'collection' && g.group_value === collectionMint),
  )
}

/** Map a DAS asset to a display card, with safe fallbacks. */
export function dasAssetToCard(a: DasAsset): InventoryCard {
  const md = a.content?.metadata
  const attrs = md?.attributes ?? []
  const insuredAttr = attrs.find((t) => /insured/i.test(t.trait_type ?? ''))
  const insuredValue = insuredAttr != null ? Number(insuredAttr.value) : NaN
  return {
    mint: a.id,
    name: md?.name ?? 'Unnamed',
    image: a.content?.links?.image ?? null,
    insuredValue: Number.isFinite(insuredValue) ? insuredValue : null,
  }
}

/**
 * Fetch all assets owned by `owner` via the DAS getAssetsByOwner JSON-RPC method.
 * Returns [] when the RPC doesn't support DAS or on any error (caller shows empty-state).
 */
export async function getAssetsByOwner(rpcUrl: string, owner: string): Promise<DasAsset[]> {
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'inv',
        method: 'getAssetsByOwner',
        params: { ownerAddress: owner, page: 1, limit: 1000 },
      }),
    })
    if (!resp.ok) return []
    const json = (await resp.json()) as { result?: { items?: DasAsset[] }; error?: unknown }
    if (json.error || !json.result?.items) return []
    return json.result.items
  } catch {
    return []
  }
}
