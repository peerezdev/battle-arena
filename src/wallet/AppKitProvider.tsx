import type { ReactNode } from 'react'
import { createAppKit } from '@reown/appkit/react'
import { SolanaAdapter } from '@reown/appkit-adapter-solana/react'
import { solanaDevnet } from '@reown/appkit/networks'
import { config } from '../onchain/config'

// Initialize AppKit once at module scope.
// If reownProjectId is empty, AppKit will warn at runtime — that's fine; the user sets the env.
createAppKit({
  adapters: [new SolanaAdapter()],
  networks: [solanaDevnet],
  projectId: config.reownProjectId,
  metadata: {
    name: 'Battle Arena',
    description: 'TCG Battle Arena',
    url: typeof window !== 'undefined' ? window.location.origin : 'https://battlearena.app',
    icons: [],
  },
})

interface AppKitProviderProps {
  children: ReactNode
}

// AppKit's createAppKit sets up the global modal at module scope above.
// This component just renders children; it exists so downstream tasks can
// wrap the tree with <AppKitProvider> without any further setup.
export function AppKitProvider({ children }: AppKitProviderProps): ReactNode {
  return children
}
