import { usePrivy, useHeadlessDelegatedActions } from '@privy-io/react-auth'

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
  const { delegateWallet } = useHeadlessDelegatedActions()
  const accounts = (user?.linkedAccounts ?? []) as unknown as AccountLike[]
  const delegated = isSolanaDelegated(accounts)
  const embedded = accounts.find(
    (a) => a.type === 'wallet' && a.chainType === 'solana' &&
      (a.walletClientType === 'privy' || a.connectorType === 'embedded') && a.address,
  )
  async function enable() {
    if (!embedded?.address) return
    await delegateWallet({ address: embedded.address, chainType: 'solana' })
  }
  return { delegated, enable }
}
