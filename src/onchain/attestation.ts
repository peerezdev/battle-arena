import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import bs58 from 'bs58'
import { ED25519_PROGRAM_ID } from './types'

const U16_MAX = 0xffff
const SIGNATURE_LEN = 64
const PUBKEY_LEN = 32

/** Instrucción del programa nativo Ed25519 para UNA firma, índices auto-referenciales (0xFFFF). */
export function buildEd25519Ix(messageHex: string, signatureHex: string, oraclePubkeyB58: string): TransactionInstruction {
  const message = Buffer.from(messageHex, 'hex')
  const signature = Buffer.from(signatureHex, 'hex')
  const pubkey = Buffer.from(bs58.decode(oraclePubkeyB58))

  const headerLen = 16
  const pubkeyOffset = headerLen
  const sigOffset = pubkeyOffset + PUBKEY_LEN
  const msgOffset = sigOffset + SIGNATURE_LEN

  const data = Buffer.alloc(msgOffset + message.length)
  data.writeUInt8(1, 0)               // num signatures
  data.writeUInt8(0, 1)               // padding
  data.writeUInt16LE(sigOffset, 2)    // signature_offset
  data.writeUInt16LE(U16_MAX, 4)      // signature_instruction_index
  data.writeUInt16LE(pubkeyOffset, 6) // public_key_offset
  data.writeUInt16LE(U16_MAX, 8)      // public_key_instruction_index
  data.writeUInt16LE(msgOffset, 10)   // message_data_offset
  data.writeUInt16LE(message.length, 12) // message_data_size
  data.writeUInt16LE(U16_MAX, 14)     // message_instruction_index

  pubkey.copy(data, pubkeyOffset)
  signature.copy(data, sigOffset)
  message.copy(data, msgOffset)

  return new TransactionInstruction({ programId: ED25519_PROGRAM_ID, keys: [], data })
}
