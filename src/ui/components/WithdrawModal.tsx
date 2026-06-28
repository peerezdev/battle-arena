/**
 * WithdrawModal — send USDC out of the embedded wallet.
 *
 * Props: { open, onClose }
 * Asks for a destination Solana wallet and an amount. The amount must be > 0 and
 * never exceed the user's available balance (USDC minus reserved).
 *
 * Submits to POST /users/me/withdraw, which moves USDC from the player's (delegated) wallet to the
 * destination with the operator as fee-payer. Gated by the delegation flow (same as battles).
 */
import { useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, GRADIENT, FONTS, SHADOW } from '../theme'
import { useReducedMotion } from '../useReducedMotion'
import { useUsdcBalance } from '../../wallet/useUsdcBalance'
import { useReservedBalance, availableUsd } from '../../wallet/useReservedBalance'
import { useProfile } from '../../hooks/useProfile'
import { useDelegationGate } from './useDelegationGate'
import { DelegationGate } from './DelegationGate'
import { config } from '../../onchain/config'
import { formatUsd } from '../theme'
import { showToast } from '../toast'

interface WithdrawModalProps {
  open: boolean
  onClose: () => void
}

// Base58, 32–44 chars — a light sanity check, not full on-chain validation.
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0a0e16', border: `1px solid ${COLORS.border}`, borderRadius: 10,
  padding: '11px 13px', color: COLORS.text, fontSize: 14, fontFamily: FONTS.body, outline: 'none',
}
const labelStyle: React.CSSProperties = {
  fontFamily: FONTS.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: '.16em', color: COLORS.muted,
}

export function WithdrawModal({ open, onClose }: WithdrawModalProps) {
  const reducedMotion = useReducedMotion()
  const { identityToken } = useIdentityToken()
  const gate = useDelegationGate()
  const { usdc } = useUsdcBalance()
  const { reserved } = useReservedBalance()
  const { withdrawAddress } = useProfile()
  const available = availableUsd(usdc, reserved)

  const [dest, setDest] = useState('')
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Prefill the destination from the saved withdrawal address when the modal opens.
  useEffect(() => {
    if (open && withdrawAddress) setDest((d) => (d === '' ? withdrawAddress : d))
  }, [open, withdrawAddress])

  if (!open) return null

  const amountNum = Number(amount)
  const amountValid = amount !== '' && Number.isFinite(amountNum) && amountNum > 0 && available != null && amountNum <= available
  const destValid = SOL_ADDRESS.test(dest.trim())
  const canSubmit = destValid && amountValid && !busy

  function submit() {
    if (available == null) { setError('Balance unavailable. Try again.'); return }
    if (!destValid) { setError('Enter a valid Solana wallet address.'); return }
    if (amount === '' || !Number.isFinite(amountNum) || amountNum <= 0) { setError('Enter an amount greater than 0.'); return }
    if (amountNum > available) { setError(`Amount exceeds your available balance (${formatUsd(available)}).`); return }
    if (!identityToken) { setError('Log in to withdraw.'); return }
    setError(null)
    // Needs the wallet delegated so the server can sign the transfer (same as battles).
    gate.requireDelegation(async () => {
      setBusy(true)
      try {
        const resp = await fetch(`${config.backendUrl}/users/me/withdraw`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identityToken}`, 'ngrok-skip-browser-warning': 'true' },
          body: JSON.stringify({ address: dest.trim(), amount: amountNum }),
        })
        if (resp.status === 402) { setError('Insufficient available balance.'); return }
        if (resp.status === 503) { setError('Withdrawals are temporarily unavailable.'); return }
        if (!resp.ok) { setError('Withdrawal failed. Please try again.'); return }
        showToast(`Withdrew ${formatUsd(amountNum)} to ${dest.slice(0, 4)}…${dest.slice(-4)} ✓`, 'success')
        onClose()
      } catch {
        setError('Network error.')
      } finally {
        setBusy(false)
      }
    })
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200 }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 201,
          background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 18,
          padding: '26px 26px 22px', width: 'min(420px, calc(100vw - 32px))', boxShadow: SHADOW.panel,
          display: 'flex', flexDirection: 'column', gap: 18,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18, color: COLORS.text, letterSpacing: '-0.01em' }}>Withdraw USDC</span>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONTS.body }}>
            ✕
          </button>
        </div>

        {/* Available */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#11161f', border: `1px solid ${COLORS.border}`, borderRadius: 11, padding: '10px 14px' }}>
          <span style={labelStyle}>AVAILABLE</span>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.text }}>
            {available != null ? formatUsd(available) : '—'}
          </span>
        </div>

        {/* Destination wallet */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>DESTINATION WALLET</span>
          <input
            value={dest}
            onChange={(e) => { setDest(e.target.value); setError(null) }}
            placeholder="Solana wallet address"
            spellCheck={false}
            style={{ ...inputStyle, fontFamily: FONTS.mono, fontSize: 13 }}
          />
        </div>

        {/* Amount */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>AMOUNT (USDC)</span>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              value={amount}
              onChange={(e) => { setAmount(e.target.value.replace(/[^0-9.]/g, '')); setError(null) }}
              inputMode="decimal"
              placeholder="0.00"
              style={{ ...inputStyle, paddingRight: 64 }}
            />
            <button
              onClick={() => { if (available != null) { setAmount(String(available)); setError(null) } }}
              disabled={available == null}
              style={{ position: 'absolute', right: 8, background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.green, borderRadius: 7, padding: '5px 9px', fontSize: 11, fontWeight: 700, fontFamily: FONTS.body, cursor: available == null ? 'default' : 'pointer' }}
            >
              MAX
            </button>
          </div>
        </div>

        {error && <div style={{ fontSize: 12.5, color: COLORS.red }}>{error}</div>}

        <button
          onClick={submit}
          disabled={!canSubmit}
          style={{
            background: canSubmit ? GRADIENT : '#1a2230', border: 'none', borderRadius: 10, padding: '12px 0',
            color: canSubmit ? '#06120c' : COLORS.muted, fontWeight: 800, fontSize: 14, fontFamily: FONTS.display,
            cursor: !canSubmit ? 'default' : 'pointer', width: '100%', letterSpacing: '0.01em',
            transition: reducedMotion ? 'none' : 'background 0.15s',
          }}
        >
          {busy ? 'Withdrawing…' : 'Withdraw'}
        </button>
      </div>
      <DelegationGate gate={gate} />
    </>
  )
}
