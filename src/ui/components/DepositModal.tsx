/**
 * DepositModal — receive USDC via address/QR/faucet, or fund via Privy.
 *
 * Props: { open, onClose }
 * - Shows wallet address with QR code and copy button.
 * - Links to SPL faucet for devnet USDC.
 * - "Fund with card/crypto" triggers Privy's Solana fund wallet flow.
 */
import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { useWallets } from '@privy-io/react-auth/solana'
import { useFundWallet } from '@privy-io/react-auth/solana'
import { COLORS, GRADIENT, FONTS, SHADOW } from '../theme'
import { useReducedMotion } from '../useReducedMotion'

interface DepositModalProps {
  open: boolean
  onClose: () => void
}

export function DepositModal({ open, onClose }: DepositModalProps) {
  const { wallets } = useWallets()
  const { fundWallet } = useFundWallet()
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

  function handleFund() {
    if (!address) return
    void fundWallet({ address })
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

            {/* Divider */}
            <div
              style={{
                height: 1,
                background: COLORS.border,
                margin: '0 -4px',
              }}
            />

            {/* Faucet link */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <a
                href="https://spl-token-faucet.com/?token-name=USDC-Dev"
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: FONTS.body,
                  fontSize: 13,
                  fontWeight: 600,
                  color: COLORS.green,
                  textDecoration: 'none',
                  padding: '8px 12px',
                  border: `1px solid ${COLORS.green}44`,
                  borderRadius: 9,
                  background: `${COLORS.green}0d`,
                  transition: reducedMotion ? 'none' : 'opacity 0.15s',
                }}
              >
                ↗ Get test USDC
              </a>
              <span
                style={{
                  fontFamily: FONTS.body,
                  fontSize: 11,
                  color: COLORS.muted,
                  paddingLeft: 2,
                }}
              >
                Test USDC (devnet)
              </span>
            </div>

            {/* Fund with Privy */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button
                onClick={handleFund}
                style={{
                  background: GRADIENT,
                  border: 'none',
                  borderRadius: 10,
                  padding: '11px 0',
                  color: '#06120c',
                  fontWeight: 800,
                  fontSize: 14,
                  fontFamily: FONTS.display,
                  cursor: 'pointer',
                  width: '100%',
                  letterSpacing: '0.01em',
                }}
              >
                Fund with card / crypto
              </button>
              <span
                style={{
                  fontFamily: FONTS.body,
                  fontSize: 11,
                  color: COLORS.muted,
                  textAlign: 'center',
                }}
              >
                (mainnet)
              </span>
            </div>
          </>
        )}
      </div>
    </>
  )
}
