/** UNA sola conexión al servidor por pestaña, compartida por todo el que quiera escuchar.
 *
 * Antes cada consumidor abría la suya con `new WebSocket`: useChat lo hacía en AppShell y en
 * ChatDock, y useServerEvents en useBattleEmotes, BattleAlertsHost y RematchToast. Resultado
 * medido en producción: **cuatro conexiones por pestaña** en la misma carga de página. Y como el
 * backend cuenta los jugadores en línea con `len(self._active)` —sockets abiertos, no personas—,
 * una sola persona aparecía como cuatro.
 *
 * El coste no era solo cosmético: el backend corre en UN proceso y guarda el conjunto de
 * conexiones en memoria, así que multiplicaba por cuatro los sockets que tiene que mantener y a
 * los que difunde cada mensaje.
 *
 * Aquí el socket tiene un único dueño: este módulo. Los hooks se suscriben y se dan de baja; la
 * conexión se abre con el primero y se cierra con el último.
 */

import { config } from '../onchain/config'

type Escucha = (msg: unknown) => void

const RECONEXION_MS = 2000

let socket: WebSocket | null = null
let tokenActual: string | null = null
let reintento: ReturnType<typeof setTimeout> | null = null
const escuchas = new Set<Escucha>()
const cambiosDeEstado = new Set<(abierto: boolean) => void>()

function url(token: string | null): string {
  const ruta = `${config.backendUrl.replace(/^http/, 'ws')}/ws/chat`
  return token ? `${ruta}?token=${encodeURIComponent(token)}` : ruta
}

function avisarEstado(abierto: boolean) {
  for (const f of cambiosDeEstado) f(abierto)
}

function conectar() {
  if (socket || escuchas.size === 0) return
  let ws: WebSocket
  try {
    ws = new WebSocket(url(tokenActual))
  } catch {
    return // URL inválida: sin socket y sin reintento, igual que antes
  }
  socket = ws

  ws.onopen = () => avisarEstado(true)
  ws.onmessage = (ev) => {
    let msg: unknown
    try {
      msg = JSON.parse(ev.data as string)
    } catch {
      return // tramas no-JSON: se ignoran
    }
    // Copia del conjunto: un escucha puede darse de baja mientras se reparte.
    for (const f of [...escuchas]) {
      try { f(msg) } catch { /* un escucha roto no puede tumbar a los demás */ }
    }
  }
  ws.onclose = () => {
    socket = null
    avisarEstado(false)
    // Solo se reintenta si queda alguien escuchando; si no, la pestaña se quedaría
    // reconectando en bucle a un chat que nadie mira.
    if (escuchas.size > 0 && reintento === null) {
      reintento = setTimeout(() => { reintento = null; conectar() }, RECONEXION_MS)
    }
  }
  ws.onerror = () => { /* onclose se encarga de reconectar */ }
}

function cerrar() {
  if (reintento !== null) { clearTimeout(reintento); reintento = null }
  if (socket) {
    socket.onclose = null // sin esto el cierre deliberado dispararía una reconexión
    socket.close()
    socket = null
  }
}

/** Da de alta un escucha. Devuelve la función para darse de baja. */
export function suscribir(f: Escucha): () => void {
  escuchas.add(f)
  conectar()
  return () => {
    escuchas.delete(f)
    if (escuchas.size === 0) cerrar()
  }
}

/** Avisos de conectado/desconectado, para quien pinte estado. */
export function suscribirEstado(f: (abierto: boolean) => void): () => void {
  cambiosDeEstado.add(f)
  f(socket?.readyState === WebSocket.OPEN)
  return () => { cambiosDeEstado.delete(f) }
}

/** El token de identidad cambió (login, logout, refresco): se reconecta con el nuevo. */
export function fijarToken(token: string | null): void {
  if (token === tokenActual) return
  tokenActual = token
  if (escuchas.size > 0) { cerrar(); conectar() }
}

export function enviar(datos: unknown): boolean {
  if (socket?.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(datos))
  return true
}

/** Solo para tests: deja el módulo como recién importado. */
export function _reiniciar(): void {
  cerrar()
  escuchas.clear()
  cambiosDeEstado.clear()
  tokenActual = null
}
