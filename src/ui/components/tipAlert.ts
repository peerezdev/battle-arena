/** Traduce un marco del socket a la frase del aviso, o null si no es una propina para enseñar.
 *
 *  Aparte del componente y sin React a propósito: por el socket pasa TODO (chat, drops,
 *  presencia, emotes), así que lo que hay que poder probar a conciencia es la decisión, no el
 *  montaje. Mismo reparto que `battleAlerts.ts`.
 */

/** Hasta 6 decimales porque el backend manda unidades base entre un millón; mínimo 2 porque es
 *  dinero. Redondear a 2 a secas convertiría 0.001 en "0.00", o sea en "no te ha llegado nada". */
const CANTIDAD = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 6,
})

export function tipAlertFor(msg: unknown): string | null {
  if (!msg || typeof msg !== 'object') return null
  const m = msg as Record<string, unknown>
  if (m.type !== 'tip') return null
  const nombre = typeof m.fromName === 'string' ? m.fromName.trim() : ''
  const cantidad = m.amount
  // Un marco a medias no saca un aviso a medias: "undefined sent you NaN USDC" es peor que nada.
  if (!nombre) return null
  if (typeof cantidad !== 'number' || !Number.isFinite(cantidad) || cantidad <= 0) return null
  return `${nombre} sent you ${CANTIDAD.format(cantidad)} USDC`
}
