import type { ReactNode } from 'react'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit'

// Conectores de wallets externas de Solana (Phantom, Solflare, Backpack…).
// Sin esto Privy no detecta las wallets Solana inyectadas.
const solanaConnectors = toSolanaWalletConnectors()

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined

const SOLANA_RPC_URL =
  (import.meta.env.VITE_SOLANA_RPC as string | undefined) ??
  'https://api.devnet.solana.com'

// Derive the WebSocket URL from the HTTP RPC URL.
// e.g. https://api.devnet.solana.com → wss://api.devnet.solana.com
const SOLANA_WS_URL = SOLANA_RPC_URL.replace(/^https?:\/\//, (match) =>
  match.startsWith('https') ? 'wss://' : 'ws://',
)

export function AppPrivyProvider({ children }: { children: ReactNode }) {
  if (!APP_ID) {
    if (import.meta.env.DEV) {
      console.warn(
        'VITE_PRIVY_APP_ID no configurado: auth deshabilitada',
      )
    }
    return <>{children}</>
  }

  return (
    <PrivyProvider
      appId={APP_ID}
      config={{
        // Login methods: email OTP + external wallets (EVM and Solana)
        loginMethods: ['email', 'wallet'],

        // Show EVM and Solana wallets in the connect modal
        appearance: {
          theme: 'dark',
          // Solana violet as primary accent
          accentColor: '#9945FF',
          // Show both EVM and Solana wallets in the wallet connect modal
          walletChainType: 'ethereum-and-solana',
          // Botones de wallet a mostrar. Sin esto, Privy usa una lista por
          // defecto que incluye Phantom pero NO Backpack → no aparecía el botón.
          // `detected_solana_wallets` además lista cualquier wallet Solana
          // inyectada (Wallet Standard), p.ej. Backpack/Solflare.
          walletList: [
            'detected_solana_wallets',
            'phantom',
            'backpack',
            'solflare',
            'detected_ethereum_wallets',
            'metamask',
          ],
        },

        // Create a Solana embedded wallet for ALL users — incluso si conectan una
        // wallet externa (Phantom). La embedded es la wallet del juego (balance,
        // identidad on-chain, escrow no-exportable); la externa queda vinculada.
        embeddedWallets: {
          solana: {
            createOnLogin: 'all-users',
          },
        },

        // External Solana wallets (Phantom, etc.) — needed for detection
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },

        // Solana RPC configuration for devnet (required for embedded wallet UIs)
        solana: {
          rpcs: {
            'solana:devnet': {
              rpc: createSolanaRpc(SOLANA_RPC_URL),
              rpcSubscriptions: createSolanaRpcSubscriptions(SOLANA_WS_URL),
            },
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  )
}
