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

  it('un fallo del servidor deja la lista vacía en vez de reventar', async () => {
    // El autocompletado es un extra: si falla, se escribe el nombre a mano y ya está.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { result } = renderHook(() => useUserSearch('tok', 'ana', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(ESPERA_MS + 10) })

    expect(result.current.resultados).toEqual([])
  })
})
