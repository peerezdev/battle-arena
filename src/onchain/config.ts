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
// Sin variable, el MISMO ORIGEN que sirve la página. Es como funciona en los tres entornos: en dev
// lo enruta el proxy de vite.config.ts y en producción Caddy, ambos hacia el backend real. El valor
// que había aquí, http://localhost:8080, no acertaba en ninguno — ese puerto no lo escucha nadie,
// así que un clon sin .env fallaba sin decir por qué.
//
// Se usa el origen y no una cadena vacía a propósito: useServerEvents construye el WebSocket con
// `backendUrl.replace(/^http/, 'ws')`, y con cadena vacía saldría `new WebSocket('/ws/chat')`, que
// depende de que el navegador resuelva URLs relativas. Con el origen sale un ws:// absoluto.
const backendUrl =
  import.meta.env.VITE_BACKEND_URL ??
  (typeof window !== 'undefined' ? window.location.origin : '')
const dasRpcUrl =
  (import.meta.env.VITE_DAS_RPC as string | undefined) ??
  (import.meta.env.VITE_SOLANA_RPC as string | undefined) ??
  'https://api.devnet.solana.com'

assertSecureUrl('VITE_ORACLE_URL', oracleUrl)
assertSecureUrl('VITE_BACKEND_URL', backendUrl)
assertSecureUrl('VITE_DAS_RPC', dasRpcUrl)

export const config = {
  /**
   * ¿Estamos en devnet? Habilita lo que solo tiene sentido probando: rellenar una sala con bots,
   * por ejemplo.
   *
   * Se deduce del MODE de Vite y no de una variable nueva a propósito: `--mode mainnet` es ya el
   * interruptor que decide qué .env se carga (lo usa el dev server y también deploy.sh al construir),
   * así que esto no puede desincronizarse de la red real. Mirar la URL del RPC sería frágil — un RPC
   * propio no tiene por qué llevar "devnet" en el nombre.
   *
   * La polaridad importa: solo la build EXPLÍCITA de mainnet cuenta como mainnet. Si alguien
   * construye olvidándose del flag, tampoco carga .env.mainnet, así que ambas cosas fallan juntas
   * en vez de dar una app de mainnet con botones de prueba.
   */
  isDevnet: import.meta.env.MODE !== 'mainnet',
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
  /**
   * Collector Crypt verified collection mint (DAS `grouping` group_value). Used to
   * filter the on-chain inventory to CC cards only. Defaults to the known mainnet
   * collection; override with the devnet collection when available.
   */
  ccCollectionMint:
    import.meta.env.VITE_CC_COLLECTION_MINT ?? 'CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf',
  /**
   * Todas las colecciones de Collector Crypt. CC usa una por estándar de NFT: la clásica para
   * los SPL y `CCryptUfe…` para los Metaplex Core. El inventario mira las dos; con solo la
   * primera, las cartas Core eran invisibles aunque estuvieran en la wallet.
   */
  ccCollectionMints: [
    import.meta.env.VITE_CC_COLLECTION_MINT ?? 'CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf',
    import.meta.env.VITE_CC_CORE_COLLECTION_MINT ?? 'CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac',
  ] as const,
  /**
   * DAS-capable RPC (e.g. Helius) for reading NFTs via getAssetsByOwner. Falls back
   * to the regular Solana RPC (public devnet does not support DAS → empty inventory).
   */
  dasRpcUrl,
  /**
   * Host de Collector Crypt que sirve la imagen frontal de una carta por mint. Es POR RED
   * (devnet: nft-dev…; mainnet: nft…) — con el de devnet, un mint de mainnet da 404 y la carta
   * sale sin imagen. Espejo del CC_NFT_BASE_URL del backend. env: VITE_CC_NFT_BASE
   */
  ccNftBase: ((import.meta.env.VITE_CC_NFT_BASE as string | undefined) ??
    'https://nft-dev.collectorcrypt.com').replace(/\/+$/, ''),
  /**
   * Launch-week gate: wallets allowed to CREATE Battle Royale lobbies (Privy embedded
   * Solana addresses, comma-separated). Empty = open to everyone. Must mirror the backend
   * ROYALE_CREATOR_ALLOWLIST. env: VITE_ROYALE_CREATOR_ALLOWLIST
   */
  royaleCreatorAllowlist: ((import.meta.env.VITE_ROYALE_CREATOR_ALLOWLIST as string | undefined) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
}

/** Pure: may this wallet create a Battle Royale, given the allowlist? Empty allowlist = open. */
export function isRoyaleCreator(wallet: string | null | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true
  return !!wallet && allowlist.includes(wallet)
}

/** Bound to the configured allowlist. False while the wallet is still loading (fail-closed). */
export function canCreateRoyale(wallet: string | null | undefined): boolean {
  return isRoyaleCreator(wallet, config.royaleCreatorAllowlist)
}
