// Cliente fino del proxy /gacha/* del backend. La x-api-key vive en el
// backend; aquí solo viajan el token de sesión y datos públicos.
import { config } from './config'

export interface GachaMachine {
  code: string
  name: string
  price: number
  odds: Record<string, number>
  tierRanges?: Record<string, { start: number; end: number }> | null
  stock: Record<string, number>
  ev: number | null
  image: string | null
  shortName?: string | null
  thumbnailUrl?: string | null
  instantBuyback?: number | null
  contains?: number | null
  videoSrc?: string | null
  videoHevc?: string | null
  available?: boolean | null
  turboMode?: boolean | null
}

export interface GeneratePackResponse {
  memo: string
  transaction: string // base64, parcialmente firmada (50 USDC)
}

export interface SubmitTxResponse {
  signature: string
  confirmation_status: string
}

export type OpenPackResult =
  | { pending: true }
  | {
      pending: false
      nft_address: string
      rarity: string
      name: string | null
      image: string | null
      year: string | null
      grade: string | null
      images: string[]
      insured_value: number | null
      grading_company: string | null
      grading_id: string | null
      authenticated: boolean | null
      auto_sold: boolean
      buyback_amount: number | null
    }

export class GachaDisabledError extends Error {
  constructor() { super('gacha_disabled') }
}

async function gachaFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${config.backendUrl}${path}`, {
    ...options,
    headers: { ...(options?.headers as Record<string, string> | undefined), 'ngrok-skip-browser-warning': 'true' },
  })
  if (resp.status === 503) throw new GachaDisabledError()
  if (!resp.ok) {
    let detail: string | undefined
    try { detail = (await resp.json())?.detail } catch { /* ignore */ }
    throw new Error(detail || `Gacha error ${resp.status}`)
  }
  return resp.json() as Promise<T>
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

export function fetchMachines(): Promise<GachaMachine[]> {
  return gachaFetch<GachaMachine[]>('/gacha/machines')
}

export interface MachineCard {
  nft_address: string | null
  name: string | null
  image: string | null
  rarity: string | null
  insured_value: number | null
  grade: string | null
  images: string[]
  grading_company: string | null
  grading_id: string | null
  the_grade: string | null
  generic_grade: string | null
  authenticated: boolean | null
  year: string | null
}

export function fetchMachineCards(
  code: string,
  opts?: { rarity?: string; page?: number; limit?: number },
): Promise<MachineCard[]> {
  const p = new URLSearchParams()
  if (opts?.rarity) p.set('rarity', opts.rarity)
  if (opts?.page != null) p.set('page', String(opts.page))
  p.set('limit', String(opts?.limit ?? 24))
  return gachaFetch<MachineCard[]>(
    `/gacha/machines/${encodeURIComponent(code)}/cards?${p.toString()}`,
  )
}

export interface NftMetadata {
  nft_address: string
  name: string | null
  image: string | null
  rarity: string | null
  insured_value: number | null
  grade: string | null
  grading_company: string | null
  grading_id: string | null
  year: string | null
  authenticated: boolean | null
}

/** Per-mint card metadata from Collector Crypt, proxied by our backend (browser→backend→CC,
 *  so no CORS and the host switches by cluster). DAS metadata is null on devnet, so this is the
 *  reliable source for insuredValue + grading in the inventory.
 *  Memoised by mint (metadata is effectively immutable per card) so the grid and the modal
 *  share one fetch and revisiting is instant. Failures are not cached (they retry). */
const _cardMetaCache = new Map<string, NftMetadata>()
export function fetchCardMetadata(mint: string): Promise<NftMetadata> {
  const cached = _cardMetaCache.get(mint)
  if (cached) return Promise.resolve(cached)
  return gachaFetch<NftMetadata>(`/gacha/nft/${encodeURIComponent(mint)}`).then((m) => {
    _cardMetaCache.set(mint, m)
    return m
  })
}

export function generatePack(token: string, packType: string): Promise<GeneratePackResponse> {
  return gachaFetch<GeneratePackResponse>('/gacha/generate-pack', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ pack_type: packType }),
  })
}

/** `memo` solo cuando la tx es la compra de un sobre: permite al backend marcarlo como pagado,
 *  que es lo que distingue un pendiente real de una tirada abandonada sin comprar. */
export function submitTx(token: string, signedTransaction: string, memo?: string): Promise<SubmitTxResponse> {
  return gachaFetch<SubmitTxResponse>('/gacha/submit-tx', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify(memo ? { signed_transaction: signedTransaction, memo } : { signed_transaction: signedTransaction }),
  })
}

export interface BuybackAvailable {
  available: boolean
  amount: number | null // USDC base units (6 decimals)
}

export interface BuybackResponse {
  serialized_transaction: string
  refund_amount: number | null
  memo: string | null
}

export function fetchBuybackAvailable(wallet: string, nft: string): Promise<BuybackAvailable> {
  const p = new URLSearchParams({ wallet, nft })
  return gachaFetch<BuybackAvailable>(`/gacha/buyback/available?${p.toString()}`)
}

export function requestBuyback(token: string, nftAddress: string): Promise<BuybackResponse> {
  return gachaFetch<BuybackResponse>('/gacha/buyback', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ nft_address: nftAddress }),
  })
}

export interface NftWithdrawResponse {
  signature: string
  nft_address: string
  address: string
}

/** Send an NFT owned by the user's embedded wallet to an external Solana address. The backend
 *  verifies ownership and signs the transfer with the (delegated) embedded wallet — mirrors the
 *  USDC withdraw. `destAddress` is the destination the user typed. */
export function withdrawNft(token: string, nftAddress: string, destAddress: string): Promise<NftWithdrawResponse> {
  return gachaFetch<NftWithdrawResponse>('/users/me/nft/withdraw', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ nft_address: nftAddress, address: destAddress }),
  })
}

export function openPack(token: string, memo: string): Promise<OpenPackResult> {
  return gachaFetch<OpenPackResult>('/gacha/open-pack', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ memo }),
  })
}

// ── Polling (puro, testeable) ───────────────────────────────────────────────

export function defaultDelayMs(attempt: number): number {
  return Math.min(2000 * 2 ** attempt, 30000)
}

export async function pollOpenPack(
  open: () => Promise<OpenPackResult>,
  opts: { maxAttempts?: number; delayMs?: (attempt: number) => number } = {},
): Promise<OpenPackResult> {
  const maxAttempts = opts.maxAttempts ?? 8
  const delayMs = opts.delayMs ?? defaultDelayMs
  let last: OpenPackResult = { pending: true }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    last = await open()
    if (!last.pending) return last
    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs(attempt)))
    }
  }
  return last
}

/** Public CollectorCrypt asset page for a Solana NFT mint. */
export function ccAssetUrl(mint: string): string {
  return `https://collectorcrypt.com/assets/solana/${mint}`
}

// CollectorCrypt serves the card front image by mint (302 → CDN image; placeholder if missing).
// Usable directly as an <img src>. https://docs.collectorcrypt.com/metadata
//
// El host es POR RED y el de devnet estaba fijo aquí: en mainnet devolvía 404 para todos los
// mints, así que ninguna carta mostraba imagen (reveal, inventario, perfil, buyback). El backend
// ya lo tenía configurable (CC_NFT_BASE_URL); esto es su equivalente en cliente.
export function ccCardImageUrl(mint: string): string {
  return `${config.ccNftBase}/front/${mint}`
}

export interface YoloTx { memo: string; transaction: string }
export interface YoloPacksResponse { yolo_id: string | null; count: number; transactions: YoloTx[] }

export function generateYoloPacks(token: string, packType: string, count: number, turbo: boolean): Promise<YoloPacksResponse> {
  return gachaFetch<YoloPacksResponse>('/gacha/yolo', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ pack_type: packType, count, turbo }),
  })
}

export function yoloTotalCost(price: number, count: number): number {
  return price * count
}

export function clampCount(n: number): number {
  return Math.max(1, Math.min(10, Math.floor(n)))
}

/** Cartas que quedan en la máquina, sumando el stock por rareza.
 *
 *  Lo obvio —y lo que se hacía antes— era usar la longitud del array de cartas que pinta la
 *  cuadrícula, pero ese array se pide con `limit`, así que el cartel acababa diciendo siempre
 *  "24" en todas las máquinas: el tamaño de página, no el contenido. El campo `contains` tampoco
 *  vale, es cartas por sobre (siempre 1). Devuelve null si no hay stock que sumar, para poder
 *  ocultar el cartel en vez de afirmar un 0 que quizá no sea cierto. */
export function machineCardCount(stock: Record<string, number> | null | undefined): number | null {
  if (!stock) return null
  const vals = Object.values(stock).filter((v): v is number => typeof v === 'number' && isFinite(v))
  if (vals.length === 0) return null
  return vals.reduce((a, b) => a + b, 0)
}

export interface PendingPack {
  memo: string
  pack_type: string
  submitted_at: string | null
  /** No null = CC ya resolvió el sobre; el reveal se reproduce con lo guardado, sin reabrirlo. */
  nft_address: string | null
  name: string | null
  /** Guardada al abrir: /gacha/nft/{mint} no la trae, así que sin esto un reveal reproducido
   *  no podría mostrarla nunca. */
  rarity: string | null
  insured_value: number | null
  /** Guardados al abrir: con turbo, CC recompra la carta en el acto. Sin esto un reveal
   *  reproducido ofrecía "Keep" y "Sell" de un NFT que ya no es del jugador. */
  auto_sold: boolean
  buyback_amount: number | null
}

/** Sobres ya pagados y sin abrir. Sirve para recuperarlos desde otra pestaña o tras cerrar la
 *  página a mitad de una tirada, que hoy los dejaba huérfanos e invisibles. */
export function fetchPendingPacks(token: string): Promise<PendingPack[]> {
  return gachaFetch<PendingPack[]>('/gacha/packs/pending', { headers: authHeaders(token) })
}

/** Marca sobres como ya vistos por el jugador. Se llama al TERMINAR el reveal, no al empezarlo:
 *  si se cierra a mitad, siguen pendientes y se pueden volver a ver — mejor repetir que perder. */
export function markPacksRevealed(token: string, memos: string[]): Promise<{ marked: number }> {
  return gachaFetch<{ marked: number }>('/gacha/packs/revealed', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ memos }),
  })
}

/** Un ganador del feed público de Collector Crypt: qué salió y a quién. */
export interface GachaWinner {
  wallet: string
  nft_address: string
  name: string | null
  images: string[]
  insured_value: number | null
  machine: string | null
  rarity: 'Common' | 'Uncommon' | 'Rare' | 'Epic' | null
  at: string | null
  slug: string | null
}

/**
 * Últimos ganadores de toda la plataforma de CC.
 *
 * `count` llega a 200 como mucho: es el techo de su API y el backend lo rechaza por encima en vez
 * de aceptarlo y devolver menos en silencio. Con `rarity` distinta de Epic pueden salir MENOS de
 * `count`, porque CC no filtra esas rarezas y el recorte se hace después.
 */
export function fetchGachaWinners(
  opts: { machine?: string; rarity?: string; count?: number } = {},
): Promise<GachaWinner[]> {
  const q = new URLSearchParams()
  if (opts.machine) q.set('machine', opts.machine)
  if (opts.rarity) q.set('rarity', opts.rarity)
  q.set('count', String(opts.count ?? 10))
  return gachaFetch<GachaWinner[]>(`/gacha/winners?${q}`)
}

export interface RarityGaps {
  machine: string
  /** Cuántos ganadores se han mirado (200 como mucho: es el techo de CC). */
  sampled: number
  /** rareza → tiradas desde la última vez que salió. `null` = no salió en toda la muestra. */
  gaps: Record<string, number | null>
}

/**
 * Cuántas tiradas lleva cada rareza sin salir en una máquina.
 *
 * Es telemetría, no una predicción: el gacha usa VRF y cada tirada es independiente, así que un
 * hueco largo no hace la rareza más probable.
 */
export function fetchRarityGaps(machine: string): Promise<RarityGaps> {
  return gachaFetch<RarityGaps>(`/gacha/winners/gaps?machine=${encodeURIComponent(machine)}`)
}
