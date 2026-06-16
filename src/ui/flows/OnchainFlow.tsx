import { useState, lazy, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useReducedMotion } from '../useReducedMotion'
import { pageVariants, pageTransition } from '../transitions'
import type { SelectedCard } from '../screens/onchain/CollectionScreen'
import type { BattleInfo } from '../screens/onchain/LobbyScreen'

const AppKitProvider = lazy(() => import('../../wallet/AppKitProvider').then((m) => ({ default: m.AppKitProvider })))
const ConnectScreen = lazy(() => import('../screens/onchain/ConnectScreen').then((m) => ({ default: m.ConnectScreen })))
const CollectionScreen = lazy(() => import('../screens/onchain/CollectionScreen').then((m) => ({ default: m.CollectionScreen })))
const LobbyScreen = lazy(() => import('../screens/onchain/LobbyScreen').then((m) => ({ default: m.LobbyScreen })))
const OnchainBattleScreen = lazy(() => import('../screens/onchain/OnchainBattleScreen').then((m) => ({ default: m.OnchainBattleScreen })))
const GachaScreen = lazy(() => import('../screens/onchain/GachaScreen').then((m) => ({ default: m.GachaScreen })))

type OnchainScreen = 'connect' | 'collection' | 'lobby' | 'battle' | 'gacha'
export function OnchainFlow() {
  const reduced = useReducedMotion()
  const navigate = useNavigate()
  const [screen, setScreen] = useState<OnchainScreen>('connect')
  const [authToken, setAuthToken] = useState('')
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null)
  const [currentBattle, setCurrentBattle] = useState<BattleInfo | null>(null)
  const toLobby = () => navigate('/app')
  function renderScreen() {
    if (screen === 'connect') {
      return (
        <ConnectScreen
          onAuthenticated={(token) => {
            setAuthToken(token)
            setScreen('collection')
          }}
          onBack={toLobby}
        />
      )
    }

    if (screen === 'collection') {
      return (
        <CollectionScreen
          token={authToken}
          onSelectCard={(card) => {
            setSelectedCard(card)
            setScreen('lobby')
          }}
          onBack={() => setScreen('connect')}
          onOpenGacha={() => setScreen('gacha')}
        />
      )
    }

    if (screen === 'gacha' && authToken) {
      return (
        <GachaScreen
          token={authToken}
          onGoToCollection={() => setScreen('collection')}
          onBack={() => setScreen('collection')}
        />
      )
    }

    if (screen === 'lobby' && selectedCard) {
      return (
        <LobbyScreen
          token={authToken}
          selectedCard={selectedCard}
          onBattleJoined={(battleInfo) => {
            setCurrentBattle(battleInfo)
            setScreen('battle')
          }}
          onBack={() => setScreen('collection')}
        />
      )
    }

    if (screen === 'battle' && currentBattle) {
      return (
        <OnchainBattleScreen
          token={authToken}
          battle={currentBattle}
          onFinished={() => {
            setCurrentBattle(null)
            setScreen('lobby')
          }}
        />
      )
    }

    // Fallback: back to hub
    return (
      <ConnectScreen
        onAuthenticated={(token) => { setAuthToken(token); setScreen('collection') }}
        onBack={toLobby}
      />
    )
  }
  return (
    <Suspense fallback={<div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>}>
      <AppKitProvider>
        <AnimatePresence mode="wait">
          <motion.div key={screen} variants={pageVariants(reduced)} initial="initial" animate="animate" exit="exit" transition={pageTransition(reduced)} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderScreen()}
          </motion.div>
        </AnimatePresence>
      </AppKitProvider>
    </Suspense>
  )
}
