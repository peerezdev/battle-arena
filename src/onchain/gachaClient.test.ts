import { describe, expect, it, vi } from 'vitest'
import { pollOpenPack, defaultDelayMs, type OpenPackResult } from './gachaClient'

describe('pollOpenPack', () => {
  it('devuelve el resultado en cuanto deja de estar pendiente', async () => {
    const attempts: OpenPackResult[] = [
      { pending: true },
      { pending: true },
      { pending: false, nft_address: 'M1', rarity: 'Rare', name: 'Pika', image: null },
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
