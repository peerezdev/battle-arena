import { useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useServerEvents } from '../../hooks/useServerEvents'
import { useEmbeddedSolanaAddress } from '../../wallet/embedded'
import { showToast } from '../toast'
import { battleAlertFor } from '../battle/battleAlerts'

/**
 * App-wide listener: toasts the player when someone joins a lobby they're in (Pack Battle only) or
 * when any battle they're in fills and is about to start. The decision — is this mine, did I
 * trigger it, am I already watching it — lives in battleAlertFor; this host just wires the WS
 * stream to a toast with a jump-in button. Renders nothing.
 */
export function BattleAlertsHost() {
  const meWallet = useEmbeddedSolanaAddress()
  const navigate = useNavigate()
  const location = useLocation()
  // Refs so the (stable) WS callback always reads the latest values without resubscribing.
  const meRef = useRef(meWallet); meRef.current = meWallet
  const navRef = useRef(navigate); navRef.current = navigate
  const pathRef = useRef(location.pathname); pathRef.current = location.pathname

  useServerEvents((msg) => {
    const alert = battleAlertFor(msg, meRef.current, pathRef.current)
    if (!alert) return
    showToast(alert.message, 'info', {
      label: alert.actionLabel,
      onClick: () => navRef.current(`/play/battle/${alert.battleId}`),
    })
  }, !!meWallet)

  return null
}
