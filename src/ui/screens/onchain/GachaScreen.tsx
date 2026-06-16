// Pantalla Gacha (modo on-chain): listar máquinas, comprar un pack,
// abrirlo con reveal animado por rareza y mandar al usuario a su colección
// para batir la carta. La atestación NO ocurre aquí: la hace el flujo
// existente de CollectionScreen cuando seleccione la carta nueva.
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../../../wallet/useWallet'
import {
  fetchMachines, generatePack, submitTx, openPack, pollOpenPack,
  GachaDisabledError, type GachaMachine, type OpenPackResult,
} from '../../../onchain/gachaClient'
import { COLORS, FONTS } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'

interface Props {
  token: string
  /** Vuelve a la colección (con la carta nueva ya en la wallet). */
  onGoToCollection: () => void
  onBack: () => void
}

// ── Shell wrapper (module scope — evita re-montaje por nueva identidad) ──────
function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        background: COLORS.bg,
        color: COLORS.text,
        fontFamily: 'Inter, system-ui, sans-serif',
        padding: '0 16px 48px',
      }}
    >
      <div style={{ maxWidth: '520px', margin: '0 auto', paddingTop: '40px' }}>
        {/* Back */}
        <button
          onClick={onBack}
          style={{
            background: 'transparent',
            border: 'none',
            color: COLORS.muted,
            cursor: 'pointer',
            fontSize: '13px',
            padding: '0 0 24px',
          }}
        >
          ← Volver
        </button>

        {/* Header */}
        <div style={{ marginBottom: '28px' }}>
          <div
            style={{
              fontSize: '11px',
              color: COLORS.muted,
              letterSpacing: '.06em',
              marginBottom: '4px',
            }}
          >
            ON-CHAIN · GACHA
          </div>
          <div
            style={{
              fontSize: '26px',
              fontWeight: 900,
              fontFamily: FONTS.display,
              letterSpacing: '.08em',
              color: COLORS.text,
            }}
          >
            GACHA
          </div>
        </div>

        {children}
      </div>
    </div>
  )
}

const RARITY_COLOR: Record<string, string> = {
  Epic: '#c084fc', Rare: '#5ad1ff', Uncommon: COLORS.green, Common: COLORS.muted,
}

type Phase =
  | { kind: 'machines' }
  | { kind: 'opening'; step: 'firmando' | 'enviando' | 'abriendo' }
  | { kind: 'result'; result: Extract<OpenPackResult, { pending: false }> }
  | { kind: 'pending'; memo: string }

const STEP_LABEL: Record<'firmando' | 'enviando' | 'abriendo', string> = {
  firmando: 'Firma la transacción en tu wallet…',
  enviando: 'Enviando a Solana…',
  abriendo: 'Abriendo el pack…',
}

export function GachaScreen({ token, onGoToCollection, onBack }: Props) {
  const reduced = useReducedMotion()
  const { signTransactionBase64 } = useWallet()
  const [machines, setMachines] = useState<GachaMachine[] | null>(null)
  const [disabled, setDisabled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'machines' })

  useEffect(() => {
    fetchMachines()
      .then(setMachines)
      .catch((e) => (e instanceof GachaDisabledError ? setDisabled(true) : setError(String(e))))
  }, [])

  async function buy(machine: GachaMachine) {
    setError(null)
    let pack: { memo: string; transaction: string }
    try {
      setPhase({ kind: 'opening', step: 'firmando' })
      pack = await generatePack(token, machine.code)
      const signed = await signTransactionBase64(pack.transaction)
      setPhase({ kind: 'opening', step: 'enviando' })
      await submitTx(token, signed)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'machines' })
      return
    }
    // Pago confirmado — a partir de aquí los errores van a 'pending' para reintentar
    setPhase({ kind: 'opening', step: 'abriendo' })
    try {
      const result = await pollOpenPack(() => openPack(token, pack.memo))
      if (result.pending) {
        setPhase({ kind: 'pending', memo: pack.memo })
      } else {
        setPhase({ kind: 'result', result })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'pending', memo: pack.memo })
    }
  }

  async function retryOpen(memo: string) {
    setError(null)
    setPhase({ kind: 'opening', step: 'abriendo' })
    try {
      const result = await pollOpenPack(() => openPack(token, memo))
      if (result.pending) setPhase({ kind: 'pending', memo })
      else setPhase({ kind: 'result', result })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase({ kind: 'pending', memo })
    }
  }

  // ── State: disabled ──────────────────────────────────────────────────────────
  if (disabled) {
    return (
      <Shell onBack={onBack}>
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '10px',
            padding: '24px',
            textAlign: 'center',
            color: COLORS.muted,
            fontSize: '14px',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🎰</div>
          <div style={{ fontWeight: 700, color: COLORS.text, marginBottom: '8px' }}>
            Gacha no disponible
          </div>
          Falta configurar la API key del Gacha en el backend (GACHA_API_KEY).
        </div>
      </Shell>
    )
  }

  // ── State: opening ───────────────────────────────────────────────────────────
  if (phase.kind === 'opening') {
    return (
      <Shell onBack={onBack}>
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '10px',
            padding: '40px 24px',
            textAlign: 'center',
          }}
        >
          <motion.div
            animate={reduced ? undefined : { opacity: [1, 0.4, 1] }}
            transition={{ repeat: Infinity, duration: 1.4, ease: 'easeInOut' }}
            style={{ fontSize: '48px', marginBottom: '20px' }}
          >
            🎰
          </motion.div>
          <div
            style={{
              fontSize: '15px',
              color: COLORS.text,
              fontWeight: 600,
              lineHeight: 1.5,
            }}
          >
            {STEP_LABEL[phase.step]}
          </div>
          <div
            style={{
              marginTop: '10px',
              fontSize: '11px',
              color: COLORS.muted,
              letterSpacing: '.04em',
              textTransform: 'uppercase',
            }}
          >
            {phase.step}
          </div>
        </div>
      </Shell>
    )
  }

  // ── State: pending ───────────────────────────────────────────────────────────
  if (phase.kind === 'pending') {
    const memo = phase.memo
    return (
      <Shell onBack={onBack}>
        <div
          style={{
            background: COLORS.panel,
            border: `1px solid ${COLORS.border}`,
            borderRadius: '10px',
            padding: '28px 24px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '32px', marginBottom: '14px' }}>⏳</div>
          <div style={{ fontSize: '14px', color: COLORS.text, lineHeight: 1.6, marginBottom: '20px' }}>
            El pack se está procesando on-chain…
          </div>
          <motion.button
            onClick={() => void retryOpen(memo)}
            whileTap={reduced ? undefined : { scale: 0.96 }}
            style={{
              background: COLORS.green,
              color: '#04130c',
              border: 'none',
              borderRadius: '10px',
              padding: '14px 28px',
              fontSize: '14px',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '.03em',
              boxShadow: '0 0 14px #34e29b55',
            }}
          >
            Seguir esperando
          </motion.button>
        </div>
      </Shell>
    )
  }

  // ── State: result ────────────────────────────────────────────────────────────
  if (phase.kind === 'result') {
    const r = phase.result
    const rarityColor = RARITY_COLOR[r.rarity] ?? COLORS.muted

    return (
      <Shell onBack={onBack}>
        <motion.div
          initial={reduced ? undefined : { scale: 0.8, opacity: 0 }}
          animate={reduced ? undefined : { scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          style={{
            background: COLORS.panel,
            border: `2px solid ${rarityColor}`,
            borderRadius: '14px',
            padding: '28px 20px',
            textAlign: 'center',
            boxShadow: `0 0 24px ${rarityColor}44`,
            marginBottom: '20px',
          }}
        >
          {/* Rarity label */}
          <div
            style={{
              display: 'inline-block',
              fontSize: '11px',
              fontWeight: 800,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
              color: rarityColor,
              border: `1px solid ${rarityColor}`,
              borderRadius: '4px',
              padding: '3px 10px',
              marginBottom: '16px',
              boxShadow: `0 0 8px ${rarityColor}66`,
            }}
          >
            {r.rarity}
          </div>

          {/* Card image */}
          {r.image && (
            <div style={{ marginBottom: '14px' }}>
              <img
                src={r.image}
                alt={r.name ?? undefined}
                style={{
                  maxWidth: '220px',
                  width: '100%',
                  borderRadius: '10px',
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
              fontSize: '18px',
              fontWeight: 800,
              color: COLORS.text,
              marginBottom: '8px',
            }}
          >
            {r.name}
          </div>

          {/* NFT address */}
          <div
            style={{
              fontSize: '11px',
              color: COLORS.muted,
              fontFamily: 'monospace',
              wordBreak: 'break-all',
            }}
          >
            {r.nft_address}
          </div>
        </motion.div>

        {/* Actions */}
        <motion.button
          onClick={onGoToCollection}
          whileTap={reduced ? undefined : { scale: 0.96 }}
          style={{
            width: '100%',
            background: COLORS.green,
            color: '#04130c',
            border: 'none',
            borderRadius: '10px',
            padding: '16px',
            fontSize: '15px',
            fontWeight: 800,
            cursor: 'pointer',
            letterSpacing: '.03em',
            boxShadow: '0 0 14px #34e29b66',
            marginBottom: '12px',
          }}
        >
          Crear desafío con esta carta
        </motion.button>

        <a
          href="https://gacha.collectorcrypt.com"
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'block',
            textAlign: 'center',
            fontSize: '13px',
            color: COLORS.muted,
            textDecoration: 'underline',
            padding: '8px 0',
          }}
        >
          Vender de vuelta (buyback)
        </a>
      </Shell>
    )
  }

  // ── State: machines (default) ────────────────────────────────────────────────
  return (
    <Shell onBack={onBack}>
      {/* Error */}
      {error && (
        <div
          style={{
            background: '#300a0f',
            border: `1px solid ${COLORS.red}`,
            color: COLORS.red,
            borderRadius: '8px',
            padding: '12px 14px',
            fontSize: '13px',
            marginBottom: '16px',
            lineHeight: 1.5,
          }}
        >
          {error}
        </div>
      )}

      {/* Loading */}
      {machines === null && (
        <div
          style={{
            color: COLORS.muted,
            fontSize: '13px',
            textAlign: 'center',
            padding: '40px 0',
          }}
        >
          Cargando máquinas…
        </div>
      )}

      {/* Machines grid */}
      {machines !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {machines.map((m) => (
            <div
              key={m.code}
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '10px',
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              {/* Machine image */}
              {m.image && (
                <img
                  src={m.image}
                  alt={m.name}
                  style={{
                    width: '64px',
                    height: '64px',
                    objectFit: 'contain',
                    borderRadius: '8px',
                    flexShrink: 0,
                    border: `1px solid ${COLORS.border}`,
                  }}
                />
              )}

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 800, marginBottom: '4px' }}>
                  {m.name}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '12px', color: COLORS.muted, marginBottom: '4px' }}>
                  <span>
                    <span style={{ color: COLORS.text, fontWeight: 700 }}>{m.price}</span> USDC
                  </span>
                  {m.ev != null && (
                    <span>
                      EV <span style={{ color: COLORS.green, fontWeight: 700 }}>${m.ev}</span>
                    </span>
                  )}
                </div>
                {m.odds && Object.keys(m.odds).length > 0 && (
                  <div style={{ fontSize: '11px', color: COLORS.muted }}>
                    {Object.entries(m.odds)
                      .map(([rarity, pct]) => `${rarity.toLowerCase()} ${pct}%`)
                      .join(' · ')}
                  </div>
                )}
              </div>

              {/* Buy button */}
              <motion.button
                onClick={() => void buy(m)}
                whileTap={reduced ? undefined : { scale: 0.96 }}
                style={{
                  flexShrink: 0,
                  background: COLORS.green,
                  color: '#04130c',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontSize: '13px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  letterSpacing: '.03em',
                  boxShadow: '0 0 10px #34e29b55',
                }}
              >
                Abrir pack
              </motion.button>
            </div>
          ))}
        </div>
      )}
    </Shell>
  )
}
