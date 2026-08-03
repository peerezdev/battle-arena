/**
 * DepositModal — receive USDC into the embedded wallet.
 *
 * Props: { open, onClose }
 * - Shows wallet address with QR code and copy button.
 *
 * Solo eso. Tenía además un enlace al faucet de devnet y el "Fund with card / crypto" de Privy;
 * los dos se retiraron a petición, así que el modal hace una sola cosa: enseñar a dónde mandar
 * el USDC.
 */
import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useWallets } from '@privy-io/react-auth/solana'
import { COLORS, FONTS, SHADOW } from '../theme'
import { useReducedMotion } from '../useReducedMotion'

interface DepositModalProps {
  open: boolean
  onClose: () => void
}

export function DepositModal({ open, onClose }: DepositModalProps) {
  const { wallets } = useWallets()
  const reducedMotion = useReducedMotion()
  const [copied, setCopied] = useState(false)

  if (!open) return null

  const address = wallets[0]?.address ?? null

  function handleCopy() {
    if (!address) return
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }


  return (
    <>
      {/* Overlay backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.65)',
          zIndex: 200,
        }}
      />

      {/* Centered panel */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 201,
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 18,
          padding: '28px 28px 24px',
          width: 'min(420px, calc(100vw - 32px))',
          boxShadow: SHADOW.panel,
          transition: reducedMotion ? 'none' : 'opacity 0.18s',
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              fontSize: 18,
              color: COLORS.text,
              letterSpacing: '-0.01em',
            }}
          >
            Deposit USDC
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: `1px solid ${COLORS.border}`,
              color: COLORS.muted,
              borderRadius: 8,
              width: 30,
              height: 30,
              cursor: 'pointer',
              fontSize: 15,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: FONTS.body,
            }}
          >
            ✕
          </button>
        </div>

        {!address ? (
          <p
            style={{
              color: COLORS.muted,
              fontFamily: FONTS.body,
              fontSize: 14,
              textAlign: 'center',
              padding: '20px 0',
            }}
          >
            Log in to deposit.
          </p>
        ) : (
          <>
            {/* QR code */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <div
                style={{
                  background: COLORS.bg,
                  borderRadius: 12,
                  padding: 12,
                  border: `1px solid ${COLORS.border}`,
                  lineHeight: 0,
                }}
              >
                <QRCodeSVG
                  value={address}
                  size={160}
                  bgColor={COLORS.bg}
                  fgColor={COLORS.text}
                />
              </div>
            </div>

            {/* Address + copy */}
            <div
              style={{
                background: '#11161f',
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 12,
                  color: COLORS.muted,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
                title={address}
              >
                {address}
              </span>
              <button
                onClick={handleCopy}
                style={{
                  background: copied ? COLORS.green : 'transparent',
                  border: `1px solid ${copied ? COLORS.green : COLORS.border}`,
                  color: copied ? '#06120c' : COLORS.text,
                  borderRadius: 7,
                  padding: '5px 10px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: FONTS.body,
                  flexShrink: 0,
                  transition: reducedMotion ? 'none' : 'all 0.15s',
                  whiteSpace: 'nowrap',
                }}
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>

          </>
        )}
      </div>
    </>
  )
}
