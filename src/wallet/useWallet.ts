import { useAppKit, useAppKitAccount, useAppKitProvider } from '@reown/appkit/react'
import { PublicKey, Transaction, Connection } from '@solana/web3.js'
import type { TransactionInstruction } from '@solana/web3.js'
import type { Provider as SolanaProvider } from '@reown/appkit-utils/solana'
import { config } from '../onchain/config'

export interface WalletApi {
  publicKey: PublicKey | null
  isConnected: boolean
  connect: () => void
  /** Build a legacy Transaction from the given instructions, set blockhash + feePayer, sign and send via AppKit. Returns the signature string. */
  signAndSendTransaction: (ixs: TransactionInstruction[]) => Promise<string>
  /** Sign an arbitrary message for backend auth. Returns the signature bytes. */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
}

export function useWallet(): WalletApi {
  // -- Account / connection state ----------------------------------------------------------
  // useAppKitAccount() returns { address: string | undefined, isConnected: boolean, ... }
  const { address, isConnected } = useAppKitAccount()

  // Map base-58 address string → PublicKey, or null when disconnected
  const publicKey: PublicKey | null =
    address != null && address.length > 0 ? new PublicKey(address) : null

  // -- Modal open --------------------------------------------------------------------------
  // useAppKit() returns { open, close }; open() opens the connect modal
  const { open } = useAppKit()
  const connect = (): void => {
    void open()
  }

  // -- Solana wallet provider --------------------------------------------------------------
  // useAppKitProvider<T>('solana') returns { walletProvider: T, walletProviderType }
  const { walletProvider } = useAppKitProvider<SolanaProvider>('solana')

  // -- signAndSendTransaction --------------------------------------------------------------
  async function signAndSendTransaction(ixs: TransactionInstruction[]): Promise<string> {
    if (!isConnected || publicKey == null) {
      throw new Error('Wallet not connected')
    }
    if (walletProvider == null) {
      throw new Error('Solana wallet provider not available')
    }

    const connection = new Connection(config.rpcUrl, 'confirmed')
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')

    const tx = new Transaction()
    tx.feePayer = publicKey
    tx.recentBlockhash = blockhash
    tx.add(...ixs)

    // SolanaProvider.signAndSendTransaction accepts an AnyTransaction and optional SendOptions
    const signature = await walletProvider.signAndSendTransaction(tx)

    // Wait for confirmation so callers get a finalized signature
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')

    return signature
  }

  // -- signMessage -------------------------------------------------------------------------
  async function signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!isConnected) {
      throw new Error('Wallet not connected')
    }
    if (walletProvider == null) {
      throw new Error('Solana wallet provider not available')
    }

    // SolanaProvider.signMessage(Uint8Array) → Promise<Uint8Array>
    return walletProvider.signMessage(message)
  }

  return { publicKey, isConnected, connect, signAndSendTransaction, signMessage }
}
