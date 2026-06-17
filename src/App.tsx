import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Landing } from './ui/screens/Landing'
import { Hub } from './ui/screens/Hub/Hub'
import { GameLayout } from './ui/layouts/GameLayout'
import { ManaDuelFlow } from './ui/flows/ManaDuelFlow'
import { RoyaleFlow } from './ui/flows/RoyaleFlow'
import { OnchainFlow } from './ui/flows/OnchainFlow'
import { ProfilePage } from './ui/screens/Profile/ProfilePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Hub />} />
        <Route element={<GameLayout />}>
          <Route path="/play/mana" element={<ManaDuelFlow />} />
          <Route path="/play/royale" element={<RoyaleFlow />} />
          <Route path="/play/arena" element={<OnchainFlow />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
