/**
 * ModeSelect — initial screen shown when the app loads.
 * Two paths:
 *   - Practice (offline): the existing offline flow, no wallet needed.
 *   - On-chain: the full on-chain flow wrapped in AppKitProvider.
 */
import { motion } from 'framer-motion'
import { COLORS, FONTS, SHADOW } from '../ui/theme'
import { useReducedMotion } from '../ui/useReducedMotion'

export type AppMode = 'offline' | 'onchain' | 'royale'

interface Props {
  onSelect: (mode: AppMode) => void
}

export function ModeSelect({ onSelect }: Props) {
  const reduced = useReducedMotion()

  const card = (
    mode: AppMode,
    title: string,
    subtitle: string,
    accent: string,
    icon: string,
  ) => (
    <motion.button
      onClick={() => onSelect(mode)}
      whileTap={reduced ? undefined : { scale: 0.97 }}
      whileHover={reduced ? undefined : { scale: 1.02 }}
      style={{
        width: '100%',
        background: COLORS.panel,
        border: `1px solid ${accent}44`,
        borderRadius: '12px',
        padding: '24px 20px',
        cursor: 'pointer',
        textAlign: 'left',
        color: COLORS.text,
        boxShadow: SHADOW.panel,
        transition: 'box-shadow .2s',
        marginBottom: '16px',
      }}
    >
      <div style={{ fontSize: '28px', marginBottom: '8px' }}>{icon}</div>
      <div style={{ fontSize: '18px', fontWeight: 800, color: accent, marginBottom: '4px' }}>
        {title}
      </div>
      <div style={{ fontSize: '13px', color: COLORS.muted, lineHeight: 1.5 }}>
        {subtitle}
      </div>
    </motion.button>
  )

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: FONTS.body,
        padding: '0 16px 32px',
      }}
    >
      <div style={{ maxWidth: '420px', margin: '0 auto', paddingTop: '48px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div
            style={{
              fontSize: '30px',
              fontWeight: 800,
              letterSpacing: '-0.5px',
              color: COLORS.green,
              marginBottom: '8px',
              fontFamily: FONTS.display,
            }}
          >
            ⚡ TCG Battle Arena
          </div>
          <div style={{ fontSize: '13px', color: COLORS.muted, fontFamily: FONTS.mono }}>
            Choose a game mode
          </div>
        </div>

        {/* Mode cards */}
        {card(
          'offline',
          'Practice (offline)',
          'Play locally without a wallet. Two players (hotseat) or vs bot. No staking or blockchain.',
          COLORS.green,
          '🎮',
        )}

        {card(
          'onchain',
          'On-chain',
          'Connect your Solana wallet, value your NFTs with the oracle and play with real staking on devnet.',
          COLORS.violet,
          '⛓️',
        )}

        {card('royale', 'Battle Royale (demo)',
          'Up to 10 players open packs by rounds; the lowest-value card is eliminated; the last one standing takes the pot. Simulated rolls, no blockchain.',
          '#c084fc', '👑')}
      </div>
    </div>
  )
}
