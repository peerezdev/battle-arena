/**
 * Comandos del chat, al estilo de Discord: `/comando arg1 arg2`.
 *
 * Es un REGISTRO y no un `if` para `/tip` a propósito: añadir `/help` o `/roll` mañana tiene que
 * ser una entrada más en la lista, no otra pantalla ni otra rama en el `ChatDock`.
 */
import { TIPS_ENABLED } from '../../../featureFlags'

export interface ArgumentoComando {
  nombre: string
  /** `usuario` hace que el autocompletado ofrezca jugadores en ese argumento; `texto`, nada. */
  tipo: 'usuario' | 'texto'
}

export interface Comando {
  nombre: string
  descripcion: string
  args: ArgumentoComando[]
  /** Un comando apagado ni se ofrece ni se ejecuta. Ver `featureFlags.ts`. */
  disponible: () => boolean
}

export const COMANDOS: Comando[] = [
  {
    nombre: 'tip',
    descripcion: 'Send USDC to another player',
    args: [{ nombre: 'user', tipo: 'usuario' }, { nombre: 'amount', tipo: 'texto' }],
    disponible: () => TIPS_ENABLED,
  },
]

export function comandosDisponibles(): Comando[] {
  return COMANDOS.filter((c) => c.disponible())
}

export function buscarComando(nombre: string): Comando | undefined {
  return COMANDOS.find((c) => c.nombre === nombre.toLowerCase())
}

export interface ComandoEscrito {
  nombre: string
  args: string[]
  /** Dónde está el cursor: -1 en el NOMBRE del comando, 0 en el primer argumento, 1 en el
   *  segundo… Es lo que permite ofrecer usuarios en uno y nada en otro. */
  argActivo: number
}

/**
 * El comando que se está escribiendo en la posición del cursor, o null si no hay ninguno.
 *
 * La barra tiene que ABRIR el mensaje: si valiera en cualquier posición, escribir "de 3/4 partes"
 * abriría la lista de comandos a mitad de una frase.
 *
 * `argActivo` se calcula con el CURSOR y no con el final del texto, porque volver atrás a corregir
 * el destinatario tiene que reabrir su lista, no la del importe.
 */
export function parseComando(texto: string, cursor: number): ComandoEscrito | null {
  if (!texto.startsWith('/')) return null

  const trozos = texto.slice(1).split(/\s+/)
  const nombre = (trozos[0] ?? '').toLowerCase()
  const args = trozos.slice(1).filter((t) => t !== '')

  // En qué trozo cae el cursor: se recorre el texto contando separaciones hasta llegar a él.
  const antes = texto.slice(0, cursor)
  const trozosAntes = antes.slice(1).split(/\s+/)
  const argActivo = trozosAntes.length - 2   // -1 = el nombre del comando

  return { nombre, args, argActivo }
}
