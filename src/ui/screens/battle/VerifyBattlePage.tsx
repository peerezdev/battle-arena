import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { COLORS, FONTS, RARITY, formatUsd } from '../../theme'
import { config } from '../../../onchain/config'
import { getBattle, type Battle, type BattlePullInfo } from '../../../onchain/packBattleClient'
import { useAliases } from '../../useAliases'
import { battleHref } from '../../battle/battleHref'
import { solscanTxUrl, ccVrfUrl } from './verifyLinks'
import { replayHref } from '../../../onchain/gachaClient'

/**
 * Página de verificación de una batalla: una fila por tirada, con sus dos enlaces.
 *
 * Es una página y no un modal a propósito. Verificar no es un vistazo: se abren pestañas, se copian
 * memos, se compara. Todo eso pide una URL que se pueda guardar y mandarle a alguien — que es el
 * uso real, enseñarle a otro que la tirada fue tuya.
 *
 * Lo que hay que entender para leerla, y por eso está escrito en la propia página: el VRF de
 * Collector Crypt dice QUÉ salió, pero atribuye la tirada a la wallet de la partida, no a la del
 * jugador. Quién la pagó lo dice la transacción de compra. El memo es lo que une las dos.
 */

const corta = (w: string) => (w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w)
const colorDe = (r: string | null): string =>
  (RARITY as Record<string, string | undefined>)[(r ?? '').toLowerCase()] ?? COLORS.muted

function Enlace({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      style={{
        fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.06em', textDecoration: 'none',
        color: COLORS.green, border: `1px solid ${COLORS.green}44`, borderRadius: 8,
        padding: '5px 10px', background: `${COLORS.green}10`, whiteSpace: 'nowrap',
      }}>
      {children} ↗
    </a>
  )
}

/** Un valor largo que hay que poder copiar entero: el memo, la firma. */
function Copiable({ label, value }: { label: string; value: string }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.1em', color: COLORS.muted }}>
        {label}
      </div>
      <button
        type="button"
        onClick={() => {
          // Sin clipboard (contexto no seguro, navegador viejo) el valor sigue a la vista y se
          // puede seleccionar a mano: se pierde la comodidad, no la información.
          navigator.clipboard?.writeText(value).then(() => {
            setCopiado(true)
            setTimeout(() => setCopiado(false), 1200)
          }).catch(() => { /* que lo copie a mano */ })
        }}
        title="Copy"
        style={{
          display: 'block', textAlign: 'left', width: '100%', cursor: 'pointer',
          fontFamily: FONTS.mono, fontSize: 11, color: COLORS.text, wordBreak: 'break-all',
          background: 'transparent', border: 0, padding: 0,
        }}>
        {value} <span style={{ color: COLORS.muted }}>{copiado ? '· copied' : '· copy'}</span>
      </button>
    </div>
  )
}

function Tirada({ p, alias }: { p: BattlePullInfo; alias: string }) {
  const solscan = solscanTxUrl(p.tx_signature, config.isDevnet)
  const vrf = ccVrfUrl(p.memo, config.isDevnet)
  return (
    <div style={{
      border: `1px solid ${COLORS.border}`, borderRadius: 14,
      background: '#0c0f15', padding: 16,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.14em', color: COLORS.muted }}>
          ROUND {p.round_number}
        </span>
        <span style={{ fontFamily: FONTS.body, fontSize: 13, fontWeight: 700, color: COLORS.text }}>
          {alias}
        </span>
        {p.name && (
          <span style={{ fontFamily: FONTS.body, fontSize: 13, color: colorDe(p.rarity) }}>
            {p.name}
          </span>
        )}
        {p.insured_value != null && (
          <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.text }}>
            {formatUsd(p.insured_value)}
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {vrf && <Enlace href={vrf}>Collector Crypt VRF</Enlace>}
        {solscan && <Enlace href={solscan}>Purchase transaction</Enlace>}
        {!solscan && (
          // Se dice por qué falta en vez de esconderlo: la transacción existe en la cadena, lo que
          // no tenemos es su firma guardada. Callarlo parecería que la tirada no es comprobable.
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted, alignSelf: 'center' }}>
            transaction not recorded for this pull
          </span>
        )}
      </div>

      {/* El enlace de replay vive aquí porque es donde ya está el memo. Vuelve a reproducir la
          animación de esa tirada, sin cuenta: es lo que hace falta para enseñarla en un vídeo. */}
      {p.memo && <Copiable label="REPLAY LINK" value={replayHref(p.memo)} />}
      {p.memo && <Copiable label="MEMO" value={p.memo} />}
      {p.tx_signature && <Copiable label="SIGNATURE" value={p.tx_signature} />}
    </div>
  )
}

export function VerifyBattlePage() {
  const { battleId = '' } = useParams()
  const [battle, setBattle] = useState<Battle | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelado = false
    getBattle(battleId)
      .then((b) => { if (!cancelado) setBattle(b) })
      .catch(() => { if (!cancelado) setError(true) })
    return () => { cancelado = true }
  }, [battleId])

  const pulls = useMemo(() => battle?.pulls ?? [], [battle])
  const wallets = useMemo(() => [...new Set(pulls.map((p) => p.player_wallet))], [pulls])
  const alias = useAliases(wallets)

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '24px 16px 60px' }}>
      <h1 style={{
        margin: 0, fontFamily: FONTS.display, fontSize: 'clamp(22px,3vw,30px)', fontWeight: 800,
        letterSpacing: '-.02em', color: COLORS.text,
      }}>
        Verify this battle
      </h1>

      <p style={{ fontFamily: FONTS.body, fontSize: 13, lineHeight: 1.6, color: COLORS.muted, marginTop: 10 }}>
        Every pack opened in a battle leaves two public records. The <b>Collector Crypt VRF</b> shows
        what the pack contained and that the draw was fair. The <b>purchase transaction</b> shows who
        paid for it — your own wallet signed it, and the memo below travels inside that same
        transaction.
      </p>
      <p style={{ fontFamily: FONTS.body, fontSize: 13, lineHeight: 1.6, color: COLORS.muted, marginTop: 10 }}>
        You need both. Collector Crypt credits a battle pull to the wallet that holds the game's
        cards, not to yours — so the VRF alone shows the pull but not the buyer. The transaction is
        what ties it to you, and it can be checked without trusting us.
      </p>

      {error && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.red, marginTop: 20 }}>
          Could not load this battle
        </div>
      )}
      {!error && !battle && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted, marginTop: 20 }}>Loading…</div>
      )}
      {battle && pulls.length === 0 && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted, marginTop: 20 }}>
          No pulls to verify yet — they appear once the battle ends.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
        {pulls.map((p, i) => (
          <Tirada key={`${p.memo ?? p.nft_address ?? i}`} p={p}
            alias={alias[p.player_wallet] || corta(p.player_wallet)} />
        ))}
      </div>

      <Link to={battleHref(battleId, { view: 'result' })}
        style={{
          display: 'inline-block', marginTop: 26, padding: '11px 22px', borderRadius: 12,
          border: `1px solid ${COLORS.border}`, color: '#aab3bf', textDecoration: 'none',
          fontFamily: FONTS.body, fontSize: 14, fontWeight: 700,
        }}>
        Back to the result
      </Link>
    </div>
  )
}
