import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Suspense, lazy } from 'react'
import { COLORS } from './ui/theme'
import { Landing } from './ui/screens/Landing'
import { Hub } from './ui/screens/Hub/Hub'
import { ModeHub } from './ui/screens/Hub/ModeHub'
import { AppShell } from './ui/layouts/AppShell'
import { BattleFlow } from './ui/flows/BattleFlow'
import { DemoFlow } from './ui/flows/DemoFlow'
import { ProfilePage } from './ui/screens/Profile/ProfilePage'
import { LeaderboardPage } from './ui/screens/Leaderboard/LeaderboardPage'
import { HelpPage } from './ui/screens/Help/HelpPage'

const GachaVault = lazy(() => import('./ui/screens/gacha/GachaVault'))

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route element={<AppShell />}>
          <Route path="/home" element={<Hub />} />
          <Route path="/play/arena" element={<ModeHub mode="pack" />} />
          <Route path="/play/royale" element={<ModeHub mode="royale" />} />
          <Route path="/play/battle/:battleId" element={<BattleFlow />} />
          <Route path="/play/demo/:mode" element={<DemoFlow />} />
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
          <Route path="/ranking" element={<LeaderboardPage />} />
          <Route path="/help" element={<HelpPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
