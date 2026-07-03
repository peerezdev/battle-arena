import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// Spy the imperative bubble + the WS broadcast so the test stays in the pure gating logic.
const throwEmoteSpy = vi.fn()
vi.mock('./throwEmote', () => ({ throwEmote: (...a: unknown[]) => throwEmoteSpy(...a) }))
vi.mock('@privy-io/react-auth', () => ({ useIdentityToken: () => ({ identityToken: null }) }))
vi.mock('../../onchain/emotesClient', () => ({ throwEmoteToBattle: vi.fn() }))

const emote = { code: 'gg', name: 'GG', video_url: 'gg.webm' }
vi.mock('./useEmotes', () => ({
  useEmotes: () => ({ byCode: { gg: emote }, owned: ['gg'], slots: ['gg'], loading: false, updateSlots: vi.fn() }),
}))

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
