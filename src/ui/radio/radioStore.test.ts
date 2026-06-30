import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRadioStore, type RadioState } from './radioStore'
import type { Track } from './tracks'

const TRACKS: Track[] = [
  { id: 'a', title: 'A', artist: 'x', url: 'url-a' },
  { id: 'b', title: 'B', artist: 'y', url: 'url-b' },
  { id: 'c', title: 'C', artist: 'z', url: 'url-c' },
]

// Minimal fake of HTMLAudioElement — jsdom does not implement play()/pause().
class FakeAudio {
  src = ''
  volume = 1
  currentTime = 0
  duration = 0
  paused = true
  preload = ''
  loop = false
  handlers: Record<string, Array<() => void>> = {}
  play() { this.paused = false; return Promise.resolve() }
  pause() { this.paused = true }
  addEventListener(type: string, cb: () => void) { (this.handlers[type] ||= []).push(cb) }
  removeEventListener(type: string, cb: () => void) {
    this.handlers[type] = (this.handlers[type] || []).filter((h) => h !== cb)
  }
  emit(type: string) { (this.handlers[type] || []).forEach((h) => h()) }
}

function setup() {
  const fake = new FakeAudio()
  const store = createRadioStore(TRACKS, () => fake as unknown as HTMLAudioElement)
  return { fake, store }
}

beforeEach(() => {
  try { localStorage.clear() } catch { /* ignore */ }
})

describe('radioStore core', () => {
  it('starts at index 0, paused, default volume 0.6', () => {
    const { store } = setup()
    const s: RadioState = store.getState()
    expect(s.index).toBe(0)
    expect(s.isPlaying).toBe(false)
    expect(s.volume).toBe(0.6)
    expect(s.shuffle).toBe(false)
  })

  it('play() sets isPlaying and starts the audio with the current track url', () => {
    const { fake, store } = setup()
    store.play()
    expect(store.getState().isPlaying).toBe(true)
    expect(fake.paused).toBe(false)
    expect(fake.src).toBe('url-a')
  })

  it('pause() stops the audio', () => {
    const { fake, store } = setup()
    store.play()
    store.pause()
    expect(store.getState().isPlaying).toBe(false)
    expect(fake.paused).toBe(true)
  })

  it('toggle() flips play/pause', () => {
    const { store } = setup()
    store.toggle()
    expect(store.getState().isPlaying).toBe(true)
    store.toggle()
    expect(store.getState().isPlaying).toBe(false)
  })

  it('next() advances and wraps to 0 after the last track', () => {
    const { fake, store } = setup()
    store.next()
    expect(store.getState().index).toBe(1)
    expect(fake.src).toBe('url-b')
    store.next()
    expect(store.getState().index).toBe(2)
    store.next()
    expect(store.getState().index).toBe(0)
  })

  it('prev() goes back and wraps to the last track from 0', () => {
    const { store } = setup()
    store.prev()
    expect(store.getState().index).toBe(2)
  })

  it('select(i) loads and plays that track', () => {
    const { fake, store } = setup()
    store.select(2)
    expect(store.getState().index).toBe(2)
    expect(fake.src).toBe('url-c')
    expect(fake.paused).toBe(false)
  })

  it('the audio "ended" event advances to the next track', () => {
    const { fake, store } = setup()
    store.play()
    fake.emit('ended')
    expect(store.getState().index).toBe(1)
  })

  it('the audio "error" event skips to the next track', () => {
    const { fake, store } = setup()
    store.play()
    fake.emit('error')
    expect(store.getState().index).toBe(1)
  })

  it('setVolume clamps to 0..1, applies to the audio, and persists', () => {
    const { fake, store } = setup()
    store.play()
    store.setVolume(0.3)
    expect(store.getState().volume).toBe(0.3)
    expect(fake.volume).toBe(0.3)
    expect(localStorage.getItem('battlearena.radio.volume')).toBe('0.3')
    store.setVolume(5)
    expect(store.getState().volume).toBe(1)
    store.setVolume(-1)
    expect(store.getState().volume).toBe(0)
  })

  it('persists the current index on select', () => {
    const { store } = setup()
    store.select(1)
    expect(localStorage.getItem('battlearena.radio.index')).toBe('1')
  })

  it('restores index/volume/shuffle from localStorage on construction', () => {
    localStorage.setItem('battlearena.radio.index', '2')
    localStorage.setItem('battlearena.radio.volume', '0.4')
    localStorage.setItem('battlearena.radio.shuffle', '1')
    const fake = new FakeAudio()
    const store = createRadioStore(TRACKS, () => fake as unknown as HTMLAudioElement)
    const s = store.getState()
    expect(s.index).toBe(2)
    expect(s.volume).toBe(0.4)
    expect(s.shuffle).toBe(true)
  })

  it('subscribe is notified on state changes and getState identity changes', () => {
    const { store } = setup()
    const before = store.getState()
    const cb = vi.fn()
    const unsub = store.subscribe(cb)
    store.play()
    expect(cb).toHaveBeenCalled()
    expect(store.getState()).not.toBe(before)
    unsub()
    cb.mockClear()
    store.pause()
    expect(cb).not.toHaveBeenCalled()
  })
})
