// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { Keypair } from '@solana/web3.js'
import nacl from 'tweetnacl'
import { buildEd25519Ix } from './attestation'
import { ED25519_PROGRAM_ID } from './types'
import vectors from '../../onchain/programs/battle_arena/tests/fixtures/attestation_vectors.json'

describe('buildEd25519Ix', () => {
  it('layout: programId ed25519, num_sigs=1, índices 0xFFFF, message embebido', () => {
    const kp = Keypair.generate()
    const message = Buffer.from('hola-atestacion')
    const sig = nacl.sign.detached(message, kp.secretKey)
    const ix = buildEd25519Ix(
      message.toString('hex'),
      Buffer.from(sig).toString('hex'),
      kp.publicKey.toBase58(),
    )
    expect(ix.programId.equals(ED25519_PROGRAM_ID)).toBe(true)
    const d = ix.data
    expect(d[0]).toBe(1) // num signatures
    // header u16 LE: pubkey_offset@6, pubkey_ix_index@8, msg_offset@10, msg_size@12, msg_ix_index@14, sig_ix_index@4
    const u16 = (o: number) => d.readUInt16LE(o)
    expect(u16(4)).toBe(0xffff)  // signature_instruction_index
    expect(u16(8)).toBe(0xffff)  // public_key_instruction_index
    expect(u16(14)).toBe(0xffff) // message_instruction_index
    const pkOff = u16(6), msgOff = u16(10), msgSize = u16(12)
    expect(d.subarray(pkOff, pkOff + 32).equals(Buffer.from(kp.publicKey.toBytes()))).toBe(true)
    expect(d.subarray(msgOff, msgOff + msgSize).equals(message)).toBe(true)
    expect(msgSize).toBe(message.length)
  })

  it('el message embebido casa con el vector de equivalencia compartido', () => {
    const v = (vectors as { message_hex: string }[])[0]
    const ix = buildEd25519Ix(v.message_hex, '00'.repeat(64), '11111111111111111111111111111111')
    const d = ix.data
    const msgOff = d.readUInt16LE(10), msgSize = d.readUInt16LE(12)
    expect(d.subarray(msgOff, msgOff + msgSize).toString('hex')).toBe(v.message_hex)
  })
})
