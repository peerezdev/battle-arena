import { useEffect, useState, type CSSProperties } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { COLORS, FONTS } from '../theme'
import { useReducedMotion } from '../useReducedMotion'
import { fetchMachines, fetchMachineCards, type MachineCard, type GachaMachine } from '../../onchain/gachaClient'
import type { Battle } from '../../onchain/packBattleClient'
import { buildPackDemo, buildRoyaleDemo, royaleSnapshot, DEMO_ME } from '../../demo/demoBattle'
import { battleToReveal } from '../screens/battle/battleReveal'
import { PackReveal } from '../screens/battle/PackReveal'
import { BattleResult } from '../screens/battle/BattleResult'
import { RoyaleReveal, RoyaleResult } from '../screens/battle/RoyaleReveal'

const DEMO_MACHINE = 'pokemon_50'
const ROYALE_PLAYERS = 10
const ROUND_MS = 1700

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, padding: 24, textAlign: 'center', color: COLORS.text }}>
      {children}
    </div>
  )
}

// Small persistent ribbon so it's unmistakable this is a simulation, not a real (funded) battle.
function DemoBadge({ onExit }: { onExit: () => void }) {
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
  const exit = () => navigate('/app')

  const [battle, setBattle] = useState<Battle | null>(null)
  const [error, setError] = useState<string | null>(null)
  // pack: reveal animation → result. royale: reveal rounds one by one → result.
  const [revealDone, setRevealDone] = useState(false)
  const [revealed, setRevealed] = useState(1)
  const [done, setDone] = useState(false)

  // Build the simulated battle from a real machine's card pool (read-only — no funds).
  useEffect(() => {
    let cancelled = false
    setBattle(null); setError(null); setRevealDone(false); setRevealed(1); setDone(false)
    ;(async () => {
      try {
        const machines: GachaMachine[] = await fetchMachines()
        const m = machines.find((x) => x.code === DEMO_MACHINE) ?? machines[0]
        if (!m) throw new Error('No machines available')
        // Fetch per-rarity so the pool spans every tier (the unfiltered endpoint groups by rarity),
        // then the weighted pick reproduces the machine's real odds (mostly commons, rare epics).
        const rarities = Object.keys(m.odds)
        const byRarity = await Promise.all(rarities.map((r) => fetchMachineCards(m.code, { rarity: r, limit: 24 }).catch(() => [] as MachineCard[])))
        let cards: MachineCard[] = byRarity.flat()
        if (!cards.length) cards = await fetchMachineCards(m.code, { limit: 80 }).catch(() => [])
        if (!cards.length) throw new Error('No cards in the pool')
        const b = isRoyale
          ? buildRoyaleDemo(cards, m.odds, m.code, m.price, ROYALE_PLAYERS)
          : buildPackDemo(cards, m.odds, m.code, m.price)
        if (!cancelled) setBattle(b)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not start the demo')
      }
    })()
    return () => { cancelled = true }
  }, [isRoyale])

  // Royale: advance one round per tick, then settle into the result screen.
  const totalRounds = battle && isRoyale ? battle.rounds.length : 0
  useEffect(() => {
    if (!battle || !isRoyale || done) return
    if (revealed >= totalRounds) { const t = setTimeout(() => setDone(true), ROUND_MS); return () => clearTimeout(t) }
    const t = setTimeout(() => setRevealed((r) => r + 1), ROUND_MS)
    return () => clearTimeout(t)
  }, [battle, isRoyale, revealed, done, totalRounds])

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
      <DemoBadge onExit={exit} />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {isRoyale ? (
          done
            ? <RoyaleResult vm={battleToReveal(battle, DEMO_ME)} battleId="demo" onExit={exit} />
            : <RoyaleReveal vm={battleToReveal(royaleSnapshot(battle, revealed), DEMO_ME)} reducedMotion={!!reduced} />
        ) : (
          revealDone
            ? <BattleResult vm={battleToReveal(battle, DEMO_ME)} battleId="demo" onExit={exit} />
            : <PackReveal vm={battleToReveal(battle, DEMO_ME)} reducedMotion={!!reduced} onComplete={() => setRevealDone(true)} onExit={exit} />
        )}
      </div>
    </div>
  )
}

const backBtn: CSSProperties = {
  marginTop: 8, background: '#0c1019', color: COLORS.text, border: `1px solid ${COLORS.border}`,
  borderRadius: 10, padding: '10px 22px', fontWeight: 700, cursor: 'pointer',
}
