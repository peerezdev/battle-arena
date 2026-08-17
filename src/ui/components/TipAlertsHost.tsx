import { useServerEvents } from '../../hooks/useServerEvents'
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
 */
export function TipAlertsHost() {
  useServerEvents((msg) => {
    const aviso = tipAlertFor(msg)
    if (aviso) showToast(aviso, 'success')
  })
  return null
}
