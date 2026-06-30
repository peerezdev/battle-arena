import { TRACKS, type Track } from './tracks'

export type RadioState = {
  index: number
  isPlaying: boolean
  volume: number
  shuffle: boolean
  currentTime: number
  duration: number
}

export type RadioStore = {
  getState(): RadioState
  getTracks(): Track[]
  subscribe(cb: () => void): () => void
  play(): void
  pause(): void
  toggle(): void
  next(): void
  prev(): void
  select(i: number): void
  setVolume(v: number): void
  toggleShuffle(): void
  tryAutoplay(): void
}

const KEY_INDEX = 'battlearena.radio.index'
const KEY_VOLUME = 'battlearena.radio.volume'
const KEY_SHUFFLE = 'battlearena.radio.shuffle'
const DEFAULT_VOLUME = 0.6

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function readBool(key: string): boolean {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}

function write(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* ignore storage failures */ }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}

export function createRadioStore(
  tracks: Track[],
  makeAudio: () => HTMLAudioElement = () => new Audio(),
): RadioStore {
  const startIndex = tracks.length
    ? Math.max(0, Math.min(tracks.length - 1, Math.trunc(readNumber(KEY_INDEX, 0))))
    : 0

  // Mutable internal state + an immutable snapshot for useSyncExternalStore identity.
  const internal: RadioState = {
    index: startIndex,
    isPlaying: false,
    volume: clamp01(readNumber(KEY_VOLUME, DEFAULT_VOLUME)),
    shuffle: readBool(KEY_SHUFFLE),
    currentTime: 0,
    duration: 0,
  }
  let snapshot: RadioState = { ...internal }

  const listeners = new Set<() => void>()
  let audio: HTMLAudioElement | null = null

  let armed = false
  const GESTURES: Array<'pointerdown' | 'keydown' | 'touchstart'> = ['pointerdown', 'keydown', 'touchstart']

  function disarm(): void {
    if (!armed || typeof document === 'undefined') return
    armed = false
    GESTURES.forEach((g) => document.removeEventListener(g, onGesture))
  }

  function onGesture(): void {
    disarm()
    play()
  }

  function arm(): void {
    if (armed || typeof document === 'undefined') return
    armed = true
    GESTURES.forEach((g) => document.addEventListener(g, onGesture))
  }

  function emit(): void {
    snapshot = { ...internal }
    listeners.forEach((l) => l())
  }

  function ensureAudio(): HTMLAudioElement | null {
    if (audio) return audio
    if (typeof window === 'undefined') return null
    try {
      const el = makeAudio()
      el.volume = internal.volume
      el.preload = 'auto'
      el.addEventListener('ended', () => next())
      el.addEventListener('error', () => skipOnError())
      el.addEventListener('timeupdate', () => { internal.currentTime = el.currentTime || 0; emit() })
      el.addEventListener('loadedmetadata', () => { internal.duration = el.duration || 0; emit() })
      el.src = tracks[internal.index]?.url ?? ''
      audio = el
      return el
    } catch {
      return null
    }
  }

  function loadTrack(i: number): void {
    if (!tracks.length) return
    internal.index = ((i % tracks.length) + tracks.length) % tracks.length
    internal.currentTime = 0
    write(KEY_INDEX, String(internal.index))
    const el = ensureAudio()
    if (el) {
      try { el.src = tracks[internal.index].url } catch { /* ignore */ }
    }
    emit()
  }

  // Uniformly pick an index different from the current one.
  function randomOther(): number {
    if (tracks.length <= 1) return internal.index
    const r = Math.floor(Math.random() * (tracks.length - 1))
    return r >= internal.index ? r + 1 : r
  }

  function pickNext(): number {
    return internal.shuffle ? randomOther() : (internal.index + 1) % tracks.length
  }
  function pickPrev(): number {
    return internal.shuffle ? randomOther() : (internal.index - 1 + tracks.length) % tracks.length
  }

  function play(): void {
    if (!tracks.length) return
    const el = ensureAudio()
    internal.isPlaying = true
    emit()
    if (!el) return
    try {
      const p = el.play()
      if (p && typeof p.catch === 'function') p.catch(() => { /* gesture/policy — ignore */ })
    } catch {
      /* never let audio break the UI */
    }
  }

  function pause(): void {
    internal.isPlaying = false
    emit()
    try { audio?.pause() } catch { /* ignore */ }
  }

  function toggle(): void { internal.isPlaying ? pause() : play() }

  function next(): void {
    if (!tracks.length) return
    loadTrack(pickNext())
    play()
  }

  function prev(): void {
    if (!tracks.length) return
    loadTrack(pickPrev())
    play()
  }

  function select(i: number): void {
    if (!tracks.length) return
    loadTrack(i)
    play()
  }

  function skipOnError(): void {
    console.warn('[radio] track failed to load, skipping:', tracks[internal.index]?.url)
    next()
  }

  function setVolume(v: number): void {
    internal.volume = clamp01(v)
    if (audio) { try { audio.volume = internal.volume } catch { /* ignore */ } }
    write(KEY_VOLUME, String(internal.volume))
    emit()
  }

  function toggleShuffle(): void {
    internal.shuffle = !internal.shuffle
    write(KEY_SHUFFLE, internal.shuffle ? '1' : '0')
    emit()
  }

  function tryAutoplay(): void {
    if (internal.isPlaying || !tracks.length) return
    // Arm the gesture fallback first so a blocked attempt is covered synchronously.
    arm()
    const el = ensureAudio()
    if (!el) return
    try {
      const p = el.play()
      if (p && typeof p.then === 'function') {
        p.then(() => { internal.isPlaying = true; emit(); disarm() })
         .catch(() => { /* blocked — stay armed until first gesture */ })
      } else {
        internal.isPlaying = true
        emit()
        disarm()
      }
    } catch {
      /* stay armed */
    }
  }

  return {
    getState: () => snapshot,
    getTracks: () => tracks,
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb) } },
    play, pause, toggle, next, prev, select, setVolume, toggleShuffle, tryAutoplay,
  }
}

export const radio: RadioStore = createRadioStore(TRACKS)
