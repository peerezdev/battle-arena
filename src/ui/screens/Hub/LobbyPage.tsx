import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { battleHref } from '../../battle/battleHref'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import type { LiveBattle } from './hubMockData'
import { QuickMatch } from './QuickMatch'
import { LiveBattles, BattleCard } from './LiveBattles'
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
import { leerModos, paramModos } from './lobbyFilter'

/**
 * El Lobby: TODAS las partidas abiertas, con el modo como filtro.
 *
 * Antes eran dos páginas, /play/arena y /play/royale, que renderizaban esto mismo con un prop
 * distinto. Se unieron por la liquidez: con pocos jugadores a la vez, partir la lista en dos hace
 * que cada mitad parezca vacía y el juego muerto. Ver `lobbyFilter`.
 *
 * Las LISTAS se mezclan, las TARJETAS no: cada modo conserva la suya (Royale la ancha, Pack la
 * rejilla compacta) bajo su propio encabezado, porque tienen reglas y riesgo distintos y una card
 * que no grita de qué modo es sería peor que tenerlas separadas.
 */
export function LobbyPage() {
  const [params, setParams] = useSearchParams()
  const modos = leerModos(params.toString() ? `?${params.toString()}` : '')
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

  // Se le pasan TODAS a LiveBattles: el filtro de modo lo aplica él, que es quien tiene el
  // desplegable. Aquí solo se decide qué entra en el lobby y qué va a "Recent".
  const enLobby = battles.map((b) => openBattleToLive(b, meWallet))
  // Lobbies Y partidas en curso: una royale arrancada desaparecía de la sección entera —también
  // para quien la estaba jugando—, y solo se volvía a ver en el modal de "te las perdiste". Las
  // terminadas sí se quedan fuera: para esas está la tarjeta de recap. La card ya distingue el
  // caso (`action: join | watch` y el estado "Live" en rojo).

  // Royale terminadas, para la sección "Recent" bajo los lobbies. Solo en la página de royale.
  const royaleRecent = modos.has('royale') ? settledRoyales(enLobby.filter((b) => b.mode === 'royale')) : []
  const byCode = useMemo(() => new Map(machines.map((m) => [m.code, m])), [machines])

  // Los fallos de estas acciones van SIEMPRE por toast. El aviso nace de pulsar un botón de una
  // card, y un banner sobre la lista deja el mensaje lejos de lo que lo provocó — y encima
  // desplaza las cards al aparecer.
  const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

  function onCancel(b: LiveBattle) {
    if (!identityToken) { showToast('Sign in to cancel'); return }
    cancelBattle(identityToken, b.id).catch((e) => showToast(errMsg(e)))
  }

  // Replay = la ruta SIN ?view=result, que es lo que deja correr el reveal otra vez.
  const onReplay = (b: LiveBattle) => navigate(battleHref(b.id, { view: 'reveal' }))

  function onBattleAction(b: LiveBattle) {
    // 'watch' cubre tanto Watch (en juego) como Result (liquidada): battleHref las separa.
    if (b.action === 'watch') { navigate(battleHref(b.id, { status: b.battleStatus })); return }
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
      {/* Solo cuando se está mirando Battle Royale: ver la demo ANTES de encontrarse con el precio
          y el botón de unirse. Con los dos modos marcados sería un cartel sobre medio lobby. */}
      {modos.has('royale') && modos.size === 1 && <RoyaleDemoNotice />}

      <QuickMatch
        mode={modos.size === 1 ? [...modos][0] : 'pack'}
        onCreate={() => setCreateOpen(true)}
        onPlayDemo={modos.has('pack') ? () => setDemoOpen(true) : undefined}
        canCreate={modos.size === 1 && modos.has('royale') ? canCreateRoyale(meWallet) : true}
      />

      {/* UNA sola lista con los dos modos mezclados y la MISMA tarjeta para ambos. LiveBattles ya
          pintaba una rejilla uniforme que sirve para cualquier modo, y la propia tarjeta lleva su
          chapa de Pack Battle o Battle Royale, así que no hacía falta nada más. Sacar las royale
          a una tarjeta ancha aparte partía la lista en dos alturas y obligaba a bajar para ver la
          otra mitad. */}
      <LiveBattles
        battles={enLobby}
        meWallet={meWallet}
        modos={modos}
        onModos={(m) => setParams(paramModos(m))}
        onBattleAction={onBattleAction}
        onCancel={onCancel}
        onReplay={onReplay}
        onOpen={(b) => navigate(battleHref(b.id, { status: b.battleStatus }))}
      />

      {/* Royale terminadas, debajo y con la misma tarjeta compacta: son lo mismo enseñado en otro
          sitio. Solo aparecen si se están mirando royale. */}
      {royaleRecent.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h2 style={{ margin: 0, fontFamily: FONTS.mono, fontWeight: 400, fontSize: 11, letterSpacing: '.2em', color: COLORS.muted }}>
              RECENT
            </h2>
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
                onOpen={(x) => navigate(battleHref(x.id, { status: x.battleStatus }))}
                onReplay={onReplay}
              />
            ))}
          </div>
        </div>
      )}

      <DelegationGate gate={gate} />
      {createOpen && (
        /* Solo se fija el modo si el usuario está mirando UNO. Con los dos marcados no ha dicho
           a qué quiere jugar, así que lo elige en el modal. */
        <CreateBattleModal
          lockedMode={modos.size === 1 ? [...modos][0] : undefined}
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
