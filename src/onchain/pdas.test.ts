// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { battlePda, vaultPda } from './pdas'
import { PROGRAM_ID } from './types'

describe('pdas', () => {
  const playerA = new PublicKey('11111111111111111111111111111111')

  it('battlePda usa seeds [battle, player_a, nonce_le] y casa con findProgramAddress', () => {
    const nonce = 1n
    const [pda] = battlePda(playerA, nonce)
    const nonceBuf = Buffer.alloc(8); nonceBuf.writeBigUInt64LE(nonce)
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('battle'), playerA.toBuffer(), nonceBuf], PROGRAM_ID,
    )
    expect(pda.equals(expected)).toBe(true)
  })

  it('vaultPda usa seeds [vault, battle]', () => {
    const [battle] = battlePda(playerA, 1n)
    const [vault] = vaultPda(battle)
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from('vault'), battle.toBuffer()], PROGRAM_ID)
    expect(vault.equals(expected)).toBe(true)
  })
})
