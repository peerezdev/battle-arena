# Battle Royale — Prototipo jugable (Fase 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Prototipo web jugable de Battle Royale (2-10 jugadores, tiradas frescas por ronda con valores SIMULADOS, bote total al ganador) — sin blockchain ni Gacha real, estilo Fase 0 del Blotto.

**Architecture:** Motor puro de TS en `src/royale/` (determinista, RNG inyectable, testeable) + pantallas React en `src/ui/screens/royale/`, enganchadas como un tercer modo (`'royale'`) en `ModeSelect`/`App.tsx`. Humano = jugador 0; el resto son bots que tiran automáticamente.

**Tech Stack:** TS + Vitest (motor); React + framer-motion + tema existente (`src/ui/theme.ts`) para la UI.

**Spec:** `docs/superpowers/specs/2026-06-10-battle-royale-design.md` (modelo: bote total acumulado, cae el de menor `insured_value`, último en pie gana todo).

**Contexto para el implementador:**
- El motor del Blotto vive en `src/engine/` (puro, determinista). Calca su estilo: funciones puras que reciben y devuelven estado inmutable, RNG/salt inyectables para tests.
- La UI offline vive en `src/ui/screens/` y `src/ui/components/` (p.ej. `SetupScreen.tsx`, `BattleBoard.tsx`, `ResultScreen.tsx`). Usa `COLORS`/`FONTS` de `src/ui/theme.ts`, `useReducedMotion` de `src/ui/useReducedMotion.ts`, framer-motion. **Léelos antes de escribir UI** y replica idioms (paneles oscuros, Orbitron para números, JetBrains Mono para labels).
- Modos en `src/App.tsx`: `type AppMode = 'offline' | 'onchain'` (en `src/mode/ModeSelect.tsx`). Añadiremos `'royale'`.
- Comandos: `npx vitest run`, `npx tsc --noEmit`, `npm run build` (raíz).
- Esto es un **prototipo con tiradas simuladas**: NO toca `src/engine/` (Blotto), ni backend, ni onchain, ni el Gacha real.

---

### Task 1: Tipos + simulador de tiradas

**Files:**
- Create: `src/royale/types.ts`
- Create: `src/royale/pulls.ts`
- Test: `src/royale/pulls.test.ts`

- [ ] **Step 1: Escribe `src/royale/types.ts`**

```ts
// Tipos del prototipo de Battle Royale (tiradas simuladas, sin blockchain).
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic'

/** Orden de rareza (asc): para desempates, la rareza más baja "pierde". */
export const RARITY_ORDER: Record<Rarity, number> = {
  common: 0, uncommon: 1, rare: 2, epic: 3,
}

export interface RoyaleCard {
  id: string
  name: string
  rarity: Rarity
  valueUsd: number
  grade: number // 1..10
}

export interface PackTier {
  code: string
  name: string
  price: number // USDC
  odds: Record<Rarity, number> // porcentajes, suman ~100
  valueBands: Record<Rarity, [number, number]> // [min, max] USD por rareza
}

export type RoyalePlayerStatus = 'active' | 'eliminated' | 'winner'

export interface RoyalePlayer {
  id: number // índice de asiento 0..N-1
  name: string
  isBot: boolean
  status: RoyalePlayerStatus
  eliminatedRound: number | null // ronda (1-based) en que cayó; null si sigue/gana
  pulls: RoyaleCard[] // sus propias tiradas (para mostrar)
}

export interface RoyaleRound {
  round: number // 1-based
  pulls: { playerId: number; card: RoyaleCard }[]
  eliminatedId: number
}

export interface RoyaleConfig {
  numPlayers: number // 2..10
  tier: PackTier
}

export interface RoyaleState {
  config: RoyaleConfig
  players: RoyalePlayer[]
  pot: RoyaleCard[] // TODAS las cartas tiradas (el ganador se lleva el bote entero)
  round: number // ronda actual, 1-based
  history: RoyaleRound[]
  phase: 'pulling' | 'finished'
  winnerId: number | null
}
```

- [ ] **Step 2: Escribe el test que falla `src/royale/pulls.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { TIERS, simulatePull } from './pulls'
import { RARITY_ORDER } from './types'

// RNG determinista: secuencia fija de valores en [0,1).
function seqRng(values: number[]): () => number {
  let i = 0
  return () => values[i++ % values.length]
}

describe('TIERS', () => {
  it('cada tier tiene odds que suman ~100 y bandas de valor válidas', () => {
    for (const t of TIERS) {
      const sum = Object.values(t.odds).reduce((a, b) => a + b, 0)
      expect(sum).toBeGreaterThanOrEqual(99)
      expect(sum).toBeLessThanOrEqual(101)
      for (const band of Object.values(t.valueBands)) {
        expect(band[0]).toBeLessThanOrEqual(band[1])
      }
    }
  })
})

describe('simulatePull', () => {
  it('rng bajo (0.0) cae en la rareza más común y respeta su banda de valor', () => {
    const tier = TIERS[0]
    const card = simulatePull(tier, seqRng([0.0, 0.0]), () => 'id1')
    // 0.0 cae en el primer tramo de odds = la rareza con mayor probabilidad (common)
    expect(card.rarity).toBe('common')
    const [min, max] = tier.valueBands.common
    expect(card.valueUsd).toBeGreaterThanOrEqual(min)
    expect(card.valueUsd).toBeLessThanOrEqual(max)
    expect(card.grade).toBeGreaterThanOrEqual(1)
    expect(card.grade).toBeLessThanOrEqual(10)
  })

  it('rng alto (0.999) cae en la rareza menos probable (epic)', () => {
    const tier = TIERS[0]
    const card = simulatePull(tier, seqRng([0.999, 0.5]), () => 'id2')
    expect(card.rarity).toBe('epic')
    expect(RARITY_ORDER[card.rarity]).toBe(3)
  })
})
```

- [ ] **Step 3:** `npx vitest run src/royale/pulls.test.ts` → FALLA (módulo no existe).

- [ ] **Step 4: Implementa `src/royale/pulls.ts`**

```ts
// Simulador de tiradas del Gacha (valores ilustrativos; en producción vendría de CC).
import type { PackTier, Rarity, RoyaleCard } from './types'

const RARITY_SEQUENCE: Rarity[] = ['common', 'uncommon', 'rare', 'epic']

export const TIERS: PackTier[] = [
  {
    code: 'pokemon_50', name: 'Pokémon · 50 USDC', price: 50,
    odds: { common: 60, uncommon: 30, rare: 9, epic: 1 },
    valueBands: { common: [5, 30], uncommon: [30, 150], rare: [150, 1000], epic: [1000, 10000] },
  },
  {
    code: 'pokemon_250', name: 'Pokémon · 250 USDC', price: 250,
    odds: { common: 45, uncommon: 35, rare: 17, epic: 3 },
    valueBands: { common: [30, 120], uncommon: [120, 600], rare: [600, 3000], epic: [3000, 40000] },
  },
]

const CARD_NAMES = ['Charizard', 'Blastoise', 'Venusaur', 'Pikachu', 'Mewtwo', 'Gengar',
  'Snorlax', 'Dragonite', 'Gyarados', 'Alakazam', 'Machamp', 'Lugia']

/** Elige rareza según odds: recorre la secuencia acumulando probabilidad. */
function pickRarity(tier: PackTier, r: number): Rarity {
  const roll = r * 100
  let acc = 0
  for (const rarity of RARITY_SEQUENCE) {
    acc += tier.odds[rarity]
    if (roll < acc) return rarity
  }
  return 'epic'
}

export function simulatePull(
  tier: PackTier,
  rng: () => number,
  idGen: () => string,
): RoyaleCard {
  const rarity = pickRarity(tier, rng())
  const [min, max] = tier.valueBands[rarity]
  const valueUsd = Math.round(min + rng() * (max - min))
  const grade = 6 + Math.floor(rng() * 5) // 6..10
  const name = CARD_NAMES[Math.floor(rng() * CARD_NAMES.length)]
  return { id: idGen(), name, rarity, valueUsd, grade }
}
```

- [ ] **Step 5:** `npx vitest run src/royale/pulls.test.ts && npx tsc --noEmit` → verde.

- [ ] **Step 6: Commit**

```bash
git add src/royale/types.ts src/royale/pulls.ts src/royale/pulls.test.ts
git commit -m "feat(royale): tipos y simulador de tiradas del prototipo Battle Royale"
```

---

### Task 2: Motor del Battle Royale

**Files:**
- Create: `src/royale/engine.ts`
- Test: `src/royale/engine.test.ts`

- [ ] **Step 1: Escribe el test que falla `src/royale/engine.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { createRoyale, playRound, lowestPlayerId } from './engine'
import { TIERS } from './pulls'
import type { RoyaleCard, RoyaleState } from './types'

function card(id: string, rarity: RoyaleCard['rarity'], valueUsd: number, grade = 8): RoyaleCard {
  return { id, name: id, rarity, valueUsd, grade }
}

describe('createRoyale', () => {
  it('crea N jugadores activos, bote vacío, ronda 1', () => {
    const s = createRoyale({ numPlayers: 4, tier: TIERS[0] }, ['Tú'])
    expect(s.players).toHaveLength(4)
    expect(s.players[0].name).toBe('Tú')
    expect(s.players[0].isBot).toBe(false)
    expect(s.players.slice(1).every((p) => p.isBot)).toBe(true)
    expect(s.players.every((p) => p.status === 'active')).toBe(true)
    expect(s.pot).toEqual([])
    expect(s.round).toBe(1)
    expect(s.phase).toBe('pulling')
  })

  it('rechaza numPlayers fuera de 2..10', () => {
    expect(() => createRoyale({ numPlayers: 1, tier: TIERS[0] })).toThrow()
    expect(() => createRoyale({ numPlayers: 11, tier: TIERS[0] })).toThrow()
  })
})

describe('lowestPlayerId — desempates deterministas', () => {
  it('elige el de menor valor', () => {
    const pulls = [
      { playerId: 0, card: card('a', 'rare', 500) },
      { playerId: 1, card: card('b', 'common', 50) },
      { playerId: 2, card: card('c', 'uncommon', 200) },
    ]
    expect(lowestPlayerId(pulls)).toBe(1)
  })

  it('empate de valor → rareza más baja cae', () => {
    const pulls = [
      { playerId: 0, card: card('a', 'rare', 100) },
      { playerId: 1, card: card('b', 'common', 100) },
    ]
    expect(lowestPlayerId(pulls)).toBe(1)
  })

  it('empate de valor y rareza → grade más bajo cae', () => {
    const pulls = [
      { playerId: 0, card: card('a', 'common', 100, 9) },
      { playerId: 1, card: card('b', 'common', 100, 6) },
    ]
    expect(lowestPlayerId(pulls)).toBe(1)
  })

  it('empate total → cae el índice de asiento más alto', () => {
    const pulls = [
      { playerId: 0, card: card('a', 'common', 100, 8) },
      { playerId: 3, card: card('b', 'common', 100, 8) },
    ]
    expect(lowestPlayerId(pulls)).toBe(3)
  })
})

describe('playRound', () => {
  // RNG fijo para tiradas reproducibles.
  function rng() { return 0.5 }

  it('cada ronda elimina exactamente uno y acumula TODAS las cartas en el bote', () => {
    let s: RoyaleState = createRoyale({ numPlayers: 4, tier: TIERS[0] })
    s = playRound(s, rng)
    expect(s.players.filter((p) => p.status === 'eliminated')).toHaveLength(1)
    expect(s.pot).toHaveLength(4) // 4 tiradas, todas al bote
    expect(s.history).toHaveLength(1)
    expect(s.history[0].round).toBe(1)
  })

  it('continúa hasta que queda uno; ese es el ganador y el bote son todas las cartas', () => {
    let s: RoyaleState = createRoyale({ numPlayers: 3, tier: TIERS[0] })
    s = playRound(s, rng) // 3 -> 2
    s = playRound(s, rng) // 2 -> 1
    expect(s.phase).toBe('finished')
    expect(s.winnerId).not.toBeNull()
    expect(s.players.find((p) => p.id === s.winnerId)!.status).toBe('winner')
    // total tiradas = 3 + 2 = 5
    expect(s.pot).toHaveLength(5)
  })

  it('no avanza si ya está finished', () => {
    let s: RoyaleState = createRoyale({ numPlayers: 2, tier: TIERS[0] })
    s = playRound(s, rng) // 2 -> 1 finished
    const before = s
    s = playRound(s, rng)
    expect(s).toBe(before) // no-op
  })
})
```

- [ ] **Step 2:** `npx vitest run src/royale/engine.test.ts` → FALLA.

- [ ] **Step 3: Implementa `src/royale/engine.ts`**

```ts
// Motor puro del Battle Royale (determinista con RNG inyectable).
import { RARITY_ORDER, type RoyaleCard, type RoyaleConfig, type RoyalePlayer, type RoyaleState } from './types'
import { simulatePull } from './pulls'

const BOT_NAMES = ['Bot Ruby', 'Bot Onyx', 'Bot Jade', 'Bot Azur', 'Bot Vega',
  'Bot Iris', 'Bot Cobalt', 'Bot Lyra', 'Bot Nova']

export function createRoyale(
  config: RoyaleConfig,
  playerNames: string[] = ['Tú'],
): RoyaleState {
  if (config.numPlayers < 2 || config.numPlayers > 10) {
    throw new Error('numPlayers debe estar entre 2 y 10')
  }
  const players: RoyalePlayer[] = Array.from({ length: config.numPlayers }, (_, i) => ({
    id: i,
    name: playerNames[i] ?? BOT_NAMES[(i - playerNames.length) % BOT_NAMES.length] ?? `Bot ${i}`,
    isBot: i >= playerNames.length,
    status: 'active',
    eliminatedRound: null,
    pulls: [],
  }))
  return { config, players, pot: [], round: 1, history: [], phase: 'pulling', winnerId: null }
}

/** Devuelve el id del jugador a eliminar: menor valor → menor rareza → menor grade → mayor asiento. */
export function lowestPlayerId(pulls: { playerId: number; card: RoyaleCard }[]): number {
  let worst = pulls[0]
  for (const p of pulls.slice(1)) {
    if (isWorse(p, worst)) worst = p
  }
  return worst.playerId
}

function isWorse(a: { playerId: number; card: RoyaleCard }, b: { playerId: number; card: RoyaleCard }): boolean {
  if (a.card.valueUsd !== b.card.valueUsd) return a.card.valueUsd < b.card.valueUsd
  const ra = RARITY_ORDER[a.card.rarity], rb = RARITY_ORDER[b.card.rarity]
  if (ra !== rb) return ra < rb
  if (a.card.grade !== b.card.grade) return a.card.grade < b.card.grade
  return a.playerId > b.playerId // mayor asiento cae en empate total
}

let _seq = 0
function defaultIdGen(): string { return `pull-${_seq++}` }

export function playRound(
  state: RoyaleState,
  rng: () => number = Math.random,
  idGen: () => string = defaultIdGen,
): RoyaleState {
  if (state.phase === 'finished') return state

  const active = state.players.filter((p) => p.status === 'active')
  const pulls = active.map((p) => ({ playerId: p.id, card: simulatePull(state.config.tier, rng, idGen) }))
  const eliminatedId = lowestPlayerId(pulls)

  // Todas las cartas al bote; cada jugador registra su tirada.
  const pot = [...state.pot, ...pulls.map((x) => x.card)]
  const pullByPlayer = new Map(pulls.map((x) => [x.playerId, x.card]))

  let players = state.players.map((p): RoyalePlayer => {
    const pulled = pullByPlayer.get(p.id)
    if (!pulled) return p
    const withPull = { ...p, pulls: [...p.pulls, pulled] }
    if (p.id === eliminatedId) return { ...withPull, status: 'eliminated', eliminatedRound: state.round }
    return withPull
  })

  const remaining = players.filter((p) => p.status === 'active')
  let phase: RoyaleState['phase'] = 'pulling'
  let winnerId: number | null = null
  if (remaining.length === 1) {
    winnerId = remaining[0].id
    players = players.map((p) => (p.id === winnerId ? { ...p, status: 'winner' } : p))
    phase = 'finished'
  }

  return {
    ...state,
    players,
    pot,
    round: phase === 'finished' ? state.round : state.round + 1,
    history: [...state.history, { round: state.round, pulls, eliminatedId }],
    phase,
    winnerId,
  }
}
```

- [ ] **Step 4:** `npx vitest run src/royale/engine.test.ts && npx tsc --noEmit` → verde.

- [ ] **Step 5: Commit**

```bash
git add src/royale/engine.ts src/royale/engine.test.ts
git commit -m "feat(royale): motor del Battle Royale (rondas, eliminación, bote total, ganador)"
```

---

### Task 3: UI — pantallas del prototipo

**Files:**
- Create: `src/ui/screens/royale/RoyaleSetupScreen.tsx`
- Create: `src/ui/screens/royale/RoyaleBoard.tsx`
- Create: `src/ui/screens/royale/RoyaleResultScreen.tsx`

**Antes de empezar:** lee `src/ui/screens/SetupScreen.tsx`, `src/ui/components/BattleBoard.tsx`, `src/ui/screens/ResultScreen.tsx`, `src/ui/theme.ts`, `src/ui/useReducedMotion.ts`. Replica su estética (paneles `COLORS.panel`/`COLORS.border`, acentos `COLORS.green`/`COLORS.red`, Orbitron para números, JetBrains Mono para labels, animaciones suaves con `useReducedMotion`).

- [ ] **Step 1: `RoyaleSetupScreen.tsx`** — selector de **nº de jugadores (2-10)** y **tier de pack** (de `TIERS`, mostrando precio y odds). Botón "Empezar".
  Props:
  ```ts
  interface Props { onStart: (config: RoyaleConfig) => void; onBack: () => void }
  ```
  Importa `TIERS` de `../../../royale/pulls` y `RoyaleConfig` de `../../../royale/types`. Un control +/- o slider para numPlayers (clamp 2..10) y una lista de tiers seleccionables. Estilo como `SetupScreen`.

- [ ] **Step 2: `RoyaleBoard.tsx`** — el tablero de N jugadores y la mecánica por ronda.
  Props:
  ```ts
  interface Props {
    state: RoyaleState
    onPlayRound: () => void      // dispara playRound en el padre
    onFinish: () => void         // ir a resultado
    reducedMotion: boolean
  }
  ```
  Render:
  - Cabecera: "RONDA {state.round}" + nº de supervivientes + **bote** (nº de cartas y valor total `sum(pot.valueUsd)`).
  - Rejilla de jugadores (hasta 10): cada uno muestra nombre, estado (activo/eliminado con tachado o atenuado), y su última carta tirada (rareza con color + valor + grade) cuando exista. El jugador 0 ("Tú") resaltado.
  - Color por rareza: `common` muted, `uncommon` verde, `rare` azul `#5ad1ff`, `epic` morado `#c084fc`.
  - Botón principal: si `phase === 'pulling'` → "🎴 Abrir pack (ronda {round})" que llama `onPlayRound`. Tras una ronda, animar brevemente el reveal de las cartas nuevas (`history[last].pulls`) y resaltar en rojo al `eliminatedId`. Respeta `reducedMotion` (sin animación si está activo).
  - Si `phase === 'finished'` → botón "Ver resultado" → `onFinish`.
  - Si "Tú" (id 0) está eliminado pero la partida sigue, permitir "Seguir viendo" (auto/again) o "Ver resultado".
  - El componente NO muta el estado; solo invoca callbacks. La animación puede usar estado local para escalonar el reveal.

- [ ] **Step 3: `RoyaleResultScreen.tsx`** — pantalla final.
  Props:
  ```ts
  interface Props {
    state: RoyaleState
    onPlayAgain: () => void
    onExit: () => void
    reducedMotion: boolean
  }
  ```
  Muestra el ganador (nombre, resaltado si es "Tú"), el **bote ganado** (nº de cartas y valor total), un desglose corto de la partida (rondas jugadas, posición de "Tú" si fue eliminado: `players[0].eliminatedRound`), y botones "Jugar otra" / "Salir".

- [ ] **Step 4:** `npx tsc --noEmit && npm run build` → limpio.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/royale/
git commit -m "feat(royale): pantallas del prototipo (setup, tablero por rondas, resultado)"
```

---

### Task 4: Enganche en App.tsx + ModeSelect + verificación

**Files:**
- Modify: `src/mode/ModeSelect.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: `ModeSelect.tsx`** — añade un tercer modo.
  - Extiende `export type AppMode = 'offline' | 'onchain' | 'royale'`.
  - Añade una tercera tarjeta:
    ```tsx
    {card('royale', 'Battle Royale (demo)',
      'Hasta 10 jugadores abren packs por rondas; cae el de menor valor; el último en pie se lleva el bote. Tiradas simuladas, sin blockchain.',
      '#c084fc', '👑')}
    ```

- [ ] **Step 2: `App.tsx`** — añade el flujo del modo royale.
  - Imports:
    ```ts
    import { createRoyale, playRound } from './royale/engine'
    import type { RoyaleState, RoyaleConfig } from './royale/types'
    import { RoyaleSetupScreen } from './ui/screens/royale/RoyaleSetupScreen'
    import { RoyaleBoard } from './ui/screens/royale/RoyaleBoard'
    import { RoyaleResultScreen } from './ui/screens/royale/RoyaleResultScreen'
    ```
  - Estado:
    ```ts
    type RoyaleScreen = 'setup' | 'board' | 'result'
    const [royaleScreen, setRoyaleScreen] = useState<RoyaleScreen>('setup')
    const [royaleState, setRoyaleState] = useState<RoyaleState | null>(null)
    ```
  - Handlers:
    ```ts
    function startRoyale(config: RoyaleConfig) {
      setRoyaleState(createRoyale(config, ['Tú']))
      setRoyaleScreen('board')
    }
    function royalePlayRound() {
      setRoyaleState((s) => (s ? playRound(s) : s))
    }
    ```
  - Render: cuando `appMode === 'royale'`, renderiza setup/board/result según `royaleScreen`. Setup → `startRoyale`; board → `onPlayRound={royalePlayRound}`, `onFinish={() => setRoyaleScreen('result')}`; result → `onPlayAgain={() => setRoyaleScreen('setup')}`, `onExit={() => { setAppMode(null); setRoyaleScreen('setup'); setRoyaleState(null) }}`. Pasa `reducedMotion={!!reduced}`. Sigue el patrón del bloque `appMode === 'offline'` existente (incluyendo el botón de volver al menú y `MuteButton` si aplica).
  - El selector inicial (`appMode === null`) ya renderiza `ModeSelect`; al elegir 'royale' entra a este flujo.

- [ ] **Step 3: Verificación completa**

Run:
```bash
npx vitest run && npx tsc --noEmit && npm run build
```
Expected: todos los tests verdes (los previos + los nuevos de royale), tsc y build limpios.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx src/mode/ModeSelect.tsx
git commit -m "feat(royale): engancha Battle Royale como tercer modo (demo offline)"
```

---

### Task 5: Verificación final

- [ ] **Step 1:** `npx vitest run && npx tsc --noEmit && npm run build` → todo verde.
- [ ] **Step 2:** `npm run preview` y comprobar manualmente: elegir Battle Royale → setup (8 jugadores, tier 50) → jugar rondas hasta tener ganador → resultado. (El controlador lo verificará o lo dejará indicado para el usuario.)
