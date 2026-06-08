// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Keypair, PublicKey } from '@solana/web3.js'
import { discriminator } from './discriminators'
import {
  buildCommitIx, buildResolveRoundIx, buildRevealIx,
  buildInitializeBattleIxs, buildJoinBattleIxs,
  buildSettleIx, buildClaimTimeoutIx,
} from './instructions'
import { battlePda, vaultPda } from './pdas'
import type { MatchConfig } from './types'

describe('discriminators', () => {
  it('cada instrucción del IDL tiene discriminador de 8 bytes', () => {
    for (const n of ['initialize_battle', 'join_battle', 'commit', 'reveal', 'resolve_round', 'settle', 'claim_timeout']) {
      expect(discriminator(n).length).toBe(8)
    }
  })
})

describe('instructions (sencillas, sin args complejos)', () => {
  const battle = new PublicKey('11111111111111111111111111111111')
  const player = new PublicKey('11111111111111111111111111111111')

  it('commit: discriminador + 32 bytes de hash', () => {
    const hash = new Uint8Array(32).fill(7)
    const ix = buildCommitIx({ battle, player, commit: hash })
    expect(ix.programId.toBase58()).toMatch(/.+/)
    expect(ix.data.subarray(0, 8).equals(discriminator('commit'))).toBe(true)
    expect(ix.data.length).toBe(8 + 32)
    expect(ix.data.subarray(8).equals(Buffer.from(hash))).toBe(true)
  })

  it('resolve_round: solo discriminador (sin args)', () => {
    const ix = buildResolveRoundIx({ battle })
    expect(ix.data.equals(discriminator('resolve_round'))).toBe(true)
  })

  it('reveal: discriminador de 8 bytes', () => {
    const ix = buildRevealIx({
      battle, player,
      alloc: { apertura: 3, choque: 4, remate: 3 },
      salt: 'test-salt',
    })
    expect(ix.data.subarray(0, 8).equals(discriminator('reveal'))).toBe(true)
    expect(ix.data.length).toBeGreaterThan(8)
  })

  it('settle: discriminador de 8 bytes', () => {
    const ix = buildSettleIx({
      battle,
      escrowVault: player,
      playerAToken: player,
      playerBToken: player,
      treasury: player,
    })
    expect(ix.data.equals(discriminator('settle'))).toBe(true)
  })

  it('claim_timeout: discriminador de 8 bytes', () => {
    const ix = buildClaimTimeoutIx({ battle })
    expect(ix.data.equals(discriminator('claim_timeout'))).toBe(true)
  })

  it('initialize_battle devuelve [ed25519Ix, programIx]', () => {
    const stakeMint = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
    const cfg: MatchConfig = { roundsToWin: 2, baseEnergy: 10, maxEdge: 4, valueRatioCap: 4, maxRounds: 5, rakeBps: 0, edgeEnabled: true }
    const [ed25519Ix, programIx] = buildInitializeBattleIxs({
      playerA: player,
      stakeMint,
      playerAToken: player,
      nftTokenA: player,
      nonce: 1n,
      stake: 1000n,
      cfg,
      oracle: player,
      treasury: player,
      nftMintA: player,
      valueUsdA: 1200n,
      gradeA: 9,
      tsA: BigInt(1700000000),
      messageHex: '00'.repeat(48),
      signatureHex: '00'.repeat(64),
    })
    expect(ed25519Ix.programId.toBase58()).toContain('Ed25519')
    expect(programIx.data.subarray(0, 8).equals(discriminator('initialize_battle'))).toBe(true)
  })

  it('join_battle devuelve [ed25519Ix, programIx]', () => {
    const [ed25519Ix, programIx] = buildJoinBattleIxs({
      playerB: player,
      battle,
      playerBToken: player,
      nftTokenB: player,
      oracle: player,
      nftMintB: player,
      valueUsdB: 800n,
      gradeB: 7,
      tsB: BigInt(1700000000),
      messageHex: '00'.repeat(48),
      signatureHex: '00'.repeat(64),
    })
    expect(ed25519Ix.programId.toBase58()).toContain('Ed25519')
    expect(programIx.data.subarray(0, 8).equals(discriminator('join_battle'))).toBe(true)
  })
})

// ──────────────────────────────────────────────────────────
// Account-list tests — catch BUG 1 and BUG 2
// ──────────────────────────────────────────────────────────

describe('initialize_battle: account list', () => {
  const playerA = Keypair.generate().publicKey
  const oracle  = Keypair.generate().publicKey
  const stakeMint = Keypair.generate().publicKey
  const playerAToken = Keypair.generate().publicKey
  const nftTokenA  = Keypair.generate().publicKey
  const nonce = 42n
  const cfg: MatchConfig = { roundsToWin: 2, baseEnergy: 10, maxEdge: 4, valueRatioCap: 4, maxRounds: 5, rakeBps: 0, edgeEnabled: true }

  const [expectedBattle]      = battlePda(playerA, nonce)
  const [expectedVault]       = vaultPda(expectedBattle)

  const [, programIx] = buildInitializeBattleIxs({
    playerA,
    stakeMint,
    playerAToken,
    nftTokenA,
    nonce,
    stake: 1000n,
    cfg,
    oracle,
    treasury: Keypair.generate().publicKey,
    nftMintA: Keypair.generate().publicKey,
    valueUsdA: 1200n,
    gradeA: 9,
    tsA: BigInt(1700000000),
    messageHex: '00'.repeat(48),
    signatureHex: '00'.repeat(64),
  })

  it('devuelve exactamente 10 cuentas', () => {
    expect(programIx.keys.length).toBe(10)
  })

  it('slot [1] es la PDA battle derivada internamente', () => {
    expect(programIx.keys[1].pubkey.toBase58()).toBe(expectedBattle.toBase58())
  })

  it('slot [3] es la PDA vault derivada internamente', () => {
    expect(programIx.keys[3].pubkey.toBase58()).toBe(expectedVault.toBase58())
  })

  it('la ix Ed25519 embebe el pubkey del ORÁCULO (no de playerA)', () => {
    const [ed25519Ix] = buildInitializeBattleIxs({
      playerA,
      stakeMint,
      playerAToken,
      nftTokenA,
      nonce,
      stake: 1000n,
      cfg,
      oracle,
      treasury: Keypair.generate().publicKey,
      nftMintA: Keypair.generate().publicKey,
      valueUsdA: 1200n,
      gradeA: 9,
      tsA: BigInt(1700000000),
      messageHex: '00'.repeat(48),
      signatureHex: '00'.repeat(64),
    })
    const data = Buffer.from(ed25519Ix.data)
    const pubkeyOffset = data.readUInt16LE(6)
    const embeddedPubkey = data.subarray(pubkeyOffset, pubkeyOffset + 32)
    expect(Buffer.from(embeddedPubkey).equals(Buffer.from(oracle.toBytes()))).toBe(true)
  })

  it('playerA es signer+writable en [0]; battle writable no-signer en [1]; vault writable no-signer en [3]', () => {
    expect(programIx.keys[0].isSigner).toBe(true)
    expect(programIx.keys[0].isWritable).toBe(true)
    expect(programIx.keys[1].isSigner).toBe(false)
    expect(programIx.keys[1].isWritable).toBe(true)
    expect(programIx.keys[3].isSigner).toBe(false)
    expect(programIx.keys[3].isWritable).toBe(true)
  })
})

describe('join_battle: account list', () => {
  const playerB      = Keypair.generate().publicKey
  const oracle       = Keypair.generate().publicKey
  const battle       = Keypair.generate().publicKey  // pubkey known from lobby
  const playerBToken = Keypair.generate().publicKey
  const nftTokenB    = Keypair.generate().publicKey

  const [expectedVault] = vaultPda(battle)

  const [ed25519Ix, programIx] = buildJoinBattleIxs({
    playerB,
    battle,
    playerBToken,
    nftTokenB,
    oracle,
    nftMintB: Keypair.generate().publicKey,
    valueUsdB: 800n,
    gradeB: 7,
    tsB: BigInt(1700000000),
    messageHex: '00'.repeat(48),
    signatureHex: '00'.repeat(64),
  })

  it('devuelve exactamente 7 cuentas', () => {
    expect(programIx.keys.length).toBe(7)
  })

  it('slot [1] es la battle pubkey del lobby', () => {
    expect(programIx.keys[1].pubkey.toBase58()).toBe(battle.toBase58())
  })

  it('slot [2] es la PDA vault derivada de la battle', () => {
    expect(programIx.keys[2].pubkey.toBase58()).toBe(expectedVault.toBase58())
  })

  it('la ix Ed25519 embebe el pubkey del ORÁCULO (no de playerB)', () => {
    const data = Buffer.from(ed25519Ix.data)
    const pubkeyOffset = data.readUInt16LE(6)
    const embeddedPubkey = data.subarray(pubkeyOffset, pubkeyOffset + 32)
    // Must equal oracle, must NOT equal playerB
    expect(Buffer.from(embeddedPubkey).equals(Buffer.from(oracle.toBytes()))).toBe(true)
    expect(Buffer.from(embeddedPubkey).equals(Buffer.from(playerB.toBytes()))).toBe(false)
  })

  it('playerB es signer+writable en [0]; battle writable no-signer en [1]; vault writable no-signer en [2]', () => {
    expect(programIx.keys[0].isSigner).toBe(true)
    expect(programIx.keys[0].isWritable).toBe(true)
    expect(programIx.keys[1].isSigner).toBe(false)
    expect(programIx.keys[1].isWritable).toBe(true)
    expect(programIx.keys[2].isSigner).toBe(false)
    expect(programIx.keys[2].isWritable).toBe(true)
  })
})
