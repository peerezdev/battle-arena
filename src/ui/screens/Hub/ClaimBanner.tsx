import { useState } from 'react'
import { Link } from 'react-router-dom'
import { COLORS, FONTS } from '../../theme'
import { config } from '../../../onchain/config'

/**
 * Clave del descarte. NO se cambia a la ligera: cambiarla resucita el banner para todo el que ya
 * lo había cerrado, que es exactamente lo que este banner no debe hacer.
 */
export const CLAIM_BANNER_KEY = 'ba.claimBanner.dismissed'

/**
 * Aviso del airdrop de $CARDS, arriba del Lobby, con enlace a /claim.
 *
 * SE LE ENSEÑA A TODO EL MUNDO y no solo a quien tiene algo que reclamar, a propósito: saber si
 * una wallet es elegible cuesta una llamada al RPC, y ponerla en el Lobby la convertiría en una
 * llamada por CADA carga de la página. La pantalla de /claim ya sabe decirle a cada uno lo suyo,
 * así que el banner solo tiene que llevarle hasta ella.
 *
 * Y por eso mismo SE PUEDE DESCARTAR, al revés que RoyaleDemoNotice, que es permanente. La demo
 * de Royale le sirve a cualquiera que vuelva meses después; esto le sirve a una minoría y UNA
 * sola vez, así que sin una forma de cerrarlo sería ruido fijo para casi todos. El descarte se
 * recuerda en localStorage, igual que el plegado de ModeGuide.
 *
 * En devnet no se pinta: el airdrop solo existe en mainnet y el enlace no llevaría a nada útil.
 */
export function ClaimBanner() {
  const [oculto, setOculto] = useState<boolean>(() => {
    try { return localStorage.getItem(CLAIM_BANNER_KEY) === '1' } catch { return false }
  })

  if (config.isDevnet || oculto) return null

  const descartar = () => {
    setOculto(true)
    try { localStorage.setItem(CLAIM_BANNER_KEY, '1') } catch { /* almacenamiento bloqueado: se cierra solo por esta sesión */ }
  }

  return (
    <section style={{
      position: 'relative', overflow: 'hidden', borderRadius: 14,
      border: `1px solid rgba(0,255,196,.28)`,
      background: `radial-gradient(420px 140px at 8% 0%,rgba(0,255,196,.12),transparent 65%),linear-gradient(160deg,#07161a,#0b0d13)`,
      padding: '13px clamp(14px,1.8vw,20px)',
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 340px', minWidth: 0 }}>
        <h2 style={{
          margin: 0, fontFamily: FONTS.display, fontWeight: 800,
          fontSize: 16, letterSpacing: '-.01em', lineHeight: 1.2, color: COLORS.text,
        }}>
          The $CARDS airdrop is live
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.5, color: '#aab3bf' }}>
          If your wallet is on the list, you can claim it here. We cover the network fee.
        </p>
      </div>

      <Link
        to="/claim"
        style={{
          flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '10px 18px', borderRadius: 11, minHeight: 44, boxSizing: 'border-box',
          textDecoration: 'none',
          fontFamily: FONTS.display, fontSize: 14, fontWeight: 800, color: '#05221c',
          background: `linear-gradient(135deg,${COLORS.green},#00c39a)`,
          boxShadow: `0 10px 26px -12px ${COLORS.green}`,
        }}
      >
        Check my claim
      </Link>

      <button
        type="button"
        onClick={descartar}
        aria-label="Dismiss"
        style={{
          flex: 'none', width: 30, height: 30, borderRadius: 9, cursor: 'pointer',
          border: '1px solid rgba(255,255,255,.14)', background: 'transparent',
          color: COLORS.muted, fontSize: 13, lineHeight: 1,
        }}
      >
        ✕
      </button>
    </section>
  )
}
