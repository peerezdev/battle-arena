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

/** Throw an emote bubble over the player with the given wallet. muted=true for incoming emotes that
 *  the browser would block from auto-playing audio (no prior user gesture). */
export function throwEmote(wallet: string, videoUrl: string, opts?: { muted?: boolean }): void {
  if (typeof document === 'undefined') return
  const anchor = [...document.querySelectorAll('[data-player-anchor]')]
    .find((a) => a.getAttribute('data-player-anchor') === wallet) as HTMLElement | undefined
  if (!anchor) return

  // at most one bubble per player — drop the previous one
  document.querySelectorAll('[data-ba-emote-bubble]').forEach((b) => {
    if (b.getAttribute('data-ba-emote-bubble') === wallet) b.remove()
  })

  const r = anchor.getBoundingClientRect()
  const muted = !!opts?.muted
  const v = document.createElement('video')
  v.src = videoUrl; v.loop = true; v.autoplay = true; v.playsInline = true
  v.setAttribute('playsinline', ''); v.muted = muted
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

  const ducked = !muted
  if (ducked) duckStart()
  v.play().catch(() => {})

  let cleaned = false
  const cleanup = () => { if (cleaned) return; cleaned = true; if (ducked) duckEnd() }
  setTimeout(() => { v.style.animation = 'ba-emote-out .4s ease forwards' }, OUT_AT)
  setTimeout(() => { v.remove(); cleanup() }, GONE_AT)
}
