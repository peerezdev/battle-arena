import { usePrivy, useSigners } from '@privy-io/react-auth'

// Las embedded de esta app son TEE wallets → el acceso server-side se provisiona
// con session signers (useSigners().addSigners), NO con delegated-actions (que es
// solo on-device). El signerId es el id del key quorum registrado en el dashboard.
const SIGNER_ID = import.meta.env.VITE_PRIVY_SIGNER_ID as string | undefined

interface AccountLike {
  type?: string; chainType?: string; walletClientType?: string; connectorType?: string
  delegated?: boolean; address?: string
}

/** True iff the user has an embedded Solana wallet delegated to the app. */
export function isSolanaDelegated(accounts: AccountLike[]): boolean {
  return accounts.some(
    (a) => a.type === 'wallet' && a.chainType === 'solana' &&
      (a.walletClientType === 'privy' || a.connectorType === 'embedded') && a.delegated === true,
  )
}

export function useDelegation(): { delegated: boolean; enable: () => Promise<void> } {
  const { user } = usePrivy()
  const { addSigners } = useSigners()
  const accounts = (user?.linkedAccounts ?? []) as unknown as AccountLike[]
  const delegated = isSolanaDelegated(accounts)
  const embedded = accounts.find(
    (a) => a.type === 'wallet' && a.chainType === 'solana' &&
      (a.walletClientType === 'privy' || a.connectorType === 'embedded') && a.address,
  )
  async function enable() {
    if (!embedded?.address) throw new Error('No embedded Solana wallet found')
    if (!SIGNER_ID) throw new Error('VITE_PRIVY_SIGNER_ID no configurado')
    await addSigners({ address: embedded.address, signers: [{ signerId: SIGNER_ID }] })
  }
  return { delegated, enable }
}
