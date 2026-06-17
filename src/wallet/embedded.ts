import { usePrivy } from '@privy-io/react-auth'

interface WalletAccountLike {
  type?: string
  chainType?: string
  walletClientType?: string
  connectorType?: string
  address?: string
}

export interface LinkedSolanaWallet {
  address: string
  source: 'embedded' | 'connected'
}

/** Pure: classify all linked Solana wallets as embedded (Privy) or connected (external). */
export function pickLinkedSolanaWallets(accounts: WalletAccountLike[]): LinkedSolanaWallet[] {
  const out: LinkedSolanaWallet[] = []
  const seen = new Set<string>()
  for (const a of accounts) {
    if (a.type !== 'wallet' || a.chainType !== 'solana' || !a.address) continue
    if (seen.has(a.address)) continue
    seen.add(a.address)
    const isEmbedded = a.walletClientType === 'privy' || a.connectorType === 'embedded'
    out.push({ address: a.address, source: isEmbedded ? 'embedded' : 'connected' })
  }
  return out
}

/** All linked Solana wallets (embedded + connected) for the current user. */
export function useLinkedSolanaWallets(): LinkedSolanaWallet[] {
  const { user } = usePrivy()
  const accounts = (user?.linkedAccounts ?? []) as unknown as WalletAccountLike[]
  return pickLinkedSolanaWallets(accounts)
}

/**
 * Dirección de la embedded Solana wallet de Privy del usuario (la "wallet del
 * juego": balance, identidad on-chain, escrow). Se lee de `user.linkedAccounts`
 * — la cuenta tipo wallet con chainType 'solana' y cliente embebido de Privy —
 * coincidiendo con lo que el backend extrae del identity token. Devuelve null si
 * no hay usuario o aún no existe la embedded.
 *
 * IMPORTANTE: NO usar `useWallets()[0]`, que puede ser una wallet externa
 * conectada (p.ej. Phantom) y no la embedded.
 */
export function useEmbeddedSolanaAddress(): string | null {
  const { user } = usePrivy()
  const accounts = (user?.linkedAccounts ?? []) as unknown as WalletAccountLike[]
  for (const a of accounts) {
    if (
      a.type === 'wallet' &&
      a.chainType === 'solana' &&
      (a.walletClientType === 'privy' || a.connectorType === 'embedded') &&
      a.address
    ) {
      return a.address
    }
  }
  return null
}
