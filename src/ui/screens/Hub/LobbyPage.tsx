import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { battleHref } from '../../battle/battleHref'
import { useNavigate } from 'react-router-dom'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS } from '../../theme'
import type { LiveBattle } from './hubMockData'
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
import { FILTROS, leerFiltro, muestra } from './lobbyFilter'

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
  const filtro = leerFiltro(params.toString() ? `?${params.toString()}` : '')
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

  const todas = battles.map((b) => openBattleToLive(b, meWallet))
  const packBattles = muestra(filtro, 'pack') ? todas.filter((b) => b.mode === 'pack') : []
  const liveBattles = muestra(filtro, 'royale') ? todas.filter((b) => b.mode === 'royale') : []
  // Lobbies Y partidas en curso: una royale arrancada desaparecía de la sección entera —también
  // para quien la estaba jugando—, y solo se volvía a ver en el modal de "te las perdiste". Las
  // terminadas sí se quedan fuera: para esas está la tarjeta de recap. La card ya distingue el
  // caso (`action: join | watch` y el estado "Live" en rojo).
  const royaleOpen = liveBattles.filter((b) => !b.battleStatus || b.battleStatus === 'lobby' || b.battleStatus === 'running')
  // Royale terminadas, para la sección "Recent" bajo los lobbies. Solo en la página de royale.
  const royaleRecent = muestra(filtro, 'royale') ? settledRoyales(liveBattles) : []
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
      {/* El filtro. `All` primero y por defecto: es el que enseña que hay gente jugando. */}
      <div role="tablist" aria-label="Game mode" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {FILTROS.map((f) => {
          const activo = filtro === f.id
          const n = f.id === 'all' ? royaleOpen.length + packBattles.length
            : f.id === 'pack' ? packBattles.length : royaleOpen.length
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={activo}
              onClick={() => setParams(f.id === 'all' ? {} : { mode: f.id })}
              style={{
                padding: '8px 14px', borderRadius: 11, cursor: 'pointer', minHeight: 44,
                fontFamily: FONTS.mono, fontSize: 11.5, letterSpacing: '.06em',
                border: `1px solid ${activo ? COLORS.green : COLORS.border}`,
                background: activo ? `${COLORS.green}1a` : 'transparent',
                color: activo ? COLORS.green : COLORS.muted,
              }}
            >
              {f.label}
              {/* La cuenta va SIEMPRE, también en cero: es la diferencia entre "no hay nadie" y
                  "todavía no ha cargado", y en un lobby vacío esa duda es lo que echa a la gente. */}
              <span style={{ marginLeft: 7, opacity: .75 }}>{n}</span>
            </button>
          )
        })}
      </div>

      {/* Arriba del todo: ver la demo ANTES de encontrarse con el precio y el botón de unirse. */}
      {filtro === 'royale' && <RoyaleDemoNotice />}

      <QuickMatch
        mode={filtro === 'all' ? 'pack' : filtro}
        onCreate={() => setCreateOpen(true)}
        onPlayDemo={muestra(filtro, 'pack') ? () => setDemoOpen(true) : undefined}
        canCreate={filtro === 'royale' ? canCreateRoyale(meWallet) : true}
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        {/* Con el filtro en `all` van las dos listas, cada una con su encabezado y su tarjeta:
            Royale la ancha, Pack la rejilla compacta. Se mezcla la LISTA, no las tarjetas. */}
        {muestra(filtro, 'royale') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filtro === 'all' && <Encabezado texto="BATTLE ROYALE" n={royaleOpen.length} />}
            {royaleOpen.length === 0
              ? <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>No open Battle Royale lobbies right now.</div>
              : royaleOpen.map((b) => (
                  <RoyaleBattleWide key={b.id} battle={b} meWallet={meWallet}
                    onAction={onBattleAction} onCancel={onCancel} onOpen={(x) => navigate(battleHref(x.id, { status: x.battleStatus }))} />
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
                      onOpen={(x) => navigate(battleHref(x.id, { status: x.battleStatus }))}
                      onReplay={onReplay}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {muestra(filtro, 'pack') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {filtro === 'all' && <Encabezado texto="PACK BATTLE" n={packBattles.length} />}
            <LiveBattles battles={packBattles} meWallet={meWallet} onBattleAction={onBattleAction} onCancel={onCancel} onReplay={onReplay} onOpen={(b) => navigate(battleHref(b.id, { status: b.battleStatus }))} />
          </div>
        )}
      </div>

      <DelegationGate gate={gate} />
      {createOpen && (
        /* Con el filtro en `all` NO se fija el modo: el modal deja elegirlo, que es lo honesto
           cuando el usuario todavía no ha dicho a qué quiere jugar. */
        <CreateBattleModal
          lockedMode={filtro === 'all' ? undefined : filtro}
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

/** Separador de sección. Solo aparece con el filtro en `all`, que es cuando conviven las dos
 *  listas y hace falta decir de qué modo es cada tarjeta.
 *
 *  Es un `h2` de verdad y no un `div` con letra pequeña: partido en dos secciones, la página tiene
 *  una jerarquía real, y quien navega con lector de pantalla necesita poder saltar entre ellas. */
function Encabezado({ texto, n }: { texto: string; n: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <h2 style={{ margin: 0, fontFamily: FONTS.mono, fontWeight: 400, fontSize: 11, letterSpacing: '.2em', color: COLORS.muted }}>
        {texto}
      </h2>
      <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.text }}>{n}</span>
      <span style={{ flex: 1, height: 1, background: COLORS.border }} />
    </div>
  )
}
