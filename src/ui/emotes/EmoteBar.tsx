import { useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../theme'
import { useEmotes } from './useEmotes'
import { throwEmote } from './throwEmote'
import { throwEmoteToBattle, type Emote } from '../../onchain/emotesClient'
import { AlphaVideo } from '../components/AlphaVideo'

/** Anti-spam: how long the sender must wait between emotes. Tweak here to change the cooldown. */
export const EMOTE_COOLDOWN_MS = 4000

function VideoThumb({ emote, size }: { emote: Emote; size: number }) {
  return (
    <AlphaVideo webm={emote.video_url} mov={emote.video_mov}
      style={{ width: size, height: size, objectFit: 'contain', pointerEvents: 'none' }} />
  )
}

/** Quick-access emote bar shown in a battle's action bar. `meWallet` is the wallet of the panel the
 *  thrown emote pops over (in the demo this is the simulated 'You'). When `battleId` is a real battle
 *  the emote is also broadcast to the other players; in the demo it's local only. */
export function EmoteBar({ meWallet, battleId }: { meWallet: string; battleId?: string }) {
  const { byCode, owned, slots, loading } = useEmotes()
  const { identityToken } = useIdentityToken()
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  // Tick while on cooldown so the remaining-time hint counts down and the buttons re-enable on time.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t >= cooldownUntil) clearInterval(id)
    }, 200)
    return () => clearInterval(id)
  }, [cooldownUntil])

  const remainingMs = Math.max(0, cooldownUntil - now)
  const onCooldown = remainingMs > 0
  const remainingSec = Math.ceil(remainingMs / 1000)

  if (loading && !owned.length) return null

  const throwIt = (e: Emote | undefined) => {
    if (!e || onCooldown) return
    throwEmote(meWallet, e)   // local + audible (user gesture)
    if (battleId && battleId !== 'demo' && identityToken) {
      throwEmoteToBattle(identityToken, battleId, e.code).catch(() => { /* broadcast is best-effort */ })
    }
    setCooldownUntil(Date.now() + EMOTE_COOLDOWN_MS)
  }
  // Cuántos huecos hay lo decide el backend (`MAX_SLOTS` en app/services/emotes.py), que rellena
  // la lista hasta el tope con los emotes que el usuario tenga sin fijar. Aquí solo se pintan.
  const slotEmotes = slots.map((c) => byCode[c]).filter(Boolean) as Emote[]

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 11, padding: '5px 11px', borderRadius: 14, background: 'rgba(255,255,255,.03)', border: `1px solid ${COLORS.border}` }}>
      {/* Sin etiqueta "EMOTE": los dibujos ya dicen lo que son y el hueco es para un emote más.
          La cuenta atrás se queda, pero solo mientras corre: sin ella el botón apagado no
          explicaría por qué no responde.
          El botón "+" abría la colección entera y dejaba elegir qué emotes iban a la barra. Se
          retiró a petición; está en el historial (commit 565a1ea) para recuperarlo. Mientras no
          esté, los huecos los reparte el backend por orden de catálogo. */}
      {onCooldown && (
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.14em', color: COLORS.muted }}>WAIT {remainingSec}s</span>
      )}
      <div style={{ display: 'flex', gap: 9 }}>
        {slotEmotes.map((e) => (
          <button key={e.code} onClick={() => throwIt(e)} disabled={onCooldown}
            title={onCooldown ? `Cooldown · ${remainingSec}s` : `Throw ${e.name}`}
            style={{ width: 50, height: 50, padding: 3, borderRadius: '50%', border: `1px solid ${COLORS.border}`, background: 'rgba(255,255,255,.04)', cursor: onCooldown ? 'not-allowed' : 'pointer', opacity: onCooldown ? 0.4 : 1, transition: 'opacity .2s ease', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <VideoThumb emote={e} size={42} />
          </button>
        ))}
      </div>
    </div>
  )
}
