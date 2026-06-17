import { usePrivy } from '@privy-io/react-auth'

interface WalletAccountLike {
  type?: string
  chainType?: string
  walletClientType?: string
  connectorType?: string
  address?: string
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
