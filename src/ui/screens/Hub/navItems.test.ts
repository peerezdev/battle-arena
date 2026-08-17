import { describe, it, expect } from 'vitest'
import { NAV_ITEMS } from './hubMockData'
import { NAV_ROUTES, activeNavFromPath } from '../../layouts/navRoutes'

describe('la navegación', () => {
  it('cabe en una barra de móvil', () => {
    // Cinco es el tope que aguanta una barra inferior sin apelotonarse. Estaba en seis, y encima
    // uno de los seis era un menú que solo llevaba a los otros cinco.
    expect(NAV_ITEMS.length).toBeLessThanOrEqual(5)
  })

  it('no lleva Home', () => {
    // Era un menú de pósters encima de este menú: tres banners, cero estado, ninguna acción
    // propia. Su contenido sigue en /home, pero para quien todavía no ha entrado.
    expect(NAV_ITEMS.map((i) => i.label)).not.toContain('Home')
  })

  it('no lleva Pack ni Royale por separado', () => {
    // El modo es un FILTRO, no un destino: las dos rutas renderizaban la misma pantalla con un
    // prop distinto, y partir la lista en dos hacía que cada mitad pareciera un juego muerto.
    const ids = NAV_ITEMS.map((i) => i.id)
    expect(ids).not.toContain('pack')
    expect(ids).not.toContain('royale')
    expect(ids).toContain('lobby')
  })

  it('lleva el Machine Tracker y NO el feed de ganadores', () => {
    // El tracker tenía ruta e icono desde hacía tiempo pero no estaba en ninguna lista. Ahora es
    // su propia pantalla y ocupa el sitio; Winners sale de la barra, porque lo que la gente busca
    // es cuánto paga cada máquina, no la lista de lo que acaba de salir.
    const ids = NAV_ITEMS.map((i) => i.id)
    expect(ids).toContain('tracker')
    expect(ids).not.toContain('winners')
  })

  it('cada pestaña tiene a dónde ir', () => {
    // Una entrada sin ruta sería un botón que no lleva a ningún sitio.
    for (const i of NAV_ITEMS) expect(NAV_ROUTES[i.id]).toBeTruthy()
  })

  it('el Lobby se marca activo también en las rutas viejas', () => {
    // /play/arena y /play/royale siguen vivas como redirección, y mientras se resuelven no puede
    // quedarse la barra sin nada encendido.
    expect(activeNavFromPath('/play/lobby')).toBe('lobby')
    expect(activeNavFromPath('/play/lobby?mode=royale')).toBe('lobby')
    expect(activeNavFromPath('/play/arena')).toBe('lobby')
    expect(activeNavFromPath('/play/royale')).toBe('lobby')
    expect(activeNavFromPath('/play/battle/abc')).toBe('lobby')
  })

  it('en Home no se enciende nada, porque ya no es una pestaña', () => {
    expect(activeNavFromPath('/home')).toBeNull()
  })

  it('el tracker se enciende en su ruta, y Winners no enciende nada', () => {
    expect(activeNavFromPath('/machine-tracker')).toBe('tracker')
    // Sigue accesible por URL, pero ya no es una pestaña.
    expect(activeNavFromPath('/winners')).toBeNull()
  })
})
