import { useServerEvents } from '../../hooks/useServerEvents'
import { useEmbeddedSolanaAddress } from '../../wallet/embedded'
import { tipAlertFor } from './tipAlert'
import { showToast } from '../toastBus'

/**
 * Escucha de toda la aplicación: avisa a quien acaba de recibir una propina, con quién se la ha
 * mandado y cuánto. La decisión vive en `tipAlertFor`; esto solo enchufa el socket al toast.
 *
 * Va aquí y NO en `useChat` porque ese hook se monta en dos sitios a la vez (AppShell y ChatDock)
 * y los dos escuchan el mismo socket: el aviso saldría por duplicado. Este anfitrión se monta una
 * sola vez, igual que `BattleAlertsHost`.
 *
 * No hace falta comprobar el destinatario: el servidor manda este marco SOLO a los sockets de
 * quien cobra (`send_to_wallet`), así que si llega, es para ti. No pinta nada.
 *
 * `enabled` va atado a la wallet embebida, igual que en `BattleAlertsHost`: sin sesión no hay
 * propina que recibir, y un socket anónimo de más lo cuenta el backend como jugador conectado
 * (`online_count`), inflando el número aunque nadie vaya a ver el toast.
 */
export function TipAlertsHost() {
  const meWallet = useEmbeddedSolanaAddress()
  useServerEvents((msg) => {
    const aviso = tipAlertFor(msg)
    if (aviso) showToast(aviso, 'success')
  }, !!meWallet)
  return null
}
