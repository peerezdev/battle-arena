import { describe, expect, it, vi } from 'vitest'
import { pollOpenPack, defaultDelayMs, type OpenPackResult , machineCardCount } from './gachaClient'
import { fetchBuybackAvailable, requestBuyback, withdrawNft } from './gachaClient'
import { generateYoloPacks, yoloTotalCost, clampCount } from './gachaClient'
import { config } from './config'
import { ccAssetUrl, ccCardImageUrl } from './gachaClient'

describe('pollOpenPack', () => {
  it('devuelve el resultado en cuanto deja de estar pendiente', async () => {
    const attempts: OpenPackResult[] = [
      { pending: true },
      { pending: true },
      { pending: false, nft_address: 'M1', rarity: 'Rare', name: 'Pika', image: null, year: null, grade: null, images: [], insured_value: null, grading_company: null, grading_id: null, authenticated: null, auto_sold: false, buyback_amount: null },
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

describe('withdrawNft', () => {
  it('hace POST a /users/me/nft/withdraw con Bearer y body {nft_address, address}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ signature: 'SIG', nft_address: 'NFT1', address: 'DEST' }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await withdrawNft('TOKEN', 'NFT1', 'DEST')
    expect(out).toEqual({ signature: 'SIG', nft_address: 'NFT1', address: 'DEST' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${config.backendUrl}/users/me/nft/withdraw`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOKEN')
    expect(JSON.parse(init.body)).toEqual({ nft_address: 'NFT1', address: 'DEST' })
    vi.unstubAllGlobals()
  })

  it('propaga el detail del backend en error (p.ej. no eres dueño)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ detail: 'no eres dueño de este NFT' }) }))
    await expect(withdrawNft('TOKEN', 'NFT1', 'DEST')).rejects.toThrow('dueño')
    vi.unstubAllGlobals()
  })
})

describe('ccAssetUrl', () => {
  it('apunta a la página del asset en CollectorCrypt', () => {
    expect(ccAssetUrl('7mNc3Hr1Aqr16u8Y5VKQDinLHbBumUxV6T6kxFRz2xGH'))
      .toBe('https://collectorcrypt.com/assets/solana/7mNc3Hr1Aqr16u8Y5VKQDinLHbBumUxV6T6kxFRz2xGH')
  })
})

describe('ccCardImageUrl', () => {
  it('returns the CC devnet front-image endpoint for a mint', () => {
    expect(ccCardImageUrl('7mNc3Hr1Aqr16u8Y5VKQDinLHbBumUxV6T6kxFRz2xGH'))
      .toBe('https://nft-dev.collectorcrypt.com/front/7mNc3Hr1Aqr16u8Y5VKQDinLHbBumUxV6T6kxFRz2xGH')
  })
})

describe('yoloTotalCost / clampCount', () => {
  it('coste total = precio * count', () => {
    expect(yoloTotalCost(50, 3)).toBe(150)
    expect(yoloTotalCost(1000, 10)).toBe(10000)
  })
  it('clampCount fija a [1,10] y entero', () => {
    expect(clampCount(0)).toBe(1)
    expect(clampCount(11)).toBe(10)
    expect(clampCount(3.7)).toBe(3)
  })
})

describe('generateYoloPacks', () => {
  it('POST /gacha/yolo con Bearer + body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
      yolo_id: 'y', count: 2, transactions: [{ memo: 'a', transaction: 'TX' }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await generateYoloPacks('TOKEN', 'pokemon_50', 2, true)
    expect(out.transactions[0]).toEqual({ memo: 'a', transaction: 'TX' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${config.backendUrl}/gacha/yolo`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOKEN')
    expect(JSON.parse(init.body)).toEqual({ pack_type: 'pokemon_50', count: 2, turbo: true })
    vi.unstubAllGlobals()
  })
})

describe('machineCardCount', () => {
  it('suma el stock de todas las rarezas', () => {
    // pokemon_250 real: el cartel decía 24 (el limit de la cuadrícula) en vez de 572.
    expect(machineCardCount({ common: 19, uncommon: 77, rare: 459, epic: 17 })).toBe(572)
  })
  it('una máquina agotada da 0, no null (0 es informativo)', () => {
    expect(machineCardCount({ common: 0, uncommon: 0, rare: 0, epic: 0 })).toBe(0)
  })
  it('sin stock devuelve null para poder ocultar el cartel', () => {
    expect(machineCardCount(null)).toBeNull()
    expect(machineCardCount(undefined)).toBeNull()
    expect(machineCardCount({})).toBeNull()
  })
  it('ignora valores no numéricos en vez de propagar NaN', () => {
    expect(machineCardCount({ rare: 5, roto: undefined as unknown as number })).toBe(5)
  })
})
