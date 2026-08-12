// Cliente de las propinas entre jugadores. El destino es SIEMPRE otro jugador registrado: el
// backend lo exige, y es lo que impide que un tip sea un withdraw sin reglas.
import { config } from './config'

export type TipErrorKind =
  | 'no_account'    // 404: el destinatario no tiene cuenta
  | 'insufficient'  // 402: saldo disponible insuficiente (ya descontado lo reservado)
  | 'too_many'      // 429: demasiadas propinas seguidas
  | 'invalid'       // 422: importe bajo el mínimo, cero, o a uno mismo
  | 'unavailable'   // 503: firmante u operador no configurados
  | 'in_royale'     // 409: el jugador tiene una royale en juego, su wallet la necesita la partida
  | 'failed'        // cualquier otra cosa

export class TipError extends Error {
  kind: TipErrorKind

  constructor(kind: TipErrorKind) {
    super(kind)
    this.kind = kind
  }
}

export interface TipResult {
  signature: string
  amount: number
  to: string
}

const BY_STATUS: Record<number, TipErrorKind> = {
  404: 'no_account', 402: 'insufficient', 429: 'too_many',
  422: 'invalid', 503: 'unavailable', 409: 'in_royale',
}

export async function sendTip(
  token: string,
  to: string,
  amount: number,
  source: 'profile' | 'chat' = 'profile',
): Promise<TipResult> {
  const resp = await fetch(`${config.backendUrl}/users/me/tip`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ to, amount, source }),
  })
  if (!resp.ok) throw new TipError(BY_STATUS[resp.status] ?? 'failed')
  return resp.json() as Promise<TipResult>
}
