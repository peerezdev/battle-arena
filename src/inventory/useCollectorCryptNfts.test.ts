import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const CC = 'CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf' // config.ccCollectionMint por defecto
const EMBEDDED = 'EMBEDDEDwallet1111111111111111111111111111'

// El hook resuelve la wallet por Privy; aquí se sustituye para poder decidir qué hay vinculado.
const embeddedAddress = vi.fn<() => string | null>(() => EMBEDDED)
vi.mock('../wallet/embedded', () => ({
  useEmbeddedSolanaAddress: () => embeddedAddress(),
}))

const { useCollectorCryptNfts } = await import('./useCollectorCryptNfts')

function mockDas(itemsPorDueno: Record<string, unknown[]>) {
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const owner = JSON.parse(init.body).params.ownerAddress as string
    return { ok: true, json: async () => ({ result: { items: itemsPorDueno[owner] ?? [] } }) }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const carta = (mint: string) => ({
  id: mint,
  grouping: [{ group_key: 'collection', group_value: CC }],
  content: { metadata: { name: mint } },
})

beforeEach(() => embeddedAddress.mockReturnValue(EMBEDDED))
afterEach(() => vi.restoreAllMocks())

describe('useCollectorCryptNfts', () => {
  it('solo pregunta por la embedded wallet, no por las conectadas', async () => {
    // Una wallet externa tipo Phantom puede estar vinculada y tener cartas de CC. El inventario no
    // debe enseñarlas: el buyback y el withdraw solo salen de la embedded, así que aparecerían para
    // luego negarse a venderse. Antes se consultaban todas las wallets vinculadas.
    const fetchMock = mockDas({
      [EMBEDDED]: [carta('mint-embedded')],
      PHANTOM: [carta('mint-phantom')],
    })
    const { result } = renderHook(() => useCollectorCryptNfts())
    await waitFor(() => expect(result.current.cards).toHaveLength(1))
    expect(result.current.cards[0].mint).toBe('mint-embedded')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).params.ownerAddress).toBe(EMBEDDED)
  })

  it('marca las cartas como embedded, que es lo que habilita buyback y withdraw', async () => {
    mockDas({ [EMBEDDED]: [carta('m1')] })
    const { result } = renderHook(() => useCollectorCryptNfts())
    await waitFor(() => expect(result.current.cards).toHaveLength(1))
    expect(result.current.cards[0].source).toBe('embedded')
  })

  it('sin embedded wallet no hay cartas ni petición', () => {
    embeddedAddress.mockReturnValue(null)
    const fetchMock = mockDas({})
    const { result } = renderHook(() => useCollectorCryptNfts())
    expect(result.current.cards).toEqual([])
    expect(result.current.loading).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('descarta lo que no sea de la colección de Collector Crypt', async () => {
    mockDas({
      [EMBEDDED]: [carta('m1'), { id: 'ajeno', grouping: [{ group_key: 'collection', group_value: 'Otra' }] }],
    })
    const { result } = renderHook(() => useCollectorCryptNfts())
    await waitFor(() => expect(result.current.cards).toHaveLength(1))
    expect(result.current.cards[0].mint).toBe('m1')
  })

  it('refresh vuelve a consultar', async () => {
    const fetchMock = mockDas({ [EMBEDDED]: [carta('m1')] })
    const { result } = renderHook(() => useCollectorCryptNfts())
    await waitFor(() => expect(result.current.cards).toHaveLength(1))
    result.current.refresh()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})
