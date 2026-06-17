import { usePrivy } from '@privy-io/react-auth'
import { useWallets } from '@privy-io/react-auth/solana'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import type { TransactionInstruction } from '@solana/web3.js'
import bs58 from 'bs58'
import { Buffer } from 'buffer'
import { config } from '../onchain/config'

export interface WalletApi {
  publicKey: PublicKey | null
  isConnected: boolean
  connect: () => void
  /** Build a legacy Transaction from the given instructions, set blockhash + feePayer, sign and send via Privy. Returns the signature string. */
  signAndSendTransaction: (ixs: TransactionInstruction[]) => Promise<string>
  /** Sign an arbitrary message for backend auth. Returns the signature bytes. */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
  /** Sign a pre-built (partially signed) base64 transaction without sending. Returns the fully signed tx re-serialized as base64. */
  signTransactionBase64: (txBase64: string) => Promise<string>
}

/**
 * Derive a Solana Wallet Standard chain identifier from the configured RPC URL.
 * Defaults to 'solana:devnet' when the URL contains 'devnet', 'mainnet' for mainnet-beta,
 * 'testnet' for testnet, and 'devnet' for anything else (localhost, custom RPCs).
 */
function deriveChain(): `solana:${'mainnet' | 'devnet' | 'testnet'}` {
  const rpc = config.rpcUrl.toLowerCase()
  if (rpc.includes('mainnet')) return 'solana:mainnet'
  if (rpc.includes('testnet')) return 'solana:testnet'
  return 'solana:devnet'
}

export function useWallet(): WalletApi {
  // -- Account / connection state ----------------------------------------------------------
  const { authenticated, login } = usePrivy()
  const { wallets } = useWallets()
  const wallet = wallets[0] ?? null

  // Map base-58 address string → PublicKey, or null when disconnected
  const publicKey: PublicKey | null = wallet ? new PublicKey(wallet.address) : null

  // -- Connection --------------------------------------------------------------------------
  const isConnected: boolean = authenticated && wallet !== null

  // -- Connect (opens Privy login modal) ---------------------------------------------------
  const connect = (): void => {
    void login()
  }

  // -- signAndSendTransaction --------------------------------------------------------------
  // Privy's signAndSendTransaction expects a serialized Uint8Array (Solana Wallet Standard).
  // It returns { signature: Uint8Array } where signature is the raw transaction signature
  // (32 bytes Ed25519) — we encode it to base58 for the caller.
  //
  // Confirmed from:
  //   node_modules/@privy-io/js-sdk-core/dist/dts/index.d.ts:3023
  //   node_modules/@privy-io/js-sdk-core/dist/dts/index.d.ts:2280-2289
  async function signAndSendTransaction(ixs: TransactionInstruction[]): Promise<string> {
    if (!isConnected || publicKey == null || wallet == null) {
      throw new Error('Wallet not connected')
    }

    const connection = new Connection(config.rpcUrl, 'confirmed')
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')

    const tx = new Transaction()
    tx.feePayer = publicKey
    tx.recentBlockhash = blockhash
    tx.add(...ixs)

    // Serialize without requiring signatures (wallet will sign)
    const serialized = tx.serialize({ requireAllSignatures: false })

    const chain = deriveChain()
    const { signature: sigBytes } = await wallet.signAndSendTransaction({
      transaction: serialized,
      chain,
    })

    // Privy returns signature as raw bytes; encode to base58 string
    const signature = bs58.encode(sigBytes)

    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')

    return signature
  }

  // -- signMessage -------------------------------------------------------------------------
  // Privy's signMessage expects { message: Uint8Array } and returns { signature: Uint8Array }.
  //
  // Confirmed from:
  //   node_modules/@privy-io/js-sdk-core/dist/dts/index.d.ts:3011
  //   node_modules/@privy-io/js-sdk-core/dist/dts/index.d.ts:2230-2251
  async function signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!isConnected || wallet == null) {
      throw new Error('Wallet not connected')
    }

    const { signature } = await wallet.signMessage({ message })
    return signature
  }

  // -- signTransactionBase64 ---------------------------------------------------------------
  // Privy's signTransaction expects { transaction: Uint8Array, chain? } and returns
  // { signedTransaction: Uint8Array } (the fully signed serialized transaction).
  //
  // Confirmed from:
  //   node_modules/@privy-io/js-sdk-core/dist/dts/index.d.ts:3017
  //   node_modules/@privy-io/js-sdk-core/dist/dts/index.d.ts:2253-2269
  async function signTransactionBase64(txBase64: string): Promise<string> {
    if (!isConnected || publicKey == null || wallet == null) {
      throw new Error('Wallet not connected')
    }

    const tx = Transaction.from(Buffer.from(txBase64, 'base64'))

    // Serialize without requiring all signatures (tx may be partially signed by server)
    const serialized = tx.serialize({ requireAllSignatures: false })

    const chain = deriveChain()
    const { signedTransaction } = await wallet.signTransaction({
      transaction: serialized,
      chain,
    })

    return Buffer.from(signedTransaction).toString('base64')
  }

  return { publicKey, isConnected, connect, signAndSendTransaction, signMessage, signTransactionBase64 }
}
