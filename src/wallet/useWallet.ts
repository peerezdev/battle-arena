import { usePrivy, useIdentityToken } from '@privy-io/react-auth'
import { useWallets } from '@privy-io/react-auth/solana'
import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import type { TransactionInstruction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import { config } from '../onchain/config'
import { useEmbeddedSolanaAddress } from './embedded'
import { useDelegation } from './useDelegation'

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

export function useWallet(): WalletApi {
  // -- Account / connection state ----------------------------------------------------------
  const { authenticated, login } = usePrivy()
  const { identityToken } = useIdentityToken()
  const { delegated, enable } = useDelegation()
  const { wallets } = useWallets()
  // Firma/identidad SIEMPRE con la embedded (la wallet del juego), no wallets[0]
  // (que podría ser una externa conectada como Phantom).
  const embeddedAddress = useEmbeddedSolanaAddress()
  const wallet = wallets.find((w) => w.address === embeddedAddress) ?? null

  // Map base-58 address string → PublicKey, or null when disconnected
  const publicKey: PublicKey | null = embeddedAddress ? new PublicKey(embeddedAddress) : null

  // -- Connection --------------------------------------------------------------------------
  const isConnected: boolean = authenticated && wallet !== null

  // -- Connect (opens Privy login modal) ---------------------------------------------------
  const connect = (): void => {
    void login()
  }

  // -- Delegated signing -------------------------------------------------------------------
  // Once the wallet is delegated (session signer added), the backend signs on the user's behalf
  // so no action pops a wallet prompt. If not yet delegated, enable() prompts once (the "gate"),
  // then we proceed via the backend. Each backend call signs ONLY the authed user's own wallet.
  async function ensureDelegated(): Promise<void> {
    if (delegated) return
    try { await enable() } catch { /* if already added, the backend sign still succeeds */ }
  }

  async function backendSign(path: 'sign' | 'sign-submit', txBase64: string): Promise<string> {
    if (!identityToken) throw new Error('Log in to sign')
    const r = await fetch(`${config.backendUrl}/wallet/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identityToken}`, 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({ transaction: txBase64 }),
    })
    if (!r.ok) throw new Error(`${path} failed (${r.status})`)
    const d = await r.json()
    return (path === 'sign' ? d.signed_transaction : d.signature) as string
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

    // Serialize without requiring signatures (the server signs via the session signer).
    const serialized = tx.serialize({ requireAllSignatures: false })

    await ensureDelegated()
    const signature = await backendSign('sign-submit', Buffer.from(serialized).toString('base64'))

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

    // Serialize without requiring all signatures (tx may be partially signed by server/CC).
    const serialized = tx.serialize({ requireAllSignatures: false })

    await ensureDelegated()
    // Server adds the user's signature via the session signer; the caller submits as before.
    return backendSign('sign', Buffer.from(serialized).toString('base64'))
  }

  return { publicKey, isConnected, connect, signAndSendTransaction, signMessage, signTransactionBase64 }
}
