import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// Spy the imperative bubble + the WS broadcast so the test stays in the pure gating logic.
const throwEmoteSpy = vi.fn()
vi.mock('./throwEmote', () => ({ throwEmote: (...a: unknown[]) => throwEmoteSpy(...a) }))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: null }) }))
vi.mock('../../onchain/emotesClient', () => ({ throwEmoteToBattle: vi.fn() }))

const emote = { code: 'gg', name: 'GG', video_url: 'gg.webm' }
const CUATRO = ['gg', 'ez', 'wp', 'gl']
const catalogo = Object.fromEntries(CUATRO.map((c) => [c, { code: c, name: c.toUpperCase(), video_url: `${c}.webm` }]))
const estado = { byCode: { gg: emote } as Record<string, typeof emote>, owned: ['gg'], slots: ['gg'], loading: false, updateSlots: vi.fn() }
vi.mock('./useEmotes', () => ({ useEmotes: () => estado }))

import { EmoteBar, EMOTE_COOLDOWN_MS } from './EmoteBar'

describe('EmoteBar cooldown', () => {
  beforeEach(() => { throwEmoteSpy.mockClear(); vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('throws once, then gates further emotes until the cooldown elapses', () => {
    render(<EmoteBar meWallet="W" />)

    // first throw goes through
    fireEvent.click(screen.getByTitle('Throw GG'))
    expect(throwEmoteSpy).toHaveBeenCalledTimes(1)

    // now on cooldown: button disabled + hint visible
    const cd = screen.getByTitle(/Cooldown/) as HTMLButtonElement
    expect(cd.disabled).toBe(true)
    expect(screen.getByText(/WAIT/)).toBeTruthy()

    // a second click while cooling down is a no-op
    fireEvent.click(cd)
    expect(throwEmoteSpy).toHaveBeenCalledTimes(1)

    // after the cooldown the button re-enables and throws again
    act(() => { vi.advanceTimersByTime(EMOTE_COOLDOWN_MS + 300) })
    const again = screen.getByTitle('Throw GG') as HTMLButtonElement
    expect(again.disabled).toBe(false)
    fireEvent.click(again)
    expect(throwEmoteSpy).toHaveBeenCalledTimes(2)
  })
})


describe('EmoteBar · huecos rápidos', () => {
  beforeEach(() => {
    estado.byCode = catalogo; estado.owned = [...CUATRO]; estado.slots = [...CUATRO]
  })
  afterEach(() => {
    estado.byCode = { gg: emote }; estado.owned = ['gg']; estado.slots = ['gg']
  })

  it('pinta un botón por hueco que mande el backend', () => {
    render(<EmoteBar meWallet="W" />)
    for (const c of CUATRO) expect(screen.getByTitle(`Throw ${c.toUpperCase()}`)).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(CUATRO.length)   // ni uno más
  })

  it('ya no está el "+" de la colección', () => {
    // Se retiró a petición. Mientras no vuelva, los huecos los reparte el backend.
    render(<EmoteBar meWallet="W" />)
    expect(screen.queryByTitle('All emotes')).toBeNull()
    expect(screen.queryByText('Your emotes')).toBeNull()
  })

  it('sin cooldown no hay etiqueta: los dibujos ya dicen lo que son', () => {
    render(<EmoteBar meWallet="W" />)
    expect(screen.queryByText('EMOTE')).toBeNull()
    expect(screen.queryByText(/WAIT/)).toBeNull()
  })
})
