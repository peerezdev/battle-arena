import { describe, it, expect } from 'vitest'
import { parseComando } from './commands'

describe('parseComando', () => {
  it('un texto normal no es un comando', () => {
    expect(parseComando('hola', 4)).toBeNull()
  })

  it('la barra tiene que abrir el mensaje', () => {
    // Si valiera en cualquier posición, "de 3/4 partes" abriría la lista de comandos a mitad de
    // una frase.
    expect(parseComando(' /tip', 5)).toBeNull()
    expect(parseComando('mira /tip', 9)).toBeNull()
  })

  it('reconoce el comando y sus argumentos', () => {
    expect(parseComando('/tip ana 5', 10)).toMatchObject({ nombre: 'tip', args: ['ana', '5'] })
  })

  it('solo la barra ya es un comando a medias', () => {
    // Es lo que abre la lista nada más escribir "/".
    expect(parseComando('/', 1)).toMatchObject({ nombre: '', args: [] })
  })

  it('dice EN QUÉ argumento está el cursor', () => {
    // Es lo que permite ofrecer usuarios en el primero y nada en el segundo. -1 = el nombre.
    expect(parseComando('/ti', 3)?.argActivo).toBe(-1)
    expect(parseComando('/tip ', 5)?.argActivo).toBe(0)
    expect(parseComando('/tip an', 7)?.argActivo).toBe(0)
    expect(parseComando('/tip ana ', 9)?.argActivo).toBe(1)
    expect(parseComando('/tip ana 5', 10)?.argActivo).toBe(1)
  })

  it('manda el CURSOR, no el final del texto', () => {
    // Volver atrás a corregir el destinatario tiene que reabrir su lista, no la del importe.
    expect(parseComando('/tip ana 5', 7)?.argActivo).toBe(0)
    expect(parseComando('/tip ana 5', 3)?.argActivo).toBe(-1)
  })

  it('aguanta espacios de más', () => {
    expect(parseComando('/tip   ana', 10)).toMatchObject({ nombre: 'tip', args: ['ana'] })
  })

  it('el nombre del comando no distingue mayúsculas', () => {
    expect(parseComando('/TIP ana', 8)?.nombre).toBe('tip')
  })
})
