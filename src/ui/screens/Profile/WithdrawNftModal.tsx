/**
 * WithdrawNftModal — send one or more NFTs out of the embedded wallet to an external address.
 *
 * Props: { open, cards, onClose, onDone }
 * Modeled on WithdrawModal (USDC): the user types a destination Solana address, which is validated,
 * then each selected NFT is transferred sequentially via POST /users/me/nft/withdraw. The backend
 * verifies ownership and signs with the (delegated) embedded wallet. Per-item success/error is
 * surfaced and a single failure does NOT abort the rest of the batch.
 */
import { useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, GRADIENT, FONTS, SHADOW } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import { useProfile } from '../../../hooks/useProfile'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'
import { withdrawNft } from '../../../onchain/gachaClient'
import type { OwnedCard } from '../../../inventory/useCollectorCryptNfts'

interface WithdrawNftModalProps {
  open: boolean
  cards: OwnedCard[]
  onClose: () => void
  onDone: () => void
}

// Base58, 32–44 chars — a light sanity check, not full on-chain validation (same as WithdrawModal).
const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

type ItemStatus = 'idle' | 'sending' | 'done' | 'error'

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#0a0e16', border: `1px solid ${COLORS.border}`, borderRadius: 10,
  padding: '11px 13px', color: COLORS.text, fontSize: 14, fontFamily: FONTS.body, outline: 'none',
}
const labelStyle: React.CSSProperties = {
  fontFamily: FONTS.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: '.16em', color: COLORS.muted,
}

function cardLabel(card: OwnedCard): string {
  if (card.name && card.name !== 'Unnamed') return card.name
  return card.mint.length > 12 ? `${card.mint.slice(0, 6)}…${card.mint.slice(-6)}` : card.mint
}

function statusColor(status: ItemStatus): string {
  if (status === 'done') return COLORS.green
  if (status === 'error') return COLORS.red
  return COLORS.muted
}

export function WithdrawNftModal({ open, cards, onClose, onDone }: WithdrawNftModalProps) {
  const reducedMotion = useReducedMotion()
  const { identityToken } = useIdentityToken()
  const gate = useDelegationGate()
  const { withdrawAddress } = useProfile()

  const [dest, setDest] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [finished, setFinished] = useState(false)
  const [items, setItems] = useState<Record<string, { status: ItemStatus; message?: string }>>({})

  // Prefill the destination from the saved withdrawal address when the modal opens.
  useEffect(() => {
    if (open && withdrawAddress) setDest((d) => (d === '' ? withdrawAddress : d))
  }, [open, withdrawAddress])

  // Reset transient state each time the modal is (re)opened.
  useEffect(() => {
    if (open) { setError(null); setBusy(false); setFinished(false); setItems({}) }
  }, [open])

  if (!open) return null

  const destValid = SOL_ADDRESS.test(dest.trim())
  const canSubmit = destValid && cards.length > 0 && !busy && !finished

  function submit() {
    if (!destValid) { setError('Enter a valid Solana wallet address.'); return }
    if (cards.length === 0) { setError('Select at least one NFT.'); return }
    if (!identityToken) { setError('Log in to withdraw.'); return }
    setError(null)
    // Needs the wallet delegated so the server can sign the transfer (same as USDC withdraw).
    gate.requireDelegation(async () => {
      setBusy(true)
      const token = identityToken
      const to = dest.trim()
      for (const card of cards) {
        setItems((m) => ({ ...m, [card.mint]: { status: 'sending' } }))
        try {
          await withdrawNft(token, card.mint, to)
          setItems((m) => ({ ...m, [card.mint]: { status: 'done' } }))
        } catch (e) {
          setItems((m) => ({ ...m, [card.mint]: { status: 'error', message: e instanceof Error ? e.message : 'failed' } }))
        }
      }
      setBusy(false)
      setFinished(true)
      onDone() // refresh inventory — some transfers may have succeeded
    })
  }

  const destShort = dest.trim().length >= 8 ? `${dest.trim().slice(0, 4)}…${dest.trim().slice(-4)}` : dest.trim()

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 200 }} />
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 201,
          background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 18,
          padding: '26px 26px 22px', width: 'min(440px, calc(100vw - 32px))', maxHeight: '88vh', overflowY: 'auto',
          boxShadow: SHADOW.panel, display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18, color: COLORS.text, letterSpacing: '-0.01em' }}>
            Withdraw {cards.length === 1 ? 'NFT' : `${cards.length} NFTs`}
          </span>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 8, width: 30, height: 30, cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONTS.body }}>
            ✕
          </button>
        </div>

        {/* Selected NFTs */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>SELECTED CARDS</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: '#11161f', border: `1px solid ${COLORS.border}`, borderRadius: 11, padding: '10px 12px', maxHeight: 168, overflowY: 'auto' }}>
            {cards.map((card) => {
              const it = items[card.mint]?.status ?? 'idle'
              return (
                <div key={card.mint} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 12.5, color: COLORS.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cardLabel(card)}</span>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.08em', color: statusColor(it), flex: 'none' }}>
                    {it === 'sending' ? 'SENDING…' : it === 'done' ? 'SENT ✓' : it === 'error' ? 'FAILED' : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Destination wallet */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>DESTINATION WALLET</span>
          <input
            value={dest}
            onChange={(e) => { setDest(e.target.value); setError(null) }}
            placeholder="Solana wallet address"
            spellCheck={false}
            disabled={busy || finished}
            style={{ ...inputStyle, fontFamily: FONTS.mono, fontSize: 13 }}
          />
        </div>

        {error && <div style={{ fontSize: 12.5, color: COLORS.red }}>{error}</div>}

        {finished ? (
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,.04)', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '12px 0',
              color: COLORS.text, fontWeight: 700, fontSize: 14, fontFamily: FONTS.display, cursor: 'pointer', width: '100%',
            }}
          >
            Done
          </button>
        ) : (
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
            {busy ? 'Withdrawing…' : `Withdraw to ${destValid ? destShort : 'wallet'}`}
          </button>
        )}
      </div>
      <DelegationGate gate={gate} />
    </>
  )
}
