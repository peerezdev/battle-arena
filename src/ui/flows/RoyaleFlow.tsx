import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { createRoyale, playRound } from '../../royale/engine'
import type { RoyaleState, RoyaleConfig } from '../../royale/types'
import { RoyaleSetupScreen } from '../screens/royale/RoyaleSetupScreen'
import { RoyaleBoard } from '../screens/royale/RoyaleBoard'
import { RoyaleResultScreen } from '../screens/royale/RoyaleResultScreen'
import { useReducedMotion } from '../useReducedMotion'
import { pageVariants, pageTransition } from '../transitions'

type RoyaleScreen = 'setup' | 'board' | 'result'
export function RoyaleFlow() {
  const reduced = useReducedMotion()
  const navigate = useNavigate()
  const [screen, setScreen] = useState<RoyaleScreen>('setup')
  const [rstate, setRstate] = useState<RoyaleState | null>(null)
  function startRoyale(config: RoyaleConfig) { setRstate(createRoyale(config, ['You'])); setScreen('board') }
  function playRoundFn() { setRstate((s) => (s ? playRound(s) : s)) }
  const exit = () => navigate('/app')
  return (
    <AnimatePresence mode="wait">
      <motion.div key={screen} variants={pageVariants(reduced)} initial="initial" animate="animate" exit="exit" transition={pageTransition(reduced)}>
        {screen === 'setup' && <RoyaleSetupScreen onStart={startRoyale} onBack={exit} />}
        {screen === 'board' && rstate && <RoyaleBoard state={rstate} onPlayRound={playRoundFn} onFinish={() => setScreen('result')} reducedMotion={!!reduced} />}
        {screen === 'result' && rstate && <RoyaleResultScreen state={rstate} onPlayAgain={() => { setScreen('setup'); setRstate(null) }} onExit={exit} reducedMotion={!!reduced} />}
      </motion.div>
    </AnimatePresence>
  )
}
