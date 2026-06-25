// GachaVault — Polished gacha entry screen.
// Shows machine selector, pack detail, and card pool grid.
// Opening a pack uses the same buy() → sign → submit → poll → reveal flow as GachaScreen.
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useIdentityToken } from '@privy-io/react-auth'
import { useWallet } from '../../../wallet/useWallet'
import { useUsdcBalance } from '../../../wallet/useUsdcBalance'
import {
  fetchMachines,
  fetchMachineCards,
  generateYoloPacks,
  submitTx,
  openPack,
  pollOpenPack,
  GachaDisabledError,
  ccAssetUrl,
  type GachaMachine,
  type MachineCard,
  type OpenPackResult,
  type YoloPacksResponse,
} from '../../../onchain/gachaClient'
import { COLORS, FONTS, RARITY, SHADOW, GRADIENT, formatUsd } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import { useIsWide } from '../../useIsWide'
import { MachineDetailPanel } from './MachineDetailPanel'
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
  | { kind: 'yolo'; step: 'firmando' | 'enviando' | 'abriendo'; done: number; total: number }
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
  const { identityToken } = useIdentityToken()
  const { signTransactionBase64 } = useWallet()
  const { usdc } = useUsdcBalance()

  const [machines, setMachines] = useState<GachaMachine[] | null>(null)
  const [selected, setSelected] = useState<GachaMachine | null>(null)
  const [disabled, setDisabled] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'machines' })

  const [cards, setCards] = useState<MachineCard[]>([])
  const [cardsLoading, setCardsLoading] = useState(false)
  const [cardsError, setCardsError] = useState(false)

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
          : (ms[0] ?? null),
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
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setCardsLoading(true)
    setCardsError(false)
    setCards([])
    fetchMachineCards(selected.code, { limit: 24 })
      .then((data) => { if (!cancelled) setCards(data) })
      .catch(() => { if (!cancelled) setCardsError(true) })
      .finally(() => { if (!cancelled) setCardsLoading(false) })
    return () => { cancelled = true }
  }, [selected?.code])

  // ── Buy / open flow (mirrors GachaScreen.buy) ──────────────────────────────
  async function retryOpen(memo: string) {
    if (!identityToken) return
    setOpenError(null)
    setPhase({ kind: 'opening', step: 'abriendo' })
    try {
      const result = await pollOpenPack(() => openPack(identityToken, memo))
      if (result.pending) {
        setPhase({ kind: 'pending', memo })
      } else {
        setPhase({ kind: 'result', result })
      }
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'pending', memo })
    }
  }

  async function handleYolo(count: number, turbo: boolean) {
    if (!selected || !identityToken) return
    const total = (selected.price ?? 0) * count
    if (usdc != null && usdc < total) {
      setOpenError(`Insufficient USDC — ${count} packs cost $${total}. Deposit and try again.`)
      return
    }
    setOpenError(null)
    let resp: YoloPacksResponse
    try {
      setPhase({ kind: 'yolo', step: 'firmando', done: 0, total: count })
      resp = await generateYoloPacks(identityToken, selected.code, count, turbo)
    } catch (e) {
      setOpenError(`Couldn't start YOLO: ${e instanceof Error ? e.message : String(e)}.`)
      setPhase({ kind: 'machines' })
      return
    }
    const txs = resp.transactions
    const submitted: string[] = []
    for (let i = 0; i < txs.length; i++) {
      try {
        setPhase({ kind: 'yolo', step: 'firmando', done: i, total: txs.length })
        const signed = await signTransactionBase64(txs[i].transaction)
        setPhase({ kind: 'yolo', step: 'enviando', done: i, total: txs.length })
        await submitTx(identityToken, signed)
        submitted.push(txs[i].memo)
      } catch {
        break
      }
    }
    if (submitted.length === 0) {
      setOpenError('No packs were opened.')
      setPhase({ kind: 'machines' })
      return
    }
    const results: YoloResult[] = []
    for (let i = 0; i < submitted.length; i++) {
      setPhase({ kind: 'yolo', step: 'abriendo', done: i, total: submitted.length })
      try {
        const r = await pollOpenPack(() => openPack(identityToken, submitted[i]))
        if (!r.pending) { results.push(r) }
      } catch { /* skip */ }
    }
    if (results.length === 0) { setPhase({ kind: 'pending', memo: submitted[0] }); return }
    setPhase({ kind: 'yolo-reveal', results, index: 0 })
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
        padding: wideGacha ? '24px 28px 48px' : '16px 14px 40px',
        position: 'relative',
      }}
    >
      {/* ── HEADER ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
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
      </div>

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
        <div
          style={{
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            paddingBottom: 8,
            marginBottom: 28,
            scrollbarWidth: 'none',
          }}
        >
          {machines.map((m) => {
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
                  <div
                    style={{
                      fontFamily: FONTS.mono,
                      fontSize: 11,
                      color: isActive ? COLORS.green : COLORS.muted,
                    }}
                  >
                    ${m.price} USDC
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── BODY (two-column wide / stacked narrow, panel-first) ────────────── */}
      {selected && (() => {
        const poolEl = (
          <CardPoolGrid
            cards={cards}
            loading={cardsLoading}
            liveCount={cards.length > 0 ? cards.length : undefined}
            error={cardsError}
            machineCode={selected.code}
          />
        )
        const panelEl = (
          <div style={wideGacha ? { position: 'sticky', top: 16 } : undefined}>
            <MachineDetailPanel
              machine={selected}
              authed={!!identityToken}
              usdc={usdc}
              onYolo={(c, t) => void handleYolo(c, t)}
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
      {openError && phase.kind === 'machines' && (
        <div
          style={{
            marginTop: 16,
            background: '#300a0f',
            border: `1px solid ${COLORS.red}`,
            color: COLORS.red,
            borderRadius: 8,
            padding: '12px 14px',
            fontSize: 13,
          }}
        >
          {openError}
        </div>
      )}

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
        {phase.kind === 'yolo' && <YoloProgressOverlay phase={phase} reduced={reduced} />}
        {phase.kind === 'yolo-reveal' && (
          <YoloRevealOverlay
            results={phase.results}
            index={phase.index}
            reduced={reduced}
            buybackPct={selected?.instantBuyback ?? null}
            onAdvance={() => setPhase((p) =>
              p.kind === 'yolo-reveal'
                ? (p.index + 1 < p.results.length
                    ? { kind: 'yolo-reveal', results: p.results, index: p.index + 1 }
                    : { kind: 'yolo-summary', results: p.results })
                : p)}
            onSkipAll={() => setPhase((p) => p.kind === 'yolo-reveal' ? { kind: 'yolo-summary', results: p.results } : p)}
          />
        )}
        {phase.kind === 'yolo-summary' && (
          <YoloSummaryOverlay results={phase.results} onClose={() => setPhase({ kind: 'machines' })} />
        )}
      </AnimatePresence>
    </div>
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

      {/* Result — staged reveal */}
      {phase.kind === 'result' && (
        <RevealResult result={phase.result} reduced={reduced} buybackPct={buybackPct ?? null} onClose={onClose} />
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
  onClose,
}: {
  result: Extract<OpenPackResult, { pending: false }>
  reduced: boolean
  buybackPct: number | null
  skipToCard?: number
  onClose: () => void
}) {
  const rarityColor = RARITY_COLOR[result.rarity] ?? COLORS.muted

  const steps = useMemo(() => {
    const s: Array<'year' | 'grade' | 'rarity' | 'card'> = []
    if (result.year) s.push('year')
    if (result.grade) s.push('grade')
    s.push('rarity')
    s.push('card')
    return s
  }, [result.year, result.grade])

  // Reduced motion: jump straight to the final card step
  const [i, setI] = useState(reduced ? steps.length - 1 : 0)

  useEffect(() => {
    if (reduced) return
    if (i >= steps.length - 1) return
    const t = setTimeout(() => setI((n) => Math.min(n + 1, steps.length - 1)), 1700)
    return () => clearTimeout(t)
  }, [i, steps.length, reduced])

  useEffect(() => {
    if (skipToCard) setI(steps.length - 1)
  }, [skipToCard, steps.length])

  const step = steps[i]

  // Pre-card stages: year / grade / rarity
  if (step !== 'card') {
    const label = step.toUpperCase()
    const value = step === 'year' ? result.year : step === 'grade' ? result.grade : result.rarity
    const valueColor = step === 'rarity' ? rarityColor : COLORS.text
    const valueShadow = step === 'rarity' ? SHADOW.glow(rarityColor) : 'none'

    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ scale: 0.72, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 1.12, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          style={{
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 12,
            userSelect: 'none',
          }}
        >
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              letterSpacing: '.14em',
              textTransform: 'uppercase',
              color: COLORS.muted,
            }}
          >
            {label}
          </div>
          <div
            style={{
              fontFamily: FONTS.display,
              fontWeight: 900,
              fontSize: 52,
              color: valueColor,
              textShadow: valueShadow,
              lineHeight: 1,
            }}
          >
            {value}
          </div>
        </motion.div>
      </AnimatePresence>
    )
  }

  // Card stage — rich Card Details view
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="card"
        initial={reduced ? undefined : { scale: 0.82, opacity: 0 }}
        animate={reduced ? undefined : { scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 22 }}
        style={{
          maxWidth: 440,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: COLORS.panel,
          border: `2px solid ${rarityColor}`,
          borderRadius: 18,
          boxShadow: `${SHADOW.panel}, ${SHADOW.glow(rarityColor)}`,
        }}
      >
        <CardDetailsView
          result={result}
          rarityColor={rarityColor}
          buybackPct={buybackPct}
          onClose={onClose}
        />
      </motion.div>
    </AnimatePresence>
  )
}

// ── Rich card details panel (inner — owns activeImg state) ────────────────────
function CardDetailsView({
  result,
  rarityColor,
  buybackPct,
  onClose,
}: {
  result: Extract<OpenPackResult, { pending: false }>
  rarityColor: string
  buybackPct: number | null
  onClose: () => void
}) {
  const [activeImg, setActiveImg] = useState(0)
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current) }, [])

  // Build image list: prefer result.images, fallback to result.image
  const images: string[] = result.images.length > 0
    ? result.images
    : result.image
      ? [result.image]
      : []

  const mainImgSrc = images[activeImg] ?? null

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

  // Grading rows — only show present fields
  const gradingRows: Array<{ label: string; value: string }> = []
  if (result.grading_company) gradingRows.push({ label: 'Grading Company', value: result.grading_company })
  if (result.grading_id) gradingRows.push({ label: 'Grading ID', value: result.grading_id })
  if (result.grade) gradingRows.push({ label: 'Grade', value: result.grade })
  if (result.year) gradingRows.push({ label: 'Year', value: result.year })
  if (result.authenticated != null) gradingRows.push({ label: 'Authenticated', value: result.authenticated ? 'Yes' : 'No' })

  return (
    <div style={{ padding: '28px 24px 24px' }}>
      {/* ── Authenticity line ────────────────────────────────────────────────── */}
      {result.authenticated !== false && (
        <div
          style={{
            fontFamily: FONTS.mono,
            fontSize: 11,
            color: COLORS.green,
            letterSpacing: '.06em',
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          <span style={{ fontSize: 13 }}>&#10003;</span>
          GUARANTEED AUTHENTICITY
        </div>
      )}

      {/* ── Card name + rarity badge ─────────────────────────────────────────── */}
      <div
        style={{
          fontFamily: FONTS.display,
          fontWeight: 900,
          fontSize: 22,
          color: COLORS.text,
          marginBottom: 10,
          lineHeight: 1.15,
        }}
      >
        {result.name ?? 'Unknown Card'}
      </div>
      <div
        style={{
          display: 'inline-block',
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: rarityColor,
          border: `1px solid ${rarityColor}`,
          borderRadius: 4,
          padding: '3px 10px',
          marginBottom: 20,
          boxShadow: SHADOW.glow(rarityColor),
        }}
      >
        {result.rarity}
      </div>

      {/* ── Image area ──────────────────────────────────────────────────────── */}
      {mainImgSrc ? (
        <div style={{ marginBottom: 16 }}>
          <img
            src={mainImgSrc}
            alt={result.name ?? 'Card image'}
            style={{
              width: '100%',
              maxHeight: 280,
              objectFit: 'contain',
              borderRadius: 10,
              border: `1px solid ${rarityColor}44`,
              display: 'block',
            }}
          />
          {/* Thumbnails — only when multiple images */}
          {images.length > 1 && (
            <div
              style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'center',
                marginTop: 10,
              }}
            >
              {images.map((src, idx) => (
                <button
                  key={idx}
                  onClick={() => setActiveImg(idx)}
                  style={{
                    padding: 0,
                    border: `2px solid ${idx === activeImg ? rarityColor : COLORS.border}`,
                    borderRadius: 6,
                    background: 'none',
                    cursor: 'pointer',
                    boxShadow: idx === activeImg ? SHADOW.glow(rarityColor) : 'none',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={src}
                    alt={`View ${idx + 1}`}
                    style={{
                      width: 48,
                      height: 48,
                      objectFit: 'cover',
                      borderRadius: 4,
                      display: 'block',
                    }}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          style={{
            fontSize: 64,
            textAlign: 'center',
            marginBottom: 16,
            lineHeight: 1,
          }}
        >
          &#127183;
        </div>
      )}

      {/* ── Value box ───────────────────────────────────────────────────────── */}
      {(result.insured_value != null || buybackOffer != null) && (
        <div
          style={{
            background: `linear-gradient(135deg, #1a1430 0%, #0f1a28 100%)`,
            border: `1px solid ${COLORS.violet}44`,
            borderRadius: 12,
            padding: '16px 18px',
            marginBottom: 16,
            boxShadow: SHADOW.glow(COLORS.violet),
          }}
        >
          {result.insured_value != null && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: buybackOffer != null ? 8 : 0,
              }}
            >
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  color: COLORS.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                }}
              >
                Insured Value
              </span>
              <span
                style={{
                  fontFamily: FONTS.display,
                  fontWeight: 800,
                  fontSize: 18,
                  color: COLORS.violet,
                }}
              >
                {formatUsd(result.insured_value)}
              </span>
            </div>
          )}
          {buybackOffer != null && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 11,
                  color: COLORS.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                }}
              >
                Buyback Offer ({buybackPct}%)
              </span>
              <span
                style={{
                  fontFamily: FONTS.display,
                  fontWeight: 700,
                  fontSize: 15,
                  color: COLORS.green,
                }}
              >
                {formatUsd(buybackOffer)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Token ID + explorer link ─────────────────────────────────────────── */}
      <div
        style={{
          background: COLORS.panel2,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 10,
              color: COLORS.muted,
              textTransform: 'uppercase',
              letterSpacing: '.07em',
              marginBottom: 4,
            }}
          >
            Token ID
          </div>
          <div
            style={{
              fontFamily: FONTS.mono,
              fontSize: 13,
              color: COLORS.text,
            }}
          >
            {shortAddr}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button
            onClick={handleCopy}
            title="Copy address"
            style={{
              background: copied ? COLORS.green + '22' : COLORS.panel,
              border: `1px solid ${copied ? COLORS.green : COLORS.border}`,
              borderRadius: 6,
              padding: '5px 10px',
              cursor: 'pointer',
              color: copied ? COLORS.green : COLORS.muted,
              fontFamily: FONTS.mono,
              fontSize: 11,
              transition: 'all 0.15s',
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontFamily: FONTS.mono,
              fontSize: 11,
              color: COLORS.violet,
              textDecoration: 'none',
              border: `1px solid ${COLORS.violet}44`,
              borderRadius: 6,
              padding: '5px 10px',
              whiteSpace: 'nowrap',
            }}
          >
            View on CollectorCrypt &#8599;
          </a>
        </div>
      </div>

      {/* ── Grading section ─────────────────────────────────────────────────── */}
      {gradingRows.length > 0 && (
        <div
          style={{
            background: COLORS.panel2,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 20,
          }}
        >
          {gradingRows.map(({ label, value }) => (
            <div
              key={label}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                padding: '4px 0',
                borderBottom: `1px solid ${COLORS.border}`,
              }}
            >
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 10,
                  color: COLORS.muted,
                  textTransform: 'uppercase',
                  letterSpacing: '.06em',
                }}
              >
                {label}
              </span>
              <span
                style={{
                  fontFamily: FONTS.mono,
                  fontSize: 12,
                  color: COLORS.text,
                }}
              >
                {value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Back to Vault ────────────────────────────────────────────────────── */}
      <button
        onClick={onClose}
        style={{
          width: '100%',
          background: GRADIENT,
          color: '#06120c',
          border: 'none',
          borderRadius: 10,
          padding: '14px',
          fontSize: 14,
          fontWeight: 800,
          cursor: 'pointer',
          fontFamily: FONTS.display,
          letterSpacing: '.03em',
          boxShadow: SHADOW.glow(COLORS.green),
        }}
      >
        Back to Vault
      </button>
    </div>
  )
}

const YOLO_STEP_LABEL: Record<'firmando' | 'enviando' | 'abriendo', string> = {
  firmando: 'Sign each pack in your wallet…',
  enviando: 'Sending to Solana…',
  abriendo: 'Opening packs…',
}

function YoloProgressOverlay({ phase, reduced }: { phase: Extract<Phase, { kind: 'yolo' }>; reduced: boolean }) {
  return (
    <motion.div key="yolo-progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,14,20,0.88)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: '44px 32px', textAlign: 'center', maxWidth: 360, width: '100%', boxShadow: SHADOW.panel }}>
        <motion.div animate={reduced ? undefined : { opacity: [1, 0.35, 1] }} transition={{ repeat: Infinity, duration: 1.4 }} style={{ fontSize: 52, marginBottom: 20 }}>🎰</motion.div>
        <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.text, fontFamily: FONTS.body, marginBottom: 8 }}>{YOLO_STEP_LABEL[phase.step]}</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>{phase.step} · {Math.min(phase.done + 1, phase.total)}/{phase.total}</div>
      </div>
    </motion.div>
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
  const result = results[index]
  return (
    <motion.div key="yolo-reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,14,20,0.9)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 14 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted, letterSpacing: '.1em' }}>PACK {index + 1} / {results.length}</div>
      {result.auto_sold && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.green }}>⚡ Auto-sold {formatUsd((result.buyback_amount ?? 0) / 1e6)}</div>
      )}
      <RevealResult key={index} result={result} reduced={reduced} buybackPct={buybackPct} skipToCard={skippedAt === index ? 1 : 0} onClose={onAdvance} />
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => setSkippedAt(index)}
          style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Skip pack ⏭</button>
        <button onClick={onSkipAll}
          style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.muted, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Skip all ⏭⏭</button>
      </div>
    </motion.div>
  )
}

function YoloSummaryOverlay({ results, onClose }: { results: YoloResult[]; onClose: () => void }) {
  const totalValue = results.reduce((s, r) => s + (r.insured_value ?? 0), 0)
  const sold = results.filter((r) => r.auto_sold)
  const soldUsd = sold.reduce((s, r) => s + (r.buyback_amount ?? 0), 0) / 1e6
  return (
    <motion.div key="yolo-summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,14,20,0.9)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 18, padding: 22, maxWidth: 760, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: SHADOW.panel }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontFamily: FONTS.display, fontWeight: 900, fontSize: 20, color: COLORS.text }}>You opened {results.length} packs</span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 8, width: 30, height: 30, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
          <div><div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>TOTAL VALUE</div><div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: COLORS.green }}>{formatUsd(totalValue)}</div></div>
          {sold.length > 0 && (<div><div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>AUTO-SOLD</div><div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: COLORS.text }}>{sold.length} · {formatUsd(soldUsd)}</div></div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {results.map((r, i) => {
            const accent = RARITY_COLOR[r.rarity] ?? COLORS.muted
            return (
              <div key={r.nft_address ?? i} style={{ background: COLORS.panel2, border: `1px solid ${accent}55`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ aspectRatio: '3/4', background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 8 }}>
                  {r.image ? <img src={r.image} alt={r.name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 32 }}>🃏</span>}
                </div>
                <div style={{ padding: '8px 9px 10px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name ?? '—'}</div>
                  {r.auto_sold
                    ? <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>Auto-sold {formatUsd((r.buyback_amount ?? 0) / 1e6)}</div>
                    : r.insured_value != null && <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.green, fontWeight: 700 }}>{formatUsd(r.insured_value)}</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
