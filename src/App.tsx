import { useState, lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  createMatch, commit, reveal, resolveRound, resolveBattle, nextRound,
  hashAllocation, DEFAULT_CONFIG, type MatchState, type Allocation,
} from './engine'
import { decide } from './bot/bot'
import { MOCK_CARDS } from './data/cards'
import { recordMatch } from './instrumentation/playtest'
import { SetupScreen, type Setup } from './ui/screens/SetupScreen'
import { PassDeviceScreen } from './ui/screens/PassDeviceScreen'
import { ResultScreen } from './ui/screens/ResultScreen'
import { BattleBoard } from './ui/components/BattleBoard'
import { FeedbackScreen } from './ui/screens/FeedbackScreen'
import { MuteButton } from './ui/components/MuteButton'
import { VsIntro } from './ui/components/VsIntro'
import { useReducedMotion } from './ui/useReducedMotion'
import { ModeSelect, type AppMode } from './mode/ModeSelect'
import type { SelectedCard } from './ui/screens/onchain/CollectionScreen'
import type { BattleInfo } from './ui/screens/onchain/LobbyScreen'

// ── Lazy-loaded on-chain bundle (never imported for offline users) ──────────
const AppKitProvider = lazy(() =>
  import('./wallet/AppKitProvider').then((m) => ({ default: m.AppKitProvider }))
)
const ConnectScreen = lazy(() =>
  import('./ui/screens/onchain/ConnectScreen').then((m) => ({ default: m.ConnectScreen }))
)
const CollectionScreen = lazy(() =>
  import('./ui/screens/onchain/CollectionScreen').then((m) => ({ default: m.CollectionScreen }))
)
const LobbyScreen = lazy(() =>
  import('./ui/screens/onchain/LobbyScreen').then((m) => ({ default: m.LobbyScreen }))
)
const OnchainBattleScreen = lazy(() =>
  import('./ui/screens/onchain/OnchainBattleScreen').then((m) => ({ default: m.OnchainBattleScreen }))
)

// ── Offline screen names ────────────────────────────────────────────────────
type OfflineScreen = 'setup' | 'allocateA' | 'passToB' | 'allocateB' | 'reveal' | 'result' | 'feedback'

// ── On-chain screen names ───────────────────────────────────────────────────
type OnchainScreen = 'connect' | 'collection' | 'lobby' | 'battle'

export default function App() {
  const reduced = useReducedMotion()

  // ── Mode selection ──────────────────────────────────────────────────────
  const [appMode, setAppMode] = useState<AppMode | null>(null)

  // ── Offline state ───────────────────────────────────────────────────────
  const [offlineScreen, setOfflineScreen] = useState<OfflineScreen>('setup')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [state, setState] = useState<MatchState | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [allocA, setAllocA] = useState<Allocation | null>(null)
  const [showVsIntro, setShowVsIntro] = useState(false)

  // ── On-chain state ──────────────────────────────────────────────────────
  const [onchainScreen, setOnchainScreen] = useState<OnchainScreen>('connect')
  const [authToken, setAuthToken] = useState<string>('')
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null)
  const [currentBattle, setCurrentBattle] = useState<BattleInfo | null>(null)

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
  function renderOfflineScreen() {
    if (offlineScreen === 'setup' || !state) return <SetupScreen onStart={start} error={error} />

    const cur = state.rounds[state.round]

    if (offlineScreen === 'allocateA')
      return (
        <BattleBoard
          phase="allocate"
          playerKey="a"
          playerLabel={setup!.opponent === 'hotseat' ? `${nameA} (Jugador A)` : `Tu — ${nameA}`}
          onCommit={commitA}
          state={state}
          timerSeconds={setup!.timerSeconds}
        />
      )

    if (offlineScreen === 'passToB')
      return <PassDeviceScreen nextPlayer={`${nameB} (Jugador B)`} onReady={() => setOfflineScreen('allocateB')} />

    if (offlineScreen === 'allocateB')
      return (
        <BattleBoard
          phase="allocate"
          playerKey="b"
          playerLabel={`${nameB} (Jugador B)`}
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
      const wl = state.winner === 'a' ? `Gana ${nameA}` : `Gana ${nameB}`
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

  // ── On-chain render (always inside AppKitProvider) ──────────────────────
  function renderOnchainScreen() {
    if (onchainScreen === 'connect') {
      return (
        <ConnectScreen
          onAuthenticated={(token) => {
            setAuthToken(token)
            setOnchainScreen('collection')
          }}
          onBack={() => setAppMode(null)}
        />
      )
    }

    if (onchainScreen === 'collection') {
      return (
        <CollectionScreen
          token={authToken}
          onSelectCard={(card) => {
            setSelectedCard(card)
            setOnchainScreen('lobby')
          }}
          onBack={() => setOnchainScreen('connect')}
        />
      )
    }

    if (onchainScreen === 'lobby' && selectedCard) {
      return (
        <LobbyScreen
          token={authToken}
          selectedCard={selectedCard}
          onBattleJoined={(battleInfo) => {
            setCurrentBattle(battleInfo)
            setOnchainScreen('battle')
          }}
          onBack={() => setOnchainScreen('collection')}
        />
      )
    }

    if (onchainScreen === 'battle' && currentBattle) {
      return (
        <OnchainBattleScreen
          token={authToken}
          battle={currentBattle}
          onFinished={() => {
            setCurrentBattle(null)
            setOnchainScreen('lobby')
          }}
        />
      )
    }

    // Fallback: back to connect
    return (
      <ConnectScreen
        onAuthenticated={(token) => { setAuthToken(token); setOnchainScreen('collection') }}
        onBack={() => setAppMode(null)}
      />
    )
  }

  // ── Animation variants ──────────────────────────────────────────────────
  const variants = reduced
    ? { initial: {}, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, x: 24 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -24 },
      }

  // ── Mode select ──────────────────────────────────────────────────────────
  if (appMode === null) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="mode-select"
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: reduced ? 0 : 0.28, ease: 'easeInOut' }}
        >
          <ModeSelect onSelect={setAppMode} />
        </motion.div>
      </AnimatePresence>
    )
  }

  // ── Offline flow ──────────────────────────────────────────────────────────
  if (appMode === 'offline') {
    return (
      <>
        <MuteButton />
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
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: reduced ? 0 : 0.28, ease: 'easeInOut' }}
          >
            {renderOfflineScreen()}
          </motion.div>
        </AnimatePresence>
      </>
    )
  }

  // ── On-chain flow (wrapped in AppKitProvider, lazy-loaded) ────────────────
  return (
    <Suspense fallback={<div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Cargando...</div>}>
      <AppKitProvider>
        <AnimatePresence mode="wait">
          <motion.div
            key={onchainScreen}
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: reduced ? 0 : 0.28, ease: 'easeInOut' }}
          >
            {renderOnchainScreen()}
          </motion.div>
        </AnimatePresence>
      </AppKitProvider>
    </Suspense>
  )
}
