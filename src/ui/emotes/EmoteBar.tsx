import { useState } from 'react'
import { COLORS, FONTS } from '../theme'
import { useEmotes } from './useEmotes'
import { throwEmote } from './throwEmote'
import type { Emote } from '../../onchain/emotesClient'

const MAX_SLOTS = 3

function VideoThumb({ url, size }: { url: string; size: number }) {
  return (
    <video src={url} muted loop autoPlay playsInline
      style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block', background: '#160f1d', pointerEvents: 'none' }} />
  )
}

/** Quick-access emote bar shown in a battle's action bar. `meWallet` is the wallet of the panel the
 *  thrown emote pops over (in the demo this is the simulated 'You'). Phase 1: local throw only. */
export function EmoteBar({ meWallet }: { meWallet: string }) {
  const { byCode, owned, slots, loading, updateSlots } = useEmotes()
  const [menuOpen, setMenuOpen] = useState(false)

  if (loading && !owned.length) return null

  const throwIt = (e: Emote | undefined) => { if (e) throwEmote(meWallet, e.video_url, { muted: false }) }
  const slotEmotes = slots.map((c) => byCode[c]).filter(Boolean) as Emote[]

  const toggleSlot = (code: string) => {
    if (slots.includes(code)) updateSlots(slots.filter((c) => c !== code))
    else if (slots.length < MAX_SLOTS) updateSlots([...slots, code])
    else updateSlots([...slots.slice(1), code])   // full → replace the oldest
  }

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, padding: '5px 11px 5px 14px', borderRadius: 14, background: 'rgba(255,255,255,.03)', border: `1px solid ${COLORS.border}` }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.14em', color: COLORS.muted }}>EMOTE</span>
      <div style={{ display: 'flex', gap: 9 }}>
        {slotEmotes.map((e) => (
          <button key={e.code} onClick={() => throwIt(e)} title={`Throw ${e.name}`}
            style={{ width: 50, height: 50, padding: 3, borderRadius: '50%', border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <VideoThumb url={e.video_url} size={42} />
          </button>
        ))}
        {/* expand: full owned collection + customize quick slots */}
        <button onClick={() => setMenuOpen((o) => !o)} title="All emotes"
          style={{ width: 50, height: 50, borderRadius: '50%', border: `1px solid ${menuOpen ? COLORS.green + '88' : COLORS.border}`, background: menuOpen ? 'rgba(0,255,196,.1)' : 'rgba(255,255,255,.04)', color: COLORS.text, cursor: 'pointer', fontSize: 22, fontWeight: 300, lineHeight: 1 }}>
          +
        </button>
      </div>

      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
          <div style={{ position: 'absolute', bottom: 'calc(100% + 10px)', left: 0, zIndex: 50, width: 'min(340px,86vw)', padding: 14, borderRadius: 16, background: 'rgba(14,17,23,.97)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', border: `1px solid ${COLORS.border}`, boxShadow: '0 24px 60px -20px #000' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <span style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 14 }}>Your emotes</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>★ = quick · {slots.length}/{MAX_SLOTS}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(72px,1fr))', gap: 10 }}>
              {owned.map((code) => {
                const e = byCode[code]
                if (!e) return null
                const pinned = slots.includes(code)
                return (
                  <div key={code} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                    <button onClick={() => { throwIt(e); setMenuOpen(false) }} title={`Throw ${e.name}`}
                      style={{ width: 60, height: 60, padding: 3, borderRadius: 14, border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', cursor: 'pointer', overflow: 'hidden' }}>
                      <video src={e.video_url} muted loop autoPlay playsInline style={{ width: '100%', height: '100%', borderRadius: 11, objectFit: 'cover', pointerEvents: 'none' }} />
                    </button>
                    <button onClick={() => toggleSlot(code)} title={pinned ? 'Remove from quick' : 'Pin to quick'}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 7, border: `1px solid ${pinned ? COLORS.green + '88' : COLORS.border}`, background: pinned ? 'rgba(0,255,196,.12)' : 'transparent', color: pinned ? COLORS.green : COLORS.muted, cursor: 'pointer', fontSize: 10, fontWeight: 700 }}>
                      {pinned ? '★' : '☆'}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
