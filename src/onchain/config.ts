export const config = {
  rpcUrl: import.meta.env.VITE_SOLANA_RPC ?? 'https://api.devnet.solana.com',
  programId: import.meta.env.VITE_PROGRAM_ID ?? '89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk',
  oracleUrl: import.meta.env.VITE_ORACLE_URL ?? 'http://localhost:8787',
  backendUrl: import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080',
  reownProjectId: import.meta.env.VITE_REOWN_PROJECT_ID ?? '',
}
