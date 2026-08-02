import { describe, it, expect } from 'vitest'
import { tweetText, xIntentUrl } from './shareOnX'
import type { Pnl } from './pnl'

const pnl = (over: Partial<Pnl> = {}): Pnl => ({
  mode: 'PACK BATTLE', winner: 'A', entry: 450, payout: 1812,
  profit: 1362, multiple: 4.026, background: null, ...over,
})

describe('tweetText', () => {
  it('presume de la ganancia y del múltiplo', () => {
    const t = tweetText(pnl())
    expect(t).toContain('$1,362 profit')
    expect(t).toContain('×4.0')
    expect(t).toContain('Pack battle')
  })

  it('con pérdida NO dice que ganó dinero', () => {
    // Ganar la partida y perder dinero pasa cuando el botín vale menos que la entrada. Un tuit
    // con un "+" ahí sería mentira, así que se cuenta lo que sí es cierto: qué se llevó.
    const t = tweetText(pnl({ profit: -100, payout: 350, multiple: 0.78 }))
    expect(t).toContain('$350 in cards')
    expect(t).not.toContain('profit')
    expect(t).not.toContain('-')
  })

  it('sin entrada no se inventa un múltiplo', () => {
    expect(tweetText(pnl({ multiple: null }))).not.toContain('×')
  })
})

describe('xIntentUrl', () => {
  it('lleva el texto y el enlace, escapados', () => {
    const u = new URL(xIntentUrl(pnl()))
    expect(u.origin + u.pathname).toBe('https://x.com/intent/post')
    expect(u.searchParams.get('text')).toBe(tweetText(pnl()))
    expect(u.searchParams.get('url')).toContain('collectorarena.xyz')
  })

  it('acepta un enlace concreto, para poder apuntar a la partida', () => {
    const u = new URL(xIntentUrl(pnl(), 'https://collectorarena.xyz/b/abc'))
    expect(u.searchParams.get('url')).toBe('https://collectorarena.xyz/b/abc')
  })
})
