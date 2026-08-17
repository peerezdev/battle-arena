import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useUserSearch, _limpiarCacheBusqueda, ESPERA_MS } from './userSearch'

function respuesta(datos: unknown[]) {
  return { ok: true, status: 200, json: async () => datos }
}

beforeEach(() => {
  vi.useFakeTimers()
  _limpiarCacheBusqueda()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useUserSearch', () => {
  it('la espera es lo bastante larga para servir de freno', () => {
    // Los demás tests avanzan el reloj usando ESPERA_MS, así que se ADAPTAN a lo que valga: con la
    // espera en 0 seguirían verdes y el freno habría desaparecido sin que nadie se enterara. Esto
    // fija el valor. 150ms es el suelo razonable: por debajo, escribir normal ya dispara varias.
    expect(ESPERA_MS).toBeGreaterThanOrEqual(150)
  })

  it('NO pregunta en cada tecla: espera a que se pare de escribir', async () => {
    // Es EL freno. Sin él, esto es una petición por pulsación contra un backend de un solo
    // proceso, que es la forma del incidente que documenta src/ui/useAliases.ts.
    const f = vi.fn().mockResolvedValue(respuesta([]))
    vi.stubGlobal('fetch', f)

    const { rerender } = renderHook(({ q }) => useUserSearch('tok', q, true),
                                    { initialProps: { q: 'a' } })
    rerender({ q: 'an' })
    rerender({ q: 'ana' })
    expect(f).not.toHaveBeenCalled()

    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })

    expect(f).toHaveBeenCalledTimes(1)
    expect(String(f.mock.calls[0][0])).toContain('q=ana')   // solo la última consulta
  })

  it('la misma consulta no se vuelve a pedir', async () => {
    const f = vi.fn().mockResolvedValue(respuesta([{ wallet: 'W1', alias: 'ana', online: true }]))
    vi.stubGlobal('fetch', f)

    const { rerender } = renderHook(({ q }) => useUserSearch('tok', q, true),
                                    { initialProps: { q: 'ana' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })
    expect(f).toHaveBeenCalledTimes(1)

    rerender({ q: 'an' })
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })
    rerender({ q: 'ana' })                                  // vuelve a una ya pedida
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })

    expect(f).toHaveBeenCalledTimes(2)                      // 'ana' salió de la caché
  })

  it('inactivo no pide nada', async () => {
    // El argumento del importe no ofrece usuarios: ahí no hay que molestar al servidor.
    const f = vi.fn().mockResolvedValue(respuesta([]))
    vi.stubGlobal('fetch', f)

    renderHook(() => useUserSearch('tok', 'ana', false))
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })

    expect(f).not.toHaveBeenCalled()
  })

  it('sin sesión no pide nada', async () => {
    const f = vi.fn().mockResolvedValue(respuesta([]))
    vi.stubGlobal('fetch', f)

    renderHook(() => useUserSearch(null, 'ana', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })

    expect(f).not.toHaveBeenCalled()
  })

  it('devuelve los resultados', async () => {
    const usuarios = [{ wallet: 'W1', alias: 'ana', online: true }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta(usuarios)))

    const { result } = renderHook(() => useUserSearch('tok', 'ana', true))
    // Nada de `waitFor` aquí: usa temporizadores REALES y con los simulados se queda colgado
    // hasta agotar el plazo del test. `advanceTimersByTimeAsync` ya vacía las promesas.
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })

    expect(result.current.resultados).toEqual(usuarios)
  })

  it('una respuesta que NO es correcta no se queda cacheada', async () => {
    // Un 429 (el freno del servidor) o un corte devuelven lista vacía. Si esa lista vacía se
    // guardara, un jugador que SÍ existe seguiría contestando "no existe" el resto de la sesión,
    // y en el chat eso se lee como "esa persona no está".
    const f = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce(respuesta([{ wallet: 'W1', alias: 'ana', online: true }]))
    vi.stubGlobal('fetch', f)

    const primera = renderHook(() => useUserSearch('tok', 'ana', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })
    expect(primera.result.current.resultados).toEqual([])

    // Otra vez con la MISMA consulta: si el fallo se hubiera cacheado, ni se preguntaría.
    const segunda = renderHook(() => useUserSearch('tok', 'ana', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })

    expect(f).toHaveBeenCalledTimes(2)
    expect(segunda.result.current.resultados).toHaveLength(1)
  })

  it('mientras no hay respuesta para la consulta, dice que está cargando', () => {
    // No es "hay un fetch en vuelo": incluye la espera de 250 ms. Quien pega `/tip ana 5` y pulsa
    // Enter sin pausa tiene que poder distinguir "aún no lo sé" de "ese jugador no existe".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta([])))
    const { result } = renderHook(() => useUserSearch('tok', 'ana', true))
    expect(result.current.cargando).toBe(true)
  })

  it('sin buscar nada no está cargando', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta([])))
    expect(renderHook(() => useUserSearch('tok', 'ana', false)).result.current.cargando).toBe(false)
    expect(renderHook(() => useUserSearch(null, 'ana', true)).result.current.cargando).toBe(false)
  })

  it('con la respuesta ya dada deja de estar cargando', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuesta([])))
    const { result } = renderHook(() => useUserSearch('tok', 'ana', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })
    expect(result.current.cargando).toBe(false)
  })

  it('un fallo del servidor deja la lista vacía en vez de reventar', async () => {
    // El autocompletado es un extra: si falla, se escribe el nombre a mano y ya está.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { result } = renderHook(() => useUserSearch('tok', 'ana', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })

    expect(result.current.resultados).toEqual([])
  })
})

describe('useUserSearch · el fallo no deja la búsqueda colgada', () => {
  // Si `respondida` mirara SOLO la caché, tras un fallo —que a propósito ya no se cachea—
  // `cargando` se quedaría en true PARA SIEMPRE: el efecto no se vuelve a disparar porque sus
  // dependencias no cambian. El chat contestaría "todavía buscando" el resto de la sesión y ese
  // jugador no podría recibir una propina por comando. Es el único invariante de este fichero que
  // se podía romper sin que nada se pusiera rojo.
  it('tras un 429 deja de estar cargando', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      { ok: false, status: 429, json: async () => ({}) }))
    const { result } = renderHook(() => useUserSearch('tok', 'ana', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })
    expect(result.current.cargando).toBe(false)
  })

  it('tras un corte de red deja de estar cargando', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { result } = renderHook(() => useUserSearch('tok', 'ana', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })
    expect(result.current.cargando).toBe(false)
  })
})
