/**
 * CollectionScreen — on-chain flow, step 2.
 * Lets the user enter an NFT mint address and call the oracle to get its attestation.
 * On success, shows grade/value and lets the user proceed to the Lobby with that card.
 *
 * TODO (future): automatically enumerate the wallet's NFT token accounts via
 * getTokenAccountsByOwner / DAS API and display them as a gallery. The manual-mint
 * path here is the minimum viable implementation for Fase 1.
 */
import { useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../../../wallet/useWallet'
import { attest, type AttestResponse } from '../../../onchain/oracleClient'
import { COLORS, GRADIENT, SHADOW } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'

export interface SelectedCard {
  mint: string
  attestation: AttestResponse
}

interface Props {
  token: string
  onSelectCard: (card: SelectedCard) => void
  onBack: () => void
  onOpenGacha?: () => void
}

export function CollectionScreen({ onBack, onSelectCard, onOpenGacha }: Props) {
  const { publicKey } = useWallet()
  const reduced = useReducedMotion()

  const [mint, setMint] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attestation, setAttestation] = useState<AttestResponse | null>(null)

  async function handleAttest() {
    if (!mint.trim()) return
    setLoading(true)
    setError(null)
    setAttestation(null)
    try {
      // En esta pantalla solo se valora la carta para mostrar el grado/precio;
      // la atestación real ligada a la batalla se pide en el Lobby cuando se
      // conoce el PDA concreto. Se usa el System Program como battle placeholder.
      const PREVIEW_BATTLE = '11111111111111111111111111111111'
      const att = await attest(mint.trim(), PREVIEW_BATTLE)
      setAttestation(att)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  function handleSelectCard() {
    if (!attestation) return
    onSelectCard({ mint: attestation.mint, attestation })
  }

  const isPlayable = attestation !== null && attestation.value_usd > 0

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
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingBottom: '24px' }}>
          <button
            onClick={onBack}
            style={{
              background: 'transparent',
              border: 'none',
              color: COLORS.muted,
              cursor: 'pointer',
              fontSize: '13px',
              padding: 0,
            }}
          >
            ← Back
          </button>
          {onOpenGacha && (
            <button
              onClick={onOpenGacha}
              style={{
                background: 'transparent',
                border: `1px solid ${COLORS.border}`,
                color: COLORS.muted,
                cursor: 'pointer',
                fontSize: '13px',
                padding: '4px 10px',
                borderRadius: '6px',
              }}
            >
              🎰 Gacha — open a pack
            </button>
          )}
        </div>

        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '4px' }}>
            ON-CHAIN · STEP 2
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800 }}>Your Collection</div>
          {publicKey && (
            <div style={{ fontSize: '11px', color: COLORS.muted, marginTop: '4px', wordBreak: 'break-all' }}>
              Wallet: {publicKey.toBase58()}
            </div>
          )}
          <div style={{ fontSize: '13px', color: COLORS.muted, marginTop: '8px', lineHeight: 1.5 }}>
            Enter the mint address of your NFT and press «Value» to get the oracle attestation.
            Only NFTs with a USD value greater than 0 are playable.
          </div>
          <div style={{ fontSize: '11px', color: COLORS.muted, marginTop: '6px', fontStyle: 'italic' }}>
            TODO: automatic NFT enumeration via DAS / getTokenAccountsByOwner (pending Phase 2).
          </div>
        </div>

        {/* Mint input */}
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '10px',
            padding: '16px',
            marginBottom: '16px',
            boxShadow: SHADOW.panel,
          }}
        >
          <label
            htmlFor="mint-input"
            style={{
              display: 'block',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '.05em',
              color: COLORS.muted,
              marginBottom: '8px',
              textTransform: 'uppercase',
            }}
          >
            NFT Mint Address
          </label>
          <input
            id="mint-input"
            type="text"
            value={mint}
            onChange={(e) => setMint(e.target.value)}
            placeholder="e.g. EPjFWdd5AufqSSqeM2..."
            style={{
              width: '100%',
              background: COLORS.bg,
              color: COLORS.text,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '6px',
              padding: '10px 12px',
              fontSize: '13px',
              outline: 'none',
              boxSizing: 'border-box',
              fontFamily: 'monospace',
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAttest() }}
          />
        </div>

        {/* Error */}
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
            Valuation error: {error}
            <div style={{ marginTop: '6px', fontSize: '11px' }}>
              Check that the mint address is valid and that the oracle is available.
            </div>
          </div>
        )}

        {/* Attestation result */}
        {attestation && (
          <div
            style={{
              background: COLORS.panel,
              border: `1px solid ${isPlayable ? `${COLORS.green}44` : `${COLORS.red}44`}`,
              borderRadius: '10px',
              padding: '16px',
              marginBottom: '16px',
              boxShadow: isPlayable ? SHADOW.glow(COLORS.green) : SHADOW.panel,
            }}
          >
            <div
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '.05em',
                color: COLORS.muted,
                marginBottom: '10px',
                textTransform: 'uppercase',
              }}
            >
              Valuation result
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '13px' }}>
              <div>
                <div style={{ color: COLORS.muted, fontSize: '10px', marginBottom: '2px' }}>MINT</div>
                <div style={{ fontFamily: 'monospace', fontSize: '11px', wordBreak: 'break-all' }}>
                  {attestation.mint}
                </div>
              </div>
              <div>
                <div style={{ color: COLORS.muted, fontSize: '10px', marginBottom: '2px' }}>USD VALUE</div>
                <div style={{ fontWeight: 800, fontSize: '16px', color: isPlayable ? COLORS.green : COLORS.red }}>
                  ${attestation.value_usd}
                </div>
              </div>
              <div>
                <div style={{ color: COLORS.muted, fontSize: '10px', marginBottom: '2px' }}>GRADE</div>
                <div style={{ fontWeight: 700 }}>{attestation.grading_company} {attestation.grade}</div>
              </div>
              <div>
                <div style={{ color: COLORS.muted, fontSize: '10px', marginBottom: '2px' }}>ORACLE</div>
                <div style={{ fontSize: '11px', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {attestation.oracle_pubkey.slice(0, 8)}...
                </div>
              </div>
            </div>

            {!isPlayable && (
              <div
                style={{
                  marginTop: '10px',
                  padding: '8px 10px',
                  background: '#300a0f',
                  borderRadius: '6px',
                  fontSize: '12px',
                  color: COLORS.red,
                  lineHeight: 1.4,
                }}
              >
                This NFT is not playable: USD value = 0 or no valid attestation.
              </div>
            )}
          </div>
        )}

        {/* Action buttons */}
        <motion.button
          onClick={() => void handleAttest()}
          disabled={loading || !mint.trim()}
          whileTap={reduced ? undefined : { scale: 0.96 }}
          style={{
            width: '100%',
            background: loading || !mint.trim() ? COLORS.border : GRADIENT,
            color: loading || !mint.trim() ? COLORS.muted : '#fff',
            border: 'none',
            borderRadius: '10px',
            padding: '16px',
            fontSize: '15px',
            fontWeight: 800,
            cursor: loading || !mint.trim() ? 'default' : 'pointer',
            letterSpacing: '.03em',
            boxShadow: loading || !mint.trim() ? 'none' : SHADOW.glow(COLORS.green),
            marginBottom: '12px',
          }}
        >
          {loading ? 'Valuing...' : 'Value NFT'}
        </motion.button>

        {isPlayable && (
          <motion.button
            onClick={handleSelectCard}
            whileTap={reduced ? undefined : { scale: 0.96 }}
            style={{
              width: '100%',
              background: COLORS.green,
              color: '#04130c',
              border: 'none',
              borderRadius: '10px',
              padding: '16px',
              fontSize: '15px',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '.03em',
              boxShadow: SHADOW.glow(COLORS.green),
            }}
          >
            Use this card → Lobby
          </motion.button>
        )}
      </div>
    </div>
  )
}
