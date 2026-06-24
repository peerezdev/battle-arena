import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { COLORS } from './ui/theme'
import { Landing } from './ui/screens/Landing'
import { Hub } from './ui/screens/Hub/Hub'
import { AppShell } from './ui/layouts/AppShell'
import { ManaDuelFlow } from './ui/flows/ManaDuelFlow'
import { RoyaleFlow } from './ui/flows/RoyaleFlow'
import { OnchainFlow } from './ui/flows/OnchainFlow'
import { BattleFlow } from './ui/flows/BattleFlow'
import { ProfilePage } from './ui/screens/Profile/ProfilePage'

const GachaVault = lazy(() => import('./ui/screens/gacha/GachaVault'))

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<AppShell />}>
          <Route path="/app" element={<Hub />} />
          <Route path="/play/mana" element={<ManaDuelFlow />} />
          <Route path="/play/royale" element={<RoyaleFlow />} />
          <Route path="/play/arena" element={<OnchainFlow />} />
          <Route path="/play/battle/:battleId" element={<BattleFlow />} />
          <Route
            path="/play/gacha"
            element={
              <Suspense
                fallback={
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '100%',
                      color: COLORS.muted,
                    }}
                  >
                    Loading…
                  </div>
                }
              >
                <GachaVault />
              </Suspense>
            }
          />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/profile/:wallet" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
