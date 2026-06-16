/**
 * ConnectScreen — on-chain flow, step 1.
 * Opens the AppKit wallet modal, then authenticates against the backend:
 *   getNonce → build message → signMessage → verify → token
 * Once authenticated, calls onAuthenticated(token) to proceed to the Collection.
 */
import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../../../wallet/useWallet'
import { getNonce, verify } from '../../../onchain/backendClient'
import { COLORS, GRADIENT, SHADOW } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'

interface Props {
  onAuthenticated: (token: string) => void
  onBack: () => void
}

type AuthStep = 'idle' | 'connecting' | 'authenticating' | 'done' | 'error'

export function ConnectScreen({ onAuthenticated, onBack }: Props) {
  const { publicKey, isConnected, connect, signMessage } = useWallet()
  const reduced = useReducedMotion()

  const [step, setStep] = useState<AuthStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const authingRef = useRef(false)

  // Once the wallet is connected, trigger authentication automatically.
  // authingRef prevents concurrent invocations if wallet state toggles.
  useEffect(() => {
    if (isConnected && publicKey && step === 'connecting' && !authingRef.current) {
      void authenticate()
    }
  }, [isConnected, publicKey, step])

  async function authenticate() {
    if (!publicKey || authingRef.current) return
    authingRef.current = true
    setStep('authenticating')
    setError(null)
    try {
      const walletBase58 = publicKey.toBase58()
      const { nonce } = await getNonce(walletBase58)
      const message = `BattleArena auth: ${nonce}`
      const msgBytes = new TextEncoder().encode(message)
      const sigBytes = await signMessage(msgBytes)
      // Encode signature as hex for the backend
      const sigHex = Buffer.from(sigBytes).toString('hex')
      const { token } = await verify(walletBase58, sigHex)
      setStep('done')
      onAuthenticated(token)
    } catch (e) {
      setError((e as Error).message)
      setStep('error')
    } finally {
      authingRef.current = false
    }
  }

  function handleConnect() {
    setStep('connecting')
    setError(null)
    connect()
    // If already connected, authenticate directly
    if (isConnected && publicKey) {
      void authenticate()
    }
  }

  const isLoading = step === 'connecting' || step === 'authenticating'

  let statusText: string
  if (step === 'connecting') statusText = 'Waiting for wallet connection...'
  else if (step === 'authenticating') statusText = 'Authenticating with the backend...'
  else if (step === 'done') statusText = 'Authenticated. Loading collection...'
  else statusText = ''

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

        {/* Status / error */}
        {error && (
          <div
            style={{
              background: '#300a0f',
              border: `1px solid ${COLORS.red}`,
              color: COLORS.red,
              borderRadius: '8px',
              padding: '12px 14px',
              fontSize: '13px',
              marginBottom: '16px',
              lineHeight: 1.5,
            }}
          >
            Error: {error}
          </div>
        )}

        {statusText && (
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
            {statusText}
          </div>
        )}

        {/* Wallet status chip */}
        {isConnected && publicKey && (
          <div
            style={{
              background: COLORS.panel,
              border: `1px solid ${COLORS.green}44`,
              borderRadius: '8px',
              padding: '10px 14px',
              fontSize: '12px',
              color: COLORS.muted,
              marginBottom: '20px',
              wordBreak: 'break-all',
              boxShadow: SHADOW.panel,
            }}
          >
            <span style={{ color: COLORS.green, fontWeight: 700 }}>Connected: </span>
            {publicKey.toBase58()}
          </div>
        )}

        {/* Connect / retry button */}
        {!isLoading && step !== 'done' && (
          <motion.button
            onClick={handleConnect}
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
            {step === 'error' ? 'Retry' : isConnected ? 'Authenticate' : 'Connect Wallet'}
          </motion.button>
        )}

        {isLoading && (
          <div
            style={{
              width: '100%',
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '10px',
              padding: '16px',
              fontSize: '16px',
              fontWeight: 800,
              textAlign: 'center',
              color: COLORS.muted,
              letterSpacing: '.03em',
              boxShadow: SHADOW.panel,
            }}
          >
            Loading...
          </div>
        )}
      </div>
    </div>
  )
}
