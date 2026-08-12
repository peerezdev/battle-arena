import { describe, it, expect, vi, afterEach } from 'vitest'
import { sendTip, TipError } from './tipClient'

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('sendTip', () => {
  it('devuelve la firma cuando el envío va bien', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { signature: 'sig-1', amount: 1.5, to: 'WalletB' }))
    const out = await sendTip('token', 'WalletB', 1.5, 'profile')
    expect(out.signature).toBe('sig-1')
    expect(out.amount).toBe(1.5)
  })

  it('manda el importe y el origen en el cuerpo', async () => {
    const f = mockFetch(200, { signature: 's', amount: 2, to: 'WalletB' })
    vi.stubGlobal('fetch', f)
    await sendTip('token', 'WalletB', 2, 'chat')
    const body = JSON.parse(f.mock.calls[0][1].body)
    expect(body).toEqual({ to: 'WalletB', amount: 2, source: 'chat' })
  })

  it.each([
    [404, 'no_account'],
    [402, 'insufficient'],
    [429, 'too_many'],
    [422, 'invalid'],
    [503, 'unavailable'],
    [502, 'failed'],
  ])('traduce el %i a %s', async (status, kind) => {
    vi.stubGlobal('fetch', mockFetch(status, { detail: 'lo que sea' }))
    await expect(sendTip('token', 'WalletB', 1.5)).rejects.toMatchObject({ kind })
  })

  it('el error es un TipError', async () => {
    vi.stubGlobal('fetch', mockFetch(404, {}))
    await expect(sendTip('token', 'WalletB', 1.5)).rejects.toBeInstanceOf(TipError)
  })
})
