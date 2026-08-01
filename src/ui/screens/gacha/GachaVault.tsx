// GachaVault — Polished gacha entry screen.
// Shows machine selector, pack detail, and card pool grid.
// Opening a pack uses the same buy() → sign → submit → poll → reveal flow as GachaScreen.
import { useEffect, useRef, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useIdentityToken } from '@privy-io/react-auth'
import { useWallet } from '../../../wallet/useWallet'
import { useUsdcBalance } from '../../../wallet/useUsdcBalance'
import { holdBalance } from '../../../wallet/balanceHold'
import { notifyPendingPacksChanged } from './pendingPacksBus'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  fetchMachines,
  fetchMachineCards,
  machineCardCount,
  generatePack,
  markPacksRevealed,
  generateYoloPacks,
  submitTx,
  openPack,
  pollOpenPack,
  requestBuyback,
  GachaDisabledError,
  ccAssetUrl,
  type GachaMachine,
  type MachineCard,
  type PendingPack,
  type OpenPackResult,
  type YoloPacksResponse,
} from '../../../onchain/gachaClient'
import { COLORS, FONTS, RARITY, SHADOW, GRADIENT, formatUsd, rarityGlow } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import { HoloCard } from '../../components/HoloCard'
import { showToast } from '../../toastBus'
import { useIsWide } from '../../useIsWide'
import { MachineDetailPanel } from './MachineDetailPanel'
import { useStickyFollow } from '../../useStickyFollow'
import { CardBadge } from '../../components/CardBadge'
import { GachaCardReveal } from './GachaCardReveal'
import { GachaPackTilt, packTitle, priceFromCode } from './GachaPackTilt'
import { pendingPackToResult } from './pendingToResult'
import { CardPoolGrid } from './CardPoolGrid'

// Live Drops are no longer recorded locally on open — the backend broadcasts
// each drop over the chat WebSocket after a delay, so the opener never sees
// their own drop spoil the reveal. See ChatDock's WS `drop` handler.

// Map capitalized rarity → RARITY color token (same as GachaScreen)
const RARITY_COLOR: Record<string, string> = {
  Epic: RARITY.epic, Rare: RARITY.rare, Uncommon: RARITY.uncommon, Common: RARITY.common,
}

type YoloResult = Extract<OpenPackResult, { pending: false }>

type Phase =
  | { kind: 'machines' }
  | { kind: 'opening'; step: 'firmando' | 'enviando' | 'abriendo' }
  | { kind: 'result'; result: YoloResult }
  | { kind: 'pending'; memo: string }
  // `results` null = todavía generando; no-null = listos, esperando a que el usuario abra.
  // Es UNA sola fase a propósito: si "generando" y "listo" fueran fases distintas, React
  // desmontaría y remontaría el sobre justo al terminar y se perdería el tilt y la posición
  // del brillo en el momento de más atención. Así solo cambia el botón.
  // machineCode/price son los del sobre QUE SE ESTÁ ABRIENDO, no los de la máquina seleccionada
  // en la vault: abriendo un pendiente de la lista pueden no coincidir, y el sobre 3D pintaba la
  // máquina elegida en pantalla en vez de la del sobre.
  | { kind: 'yolo'; step: 'firmando' | 'enviando' | 'abriendo'; done: number; total: number
      machineCode: string; price: number; results: YoloResult[] | null }
  | { kind: 'yolo-reveal'; results: YoloResult[]; index: number }
  | { kind: 'yolo-summary'; results: YoloResult[] }

const STEP_LABEL: Record<'firmando' | 'enviando' | 'abriendo', string> = {
  firmando: 'Sign the transaction in your wallet…',
  enviando: 'Sending to Solana…',
  abriendo: 'Opening the pack…',
}

export default function GachaVault() {
  const reduced = useReducedMotion()
  const wideGacha = useIsWide('(min-width: 880px)')
  // El panel de la máquina sigue la dirección del scroll: anclado arriba, sus odds
  // quedaban siempre fuera de la ventana.
  const panelSticky = useStickyFollow(wideGacha)
  const { identityToken } = useIdentityToken()
  const { signTransactionBase64 } = useWallet()
  const { usdc } = useUsdcBalance()

  const [machines, setMachines] = useState<GachaMachine[] | null>(null)
  const [selected, setSelected] = useState<GachaMachine | null>(null)
  const [disabled, setDisabled] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'machines' })

  // Mientras la tirada no esté revelada, el saldo mostrado se congela. Con turbo, CC recompra
  // las commons nada más abrir el sobre por dentro, así que el USDC sube antes de que el jugador
  // vea nada: si la cabecera lo refleja, le destripa el resultado. Se suelta al volver a la
  // pantalla de máquinas, que es cuando ya ha visto lo que le tocó.
  const inPullFlow = phase.kind === 'yolo' || phase.kind === 'yolo-reveal' || phase.kind === 'yolo-summary'
  useEffect(() => {
    if (!inPullFlow) return
    return holdBalance()
  }, [inPullFlow])

  // ── Sobres pagados y sin abrir ─────────────────────────────────────────────
  // Se consultan al entrar. Aparecen si el jugador abrió otra pestaña a mitad de una tirada o
  // cerró la página antes de revelar; antes quedaban huérfanos, pagados y sin forma de llegar a
  // ellos. El saldo se mantiene congelado mientras el modal está abierto, porque el auto-buyback
  // del turbo ya habrá movido el USDC y verlo delataría lo que hay dentro.
  // AppShell muestra el modal de pendientes en cualquier sección, pero abrirlos ocurre aquí,
  // que es donde vive el reveal. Llega por router state y se consume una sola vez: si no se
  // limpiara, volver atrás en el historial relanzaría la apertura.
  const location = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const packs = (location.state as { openPacks?: PendingPack[] } | null)?.openPacks
    if (!packs || packs.length === 0 || !identityToken) return
    navigate(location.pathname, { replace: true, state: null })
    void openPendingPacks(packs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, identityToken])

  // Memos del lote que se está revelando. Se marcan como vistos al TERMINAR el reveal (volver a
  // máquinas), no al empezarlo: si el jugador cierra a mitad siguen pendientes y los recupera.
  // Ante la duda, repetir un reveal es inofensivo; perderlo no.
  const batchMemos = useRef<string[]>([])
  const prevPhase = useRef(phase.kind)
  useEffect(() => {
    const was = prevPhase.current
    prevPhase.current = phase.kind
    const cameFromReveal = was === 'yolo-reveal' || was === 'yolo-summary'
    if (!cameFromReveal || phase.kind !== 'machines') return
    const memos = batchMemos.current
    batchMemos.current = []
    if (memos.length > 0 && identityToken) {
      markPacksRevealed(identityToken, memos)
        .then(notifyPendingPacksChanged)   // AppShell relee y suelta el saldo: ya las ha visto
        .catch(() => { /* se reintenta la próxima vez */ })
    }
  }, [phase.kind, identityToken])

  /** Abre (o reproduce) los sobres pendientes y encadena el reveal, como una tirada normal.
   *
   *  Los que CC ya resolvió NO se reabren: su carta está guardada, así que el reveal se
   *  reconstruye con lo que hay en la fila más la metadata por mint. Volver a llamar a open-pack
   *  para esos sería pedirle a CC algo que ya nos dio. */
  async function openPendingPacks(packs: PendingPack[]) {
    if (!identityToken || packs.length === 0) return
    // El sobre 3D pinta el del primer pendiente del lote. Si se abren varios de máquinas
    // distintas no hay un único sobre que los represente; el primero es el que se abre antes.
    const batchCode = packs[0].pack_type
    const batchPrice = machines?.find((m) => m.code === batchCode)?.price ?? priceFromCode(batchCode) ?? 0
    const results: YoloResult[] = []
    for (let i = 0; i < packs.length; i++) {
      const p = packs[i]
      setPhase({ kind: 'yolo', step: 'abriendo', done: i, total: packs.length, machineCode: batchCode, price: batchPrice, results: null })
      try {
        const r = await pendingPackToResult(identityToken, p)
        if (r) results.push(r)
      } catch { /* se salta: sigue pendiente y se reintenta */ }
    }
    if (results.length === 0) {
      showToast("Those packs aren't ready yet. Try again in a moment.", 'error')
      setPhase({ kind: 'machines' })
      return
    }
    batchMemos.current = packs.map((p) => p.memo)
    // Igual que una tirada normal: se queda en el sobre esperando el click, NO salta al reveal.
    // Antes iba directo a 'yolo-reveal' y el sobre 3D aparecía y se abría solo, con la carta ya
    // revelada: el momento de abrir es del jugador, venga de una tirada o de la lista.
    setPhase({ kind: 'yolo', step: 'abriendo', done: results.length, total: results.length,
               machineCode: batchCode, price: batchPrice, results })
  }
  // Pending open awaiting the user's YES/NO confirmation.
  const [confirm, setConfirm] = useState<{ count: number; turbo: boolean } | null>(null)

  const [cards, setCards] = useState<MachineCard[]>([])
  const [cardsLoading, setCardsLoading] = useState(false)
  const [cardsError, setCardsError] = useState(false)

  // ── Machine row horizontal scroll (desktop mouse users get no visible scrollbar) ──
  const machineRowRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  useEffect(() => {
    const el = machineRowRef.current
    if (!el) return
    function update() {
      if (!el) return
      setCanScrollLeft(el.scrollLeft > 0)
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [machines])

  function scrollMachineRow(dir: -1 | 1) {
    machineRowRef.current?.scrollBy({ left: dir * 240, behavior: 'smooth' })
  }

  // ── Load machines on mount + 60s availability poll ─────────────────────────
  useEffect(() => {
    let mounted = true

    function applyMachines(ms: GachaMachine[]) {
      if (!mounted) return
      setMachines(ms)
      // On first load, select the first machine. On subsequent polls, preserve
      // the user's selection by code — only swap to the refreshed object so
      // `available` and other fields stay current.
      setSelected((cur) =>
        cur
          ? (ms.find((m) => m.code === cur.code) ?? cur)
          : (ms.find((m) => m.available !== false) ?? ms[0] ?? null),   // default to an OPEN machine
      )
    }

    fetchMachines()
      .then(applyMachines)
      .catch((e) => {
        if (!mounted) return
        e instanceof GachaDisabledError ? setDisabled(true) : setFetchError(String(e))
      })

    const id = setInterval(() => {
      fetchMachines()
        .then(applyMachines)
        .catch(() => { /* ignore poll failures — stale data is fine */ })
    }, 60_000)

    return () => {
      mounted = false
      clearInterval(id)
    }
  }, [])

  // ── Load card pool when selected machine changes ────────────────────────────
  // A page at a time: these pools hold hundreds of cards (pokemon_50 has 733), and the heading
  // already announces that total — so loading a single page of 24 claimed a pool it wasn't
  // showing. 100 is the most the backend serves per request.
  const POOL_PAGE = 100
  const [poolPage, setPoolPage] = useState(1)
  const [poolDone, setPoolDone] = useState(false)
  const poolReq = useRef(0)

  const loadPoolPage = useCallback((code: string, page: number) => {
    const req = ++poolReq.current       // a machine switch mid-flight must not append to the new pool
    setCardsLoading(true)
    setCardsError(false)
    fetchMachineCards(code, { page, limit: POOL_PAGE })
      .then((batch) => {
        if (req !== poolReq.current) return
        setCards((prev) => {
          const base = page === 1 ? [] : prev
          const seen = new Set(base.map((c) => c.nft_address))
          return base.concat(batch.filter((c) => !c.nft_address || !seen.has(c.nft_address)))
        })
        setPoolPage(page)
        setPoolDone(batch.length < POOL_PAGE)   // short page = end of pool; the response has no total
      })
      .catch(() => { if (req === poolReq.current) setCardsError(true) })
      .finally(() => { if (req === poolReq.current) setCardsLoading(false) })
  }, [])

  useEffect(() => {
    if (!selected) return
    setCards([])
    setPoolPage(1)
    setPoolDone(false)
    loadPoolPage(selected.code, 1)
  }, [selected?.code, loadPoolPage])

  // ── Buy / open flow (mirrors GachaScreen.buy) ──────────────────────────────
  async function retryOpen(memo: string) {
    if (!identityToken) return
    setPhase({ kind: 'opening', step: 'abriendo' })
    try {
      const result = await pollOpenPack(() => openPack(identityToken, memo))
      if (result.pending) {
        setPhase({ kind: 'pending', memo })
      } else {
        setPhase({ kind: 'result', result })
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error')
      setPhase({ kind: 'pending', memo })
    }
  }

  async function handleYolo(count: number, turbo: boolean) {
    if (!selected || !identityToken) return
    const total = (selected.price ?? 0) * count
    if (usdc != null && usdc < total) {
      showToast(`Insufficient USDC — ${count} pack${count === 1 ? '' : 's'} cost $${total}. Deposit and try again.`, 'error')
      return
    }
    const submitted: string[] = []
    let lastErr: string | null = null

    // Dos caminos, y el que decide es el turbo:
    //
    //  · turbo OFF → un generate-pack por sobre. YOLO auto-vende las commons, así que usarlo
    //    para una tirada normal le quitaría cartas al usuario sin haberlas pedido. Cuesta N
    //    peticiones en vez de 1, pero además esa ruta SÍ valida en servidor máquina apagada
    //    (409) y saldo disponible (402), cosa que /gacha/yolo no hace.
    //
    //  · turbo ON → un solo /gacha/yolo para toda la tanda. Aquí el auto-buyback es justo lo
    //    que el usuario ha pedido, y 5 sobres se resuelven en una petición en vez de cinco.
    if (turbo) {
      let resp: YoloPacksResponse
      try {
        setPhase({ kind: 'yolo', step: 'firmando', done: 0, total: count, machineCode: selected.code, price: selected.price ?? 0, results: null })
        resp = await generateYoloPacks(identityToken, selected.code, count, true)
      } catch (e) {
        showToast(`Couldn't open the pack: ${e instanceof Error ? e.message : String(e)}`, 'error')
        setPhase({ kind: 'machines' })
        return
      }
      const txs = resp.transactions
      for (let i = 0; i < txs.length; i++) {
        try {
          setPhase({ kind: 'yolo', step: 'firmando', done: i, total: txs.length, machineCode: selected.code, price: selected.price ?? 0, results: null })
          const signed = await signTransactionBase64(txs[i].transaction)
          setPhase({ kind: 'yolo', step: 'enviando', done: i, total: txs.length, machineCode: selected.code, price: selected.price ?? 0, results: null })
          await submitTx(identityToken, signed, txs[i].memo)
          submitted.push(txs[i].memo)
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e)
          break
        }
      }
    } else {
      for (let i = 0; i < count; i++) {
        try {
          setPhase({ kind: 'yolo', step: 'firmando', done: i, total: count, machineCode: selected.code, price: selected.price ?? 0, results: null })
          const pack = await generatePack(identityToken, selected.code)
          const signed = await signTransactionBase64(pack.transaction)
          setPhase({ kind: 'yolo', step: 'enviando', done: i, total: count, machineCode: selected.code, price: selected.price ?? 0, results: null })
          await submitTx(identityToken, signed, pack.memo)
          submitted.push(pack.memo)
        } catch (e) {
          // Se corta aquí: los sobres ya enviados se abren igual más abajo.
          lastErr = e instanceof Error ? e.message : String(e)
          break
        }
      }
    }
    if (submitted.length === 0) {
      showToast(lastErr ? `Couldn't open the pack: ${lastErr}` : 'No packs were opened.', 'error')
      setPhase({ kind: 'machines' })
      return
    }
    const results: YoloResult[] = []
    for (let i = 0; i < submitted.length; i++) {
      setPhase({ kind: 'yolo', step: 'abriendo', done: i, total: submitted.length, machineCode: selected.code, price: selected.price ?? 0, results: null })
      try {
        const r = await pollOpenPack(() => openPack(identityToken, submitted[i]))
        if (!r.pending) { results.push(r) }
      } catch { /* skip */ }
    }
    if (results.length === 0) { setPhase({ kind: 'pending', memo: submitted[0] }); return }
    // Listos, pero NO se revela solo: el sobre queda esperando a que el usuario lo abra.
    batchMemos.current = submitted
    setPhase({ kind: 'yolo', step: 'abriendo', done: results.length, total: results.length,
               machineCode: selected.code, price: selected.price ?? 0, results })
  }

  // ── Disabled state ──────────────────────────────────────────────────────────
  if (disabled) {
    return (
      <div
        style={{
          maxWidth: 520,
          margin: '60px auto',
          padding: '0 20px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 14,
            padding: 32,
            color: COLORS.muted,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 14 }}>🎰</div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontWeight: 800,
              color: COLORS.text,
              marginBottom: 8,
            }}
          >
            Gacha is unavailable.
          </div>
          The Gacha API key isn't configured in the backend (GACHA_API_KEY).
        </div>
      </div>
    )
  }

  // ── Main layout ─────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        padding: wideGacha ? '24px 28px 48px' : '16px 14px 96px',   // extra bottom on mobile clears the sticky action bar
        position: 'relative',
      }}
    >
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      {/* <div style={{ marginBottom: 28 }}>
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: COLORS.muted,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          GACHA VAULT
        </div>
        <h1
          style={{
            fontFamily: FONTS.display,
            fontWeight: 900,
            fontSize: 32,
            color: COLORS.text,
            margin: 0,
            letterSpacing: '-.01em',
          }}
        >
          PACKS
        </h1>
        <div
          style={{
            fontFamily: FONTS.body,
            fontSize: 14,
            color: COLORS.muted,
            marginTop: 6,
          }}
        >
          Open packs solo — keep them or sell back.
        </div>
      </div> */}

      {/* ── FETCH ERROR ─────────────────────────────────────────────────────── */}
      {fetchError && (
        <div
          style={{
            background: '#300a0f',
            border: `1px solid ${COLORS.red}`,
            color: COLORS.red,
            borderRadius: 8,
            padding: '12px 14px',
            fontSize: 13,
            marginBottom: 18,
          }}
        >
          {fetchError}
        </div>
      )}

      {/* ── MACHINE SELECTOR STRIP ──────────────────────────────────────────── */}
      {machines === null && !fetchError && (
        <div
          style={{
            color: COLORS.muted,
            fontSize: 13,
            textAlign: 'center',
            padding: '40px 0',
            fontFamily: FONTS.body,
          }}
        >
          Loading machines…
        </div>
      )}

      {machines !== null && machines.length === 0 && (
        <div
          style={{
            color: COLORS.muted,
            fontSize: 13,
            textAlign: 'center',
            padding: '40px 0',
            fontFamily: FONTS.body,
          }}
        >
          No machines available right now.
        </div>
      )}

      {machines !== null && machines.length > 0 && (
        <div style={{ position: 'relative', marginBottom: 28 }}>
          <div
            ref={machineRowRef}
            style={{
              display: 'flex',
              gap: 10,
              overflowX: 'auto',
              paddingBottom: 8,
              scrollbarWidth: 'none',
            }}
          >
            {[...machines].filter((m) => m.available !== false).sort((a, b) => (a.price ?? 0) - (b.price ?? 0)).map((m) => {
              const isActive = selected?.code === m.code
              return (
                <button
                  key={m.code}
                  onClick={() => setSelected(m)}
                  style={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    background: isActive ? COLORS.panel2 : COLORS.panel,
                    border: isActive
                      ? `1.5px solid ${COLORS.green}`
                      : `1px solid ${COLORS.border}`,
                    borderRadius: 12,
                    padding: '10px 14px',
                    cursor: 'pointer',
                    color: COLORS.text,
                    boxShadow: isActive ? SHADOW.glow(COLORS.green) : 'none',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                >
                  {(m.thumbnailUrl ?? m.image) ? (
                    <img
                      src={(m.thumbnailUrl ?? m.image)!}
                      alt={m.name}
                      style={{
                        width: 36,
                        height: 36,
                        objectFit: 'contain',
                        borderRadius: 6,
                        border: `1px solid ${COLORS.border}`,
                      }}
                    />
                  ) : (
                    <span style={{ fontSize: 24, lineHeight: 1 }}>🎰</span>
                  )}
                  <div style={{ textAlign: 'left' }}>
                    <div
                      style={{
                        fontFamily: FONTS.display,
                        fontWeight: 700,
                        fontSize: 13,
                        color: COLORS.text,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {m.shortName ?? m.name}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {canScrollLeft && (
            <MachineRowArrow dir="left" onClick={() => scrollMachineRow(-1)} />
          )}
          {canScrollRight && (
            <MachineRowArrow dir="right" onClick={() => scrollMachineRow(1)} />
          )}
        </div>
      )}

      {/* ── BODY (two-column wide / stacked narrow, panel-first) ────────────── */}
      {selected && (() => {
        const poolEl = (
          <CardPoolGrid
            cards={cards}
            loading={cardsLoading && cards.length === 0}
            liveCount={machineCardCount(selected.stock) ?? undefined}
            error={cardsError && cards.length === 0}
            machineCode={selected.code}
            onLoadMore={() => loadPoolPage(selected.code, poolPage + 1)}
            hasMore={!poolDone}
            loadingMore={cardsLoading}
            loadMoreError={cardsError && cards.length > 0}
          />
        )
        // El `top` lo pone useStickyFollow, no el JSX: con los dos escribiéndolo se disputarían
        // la misma propiedad en cada render.
        const panelEl = (
          <div ref={panelSticky} style={wideGacha ? { position: 'sticky' } : undefined}>
            <MachineDetailPanel
              machine={selected}
              authed={!!identityToken}
              usdc={usdc}
              onYolo={(c, t) => setConfirm({ count: c, turbo: t })}
            />
          </div>
        )
        return (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: wideGacha ? '1fr minmax(320px, 400px)' : '1fr',
              gap: wideGacha ? 24 : 18,
              alignItems: 'start',
            }}
          >
            {wideGacha ? (<>{poolEl}{panelEl}</>) : (<>{panelEl}{poolEl}</>)}
          </div>
        )
      })()}

      {/* ── OPEN ERROR BANNER ───────────────────────────────────────────────── */}

      {/* ── REVEAL OVERLAY ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {(phase.kind === 'opening' || phase.kind === 'pending' || phase.kind === 'result') && (
          <RevealOverlay
            phase={phase}
            reduced={reduced}
            buybackPct={selected?.instantBuyback ?? null}
            onRetry={(memo) => void retryOpen(memo)}
            onClose={() => setPhase({ kind: 'machines' })}
          />
        )}
        {phase.kind === 'yolo' && (
          <motion.div key="yolo-pack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(6,8,11,0.94)', zIndex: 200,
              display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, overflowY: 'auto' }}>
            <GachaPackTilt
              machineCode={phase.machineCode}
              price={phase.price}
              count={phase.total}
              ready={phase.results !== null}
              done={phase.done}
              total={phase.total}
              reduced={reduced}
              onOpen={() => {
                const r = phase.results
                if (r) setPhase({ kind: 'yolo-reveal', results: r, index: 0 })
              }}
            />
          </motion.div>
        )}
        {phase.kind === 'yolo-reveal' && (
          <YoloRevealOverlay
            results={phase.results}
            index={phase.index}
            reduced={reduced}
            buybackPct={selected?.instantBuyback ?? null}
            onAdvance={() => setPhase((p) => {
              if (p.kind !== 'yolo-reveal') return p
              if (p.index + 1 < p.results.length) return { kind: 'yolo-reveal', results: p.results, index: p.index + 1 }
              // last pack: single open closes straight to the vault (no summary); multi → summary
              return p.results.length === 1 ? { kind: 'machines' } : { kind: 'yolo-summary', results: p.results }
            })}
            onSkipAll={() => setPhase((p) => p.kind === 'yolo-reveal' ? { kind: 'yolo-summary', results: p.results } : p)}
          />
        )}
        {phase.kind === 'yolo-summary' && (
          <YoloSummaryOverlay results={phase.results} machineCodes={phase.results.map(() => selected?.code ?? '')} buybackPct={selected?.instantBuyback ?? null} onClose={() => setPhase({ kind: 'machines' })} />
        )}
        {confirm && selected && (
          <ConfirmOpenModal
            count={confirm.count}
            machineName={selected.name}
            image={selected.thumbnailUrl || selected.image || null}
            total={(selected.price ?? 0) * confirm.count}
            reduced={reduced}
            onYes={() => { const c = confirm; setConfirm(null); void handleYolo(c.count, c.turbo) }}
            onNo={() => setConfirm(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Machine row scroll arrow (desktop mouse users have no visible scrollbar) ──
function MachineRowArrow({ dir, onClick }: { dir: 'left' | 'right'; onClick: () => void }) {
  const isLeft = dir === 'left'
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 8,
        left: isLeft ? 0 : undefined,
        right: isLeft ? undefined : 0,
        width: 52,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isLeft ? 'flex-start' : 'flex-end',
        background: isLeft
          ? `linear-gradient(90deg, ${COLORS.bg} 20%, transparent 100%)`
          : `linear-gradient(270deg, ${COLORS.bg} 20%, transparent 100%)`,
        pointerEvents: 'none',
        zIndex: 5,
      }}
    >
      <button
        onClick={onClick}
        aria-label={isLeft ? 'Scroll machines left' : 'Scroll machines right'}
        style={{
          pointerEvents: 'auto',
          width: 32,
          height: 32,
          flexShrink: 0,
          borderRadius: '50%',
          border: `1px solid ${COLORS.border}`,
          background: COLORS.panel2,
          color: COLORS.text,
          fontFamily: FONTS.display,
          fontSize: 16,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: SHADOW.panel,
        }}
      >
        {isLeft ? '‹' : '›'}
      </button>
    </div>
  )
}

// ── Open confirmation modal ───────────────────────────────────────────────────
function ConfirmOpenModal({ count, machineName, image, total, onYes, onNo, reduced }: {
  count: number
  machineName: string
  image: string | null
  total: number
  onYes: () => void
  onNo: () => void
  reduced: boolean
}) {
  const [imgErr, setImgErr] = useState(false)
  // Single fixed accent (no per-card rarity here — we're confirming an open, not revealing).
  const accent = COLORS.violet
  const accentSoft = 'rgba(255,46,151,.13)'
  const accentBd = 'rgba(255,46,151,.4)'
  const accentGlow = 'rgba(255,46,151,.6)'
  return (
    <motion.div
      key="confirm-open"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.16 }}
      onClick={onNo}
      style={{
        position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'clamp(14px,2.5vw,32px)',
        background: `radial-gradient(900px 640px at 50% -8%,${accentSoft},transparent 56%),rgba(4,6,9,.9)`,
        backdropFilter: 'blur(9px)', WebkitBackdropFilter: 'blur(9px)',
      }}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: reduced ? 1 : 0.92, opacity: 0, y: reduced ? 0 : 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: reduced ? 1 : 0.96, opacity: 0 }}
        transition={{ duration: reduced ? 0 : 0.42, ease: [0.2, 0.9, 0.25, 1] }}
        style={{
          position: 'relative', width: '100%', maxWidth: 380, borderRadius: 22,
          background: 'linear-gradient(180deg,#10131a,#0a0c12)', border: `1px solid ${accentBd}`,
          boxShadow: `0 0 0 1px rgba(0,0,0,.4),0 48px 120px -40px #000,0 0 80px -26px ${accentGlow}`,
          padding: '34px 28px 24px', textAlign: 'center',
        }}
      >
        {/* close */}
        <button onClick={onNo} aria-label="Close" style={{ position: 'absolute', top: 16, right: 16, width: 30, height: 30, borderRadius: 9, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)', color: '#9aa4b2', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>

        {/* pack icon */}
        <div style={{ position: 'relative', width: 96, height: 96, margin: '4px auto 20px' }}>
          <span style={{ position: 'absolute', inset: '-14%', borderRadius: '50%', background: `radial-gradient(circle,${accentGlow},transparent 66%)`, filter: 'blur(16px)', animation: reduced ? 'none' : 'ca-haloPulse 3.2s ease-in-out infinite' }} />
          <div style={{ position: 'relative', width: '100%', height: '100%', borderRadius: 20, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg,rgba(255,46,151,.22),rgba(255,46,151,.06))', border: `1px solid ${accentBd}`, boxShadow: `inset 0 1px 0 rgba(255,255,255,.16),0 18px 44px -18px ${accentGlow}`, animation: reduced ? 'none' : 'ca-float 5s ease-in-out infinite' }}>
            {image && !imgErr
              ? <img src={image} alt={machineName} onError={() => setImgErr(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10a8 8 0 0 1 16 0" /><rect x="3" y="10" width="18" height="9" rx="2" /><path d="M3 14h18" /><rect x="10.5" y="12" width="3" height="4" rx="1" fill={accent} stroke="none" /></svg>}
          </div>
        </div>

        {/* title + subtitle */}
        <h2 style={{ margin: '0 0 9px', fontFamily: FONTS.display, fontSize: 24, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: COLORS.text }}>
          Open {count > 1 ? 'these packs' : 'this pack'}?
        </h2>
        <p style={{ margin: '0 0 22px', fontSize: 14, lineHeight: 1.5, color: '#9aa4b2' }}>
          You're about to open <span style={{ color: COLORS.text, fontWeight: 600 }}>x{count} {machineName}</span>.
        </p>

        {/* total box */}
        <div style={{ borderRadius: 13, border: `1px solid ${accentBd}`, background: accentSoft, padding: '14px 16px', marginBottom: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.16em', color: accent }}>TOTAL</span>
          <span style={{ fontFamily: FONTS.display, fontSize: 20, fontWeight: 800, color: accent }}>{formatUsd(total)}</span>
        </div>

        {/* actions: No (secondary) · Yes (primary) */}
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onNo} style={{ flex: 1, padding: 14, borderRadius: 13, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.04)', color: '#cdd4dd', cursor: 'pointer', fontFamily: FONTS.display, fontSize: 14, fontWeight: 700, letterSpacing: '.02em' }}>No</button>
          <button onClick={onYes} style={{ position: 'relative', overflow: 'hidden', flex: 1.4, padding: 14, borderRadius: 13, border: 0, cursor: 'pointer', fontFamily: FONTS.display, fontSize: 14.5, fontWeight: 700, letterSpacing: '.02em', color: '#06170f', background: GRADIENT, boxShadow: `0 14px 38px -14px ${accentGlow}` }}>
            <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: '40%', background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent)', animation: reduced ? 'none' : 'ba-sweep 3.6s infinite' }} />
            <span style={{ position: 'relative' }}>Yes</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Reveal / opening overlay ──────────────────────────────────────────────────
function RevealOverlay({
  phase,
  reduced,
  buybackPct,
  onRetry,
  onClose,
}: {
  phase: Extract<Phase, { kind: 'opening' | 'pending' | 'result' }>
  reduced: boolean
  buybackPct: number | null | undefined
  onRetry: (memo: string) => void
  onClose: () => void
}) {
  return (
    <motion.div
      key="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(11,14,20,0.88)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        // Como el overlay del sobre: con la carta al tamaño del sobre (480 de alto) una pantalla
        // baja no da para todo, y sin esto se recortaba por arriba en vez de poder desplazar.
        overflowY: 'auto',
      }}
    >
      {/* Opening */}
      {phase.kind === 'opening' && (
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: '48px 32px',
            textAlign: 'center',
            maxWidth: 360,
            width: '100%',
            boxShadow: SHADOW.panel,
          }}
        >
          <motion.div
            animate={reduced ? undefined : { opacity: [1, 0.35, 1] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
            style={{ fontSize: 56, marginBottom: 22 }}
          >
            🎰
          </motion.div>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: COLORS.text,
              fontFamily: FONTS.body,
              lineHeight: 1.5,
            }}
          >
            {STEP_LABEL[phase.step]}
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: COLORS.muted,
              fontFamily: FONTS.mono,
              letterSpacing: '.05em',
              textTransform: 'uppercase',
            }}
          >
            {phase.step}
          </div>
        </div>
      )}

      {/* Pending */}
      {phase.kind === 'pending' && (
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 16,
            padding: '40px 28px',
            textAlign: 'center',
            maxWidth: 360,
            width: '100%',
            boxShadow: SHADOW.panel,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>⏳</div>
          <div
            style={{
              fontSize: 14,
              color: COLORS.text,
              lineHeight: 1.6,
              marginBottom: 22,
              fontFamily: FONTS.body,
            }}
          >
            Your pack is being processed on-chain…
          </div>
          <motion.button
            onClick={() => onRetry(phase.memo)}
            whileTap={reduced ? undefined : { scale: 0.96 }}
            style={{
              background: COLORS.green,
              color: '#04130c',
              border: 'none',
              borderRadius: 10,
              padding: '14px 28px',
              fontSize: 14,
              fontWeight: 800,
              cursor: 'pointer',
              fontFamily: FONTS.display,
              letterSpacing: '.03em',
              boxShadow: SHADOW.glow(COLORS.green),
              marginBottom: 10,
              width: '100%',
            }}
          >
            Keep waiting
          </motion.button>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: COLORS.muted,
              cursor: 'pointer',
              fontSize: 13,
              fontFamily: FONTS.body,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Result — staged reveal (single open → inline Keep/Sell) */}
      {phase.kind === 'result' && (
        <RevealResult result={phase.result} reduced={reduced} buybackPct={buybackPct ?? null} single onNext={onClose} />
      )}
    </motion.div>
  )
}

// ── Staged reveal: year → grade → rarity → card ──────────────────────────────
function RevealResult({
  result,
  reduced,
  buybackPct,
  skipToCard,
  single = false,
  onNext,
  onCardStage,
}: {
  result: Extract<OpenPackResult, { pending: false }>
  reduced: boolean
  buybackPct: number | null
  skipToCard?: number
  /** single open → inline Keep/Sell; multi → "Next pack". */
  single?: boolean
  onNext: () => void
  /** Avisa al llegar al detalle de la carta: ya no queda secuencia que saltar. */
  onCardStage?: () => void
}) {
  const rarityColor = RARITY_COLOR[result.rarity] ?? COLORS.muted
  // El detalle de tres columnas pide ~980px; por debajo de eso las piezas se apilan.
  const wide = useIsWide('(min-width: 1040px)')

  // La secuencia previa a la carta (año, grado, casilla de rareza, contador y volteo) vive en
  // GachaCardReveal. Aquí solo se espera a que termine para dar paso al detalle de la carta.
  const [revealed, setRevealed] = useState(reduced || !!skipToCard)
  useEffect(() => { if (skipToCard) setRevealed(true) }, [skipToCard])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (revealed) onCardStage?.() }, [revealed])

  if (!revealed) {
    return (
      <GachaCardReveal
        result={result}
        reduced={reduced}
        skip={!!skipToCard}
        onDone={() => setRevealed(true)}
      />
    )
  }

  // Pre-card stages: year / grade / rarity
  //
  // UN solo AnimatePresence envuelve las dos ramas (etapas y carta), en vez de uno por rama
  // dentro de cada return. AnimatePresence tiene que SOBREVIVIR al cambio para poder animar la
  // salida del hijo que se va; si desaparece del árbol en el mismo commit —como pasaba al saltar
  // de la rareza a la carta— el elemento saliente se corta de golpe en vez de salir.
  // Card stage — rich Card Details view
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="card"
        initial={reduced ? undefined : { scale: 0.82, opacity: 0 }}
        animate={reduced ? undefined : { scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        style={wide ? {
          // Caja fija del diseño: la ficha de la derecha ancla el botón de continuar abajo con
          // `margin-top:auto`, y eso necesita una altura, no un alto que siga al contenido.
          // overflowY por si la ventana es ancha pero baja: 90vh puede quedarse por debajo de
          // los 660 y sin esto la ficha se cortaría sin poder llegar al botón.
          width: 980, maxWidth: '100%', height: 660, maxHeight: '90vh', overflowY: 'auto',
          background: 'linear-gradient(180deg,#12161e,#0c0f15)',
          border: '1px solid rgba(255,255,255,.1)', borderRadius: 22,
          boxShadow: '0 30px 80px -20px rgba(0,0,0,.8)',
        } : {
          // Caja de teléfono del diseño: altura fija para que la ficha ruede por dentro y el
          // botón se quede anclado abajo. `overflow:hidden` porque quien hace scroll es el
          // hueco de la ficha, no la caja entera.
          // Sin los Skip debajo, lo único entre la caja y el borde es el padding de 20 del
          // overlay, así que se lo queda todo: más alto = más ficha visible sin desplazar.
          width: '100%', maxWidth: 430, height: 'min(844px, calc(100vh - 40px))',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          background: `radial-gradient(500px 380px at 50% -5%, ${rarityGlow(result.rarity) ?? 'transparent'}, transparent 70%), #08090d`,
          border: '1px solid rgba(255,255,255,.08)', borderRadius: 24,
          boxShadow: `${SHADOW.panel}, ${SHADOW.glow(rarityColor)}`,
        }}
      >
        <CardDetailsView
          result={result}
          rarityColor={rarityColor}
          buybackPct={buybackPct}
          single={single}
          reduced={reduced}
          wide={wide}
          onNext={onNext}
        />
      </motion.div>
    </AnimatePresence>
  )
}

// ── Rich card details panel (inner — owns activeImg state) ────────────────────
//
// Layout de tres columnas (miniaturas · carta · ficha) en escritorio; en pantallas estrechas
// las mismas piezas se apilan en una sola columna con scroll. Solo lo usa el gacha.
function CardDetailsView({
  result,
  rarityColor,
  buybackPct,
  single,
  reduced,
  wide,
  onNext,
}: {
  result: Extract<OpenPackResult, { pending: false }>
  rarityColor: string
  buybackPct: number | null
  /** single open → se puede vender aquí mismo; multi → solo "Next pack". */
  single: boolean
  reduced: boolean
  wide: boolean
  onNext: () => void
}) {
  const { identityToken } = useIdentityToken()
  const { signTransactionBase64 } = useWallet()
  const [activeImg, setActiveImg] = useState(0)
  const [copied, setCopied] = useState(false)
  const [sold, setSold] = useState(false)
  const [selling, setSelling] = useState(false)
  const [sellErr, setSellErr] = useState<string | null>(null)
  // Un solo desplegable abierto a la vez, como en el diseño: las dos fichas juntas no caben en
  // la columna sin empujar el botón de continuar fuera de la caja.
  const [openSection, setOpenSection] = useState<'grading' | 'contract' | 'none'>('grading')
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  async function sell() {
    if (!identityToken || selling) return
    setSelling(true); setSellErr(null)
    try {
      const res = await requestBuyback(identityToken, result.nft_address)
      const signed = await signTransactionBase64(res.serialized_transaction)
      await submitTx(identityToken, signed)
      setSold(true)
    } catch (e) {
      setSellErr(e instanceof Error ? e.message : 'Buyback failed')
    } finally {
      setSelling(false)
    }
  }

  // Build image list: prefer result.images, fallback to result.image
  const images: string[] = result.images.length > 0
    ? result.images
    : result.image
      ? [result.image]
      : []

  const mainImgSrc = images[activeImg] ?? null
  const glow = rarityGlow(result.rarity) ?? rarityColor   // Recent-Drops-style beam

  function handleCopy() {
    if (!navigator.clipboard) return
    void navigator.clipboard.writeText(result.nft_address).then(() => {
      setCopied(true)
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800)
    })
  }

  const shortAddr = `${result.nft_address.slice(0, 4)}…${result.nft_address.slice(-4)}`
  const explorerUrl = ccAssetUrl(result.nft_address)

  const buybackOffer =
    result.insured_value != null && buybackPct != null
      ? result.insured_value * buybackPct / 100
      : null
  const canSell = single && !sold && buybackOffer != null

  // Solo las filas que el backend trae de verdad: una tabla con huecos vacíos se lee como que
  // la carta no está bien catalogada.
  const gradingRows: Array<{ label: string; value: string }> = []
  if (result.grading_company) gradingRows.push({ label: 'Grading company', value: result.grading_company })
  if (result.grading_id) gradingRows.push({ label: 'Grading ID', value: result.grading_id })
  if (result.grade) gradingRows.push({ label: 'Grade', value: result.grade })
  if (result.year) gradingRows.push({ label: 'Year', value: result.year })
  if (result.authenticated != null) gradingRows.push({ label: 'Authenticated', value: result.authenticated ? 'Yes' : 'No' })

  const gradingOpen = openSection === 'grading' && gradingRows.length > 0
  const contractOpen = openSection === 'contract'

  // ── Piezas compartidas por las dos disposiciones ────────────────────────────

  // Escritorio: columna de miniaturas navegables. Móvil: no hay sitio para 64px de miniatura al
  // lado de la carta, así que la selección se hace con barritas —la activa alargada— como un
  // carrusel, que es lo que pide el diseño de móvil.
  const thumbs = images.length > 1 && (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
      {images.map((src, idx) => (
        <button key={idx} onClick={() => setActiveImg(idx)} aria-label={`View ${idx + 1}`}
          style={{
            width: 64, height: 88, flexShrink: 0, padding: 3, borderRadius: 10, cursor: 'pointer',
            border: `2px solid ${idx === activeImg ? rarityColor : 'transparent'}`,
            background: 'rgba(255,255,255,.03)', overflow: 'hidden',
            boxShadow: idx === activeImg ? SHADOW.glow(rarityColor) : 'none',
            transition: 'border-color .15s, box-shadow .15s',
          }}>
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 6, display: 'block' }} />
        </button>
      ))}
    </div>
  )

  const dots = images.length > 1 && (
    <div style={{ display: 'flex', gap: 7, marginTop: 12 }}>
      {images.map((_, idx) => (
        <button key={idx} onClick={() => setActiveImg(idx)} aria-label={`View ${idx + 1}`}
          style={{
            width: idx === activeImg ? 20 : 5, height: 5, padding: 0, border: 0, borderRadius: 3, cursor: 'pointer',
            background: idx === activeImg ? rarityColor : 'rgba(255,255,255,.2)',
            transition: reduced ? 'none' : 'width .25s ease, background .25s ease',
          }} />
      ))}
    </div>
  )

  const cardArt = (w: number, maxH: number, radius: number) => (
    mainImgSrc ? (
      <div style={{
        width: '100%', maxWidth: w, borderRadius: radius, overflow: 'hidden',
        boxShadow: `0 0 ${radius === 11 ? '50px -10px' : '60px -12px'} ${rarityColor}, 0 18px 36px -16px rgba(0,0,0,.8)`,
        animation: reduced ? 'none' : 'ca-pop .7s cubic-bezier(.2,.9,.25,1) both, ca-float 5.5s ease-in-out .7s infinite',
      }}>
        <HoloCard src={mainImgSrc} alt={result.name ?? 'Card image'} rarity={result.rarity}
          accent={rarityColor} radius={radius} imgStyle={{ maxHeight: maxH, objectFit: 'contain' }} />
      </div>
    ) : (
      <span style={{ fontSize: 64, lineHeight: 1 }}>🃏</span>
    )
  )

  const hero = (
    <div style={{
      position: 'relative', borderRadius: 16, display: 'grid', placeItems: 'center', padding: 22,
      background: `radial-gradient(70% 60% at 50% 45%, ${glow}, transparent 75%), rgba(0,0,0,.3)`,
      border: '1px solid rgba(255,255,255,.07)',
    }}>
      {cardArt(265, 390, 12)}
    </div>
  )

  // En móvil el sello se acorta a "Authentic": a 390px la frase entera empujaba la píldora de
  // rareza a una segunda línea y la cabecera se comía la altura de la carta.
  const authBadge = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: wide ? 7 : 6, fontSize: wide ? 13 : 12, fontWeight: 600, color: COLORS.green }}>
      <svg width={wide ? 15 : 14} height={wide ? 15 : 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 12l3 3 5-6" /></svg>
      {wide ? 'Guaranteed authenticity' : 'Authentic'}
    </span>
  )
  const vaultedLink = (
    <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
      style={{ display: 'inline-flex', alignItems: 'center', gap: wide ? 6 : 5, fontSize: wide ? 12 : 11, fontWeight: 600, color: '#c9b3f0', textDecoration: 'none' }}>
      <svg width={wide ? 13 : 12} height={wide ? 13 : 12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="7" width="16" height="13" rx="2" /><path d="M8 7V5a4 4 0 0 1 8 0v2" /></svg>
      Vaulted by CollectorCrypt
    </a>
  )

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: wide ? 10 : 8, flexWrap: 'wrap' }}>
      {wide ? (
        <>
          {authBadge}
          <span style={{ width: 1, height: 13, background: 'rgba(255,255,255,.15)' }} />
          {vaultedLink}
        </>
      ) : (
        // En móvil los dos sellos se apilan: en una línea, "Vaulted by CollectorCrypt" apretaba
        // la píldora de rareza contra el borde y no quedaba aire entre las tres cosas.
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 5 }}>
          {authBadge}
          {vaultedLink}
        </span>
      )}
      <span style={{
        marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: wide ? 7 : 6,
        padding: wide ? '6px 13px' : '5px 11px', borderRadius: wide ? 9 : 8,
        background: `${rarityColor}1f`, border: `1px solid ${rarityColor}73`,
        fontFamily: FONTS.mono, fontSize: wide ? 10 : 9, fontWeight: 700, letterSpacing: '.18em', color: rarityColor,
      }}>
        <span style={{ width: wide ? 6 : 5, height: wide ? 6 : 5, borderRadius: '50%', background: rarityColor, boxShadow: `0 0 ${wide ? 7 : 6}px ${rarityColor}` }} />
        {result.rarity.toUpperCase()}
      </span>
    </div>
  )

  const sellButton = (
    <button onClick={sell} disabled={selling}
      style={{
        // En móvil comparte la fila al 50% con "Keep and Continue"; en escritorio va dentro del
        // bloque de valor y solo ocupa lo que necesita.
        // Sin padding horizontal en móvil, y no por estética: Chromium reparte el flex-basis:0
        // de un <button> sobre su contenido y le suma el padding por fuera, así que cualquier
        // padding aquí lo dejaba más ancho que "Keep and Continue" y rompía el 50/50.
        flex: wide ? 'none' : '1 1 0', minWidth: 0, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: wide ? 2 : 1,
        padding: wide ? '12px 18px' : 0, borderRadius: wide ? 12 : 13, border: 0, cursor: selling ? 'wait' : 'pointer',
        fontFamily: FONTS.body, color: '#06170f', background: 'linear-gradient(135deg,#3df0a0,#13c98a)',
        boxShadow: `0 0 ${wide ? 20 : 18}px -6px rgba(47,226,138,.7)`,
      }}>
      <span style={{ fontSize: wide ? 14 : 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
        {selling ? 'Selling…' : `${wide ? 'Sell back' : 'Sell'} · ${formatUsd(buybackOffer ?? 0)}`}
      </span>
      <span style={{ fontFamily: FONTS.mono, fontSize: wide ? 9 : 11, letterSpacing: '.08em', opacity: .75 }}>BUYBACK · {buybackPct}%</span>
    </button>
  )

  const soldChip = (
    <span style={{
      flex: 'none', display: 'inline-flex', alignItems: 'center', gap: wide ? 7 : 6,
      padding: wide ? '12px 18px' : '7px 12px', borderRadius: wide ? 12 : 10,
      background: 'rgba(47,226,138,.08)', border: '1px solid rgba(47,226,138,.4)',
      fontSize: wide ? 14 : 12.5, fontWeight: 700, color: COLORS.green, whiteSpace: 'nowrap',
    }}>
      <svg width={wide ? 15 : 13} height={wide ? 15 : 13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5 9-11" /></svg>
      Sold · {formatUsd(buybackOffer ?? 0)}
    </span>
  )
  const insuredValue = result.insured_value != null ? formatUsd(result.insured_value) : '—'
  const hasValueBlock = result.insured_value != null || buybackOffer != null

  const valueBlock = hasValueBlock && (
    <div style={{
      marginTop: 16, borderRadius: 15, padding: 16,
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      background: 'linear-gradient(135deg,rgba(139,92,246,.22),rgba(139,92,246,.08))',
      border: '1px solid rgba(139,92,246,.4)',
    }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.2em', color: '#b9a5e8' }}>INSURED VALUE</span>
        <span style={{ display: 'block', fontSize: 32, fontWeight: 700, color: '#ff4d9d', marginTop: 2 }}>{insuredValue}</span>
      </span>
      {canSell && sellButton}
      {sold && soldChip}
    </div>
  )

  // Móvil: una sola línea —etiqueta a la izquierda, importe a la derecha— y pegada a los
  // botones. El bloque alto de dos plantas se comía la altura que necesita la ficha, y aquí
  // no tiene que albergar el botón de vender, que vive abajo.
  const valueRow = hasValueBlock && (
    <div style={{
      borderRadius: 14, padding: '11px 15px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
      background: 'linear-gradient(135deg,rgba(139,92,246,.22),rgba(139,92,246,.08))',
      border: '1px solid rgba(139,92,246,.4)',
    }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.2em', color: '#b9a5e8' }}>INSURED VALUE</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        {sold && soldChip}
        <span style={{ fontSize: 22, fontWeight: 700, color: '#ff4d9d', lineHeight: 1 }}>{insuredValue}</span>
      </span>
    </div>
  )

  const sectionBtn = (label: string, isOpen: boolean, onClick: () => void, first: boolean) => (
    <button onClick={onClick}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 2px',
        border: 0, borderTop: first ? undefined : '1px solid rgba(255,255,255,.08)',
        borderBottom: '1px solid rgba(255,255,255,.08)',
        background: 'transparent', color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.body,
      }}>
      <span style={{ fontSize: wide ? 15 : 14, fontWeight: 700 }}>{label}</span>
      <span style={{ color: '#7a8492', fontSize: wide ? 18 : 17, lineHeight: 1 }}>{isOpen ? '−' : '+'}</span>
    </button>
  )
  const rowFont = wide ? 13 : 12.5
  const detailRow = (k: string, v: React.ReactNode) => (
    <div key={k} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '7px 2px' }}>
      <span style={{ fontSize: rowFont, color: '#7a8492' }}>{k}</span>
      <span style={{ fontSize: rowFont, fontWeight: 600, textAlign: 'right' }}>{v}</span>
    </div>
  )

  const sections = (
    <div style={{ marginTop: wide ? 16 : 0, display: 'flex', flexDirection: 'column' }}>
      {gradingRows.length > 0 && (
        <>
          {sectionBtn('Grading', gradingOpen, () => setOpenSection(gradingOpen ? 'none' : 'grading'), true)}
          <div style={{ overflow: 'hidden', maxHeight: gradingOpen ? 260 : 0, opacity: gradingOpen ? 1 : 0, transition: reduced ? 'none' : 'max-height .35s ease, opacity .3s ease' }}>
            {gradingRows.map((g) => detailRow(g.label, g.value))}
          </div>
        </>
      )}
      {sectionBtn('Contract', contractOpen, () => setOpenSection(contractOpen ? 'none' : 'contract'), gradingRows.length === 0)}
      <div style={{ overflow: 'hidden', maxHeight: contractOpen ? 120 : 0, opacity: contractOpen ? 1 : 0, transition: reduced ? 'none' : 'max-height .35s ease, opacity .3s ease' }}>
        {detailRow('Blockchain', 'Solana')}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '7px 2px' }}>
          <span style={{ fontSize: 13, color: '#7a8492' }}>Token ID</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: wide ? 8 : 7 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: wide ? 12 : 11.5, fontWeight: 600 }}>{shortAddr}</span>
            <button onClick={handleCopy} title="Copy address"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: wide ? 5 : 4,
                padding: wide ? '4px 10px' : '4px 9px', borderRadius: 7,
                border: `1px solid ${copied ? COLORS.green : 'rgba(255,255,255,.14)'}`,
                background: 'rgba(255,255,255,.04)', color: copied ? COLORS.green : '#cdd4dd',
                cursor: 'pointer', fontFamily: FONTS.body, fontSize: wide ? 11 : 10.5, fontWeight: 600,
              }}>
              <svg width={wide ? 11 : 10} height={wide ? 11 : 10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </span>
        </div>
      </div>
    </div>
  )

  const ccLink = wide ? (
    <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
      style={{ marginTop: 10, fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.06em', color: '#c9b3f0', textDecoration: 'none' }}>
      View on CollectorCrypt ↗
    </a>
  ) : (
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 2px' }}>
      <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
        style={{ fontFamily: FONTS.mono, fontSize: 10, color: '#c9b3f0', textDecoration: 'none', flex: 'none' }}>
        CollectorCrypt ↗
      </a>
    </div>
  )

  // Quedarse la carta no dispara nada —ya está en el vault—, así que "Keep and Continue" cierra
  // directamente en vez de pedir una confirmación de más.
  const continueLabel = !single ? 'Next pack →' : sold ? 'Continue →' : 'Keep and Continue'
  const action = (
    <div style={wide
      ? { marginTop: 'auto', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }
      // Móvil: el botón queda fijo abajo mientras la ficha rueda por detrás, con el degradado
      // del diseño para que el contenido no aparezca cortado a ras del borde.
      : { flex: 'none', display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 18px 20px', background: 'linear-gradient(180deg,transparent,#08090d 35%)' }}>
      {/* Los dos reparten el ancho a partes iguales: ninguna de las dos salidas es "la
          secundaria", y con `flex-basis:0` el reparto no depende de lo largo que sea el texto. */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onNext}
          style={{
            flex: '1 1 0', minWidth: 0, boxSizing: 'border-box',
            padding: wide ? '13px 0' : '15px 0', borderRadius: wide ? 12 : 13,
            border: 0, cursor: 'pointer', fontFamily: FONTS.display,
            fontSize: wide ? 14 : 15, fontWeight: 700, color: '#1a0a2e',
            background: 'linear-gradient(135deg,#ff5c98,#b84ef0)', boxShadow: '0 0 22px -6px rgba(184,78,240,.8)',
          }}>{continueLabel}</button>
        {canSell && !wide && sellButton}
      </div>
      {sellErr && <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.red, textAlign: 'center' }}>{sellErr}</div>}
    </div>
  )

  if (!wide) {
    // Columna de teléfono: cabecera, carta y título fijos arriba; la ficha rueda en el hueco que
    // sobra; valor y botones anclados abajo. El valor baja junto a los botones porque es el dato
    // que sostiene la decisión: se lee justo antes de pulsar, no doce filas más arriba.
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 'none', padding: '18px 18px 0' }}>{header}</div>

        <div style={{ flex: 'none', display: 'grid', placeItems: 'center', padding: '16px 0 4px' }}>
          {cardArt(196, 288, 11)}
          {dots}
        </div>

        <div style={{ flex: 'none', padding: '14px 18px 0' }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.2 }}>
            {result.name ?? 'Unknown Card'}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 18px 12px' }}>
          {sections}
          {ccLink}
        </div>

        <div style={{ flex: 'none', padding: '0 18px' }}>{valueRow}</div>

        {action}
      </div>
    )
  }

  const info = (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      {header}
      <div style={{ fontSize: 27, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.15, marginTop: 12 }}>
        {result.name ?? 'Unknown Card'}
      </div>
      {valueBlock}
      {sections}
      {ccLink}
      {action}
    </div>
  )

  return (
    <div style={{
      height: '100%', padding: 26, display: 'grid', gap: 20,
      gridTemplateColumns: `${images.length > 1 ? '64px ' : ''}340px 1fr`,
    }}>
      {thumbs}
      {hero}
      {info}
    </div>
  )
}


function YoloRevealOverlay({ results, index, reduced, buybackPct, onAdvance, onSkipAll }: {
  results: YoloResult[]
  index: number
  reduced: boolean
  buybackPct: number | null
  onAdvance: () => void
  onSkipAll: () => void
}) {
  const [skippedAt, setSkippedAt] = useState<number | null>(null)
  // Guardado por índice, no como booleano: RevealResult se remonta con cada sobre y su secuencia
  // arranca de cero, así que los Skip tienen que volver mientras esa secuencia corre.
  const [atCardFor, setAtCardFor] = useState<number | null>(null)
  const atCard = atCardFor === index
  const result = results[index]
  return (
    <motion.div key="yolo-reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,14,20,0.9)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 14 }}>
      {results.length > 1 && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted, letterSpacing: '.1em' }}>PACK {index + 1} / {results.length}</div>
      )}
      {/* La clave incluye el mint, no solo la posición: si una misma posición pasa a mostrar otra
          carta, React remonta y las etapas (año → grado → rareza) arrancan limpias. Con la
          posición sola reutilizaba la instancia y la nueva carta entraba a media secuencia, que
          es lo que se veía como "se relanza una sección". */}
      <RevealResult key={`${index}-${result.nft_address ?? ''}`} result={result} reduced={reduced} buybackPct={buybackPct} skipToCard={skippedAt === index ? 1 : 0} single={results.length === 1 && !result.auto_sold} onNext={onAdvance} onCardStage={() => setAtCardFor(index)} />
      {/* Los Skip solo mientras corre la secuencia (año → grado → rareza): en el detalle de la
          carta no queda nada que saltar —de ahí se sale con Keep and Continue— y ocupaban el
          hueco que la ficha necesita para llegar hasta abajo. */}
      {!atCard && (
        <div style={{ display: 'flex', gap: 10 }}>
          {/* Los dos van en color de texto, no en `muted`: el gris apagado es el que la app usa
              para lo deshabilitado, y "Skip all" se leía como un botón muerto que nadie intenta
              pulsar. Se distinguen por el borde, no por parecer uno de ellos inactivo. */}
          <button className="ba-ghostbtn" onClick={() => setSkippedAt(index)}
            style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>{results.length > 1 ? 'Skip pack ⏭' : 'Skip ⏭'}</button>
          {results.length > 1 && (
            <button className="ba-ghostbtn" onClick={onSkipAll}
              style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${COLORS.text}44`, background: 'transparent', color: COLORS.text, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Skip all ⏭⏭</button>
          )}
        </div>
      )}
    </motion.div>
  )
}

export function YoloSummaryOverlay({ results, machineCodes, buybackPct, onClose }: {
  results: YoloResult[]
  /** Código de máquina de cada carta, en el mismo orden. Un lote de pendientes puede mezclar
   *  máquinas, y sin la etiqueta no hay forma de saber de cuál salió cada una. */
  machineCodes?: string[]
  buybackPct: number | null
  onClose: () => void
}) {
  const { identityToken } = useIdentityToken()
  const { signTransactionBase64 } = useWallet()
  const pct = buybackPct ?? 90

  const totalValue = results.reduce((s, r) => s + (r.insured_value ?? 0), 0)
  const autoSold = results.filter((r) => r.auto_sold)
  const autoSoldUsd = autoSold.reduce((s, r) => s + (r.buyback_amount ?? 0), 0) / 1e6
  // Cards the user kept (not auto-sold) can be kept or sold back here.
  const sellable = results.filter((r) => !r.auto_sold && r.nft_address)

  const [sell, setSell] = useState<Record<string, boolean>>({})       // mint → true = sell
  const [status, setStatus] = useState<Record<string, 'sold' | 'failed'>>({})
  const [claiming, setClaiming] = useState(false)

  const pending = sellable.filter((r) => sell[r.nft_address!] && status[r.nft_address!] !== 'sold')
  const estimate = pending.reduce((s, r) => s + (r.insured_value ?? 0) * pct / 100, 0)
  const soldCount = sellable.filter((r) => status[r.nft_address!] === 'sold').length

  function setAll(v: boolean) {
    setSell(() => {
      const m: Record<string, boolean> = {}
      sellable.forEach((r) => { if (status[r.nft_address!] !== 'sold') m[r.nft_address!] = v })
      return m
    })
  }

  async function claim() {
    if (!identityToken || claiming || pending.length === 0) return
    setClaiming(true)
    for (const r of pending) {
      try {
        const res = await requestBuyback(identityToken, r.nft_address!)
        const signed = await signTransactionBase64(res.serialized_transaction)
        await submitTx(identityToken, signed)
        setStatus((s) => ({ ...s, [r.nft_address!]: 'sold' }))
      } catch {
        setStatus((s) => ({ ...s, [r.nft_address!]: 'failed' }))
      }
    }
    setClaiming(false)
  }

  return (
    <motion.div key="yolo-summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,14,20,0.9)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      {/* Columna de altura acotada: lo único que scrollea es la rejilla de cartas. Los controles
          de Keep/Sell y el botón de abajo se quedan siempre a la vista — con muchas tiradas había
          que bajar hasta el final para poder decidir o cobrar. */}
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 18, padding: 22, maxWidth: 760, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column', minHeight: 0, boxShadow: SHADOW.panel }}>
        <div style={{ flex: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontFamily: FONTS.display, fontWeight: 900, fontSize: 20, color: COLORS.text }}>You opened {results.length} pack{results.length > 1 ? 's' : ''}</span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 8, width: 30, height: 30, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ flex: 'none', display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
          <div><div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>TOTAL VALUE</div><div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: COLORS.green }}>{formatUsd(totalValue)}</div></div>
          {autoSold.length > 0 && (<div><div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>AUTO-SOLD</div><div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: COLORS.text }}>{autoSold.length} · {formatUsd(autoSoldUsd)}</div></div>)}
        </div>

        {/* Keep / sell controls — only when there are cards still in the wallet to decide on */}
        {sellable.length > 0 && (
          <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap', marginBottom: 14 }}>
            <button onClick={() => setAll(false)} disabled={claiming}
              style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600 }}>Keep all</button>
            <button onClick={() => setAll(true)} disabled={claiming}
              style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600 }}>Sell all</button>
          </div>
        )}

        <div data-testid="gacha-summary-cards" style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, alignContent: 'start', paddingRight: 4 }}>
          {results.map((r, i) => {
            const mint = r.nft_address
            const st = mint ? status[mint] : undefined
            const isSell = mint ? !!sell[mint] : false
            const decidable = !r.auto_sold && !!mint && st !== 'sold'
            const glow = rarityGlow(r.rarity)   // same beam as Recent Drops (common = none)
            const buyback = (r.insured_value ?? 0) * pct / 100
            return (
              <div key={mint ?? i} style={{ position: 'relative', background: COLORS.panel2, border: `1px solid ${glow ?? COLORS.border}`, borderRadius: 10, boxShadow: glow ? `0 0 16px -3px ${glow}, inset 0 0 12px -7px ${glow}` : undefined }}>
                {/* Misma píldora que corona la mejor carta en el result de Pack Battle, pero
                    anunciando la rareza: es el dato que el jugador busca de un vistazo aquí. */}
                {r.rarity && <CardBadge label={r.rarity.toUpperCase()} color={RARITY_COLOR[r.rarity] ?? COLORS.muted} />}
                <div style={{ aspectRatio: '3/4', background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 8, borderRadius: '9px 9px 0 0' }}>
                  {r.image ? <img src={r.image} alt={r.name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 32 }}>🃏</span>}
                </div>
                <div style={{ padding: '8px 9px 10px' }}>
                  {/* La máquina va aquí y no coronando la carta: arriba la tapaba la píldora de
                      rareza, que es el dato que se busca antes de un vistazo. */}
                  {machineCodes?.[i] && (
                    <div style={{ fontFamily: FONTS.mono, fontSize: 9, letterSpacing: '.12em',
                      color: COLORS.muted, marginBottom: 3 }}>
                      {packTitle(machineCodes[i]).join(' ')}
                    </div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name ?? '—'}</div>
                  {r.auto_sold ? (
                    <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted, marginTop: 2 }}>⚡ Auto-sold {formatUsd((r.buyback_amount ?? 0) / 1e6)}</div>
                  ) : st === 'sold' ? (
                    <div style={{ fontFamily: FONTS.mono, fontSize: 10.5, color: COLORS.green, fontWeight: 700, marginTop: 2 }}>Sold ✓ {formatUsd(buyback)}</div>
                  ) : (
                    <>
                      {r.insured_value != null && (
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginTop: 2 }}>
                          <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.green, fontWeight: 700 }}>{formatUsd(r.insured_value)}</span>
                          <span style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.muted }} title="Buyback value">↩ {formatUsd(buyback)}</span>
                        </div>
                      )}
                      {st === 'failed' && <div style={{ fontFamily: FONTS.mono, fontSize: 9.5, color: COLORS.red, marginTop: 2 }}>Sell failed — kept</div>}
                      {decidable && (
                        <div style={{ display: 'flex', marginTop: 7, borderRadius: 8, overflow: 'hidden', border: `1px solid ${COLORS.border}` }}>
                          <button onClick={() => mint && setSell((s) => ({ ...s, [mint]: false }))} disabled={claiming}
                            style={{ flex: 1, padding: '6px 0', border: 0, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, fontFamily: FONTS.body,
                              background: !isSell ? 'rgba(0,255,196,.16)' : 'transparent', color: !isSell ? COLORS.green : COLORS.muted }}>Keep</button>
                          <button onClick={() => mint && setSell((s) => ({ ...s, [mint]: true }))} disabled={claiming}
                            style={{ flex: 1, padding: '6px 0', border: 0, borderLeft: `1px solid ${COLORS.border}`, cursor: 'pointer', fontSize: 11.5, fontWeight: 700, fontFamily: FONTS.body,
                              background: isSell ? 'rgba(255,46,151,.18)' : 'transparent', color: isSell ? '#c4adff' : COLORS.muted }}>Sell</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Bottom action — sells every card marked Sell; when none is marked (keep all) it just
            closes the summary, so the button is always clickable. */}
        <div style={{ flex: 'none', display: 'flex', justifyContent: 'center', marginTop: 20 }}>
          <button onClick={pending.length > 0 ? claim : onClose} disabled={claiming}
            style={{ padding: '13px 30px', borderRadius: 13, border: 0, fontFamily: FONTS.display, fontWeight: 800, fontSize: 15,
              cursor: claiming ? 'default' : 'pointer',
              background: GRADIENT, color: '#06120c', boxShadow: '0 0 22px -6px rgba(0,255,196,.7)' }}>
            {claiming ? 'Claiming…'
              : pending.length > 0 ? `Claim · sell ${pending.length} (~${formatUsd(estimate)})`
              : soldCount > 0 ? 'Done'
              // Sin cartas que decidir —con turbo, CC las recompra todas al abrir— no hay nada
              // que "quedarse": prometerlo sería ofrecer algo que el jugador ya no tiene. Mismo
              // criterio que oculta los botones Keep all / Sell all de arriba.
              : sellable.length > 0 ? 'Keep all & continue' : 'Continue'}
          </button>
        </div>
      </div>
    </motion.div>
  )
}
