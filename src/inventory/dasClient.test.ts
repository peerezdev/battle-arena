// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filterCollectorCryptAssets, dasAssetToCard, getAssetsByOwner } from './dasClient'

const CC = 'CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf'

beforeEach(() => vi.restoreAllMocks())

describe('filterCollectorCryptAssets', () => {
  it('mantiene solo los assets con grouping de la colección CC', () => {
    const assets = [
      { id: 'a', grouping: [{ group_key: 'collection', group_value: CC }] },
      { id: 'b', grouping: [{ group_key: 'collection', group_value: 'Other' }] },
      { id: 'c' },
    ]
    const out = filterCollectorCryptAssets(assets as any, CC)
    expect(out.map((a) => a.id)).toEqual(['a'])
  })
})

describe('dasAssetToCard', () => {
  it('extrae mint, name, image e insuredValue de attributes', () => {
    const card = dasAssetToCard({
      id: 'mint1',
      content: {
        metadata: { name: 'Charizard', attributes: [{ trait_type: 'Insured Value', value: '1200' }] },
        links: { image: 'http://img/x.png' },
      },
    } as any)
    expect(card).toEqual({ mint: 'mint1', name: 'Charizard', image: 'http://img/x.png', insuredValue: 1200 })
  })

  it('usa fallbacks cuando faltan campos', () => {
    const card = dasAssetToCard({ id: 'mint2' } as any)
    expect(card).toEqual({ mint: 'mint2', name: 'Unnamed', image: null, insuredValue: null })
  })
})

describe('getAssetsByOwner', () => {
  it('hace POST JSON-RPC y devuelve result.items', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { items: [{ id: 'a' }] } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const items = await getAssetsByOwner('https://rpc', 'OWNER')
    expect(items).toEqual([{ id: 'a' }])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.method).toBe('getAssetsByOwner')
    expect(body.params.ownerAddress).toBe('OWNER')
  })

  it('devuelve [] si la RPC no soporta DAS (error)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: { message: 'Method not found' } }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await getAssetsByOwner('https://rpc', 'OWNER')).toEqual([])
  })
})
