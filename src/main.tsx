import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppPrivyProvider } from './wallet/AppPrivyProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppPrivyProvider>
      <App />
    </AppPrivyProvider>
  </StrictMode>,
)
