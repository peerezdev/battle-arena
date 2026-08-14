import { describe, it, expect } from 'vitest'
import { buscarMencion, resolverMenciones } from './mentions'

const conectados = [
  { wallet: 'WalletA', name: 'ana' },
  { wallet: 'WalletB', name: 'Bea' },
  { wallet: 'WalletC', name: '8QDB…gtm6' },
]

describe('buscarMencion', () => {
  it('encuentra la mención que se está escribiendo', () => {
    expect(buscarMencion('hola @an', 8)).toEqual({ desde: 5, consulta: 'an' })
  })

  it('el @ recién escrito ya abre la lista, sin haber tecleado nada', () => {
    expect(buscarMencion('hola @', 6)).toEqual({ desde: 5, consulta: '' })
  })

  it('no se activa a mitad de una palabra, como en un correo', () => {
    expect(buscarMencion('escribe a mauro@correo.com', 26)).toBeNull()
  })

  it('se cierra al escribir un espacio', () => {
    expect(buscarMencion('hola @ana y ', 12)).toBeNull()
  })

  it('mira el cursor, no el final del texto', () => {
    // Escribir en medio de un mensaje ya escrito tiene que abrir la lista igual.
    expect(buscarMencion('hola @an y adiós', 8)).toEqual({ desde: 5, consulta: 'an' })
  })
})

describe('resolverMenciones', () => {
  it('convierte las etiquetas escritas en wallets', () => {
    expect(resolverMenciones('hola @ana y @Bea', conectados)).toEqual([
      { wallet: 'WalletA', label: 'ana' },
      { wallet: 'WalletB', label: 'Bea' },
    ])
  })

  it('ignora a quien no esté conectado', () => {
    expect(resolverMenciones('hola @nadie', conectados)).toEqual([])
  })

  it('no repite si se menciona dos veces al mismo', () => {
    expect(resolverMenciones('@ana @ana', conectados)).toHaveLength(1)
  })

  it('funciona con quien se identifica por su wallet abreviada', () => {
    // Sin alias, el nombre lleva puntos suspensivos: si no se escapara, la expresión regular
    // trataría ese carácter como comodín.
    expect(resolverMenciones('gracias @8QDB…gtm6', conectados))
      .toEqual([{ wallet: 'WalletC', label: '8QDB…gtm6' }])
  })

  it('no confunde un nombre con el principio de otro', () => {
    const dos = [{ wallet: 'W1', name: 'ana' }, { wallet: 'W2', name: 'anabel' }]
    expect(resolverMenciones('hola @anabel', dos)).toEqual([{ wallet: 'W2', label: 'anabel' }])
  })
})
