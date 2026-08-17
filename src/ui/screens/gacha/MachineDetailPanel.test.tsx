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
    expect(showToast).toHaveBeenCalledWith('Turbo activated. Commons will be auto-sold', 'success')
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


describe('MachineDetailPanel · tirada gratis', () => {
  // Una tirada gratis cuesta 100.000 puntos en una máquina de 50 $ y sube con el precio, así que
  // lo que se pinta depende de la máquina tanto como del jugador.
  const maq = (price: number, freeSpins: boolean) =>
    ({ ...machine, price, freeSpins }) as unknown as GachaMachine
  const pintar = (m: GachaMachine, props: Record<string, unknown>) =>
    render(<MachineDetailPanel machine={m} authed usdc={500} onYolo={vi.fn()} {...props} />)

  it('con puntos suficientes ofrece el botón y dice cuántas quedan', () => {
    const onFreePack = vi.fn()
    pintar(maq(50, true), { freeSpins: { points_available: 250_000 }, onFreePack })
    const b = screen.getByRole('button', { name: /Free pack/i })
    expect(b.textContent).toMatch(/2 left/)          // 250.000 / 100.000
    fireEvent.click(b)
    expect(onFreePack).toHaveBeenCalled()
  })

  it('la máquina que no ofrece tiradas gratis no enseña nada, por muchos puntos que haya', () => {
    pintar(maq(50, false), { freeSpins: { points_available: 10_000_000 }, onFreePack: vi.fn() })
    expect(screen.queryByRole('button', { name: /Free pack/i })).toBeNull()
    expect(screen.queryByText(/points to a free pack/i)).toBeNull()
  })

  it('los mismos puntos dan tirada en la barata y no en la cara', () => {
    // El fallo que motivó el cambio: se anunciaban las mismas tiradas en todas las máquinas.
    const { unmount } = pintar(maq(50, true), { freeSpins: { points_available: 300_000 }, onFreePack: vi.fn() })
    expect(screen.getByRole('button', { name: /Free pack/i }).textContent).toMatch(/3 left/)
    unmount()

    pintar(maq(250, true), { freeSpins: { points_available: 300_000 }, onFreePack: vi.fn() })
    expect(screen.queryByRole('button', { name: /Free pack/i })).toBeNull()
    expect(screen.getByText(/200,000 points to a free pack here/i)).toBeTruthy()   // 500.000 − 300.000
  })

  it('cuando los puntos NO se pudieron leer lo dice, en vez de dejar el hueco vacío', () => {
    // El fallo que costó una tarde: con los puntos a null la pantalla escondía a la vez el saldo y
    // el botón, así que una sesión caducada se veía idéntica a "esta máquina no da tiradas gratis".
    const { unmount } = pintar(maq(50, true), { freeSpins: null, freeSpinsError: 'sesion', onFreePack: vi.fn() })
    expect(screen.getByText(/Log in again to see your free spins/i)).toBeTruthy()
    unmount()

    pintar(maq(50, true), { freeSpins: null, freeSpinsError: 'fallo', onFreePack: vi.fn() })
    expect(screen.getByText(/Could not load your points/i)).toBeTruthy()
  })

  it('sin wallet embebida NO dice "vuelve a entrar", que es lo que no lo arregla', () => {
    // El backend deriva el jugador de la wallet embebida del token. Con una sesión de wallet
    // externa el token es válido pero no la lleva, así que volver a entrar igual repite el 401.
    pintar(maq(50, true), { freeSpins: null, freeSpinsError: 'sin_wallet', onFreePack: vi.fn() })
    expect(screen.getByText(/no in-app wallet/i)).toBeTruthy()
    expect(screen.queryByText(/Log in again to see/i)).toBeNull()
  })

  it('avisa cuando CC tiene las tiradas gratis cerradas, en vez de no enseñar nada', () => {
    // La bandera combinada hacía que un cierre temporal se viera igual que una máquina que no las
    // da nunca: hueco vacío. El jugador con puntos no sabía si era él, la máquina o nosotros.
    const m = { ...machine, price: 50, freeSpins: false, freeSpinsClosed: true } as unknown as GachaMachine
    render(<MachineDetailPanel machine={m} authed usdc={500} onYolo={vi.fn()}
                               freeSpins={{ points_available: 300_000 }} onFreePack={vi.fn()} />)
    expect(screen.getByText(/paused right now/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Free pack/i })).toBeNull()
  })

  it('el aviso de fallo NO sale en máquinas que no dan tiradas gratis', () => {
    // Ahí no hay nada que prometer, así que un aviso solo sería ruido.
    pintar(maq(50, false), { freeSpins: null, freeSpinsError: 'sesion', onFreePack: vi.fn() })
    expect(screen.queryByText(/Log in again/i)).toBeNull()
  })

  it('sin tiradas NO deja un botón apagado: dice cuánto falta', () => {
    // Un botón deshabilitado invita a mirar los puntos; una línea de texto informa y no estorba.
    pintar(maq(50, true), { freeSpins: { points_available: 92_389 }, onFreePack: vi.fn() })
    expect(screen.queryByRole('button', { name: /Free pack/i })).toBeNull()
    expect(screen.getByText(/7,611 points to a free pack here/i)).toBeTruthy()
  })

  it('sin datos de CC no se pinta nada: es un extra, no parte del flujo', () => {
    pintar(maq(50, true), { freeSpins: null, onFreePack: vi.fn() })
    expect(screen.queryByRole('button', { name: /Free pack/i })).toBeNull()
    expect(screen.queryByText(/points to a free pack/i)).toBeNull()
  })
})

// ── Tiradas gratis en MÓVIL ──────────────────────────────────────────────────
//
// No existían: el bloque estaba escrito dentro de la maqueta de escritorio, y la de móvil usa una
// barra fija abajo con el contador y el Open. Un jugador de móvil no tenía forma de saber que tenía
// tiradas gratis, ni de gastarlas.

const conGratis = (props: Record<string, unknown> = {}) =>
  render(<MachineDetailPanel machine={{ ...machine, freeSpins: true } as GachaMachine}
    authed usdc={500} onYolo={vi.fn()} onFreePack={vi.fn()} {...props} />)

describe('MachineDetailPanel · tiradas gratis en móvil', () => {
  beforeEach(() => viewport(false))

  it('con puntos de sobra sale el botón', () => {
    // 25 $ pide 50.000 puntos (100.000 × 25/50): con 120.000 hay para dos.
    conGratis({ freeSpins: { points_available: 120_000 } })
    expect(screen.getByText(/Free pack · 2 left/)).toBeTruthy()
  })

  it('sin puntos suficientes dice CUÁNTO falta, no un botón apagado', () => {
    // Un botón que no se puede pulsar invita a mirar los puntos, no a jugar.
    conGratis({ freeSpins: { points_available: 10_000 } })
    expect(screen.getByText(/40,000 points to a free pack here/)).toBeTruthy()
    expect(screen.queryByText(/Free pack ·/)).toBeNull()
  })

  it('va ENCIMA del botón de Open, no debajo', () => {
    // Es una alternativa a pagar, así que tiene que llegar antes que el botón que cobra.
    conGratis({ freeSpins: { points_available: 120_000 } })
    const gratis = screen.getByText(/Free pack · 2 left/)
    const open = screen.getAllByText(/^Open/).slice(-1)[0]
    expect(gratis.compareDocumentPosition(open) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('pulsarlo llama a onFreePack', () => {
    const onFreePack = vi.fn()
    conGratis({ freeSpins: { points_available: 120_000 }, onFreePack })
    fireEvent.click(screen.getByText(/Free pack · 2 left/))
    expect(onFreePack).toHaveBeenCalled()
  })

  it('si CC las tiene pausadas lo dice, y que los puntos están a salvo', () => {
    // Sin esto, un cierre temporal se veía igual que una máquina que no las ofrece nunca.
    render(<MachineDetailPanel machine={{ ...machine, freeSpins: false, freeSpinsClosed: true } as GachaMachine}
      authed usdc={500} onYolo={vi.fn()} onFreePack={vi.fn()} />)
    expect(screen.getByText(/Free packs are paused right now/)).toBeTruthy()
  })

  it('si los puntos no se pudieron leer, se dice en vez de callarlo', () => {
    // Callarlo ERA el bug: la máquina las ofrecía, el jugador tenía puntos, y no salía nada.
    conGratis({ freeSpins: null, freeSpinsError: 'sesion' })
    expect(screen.getByText(/Log in again to see your free spins/)).toBeTruthy()
  })

  it('una máquina que no las ofrece no enseña nada', () => {
    render(<MachineDetailPanel machine={machine} authed usdc={500} onYolo={vi.fn()}
      onFreePack={vi.fn()} freeSpins={{ points_available: 999_999 }} />)
    expect(screen.queryByText(/Free pack/i)).toBeNull()
    expect(screen.queryByText(/points to a free pack/)).toBeNull()
  })

  it('en ESCRITORIO sigue estando, con la misma lógica', () => {
    // El bloque es compartido: si una maqueta se queda atrás, es porque se duplicó.
    viewport(true)
    conGratis({ freeSpins: { points_available: 120_000 } })
    expect(screen.getByText(/Free pack · 2 left/)).toBeTruthy()
  })
})
