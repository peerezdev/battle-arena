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

// ── el vídeo tiene que cambiar al cambiar de máquina ──────────────────────────
// Un <video> no recarga porque cambie el `src` de su <source>: hay que remontarlo o llamar a
// load(). Sin eso React reutiliza el mismo nodo y sigue reproduciendo el primer vídeo que cargó —
// que es el de la máquina seleccionada por defecto. Síntoma: TODAS las máquinas enseñaban la
// imagen del gacha de 50, que es el primero de la lista que devuelve Collector Crypt.

function conVideo(code: string): GachaMachine {
  return { ...machine, code, name: code, videoSrc: `https://cc.test/${code}.webm`,
           thumbnailUrl: `https://cc.test/${code}.png` } as unknown as GachaMachine
}

describe('MachineDetailPanel · vídeo de la máquina', () => {
  beforeEach(() => viewport(true))

  it('remonta el vídeo al cambiar de máquina', () => {
    const { container, rerender } = render(
      <MachineDetailPanel machine={conVideo('pokemon_50')} authed usdc={500} onYolo={vi.fn()} />,
    )
    const antes = container.querySelector('video')
    expect(antes?.querySelector('source')?.getAttribute('src')).toContain('pokemon_50')

    rerender(<MachineDetailPanel machine={conVideo('onepiece_250')} authed usdc={500} onYolo={vi.fn()} />)
    const despues = container.querySelector('video')

    expect(despues?.querySelector('source')?.getAttribute('src')).toContain('onepiece_250')
    expect(despues).not.toBe(antes)   // nodo NUEVO: si se reutiliza, el navegador no recarga
  })

  it('el poster también acompaña a la máquina', () => {
    const { container, rerender } = render(
      <MachineDetailPanel machine={conVideo('pokemon_50')} authed usdc={500} onYolo={vi.fn()} />,
    )
    rerender(<MachineDetailPanel machine={conVideo('comic_25')} authed usdc={500} onYolo={vi.fn()} />)
    expect(container.querySelector('video')?.getAttribute('poster')).toContain('comic_25')
  })
})
