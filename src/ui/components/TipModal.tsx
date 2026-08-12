/**
 * TipModal — send USDC tip to another player.
 *
 * Props: { open, to: { wallet, alias }, source, onClose }
 * Asks for an amount only (the recipient is fixed by the caller). The amount must be > 0
 * and never exceed the user's available balance (USDC minus reserved).
 *
 * Submits via sendTip (POST /users/me/tip), which moves USDC from the player's (delegated)
 * wallet to the recipient with the operator as fee-payer. Gated by the delegation flow (same
 * as battles and WithdrawModal).
 */
import { useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, GRADIENT, FONTS, SHADOW } from '../theme'
import { useReducedMotion } from '../useReducedMotion'
import { useUsdcBalance } from '../../wallet/useUsdcBalance'
import { useReservedBalance, availableUsd } from '../../wallet/useReservedBalance'
import { useDelegationGate } from './useDelegationGate'
import { DelegationGate } from './DelegationGate'
import { sendTip, TipError, type TipErrorKind } from '../../onchain/tipClient'
import { formatUsd } from '../theme'
import { showToast } from '../toastBus'

interface TipModalProps {
  open: boolean
  to: { wallet: string; alias?: string | null }
  source: 'profile' | 'chat'
  onClose: () => void
}

// Los textos se escriben AQUÍ y no se reenvía el `detail` del backend: el suyo describe la
// regla para quien lee un log, y al jugador hay que decirle además qué puede hacer (mismo
// criterio que WithdrawModal.tsx).
const MESSAGE: Record<TipErrorKind, string> = {
  no_account: 'That player does not have an account yet, so they cannot receive tips.',
  insufficient: 'Insufficient available balance.',
  too_many: 'Too many tips in a row. Try again in a minute.',
  invalid: 'Check the amount: there is a minimum, and you cannot tip yourself.',
  unavailable: 'Tips are unavailable right now. Try again later.',
  // `failed` cubre los fallos que ocurren DESPUÉS de mandar la transacción (502 tras firmar, o
  // el commit posterior), así que el dinero puede haberse movido ya. No hay idempotencia en
  // ninguna capa: invitar a reintentar a ciegas es invitar a pagar dos veces, y por eso el texto
  // manda comprobar el saldo antes de repetir en vez de ofrecer un "try again".
  failed: 'Something went wrong sending the tip. It may still have gone through, so check your balance before sending it again.',
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0a0e16', border: `1px solid ${COLORS.border}`, borderRadius: 10,
  padding: '11px 13px', color: COLORS.text, fontSize: 14, fontFamily: FONTS.body, outline: 'none',
}
const labelStyle: React.CSSProperties = {
  fontFamily: FONTS.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: '.16em', color: COLORS.muted,
}

export function TipModal({ open, to, source, onClose }: TipModalProps) {
  const reducedMotion = useReducedMotion()
  const { identityToken } = useIdentityToken()
  const gate = useDelegationGate()
  const { usdc } = useUsdcBalance()
  const { reserved } = useReservedBalance()
  const available = availableUsd(usdc, reserved)

  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Cada apertura, o un cambio de destinatario mientras está abierto, arranca de cero: si no, el
  // importe o el error de la propina ANTERIOR se cuelan en la siguiente (un tip de 3 a Ana que
  // sigue en el campo al abrir sobre Bob, listo para irse con un solo click).
  //
  // Y si había una confirmación de delegación pendiente sin resolver, se cancela aquí: `open ===
  // false` solo desmonta el <DelegationGate> que la MUESTRA, no el estado que vive dentro de
  // useDelegationGate. Sin este cancel, cerrar el modal con una propina pendiente para A y
  // reabrirlo sobre B hace reaparecer el diálogo de delegación solo, y confirmarlo paga la
  // propina VIEJA (a A) mientras la pantalla muestra a B. Es el camino común, no un borde: es la
  // primera propina de cualquier jugador que todavía no delegó.
  //
  // Se resuelve en el CUERPO del render, no en un useEffect: comparamos con la clave del render
  // anterior y, si cambió, ajustamos aquí mismo (el patrón que React recomienda para "resetear
  // estado cuando cambia una prop"). Un efecto que llama a setState de forma síncrona encadena
  // un render extra evitable, además de disparar la regla de lint react-hooks/set-state-in-effect.
  const resetKey = `${open}:${to.wallet}`
  const [lastResetKey, setLastResetKey] = useState(resetKey)
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey)
    gate.cancel()
    if (open) {
      setAmount('')
      setError(null)
      setBusy(false)
    }
  }

  if (!open) return null

  const recipientLabel = to.alias || (to.wallet ? `${to.wallet.slice(0, 4)}…${to.wallet.slice(-4)}` : 'No recipient selected')

  const amountNum = Number(amount)
  const amountEntered = amount !== '' && Number.isFinite(amountNum) && amountNum > 0
  // Derivado del estado (no solo comprobado al click) para que el motivo se lea en pantalla
  // mientras el jugador todavía está tecleando, y el botón se apague en consecuencia — igual
  // que ya hace WithdrawModal con la dirección de destino inválida.
  const overBalance = amountEntered && available != null && amountNum > available
  const noRecipient = !to.wallet
  const canSubmit = amountEntered && !overBalance && !noRecipient && !busy

  const overBalanceMessage = overBalance && available != null
    ? `Amount exceeds your available balance (${formatUsd(available)}).`
    : null
  const shownError = overBalanceMessage ?? error

  function submit() {
    // El destino lo fija quien abre el modal, no el jugador: si por lo que sea llega vacío, no
    // se manda nada al backend con un destinatario en blanco (el 404 que devolvería el server
    // dice "esa cuenta no existe", que no describe lo que pasó de verdad).
    if (!to.wallet) { setError('Select a recipient to send a tip.'); return }
    if (available == null) { setError('Balance unavailable. Try again.'); return }
    if (amount === '' || !Number.isFinite(amountNum) || amountNum <= 0) { setError('Enter an amount greater than 0.'); return }
    if (amountNum > available) { setError(`Amount exceeds your available balance (${formatUsd(available)}).`); return }
    if (!identityToken) { setError('Log in to send a tip.'); return }
    setError(null)
    // Needs the wallet delegated so the server can sign the transfer (same as battles).
    gate.requireDelegation(async () => {
      setBusy(true)
      try {
        await sendTip(identityToken, to.wallet, amountNum, source)
        showToast(`Sent ${formatUsd(amountNum)} to ${recipientLabel} ✓`, 'success')
        onClose()
      } catch (e) {
        // sendTip solo envuelve en TipError los fallos con respuesta HTTP; un fallo de red o
        // un cuerpo no-JSON llegan crudos como TypeError/SyntaxError, así que hace falta este
        // segundo nivel para no dejar al jugador sin ningún mensaje.
        setError(e instanceof TipError ? MESSAGE[e.kind] : e instanceof Error ? e.message : String(e))
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
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18, color: COLORS.text, letterSpacing: '-0.01em' }}>Send tip</span>
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

        {/* Recipient */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>TO</span>
          <div style={{ ...inputStyle, display: 'flex', alignItems: 'center', color: COLORS.text, fontFamily: FONTS.body }}>
            {recipientLabel}
          </div>
        </div>

        {/* Amount */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>AMOUNT (USDC)</span>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              aria-label="Amount"
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

        {shownError && <div style={{ fontSize: 12.5, color: COLORS.red }}>{shownError}</div>}

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
          {busy ? 'Sending…' : 'Send tip'}
        </button>
      </div>
      <DelegationGate gate={gate} />
    </>
  )
}
