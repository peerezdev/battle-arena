/**
 * Ejecutar los N sobres de una tanda A LA VEZ en vez de uno detrás de otro.
 *
 * Iban en fila y no había ninguna razón para ello. Medido en devnet con tiradas reales:
 *
 *     10 sobres, en fila      39.3 s      0 fallos
 *     10 sobres, en paralelo   5.5 s      0 fallos
 *
 * Y se comprobó aparte la pata que daba más respeto, que era Privy firmando varias veces con la
 * misma wallet: 50 firmas simultáneas, cero errores, 0.82 s en total. Collector Crypt tampoco se
 * inmuta: su `generate` pasó de 0.68 a 1.04 s de media con diez a la vez, y `submit` ni eso.
 *
 * La parte que más pesaba era abrir. Cuando se llega ahí los sobres YA están pagados y CC los está
 * resolviendo todos en paralelo por su lado, así que la cola era nuestra, solo para ir a recoger
 * resultados que ya estaban. Y era la peor cola posible, porque el sondeo espera 2 s, luego 4,
 * luego 8: en fila esas esperas se suman, a la vez la tanda tarda lo que el sobre más lento.
 */

export interface Resultado<T> {
  /** Lo que salió bien, EN EL ORDEN EN QUE SE PIDIÓ y no en el que fue respondiendo. */
  ok: T[]
  /** El último fallo, para poder decir algo si no salió ninguno. */
  error: string | null
  fallos: number
}

/**
 * Lanza las `n` tareas a la vez y recoge las que salieron.
 *
 * UNA QUE FALLA NO CORTA LA TANDA. Con todo en vuelo no hay forma de "parar a tiempo", pero es que
 * además es lo correcto: el usuario pidió diez sobres, y que el tercero falle no es motivo para
 * dejarle sin el séptimo. En el flujo real el saldo se comprueba entero antes de empezar, así que
 * un fallo suelto no puede gastar de más.
 *
 * `onAvance` recibe cuántas van hechas, no el índice de la que acaba: en paralelo terminan en
 * cualquier orden, y un índice se leería como una posición en una cola que ya no existe.
 */
export async function enTanda<T>(
  n: number,
  tarea: (i: number) => Promise<T | null>,
  onAvance?: (hechas: number) => void,
): Promise<Resultado<T>> {
  let hechas = 0
  let error: string | null = null

  const salida: (T | null)[] = await Promise.all(Array.from({ length: n }, async (_, i): Promise<T | null> => {
    try {
      const r = await tarea(i)
      if (r == null) return null
      hechas += 1
      onAvance?.(hechas)
      return r
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      return null
    }
  }))

  const ok = salida.filter((r): r is T => r != null)
  return { ok, error, fallos: n - ok.length }
}
