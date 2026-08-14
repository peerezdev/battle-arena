/**
 * Menciones del chat: detectar el `@` que se está escribiendo y resolver las etiquetas a wallets.
 *
 * Todo se hace con la lista de presencia que ya está en memoria, sin una sola petición. Esa es la
 * razón de que solo se pueda mencionar a los conectados: un autocompletado que preguntara al
 * servidor en cada tecla es exactamente la ráfaga que ya tumbó producción una vez contra
 * `/users/{wallet}` (ver `src/ui/useAliases.ts`).
 */

/** Un jugador conectado, tal y como lo manda el backend en el aviso de presencia. */
export interface OnlineUser { wallet: string; name: string }
export interface Mention { wallet: string; label: string }

/** El `@` solo abre mención al principio del texto o tras un espacio. Si valiera en cualquier
 *  posición, escribir "mauro@correo.com" abriría la lista a mitad de un correo. */
const INICIO_MENCION = /(?:^|\s)@([^\s@]*)$/

/** Escapa lo que vaya a ir dentro de una expresión regular. Hace falta de verdad: quien no tiene
 *  alias se identifica por su wallet abreviada, con puntos suspensivos, y `.` es un comodín. */
function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** La mención que se está escribiendo en la posición del cursor, o null si no hay ninguna. */
export function buscarMencion(texto: string, cursor: number): { desde: number; consulta: string } | null {
  const antes = texto.slice(0, cursor)
  const m = INICIO_MENCION.exec(antes)
  if (!m) return null
  return { desde: antes.length - m[1].length - 1, consulta: m[1] }
}

/**
 * Etiquetas escritas → wallets, con la lista de conectados.
 *
 * Se recorre a los conectados y no al texto: así el nombre se compara entero, y "@anabel" no
 * puede resolverse a "ana" por empezar igual.
 */
export function resolverMenciones(texto: string, conectados: OnlineUser[]): Mention[] {
  const out: Mention[] = []
  const vistas = new Set<string>()
  for (const u of conectados) {
    if (vistas.has(u.wallet)) continue
    const re = new RegExp(`(?:^|\\s)@${escapar(u.name)}(?=\\s|$)`)
    if (re.test(texto)) {
      vistas.add(u.wallet)
      out.push({ wallet: u.wallet, label: u.name })
    }
  }
  return out
}
