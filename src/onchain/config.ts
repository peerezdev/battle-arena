export const config = {
  rpcUrl: import.meta.env.VITE_SOLANA_RPC ?? 'https://api.devnet.solana.com',
  programId: import.meta.env.VITE_PROGRAM_ID ?? '89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk',
  oracleUrl: import.meta.env.VITE_ORACLE_URL ?? 'http://localhost:8787',
  backendUrl: import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080',
  reownProjectId: import.meta.env.VITE_REOWN_PROJECT_ID ?? '',
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
}
