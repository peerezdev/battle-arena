import type { NavigateFunction } from 'react-router-dom'
import { rematchBattle } from '../../onchain/packBattleClient'
import { showToast } from '../toast'

/** Rematch from a finished battle's result screen. In the demo (battleId === 'demo') it just
 *  restarts a fresh demo; otherwise it create-or-joins the real rematch and navigates to it. */
export async function startRematch(opts: {
  battleId: string | undefined
  mode: 'pack' | 'royale'
  token: string | null | undefined
  navigate: NavigateFunction
}): Promise<void> {
  const { battleId, mode, token, navigate } = opts
  if (!battleId || battleId === 'demo') { navigate(`/play/demo/${mode}`); return }
  if (!token) { showToast('Sign in to rematch'); return }
  try {
    const r = await rematchBattle(token, battleId)
    navigate(`/play/battle/${r.battle_id}`)
  } catch (e) {
    showToast(e instanceof Error ? e.message : 'Rematch failed')
  }
}
