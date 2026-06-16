/**
 * ModeSelect — initial screen shown when the app loads.
 * Two paths:
 *   - Práctica (offline): the existing Fase 0 offline flow, no wallet needed.
 *   - On-chain (devnet): the full on-chain flow wrapped in AppKitProvider.
 */
import { motion } from 'framer-motion'
import { COLORS, FONTS } from '../ui/theme'
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
        boxShadow: `0 0 18px ${accent}22`,
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
        fontFamily: 'Inter, system-ui, sans-serif',
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
              fontFamily: FONTS.orbitron,
            }}
          >
            ⚡ TCG Battle Arena
          </div>
          <div style={{ fontSize: '13px', color: COLORS.muted, fontFamily: FONTS.mono }}>
            Elige el modo de juego
          </div>
        </div>

        {/* Mode cards */}
        {card(
          'offline',
          'Practica (offline)',
          'Juega en local sin wallet. Dos jugadores (hotseat) o vs bot. Sin staking ni blockchain.',
          COLORS.green,
          '🎮',
        )}

        {card(
          'onchain',
          'On-chain (devnet)',
          'Conecta tu wallet Solana, valora tus NFTs con el oraculo y juega con staking real en devnet.',
          COLORS.red,
          '⛓️',
        )}

        {card('royale', 'Battle Royale (demo)',
          'Hasta 10 jugadores abren packs por rondas; cae el de menor valor; el último en pie se lleva el bote. Tiradas simuladas, sin blockchain.',
          '#c084fc', '👑')}
      </div>
    </div>
  )
}
