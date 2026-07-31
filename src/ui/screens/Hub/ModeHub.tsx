import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import type { LiveBattle, BattleMode } from './hubMockData'
import { QuickMatch } from './QuickMatch'
import { LiveBattles, BattleCard } from './LiveBattles'
import { RoyaleBattleWide } from './RoyaleBattleWide'
import { RoyaleDemoNotice } from './RoyaleDemoNotice'
import { settledRoyales } from './lastRoyale'
import { showToast } from '../../toastBus'
import { useBattles } from '../../../onchain/useBattles'
import { openBattleToLive } from './openBattleToLive'
import { joinBattle, cancelBattle } from '../../../onchain/packBattleClient'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { useDelegationGate } from '../../components/useDelegationGate'
import { DelegationGate } from '../../components/DelegationGate'
import { CreateBattleModal } from './CreateBattleModal'
import { DemoPicker } from './DemoPicker'
import { loadMachineList, useMachineList } from '../../useMachines'
import { canCreateRoyale } from '../../../onchain/config'

/**
 * Mode-focused page (Pack Battle / Battle Royale): the adapted Quick Match (create locked to this
 * mode) plus Live games filtered to this mode only. Shared by the /play/arena and /play/royale routes.
 */
export function ModeHub({ mode }: { mode: Extract<BattleMode, 'pack' | 'royale'> }) {
  const navigate = useNavigate()
  const { identityToken } = useIdentityToken()
  const meWallet = useEmbeddedSolanaAddress()
  const { battles } = useBattles()
  const { machines } = useMachineList()
  const gate = useDelegationGate()
  const [createOpen, setCreateOpen] = useState(false)
  const [demoOpen, setDemoOpen] = useState(false)

  // Warm the machine catalogue so Create Battle opens with machines ready.
  useEffect(() => { void loadMachineList() }, [])

  const liveBattles = battles
    .map((b) => openBattleToLive(b, meWallet))
    .filter((b) => b.mode === mode)
  // Lobbies Y partidas en curso: una royale arrancada desaparecía de la sección entera —también
  // para quien la estaba jugando—, y solo se volvía a ver en el modal de "te las perdiste". Las
  // terminadas sí se quedan fuera: para esas está la tarjeta de recap. La card ya distingue el
  // caso (`action: join | watch` y el estado "Live" en rojo).
  const royaleOpen = liveBattles.filter((b) => !b.battleStatus || b.battleStatus === 'lobby' || b.battleStatus === 'running')
  // Royale terminadas, para la sección "Recent" bajo los lobbies. Solo en la página de royale.
  const royaleRecent = mode === 'royale' ? settledRoyales(liveBattles) : []
  const byCode = useMemo(() => new Map(machines.map((m) => [m.code, m])), [machines])

  // Los fallos de estas acciones van SIEMPRE por toast. El aviso nace de pulsar un botón de una
  // card, y un banner sobre la lista deja el mensaje lejos de lo que lo provocó — y encima
  // desplaza las cards al aparecer.
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  function onCancel(b: LiveBattle) {
    if (!identityToken) { showToast('Sign in to cancel'); return }
    cancelBattle(identityToken, b.id).catch((e) => showToast(errMsg(e)))
  }

  function onBattleAction(b: LiveBattle) {
    if (b.action === 'watch') { navigate('/play/battle/' + b.id); return }
    if (!identityToken) { showToast('Sign in to join'); return }
    gate.requireDelegation(async () => {
      try {
        await joinBattle(identityToken, b.id)
        navigate('/play/battle/' + b.id)
      } catch (e) {
        showToast(errMsg(e))   // p. ej. fondos insuficientes, o alguien llenó el hueco antes
      }
    })
  }

  return (
    <div style={{ padding: '24px clamp(14px,2.4vw,28px) 44px', display: 'flex', flexDirection: 'column', gap: 26 }}>
      {/* Arriba del todo: ver la demo ANTES de encontrarse con el precio y el botón de unirse. */}
      {mode === 'royale' && <RoyaleDemoNotice />}

      <QuickMatch
        mode={mode}
        onCreate={() => setCreateOpen(true)}
        onPlayDemo={mode === 'pack' ? () => setDemoOpen(true) : undefined}
        canCreate={mode === 'royale' ? canCreateRoyale(meWallet) : true}
      />

      <div>
        {/* Battle Royale uses the new wide lobby card; Pack Battle keeps the compact LiveBattles grid. */}
        {mode === 'royale' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {royaleOpen.length === 0
              ? <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>No open Battle Royale lobbies right now.</div>
              : royaleOpen.map((b) => (
                  <RoyaleBattleWide key={b.id} battle={b} meWallet={meWallet}
                    onAction={onBattleAction} onCancel={onCancel} onOpen={(x) => navigate('/play/battle/' + x.id)} />
                ))}

            {/* Recientes bajo los lobbies, con la MISMA card compacta que el Recent de Live Games
                y su misma rejilla: son la misma cosa enseñada en dos sitios. */}
            {royaleRecent.length > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.2em', color: COLORS.muted }}>
                    RECENT
                  </span>
                  <span style={{ flex: 1, height: 1, background: COLORS.border }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 14 }}>
                  {royaleRecent.map((b) => (
                    <BattleCard
                      key={b.id}
                      battle={b}
                      byCode={byCode}
                      onAction={onBattleAction}
                      onCancel={onCancel}
                      onOpen={(x) => navigate('/play/battle/' + x.id)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : (
          <LiveBattles battles={liveBattles} meWallet={meWallet} onBattleAction={onBattleAction} onCancel={onCancel} onOpen={(b) => navigate('/play/battle/' + b.id)} />
        )}
      </div>

      <DelegationGate gate={gate} />
      {createOpen && (
        <CreateBattleModal
          lockedMode={mode}
          onClose={() => setCreateOpen(false)}
          onCreated={(id) => { setCreateOpen(false); navigate('/play/battle/' + id) }}
        />
      )}
      {demoOpen && (
        <DemoPicker
          onClose={() => setDemoOpen(false)}
          onPick={(m) => { setDemoOpen(false); navigate('/play/demo/' + m) }}
        />
      )}
    </div>
  )
}
