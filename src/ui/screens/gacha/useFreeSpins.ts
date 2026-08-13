import { useCallback, useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { fetchFreeSpins, GachaHttpError, GachaDisabledError, type FreeSpins } from '../../../onchain/gachaClient'

/** Por qué no hay puntos que enseñar. `null` = no ha fallado nada. */
export type FreeSpinsError = 'sesion' | 'no_disponible' | 'fallo'

/**
 * Tiradas gratis del jugador, según Collector Crypt.
 *
 * Los puntos los lleva CC, no nosotros, así que esto es siempre una consulta remota y hay que
 * refrescarla después de canjear: el saldo cambia al otro lado.
 *
 * DEVUELVE TAMBIÉN EL MOTIVO DEL FALLO, y no es un adorno. Antes el `catch` se tragaba el error y
 * dejaba los datos en `null`; como el panel esconde los puntos Y el botón cuando el dato falta, una
 * sesión caducada se veía exactamente igual que "esta máquina no da tiradas gratis": sin nada. Una
 * tarde entera de depuración salió de ahí.
 */
export function useFreeSpins() {
  const { identityToken } = useIdentityToken()
  const [datos, setDatos] = useState<FreeSpins | null>(null)
  const [error, setError] = useState<FreeSpinsError | null>(null)

  const refrescar = useCallback(() => {
    if (!identityToken) return
    fetchFreeSpins(identityToken)
      .then((d) => { setDatos(d); setError(null) })
      .catch((e: unknown) => {
        setDatos(null)
        if (e instanceof GachaDisabledError) setError('no_disponible')
        // 401/403: el token de identidad no vale o ya no está. Se le pide volver a entrar, que es
        // lo único que lo arregla; reintentar solo repetiría el mismo 401.
        else if (e instanceof GachaHttpError && (e.status === 401 || e.status === 403)) setError('sesion')
        else setError('fallo')
      })
  }, [identityToken])

  useEffect(() => { refrescar() }, [refrescar])

  // Al cerrar sesión el valor se DERIVA a null en vez de limpiarlo con un setState desde el
  // efecto: lo segundo encadena un render extra por nada, y el linter lo marca con razón.
  return {
    freeSpins: identityToken ? datos : null,
    freeSpinsError: identityToken ? error : null,
    refrescarFreeSpins: refrescar,
  }
}
