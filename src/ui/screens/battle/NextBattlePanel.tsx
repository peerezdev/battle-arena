import { useNavigate } from 'react-router-dom'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useOpenBattles } from '../../../onchain/useOpenBattles'
import { useMachines } from '../../useMachines'
import { openBattleToLive } from '../Hub/openBattleToLive'
import { tintFor } from './royaleShared'
import type { BattleMode } from '../../../onchain/packBattleClient'
import { siguienteLobby } from './siguienteLobby'

const MAX_AVATARS = 5

// Panel accent = the app's palette blue (#4ea8ff, the button/rarity blue). The loss hero over in
// BattleResult now wears the magenta this panel used to have — warm loss, cool next-up.
const BLUE = '#4ea8ff'
const BLUE_INK = '#7cc0ff'   // lighter blue for the eyebrow
const BLUE_RGB = '78,168,255'

/** "Next battle" suggestion for the result screen: of the lobbies still filling, recommend the one
 *  closest to starting (fewest free seats). The CTA opens that lobby's waiting room, where the
 *  player joins — we never join on their behalf from here. */
export function NextBattlePanel({ mode, currentBattleId, meWallet, compact = false }: {
  mode: BattleMode; currentBattleId: string; meWallet: string | null
  compact?: boolean   // mobile result: short horizontal card instead of the tall column
}) {
  const navigate = useNavigate()
  const { battles } = useOpenBattles()
  const machines = useMachines()

  // La selección vive en `siguienteLobby`, compartida con la puerta del Machine Tracker: las dos
  // pantallas contestan lo mismo, "¿a qué puedo entrar ahora?", y con dos copias una habría
  // empezado a recomendar salas donde el jugador ya está sentado.
  const next = siguienteLobby(battles, { mode, excluirId: currentBattleId, meWallet })

  const base = mode === 'royale' ? 'NEXT ROYALE' : 'NEXT BATTLE'
  const title = compact ? `${base} FILLING` : base

  if (!next) {
    return (
      <Shell title={title} compact={compact}>
        <div style={{ fontSize: compact ? 11.5 : 13.5, color: COLORS.muted, lineHeight: 1.5 }}>
          No lobbies are filling right now. Start one with Rematch, or head back to the lobby.
        </div>
      </Shell>
    )
  }

  const machineName = machines[next.machine_code]?.name ?? next.machine_code
  const filled = (next.player_wallets ?? []).slice(0, MAX_AVATARS)
  const emptySlots = Math.max(0, Math.min(next.max_players, MAX_AVATARS) - filled.length)
  // Same entry/estimated-pot maths the lobby battle cards use — one source of truth.
  const { entry, pot } = openBattleToLive(next)

  const av = compact ? 26 : 28
  const seats = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      {filled.map((w) => (
        <span key={w} style={{
          width: av, height: av, borderRadius: '50%', background: tintFor(w), display: 'grid', placeItems: 'center',
          fontSize: 11, fontWeight: 700, color: '#06170f',
        }}>{w.slice(0, 1).toUpperCase()}</span>
      ))}
      {Array.from({ length: emptySlots }, (_, i) => (
        <span key={`e${i}`} style={{
          width: av, height: av, borderRadius: '50%', border: '1px dashed rgba(255,255,255,.25)',
          display: 'grid', placeItems: 'center', fontSize: 11, color: '#5c6673',
        }}>?</span>
      ))}
      <span style={{ fontFamily: FONTS.mono, fontSize: compact ? 9 : 10, color: COLORS.muted, marginLeft: 4 }}>
        {next.players}/{next.max_players}{compact ? ' in' : ''}
      </span>
    </div>
  )
  const pills = (
    <>
      <Pill label="ENTRY" value={formatUsd(entry)} />
      <Pill label="EST. POT" value={formatUsd(pot)} color={COLORS.green} />
    </>
  )

  // Mobile: name + seats on top, ENTRY/EST. POT pills side by side, Join spans full width below.
  if (compact) {
    return (
      <Shell title={title} compact>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{machineName}</div>
          <div style={{ marginTop: 6 }}>{seats}</div>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>{pills}</div>
        <button
          onClick={() => navigate('/play/battle/' + next.id)}
          style={{
            width: '100%', padding: 12, borderRadius: 12, border: 0,
            background: BLUE, color: '#06121f', fontFamily: FONTS.display, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
          }}
        >
          View lobby →
        </button>
      </Shell>
    )
  }

  return (
    <Shell title={title}>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{machineName}</div>
      {seats}

      {/* stacked so both pills share the panel width and their numbers line up */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>{pills}</div>

      <button
        onClick={() => navigate('/play/battle/' + next.id)}
        style={{
          marginTop: 'auto', width: '100%', padding: 12, borderRadius: 12, border: 0,
          background: BLUE, color: '#06121f', fontFamily: FONTS.display, fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}
      >
        View lobby →
      </button>
    </Shell>
  )
}

/** Small labelled money pill — label above the value reads better than one long line. */
function Pill({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <span style={{
      display: 'inline-flex', flexDirection: 'column', gap: 1, padding: '5px 11px', borderRadius: 12,
      background: color ? `${color}12` : 'rgba(255,255,255,.04)',
      border: `1px solid ${color ? `${color}45` : COLORS.border}`,
    }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: 8, letterSpacing: '.14em', color: COLORS.muted }}>{label}</span>
      <span style={{ fontFamily: FONTS.display, fontSize: 14, fontWeight: 800, letterSpacing: '-.01em', color: color ?? COLORS.text, whiteSpace: 'nowrap' }}>{value}</span>
    </span>
  )
}

function Shell({ title, children, compact = false }: { title: string; children: React.ReactNode; compact?: boolean }) {
  return (
    <div style={{
      borderRadius: compact ? 16 : 20, border: `1px solid rgba(${BLUE_RGB},.3)`,
      background: compact
        ? `radial-gradient(300px 200px at 50% 0%,rgba(${BLUE_RGB},.12),transparent),#0a0d13`
        : `radial-gradient(400px 260px at 50% 0%,rgba(${BLUE_RGB},.12),transparent),#0c0f15`,
      padding: compact ? 14 : 20, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0,
    }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: compact ? 9.5 : 11, fontWeight: 700, letterSpacing: '.16em', color: BLUE_INK }}>⚡ {title}</span>
      {children}
    </div>
  )
}