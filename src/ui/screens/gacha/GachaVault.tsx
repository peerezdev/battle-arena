// GachaVault — Polished gacha entry screen.
// Shows machine selector, pack detail, and card pool grid.
// Opening a pack uses the same buy() → sign → submit → poll → reveal flow as GachaScreen.
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useIdentityToken } from '@privy-io/react-auth'
import { useWallet } from '../../../wallet/useWallet'
import { useUsdcBalance } from '../../../wallet/useUsdcBalance'
import {
  fetchMachines,
  fetchMachineCards,
  generatePack,
  submitTx,
  openPack,
  pollOpenPack,
  GachaDisabledError,
  type GachaMachine,
  type MachineCard,
  type OpenPackResult,
} from '../../../onchain/gachaClient'
import { COLORS, FONTS, RARITY, SHADOW, GRADIENT } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import { MachineDetailPanel } from './MachineDetailPanel'
import { CardPoolGrid } from './CardPoolGrid'

// Map capitalized rarity → RARITY color token (same as GachaScreen)
const RARITY_COLOR: Record<string, string> = {
  Epic: RARITY.epic, Rare: RARITY.rare, Uncommon: RARITY.uncommon, Common: RARITY.common,
}

type Phase =
  | { kind: 'machines' }
  | { kind: 'opening'; step: 'firmando' | 'enviando' | 'abriendo' }
  | { kind: 'result'; result: Extract<OpenPackResult, { pending: false }> }
  | { kind: 'pending'; memo: string }

const STEP_LABEL: Record<'firmando' | 'enviando' | 'abriendo', string> = {
  firmando: 'Sign the transaction in your wallet…',
  enviando: 'Sending to Solana…',
  abriendo: 'Opening the pack…',
}

export default function GachaVault() {
  const reduced = useReducedMotion()
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

  // ── Load machines on mount ──────────────────────────────────────────────────
  useEffect(() => {
    fetchMachines()
      .then((ms) => {
        setMachines(ms)
        if (ms.length > 0) setSelected(ms[0])
      })
      .catch((e) =>
        e instanceof GachaDisabledError ? setDisabled(true) : setFetchError(String(e)),
      )
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
  async function handleOpen() {
    if (!selected || !identityToken) return
    // Defensive: don't start a pull we positively know can't be paid.
    if (usdc != null && usdc < (selected.price ?? 0)) {
      setOpenError(`Insufficient USDC — this pack costs $${selected.price}. Deposit USDC and try again.`)
      return
    }
    setOpenError(null)
    let pack: { memo: string; transaction: string }
    try {
      setPhase({ kind: 'opening', step: 'firmando' })
      pack = await generatePack(identityToken, selected.code)
      const signed = await signTransactionBase64(pack.transaction)
      setPhase({ kind: 'opening', step: 'enviando' })
      await submitTx(identityToken, signed)
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'machines' })
      return
    }
    setPhase({ kind: 'opening', step: 'abriendo' })
    try {
      const result = await pollOpenPack(() => openPack(identityToken, pack.memo))
      if (result.pending) {
        setPhase({ kind: 'pending', memo: pack.memo })
      } else {
        setPhase({ kind: 'result', result })
      }
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'pending', memo: pack.memo })
    }
  }

  async function retryOpen(memo: string) {
    if (!identityToken) return
    setOpenError(null)
    setPhase({ kind: 'opening', step: 'abriendo' })
    try {
      const result = await pollOpenPack(() => openPack(identityToken, memo))
      if (result.pending) setPhase({ kind: 'pending', memo })
      else setPhase({ kind: 'result', result })
    } catch (e) {
      setOpenError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'pending', memo })
    }
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
        padding: '28px 22px 48px',
        maxWidth: 1100,
        margin: '0 auto',
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

      {/* ── TWO-COLUMN BODY ─────────────────────────────────────────────────── */}
      {selected && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 300px) 1fr',
            gap: 24,
            alignItems: 'start',
          }}
        >
          {/* LEFT — Pack detail */}
          <MachineDetailPanel
            machine={selected}
            onOpen={() => void handleOpen()}
            authed={!!identityToken}
            usdc={usdc}
          />

          {/* RIGHT — Card pool */}
          <CardPoolGrid
            cards={cards}
            loading={cardsLoading}
            liveCount={cards.length > 0 ? cards.length : undefined}
            error={cardsError}
            machineCode={selected.code}
          />
        </div>
      )}

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
        {phase.kind !== 'machines' && (
          <RevealOverlay
            phase={phase}
            reduced={reduced}
            onRetry={(memo) => void retryOpen(memo)}
            onClose={() => setPhase({ kind: 'machines' })}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Reveal / opening overlay ──────────────────────────────────────────────────
function RevealOverlay({
  phase,
  reduced,
  onRetry,
  onClose,
}: {
  phase: Exclude<Phase, { kind: 'machines' }>
  reduced: boolean
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

      {/* Result */}
      {phase.kind === 'result' && (() => {
        const r = phase.result
        const rarityColor = RARITY_COLOR[r.rarity] ?? COLORS.muted
        return (
          <motion.div
            initial={reduced ? undefined : { scale: 0.82, opacity: 0 }}
            animate={reduced ? undefined : { scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 280, damping: 22 }}
            style={{
              background: COLORS.panel,
              border: `2px solid ${rarityColor}`,
              borderRadius: 16,
              padding: '32px 24px',
              textAlign: 'center',
              maxWidth: 380,
              width: '100%',
              boxShadow: `${SHADOW.panel}, ${SHADOW.glow(rarityColor)}`,
            }}
          >
            {/* Rarity badge */}
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
                marginBottom: 18,
                boxShadow: SHADOW.glow(rarityColor),
              }}
            >
              {r.rarity}
            </div>

            {/* Card image */}
            {r.image && (
              <div style={{ marginBottom: 16 }}>
                <img
                  src={r.image}
                  alt={r.name ?? undefined}
                  style={{
                    maxWidth: 220,
                    width: '100%',
                    borderRadius: 10,
                    border: `1px solid ${rarityColor}44`,
                    display: 'block',
                    margin: '0 auto',
                  }}
                />
              </div>
            )}

            {/* Card name */}
            <div
              style={{
                fontFamily: FONTS.display,
                fontWeight: 800,
                fontSize: 20,
                color: COLORS.text,
                marginBottom: 8,
              }}
            >
              {r.name}
            </div>

            {/* NFT address */}
            <div
              style={{
                fontSize: 11,
                color: COLORS.muted,
                fontFamily: FONTS.mono,
                wordBreak: 'break-all',
                marginBottom: 22,
              }}
            >
              {r.nft_address}
            </div>

            {/* Close */}
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
          </motion.div>
        )
      })()}
    </motion.div>
  )
}
