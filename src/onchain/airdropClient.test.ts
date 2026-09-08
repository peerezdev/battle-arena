import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchAirdrop, claimAirdrop, AirdropError } from './airdropClient'

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const ko = (status: number) => ({ ok: false, status, json: async () => ({}) })

beforeEach(() => { vi.stubGlobal('fetch', vi.fn()) })

describe('airdropClient', () => {
  it('lee el estado del airdrop', async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ eligible: true, amount: 1483000000, claimed: false, signature: null }) as never)
    const s = await fetchAirdrop('tok')
    expect(s).toEqual({ eligible: true, amount: 1483000000, claimed: false, signature: null })
  })

  it('manda el token en la cabecera', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ eligible: false, amount: 0, claimed: false, signature: null }) as never)
    await fetchAirdrop('tok-123')
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok-123')
  })

  it('traduce el 503 a unavailable y NO a no elegible', async () => {
    // La distinción es la del backend: no saber no es saber que no.
    vi.mocked(fetch).mockResolvedValue(ko(503) as never)
    await expect(fetchAirdrop('tok')).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('traduce el 409 a already_claimed', async () => {
    vi.mocked(fetch).mockResolvedValue(ko(409) as never)
    await expect(claimAirdrop('tok')).rejects.toMatchObject({ kind: 'already_claimed' })
  })

  it('traduce el 403 a not_eligible', async () => {
    vi.mocked(fetch).mockResolvedValue(ko(403) as never)
    await expect(claimAirdrop('tok')).rejects.toMatchObject({ kind: 'not_eligible' })
  })

  it('cualquier otro fallo es failed', async () => {
    vi.mocked(fetch).mockResolvedValue(ko(500) as never)
    await expect(claimAirdrop('tok')).rejects.toBeInstanceOf(AirdropError)
  })

  it('devuelve la firma al reclamar', async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ signature: 'sig-1', amount: 1483000000 }) as never)
    expect(await claimAirdrop('tok')).toEqual({ signature: 'sig-1', amount: 1483000000 })
  })
})
