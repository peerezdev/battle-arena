import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const showToast = vi.fn()
const dismissToast = vi.fn()
vi.mock('../../toastBus', () => ({
  showToast: (...a: unknown[]) => { showToast(...a); return 7 },
  dismissToast: (...a: unknown[]) => dismissToast(...a),
  setToastInset: () => {},
}))

import { MachineDetailPanel } from './MachineDetailPanel'
import type { GachaMachine } from '../../../onchain/gachaClient'

const machine: GachaMachine = {
  code: 'pokemon_25', name: 'PKMN 25', price: 25, image: null,
  odds: { common: 74, uncommon: 20, rare: 5, epic: 1 },
  turboMode: true, expectedValue: 21, buybackPct: 85, stock: {},
} as unknown as GachaMachine

// jsdom no trae matchMedia: sin esto useIsWide reportaría "estrecho" siempre y no se sabría
// cuál de las dos barras se está probando. Se fija a mano.
function viewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide, media: query,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  }))
}

/** El ⚡ suelto es el de móvil; el de escritorio lleva su etiqueta al lado. */
const turboIcon = () => screen.getAllByTitle('Turbo (auto-sell Commons)').find((b) => b.textContent === '⚡')!

describe('MachineDetailPanel · aviso del turbo en móvil', () => {
  beforeEach(() => { showToast.mockClear(); dismissToast.mockClear(); viewport(false) })

  const mount = () => render(<MachineDetailPanel machine={machine} authed usdc={500} onYolo={vi.fn()} />)

  it('al encenderlo dice qué acaba de activar', () => {
    mount()
    fireEvent.click(turboIcon())
    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith('Turbo activated — Commons will be auto-sold', 'success')
  })

  it('al apagarlo RETIRA el aviso en vez de sacar otro', () => {
    // El aviso describe un estado. Si el usuario lo deshace enseguida, dejarlo en pantalla
    // estaría diciendo algo que ya no es verdad.
    mount()
    const b = turboIcon()
    fireEvent.click(b)      // ON
    fireEvent.click(b)      // OFF
    expect(showToast).toHaveBeenCalledTimes(1)   // no sale un segundo aviso…
    expect(dismissToast).toHaveBeenCalledWith(7) // …y el primero se retira
  })

  it('una máquina sin turbo no monta el botón', () => {
    render(<MachineDetailPanel machine={{ ...machine, turboMode: false }} authed usdc={500} onYolo={vi.fn()} />)
    expect(screen.queryByTitle('Turbo (auto-sell Commons)')).toBeNull()
  })
})
