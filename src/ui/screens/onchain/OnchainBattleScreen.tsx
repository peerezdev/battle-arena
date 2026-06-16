/**
 * OnchainBattleScreen — on-chain flow, step 4.
 * Reuses EnergyAllocator + the reveal layout. Per round:
 *   1. Player allocates energy.
 *   2. hashAllocation(alloc, salt) → commit hash (hex) → Uint8Array → buildCommitIx → send.
 *   3. buildRevealIx(alloc, salt) → send (player reveals).
 *   4. buildResolveRoundIx → send (anyone; we send immediately after both reveals in the single-player path).
 *   5. Read Battle account to check phase / winner.
 *   6. On Settled phase: buildSettleIx → send → syncMatch.
 *
 * Battle account decoding:
 *   We use the Anchor BorshAccountsCoder with the IDL to decode the full Battle struct.
 *   Fields used: phase (enum index), winner (Option<u8>), is_draw (bool), wins_a, wins_b, round.
 *   The full decoded type is inlined below. If adding new fields triggers issues, decode only
 *   the needed fields manually — TODO documented below.
 *
 * TODO (future):
 *   - In a real multiplayer game the "resolve_round" tx would be sent by either player or a keeper
 *     after both reveals are confirmed. Here we send it immediately after our reveal (optimistic).
 *   - After "resolve_round", poll the Battle account to get the updated phase before proceeding.
 *   - Display the opponent's allocations in the reveal panel (read from on-chain reveals_a/reveals_b).
 *   - Handle timeout (buildClaimTimeoutIx) if the opponent doesn't reveal.
 */
import { useState, useCallback } from 'react'
import { PublicKey, Connection } from '@solana/web3.js'
import { BorshAccountsCoder } from '@coral-xyz/anchor'
import { motion } from 'framer-motion'
import { useWallet } from '../../../wallet/useWallet'
import { hashAllocation } from '../../../engine'
import type { Allocation } from '../../../engine'
import {
  buildCommitIx,
  buildRevealIx,
  buildResolveRoundIx,
  buildSettleIx,
} from '../../../onchain/instructions'
import { vaultPda } from '../../../onchain/pdas'
import { syncMatch } from '../../../onchain/backendClient'
import { config } from '../../../onchain/config'
import { DEFAULT_MATCH_CONFIG } from '../../../onchain/types'
import idl from '../../../onchain/idl/battle_arena.json'
import { COLORS, SHADOW, player as playerTheme } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import { EnergyAllocator } from '../../components/EnergyAllocator'
import type { BattleInfo } from './LobbyScreen'

// ── Minimal decoded Battle fields we use ─────────────────────────────────────
// Phase enum mapping (must match IDL order: Created=0, Committing=1, Revealing=2, RoundResolved=3, Settled=4, Closed=5)
const PHASE_NAMES = ['Created', 'Committing', 'Revealing', 'RoundResolved', 'Settled', 'Closed'] as const
type PhaseName = (typeof PHASE_NAMES)[number]

interface DecodedBattle {
  phase: { [K in PhaseName]?: Record<string, never> }
  winner: number | null
  is_draw: boolean
  wins_a: number
  wins_b: number
  round: number
  player_a: PublicKey
  player_b: PublicKey
  /** on-chain banked energy for each player */
  banked_a: number
  banked_b: number
  /** edge bonus per round for each player */
  edge_a: number
  edge_b: number
  /** match config (decoded camelCase by Anchor coder) */
  cfg?: { base_energy?: number; baseEnergy?: number; rounds_to_win?: number; roundsToWin?: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const battleCoder = new BorshAccountsCoder(idl as any)

function getPhaseName(decoded: DecodedBattle): PhaseName {
  for (const name of PHASE_NAMES) {
    if (decoded.phase[name] !== undefined) return name
  }
  return 'Created'
}

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  token: string
  battle: BattleInfo
  onFinished: () => void
}

type BattleStep =
  | 'allocating'
  | 'committing'
  | 'revealing'
  | 'resolving'
  | 'round_resolved'
  | 'settling'
  | 'settled'
  | 'error'

/** Apply a delta to one key of an Allocation, clamping each field >= 0 and sum <= available. */
function clampApply(prev: Allocation, key: keyof Allocation, delta: number, available: number): Allocation {
  const next = Math.max(0, prev[key] + delta)
  const others = (Object.keys(prev) as (keyof Allocation)[])
    .filter((k) => k !== key)
    .reduce((s, k) => s + prev[k], 0)
  const clamped = Math.min(next, available - others)
  return { ...prev, [key]: clamped }
}

/** FIX A: Default base energy (fallback when battle account not yet read). */
const DEFAULT_BASE_ENERGY = 10

export function OnchainBattleScreen({ token, battle, onFinished }: Props) {
  const { publicKey, signAndSendTransaction } = useWallet()
  const reduced = useReducedMotion()

  const [alloc, setAlloc] = useState<Allocation>({ apertura: 0, choque: 0, remate: 0 })
  const [step, setStep] = useState<BattleStep>('allocating')
  const [error, setError] = useState<string | null>(null)
  const [txLog, setTxLog] = useState<string[]>([])
  const [round, setRound] = useState(0)
  const [winsA, setWinsA] = useState(0)
  const [winsB, setWinsB] = useState(0)
  const [finalWinner, setFinalWinner] = useState<'a' | 'b' | 'draw' | null>(null)
  // FIX A: Track available energy computed from on-chain state (base + banked + edge).
  const [availableEnergy, setAvailableEnergy] = useState<number>(DEFAULT_BASE_ENERGY)

  // Current salt (generated per round commit)
  const [currentSalt, setCurrentSalt] = useState<string>('')

  const battlePk = new PublicKey(battle.battlePubkey)
  const isPlayerA = publicKey != null && publicKey.toBase58() === battle.playerA

  function logTx(label: string, sig: string) {
    setTxLog((prev) => [...prev, `${label}: ${sig.slice(0, 8)}...`])
  }

  /**
   * FIX A: Compute available energy for the local player from the decoded on-chain Battle.
   * Formula mirrors the engine's availableEnergy():
   *   available = base_energy + banked_<me> + edge_<me>
   */
  function computeAvailableFromDecoded(decoded: DecodedBattle): number {
    const isA = publicKey != null && decoded.player_a.toBase58() === publicKey.toBase58()
    const baseEnergy =
      (decoded.cfg?.base_energy ?? decoded.cfg?.baseEnergy ?? DEFAULT_BASE_ENERGY)
    const banked = isA ? (decoded.banked_a ?? 0) : (decoded.banked_b ?? 0)
    const edge   = isA ? (decoded.edge_a   ?? 0) : (decoded.edge_b   ?? 0)
    return baseEnergy + banked + edge
  }

  // Read Battle account and decode
  const readBattleAccount = useCallback(async (): Promise<DecodedBattle | null> => {
    try {
      const conn = new Connection(config.rpcUrl, 'confirmed')
      const info = await conn.getAccountInfo(battlePk)
      if (!info) return null
      // Account data has 8-byte discriminator prepended by Anchor; BorshAccountsCoder.decode handles it
      const decoded = battleCoder.decode('Battle', info.data) as DecodedBattle
      return decoded
    } catch {
      return null
    }
  }, [battlePk])

  async function handleCommitAndReveal() {
    if (!publicKey) return
    setStep('committing')
    setError(null)

    const salt = crypto.randomUUID()
    setCurrentSalt(salt)

    try {
      // Commit
      const hashHex = await hashAllocation(alloc, salt)
      const hashBytes = Buffer.from(hashHex, 'hex')
      const commitIx = buildCommitIx({
        battle: battlePk,
        player: publicKey,
        commit: new Uint8Array(hashBytes),
      })
      const commitSig = await signAndSendTransaction([commitIx])
      logTx('commit', commitSig)

      // Reveal immediately (single-player path; in multiplayer: wait for opponent commit)
      setStep('revealing')
      const revealIx = buildRevealIx({
        battle: battlePk,
        player: publicKey,
        alloc,
        salt,
      })
      const revealSig = await signAndSendTransaction([revealIx])
      logTx('reveal', revealSig)

      // Resolve round (anyone can call once both reveals are on-chain)
      setStep('resolving')
      const resolveIx = buildResolveRoundIx({ battle: battlePk })
      const resolveSig = await signAndSendTransaction([resolveIx])
      logTx('resolve_round', resolveSig)

      // Read updated battle state
      const decoded = await readBattleAccount()
      if (decoded) {
        setWinsA(decoded.wins_a)
        setWinsB(decoded.wins_b)
        setRound(decoded.round)
        // FIX A: update available energy for the next round from on-chain state
        setAvailableEnergy(computeAvailableFromDecoded(decoded))
        const phase = getPhaseName(decoded)
        if (phase === 'Settled') {
          // Already settled on-chain (shouldn't happen right after resolve, but handle it)
          await handleSettle(decoded)
          return
        }
        if (phase === 'RoundResolved') {
          // Check if battle should end (one player reached roundsToWin)
          const roundsToWin = decoded.cfg?.rounds_to_win ?? decoded.cfg?.roundsToWin ?? DEFAULT_MATCH_CONFIG.roundsToWin
          if (decoded.wins_a >= roundsToWin || decoded.wins_b >= roundsToWin) {
            setStep('settling')
            await handleSettle(decoded)
            return
          }
        }
      }

      // Next round
      setStep('allocating')
      setAlloc({ apertura: 0, choque: 0, remate: 0 })
      setCurrentSalt('')
    } catch (e) {
      setError((e as Error).message)
      setStep('error')
    }
  }

  async function handleSettle(decoded?: DecodedBattle) {
    if (!publicKey) return
    setStep('settling')
    setError(null)
    try {
      const [escrowVault] = vaultPda(battlePk)

      if (!config.treasury) {
        throw new Error('VITE_TREASURY is not configured. Cannot settle the battle.')
      }
      const treasuryPk = new PublicKey(config.treasury)

      const playerATokenPk = new PublicKey(battle.playerAToken)
      const playerBTokenPk = new PublicKey(battle.playerBToken)

      const settleIx = buildSettleIx({
        battle: battlePk,
        escrowVault,
        playerAToken: playerATokenPk,
        playerBToken: playerBTokenPk,
        treasury: treasuryPk,
      })
      const settleSig = await signAndSendTransaction([settleIx])
      logTx('settle', settleSig)
      await syncMatch(battle.battlePubkey, token)

      // Determine winner for display
      const d = decoded ?? (await readBattleAccount())
      if (d) {
        if (d.is_draw) setFinalWinner('draw')
        else if (d.winner === 0) setFinalWinner('a')
        else if (d.winner === 1) setFinalWinner('b')
      }
      setStep('settled')
    } catch (e) {
      setError((e as Error).message)
      setStep('error')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const accentColor = isPlayerA ? COLORS.green : COLORS.violet
  const roleLabel = isPlayerA ? 'Player A' : 'Player B'
  const total = alloc.apertura + alloc.choque + alloc.remate
  const remaining = availableEnergy - total

  const isLoading =
    step === 'committing' ||
    step === 'revealing' ||
    step === 'resolving' ||
    step === 'settling'

  let statusLabel = ''
  if (step === 'committing') statusLabel = 'Sending commit...'
  else if (step === 'revealing') statusLabel = 'Sending reveal...'
  else if (step === 'resolving') statusLabel = 'Resolving round...'
  else if (step === 'settling') statusLabel = 'Settling battle...'

  if (step === 'settled') {
    const winMsg =
      finalWinner === 'draw'
        ? 'Draw'
        : finalWinner === 'a'
        ? 'Player A wins'
        : finalWinner === 'b'
        ? 'Player B wins'
        : 'Battle finished'

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
        <div style={{ maxWidth: '420px', margin: '0 auto', paddingTop: '40px', textAlign: 'center' }}>
          <div style={{ fontSize: '40px', marginBottom: '16px' }}>🏆</div>
          <div style={{ fontSize: '26px', fontWeight: 800, marginBottom: '8px', color: COLORS.green }}>
            {winMsg}
          </div>
          <div style={{ fontSize: '13px', color: COLORS.muted, marginBottom: '24px' }}>
            Rounds: {winsA}–{winsB}
          </div>
          {txLog.length > 0 && (
            <div
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '8px',
                padding: '12px',
                fontSize: '11px',
                fontFamily: 'monospace',
                textAlign: 'left',
                color: COLORS.muted,
                marginBottom: '20px',
                boxShadow: SHADOW.panel,
              }}
            >
              {txLog.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          )}
          <button
            onClick={onFinished}
            style={{
              background: COLORS.green,
              color: '#04130c',
              border: 'none',
              borderRadius: '10px',
              padding: '14px 28px',
              fontSize: '15px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: SHADOW.glow(COLORS.green),
            }}
          >
            Back to Lobby
          </button>
        </div>
      </div>
    )
  }

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
      <div style={{ maxWidth: '420px', margin: '0 auto', paddingTop: '24px' }}>
        {/* Header */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '2px' }}>
            ON-CHAIN · ROUND {round + 1}
          </div>
          <div style={{ fontSize: '18px', fontWeight: 800, color: accentColor }}>
            {roleLabel}
          </div>
          <div style={{ fontSize: '11px', color: COLORS.muted, marginTop: '2px', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Battle: {battle.battlePubkey}
          </div>
        </div>

        {/* Scoreboard */}
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '8px',
            padding: '10px 14px',
            marginBottom: '14px',
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '13px',
            boxShadow: SHADOW.panel,
          }}
        >
          <span>
            <span style={{ color: COLORS.green, fontWeight: 700 }}>A</span>
            <span style={{ color: COLORS.muted }}> — rounds: </span>
            <span style={{ color: COLORS.green, fontWeight: 800 }}>{winsA}</span>
          </span>
          <span style={{ color: COLORS.muted }}>vs</span>
          <span>
            <span style={{ color: COLORS.violet, fontWeight: 800 }}>{winsB}</span>
            <span style={{ color: COLORS.muted }}> :rounds — </span>
            <span style={{ color: COLORS.violet, fontWeight: 700 }}>B</span>
          </span>
        </div>

        {/* Error */}
        {error && step === 'error' && (
          <div
            style={{
              background: '#300a0f',
              border: `1px solid ${COLORS.red}`,
              color: COLORS.red,
              borderRadius: '8px',
              padding: '12px 14px',
              fontSize: '13px',
              marginBottom: '14px',
              lineHeight: 1.5,
            }}
          >
            {error}
          </div>
        )}

        {/* Status indicator */}
        {isLoading && (
          <div
            style={{
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              color: COLORS.muted,
              borderRadius: '8px',
              padding: '12px 14px',
              fontSize: '13px',
              marginBottom: '14px',
              textAlign: 'center',
              boxShadow: SHADOW.panel,
            }}
          >
            {statusLabel}
          </div>
        )}

        {/* Energy header */}
        {step === 'allocating' && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: '8px',
              fontSize: '13px',
            }}
          >
            <span style={{ color: COLORS.muted }}>
              {/* FIX A: show computed available (base + banked + edge) */}
              Available energy: <strong style={{ color: accentColor }}>{availableEnergy}</strong>
            </span>
            <span style={{ color: COLORS.muted }}>
              Assigned: <strong style={{ color: accentColor }}>{total}</strong>
              {remaining > 0 && ` · ${remaining} banked`}
            </span>
          </div>
        )}

        {/* Allocator */}
        {step === 'allocating' && (
          <EnergyAllocator
            alloc={alloc}
            available={availableEnergy}
            onChange={(key, delta) =>
              setAlloc((prev) => clampApply(prev, key, delta, availableEnergy))
            }
            accentColor={accentColor}
            reducedMotion={reduced}
            disabled={false}
          />
        )}

        {/* Commit button */}
        {step === 'allocating' && (
          <motion.button
            onClick={() => void handleCommitAndReveal()}
            whileTap={reduced ? undefined : { scale: 0.96 }}
            style={{
              width: '100%',
              background: accentColor,
              color: isPlayerA ? '#04130c' : '#fff',
              border: 'none',
              borderRadius: '10px',
              padding: '16px',
              fontSize: '16px',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '.03em',
              boxShadow: SHADOW.glow(accentColor),
              marginBottom: '12px',
            }}
          >
            Confirm & Commit — {total}/{availableEnergy} energy
            {remaining > 0 ? ` · ${remaining} banked` : ''}
          </motion.button>
        )}

        {/* Settle button (shown when resolve fails and phase is RoundResolved with a winner) */}
        {step === 'error' && (
          <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
            <button
              onClick={() => { setStep('allocating'); setError(null) }}
              style={{
                flex: 1,
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                color: COLORS.text,
                borderRadius: '8px',
                padding: '12px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
            <button
              onClick={() => void handleSettle()}
              style={{
                flex: 1,
                background: playerTheme.a.color,
                color: '#04130c',
                border: 'none',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '13px',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: SHADOW.glow(playerTheme.a.color),
              }}
            >
              Settle battle
            </button>
          </div>
        )}

        {/* TX log */}
        {txLog.length > 0 && (
          <div
            style={{
              background: COLORS.panel,
              border: `1px solid ${COLORS.border}`,
              borderRadius: '8px',
              padding: '10px 12px',
              marginTop: '12px',
              fontSize: '10px',
              fontFamily: 'monospace',
              color: COLORS.muted,
              boxShadow: SHADOW.panel,
            }}
          >
            <div style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '.05em', marginBottom: '4px', textTransform: 'uppercase' }}>
              Transactions
            </div>
            {txLog.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}

        {/* FIX E (MEDIUM-2): Salt display only in DEV builds — never expose in production. */}
        {import.meta.env.DEV && currentSalt && step !== 'allocating' && (
          <div
            style={{
              marginTop: '8px',
              fontSize: '10px',
              color: COLORS.muted,
              fontFamily: 'monospace',
              wordBreak: 'break-all',
            }}
          >
            [DEV] Salt: {currentSalt}
          </div>
        )}
      </div>
    </div>
  )
}
