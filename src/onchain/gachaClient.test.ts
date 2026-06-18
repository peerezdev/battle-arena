import { describe, expect, it, vi } from 'vitest'
import { pollOpenPack, defaultDelayMs, type OpenPackResult } from './gachaClient'
import { fetchBuybackAvailable, requestBuyback } from './gachaClient'
import { config } from './config'
import { ccAssetUrl } from './gachaClient'

describe('pollOpenPack', () => {
  it('devuelve el resultado en cuanto deja de estar pendiente', async () => {
    const attempts: OpenPackResult[] = [
      { pending: true },
      { pending: true },
      { pending: false, nft_address: 'M1', rarity: 'Rare', name: 'Pika', image: null, year: null, grade: null, images: [], insured_value: null, grading_company: null, grading_id: null, authenticated: null },
    ]
    let i = 0
    const open = vi.fn(async () => attempts[i++])
    const result = await pollOpenPack(open, { maxAttempts: 5, delayMs: () => 0 })
    expect(result.pending).toBe(false)
    expect(open).toHaveBeenCalledTimes(3)
  })

  it('agota intentos y devuelve pending', async () => {
    const open = vi.fn(async (): Promise<OpenPackResult> => ({ pending: true }))
    const result = await pollOpenPack(open, { maxAttempts: 3, delayMs: () => 0 })
    expect(result.pending).toBe(true)
    expect(open).toHaveBeenCalledTimes(3)
  })

  it('backoff exponencial por defecto: 2s, 4s, 8s… cap 30s', () => {
    expect(defaultDelayMs(0)).toBe(2000)
    expect(defaultDelayMs(1)).toBe(4000)
    expect(defaultDelayMs(2)).toBe(8000)
    expect(defaultDelayMs(10)).toBe(30000)
  })
})

describe('fetchBuybackAvailable', () => {
  it('hace GET con wallet+nft y devuelve el JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ available: true, amount: 42500000 }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchBuybackAvailable('WALLET', 'NFT1')
    expect(out).toEqual({ available: true, amount: 42500000 })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url.startsWith(`${config.backendUrl}/gacha/buyback/available?`)).toBe(true)
    expect(url).toContain('wallet=WALLET')
    expect(url).toContain('nft=NFT1')
    vi.unstubAllGlobals()
  })
})

describe('requestBuyback', () => {
  it('hace POST con Bearer y body {nft_address}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ serialized_transaction: 'TX', refund_amount: 42500000, memo: 'm' }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await requestBuyback('TOKEN', 'NFT1')
    expect(out).toEqual({ serialized_transaction: 'TX', refund_amount: 42500000, memo: 'm' })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOKEN')
    expect(JSON.parse(init.body)).toEqual({ nft_address: 'NFT1' })
    vi.unstubAllGlobals()
  })

  it('propaga el detail del backend en error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ detail: 'outside 72-hour window' }) }))
    await expect(requestBuyback('TOKEN', 'NFT1')).rejects.toThrow('72-hour')
    vi.unstubAllGlobals()
  })
})

describe('ccAssetUrl', () => {
  it('apunta a la página del asset en CollectorCrypt', () => {
    expect(ccAssetUrl('7mNc3Hr1Aqr16u8Y5VKQDinLHbBumUxV6T6kxFRz2xGH'))
      .toBe('https://collectorcrypt.com/assets/solana/7mNc3Hr1Aqr16u8Y5VKQDinLHbBumUxV6T6kxFRz2xGH')
  })
})
