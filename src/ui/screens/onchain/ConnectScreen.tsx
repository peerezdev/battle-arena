/**
 * ConnectScreen — on-chain flow, step 1.
 * Abre el modal de Privy (via useWallet().connect); una vez autenticado,
 * lee el identity token de Privy y lo pasa a onAuthenticated(identityToken).
 * El backend verifica el identity token (ES256/JWKS) y extrae la wallet Solana.
 */
import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { usePrivy } from '@privy-io/react-auth'
import { useIdentityToken } from '@privy-io/react-auth'
import { useWallet } from '../../../wallet/useWallet'
import { COLORS, GRADIENT, SHADOW } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'

interface Props {
  onAuthenticated: (token: string) => void
  onBack: () => void
}

export function ConnectScreen({ onAuthenticated, onBack }: Props) {
  const { ready, authenticated } = usePrivy()
  const { identityToken } = useIdentityToken()
  const { connect } = useWallet()
  const reduced = useReducedMotion()
  const calledRef = useRef(false)

  // Once Privy is ready, the user is authenticated, and the identity token is
  // available, pass it to the parent. The ref prevents double-firing in strict mode.
  useEffect(() => {
    if (ready && authenticated && identityToken && !calledRef.current) {
      calledRef.current = true
      onAuthenticated(identityToken)
    }
  }, [ready, authenticated, identityToken, onAuthenticated])

  const isLoading = !ready || (authenticated && !identityToken)

  return (
    <div
      style={{
        minHeight: '100%',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '0 16px 32px',
      }}
    >
      <div style={{ maxWidth: '420px', margin: '0 auto', paddingTop: '40px' }}>
        {/* Back */}
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: 'none',
            color: COLORS.muted,
            cursor: 'pointer',
            fontSize: '13px',
            padding: '0 0 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          ← Back
        </button>

        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '4px' }}>
            ON-CHAIN · STEP 1
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800 }}>Connect Wallet</div>
          <div style={{ fontSize: '13px', color: COLORS.muted, marginTop: '6px', lineHeight: 1.5 }}>
            Connect your Solana wallet to authenticate and access your NFTs on devnet.
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <div
            style={{
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              color: COLORS.muted,
              borderRadius: '8px',
              padding: '12px 14px',
              fontSize: '13px',
              marginBottom: '16px',
              boxShadow: SHADOW.panel,
            }}
          >
            {!ready ? 'Initializing...' : 'Authenticating...'}
          </div>
        )}

        {/* Connect / Log in button — only shown when not yet authenticated */}
        {ready && !authenticated && (
          <motion.button
            onClick={connect}
            whileTap={reduced ? undefined : { scale: 0.96 }}
            style={{
              width: '100%',
              background: GRADIENT,
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              padding: '16px',
              fontSize: '16px',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '.03em',
              boxShadow: SHADOW.glow(COLORS.green),
            }}
          >
            Connect / Log in
          </motion.button>
        )}
      </div>
    </div>
  )
}
