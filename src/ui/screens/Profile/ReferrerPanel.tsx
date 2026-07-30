import { useCallback, useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { showToast } from '../../toastBus'
import { claimReferrerEarnings, fetchReferrerSummary, type ReferrerSummary } from '../../../onchain/referrerClient'

/**
 * Rev-share del referidor: lo que han generado sus referidos y el botón para cobrarlo.
 * Se auto-oculta si el usuario no posee ningún código — la inmensa mayoría no lo hace, y el
 * endpoint devuelve ceros en vez de error precisamente para poder decidirlo con una llamada.
 */
export function ReferrerPanel() {
  const { identityToken } = useIdentityToken()
  const [data, setData] = useState<ReferrerSummary | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!identityToken) return
    try { setData(await fetchReferrerSummary(identityToken)) } catch { /* panel oculto */ }
  }, [identityToken])

  useEffect(() => { void load() }, [load])

  if (!data || data.codes.length === 0) return null

  const usd = (base: number) => formatUsd(base / 1e6)
  const canClaim = data.unclaimed_base_units >= data.claim_min_base_units
  const referred = data.codes.reduce((s, c) => s + c.referred_count, 0)

  async function onClaim() {
    if (!identityToken || !canClaim || busy) return
    setBusy(true)
    try {
      const r = await claimReferrerEarnings(identityToken)
      showToast(`Claimed ${usd(r.amount_base_units)}`, 'success')
      await load()
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const stat = (label: string, value: string, accent?: string) => (
    <div style={{ lineHeight: 1.2 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, letterSpacing: '.16em', color: COLORS.muted }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent ?? COLORS.text, marginTop: 3 }}>{value}</div>
    </div>
  )

  return (
    <section style={{
      borderRadius: 16, border: `1px solid ${COLORS.border}`, background: COLORS.panel,
      padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 26, flexWrap: 'wrap',
    }}>
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: COLORS.green }}>
          REFERRALS · {data.codes.map((c) => c.code).join(' · ')}
        </div>
        <div style={{ display: 'flex', gap: 26, marginTop: 12, flexWrap: 'wrap' }}>
          {stat('REFERRED', String(referred))}
          {stat('UNCLAIMED', usd(data.unclaimed_base_units), COLORS.green)}
          {stat('LIFETIME', usd(data.lifetime_base_units))}
        </div>
      </div>
      <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <button
          onClick={() => void onClaim()}
          disabled={!canClaim || busy}
          style={{
            padding: '12px 24px', borderRadius: 12, border: 0,
            cursor: canClaim && !busy ? 'pointer' : 'default',
            fontFamily: FONTS.display, fontSize: 14, fontWeight: 800,
            color: canClaim && !busy ? '#06170f' : COLORS.muted,
            background: canClaim && !busy ? COLORS.green : COLORS.panel2,
          }}
        >
          {busy ? 'Claiming…' : 'Claim'}
        </button>
        {!canClaim && (
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>
            min {usd(data.claim_min_base_units)}
          </span>
        )}
      </div>
    </section>
  )
}
