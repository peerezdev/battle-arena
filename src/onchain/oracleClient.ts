import { config } from './config'

export interface AttestResponse {
  mint: string
  value_usd: number
  grade: number
  grading_company: string
  ts: number
  message_hex: string
  signature_hex: string
  oracle_pubkey: string
}

/** Obtiene la atestación del oráculo para un mint y una batalla dados.
 *  El parámetro `battle` (base58) liga la atestación a esa batalla concreta,
 *  impidiendo el reuso de la firma en otra batalla (anti-replay). */
export async function attest(mint: string, battle: string): Promise<AttestResponse> {
  const url = `${config.oracleUrl}/attest?mint=${encodeURIComponent(mint)}&battle=${encodeURIComponent(battle)}`
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Oracle attest error: ${resp.status}`)
  return resp.json() as Promise<AttestResponse>
}

/** Obtiene la clave pública del oráculo. */
export async function getOraclePubkey(): Promise<string> {
  const resp = await fetch(`${config.oracleUrl}/pubkey`)
  if (!resp.ok) throw new Error(`Oracle pubkey error: ${resp.status}`)
  const data = (await resp.json()) as { pubkey: string }
  return data.pubkey
}
