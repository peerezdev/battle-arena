import { PublicKey } from '@solana/web3.js'
import { PROGRAM_ID } from './types'

export function battlePda(playerA: PublicKey, nonce: bigint): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8)
  nonceBuf.writeBigUInt64LE(nonce)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('battle'), playerA.toBuffer(), nonceBuf], PROGRAM_ID,
  )
}

export function vaultPda(battle: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), battle.toBuffer()], PROGRAM_ID)
}
