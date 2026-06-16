import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  createMatch, commit, reveal, resolveRound, resolveBattle, nextRound,
  hashAllocation, DEFAULT_CONFIG, type MatchState, type Allocation,
} from '../../engine'
import { decide } from '../../bot/bot'
import { MOCK_CARDS } from '../../data/cards'
import { recordMatch } from '../../instrumentation/playtest'
import { SetupScreen, type Setup } from '../screens/SetupScreen'
import { PassDeviceScreen } from '../screens/PassDeviceScreen'
import { ResultScreen } from '../screens/ResultScreen'
import { FeedbackScreen } from '../screens/FeedbackScreen'
import { BattleBoard } from '../components/BattleBoard'
import { VsIntro } from '../components/VsIntro'
import { useReducedMotion } from '../useReducedMotion'
import { pageVariants, pageTransition } from '../transitions'

type OfflineScreen = 'setup' | 'allocateA' | 'passToB' | 'allocateB' | 'reveal' | 'result' | 'feedback'

export function ManaDuelFlow() {
  const reduced = useReducedMotion()

  // ── Offline state ───────────────────────────────────────────────────────
  const [offlineScreen, setOfflineScreen] = useState<OfflineScreen>('setup')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [state, setState] = useState<MatchState | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [allocA, setAllocA] = useState<Allocation | null>(null)
  const [showVsIntro, setShowVsIntro] = useState(false)

  const nameA = state ? state.cardA.name : 'A'
  const nameB = state ? state.cardB.name : 'B'

  // ── Offline handlers ────────────────────────────────────────────────────
  function start(s: Setup) {
    try {
      const cardA = MOCK_CARDS.find((c) => c.id === s.cardAId)!
      const cardB = MOCK_CARDS.find((c) => c.id === s.cardBId)!
      const st = createMatch(cardA, cardB, { ...DEFAULT_CONFIG, mode: s.mode, edgeEnabled: s.edgeEnabled })
      setSetup(s); setState(st); setError(undefined)
      setShowVsIntro(true)
      setOfflineScreen('allocateA')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function commitA(a: Allocation) {
    setAllocA(a)
    if (setup!.opponent === 'hotseat') setOfflineScreen('passToB')
    else await resolveBoth(a, decide(state!, 'b', [], setup!.difficulty))
  }

  async function commitB(b: Allocation) {
    await resolveBoth(allocA!, b)
  }

  async function resolveBoth(a: Allocation, b: Allocation) {
    try {
      let st = state!
      const saltA = crypto.randomUUID(), saltB = crypto.randomUUID()
      st = commit(st, 'a', await hashAllocation(a, saltA))
      st = commit(st, 'b', await hashAllocation(b, saltB))
      st = await reveal(st, 'a', a, saltA)
      st = await reveal(st, 'b', b, saltB)
      st = resolveRound(st)
      st = resolveBattle(st)
      setState(st)
      setOfflineScreen('reveal')
    } catch (e) {
      setError((e as Error).message)
      setOfflineScreen('setup')
    }
  }

  function continueAfterReveal() {
    let st = state!
    if (st.winner) {
      setOfflineScreen('result')
      return
    }
    st = nextRound(st)
    setState(st); setAllocA(null); setOfflineScreen('allocateA')
  }

  // ── Offline render ──────────────────────────────────────────────────────
  function renderScreen() {
    if (offlineScreen === 'setup' || !state) return <SetupScreen onStart={start} error={error} />

    const cur = state.rounds[state.round]

    if (offlineScreen === 'allocateA')
      return (
        <BattleBoard
          phase="allocate"
          playerKey="a"
          playerLabel={setup!.opponent === 'hotseat' ? `${nameA} (Player A)` : `You — ${nameA}`}
          onCommit={commitA}
          state={state}
          timerSeconds={setup!.timerSeconds}
        />
      )

    if (offlineScreen === 'passToB')
      return <PassDeviceScreen nextPlayer={`${nameB} (Player B)`} onReady={() => setOfflineScreen('allocateB')} />

    if (offlineScreen === 'allocateB')
      return (
        <BattleBoard
          phase="allocate"
          playerKey="b"
          playerLabel={`${nameB} (Player B)`}
          onCommit={commitB}
          state={state}
          timerSeconds={setup!.timerSeconds}
        />
      )

    if (offlineScreen === 'reveal')
      return (
        <BattleBoard
          phase="reveal"
          allocA={cur.revealA!}
          allocB={cur.revealB!}
          frontWinners={cur.frontWinners!}
          roundWinner={cur.roundWinner!}
          onContinue={continueAfterReveal}
          state={state}
        />
      )

    if (offlineScreen === 'result') {
      const wl = state.winner === 'a' ? `${nameA} wins` : `${nameB} wins`
      const celebrate = setup!.opponent === 'hotseat' || state.winner === 'a'
      return <ResultScreen winnerLabel={wl} celebrate={celebrate} onFeedback={() => setOfflineScreen('feedback')} />
    }

    if (offlineScreen === 'feedback')
      return <FeedbackScreen
        onSubmit={(rating, comment) => {
          const ratio = Math.max(state.cardA.valueUsd, state.cardB.valueUsd) / Math.min(state.cardA.valueUsd, state.cardB.valueUsd)
          recordMatch({
            ts: Date.now(), winner: state.winner, rounds: state.roundWins.a + state.roundWins.b,
            edgeEnabled: state.config.edgeEnabled, valueRatio: Number(ratio.toFixed(2)),
            mode: state.config.mode, difficulty: setup!.opponent === 'hotseat' ? 'n/a' : setup!.difficulty, funRating: rating, comment,
          })
        }}
        onPlayAgain={() => { setState(null); setSetup(null); setOfflineScreen('setup') }}
      />

    return null
  }

  return (
    <>
      {showVsIntro && state && (
        <VsIntro
          cardA={state.cardA}
          cardB={state.cardB}
          reducedMotion={reduced}
          onDone={() => setShowVsIntro(false)}
        />
      )}
      <AnimatePresence mode="wait">
        <motion.div
          key={offlineScreen}
          variants={pageVariants(reduced)}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={pageTransition(reduced)}
        >
          {renderScreen()}
        </motion.div>
      </AnimatePresence>
    </>
  )
}
