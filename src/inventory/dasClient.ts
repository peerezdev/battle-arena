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
  rarity: string | null
  grade: string | null
  gradingCompany: string | null
  gradingId: string | null
  year: string | null
  authenticated: boolean | null
}

/** Keep only assets that belong to the given Collector Crypt collection (DAS grouping). */
export function filterCollectorCryptAssets(assets: DasAsset[], collectionMint: string): DasAsset[] {
  return assets.filter((a) =>
    (a.grouping ?? []).some((g) => g.group_key === 'collection' && g.group_value === collectionMint),
  )
}

/** trait_type -> string value (coerced), for whichever attributes exist. */
function attrMap(attrs: Array<{ trait_type?: string; value?: unknown }>): Record<string, string> {
  const m: Record<string, string> = {}
  for (const t of attrs) {
    if (t.trait_type != null && t.value != null && t.value !== '') m[t.trait_type] = String(t.value)
  }
  return m
}

/** Map a DAS asset to a display card, with safe fallbacks. */
export function dasAssetToCard(a: DasAsset): InventoryCard {
  const md = a.content?.metadata
  const attrs = md?.attributes ?? []
  const m = attrMap(attrs)
  const name = md?.name ?? 'Unnamed'

  const insuredAttr = attrs.find((t) => /insured/i.test(t.trait_type ?? ''))
  const rawInsured = insuredAttr?.value
  const insuredValue = rawInsured == null || rawInsured === '' ? NaN : Number(rawInsured)

  const company = (m['Grading Company'] ?? '').trim()
  const gradeLabel = (m['The Grade'] ?? m['GradeNum'] ?? '').trim()
  const grade = `${company} ${gradeLabel}`.trim() || null

  let year: string | null = m['Year'] ?? null
  if (!year) {
    const match = /^\s*(\d{4})\b/.exec(name)
    if (match) year = match[1]
  }

  const authRaw = m['Authenticated']
  const authenticated = authRaw == null ? null : authRaw.trim().toLowerCase() === 'true'

  return {
    mint: a.id,
    name,
    image: a.content?.links?.image ?? null,
    insuredValue: Number.isFinite(insuredValue) ? insuredValue : null,
    rarity: m['Rarity'] != null ? m['Rarity'].toLowerCase() : null,
    grade,
    gradingCompany: company || null,
    gradingId: m['Grading ID'] ?? null,
    year,
    authenticated,
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
