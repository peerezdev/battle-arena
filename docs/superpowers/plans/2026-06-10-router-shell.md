# Router + App Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Introducir React Router (URLs + botón atrás), un `GameLayout` compartido (top bar fina + fondo) para las pantallas de juego, y descomponer `App.tsx` en contenedores de flujo.

**Architecture:** `App.tsx` pasa a ser `<BrowserRouter>` + `<Routes>`. El estado de cada flujo se extrae a contenedores (`ManaDuelFlow`, `RoyaleFlow`, `OnchainFlow`) que poseen su estado y navegan con `useNavigate`. El Hub conserva su shell propio; los juegos van bajo `GameLayout`. El motor (`src/engine`, `src/royale`) no se toca.

**Tech Stack:** React + react-router-dom + framer-motion + tokens de `src/ui/theme.ts`.

**Spec:** `docs/superpowers/specs/2026-06-10-router-shell-design.md`.
**Verificación (UI):** `npx tsc --noEmit` + `npx vitest run` (102 tests de motor) + `npm run build` verdes en cada tarea, y revisión visual al final.

**Rutas finales:** `/` Landing · `/app` Hub · `/play/mana` ManaDuelFlow · `/play/royale` RoyaleFlow · `/play/arena` OnchainFlow · `*` → `/`.

**Nota de orden:** las Tasks 1–3 crean archivos NUEVOS sin tocar `App.tsx` (que sigue funcionando con su state machine). La Task 4 reescribe `App.tsx` para usar router + flujos. Así cada tarea compila en verde.

---

### Task 1: Instalar router + util de transición + GameLayout

**Files:**
- Modify: `package.json` (vía `npm install`)
- Create: `src/ui/transitions.ts`
- Create: `src/ui/layouts/GameLayout.tsx`

- [ ] **Step 1: Instalar react-router-dom**
```bash
npm install react-router-dom
```

- [ ] **Step 2: `src/ui/transitions.ts`** — variants de página DRY (hoy duplicadas en App).
```ts
// Variants de transición de página (slide+fade), respetando reduced-motion.
export function pageVariants(reduced: boolean) {
  return reduced
    ? { initial: {}, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, x: 24 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -24 },
      }
}
export const pageTransition = (reduced: boolean) => ({ duration: reduced ? 0 : 0.28, ease: 'easeInOut' as const })
```

- [ ] **Step 3: `src/ui/layouts/GameLayout.tsx`** — marco de juego (top bar fina + fondo + Outlet).
```tsx
import { Outlet, useNavigate } from 'react-router-dom'
import { COLORS, GRADIENT, FONTS } from '../theme'
import { MuteButton } from '../components/MuteButton'

export function GameLayout() {
  const navigate = useNavigate()
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: COLORS.bg, color: COLORS.text, overflow: 'hidden' }}>
      {/* Top bar fina */}
      <header style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 18px', borderBottom: `1px solid ${COLORS.border}`, background: '#0c1019' }}>
        <button onClick={() => navigate('/app')}
          style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', fontFamily: FONTS.body, fontSize: 13, fontWeight: 600 }}>
          ← Lobby
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: FONTS.display, fontWeight: 800, fontSize: 15, letterSpacing: '-.01em' }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: GRADIENT, boxShadow: '0 0 10px #9945FF88' }} /> BattleArena
        </div>
        <div style={{ flex: 1 }} />
        {/* Balance — EJEMPLO, no es un saldo real */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#11161f', border: `1px solid ${COLORS.border}`, borderRadius: 11, padding: '7px 13px' }}>
          <span style={{ fontSize: 9, color: COLORS.muted, letterSpacing: '.1em' }}>BALANCE</span>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14 }}>$128.40</span>
        </div>
        <MuteButton />
      </header>
      {/* Contenido del juego */}
      <main style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </main>
    </div>
  )
}
```
Nota: si `MuteButton` se posiciona `fixed`, déjalo; conviven bien. El balance lleva el comentario de "EJEMPLO".

- [ ] **Step 4: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → verde (archivos nuevos sin usar; deben compilar). `react-router-dom` en package.json.

- [ ] **Step 5: Commit**
```bash
git add package.json package-lock.json src/ui/transitions.ts src/ui/layouts/GameLayout.tsx
git commit -m "feat(nav): instala react-router-dom, util de transición y GameLayout (top bar fina)"
```

---

### Task 2: ManaDuelFlow (extraer flujo offline)

**Files:**
- Create: `src/ui/flows/ManaDuelFlow.tsx`

- [ ] **Step 1: `src/ui/flows/ManaDuelFlow.tsx`** — mueve el estado y los handlers offline de `App.tsx` (líneas 64–70, 82–135, 149–215) a un contenedor propio. Imports necesarios: `useState`, `AnimatePresence, motion` (framer-motion), el motor (`createMatch, commit, reveal, resolveRound, resolveBattle, nextRound, hashAllocation, DEFAULT_CONFIG, type MatchState, type Allocation`), `decide` (`../../bot/bot`), `MOCK_CARDS` (`../../data/cards`), `recordMatch` (`../../instrumentation/playtest`), `SetupScreen, type Setup`, `PassDeviceScreen`, `ResultScreen`, `FeedbackScreen`, `BattleBoard`, `VsIntro`, `useReducedMotion`, `pageVariants, pageTransition` (`../transitions`).

```tsx
export function ManaDuelFlow() {
  const reduced = useReducedMotion()
  // estado: offlineScreen ('setup'|'allocateA'|'passToB'|'allocateB'|'reveal'|'result'|'feedback'),
  //         setup, state, error, allocA, showVsIntro
  // handlers: start, commitA, commitB, resolveBoth, continueAfterReveal
  //   (idénticos a App.tsx líneas 86–135)
  // renderScreen(): idéntico a renderOfflineScreen() de App.tsx (líneas 150–215),
  //   con los playerLabel/winnerLabel en inglés ya existentes.
  // Render: <> {showVsIntro && state && <VsIntro .../>}
  //   <AnimatePresence mode="wait"><motion.div key={offlineScreen}
  //     variants={pageVariants(reduced)} initial="initial" animate="animate" exit="exit"
  //     transition={pageTransition(reduced)}>{renderScreen()}</motion.div></AnimatePresence> </>
}
```
No incluye `MuteButton` (lo aporta `GameLayout`). El "Play again" del FeedbackScreen sigue reseteando estado interno (`setState(null); setSetup(null); setOfflineScreen('setup')`). No hay "salir al lobby" interno: eso lo da el "← Lobby" del `GameLayout`.

- [ ] **Step 2: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → verde.

- [ ] **Step 3: Commit**
```bash
git add src/ui/flows/ManaDuelFlow.tsx
git commit -m "feat(nav): extrae ManaDuelFlow (flujo offline) a contenedor propio"
```

---

### Task 3: RoyaleFlow + OnchainFlow (extraer flujos)

**Files:**
- Create: `src/ui/flows/RoyaleFlow.tsx`
- Create: `src/ui/flows/OnchainFlow.tsx`

- [ ] **Step 1: `src/ui/flows/RoyaleFlow.tsx`** — mueve el estado/handlers royale (App.tsx 72–74, 137–147, 371–408). Usa `useNavigate` para salir al lobby.
```tsx
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
```

- [ ] **Step 2: `src/ui/flows/OnchainFlow.tsx`** — mueve el estado/handlers onchain (App.tsx 76–80, 217–289, 410–428) + el `AppKitProvider` lazy + los imports lazy de pantallas onchain (App.tsx 30–47). Usa `useNavigate` para salir al lobby.
```tsx
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
    // idéntico a renderOnchainScreen() de App.tsx (219–289), pero los onBack que
    // hacían setAppMode('hub') ahora son toLobby(); los onBack intra-flujo
    // (collection→connect, etc.) se mantienen con setScreen(...).
  }
  return (
    <Suspense fallback={<div style={{ minHeight: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading…</div>}>
      <AppKitProvider>
        <AnimatePresence mode="wait">
          <motion.div key={screen} variants={pageVariants(reduced)} initial="initial" animate="animate" exit="exit" transition={pageTransition(reduced)}>
            {renderScreen()}
          </motion.div>
        </AnimatePresence>
      </AppKitProvider>
    </Suspense>
  )
}
```
Implementa `renderScreen()` completo replicando App.tsx 219–289 (connect/collection/gacha/lobby/battle + fallback), sustituyendo los dos `setAppMode('hub')` por `toLobby()`.

- [ ] **Step 3: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → verde.

- [ ] **Step 4: Commit**
```bash
git add src/ui/flows/RoyaleFlow.tsx src/ui/flows/OnchainFlow.tsx
git commit -m "feat(nav): extrae RoyaleFlow y OnchainFlow (con AppKitProvider) a contenedores"
```

---

### Task 4: Reescribir App.tsx con el router + navegación en Hub/Landing

**Files:**
- Modify: `src/App.tsx` (reescritura completa)
- Modify: `src/ui/screens/Hub/Hub.tsx` (usar `useNavigate`)
- Modify: `src/ui/screens/Landing.tsx` (usar `useNavigate`)
- Modify: `src/main.tsx` (si hace falta, nada — el Router vive en App)

- [ ] **Step 1: Reescribe `src/App.tsx`** entero:
```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Landing } from './ui/screens/Landing'
import { Hub } from './ui/screens/Hub/Hub'
import { GameLayout } from './ui/layouts/GameLayout'
import { ManaDuelFlow } from './ui/flows/ManaDuelFlow'
import { RoyaleFlow } from './ui/flows/RoyaleFlow'
import { OnchainFlow } from './ui/flows/OnchainFlow'

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
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
```

- [ ] **Step 2: `Hub.tsx`** — sustituye los callbacks de navegación por `useNavigate`.
  - Importa `import { useNavigate } from 'react-router-dom'`.
  - Quita las props `onPlayMana/onPlayRoyale/onOnchain` (el Hub ya no las recibe; `App` lo renderiza sin props).
  - Dentro: `const navigate = useNavigate()`. La función `go(id: HubNav)` pasa a: `mana`→`navigate('/play/mana')`, `royale`→`navigate('/play/royale')`, `pack`|`gacha`→`navigate('/play/arena')`, `lobby`/`ranks`→`setActive(id)`. QuickMatch `onFindMatch`/`onCreate` → `navigate('/play/arena')`. La acción de batalla (`onBattleAction`) → `navigate('/play/arena')`.

- [ ] **Step 3: `Landing.tsx`** — usa `useNavigate` en vez de la prop `onLaunch`.
  - Importa `useNavigate`; quita la prop `onLaunch` (la interfaz `Props` queda vacía → el componente no recibe props).
  - `const navigate = useNavigate()`; todos los `onClick={onLaunch}` pasan a `onClick={() => navigate('/app')}`.

- [ ] **Step 4: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → verde. Razona: `/` Landing → Launch App → `/app` Hub → cada tile/rail navega a `/play/*` bajo GameLayout; "← Lobby" y back del navegador vuelven a `/app`.

- [ ] **Step 5: Commit**
```bash
git add src/App.tsx src/ui/screens/Hub/Hub.tsx src/ui/screens/Landing.tsx
git commit -m "feat(nav): App.tsx como router; Hub y Landing navegan con useNavigate"
```

---

### Task 5: Altura de los tableros bajo el GameLayout + verificación final

**Files:**
- Modify: `src/ui/components/BattleBoard.tsx`
- Modify: `src/ui/screens/royale/RoyaleBoard.tsx`
- Modify (según haga falta): `src/ui/screens/SetupScreen.tsx`, `ResultScreen.tsx`, `FeedbackScreen.tsx`, `PassDeviceScreen.tsx`, `src/ui/screens/royale/RoyaleSetupScreen.tsx`, `RoyaleResultScreen.tsx`, y las pantallas onchain.

`GameLayout` ya aporta el `100dvh` y la top bar; las pantallas internas NO deben volver a forzar `100dvh` (provocaría scroll/recorte bajo la top bar).

- [ ] **Step 1:** En `BattleBoard.tsx`, el contenedor raíz que usa `height: '100dvh'` (y `overflow: 'hidden'`) pásalo a `height: '100%'`. Verifica que la barra de COMMIT/Continue inferior sigue visible (el board es flex-column con secciones pinned; al ocupar el 100% del `<main>` del GameLayout debe encajar).
- [ ] **Step 2:** En el resto de pantallas de juego, cambia el `minHeight: '100dvh'` / `height: '100dvh'` del contenedor raíz por `minHeight: '100%'`. Comando para localizarlos:
  ```bash
  grep -rn "100dvh" src/ui/components/BattleBoard.tsx src/ui/screens/SetupScreen.tsx src/ui/screens/ResultScreen.tsx src/ui/screens/FeedbackScreen.tsx src/ui/screens/PassDeviceScreen.tsx src/ui/screens/royale src/ui/screens/onchain
  ```
  Cámbialos a `100%` (raíz de cada pantalla). NO toques `100dvh` del `GameLayout` ni del `Hub`/`Landing` (esos sí son contenedores de viewport).
- [ ] **Step 3: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → tsc limpio, 102 tests verdes, build OK.
- [ ] **Step 4: Visual** (`npm run preview`): `/` → Launch App → `/app`; abrir Mana/Royale/Arena → top bar fina con ← Lobby, sin doble scroll ni board recortado; el back del navegador vuelve a `/app`; recargar `/play/mana` carga esa pantalla; URL inventada → `/`. Dejar anotado para revisión del usuario.
- [ ] **Step 5: Commit**
```bash
git add src/ui
git commit -m "fix(nav): pantallas de juego a height 100% bajo el GameLayout (sin doble scroll)"
```
