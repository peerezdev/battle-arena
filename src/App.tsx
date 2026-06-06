import { useState } from 'react'
import {
  createMatch, availableEnergy, commit, reveal, resolveRound, resolveBattle, nextRound,
  hashAllocation, DEFAULT_CONFIG, type MatchState, type Allocation,
} from './engine'
import { decide } from './bot/bot'
import { MOCK_CARDS } from './data/cards'
import { recordMatch } from './instrumentation/playtest'
import { SetupScreen, type Setup } from './ui/screens/SetupScreen'
import { AllocationScreen } from './ui/screens/AllocationScreen'
import { PassDeviceScreen } from './ui/screens/PassDeviceScreen'
import { RevealScreen } from './ui/screens/RevealScreen'
import { ResultScreen } from './ui/screens/ResultScreen'
import { FeedbackScreen } from './ui/screens/FeedbackScreen'

type Screen = 'setup' | 'allocateA' | 'passToB' | 'allocateB' | 'reveal' | 'result' | 'feedback'

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [state, setState] = useState<MatchState | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [allocA, setAllocA] = useState<Allocation | null>(null)

  const nameA = state ? state.cardA.name : 'A'
  const nameB = state ? state.cardB.name : 'B'

  function start(s: Setup) {
    try {
      const cardA = MOCK_CARDS.find((c) => c.id === s.cardAId)!
      const cardB = MOCK_CARDS.find((c) => c.id === s.cardBId)!
      const st = createMatch(cardA, cardB, { ...DEFAULT_CONFIG, mode: s.mode, edgeEnabled: s.edgeEnabled })
      setSetup(s); setState(st); setError(undefined); setScreen('allocateA')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function commitA(a: Allocation) {
    setAllocA(a)
    if (setup!.opponent === 'hotseat') setScreen('passToB')
    else await resolveBoth(a, decide(state!, 'b', [], setup!.difficulty))
  }

  async function commitB(b: Allocation) {
    await resolveBoth(allocA!, b)
  }

  async function resolveBoth(a: Allocation, b: Allocation) {
    let st = state!
    const saltA = crypto.randomUUID(), saltB = crypto.randomUUID()
    st = commit(st, 'a', await hashAllocation(a, saltA))
    st = commit(st, 'b', await hashAllocation(b, saltB))
    st = await reveal(st, 'a', a, saltA)
    st = await reveal(st, 'b', b, saltB)
    st = resolveRound(st)
    st = resolveBattle(st)
    setState(st)
    setScreen('reveal')
  }

  function continueAfterReveal() {
    let st = state!
    if (st.winner) {
      // Do NOT record here — we record once in feedback.onSubmit with the real funRating
      setScreen('result')
      return
    }
    st = nextRound(st)
    setState(st); setAllocA(null); setScreen('allocateA')
  }

  if (screen === 'setup' || !state) return <SetupScreen onStart={start} error={error} />

  const cur = state.rounds[state.round]

  if (screen === 'allocateA')
    return <AllocationScreen available={availableEnergy(state, 'a')} winsA={state.roundWins.a} winsB={state.roundWins.b} round={state.round} playerLabel={setup!.opponent === 'hotseat' ? `${nameA} (Jugador A)` : `Tú — ${nameA}`} onCommit={commitA} />

  if (screen === 'passToB')
    return <PassDeviceScreen nextPlayer={`${nameB} (Jugador B)`} onReady={() => setScreen('allocateB')} />

  if (screen === 'allocateB')
    return <AllocationScreen available={availableEnergy(state, 'b')} winsA={state.roundWins.a} winsB={state.roundWins.b} round={state.round} playerLabel={`${nameB} (Jugador B)`} onCommit={commitB} />

  if (screen === 'reveal')
    return <RevealScreen allocA={cur.revealA!} allocB={cur.revealB!} frontWinners={cur.frontWinners!} roundWinner={cur.roundWinner!} nameA={nameA} nameB={nameB} onContinue={continueAfterReveal} />

  if (screen === 'result') {
    const wl = state.winner === 'a' ? `Gana ${nameA}` : `Gana ${nameB}`
    return <ResultScreen winnerLabel={wl} onFeedback={() => setScreen('feedback')} />
  }

  if (screen === 'feedback')
    return <FeedbackScreen
      onSubmit={(rating, comment) => {
        // Single record per finished match — recorded here with the real funRating
        const ratio = Math.max(state.cardA.valueUsd, state.cardB.valueUsd) / Math.min(state.cardA.valueUsd, state.cardB.valueUsd)
        recordMatch({
          ts: Date.now(), winner: state.winner, rounds: state.round + 1,
          edgeEnabled: state.config.edgeEnabled, valueRatio: Number(ratio.toFixed(2)),
          mode: state.config.mode, difficulty: setup!.difficulty, funRating: rating, comment,
        })
      }}
      onPlayAgain={() => { setState(null); setSetup(null); setScreen('setup') }}
    />

  return null
}
