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

/** Throw an emote bubble over the player with the given wallet. Tries to play with sound; if the
 *  browser blocks unmuted autoplay (no user gesture yet — e.g. an incoming emote) it retries muted so
 *  the video always shows. The radio is only ducked while an audible emote is playing. */
export function throwEmote(wallet: string, videoUrl: string): void {
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
  v.src = videoUrl; v.loop = true; v.autoplay = true; v.playsInline = true
  v.setAttribute('playsinline', ''); v.muted = false
  v.setAttribute('data-ba-emote-bubble', wallet)
  const left = Math.min(r.right + 8, window.innerWidth - SIZE - 8)
  Object.assign(v.style, {
    position: 'fixed', left: `${left}px`, top: `${r.top + r.height / 2}px`,
    width: `${SIZE}px`, height: `${SIZE}px`, borderRadius: '50%', objectFit: 'cover',
    background: 'rgba(14,17,23,.92)', border: '2px solid rgba(255,255,255,.18)',
    boxShadow: '0 12px 30px -8px rgba(0,0,0,.85),0 0 26px -6px rgba(255,46,151,.45)',
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
