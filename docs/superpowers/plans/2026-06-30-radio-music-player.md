# Radio / Music Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global "radio" — a list of tracks that play consecutively (infinite loop) with manual controls and track selection, mounted in the topbar so playback survives route changes.

**Architecture:** A singleton pub-sub store (`createRadioStore`) owns a single lazily-created `HTMLAudioElement` and all playback state; React components subscribe via a `useRadio()` hook built on `useSyncExternalStore`. A `RadioPlayer` component renders the compact topbar controls plus a dropdown/sheet playlist panel, and is mounted once in `AppShell` above the router `<Outlet/>`. No new dependencies.

**Tech Stack:** React 19, TypeScript, Vite, Framer Motion (already used), Vitest + @testing-library/react (jsdom). Repo code style: **no semicolons, single quotes, 2-space indent.**

## Global Constraints

- Source of tracks: **external URLs / CDN** (each track has a `url` string). No local audio files.
- Radio audio is **independent** of the SFX mute (`src/ui/sound.ts` / `MuteButton`). It has its own play/pause and volume.
- Playback order: **sequential + infinite loop**, plus a **shuffle** toggle.
- Autoplay: attempt `audio.play()` on the `RadioPlayer` mount; if the browser blocks it, **arm** a one-time global gesture listener (`pointerdown`/`keydown`/`touchstart`) that starts playback on the first user interaction.
- Defensive style like `src/ui/sound.ts`: never throw, wrap audio/storage access in try/catch.
- localStorage keys: `battlearena.radio.index`, `battlearena.radio.volume`, `battlearena.radio.shuffle`.
- Default volume: `0.6`.
- Tests import `{ describe, it, expect, vi, beforeEach }` from `'vitest'` explicitly (even though `globals: true`).
- Run all tests with `npm test` (`vitest run`). Type/build check with `npm run build`.

---

### Task 1: Track list (`tracks.ts`)

Defines the `Track` type and the editable list of songs (placeholder external URLs to be swapped for real CDN URLs later).

**Files:**
- Create: `src/ui/radio/tracks.ts`
- Test: `src/ui/radio/tracks.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Track = { id: string; title: string; artist: string; url: string }`
  - `const TRACKS: Track[]`

- [ ] **Step 1: Write the failing test**

Create `src/ui/radio/tracks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { TRACKS } from './tracks'

describe('TRACKS', () => {
  it('every track has id/title/artist/url', () => {
    expect(TRACKS.length).toBeGreaterThan(0)
    for (const t of TRACKS) {
      expect(typeof t.id).toBe('string')
      expect(t.id.length).toBeGreaterThan(0)
      expect(typeof t.title).toBe('string')
      expect(typeof t.artist).toBe('string')
      expect(typeof t.url).toBe('string')
      expect(t.url.length).toBeGreaterThan(0)
    }
  })

  it('track ids are unique', () => {
    const ids = TRACKS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/radio/tracks.test.ts`
Expected: FAIL — cannot resolve `./tracks`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/radio/tracks.ts`:

```ts
// Radio track list. URLs are external (CDN). Swap these placeholders for the
// real song URLs — no other file needs to change.
export type Track = {
  id: string
  title: string
  artist: string
  url: string
}

export const TRACKS: Track[] = [
  { id: 'neon-drive', title: 'Neon Drive', artist: 'TBD', url: 'https://cdn.example.com/neon-drive.mp3' },
  { id: 'cyber-run', title: 'Cyber Run', artist: 'TBD', url: 'https://cdn.example.com/cyber-run.mp3' },
  { id: 'synth-city', title: 'Synth City', artist: 'TBD', url: 'https://cdn.example.com/synth-city.mp3' },
]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ui/radio/tracks.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/radio/tracks.ts src/ui/radio/tracks.test.ts
git commit -m "feat(radio): track list type and placeholder data"
```

---

### Task 2: Radio store core (`radioStore.ts`)

The pub-sub store: a `createRadioStore(tracks, makeAudio)` factory plus a `radio` singleton. Lazily owns one audio element, handles play/pause/toggle, sequential next/prev with wrap-around, select, volume, persistence, and the `ended`/`error` audio events. **Shuffle and autoplay are added in Tasks 3 and 4.**

**Files:**
- Create: `src/ui/radio/radioStore.ts`
- Test: `src/ui/radio/radioStore.test.ts`

**Interfaces:**
- Consumes: `Track`, `TRACKS` from `./tracks` (Task 1).
- Produces:
  - `type RadioState = { index: number; isPlaying: boolean; volume: number; shuffle: boolean; currentTime: number; duration: number }`
  - `function createRadioStore(tracks: Track[], makeAudio?: () => HTMLAudioElement): RadioStore`
  - `const radio: RadioStore` (singleton over `TRACKS`)
  - `RadioStore` shape: `{ getState(): RadioState; getTracks(): Track[]; subscribe(cb: () => void): () => void; play(): void; pause(): void; toggle(): void; next(): void; prev(): void; select(i: number): void; setVolume(v: number): void; toggleShuffle(): void; tryAutoplay(): void }`
  - Note: `toggleShuffle` and `tryAutoplay` are present in the type from this task but implemented fully in Tasks 3 and 4. This task ships a no-op-safe `toggleShuffle` (flips the flag + persists) and a sequential-only `next`/`prev`; Task 4 adds `tryAutoplay` behavior.

- [ ] **Step 1: Write the failing tests**

Create `src/ui/radio/radioStore.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/ui/radio/radioStore.test.ts`
Expected: FAIL — cannot resolve `./radioStore`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/radio/radioStore.ts`:

```ts
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

  function pickNext(): number { return (internal.index + 1) % tracks.length }
  function pickPrev(): number { return (internal.index - 1 + tracks.length) % tracks.length }

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

  // Implemented in Task 4.
  function tryAutoplay(): void { /* see Task 4 */ }

  return {
    getState: () => snapshot,
    getTracks: () => tracks,
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb) } },
    play, pause, toggle, next, prev, select, setVolume, toggleShuffle, tryAutoplay,
  }
}

export const radio: RadioStore = createRadioStore(TRACKS)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/ui/radio/radioStore.test.ts`
Expected: PASS (all core tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/radio/radioStore.ts src/ui/radio/radioStore.test.ts
git commit -m "feat(radio): pub-sub store with playback, sequential order, persistence"
```

---

### Task 3: Shuffle order

Make `next()`/`prev()` pick a random different track when `shuffle` is on. Modifies the store from Task 2.

**Files:**
- Modify: `src/ui/radio/radioStore.ts`
- Modify (add tests): `src/ui/radio/radioStore.test.ts`

**Interfaces:**
- Consumes: the `createRadioStore` internals from Task 2.
- Produces: no signature changes — `next`/`prev` honor `internal.shuffle`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/radio/radioStore.test.ts` (inside the existing file, after the `describe('radioStore core', ...)` block):

```ts
describe('radioStore shuffle', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* ignore */ } })

  it('toggleShuffle flips and persists', () => {
    const fake = new FakeAudio()
    const store = createRadioStore(TRACKS, () => fake as unknown as HTMLAudioElement)
    store.toggleShuffle()
    expect(store.getState().shuffle).toBe(true)
    expect(localStorage.getItem('battlearena.radio.shuffle')).toBe('1')
    store.toggleShuffle()
    expect(store.getState().shuffle).toBe(false)
  })

  it('next() with shuffle jumps to a non-sequential index', () => {
    const fake = new FakeAudio()
    const store = createRadioStore(TRACKS, () => fake as unknown as HTMLAudioElement)
    store.toggleShuffle()
    // 3 tracks at index 0: sequential next would be 1. randomOther with
    // Math.random()=0.99 -> floor(0.99*2)=1 -> 1>=0 -> index 2. So shuffle MUST
    // give 2, which the sequential implementation never would here.
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.99)
    store.next()
    expect(store.getState().index).toBe(2)
    rnd.mockRestore()
  })

  it('prev() with shuffle jumps to a non-sequential index', () => {
    const fake = new FakeAudio()
    const store = createRadioStore(TRACKS, () => fake as unknown as HTMLAudioElement)
    store.toggleShuffle()
    // 3 tracks at index 0: sequential prev would be 2. randomOther with
    // Math.random()=0 -> floor(0)=0 -> 0>=0 -> index 1. So shuffle MUST give 1.
    const rnd = vi.spyOn(Math, 'random').mockReturnValue(0)
    store.prev()
    expect(store.getState().index).toBe(1)
    rnd.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npm test -- src/ui/radio/radioStore.test.ts`
Expected: the `toggleShuffle flips` test passes (already implemented in Task 2), and the two shuffle `next()`/`prev()` tests FAIL — the sequential implementation gives `next→1` (expected 2) and `prev→2` (expected 1).

- [ ] **Step 3: Write the implementation**

In `src/ui/radio/radioStore.ts`, replace the two picker functions:

```ts
  function pickNext(): number { return (internal.index + 1) % tracks.length }
  function pickPrev(): number { return (internal.index - 1 + tracks.length) % tracks.length }
```

with:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/ui/radio/radioStore.test.ts`
Expected: PASS (core + shuffle blocks).

- [ ] **Step 5: Commit**

```bash
git add src/ui/radio/radioStore.ts src/ui/radio/radioStore.test.ts
git commit -m "feat(radio): shuffle order for next/prev"
```

---

### Task 4: Autoplay with gesture fallback

Implement `tryAutoplay()`: arm one-time global gesture listeners, attempt `audio.play()`, and on success disarm. Modifies the store.

**Files:**
- Modify: `src/ui/radio/radioStore.ts`
- Modify (add tests): `src/ui/radio/radioStore.test.ts`

**Interfaces:**
- Consumes: `play()`, `ensureAudio()`, `internal` from Task 2.
- Produces: working `tryAutoplay(): void`.

- [ ] **Step 1: Write the failing tests**

Append to `src/ui/radio/radioStore.test.ts`:

```ts
describe('radioStore autoplay', () => {
  beforeEach(() => { try { localStorage.clear() } catch { /* ignore */ } })

  it('starts playing on the first pointerdown when autoplay is blocked', () => {
    // Fake whose play() rejects, simulating the browser autoplay policy.
    class BlockedAudio extends FakeAudio {
      play() { return Promise.reject(new Error('blocked')) as unknown as Promise<void> }
    }
    const fake = new BlockedAudio()
    const store = createRadioStore(TRACKS, () => fake as unknown as HTMLAudioElement)
    store.tryAutoplay()
    // Blocked: not playing yet.
    expect(store.getState().isPlaying).toBe(false)
    // First user gesture anywhere starts it (play() now succeeds via the base behavior).
    fake.play = FakeAudio.prototype.play.bind(fake)
    document.dispatchEvent(new Event('pointerdown'))
    expect(store.getState().isPlaying).toBe(true)
    expect(fake.paused).toBe(false)
  })

  it('removes the gesture listener after it fires once', () => {
    class BlockedAudio extends FakeAudio {
      play() { return Promise.reject(new Error('blocked')) as unknown as Promise<void> }
    }
    const fake = new BlockedAudio()
    const store = createRadioStore(TRACKS, () => fake as unknown as HTMLAudioElement)
    store.tryAutoplay()
    fake.play = FakeAudio.prototype.play.bind(fake)
    document.dispatchEvent(new Event('pointerdown'))
    store.pause()
    expect(store.getState().isPlaying).toBe(false)
    // A second gesture must NOT restart playback (listener already removed).
    document.dispatchEvent(new Event('pointerdown'))
    expect(store.getState().isPlaying).toBe(false)
  })

  it('does nothing when already playing', () => {
    const fake = new FakeAudio()
    const store = createRadioStore(TRACKS, () => fake as unknown as HTMLAudioElement)
    store.play()
    fake.paused = false
    store.tryAutoplay()
    // No gesture listener armed: a pointerdown changes nothing about isPlaying.
    expect(store.getState().isPlaying).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/ui/radio/radioStore.test.ts`
Expected: the two "blocked autoplay" tests FAIL — `tryAutoplay` is currently a no-op, so the pointerdown never starts playback.

- [ ] **Step 3: Write the implementation**

In `src/ui/radio/radioStore.ts`, add gesture-listener state and replace the placeholder `tryAutoplay`.

Add these near the top of `createRadioStore` (after `let audio: HTMLAudioElement | null = null`):

```ts
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
```

Then replace:

```ts
  // Implemented in Task 4.
  function tryAutoplay(): void { /* see Task 4 */ }
```

with:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/ui/radio/radioStore.test.ts`
Expected: PASS (core + shuffle + autoplay blocks).

- [ ] **Step 5: Commit**

```bash
git add src/ui/radio/radioStore.ts src/ui/radio/radioStore.test.ts
git commit -m "feat(radio): autoplay attempt with first-gesture fallback"
```

---

### Task 5: `useRadio` hook

React binding over the singleton store using `useSyncExternalStore`.

**Files:**
- Create: `src/ui/radio/useRadio.ts`
- Test: `src/ui/radio/useRadio.test.ts`

**Interfaces:**
- Consumes: `radio` singleton + `RadioState` from `./radioStore`, `Track` from `./tracks`.
- Produces:
  - `function useRadio(): RadioState & { tracks: Track[]; track: Track | null; play(): void; pause(): void; toggle(): void; next(): void; prev(): void; select(i: number): void; setVolume(v: number): void; toggleShuffle(): void; tryAutoplay(): void }`

- [ ] **Step 1: Write the failing test**

Create `src/ui/radio/useRadio.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRadio } from './useRadio'
import { radio } from './radioStore'

describe('useRadio', () => {
  it('exposes the current track and tracks list', () => {
    const { result } = renderHook(() => useRadio())
    expect(result.current.tracks.length).toBeGreaterThan(0)
    expect(result.current.track).toBe(result.current.tracks[result.current.index])
  })

  it('re-renders when the store changes', () => {
    const { result } = renderHook(() => useRadio())
    const before = result.current.shuffle
    act(() => { radio.toggleShuffle() })
    expect(result.current.shuffle).toBe(!before)
    // restore
    act(() => { radio.toggleShuffle() })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/radio/useRadio.test.ts`
Expected: FAIL — cannot resolve `./useRadio`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/radio/useRadio.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ui/radio/useRadio.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/radio/useRadio.ts src/ui/radio/useRadio.test.ts
git commit -m "feat(radio): useRadio hook over useSyncExternalStore"
```

---

### Task 6: `RadioPlayer` component

The compact topbar control (prev / play-pause / next + title) plus a dropdown (wide) / bottom-sheet (narrow) playlist panel with volume + shuffle. Triggers `tryAutoplay()` once on mount.

**Files:**
- Create: `src/ui/components/RadioPlayer.tsx`
- Test: `src/ui/components/RadioPlayer.test.tsx`

**Interfaces:**
- Consumes: `useRadio` from `../radio/useRadio`; `useIsWide` from `../useIsWide`; `COLORS`, `FONTS` from `../theme`; `AnimatePresence`, `motion` from `framer-motion`.
- Produces: `function RadioPlayer(): JSX.Element | null` (returns `null` when there are no tracks).
- Accessibility contract (relied on by the test): buttons expose `aria-label` `Anterior`, `Reproducir`/`Pausar`, `Siguiente`, `Lista de canciones`, `Mezclar`; the volume input has `aria-label` `Volumen`; each playlist entry is a button whose accessible name contains the track title.

- [ ] **Step 1: Write the failing test**

Create `src/ui/components/RadioPlayer.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const { actions, state } = vi.hoisted(() => ({
  actions: {
    play: vi.fn(), pause: vi.fn(), toggle: vi.fn(), next: vi.fn(), prev: vi.fn(),
    select: vi.fn(), setVolume: vi.fn(), toggleShuffle: vi.fn(), tryAutoplay: vi.fn(),
  },
  state: { isPlaying: false },
}))

vi.mock('../useIsWide', () => ({ useIsWide: () => true }))
vi.mock('../radio/useRadio', () => ({
  useRadio: () => ({
    index: 0,
    isPlaying: state.isPlaying,
    volume: 0.6,
    shuffle: false,
    currentTime: 0,
    duration: 0,
    tracks: [
      { id: 'a', title: 'Track A', artist: 'x', url: 'ua' },
      { id: 'b', title: 'Track B', artist: 'y', url: 'ub' },
    ],
    track: { id: 'a', title: 'Track A', artist: 'x', url: 'ua' },
    ...actions,
  }),
}))

import { RadioPlayer } from './RadioPlayer'

describe('RadioPlayer', () => {
  beforeEach(() => {
    Object.values(actions).forEach((fn) => fn.mockClear())
    state.isPlaying = false
  })

  it('calls tryAutoplay once on mount', () => {
    render(<RadioPlayer />)
    expect(actions.tryAutoplay).toHaveBeenCalledTimes(1)
  })

  it('shows the current track title', () => {
    render(<RadioPlayer />)
    expect(screen.getByText('Track A')).toBeTruthy()
  })

  it('prev / play-pause / next call the store', () => {
    render(<RadioPlayer />)
    fireEvent.click(screen.getByLabelText('Anterior'))
    expect(actions.prev).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Reproducir'))
    expect(actions.toggle).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Siguiente'))
    expect(actions.next).toHaveBeenCalled()
  })

  it('opens the panel and selecting a track plays it', () => {
    render(<RadioPlayer />)
    fireEvent.click(screen.getByLabelText('Lista de canciones'))
    const entry = screen.getByRole('button', { name: /Track B/ })
    fireEvent.click(entry)
    expect(actions.select).toHaveBeenCalledWith(1)
  })

  it('volume slider calls setVolume', () => {
    render(<RadioPlayer />)
    fireEvent.click(screen.getByLabelText('Lista de canciones'))
    fireEvent.change(screen.getByLabelText('Volumen'), { target: { value: '0.2' } })
    expect(actions.setVolume).toHaveBeenCalledWith(0.2)
  })

  it('shuffle toggle calls toggleShuffle', () => {
    render(<RadioPlayer />)
    fireEvent.click(screen.getByLabelText('Lista de canciones'))
    fireEvent.click(screen.getByLabelText('Mezclar'))
    expect(actions.toggleShuffle).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/ui/components/RadioPlayer.test.tsx`
Expected: FAIL — cannot resolve `./RadioPlayer`.

- [ ] **Step 3: Write the implementation**

Create `src/ui/components/RadioPlayer.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useRadio } from '../radio/useRadio'
import { useIsWide } from '../useIsWide'
import { COLORS, FONTS } from '../theme'

const iconBtn: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 8,
  background: 'transparent',
  border: 'none',
  color: COLORS.text,
  cursor: 'pointer',
  padding: 0,
}

export function RadioPlayer() {
  const radio = useRadio()
  const wide = useIsWide('(min-width: 760px)')
  const [open, setOpen] = useState(false)

  // Attempt autoplay once; the store falls back to the first user gesture.
  useEffect(() => { radio.tryAutoplay() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (radio.tracks.length === 0) return null

  const title = radio.track?.title ?? '—'

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
      <button type="button" aria-label="Anterior" onClick={radio.prev} style={iconBtn}>⏮</button>
      <button
        type="button"
        aria-label={radio.isPlaying ? 'Pausar' : 'Reproducir'}
        onClick={radio.toggle}
        style={{ ...iconBtn, color: radio.isPlaying ? COLORS.green : COLORS.text }}
      >
        {radio.isPlaying ? '⏸' : '▶'}
      </button>
      <button type="button" aria-label="Siguiente" onClick={radio.next} style={iconBtn}>⏭</button>

      <button
        type="button"
        aria-label="Lista de canciones"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          maxWidth: wide ? 160 : 90,
          minWidth: 0,
          background: 'transparent',
          border: 'none',
          color: COLORS.muted,
          cursor: 'pointer',
          fontFamily: FONTS.body,
          fontSize: 12,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ fontSize: 9 }}>▾</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 130 }} />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
              style={
                wide
                  ? {
                      position: 'absolute',
                      top: 'calc(100% + 10px)',
                      right: 0,
                      width: 260,
                      zIndex: 140,
                      background: COLORS.panel,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 12,
                      padding: 8,
                      boxShadow: '0 8px 24px #00000055',
                    }
                  : {
                      position: 'fixed',
                      left: 0,
                      right: 0,
                      bottom: 60, // above the mobile bottom-nav
                      zIndex: 140,
                      background: COLORS.panel,
                      borderTop: `1px solid ${COLORS.border}`,
                      borderRadius: '14px 14px 0 0',
                      padding: 12,
                      boxShadow: '0 -8px 24px #00000066',
                    }
              }
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 240, overflowY: 'auto' }}>
                {radio.tracks.map((t, i) => {
                  const isCurrent = i === radio.index
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { radio.select(i); setOpen(false) }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        textAlign: 'left',
                        background: isCurrent ? COLORS.panel2 : 'transparent',
                        border: 'none',
                        borderRadius: 8,
                        padding: '8px 10px',
                        cursor: 'pointer',
                        color: isCurrent ? COLORS.green : COLORS.text,
                        fontFamily: FONTS.body,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ width: 12, fontSize: 10 }}>{isCurrent && radio.isPlaying ? '▸' : ''}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.title}
                        <span style={{ color: COLORS.muted }}> · {t.artist}</span>
                      </span>
                    </button>
                  )
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 10, borderTop: `1px solid ${COLORS.border}` }}>
                <button
                  type="button"
                  aria-label="Mezclar"
                  aria-pressed={radio.shuffle}
                  onClick={radio.toggleShuffle}
                  style={{ ...iconBtn, width: 32, color: radio.shuffle ? COLORS.green : COLORS.muted }}
                >
                  🔀
                </button>
                <input
                  type="range"
                  aria-label="Volumen"
                  min={0}
                  max={1}
                  step={0.01}
                  value={radio.volume}
                  onChange={(e) => radio.setVolume(Number(e.target.value))}
                  style={{ flex: 1 }}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/ui/components/RadioPlayer.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/RadioPlayer.tsx src/ui/components/RadioPlayer.test.tsx
git commit -m "feat(radio): RadioPlayer topbar control + playlist panel"
```

---

### Task 7: Mount in `AppShell`

Render a single `<RadioPlayer/>` in the topbar (left of the balance pills, clear of the fixed `MuteButton`). Because `AppShell` wraps the router `<Outlet/>`, playback persists across navigation.

**Files:**
- Modify: `src/ui/layouts/AppShell.tsx` (add import + one element in the `<header>`)

**Interfaces:**
- Consumes: `RadioPlayer` from `../components/RadioPlayer`.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Add the import**

In `src/ui/layouts/AppShell.tsx`, add after the existing `AuthButtons` import (line 10):

```tsx
import { RadioPlayer } from '../components/RadioPlayer'
```

- [ ] **Step 2: Render it in the topbar**

In `src/ui/layouts/AppShell.tsx`, find the spacer div inside `<header>`:

```tsx
          {/* Spacer */}
          <div style={{ flex: 1 }} />
```

Replace it with the spacer + the radio player (so the order becomes: brand · spacer · radio · balance · deposit · auth):

```tsx
          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Radio — global player, lives above the router so audio survives navigation */}
          <RadioPlayer />
```

- [ ] **Step 3: Type-check / build**

Run: `npm run build`
Expected: `tsc -b` and `vite build` succeed with no type errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: all suites pass (including the new radio tests).

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open the app, and confirm:
- The radio controls appear in the topbar on desktop and mobile.
- After the first click anywhere, music starts (placeholder URLs will 404 — the player should skip forward without crashing; check the console for the `[radio] track failed to load` warning, which confirms the error path works).
- Navigating between routes does not reset/restart the player.
- The playlist panel opens, lists tracks, and selecting one switches tracks.
- Volume and shuffle controls work.

> Note: real playback requires real `url`s in `src/ui/radio/tracks.ts`. With the placeholders, only the skip-on-error path is observable. Swap in real CDN URLs to hear audio.

- [ ] **Step 6: Commit**

```bash
git add src/ui/layouts/AppShell.tsx
git commit -m "feat(radio): mount RadioPlayer in the global topbar"
```

---

## Notes / Known limitations

- **All-tracks-fail loop:** if every URL errors, `skipOnError → next` will cycle through the list. This is event-driven (one cycle per failed load attempt), not a tight CPU loop, and is acceptable for the MVP. Revisit if it becomes a problem (e.g., stop after N consecutive errors).
- **No visualizer:** out of scope (would require CORS headers on the CDN + `AnalyserNode`).
- **Single tab:** playback state is per-tab; multiple open tabs each have their own player. Acceptable for MVP.

## Self-Review

- **Spec coverage:** external URLs (Task 1) ✓; mini-player in topbar + selection panel (Tasks 6–7) ✓; persistence above routes (Task 7 mount) ✓; autoplay → gesture fallback (Task 4) ✓; independent volume vs SFX mute (store has own volume, never touches `sound.ts`) ✓; sequential + loop (Task 2) ✓; shuffle (Task 3) ✓; localStorage persistence of index/volume/shuffle (Task 2) ✓; error handling / never-throw (Task 2 `skipOnError`, try/catch) ✓; responsive dropdown vs sheet (Task 6 `useIsWide`) ✓; testing (every task) ✓.
- **Placeholder scan:** the only "TBD" is the `artist` field of placeholder tracks and the placeholder CDN URLs — intentional data placeholders for the user to fill, not plan gaps. No `TODO`/"implement later" in code steps.
- **Type consistency:** `RadioState`, `RadioStore`, `Track`, and the method names (`play/pause/toggle/next/prev/select/setVolume/toggleShuffle/tryAutoplay`, `getState/getTracks/subscribe`) are used identically across Tasks 2–6. The `useRadio` return adds `tracks`/`track` consumed by `RadioPlayer` in Task 6. ✓
