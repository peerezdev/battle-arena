import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { COLORS, FONTS, GRADIENT, RARITY } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import { fetchDemoPool, FORCED_ORDER, DEMO_MACHINE, type DemoPool } from '../../../demo/demoPool'
import type { MachineCard } from '../../../onchain/gachaClient'
import type { YoloResult } from '../gacha/pendingToResult'
import { GachaCardReveal } from '../gacha/GachaCardReveal'

// Banco de pruebas de los reveals. No es una pantalla de producto: existe para poder mirar una
// y otra vez la misma rareza mientras se ajustan tiempos y sonidos, sin quedar a merced del
// sorteo. Se llega por /demo; no está en la navegación a propósito.

const RARITY_COLOR: Record<string, string> = {
  epic: RARITY.epic, rare: RARITY.rare, uncommon: RARITY.uncommon, common: RARITY.common,
}

/** Convierte una carta del pool en el resultado que espera el reveal del gacha. */
function toYolo(c: MachineCard): YoloResult {
  return {
    pending: false,
    nft_address: c.nft_address ?? '',
    rarity: c.rarity ?? 'Common',
    name: c.name,
    image: c.image,
    images: c.images ?? [],
    year: c.year,
    grade: c.grade,
    insured_value: c.insured_value,
    grading_company: c.grading_company,
    grading_id: c.grading_id,
    authenticated: c.authenticated,
    auto_sold: false,
    buyback_amount: null,
  }
}

export function DemoPage() {
  const navigate = useNavigate()
  const reduced = useReducedMotion()

  const [pool, setPool] = useState<DemoPool | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Cola de tiradas de gacha pendientes de enseñar, y la que está en pantalla.
  const [queue, setQueue] = useState<YoloResult[]>([])
  const [runId, setRunId] = useState(0)   // fuerza el remontaje del reveal en cada tirada

  useEffect(() => {
    let cancelled = false
    fetchDemoPool()
      .then((p) => { if (!cancelled) setPool(p) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'No se pudo cargar el pool') })
    return () => { cancelled = true }
  }, [])

  /** Una carta al azar de esa rareza; null si el pool no trae ninguna. */
  const cardOf = useCallback((rarity: string): MachineCard | null => {
    const cards = (pool?.cards ?? []).filter((c) => (c.rarity ?? '').toLowerCase() === rarity)
    return cards.length ? cards[Math.floor(Math.random() * cards.length)] : null
  }, [pool])

  const runGacha = (rarities: readonly string[]) => {
    const rs = rarities.map(cardOf).filter(Boolean).map((c) => toYolo(c!))
    if (!rs.length) return
    setQueue(rs)
    setRunId((n) => n + 1)
  }

  const nextPull = () => setQueue((q) => q.slice(1))

  const missing = pool ? FORCED_ORDER.filter((r) => !cardOf(r)) : []

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 'clamp(18px,3vw,34px)', color: COLORS.text }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.24em', color: COLORS.violet }}>BANCO DE PRUEBAS</div>
        <h1 style={{ fontFamily: FONTS.display, fontSize: 'clamp(26px,4vw,36px)', margin: '10px 0 8px', letterSpacing: '-.02em' }}>Demo</h1>
        <p style={{ margin: 0, maxWidth: '60ch', color: '#aab3bf', fontSize: 14.5 }}>
          Lanza los reveals con las rarezas <strong>forzadas en orden epic → rare → uncommon → common</strong>,
          en bucle, para ajustar tiempos y sonidos sin depender del sorteo. Máquina: <code style={mono}>{DEMO_MACHINE}</code>.
        </p>

        {error && <div style={{ ...card, borderColor: `${COLORS.red}55`, marginTop: 22 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>No se pudo cargar el pool</div>
          <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>{error}</div>
        </div>}

        {!pool && !error && <div style={{ ...card, marginTop: 22, fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>Cargando el pool…</div>}

        {pool && (
          <>
            {missing.length > 0 && (
              <div style={{ ...card, marginTop: 20, borderColor: `${POT_WARN}55`, background: 'rgba(245,197,66,.06)' }}>
                <div style={{ fontFamily: FONTS.mono, fontSize: 11.5, color: POT_WARN }}>
                  El pool muestreado no trae {missing.join(', ')} — esas tiradas caerán al sorteo normal.
                </div>
              </div>
            )}

            {/* ── Batallas ─────────────────────────────────────────────── */}
            <section style={{ ...card, marginTop: 22 }}>
              <h2 style={h2}>Batallas</h2>
              <p style={sub}>Abren el reveal de siempre; con las rarezas forzadas no se auto-vende ninguna carta, para que todas pasen por la ceremonia.</p>
              <div style={row}>
                <button style={primary} onClick={() => navigate('/play/demo/royale?forced=1')}>Battle Royale · forzado</button>
                <button style={primary} onClick={() => navigate('/play/demo/pack?forced=1')}>Pack Battle · forzado</button>
              </div>
              <div style={{ ...row, marginTop: 10 }}>
                <button style={ghost} onClick={() => navigate('/play/demo/royale')}>Royale · aleatorio</button>
                <button style={ghost} onClick={() => navigate('/play/demo/pack')}>Pack · aleatorio</button>
                {/* Los cuatro sacan la misma carta: empatan y hay que sortear al ganador. Un
                    empate real exige dos cartas del mismo valor exacto, que casi nunca pasa. */}
                <button style={ghost} onClick={() => navigate('/play/demo/pack?tie=1')}>Pack · empate a cuatro</button>
              </div>
            </section>

            {/* ── Gacha ────────────────────────────────────────────────── */}
            <section style={{ ...card, marginTop: 18 }}>
              <h2 style={h2}>Gacha</h2>
              <p style={sub}>La secuencia encadena las cuatro rarezas seguidas; los botones sueltos repiten una sola.</p>
              <div style={row}>
                <button style={primary} onClick={() => runGacha(FORCED_ORDER)}>Secuencia · las cuatro</button>
                {FORCED_ORDER.map((r) => (
                  <button key={r} onClick={() => runGacha([r])} disabled={!cardOf(r)}
                    style={{
                      ...ghost, borderColor: `${RARITY_COLOR[r]}66`, color: RARITY_COLOR[r],
                      opacity: cardOf(r) ? 1 : 0.4, cursor: cardOf(r) ? 'pointer' : 'not-allowed',
                    }}>
                    {r.toUpperCase()}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}
      </div>

      {/* Overlay del reveal de gacha: mismo componente que la tirada real. */}
      {queue.length > 0 && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(11,14,20,.92)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20,
        }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 11, letterSpacing: '.18em', color: COLORS.muted }}>
            {(queue[0].rarity ?? '').toUpperCase()} · QUEDAN {queue.length - 1}
          </div>
          <GachaCardReveal
            key={`${runId}-${queue.length}`}
            result={queue[0]}
            reduced={!!reduced}
            onDone={nextPull}
          />
          <button style={ghost} onClick={() => setQueue([])}>Cerrar</button>
        </div>
      )}
    </div>
  )
}

const POT_WARN = '#f5c542'
const mono: CSSProperties = { fontFamily: FONTS.mono, fontSize: 13, color: COLORS.green }
const card: CSSProperties = {
  border: `1px solid ${COLORS.border}`, borderRadius: 16, background: COLORS.panel, padding: '18px 20px',
}
const h2: CSSProperties = { fontFamily: FONTS.display, fontSize: 17, margin: '0 0 4px', fontWeight: 700 }
const sub: CSSProperties = { margin: '0 0 14px', fontSize: 13.5, color: '#9aa5b3' }
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10 }
const primary: CSSProperties = {
  padding: '11px 18px', borderRadius: 11, border: 0, cursor: 'pointer',
  fontFamily: FONTS.display, fontSize: 13.5, fontWeight: 700, color: '#06170f', background: GRADIENT,
}
const ghost: CSSProperties = {
  padding: '11px 18px', borderRadius: 11, border: `1px solid ${COLORS.border}`, background: 'transparent',
  color: COLORS.text, cursor: 'pointer', fontFamily: FONTS.display, fontSize: 13.5, fontWeight: 600,
}
