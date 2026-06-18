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
  it('extrae campos base + grading/rarity/year/authenticated', () => {
    const card = dasAssetToCard({
      id: 'mint1',
      content: {
        metadata: {
          name: '2020 Charizard',
          attributes: [
            { trait_type: 'Insured Value', value: '1200' },
            { trait_type: 'Rarity', value: 'Epic' },
            { trait_type: 'Grading Company', value: 'PSA' },
            { trait_type: 'The Grade', value: '10' },
            { trait_type: 'Grading ID', value: '12345678' },
            { trait_type: 'Year', value: '2020' },
            { trait_type: 'Authenticated', value: 'true' },
          ],
        },
        links: { image: 'http://img/x.png' },
      },
    } as any)
    expect(card).toEqual({
      mint: 'mint1', name: '2020 Charizard', image: 'http://img/x.png', insuredValue: 1200,
      rarity: 'epic', grade: 'PSA 10', gradingCompany: 'PSA', gradingId: '12345678',
      year: '2020', authenticated: true,
    })
  })

  it('usa fallbacks/null cuando faltan campos; year desde el nombre', () => {
    const card = dasAssetToCard({
      id: 'mint2',
      content: { metadata: { name: '1999 Pikachu' } },
    } as any)
    expect(card).toEqual({
      mint: 'mint2', name: '1999 Pikachu', image: null, insuredValue: null,
      rarity: null, grade: null, gradingCompany: null, gradingId: null,
      year: '1999', authenticated: null,
    })
  })

  it('id-only asset → todo null y name Unnamed', () => {
    const card = dasAssetToCard({ id: 'mint3' } as any)
    expect(card.name).toBe('Unnamed')
    expect(card.grade).toBeNull()
    expect(card.year).toBeNull()
    expect(card.authenticated).toBeNull()
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

  it('devuelve [] si la respuesta no es ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    expect(await getAssetsByOwner('https://rpc', 'OWNER')).toEqual([])
  })

  it('devuelve [] si fetch lanza', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    expect(await getAssetsByOwner('https://rpc', 'OWNER')).toEqual([])
  })
})
