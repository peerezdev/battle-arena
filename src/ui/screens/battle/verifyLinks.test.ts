import { describe, it, expect } from 'vitest'
import { solscanTxUrl, ccVrfUrl } from './verifyLinks'

describe('solscanTxUrl', () => {
  it('apunta al cluster correcto', () => {
    expect(solscanTxUrl('SIG', true)).toBe('https://solscan.io/tx/SIG?cluster=devnet')
    expect(solscanTxUrl('SIG', false)).toBe('https://solscan.io/tx/SIG')
  })

  it('sin firma no hay enlace', () => {
    // Las tiradas anteriores a la columna `tx_signature` no la tienen. Un enlace roto sería peor
    // que ninguno: en una página que existe para demostrar algo, un 404 desmiente la promesa.
    expect(solscanTxUrl(null, true)).toBeNull()
    expect(solscanTxUrl(undefined, true)).toBeNull()
    expect(solscanTxUrl('', true)).toBeNull()
  })
})

describe('ccVrfUrl', () => {
  it('usa el host de la red de la tirada', () => {
    expect(ccVrfUrl('cc-abc', true)).toBe('https://dev-gacha.collectorcrypt.com/api/vrf/verify?memo=cc-abc')
    expect(ccVrfUrl('cc-abc', false)).toBe('https://gacha.collectorcrypt.com/api/vrf/verify?memo=cc-abc')
  })

  it('quita el sufijo :open', () => {
    // On-chain el memo va como `cc-<uuid>:open`; el endpoint solo entiende el prefijo. Mandarlo
    // entero devuelve vacío, que se lee como "esta tirada no existe".
    expect(ccVrfUrl('cc-abc:open', true)).toContain('memo=cc-abc')
    expect(ccVrfUrl('cc-abc:open', true)).not.toContain('%3Aopen')
  })

  it('sin memo no hay enlace', () => {
    expect(ccVrfUrl(null, true)).toBeNull()
    expect(ccVrfUrl('', true)).toBeNull()
  })

  it('escapa el memo', () => {
    expect(ccVrfUrl('a b&c', true)).toContain('memo=a%20b%26c')
  })
})
