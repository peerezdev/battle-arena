/**
 * LobbyScreen — on-chain flow, step 3.
 * Lists open matches from the backend and lets the user:
 *   - Create: open a new battle by attesting their NFT, building initialize_battle ixs, sending,
 *     deriving the battle pubkey, and registering with the backend.
 *   - Join: join an existing joinable battle by attesting their NFT, building join_battle ixs,
 *     sending, syncing with the backend, and proceeding to the on-chain battle screen.
 *
 * Token account (ATA) handling:
 *   The player's USDC ATA (playerAToken / playerBToken) is derived via
 *   getAssociatedTokenAddressSync from @solana/spl-token.
 *   The NFT's token account (nftTokenA / nftTokenB) is also derived as an ATA.
 *   VITE_STAKE_MINT and VITE_TREASURY must be set in .env — see .env.example.
 *
 * TODO (future):
 *   - Validate that the derived ATAs actually exist before sending.
 *   - Real-time lobby refresh via polling / websocket.
 */
import { useState, useEffect, useCallback } from 'react'
import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'
import { motion } from 'framer-motion'
import { useWallet } from '../../../wallet/useWallet'
import { attest } from '../../../onchain/oracleClient'
import {
  getOpenMatches,
  registerMatch,
  syncMatch,
  type OpenMatch,
} from '../../../onchain/backendClient'
import {
  buildInitializeBattleIxs,
  buildJoinBattleIxs,
} from '../../../onchain/instructions'
import { battlePda } from '../../../onchain/pdas'
import { DEFAULT_MATCH_CONFIG } from '../../../onchain/types'
import { config } from '../../../onchain/config'
import { COLORS, GRADIENT, SHADOW } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import type { SelectedCard } from './CollectionScreen'

export interface BattleInfo {
  battlePubkey: string
  /** The local player's role in this battle */
  role: 'a' | 'b'
  /** Pubkey of the player A (the battle creator) */
  playerA: string
  /** Player A's stake token account — needed later by settle */
  playerAToken: string
  /** Player B's stake token account */
  playerBToken: string
}

interface Props {
  token: string
  selectedCard: SelectedCard
  onBattleJoined: (battle: BattleInfo) => void
  onBack: () => void
}

export function LobbyScreen({ token, selectedCard, onBattleJoined, onBack }: Props) {
  const { publicKey, signAndSendTransaction } = useWallet()
  const reduced = useReducedMotion()

  const [matches, setMatches] = useState<OpenMatch[]>([])
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [matchError, setMatchError] = useState<string | null>(null)

  // Create form state
  const [stakeInput, setStakeInput] = useState('')
  const [minEloInput, setMinEloInput] = useState('')
  const [maxEloInput, setMaxEloInput] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState<string | null>(null)

  // Join state
  const [joiningBattle, setJoiningBattle] = useState<string | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)

  const loadMatches = useCallback(async () => {
    if (!publicKey) return
    setLoadingMatches(true)
    setMatchError(null)
    try {
      const list = await getOpenMatches(publicKey.toBase58())
      setMatches(list)
    } catch (e) {
      setMatchError((e as Error).message)
    } finally {
      setLoadingMatches(false)
    }
  }, [publicKey])

  useEffect(() => {
    void loadMatches()
  }, [loadMatches])

  // Helper: derive the user's SPL token ATA for a given mint
  function getAta(ownerPk: PublicKey, mintBase58: string): PublicKey {
    const mintPk = new PublicKey(mintBase58)
    return getAssociatedTokenAddressSync(mintPk, ownerPk)
  }

  async function handleCreate() {
    if (!publicKey) return
    const stakeNum = Number(stakeInput)
    if (!stakeInput || isNaN(stakeNum) || stakeNum <= 0) {
      setCreateError('Enter a valid stake (> 0).')
      return
    }
    if (!config.stakeMint) {
      setCreateError('VITE_STAKE_MINT is not configured. Complete .env before creating a battle.')
      return
    }
    if (!config.treasury) {
      setCreateError('VITE_TREASURY is not configured. Complete .env before creating a battle.')
      return
    }

    setCreating(true)
    setCreateError(null)
    setCreateSuccess(null)
    try {
      // FIX F (MEDIUM-3): Stronger nonce with added random entropy (stays within u64 safely).
      const nonce =
        BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1_000_000))

      // Derive the battle PDA BEFORE requesting the attestation so the oracle
      // can bind the signature to this specific battle (anti-replay).
      const [battleKey] = battlePda(publicKey, nonce)
      const battlePubkeyStr = battleKey.toBase58()

      const att = await attest(selectedCard.mint, battlePubkeyStr)

      // FIX B (HIGH-1): Assert oracle pubkey matches the pinned config value if set.
      if (config.oraclePubkey && att.oracle_pubkey !== config.oraclePubkey) {
        throw new Error(
          `Oracle pubkey mismatch: expected ${config.oraclePubkey}, got ${att.oracle_pubkey}. ` +
          'Rejecting attestation from untrusted oracle.'
        )
      }

      // FIX D (MEDIUM-1): Guard BigInt() calls against floats/null from oracle.
      if (!Number.isInteger(att.ts) || att.ts == null)
        throw new Error(`Oracle ts is not an integer: ${att.ts}`)
      if (!Number.isInteger(att.value_usd) || att.value_usd == null)
        throw new Error(`Oracle value_usd is not an integer: ${att.value_usd}`)

      const stakeMintPk = new PublicKey(config.stakeMint)
      const treasuryPk = new PublicKey(config.treasury)
      const playerAToken = getAta(publicKey, config.stakeMint)
      const nftTokenA = getAta(publicKey, selectedCard.mint)
      const oraclePk = new PublicKey(att.oracle_pubkey)

      const ixs = buildInitializeBattleIxs({
        playerA: publicKey,
        stakeMint: stakeMintPk,
        playerAToken,
        nftTokenA,
        nonce,
        stake: BigInt(Math.round(stakeNum)),
        cfg: DEFAULT_MATCH_CONFIG,
        oracle: oraclePk,
        treasury: treasuryPk,
        nftMintA: new PublicKey(selectedCard.mint),
        valueUsdA: BigInt(att.value_usd),
        gradeA: att.grade,
        tsA: BigInt(att.ts),
        messageHex: att.message_hex,
        signatureHex: att.signature_hex,
      })

      await signAndSendTransaction(ixs)

      const minElo = minEloInput ? Number(minEloInput) : null
      const maxElo = maxEloInput ? Number(maxEloInput) : null

      await registerMatch(token, {
        battle_pubkey: battlePubkeyStr,
        min_elo: minElo,
        max_elo: maxElo,
      })

      setCreateSuccess(`Battle created: ${battlePubkeyStr}`)
      setStakeInput('')
      setMinEloInput('')
      setMaxEloInput('')
      void loadMatches()
    } catch (e) {
      setCreateError((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function handleJoin(match: OpenMatch) {
    if (!publicKey) return
    if (!config.stakeMint) {
      setJoinError('VITE_STAKE_MINT is not configured.')
      return
    }

    setJoiningBattle(match.battle_pubkey)
    setJoinError(null)
    try {
      // Pass the battle pubkey to the oracle to bind the attestation to this battle (anti-replay).
      const att = await attest(selectedCard.mint, match.battle_pubkey)

      // FIX B (HIGH-1): Assert oracle pubkey matches the pinned config value if set.
      if (config.oraclePubkey && att.oracle_pubkey !== config.oraclePubkey) {
        throw new Error(
          `Oracle pubkey mismatch: expected ${config.oraclePubkey}, got ${att.oracle_pubkey}. ` +
          'Rejecting attestation from untrusted oracle.'
        )
      }

      // FIX D (MEDIUM-1): Guard BigInt() calls against floats/null from oracle.
      if (!Number.isInteger(att.ts) || att.ts == null)
        throw new Error(`Oracle ts is not an integer: ${att.ts}`)
      if (!Number.isInteger(att.value_usd) || att.value_usd == null)
        throw new Error(`Oracle value_usd is not an integer: ${att.value_usd}`)

      const playerBToken = getAta(publicKey, config.stakeMint)
      const nftTokenB = getAta(publicKey, selectedCard.mint)
      const oraclePk = new PublicKey(att.oracle_pubkey)
      const battlePk = new PublicKey(match.battle_pubkey)

      const ixs = buildJoinBattleIxs({
        playerB: publicKey,
        battle: battlePk,
        playerBToken,
        nftTokenB,
        oracle: oraclePk,
        nftMintB: new PublicKey(selectedCard.mint),
        valueUsdB: BigInt(att.value_usd),
        gradeB: att.grade,
        tsB: BigInt(att.ts),
        messageHex: att.message_hex,
        signatureHex: att.signature_hex,
      })

      await signAndSendTransaction(ixs)
      await syncMatch(match.battle_pubkey, token)

      // Derive a best-effort playerA token account (needed for settle later)
      const playerAToken = getAta(new PublicKey(match.player_a), config.stakeMint)

      onBattleJoined({
        battlePubkey: match.battle_pubkey,
        role: 'b',
        playerA: match.player_a,
        playerAToken: playerAToken.toBase58(),
        playerBToken: playerBToken.toBase58(),
      })
    } catch (e) {
      setJoinError((e as Error).message)
    } finally {
      setJoiningBattle(null)
    }
  }

  const btnBase: React.CSSProperties = {
    border: 'none',
    borderRadius: '8px',
    padding: '10px 14px',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '.03em',
  }

  const input: React.CSSProperties = {
    width: '100%',
    background: COLORS.bg,
    color: COLORS.text,
    border: `1px solid ${COLORS.border}`,
    borderRadius: '6px',
    padding: '10px 12px',
    fontSize: '13px',
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '0 16px 48px',
      }}
    >
      <div style={{ maxWidth: '520px', margin: '0 auto', paddingTop: '40px' }}>
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
          }}
        >
          ← Back
        </button>

        {/* Header */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '11px', color: COLORS.muted, letterSpacing: '.06em', marginBottom: '4px' }}>
            ON-CHAIN · STEP 3
          </div>
          <div style={{ fontSize: '24px', fontWeight: 800, marginBottom: '4px' }}>Lobby</div>
          <div style={{ fontSize: '12px', color: COLORS.muted }}>
            Card: <span style={{ color: COLORS.green, fontWeight: 700 }}>{selectedCard.mint.slice(0, 8)}...</span>
            {' · '}Value: <span style={{ color: COLORS.green, fontWeight: 700 }}>${selectedCard.attestation.value_usd}</span>
            {' · '}{selectedCard.attestation.grading_company} {selectedCard.attestation.grade}
          </div>
        </div>

        {/* ── Create battle ────────────────────────── */}
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '10px',
            padding: '20px',
            marginBottom: '24px',
            boxShadow: SHADOW.panel,
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '16px', color: COLORS.green }}>
            + Create battle
          </div>

          <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.muted, marginBottom: '4px', letterSpacing: '.05em', textTransform: 'uppercase' }}>
            Stake (token units)
          </label>
          <input
            style={{ ...input, marginBottom: '10px' }}
            type="number"
            min="1"
            value={stakeInput}
            onChange={(e) => setStakeInput(e.target.value)}
            placeholder="e.g. 1000000 (1 USDC = 1e6 lamports)"
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.muted, marginBottom: '4px', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                Min ELO (opt.)
              </label>
              <input
                style={input}
                type="number"
                value={minEloInput}
                onChange={(e) => setMinEloInput(e.target.value)}
                placeholder="No limit"
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '11px', fontWeight: 700, color: COLORS.muted, marginBottom: '4px', letterSpacing: '.05em', textTransform: 'uppercase' }}>
                Max ELO (opt.)
              </label>
              <input
                style={input}
                type="number"
                value={maxEloInput}
                onChange={(e) => setMaxEloInput(e.target.value)}
                placeholder="No limit"
              />
            </div>
          </div>

          {createError && (
            <div style={{ color: COLORS.red, fontSize: '12px', marginBottom: '10px', lineHeight: 1.4 }}>
              {createError}
            </div>
          )}
          {createSuccess && (
            <div style={{ color: COLORS.green, fontSize: '12px', marginBottom: '10px', lineHeight: 1.4 }}>
              {createSuccess}
            </div>
          )}

          <motion.button
            onClick={() => void handleCreate()}
            disabled={creating}
            whileTap={reduced ? undefined : { scale: 0.96 }}
            style={{
              ...btnBase,
              width: '100%',
              background: creating ? COLORS.border : GRADIENT,
              color: creating ? COLORS.muted : '#fff',
              padding: '14px',
              fontSize: '14px',
              boxShadow: creating ? 'none' : SHADOW.glow(COLORS.green),
              cursor: creating ? 'default' : 'pointer',
            }}
          >
            {creating ? 'Creating...' : 'Create on-chain battle'}
          </motion.button>
        </div>

        {/* ── Open matches ────────────────────────── */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ fontSize: '14px', fontWeight: 800 }}>Open matches</div>
            <button
              onClick={() => void loadMatches()}
              style={{ ...btnBase, background: COLORS.panel, color: COLORS.muted, padding: '6px 10px', fontSize: '11px', border: `1px solid ${COLORS.border}` }}
            >
              Refresh
            </button>
          </div>

          {matchError && (
            <div style={{ color: COLORS.red, fontSize: '12px', marginBottom: '10px' }}>
              {matchError}
            </div>
          )}

          {loadingMatches && (
            <div style={{ color: COLORS.muted, fontSize: '13px', textAlign: 'center', padding: '24px' }}>
              Loading matches...
            </div>
          )}

          {!loadingMatches && matches.length === 0 && (
            <div
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '8px',
                padding: '20px',
                textAlign: 'center',
                color: COLORS.muted,
                fontSize: '13px',
                boxShadow: SHADOW.panel,
              }}
            >
              No open matches. Create the first one.
            </div>
          )}

          {joinError && (
            <div
              style={{
                background: '#300a0f',
                border: `1px solid ${COLORS.red}`,
                color: COLORS.red,
                borderRadius: '8px',
                padding: '10px 12px',
                fontSize: '12px',
                marginBottom: '10px',
                lineHeight: 1.4,
              }}
            >
              Join error: {joinError}
            </div>
          )}

          {matches.map((m) => {
            const isMe = publicKey != null && m.player_a === publicKey.toBase58()
            const joining = joiningBattle === m.battle_pubkey
            return (
              <div
                key={m.battle_pubkey}
                style={{
                  background: COLORS.panel,
                  border: `1px solid ${m.joinable && !isMe ? `${COLORS.green}44` : COLORS.border}`,
                  borderRadius: '10px',
                  padding: '14px 16px',
                  marginBottom: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  boxShadow: SHADOW.panel,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '11px', fontFamily: 'monospace', color: COLORS.muted, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.battle_pubkey}
                  </div>
                  <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '12px' }}>
                    <span>
                      <span style={{ color: COLORS.muted }}>Stake: </span>
                      <span style={{ color: COLORS.text, fontWeight: 700 }}>{m.stake}</span>
                    </span>
                    <span>
                      <span style={{ color: COLORS.muted }}>Creator ELO: </span>
                      <span style={{ color: COLORS.text, fontWeight: 700 }}>{m.elo_a}</span>
                    </span>
                    {m.elo_diff != null && (
                      <span>
                        <span style={{ color: COLORS.muted }}>Level gap: </span>
                        <span style={{ color: Math.abs(m.elo_diff) > 200 ? COLORS.red : COLORS.green, fontWeight: 700 }}>
                          {m.elo_diff > 0 ? '+' : ''}{m.elo_diff}
                        </span>
                      </span>
                    )}
                    {m.gap_label && (
                      <span style={{ color: COLORS.muted, fontStyle: 'italic' }}>{m.gap_label}</span>
                    )}
                    {(m.min_elo !== null || m.max_elo !== null) && (
                      <span style={{ color: COLORS.muted }}>
                        [{m.min_elo ?? '—'} – {m.max_elo ?? '—'}]
                      </span>
                    )}
                  </div>
                </div>

                <div style={{ flexShrink: 0 }}>
                  {isMe ? (
                    <span style={{ fontSize: '11px', color: COLORS.green, fontWeight: 700 }}>My match</span>
                  ) : m.joinable ? (
                    <motion.button
                      onClick={() => void handleJoin(m)}
                      disabled={joining}
                      whileTap={reduced ? undefined : { scale: 0.95 }}
                      style={{
                        ...btnBase,
                        background: joining ? COLORS.border : COLORS.violet,
                        color: joining ? COLORS.muted : '#fff',
                        boxShadow: joining ? 'none' : SHADOW.glow(COLORS.violet),
                        cursor: joining ? 'default' : 'pointer',
                      }}
                    >
                      {joining ? 'Joining...' : 'Join'}
                    </motion.button>
                  ) : (
                    <span style={{ fontSize: '11px', color: COLORS.muted }}>Not joinable</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
