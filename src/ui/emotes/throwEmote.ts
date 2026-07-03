// Pops a video emote bubble over a player's panel (anchored by [data-player-anchor="<wallet>"]).
// Imperative + appended to <body> so it's decoupled from the React tree and survives re-renders.
// Plays with sound and ducks the radio while any sounded emote is on screen.
import { radio } from '../radio/radioStore'

let _sounding = 0
let _radioWasPlaying = false

function duckStart(): void {
  if (_sounding === 0) {
    _radioWasPlaying = radio.getState().isPlaying
    if (_radioWasPlaying) radio.pause()
  }
  _sounding++
}
function duckEnd(): void {
  _sounding = Math.max(0, _sounding - 1)
  if (_sounding === 0 && _radioWasPlaying) { radio.play(); _radioWasPlaying = false }
}

const OUT_AT = 2700, GONE_AT = 3150, SIZE = 72
// How far the bubble dips into the top of the card, so it sits just above the name while staying
// visually attached to the box (rather than floating off to the side).
const OVERLAP = 16

/** Throw an emote bubble over the player with the given wallet. Tries to play with sound; if the
 *  browser blocks unmuted autoplay (no user gesture yet — e.g. an incoming emote) it retries muted so
 *  the video always shows. The radio is only ducked while an audible emote is playing. */
export function throwEmote(wallet: string, emote: { video_url: string; video_mov?: string }): void {
  if (typeof document === 'undefined') return
  const anchor = [...document.querySelectorAll('[data-player-anchor]')]
    .find((a) => a.getAttribute('data-player-anchor') === wallet) as HTMLElement | undefined
  if (!anchor) return

  // at most one bubble per player — drop the previous one
  document.querySelectorAll('[data-ba-emote-bubble]').forEach((b) => {
    if (b.getAttribute('data-ba-emote-bubble') === wallet) b.remove()
  })

  const r = anchor.getBoundingClientRect()
  const v = document.createElement('video')
  v.loop = true; v.autoplay = true; v.playsInline = true
  v.setAttribute('playsinline', ''); v.muted = false
  v.setAttribute('data-ba-emote-bubble', wallet)
  // Only WebKit (Safari/iOS) renders HEVC alpha; Chromium decodes HEVC but drops it (→ opaque),
  // so give the .mov to WebKit only and the VP9+alpha WebM to everyone else.
  const addSource = (src: string, type: string) => {
    const s = document.createElement('source'); s.src = src; s.type = type; v.appendChild(s)
  }
  const isWebKit = /apple/i.test(navigator.vendor || '')
  if (isWebKit && emote.video_mov) addSource(emote.video_mov, 'video/quicktime')
  addSource(emote.video_url, 'video/webm')
  // Centered over the card, popping just above the player's name (the bubble's vertical center — the
  // style uses translateY(-50%) — lands a touch above the card's top edge so it overlaps the box).
  const left = Math.max(8, Math.min(r.left + r.width / 2 - SIZE / 2, window.innerWidth - SIZE - 8))
  const top = Math.max(SIZE / 2 + 8, r.top - SIZE / 2 + OVERLAP)
  Object.assign(v.style, {
    position: 'fixed', left: `${left}px`, top: `${top}px`,
    width: `${SIZE}px`, height: `${SIZE}px`, objectFit: 'contain',
    background: 'transparent',
    // drop-shadow follows the alpha silhouette (box-shadow would frame the square)
    filter: 'drop-shadow(0 8px 14px rgba(0,0,0,.55))',
    pointerEvents: 'none', zIndex: '9999', transform: 'translateY(-50%) scale(1)',
    animation: 'ba-emote-in .42s cubic-bezier(.2,.9,.25,1.25) forwards',
  })
  document.body.appendChild(v)

  let ducked = false
  let removed = false
  v.play().then(() => {
    if (!removed) { ducked = true; duckStart() }   // played with sound → duck the radio
  }).catch(() => {
    v.muted = true; v.play().catch(() => {})        // blocked → play muted (video only)
  })

  setTimeout(() => { v.style.animation = 'ba-emote-out .4s ease forwards' }, OUT_AT)
  setTimeout(() => { removed = true; v.remove(); if (ducked) duckEnd() }, GONE_AT)
}
