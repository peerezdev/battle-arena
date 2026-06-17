// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { attest } from './oracleClient'
import { getOpenMatches, registerMatch, syncMatch, compareElo } from './backendClient'

beforeEach(() => vi.restoreAllMocks())

const BATTLE_ZERO = '11111111111111111111111111111111'

describe('oracleClient', () => {
  it('attest llama al endpoint del oráculo con mint y battle', async () => {
    const json = { mint: 'M', value_usd: 1200, grade: 9, grading_company: 'PSA', ts: 1, message_hex: 'aa', signature_hex: 'bb', oracle_pubkey: 'O' }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => json })
    vi.stubGlobal('fetch', fetchMock)
    const r = await attest('M', BATTLE_ZERO)
    expect(r.value_usd).toBe(1200)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/attest?mint=M')
    expect(url).toContain('battle=')
  })

  it('attest lanza si resp.ok es false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(attest('BADMINT', BATTLE_ZERO)).rejects.toThrow()
  })
})

describe('backendClient', () => {
  it('registerMatch manda Bearer y battle_pubkey', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ battle_pubkey: 'B', status: 'open' }) })
    vi.stubGlobal('fetch', fetchMock)
    await registerMatch('TOK', { battle_pubkey: 'B', min_elo: null, max_elo: null })
    const opts = fetchMock.mock.calls[0][1]
    expect(opts.headers.Authorization).toBe('Bearer TOK')
  })

  it('getOpenMatches llama GET /matches/open con viewer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)
    await getOpenMatches('VIEWER_KEY')
    expect(fetchMock.mock.calls[0][0]).toContain('/matches/open')
    expect(fetchMock.mock.calls[0][0]).toContain('viewer=VIEWER_KEY')
  })

  it('syncMatch llama POST /matches/{battle}/sync', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'ok' }) })
    vi.stubGlobal('fetch', fetchMock)
    await syncMatch('BATTLE_KEY', 'TOK')
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/matches/BATTLE_KEY/sync')
    const opts = fetchMock.mock.calls[0][1]
    expect(opts.method).toBe('POST')
  })

  it('compareElo llama el endpoint correcto', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ elo_a: 1200, elo_b: 1100, diff: 100 }) })
    vi.stubGlobal('fetch', fetchMock)
    const r = await compareElo('ADDR_A', 'ADDR_B')
    expect(fetchMock.mock.calls[0][0]).toContain('/elo/compare')
    expect(r.diff).toBe(100)
  })

})
