/**
 * ConnectScreen — on-chain flow, step 1.
 * Opens the AppKit wallet modal, then authenticates against the backend:
 *   getNonce → build message → signMessage → verify → token
 * Once authenticated, calls onAuthenticated(token) to proceed to the Collection.
 */
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../../../wallet/useWallet'
import { getNonce, verify } from '../../../onchain/backendClient'
import { COLORS } from '../../theme'
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

  // Once the wallet is connected, trigger authentication automatically.
  useEffect(() => {
    if (isConnected && publicKey && step === 'connecting') {
      void authenticate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, publicKey])

  async function authenticate() {
    if (!publicKey) return
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
  if (step === 'connecting') statusText = 'Esperando conexion de wallet...'
  else if (step === 'authenticating') statusText = 'Autenticando con el backend...'
  else if (step === 'done') statusText = 'Autenticado. Cargando coleccion...'
  else statusText = ''

  return (
    <div
      style={{
        minHeight: '100dvh',
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
          ← Volver
        </button>

        {/* Header */}
        <div style={{ marginBottom: '32px' }}>
          <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '4px' }}>
            ON-CHAIN · PASO 1
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800 }}>Conectar Wallet</div>
          <div style={{ fontSize: '13px', color: COLORS.muted, marginTop: '6px', lineHeight: 1.5 }}>
            Conecta tu wallet Solana para autenticarte y acceder a tus NFTs en devnet.
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
            }}
          >
            <span style={{ color: COLORS.green, fontWeight: 700 }}>Conectado: </span>
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
              background: COLORS.green,
              color: '#04130c',
              border: 'none',
              borderRadius: '10px',
              padding: '16px',
              fontSize: '16px',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '.03em',
              boxShadow: '0 0 14px #34e29b66',
            }}
          >
            {step === 'error' ? 'Reintentar' : isConnected ? 'Autenticar' : 'Conectar Wallet'}
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
            }}
          >
            Cargando...
          </div>
        )}
      </div>
    </div>
  )
}
