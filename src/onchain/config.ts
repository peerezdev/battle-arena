/**
 * FIX C (HIGH-2): Warn/throw if oracle or backend URLs use http:// for non-localhost origins.
 * Runs at module load time so misconfiguration is caught early.
 */
function assertSecureUrl(label: string, url: string): void {
  if (!url.startsWith('http://')) return
  try {
    const { hostname } = new URL(url)
    if (hostname === 'localhost' || hostname === '127.0.0.1') return
  } catch {
    return // unparseable URL — let it fail elsewhere
  }
  const msg = `[config] SECURITY: ${label} uses http:// for a non-localhost origin: "${url}". Use https:// in production.`
  if (import.meta.env.PROD) {
    throw new Error(msg)
  } else {
    console.error(msg)
  }
}

const oracleUrl = import.meta.env.VITE_ORACLE_URL ?? 'http://localhost:8787'
const backendUrl = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080'

assertSecureUrl('VITE_ORACLE_URL', oracleUrl)
assertSecureUrl('VITE_BACKEND_URL', backendUrl)

export const config = {
  rpcUrl: import.meta.env.VITE_SOLANA_RPC ?? 'https://api.devnet.solana.com',
  programId: import.meta.env.VITE_PROGRAM_ID ?? '89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk',
  oracleUrl,
  backendUrl,
  /**
   * USDC (or any SPL token) mint used as the battle stake token.
   * On devnet this is usually 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (USDC devnet faucet).
   * Set VITE_STAKE_MINT in your .env file.
   */
  stakeMint: import.meta.env.VITE_STAKE_MINT ?? '',
  /**
   * Treasury token account that receives the protocol rake.
   * Set VITE_TREASURY in your .env file (base-58 public key).
   */
  treasury: import.meta.env.VITE_TREASURY ?? '',
  /**
   * FIX B (HIGH-1): Pin the oracle pubkey. When set, LobbyScreen asserts the oracle's
   * self-reported pubkey matches this value and rejects attestations from unknown oracles.
   * Set VITE_ORACLE_PUBKEY in your .env file (base-58 public key of the trusted oracle).
   */
  oraclePubkey: import.meta.env.VITE_ORACLE_PUBKEY ?? '',
}
