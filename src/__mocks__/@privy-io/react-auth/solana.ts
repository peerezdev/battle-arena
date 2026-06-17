// Mock del subpath @privy-io/react-auth/solana para tests unitarios.
// Solo necesita exportar los símbolos que importa useUsdcBalance.ts.
import { vi } from 'vitest'

export const useWallets = vi.fn(() => ({ wallets: [], ready: false }))
export const toSolanaWalletConnectors = vi.fn(() => [])
