// Cliente fino del proxy /gacha/* del backend. La x-api-key vive en el
// backend; aquí solo viajan el token de sesión y datos públicos.
import { config } from './config'

export interface GachaMachine {
  code: string
  name: string
  price: number
  odds: Record<string, number>
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

export function generatePack(token: string, packType: string): Promise<GeneratePackResponse> {
  return gachaFetch<GeneratePackResponse>('/gacha/generate-pack', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ pack_type: packType }),
  })
}

export function submitTx(token: string, signedTransaction: string): Promise<SubmitTxResponse> {
  return gachaFetch<SubmitTxResponse>('/gacha/submit-tx', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ signed_transaction: signedTransaction }),
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
