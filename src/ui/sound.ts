// Tiny Web Audio SFX helper — synthesized, no audio assets.
// Never throws / never blocks UI if AudioContext is unavailable.

export type SfxName = 'commit' | 'reveal' | 'win' | 'tick' | 'lose'

const MUTE_KEY = 'battlearena.muted'

let ctx: AudioContext | null = null
let muted = readMuted()

function readMuted(): boolean {
  try {
    // Default ON (sound enabled) but respectful — stored value wins.
    const v = localStorage.getItem(MUTE_KEY)
    return v === '1'
  } catch {
    return false
  }
}

export function isMuted(): boolean {
  return muted
}

export function setMuted(next: boolean): void {
  muted = next
  try {
    localStorage.setItem(MUTE_KEY, next ? '1' : '0')
  } catch {
    /* ignore storage failures */
  }
}

export function toggleMuted(): boolean {
  const next = !isMuted()
  setMuted(next)
  return next
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    // Resume if suspended (browsers gate audio on first user gesture).
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

interface Tone {
  freq: number
  dur: number
  type?: OscillatorType
  gain?: number
  /** seconds to delay this tone from the call moment */
  at?: number
  /** linear-ramp the freq to this value by the end of the tone */
  slideTo?: number
}

function blip(c: AudioContext, t: Tone): void {
  const now = c.currentTime + (t.at ?? 0)
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = t.type ?? 'sine'
  osc.frequency.setValueAtTime(t.freq, now)
  if (t.slideTo != null) osc.frequency.linearRampToValueAtTime(t.slideTo, now + t.dur)
  const peak = t.gain ?? 0.18
  g.gain.setValueAtTime(0.0001, now)
  g.gain.exponentialRampToValueAtTime(peak, now + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, now + t.dur)
  osc.connect(g)
  g.connect(c.destination)
  osc.start(now)
  osc.stop(now + t.dur + 0.02)
}

const RECIPES: Record<SfxName, Tone[]> = {
  // Light, short — energy token add
  tick: [{ freq: 880, dur: 0.06, type: 'triangle', gain: 0.12 }],
  // Locking-in / confirm — descending two-note thunk
  commit: [
    { freq: 520, dur: 0.1, type: 'square', gain: 0.16 },
    { freq: 320, dur: 0.16, type: 'square', gain: 0.16, at: 0.07, slideTo: 220 },
  ],
  // Per-front impact on reveal — bright zap
  reveal: [{ freq: 660, dur: 0.12, type: 'sawtooth', gain: 0.14, slideTo: 990 }],
  // Round/match win — ascending triad
  win: [
    { freq: 523, dur: 0.14, type: 'triangle', gain: 0.16 },
    { freq: 659, dur: 0.14, type: 'triangle', gain: 0.16, at: 0.1 },
    { freq: 784, dur: 0.26, type: 'triangle', gain: 0.18, at: 0.2 },
  ],
  // Loss / subdued — descending minor
  lose: [
    { freq: 392, dur: 0.18, type: 'sine', gain: 0.14 },
    { freq: 294, dur: 0.3, type: 'sine', gain: 0.14, at: 0.12, slideTo: 196 },
  ],
}

export function playSfx(name: SfxName): void {
  if (muted) return
  const c = getCtx()
  if (!c) return
  try {
    for (const tone of RECIPES[name]) blip(c, tone)
  } catch {
    /* never let audio break the UI */
  }
}

/** Guarded haptic feedback — no-op on unsupported devices. */
export function haptic(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern)
  } catch {
    /* ignore */
  }
}
