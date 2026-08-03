import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { suscribir, suscribirEstado, fijarToken, enviar, _reiniciar } from './serverSocket'

/** Doble del WebSocket del navegador que cuenta cuántos se han abierto. Es la única forma de
 *  comprobar lo que de verdad falló en producción: cuatro consumidores, cuatro conexiones. */
class WSFalso {
  static abiertos: WSFalso[] = []
  static get cuantos() { return WSFalso.abiertos.length }
  static OPEN = 1
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  enviados: string[] = []
  url: string
  // Campo declarado aparte y no como propiedad de constructor: el proyecto compila con
  // `erasableSyntaxOnly`, que prohíbe esa forma por no ser TypeScript borrable.
  constructor(url: string) { this.url = url; WSFalso.abiertos.push(this) }
  send(d: string) { this.enviados.push(d) }
  close() { this.readyState = 3; this.onclose?.() }
  recibe(obj: unknown) { this.onmessage?.({ data: JSON.stringify(obj) }) }
}

const ultimo = () => WSFalso.abiertos[WSFalso.abiertos.length - 1]!

beforeEach(() => {
  WSFalso.abiertos = []
  vi.stubGlobal('WebSocket', WSFalso as unknown as typeof WebSocket)
  _reiniciar()
})
afterEach(() => { _reiniciar(); vi.unstubAllGlobals() })

describe('serverSocket · una sola conexión por pestaña', () => {
  it('cuatro suscriptores abren UNA conexión, no cuatro', () => {
    // Esto es exactamente el fallo que hubo: useChat en AppShell y en ChatDock, y
    // useServerEvents en useBattleEmotes, BattleAlertsHost y RematchToast. El backend cuenta
    // jugadores en línea por sockets abiertos, así que una persona aparecía como cuatro.
    const bajas = [suscribir(() => {}), suscribir(() => {}), suscribir(() => {}), suscribir(() => {})]
    expect(WSFalso.cuantos).toBe(1)
    bajas.forEach((b) => b())
  })

  it('reparte cada mensaje a TODOS los suscriptores', () => {
    const vistos: string[] = []
    const b1 = suscribir((m) => vistos.push('a:' + (m as { type: string }).type))
    const b2 = suscribir((m) => vistos.push('b:' + (m as { type: string }).type))
    ultimo().recibe({ type: 'presence', online: 3 })
    expect(vistos).toEqual(['a:presence', 'b:presence'])
    b1(); b2()
  })

  it('un suscriptor que revienta no deja sin mensaje a los demás', () => {
    const vistos: string[] = []
    const b1 = suscribir(() => { throw new Error('roto') })
    const b2 = suscribir(() => vistos.push('llegó'))
    ultimo().recibe({ type: 'message' })
    expect(vistos).toEqual(['llegó'])
    b1(); b2()
  })

  it('cierra el socket cuando se va el ÚLTIMO suscriptor, no el primero', () => {
    const b1 = suscribir(() => {})
    const b2 = suscribir(() => {})
    b1()
    expect(ultimo().readyState).toBe(1)      // sigue abierto: queda b2
    b2()
    expect(ultimo().readyState).toBe(3)      // ahora sí
  })

  it('al cambiar el token reconecta con el nuevo, sin acumular sockets', () => {
    const baja = suscribir(() => {})
    expect(ultimo().url).not.toContain('token=')
    fijarToken('abc')
    expect(WSFalso.cuantos).toBe(2)          // el viejo se cerró y se abrió uno
    expect(ultimo().url).toContain('token=abc')
    baja()
  })

  it('fijar el MISMO token no reconecta', () => {
    const baja = suscribir(() => {})
    fijarToken('abc')
    const n = WSFalso.cuantos
    fijarToken('abc')
    expect(WSFalso.cuantos).toBe(n)
    baja()
  })

  it('enviar usa el socket compartido y avisa si está cerrado', () => {
    const baja = suscribir(() => {})
    expect(enviar({ text: 'hola' })).toBe(true)
    expect(ultimo().enviados).toEqual(['{"text":"hola"}'])
    baja()
    expect(enviar({ text: 'tarde' })).toBe(false)   // ya no hay socket
  })

  it('avisa del estado de conexión a quien lo pinte', () => {
    const estados: boolean[] = []
    const bajaEstado = suscribirEstado((v) => estados.push(v))
    const baja = suscribir(() => {})
    ultimo().onopen?.()
    expect(estados).toContain(true)
    baja()
    bajaEstado()
  })

  it('sin suscriptores no reconecta: una pestaña sin nadie escuchando no debe insistir', () => {
    vi.useFakeTimers()
    const baja = suscribir(() => {})
    baja()                                   // cierra y se da de baja
    const n = WSFalso.cuantos
    vi.advanceTimersByTime(10000)
    expect(WSFalso.cuantos).toBe(n)
    vi.useRealTimers()
  })
})
