import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as client from './packBattleClient'
import { config } from './config'

function mockFetch(body: unknown, ok = true, status = 200) {
  return vi.fn().mockResolvedValue({
    ok, status,
    json: async () => body,
  } as unknown as Response)
}

describe('packBattleClient', () => {
  afterEach(() => vi.restoreAllMocks())

  it('createBattle POSTs with auth + body and returns the battle', async () => {
    const battle = { id: 'b1', mode: 'pack', status: 'lobby', players: [], rounds: [] }
    const f = mockFetch(battle); vi.stubGlobal('fetch', f)
    const out = await client.createBattle('tok', { machine_code: 'pokemon_50', max_players: 2, mode: 'pack' })
    expect(out).toEqual(battle)
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe(`${config.backendUrl}/pack-battles`)
    expect(opts.method).toBe('POST')
    expect(opts.headers.Authorization).toBe('Bearer tok')
    expect(JSON.parse(opts.body)).toEqual({ machine_code: 'pokemon_50', max_players: 2, mode: 'pack' })
  })

  it('joinBattle and cancelBattle hit the right authed paths', async () => {
    const f = mockFetch({ id: 'b 1' }); vi.stubGlobal('fetch', f)
    await client.joinBattle('tok', 'b 1')
    expect(f.mock.calls[0][0]).toBe(`${config.backendUrl}/pack-battles/b%201/join`)
    expect(f.mock.calls[0][1].method).toBe('POST')
    expect(f.mock.calls[0][1].headers.Authorization).toBe('Bearer tok')
    await client.cancelBattle('tok', 'b 1')
    expect(f.mock.calls[1][0]).toBe(`${config.backendUrl}/pack-battles/b%201/cancel`)
  })

  it('public reads send NO auth header', async () => {
    const f = mockFetch([]); vi.stubGlobal('fetch', f)
    await client.listOpenBattles()
    expect(f.mock.calls[0][0]).toBe(`${config.backendUrl}/pack-battles/open`)
    expect((f.mock.calls[0][1]?.headers ?? {}).Authorization).toBeUndefined()
    await client.getBattle('b1')
    expect(f.mock.calls[1][0]).toBe(`${config.backendUrl}/pack-battles/b1`)
    await client.verifyBattle('b1')
    expect(f.mock.calls[2][0]).toBe(`${config.backendUrl}/pack-battles/b1/verify`)
  })

  it('throws Error(detail) on a non-ok response', async () => {
    const f = mockFetch({ detail: 'USDC disponible insuficiente' }, false, 402); vi.stubGlobal('fetch', f)
    await expect(client.getBattle('b1')).rejects.toThrow('USDC disponible insuficiente')
  })
})
