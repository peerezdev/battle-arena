/**
 * Instruction builders for the BattleArena on-chain program.
 *
 * Arg encoding: @coral-xyz/anchor BorshCoder (Anchor 0.32.1) with BN for u64/i64/u32.
 * The coder prepends the 8-byte discriminator from the IDL automatically.
 * u64/i64 → BN; u32 → number; u8/bool → number/boolean; pubkey → PublicKey.
 */
import { PublicKey, TransactionInstruction, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import { BorshCoder, BN } from '@coral-xyz/anchor'
import idl from './idl/battle_arena.json'
import { PROGRAM_ID } from './types'
import { buildEd25519Ix } from './attestation'
import type { MatchConfig, Allocation } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const coder = new BorshCoder(idl as any)

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111')
const RENT_SYSVAR_ID = new PublicKey('SysvarRent111111111111111111111111111111111')

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function encodedData(ixName: string, args: Record<string, unknown>): Buffer {
  return Buffer.from(coder.instruction.encode(ixName, args))
}

function matchConfigToAnchor(cfg: MatchConfig) {
  return {
    rounds_to_win: cfg.roundsToWin,
    base_energy: cfg.baseEnergy,
    max_edge: cfg.maxEdge,
    value_ratio_cap: cfg.valueRatioCap,
    max_rounds: cfg.maxRounds,
    rake_bps: cfg.rakeBps,
    edge_enabled: cfg.edgeEnabled,
  }
}

function allocToAnchor(alloc: Allocation) {
  return { apertura: alloc.apertura, choque: alloc.choque, remate: alloc.remate }
}

// ──────────────────────────────────────────────────────────
// commit
// ──────────────────────────────────────────────────────────

export function buildCommitIx(a: {
  battle: PublicKey
  player: PublicKey
  commit: Uint8Array
}): TransactionInstruction {
  // disc(8) + [u8;32] hash — built manually for explicitness; discriminator from IDL.
  const data = Buffer.concat([
    Buffer.from(idl.instructions.find(i => i.name === 'commit')!.discriminator),
    Buffer.from(a.commit),
  ])
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: a.player, isSigner: true, isWritable: false },
      { pubkey: a.battle, isSigner: false, isWritable: true },
    ],
    data,
  })
}

// ──────────────────────────────────────────────────────────
// resolve_round
// ──────────────────────────────────────────────────────────

export function buildResolveRoundIx(a: { battle: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: a.battle, isSigner: false, isWritable: true }],
    data: encodedData('resolve_round', {}),
  })
}

// ──────────────────────────────────────────────────────────
// reveal
// ──────────────────────────────────────────────────────────

export function buildRevealIx(a: {
  battle: PublicKey
  player: PublicKey
  alloc: Allocation
  salt: string
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: a.player, isSigner: true, isWritable: false },
      { pubkey: a.battle, isSigner: false, isWritable: true },
    ],
    data: encodedData('reveal', { alloc: allocToAnchor(a.alloc), salt: a.salt }),
  })
}

// ──────────────────────────────────────────────────────────
// settle
// ──────────────────────────────────────────────────────────

export function buildSettleIx(a: {
  battle: PublicKey
  escrowVault: PublicKey
  playerAToken: PublicKey
  playerBToken: PublicKey
  treasury: PublicKey
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: a.battle, isSigner: false, isWritable: true },
      { pubkey: a.escrowVault, isSigner: false, isWritable: true },
      { pubkey: a.playerAToken, isSigner: false, isWritable: true },
      { pubkey: a.playerBToken, isSigner: false, isWritable: true },
      { pubkey: a.treasury, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodedData('settle', {}),
  })
}

// ──────────────────────────────────────────────────────────
// claim_timeout
// ──────────────────────────────────────────────────────────

export function buildClaimTimeoutIx(a: { battle: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: a.battle, isSigner: false, isWritable: true }],
    data: encodedData('claim_timeout', {}),
  })
}

// ──────────────────────────────────────────────────────────
// initialize_battle — devuelve [ed25519Ix, programIx]
// ──────────────────────────────────────────────────────────

export function buildInitializeBattleIxs(a: {
  playerA: PublicKey
  stakeMint: PublicKey
  escrowVault: PublicKey
  playerAToken: PublicKey
  nftTokenA: PublicKey
  nonce: bigint
  stake: bigint
  cfg: MatchConfig
  oracle: PublicKey
  treasury: PublicKey
  nftMintA: PublicKey
  valueUsdA: bigint
  gradeA: number
  tsA: bigint
  messageHex: string
  signatureHex: string
}): [TransactionInstruction, TransactionInstruction] {
  const ed25519Ix = buildEd25519Ix(a.messageHex, a.signatureHex, a.oracle.toBase58())
  const data = encodedData('initialize_battle', {
    nonce: new BN(a.nonce.toString()),
    stake: new BN(a.stake.toString()),
    cfg: matchConfigToAnchor(a.cfg),
    oracle: a.oracle,
    treasury: a.treasury,
    nft_mint_a: a.nftMintA,
    value_usd_a: new BN(a.valueUsdA.toString()),
    grade_a: a.gradeA,
    ts_a: new BN(a.tsA.toString()),
    ed25519_ix_index: 0,
  })
  const programIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: a.playerA, isSigner: true, isWritable: true },
      { pubkey: a.escrowVault, isSigner: false, isWritable: true },
      { pubkey: a.stakeMint, isSigner: false, isWritable: false },
      { pubkey: a.escrowVault, isSigner: false, isWritable: true },
      { pubkey: a.playerAToken, isSigner: false, isWritable: true },
      { pubkey: a.nftTokenA, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_SYSVAR_ID, isSigner: false, isWritable: false },
    ],
    data,
  })
  return [ed25519Ix, programIx]
}

// ──────────────────────────────────────────────────────────
// join_battle — devuelve [ed25519Ix, programIx]
// ──────────────────────────────────────────────────────────

export function buildJoinBattleIxs(a: {
  playerB: PublicKey
  battle: PublicKey
  escrowVault: PublicKey
  playerBToken: PublicKey
  nftTokenB: PublicKey
  nftMintB: PublicKey
  valueUsdB: bigint
  gradeB: number
  tsB: bigint
  messageHex: string
  signatureHex: string
}): [TransactionInstruction, TransactionInstruction] {
  const ed25519Ix = buildEd25519Ix(a.messageHex, a.signatureHex, a.playerB.toBase58())
  const data = encodedData('join_battle', {
    nft_mint_b: a.nftMintB,
    value_usd_b: new BN(a.valueUsdB.toString()),
    grade_b: a.gradeB,
    ts_b: new BN(a.tsB.toString()),
    ed25519_ix_index: 0,
  })
  const programIx = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: a.playerB, isSigner: true, isWritable: true },
      { pubkey: a.battle, isSigner: false, isWritable: true },
      { pubkey: a.escrowVault, isSigner: false, isWritable: true },
      { pubkey: a.playerBToken, isSigner: false, isWritable: true },
      { pubkey: a.nftTokenB, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_INSTRUCTIONS_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  })
  return [ed25519Ix, programIx]
}
