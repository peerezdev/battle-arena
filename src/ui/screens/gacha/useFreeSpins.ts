import { useCallback, useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { fetchFreeSpins, type FreeSpins } from '../../../onchain/gachaClient'

/**
 * Tiradas gratis del jugador, según Collector Crypt.
 *
 * Los puntos los lleva CC, no nosotros, así que esto es siempre una consulta remota y hay que
 * refrescarla después de canjear: el saldo cambia al otro lado.
 */
export function useFreeSpins() {
  const { identityToken } = useIdentityToken()
  const [datos, setDatos] = useState<FreeSpins | null>(null)

  const refrescar = useCallback(() => {
    if (!identityToken) return
    fetchFreeSpins(identityToken)
      .then(setDatos)
      .catch(() => { /* es un extra: si falla, el botón simplemente no aparece */ })
  }, [identityToken])

  useEffect(() => { refrescar() }, [refrescar])

  // Al cerrar sesión el valor se DERIVA a null en vez de limpiarlo con un setState desde el
  // efecto: lo segundo encadena un render extra por nada, y el linter lo marca con razón.
  return { freeSpins: identityToken ? datos : null, refrescarFreeSpins: refrescar }
}
