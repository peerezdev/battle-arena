import { describe, it, expect } from 'vitest'
import { isRoyaleCreator } from './config'

describe('isRoyaleCreator', () => {
  it('is open to everyone (incl. null) when the allowlist is empty', () => {
    expect(isRoyaleCreator('AnyWallet', [])).toBe(true)
    expect(isRoyaleCreator(null, [])).toBe(true)
  })

  it('allows a wallet that is on the allowlist', () => {
    expect(isRoyaleCreator('WalletA', ['WalletA', 'WalletB'])).toBe(true)
  })

  it('rejects a wallet not on a non-empty allowlist', () => {
    expect(isRoyaleCreator('WalletC', ['WalletA'])).toBe(false)
  })

  it('rejects null/undefined when the allowlist is non-empty (fail-closed)', () => {
    expect(isRoyaleCreator(null, ['WalletA'])).toBe(false)
    expect(isRoyaleCreator(undefined, ['WalletA'])).toBe(false)
  })
})

// ── backendUrl por defecto ────────────────────────────────────────────────────
// Sin VITE_BACKEND_URL el frontend tiene que hablar con SU PROPIO origen: en dev lo enruta el proxy
// de vite.config.ts y en producción Caddy. El defecto era http://localhost:8080, que no escucha
// nadie en ningún entorno, así que un clon recién hecho sin .env fallaba sin decir por qué.

import { vi, beforeEach, afterEach } from 'vitest'

describe('config.backendUrl', () => {
  // El reseteo va ANTES de cada test, no solo después: este fichero importa './config' arriba del
  // todo, así que el módulo ya está cacheado con el .env real cuando arranca el primer caso. Sin
  // esto, el stub no tenía efecto y el test pasaba o fallaba según el orden — es decir, no probaba.
  beforeEach(() => { vi.resetModules() })
  afterEach(() => { vi.resetModules(); vi.unstubAllEnvs() })

  it('sin variable usa el origen de la página', async () => {
    vi.stubEnv('VITE_BACKEND_URL', undefined as unknown as string)
    const { config } = await import('./config')
    expect(config.backendUrl).toBe(window.location.origin)
  })

  it('el WebSocket que se deriva de él sale absoluto', async () => {
    // useServerEvents hace backendUrl.replace(/^http/, 'ws'); con cadena vacía saldría
    // `new WebSocket('/ws/chat')`, que depende de que el navegador resuelva URLs relativas.
    vi.stubEnv('VITE_BACKEND_URL', undefined as unknown as string)
    const { config } = await import('./config')
    const ws = config.backendUrl.replace(/^http/, 'ws') + '/ws/chat'
    expect(ws.startsWith('ws://') || ws.startsWith('wss://')).toBe(true)
  })

  it('la variable manda cuando está puesta', async () => {
    vi.stubEnv('VITE_BACKEND_URL', 'http://localhost:5173')
    const { config } = await import('./config')
    expect(config.backendUrl).toBe('http://localhost:5173')
  })
})
