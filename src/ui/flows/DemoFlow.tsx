import { useEffect, useState, type CSSProperties } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { COLORS, FONTS } from '../theme'
import { useReducedMotion } from '../useReducedMotion'
import type { Battle } from '../../onchain/packBattleClient'
import { buildPackDemo, buildRoyaleDemo, DEMO_ME } from '../../demo/demoBattle'
import { fetchDemoPool, FORCED_ORDER } from '../../demo/demoPool'
import { battleToReveal } from '../screens/battle/battleReveal'
import { PackReveal } from '../screens/battle/PackReveal'
import { BattleResult } from '../screens/battle/BattleResult'
import { RoyaleReveal, RoyaleResult } from '../screens/battle/RoyaleReveal'

const ROYALE_PLAYERS = 10

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center', color: COLORS.text }}>
      {children}
    </div>
  )
}

// Small persistent ribbon so it's unmistakable this is a simulation, not a real (funded) battle.
// Aparcado: su uso está comentado más abajo. Se exporta para conservarlo sin que el
// build falle por "declarado y no usado".
export function DemoBadge({ onExit }: { onExit: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px clamp(14px,2.4vw,28px)', borderBottom: `1px solid ${COLORS.border}`, background: 'rgba(255,46,151,.06)' }}>
      <span style={{ fontFamily: FONTS.mono, fontSize: 10, fontWeight: 700, letterSpacing: '.16em', color: COLORS.violet, padding: '3px 9px', borderRadius: 7, background: 'rgba(255,46,151,.14)', border: `1px solid ${COLORS.violet}55` }}>DEMO</span>
      <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.muted }}>Simulated pulls · no funds spent</span>
      <button onClick={onExit} style={{ marginLeft: 'auto', background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 9, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Exit demo</button>
    </div>
  )
}

export function DemoFlow() {
  const { mode } = useParams<{ mode: string }>()
  const navigate = useNavigate()
  const reduced = useReducedMotion()
  const isRoyale = mode === 'royale'
  // ?forced=1 → las rarezas salen en orden epic → rare → uncommon → common, para poder
  // ajustar tiempos y sonidos de cada una sin depender de la suerte.
  const [params] = useSearchParams()
  const forced = params.get('forced') === '1' ? FORCED_ORDER : undefined
  const exit = () => navigate('/home')

  const [battle, setBattle] = useState<Battle | null>(null)
  const [error, setError] = useState<string | null>(null)
  // pack: reveal animation → result. royale: the cinematic reveal (RoyaleReveal + useRoyaleReveal)
  // paces the whole thing and calls onComplete when the last round finishes → show the result.
  const [revealDone, setRevealDone] = useState(false)
  const [done, setDone] = useState(false)

  // Build the simulated battle from a real machine's card pool (read-only — no funds).
  useEffect(() => {
    let cancelled = false
    setBattle(null); setError(null); setRevealDone(false); setDone(false)
    ;(async () => {
      try {
        const { machine: m, cards } = await fetchDemoPool()
        const b = isRoyale
          ? buildRoyaleDemo(cards, m.odds, m.code, m.price, ROYALE_PLAYERS, Math.random, forced)
          : buildPackDemo(cards, m.odds, m.code, m.price, Math.random, forced)
        if (!cancelled) setBattle(b)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not start the demo')
      }
    })()
    return () => { cancelled = true }
  }, [isRoyale, forced])

  // Los rivales de la demo NO lanzan emotes. Un emote es una acción de una persona; ponerlo en
  // boca de un bot finge que hay alguien al otro lado. En una batalla real un bot tampoco puede:
  // el endpoint exige token de Privy y los bots no inician sesión.

  if (error) {
    return (
      <Centered>
        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 18 }}>Demo unavailable</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>{error}</div>
        <button onClick={exit} style={backBtn}>Back</button>
      </Centered>
    )
  }
  if (!battle) {
    return <Centered><div style={{ fontFamily: FONTS.mono, fontSize: 13, color: COLORS.muted }}>Dealing the demo…</div></Centered>
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* <DemoBadge onExit={exit} /> */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {isRoyale ? (
          done
            ? <RoyaleResult vm={battleToReveal(battle, DEMO_ME)} battleId="demo" onExit={exit} />
            : <RoyaleReveal vm={battleToReveal(battle, DEMO_ME)} reducedMotion={!!reduced} battleId="demo" onComplete={() => setDone(true)} />
        ) : (
          revealDone
            ? <BattleResult vm={battleToReveal(battle, DEMO_ME)} battleId="demo" onExit={exit} />
            : <PackReveal vm={battleToReveal(battle, DEMO_ME)} reducedMotion={!!reduced} onComplete={() => setRevealDone(true)} />
        )}
      </div>
    </div>
  )
}

const backBtn: CSSProperties = {
  marginTop: 8, background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
  borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
}
