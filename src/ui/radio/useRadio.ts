import { useSyncExternalStore } from 'react'
import { radio } from './radioStore'
import type { Track } from './tracks'

export function useRadio() {
  const state = useSyncExternalStore(radio.subscribe, radio.getState, radio.getState)
  const tracks: Track[] = radio.getTracks()
  return {
    ...state,
    tracks,
    track: tracks[state.index] ?? null,
    play: radio.play,
    pause: radio.pause,
    toggle: radio.toggle,
    next: radio.next,
    prev: radio.prev,
    select: radio.select,
    setVolume: radio.setVolume,
    toggleShuffle: radio.toggleShuffle,
    tryAutoplay: radio.tryAutoplay,
  }
}
