// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { discriminator } from './discriminators'
import {
  buildCommitIx, buildResolveRoundIx, buildRevealIx,
  buildInitializeBattleIxs, buildJoinBattleIxs,
  buildSettleIx, buildClaimTimeoutIx,
} from './instructions'
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
      escrowVault: battle,
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
      escrowVault: battle,
      playerBToken: player,
      nftTokenB: player,
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
