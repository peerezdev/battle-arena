# Fase 0 — Prototipo web del Blotto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un prototipo web jugable del juego de batallas tipo Coronel Blotto (commit-reveal, energía, banking, edge de carta toggleable), sin blockchain, para validar que el loop de habilidad es divertido.

**Architecture:** SPA cliente. Un **motor de juego puro** y determinista en `src/engine/` (TypeScript, sin React, desarrollado con TDD) contiene toda la lógica de reglas y será la spec ejecutable del resolver on-chain de Fase 1. El bot (`src/bot/`) y la UI (React, `src/ui/`) consumen el motor. La instrumentación de playtest persiste en localStorage. Sin servidor, sin red.

**Tech Stack:** Vite + React + TypeScript + Tailwind CSS; Vitest para tests; SubtleCrypto/SHA-256 para el hash de commit-reveal.

---

## File Structure

```
BattleArena/
  package.json, tsconfig.json, vite.config.ts, tailwind.config.js, postcss.config.js
  index.html
  src/
    main.tsx                      # bootstrap React
    App.tsx                       # router de pantallas (estado de pantalla)
    engine/
      types.ts                    # Card, Allocation, MatchConfig, MatchState, enums
      solidez.ts                  # grade -> Solidez
      edge.ts                     # computeEdge
      hash.ts                     # hashAllocation (async, SHA-256)
      match.ts                    # createMatch, availableEnergy, commit, reveal, resolveRound, resolveBattle
      index.ts                    # re-exports públicos del motor
    bot/
      bot.ts                      # decide(state, botPlayer, history, difficulty) -> Allocation
    data/
      cards.ts                    # cartas mock
    instrumentation/
      playtest.ts                 # registro + export JSON a localStorage
    ui/
      screens/
        SetupScreen.tsx
        AllocationScreen.tsx
        PassDeviceScreen.tsx
        RevealScreen.tsx
        ResultScreen.tsx
        FeedbackScreen.tsx
      components/
        FrontSlider.tsx
        EnergyHeader.tsx
  tests are colocated as *.test.ts next to engine/bot files
```

Dependencias: `ui → bot → engine`, `ui → engine`, `ui → instrumentation`, `bot → engine`. El motor no importa nada del resto.

**Convención de jugadores:** `Player = 'a' | 'b'`. En vs-bot, el humano es `'a'` y el bot `'b'`.

**Tipo de retorno de resolución de frente:** `FrontWinner = 'a' | 'b' | 'disputed'`.

---

## Task 1: Scaffold del proyecto (Vite + React + TS + Tailwind + Vitest)

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`

- [ ] **Step 1: Scaffold con Vite**

Run:
```bash
npm create vite@latest . -- --template react-ts
```
Si pregunta por directorio no vacío, elegir "Ignore files and continue" (ya hay `docs/`, `.gitignore`, `SPEC_BATTLE_ARENA.md`).

- [ ] **Step 2: Instalar dependencias base + Tailwind + Vitest**

Run:
```bash
npm install
npm install -D tailwindcss@^3 postcss autoprefixer vitest jsdom @testing-library/react @testing-library/jest-dom
npx tailwindcss init -p
```

- [ ] **Step 3: Configurar Tailwind**

Replace `tailwind.config.js` content:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

Replace `src/index.css` content:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Configurar Vitest en `vite.config.ts`**

Replace `vite.config.ts` content:
```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

Add to `package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verificar que el scaffold arranca y testea**

Run:
```bash
npm run build
npm run test -- --passWithNoTests
```
Expected: build OK; vitest reporta "No test files found" sin error (passWithNoTests).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + React + TS + Tailwind + Vitest"
```

---

## Task 2: Tipos del motor

**Files:**
- Create: `src/engine/types.ts`

- [ ] **Step 1: Definir tipos**

Create `src/engine/types.ts`:
```ts
export type Player = 'a' | 'b'
export type GradeCompany = 'PSA' | 'CGC' | 'BGS'
export type FrontKey = 'apertura' | 'choque' | 'remate'
export type FrontWinner = Player | 'disputed'
export type MatchPhase = 'committing' | 'revealing' | 'roundResolved' | 'settled'
export type Mode = 'ranked' | 'challenge'

export interface Card {
  id: string
  name: string
  valueUsd: number
  gradeCompany: GradeCompany
  grade: number // ej. 9 para PSA9
}

export interface MatchConfig {
  roundsToWin: number      // 2
  baseEnergyPerRound: number // 10
  K: number                // 0.5
  maxEdge: number          // 4
  valueRatioCap: number    // 4
  edgeEnabled: boolean
  mode: Mode
}

export interface Allocation {
  apertura: number
  choque: number
  remate: number
}

export interface RoundRecord {
  commitA?: string
  commitB?: string
  revealA?: Allocation
  revealB?: Allocation
  saltA?: string
  saltB?: string
  frontWinners?: Record<FrontKey, FrontWinner>
  roundWinner?: FrontWinner // 'a' | 'b' | 'disputed' (disputed = ronda nula a rejugar)
}

export interface MatchState {
  cardA: Card
  cardB: Card
  config: MatchConfig
  phase: MatchPhase
  round: number            // índice de ronda actual (0-based)
  bankedEnergy: Record<Player, number> // oculto al rival en UI
  edgePerRound: Record<Player, number> // bonus fijo calculado al crear
  roundWins: Record<Player, number>
  rounds: RoundRecord[]
  winner: Player | null
}

export const DEFAULT_CONFIG: MatchConfig = {
  roundsToWin: 2,
  baseEnergyPerRound: 10,
  K: 0.5,
  maxEdge: 4,
  valueRatioCap: 4,
  edgeEnabled: true,
  mode: 'ranked',
}
```

- [ ] **Step 2: Verificar compilación de tipos**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/engine/types.ts
git commit -m "feat(engine): tipos del motor de juego"
```

---

## Task 3: Solidez (grade -> score)

**Files:**
- Create: `src/engine/solidez.ts`, `src/engine/solidez.test.ts`

- [ ] **Step 1: Escribir test que falla**

Create `src/engine/solidez.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { solidez } from './solidez'

describe('solidez', () => {
  it('PSA10 -> 100', () => {
    expect(solidez({ id: '1', name: 'x', valueUsd: 1, gradeCompany: 'PSA', grade: 10 })).toBe(100)
  })
  it('PSA9 -> 90', () => {
    expect(solidez({ id: '1', name: 'x', valueUsd: 1, gradeCompany: 'PSA', grade: 9 })).toBe(90)
  })
  it('PSA7 -> 70', () => {
    expect(solidez({ id: '1', name: 'x', valueUsd: 1, gradeCompany: 'PSA', grade: 7 })).toBe(70)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm run test -- solidez`
Expected: FAIL ("solidez is not a function" / módulo no encontrado).

- [ ] **Step 3: Implementar**

Create `src/engine/solidez.ts`:
```ts
import type { Card } from './types'

// Fase 0: escalón de 10 por punto de nota; CGC/BGS mapean igual por nota.
export function solidez(card: Card): number {
  return card.grade * 10
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm run test -- solidez`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/solidez.ts src/engine/solidez.test.ts
git commit -m "feat(engine): Solidez derivada del grade"
```

---

## Task 4: computeEdge (bonus logarítmico capado)

**Files:**
- Create: `src/engine/edge.ts`, `src/engine/edge.test.ts`

- [ ] **Step 1: Escribir test que falla**

Create `src/engine/edge.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeEdge } from './edge'
import { DEFAULT_CONFIG } from './types'

const cfg = (over = {}) => ({ ...DEFAULT_CONFIG, ...over })

describe('computeEdge', () => {
  it('2k vs 1k -> +1 para el de mayor valor', () => {
    // log2(2)=1, K=0.5 -> 0.5 -> round=1
    expect(computeEdge(2000, 1000, cfg())).toEqual({ high: 1, low: 0 })
  })
  it('100k vs 1k -> +3 (no llega al cap)', () => {
    // log2(100)=6.64, *0.5=3.32 -> round=3
    expect(computeEdge(100000, 1000, cfg())).toEqual({ high: 3, low: 0 })
  })
  it('capa al maxEdge', () => {
    // ratio enorme: 0.5*log2(1e7)=~11.6 -> capado a 4
    expect(computeEdge(10000000, 1, cfg())).toEqual({ high: 4, low: 0 })
  })
  it('valor igual -> 0', () => {
    expect(computeEdge(1000, 1000, cfg())).toEqual({ high: 0, low: 0 })
  })
  it('edgeEnabled=false -> 0', () => {
    expect(computeEdge(100000, 1000, cfg({ edgeEnabled: false }))).toEqual({ high: 0, low: 0 })
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm run test -- edge`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Create `src/engine/edge.ts`:
```ts
import type { MatchConfig } from './types'

/**
 * Bonus de energía por ronda para el de MAYOR valor.
 * Devuelve siempre {high, low}; `low` es 0 (el de menor valor no recibe bonus en Fase 0).
 * Llamar con (valorMayor, valorMenor).
 */
export function computeEdge(
  valueHigh: number,
  valueLow: number,
  config: MatchConfig,
): { high: number; low: number } {
  if (!config.edgeEnabled) return { high: 0, low: 0 }
  if (valueHigh <= valueLow) return { high: 0, low: 0 }
  const raw = config.K * Math.log2(valueHigh / valueLow)
  const bonus = Math.min(config.maxEdge, Math.round(raw))
  return { high: bonus, low: 0 }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm run test -- edge`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/edge.ts src/engine/edge.test.ts
git commit -m "feat(engine): edge logarítmico capado (computeEdge)"
```

---

## Task 5: hashAllocation (commit-reveal)

**Files:**
- Create: `src/engine/hash.ts`, `src/engine/hash.test.ts`

- [ ] **Step 1: Escribir test que falla**

Create `src/engine/hash.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hashAllocation } from './hash'

const alloc = { apertura: 3, choque: 4, remate: 3 }

describe('hashAllocation', () => {
  it('es determinista para misma asignación y salt', async () => {
    const h1 = await hashAllocation(alloc, 'salt123')
    const h2 = await hashAllocation(alloc, 'salt123')
    expect(h1).toBe(h2)
  })
  it('cambia si cambia el salt', async () => {
    const h1 = await hashAllocation(alloc, 'salt123')
    const h2 = await hashAllocation(alloc, 'salt999')
    expect(h1).not.toBe(h2)
  })
  it('cambia si cambia la asignación', async () => {
    const h1 = await hashAllocation(alloc, 'salt123')
    const h2 = await hashAllocation({ apertura: 4, choque: 3, remate: 3 }, 'salt123')
    expect(h1).not.toBe(h2)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm run test -- hash`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Create `src/engine/hash.ts`:
```ts
import type { Allocation } from './types'

// Canónico y estable: orden fijo de campos. Replicable en Rust (mismo string -> SHA-256).
function canonical(allocation: Allocation, salt: string): string {
  return `${allocation.apertura}|${allocation.choque}|${allocation.remate}|${salt}`
}

export async function hashAllocation(allocation: Allocation, salt: string): Promise<string> {
  const data = new TextEncoder().encode(canonical(allocation, salt))
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm run test -- hash`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/hash.ts src/engine/hash.test.ts
git commit -m "feat(engine): hashAllocation SHA-256 para commit-reveal"
```

---

## Task 6: createMatch + availableEnergy

**Files:**
- Create: `src/engine/match.ts`, `src/engine/match.test.ts`

- [ ] **Step 1: Escribir test que falla**

Create `src/engine/match.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { createMatch, availableEnergy } from './match'
import { DEFAULT_CONFIG, type Card } from './types'

const card = (id: string, valueUsd: number, grade: number): Card => ({
  id, name: id, valueUsd, gradeCompany: 'PSA', grade,
})
const cfg = (over = {}) => ({ ...DEFAULT_CONFIG, ...over })

describe('createMatch', () => {
  it('inicializa fase committing, ronda 0, sin wins', () => {
    const s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    expect(s.phase).toBe('committing')
    expect(s.round).toBe(0)
    expect(s.roundWins).toEqual({ a: 0, b: 0 })
    expect(s.winner).toBeNull()
  })

  it('asigna edge al de mayor valor', () => {
    const s = createMatch(card('A', 2000, 9), card('B', 1000, 8), cfg())
    expect(s.edgePerRound).toEqual({ a: 1, b: 0 })
  })

  it('rechaza ratio > cap en ranked', () => {
    expect(() => createMatch(card('A', 5000, 9), card('B', 1000, 8), cfg({ mode: 'ranked' })))
      .toThrow(/ratio/i)
  })

  it('permite ratio alto en challenge', () => {
    const s = createMatch(card('A', 5000, 9), card('B', 1000, 8), cfg({ mode: 'challenge' }))
    expect(s.phase).toBe('committing')
  })

  it('availableEnergy ronda 0 = base + edge', () => {
    const s = createMatch(card('A', 2000, 9), card('B', 1000, 8), cfg())
    expect(availableEnergy(s, 'a')).toBe(11) // 10 + 1 edge
    expect(availableEnergy(s, 'b')).toBe(10)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm run test -- match`
Expected: FAIL.

- [ ] **Step 3: Implementar createMatch + availableEnergy**

Create `src/engine/match.ts`:
```ts
import type { Card, MatchConfig, MatchState, Player } from './types'
import { computeEdge } from './edge'

export function createMatch(cardA: Card, cardB: Card, config: MatchConfig): MatchState {
  const high = cardA.valueUsd >= cardB.valueUsd ? cardA.valueUsd : cardB.valueUsd
  const low = cardA.valueUsd >= cardB.valueUsd ? cardB.valueUsd : cardA.valueUsd
  const ratio = low > 0 ? high / low : Infinity

  if (config.mode === 'ranked' && ratio > config.valueRatioCap) {
    throw new Error(`Matchup rechazado: ratio de valor ${ratio.toFixed(2)} > cap ${config.valueRatioCap}`)
  }

  const edge = computeEdge(high, low, config)
  const aIsHigh = cardA.valueUsd >= cardB.valueUsd
  const edgePerRound = {
    a: aIsHigh ? edge.high : edge.low,
    b: aIsHigh ? edge.low : edge.high,
  }

  return {
    cardA,
    cardB,
    config,
    phase: 'committing',
    round: 0,
    bankedEnergy: { a: 0, b: 0 },
    edgePerRound,
    roundWins: { a: 0, b: 0 },
    rounds: [{}],
    winner: null,
  }
}

export function availableEnergy(state: MatchState, player: Player): number {
  return state.bankedEnergy[player] + state.config.baseEnergyPerRound + state.edgePerRound[player]
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm run test -- match`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/match.ts src/engine/match.test.ts
git commit -m "feat(engine): createMatch + availableEnergy con edge y cap de ratio"
```

---

## Task 7: commit + reveal (validación de hash y de energía)

**Files:**
- Modify: `src/engine/match.ts`
- Modify: `src/engine/match.test.ts`

- [ ] **Step 1: Añadir tests que fallan**

Append to `src/engine/match.test.ts`:
```ts
import { commit, reveal } from './match'
import { hashAllocation } from './hash'

describe('commit + reveal', () => {
  it('avanza a revealing cuando ambos commitean', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    s = commit(s, 'a', 'hashA')
    expect(s.phase).toBe('committing')
    s = commit(s, 'b', 'hashB')
    expect(s.phase).toBe('revealing')
  })

  it('reveal válido guarda la asignación', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: 4, choque: 3, remate: 3 }
    const allocB = { apertura: 3, choque: 4, remate: 3 }
    const hA = await hashAllocation(allocA, 'sA')
    const hB = await hashAllocation(allocB, 'sB')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', hB)
    s = await reveal(s, 'a', allocA, 'sA')
    s = await reveal(s, 'b', allocB, 'sB')
    expect(s.rounds[0].revealA).toEqual(allocA)
    expect(s.rounds[0].revealB).toEqual(allocB)
  })

  it('rechaza reveal cuyo hash no casa', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: 4, choque: 3, remate: 3 }
    const hA = await hashAllocation(allocA, 'sA')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', 'hB')
    await expect(reveal(s, 'a', { apertura: 5, choque: 3, remate: 2 }, 'sA'))
      .rejects.toThrow(/hash/i)
  })

  it('rechaza asignación que excede el disponible', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: 5, choque: 5, remate: 5 } // 15 > 10
    const hA = await hashAllocation(allocA, 'sA')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', 'hB')
    await expect(reveal(s, 'a', allocA, 'sA')).rejects.toThrow(/disponible/i)
  })

  it('rechaza asignación con valores negativos', async () => {
    let s = createMatch(card('A', 1000, 9), card('B', 1000, 8), cfg())
    const allocA = { apertura: -1, choque: 5, remate: 2 }
    const hA = await hashAllocation(allocA, 'sA')
    s = commit(s, 'a', hA)
    s = commit(s, 'b', 'hB')
    await expect(reveal(s, 'a', allocA, 'sA')).rejects.toThrow(/negativ|inválid/i)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm run test -- match`
Expected: FAIL (commit/reveal no exportados).

- [ ] **Step 3: Implementar commit + reveal**

Append to `src/engine/match.ts` (los `import` van arriba del fichero, junto a los existentes):
```ts
import type { Allocation } from './types'
import { hashAllocation } from './hash'

function allocTotal(a: Allocation): number {
  return a.apertura + a.choque + a.remate
}

export function commit(state: MatchState, player: Player, hash: string): MatchState {
  if (state.phase !== 'committing') throw new Error('No se puede commitear fuera de la fase committing')
  const round = { ...state.rounds[state.round] }
  if (player === 'a') round.commitA = hash
  else round.commitB = hash
  const rounds = [...state.rounds]
  rounds[state.round] = round
  const bothCommitted = !!round.commitA && !!round.commitB
  return { ...state, rounds, phase: bothCommitted ? 'revealing' : 'committing' }
}

export async function reveal(
  state: MatchState,
  player: Player,
  allocation: Allocation,
  salt: string,
): Promise<MatchState> {
  if (state.phase !== 'revealing') throw new Error('No se puede revelar fuera de la fase revealing')
  if (allocation.apertura < 0 || allocation.choque < 0 || allocation.remate < 0)
    throw new Error('Asignación inválida: valores negativos')
  if (allocTotal(allocation) > availableEnergy(state, player))
    throw new Error('Asignación excede el disponible')
  // (availableEnergy ya está definido en este mismo fichero)

  const expected = player === 'a' ? state.rounds[state.round].commitA : state.rounds[state.round].commitB
  const actual = await hashAllocation(allocation, salt)
  if (actual !== expected) throw new Error('El hash del reveal no casa con el commit')

  const round = { ...state.rounds[state.round] }
  if (player === 'a') { round.revealA = allocation; round.saltA = salt }
  else { round.revealB = allocation; round.saltB = salt }
  const rounds = [...state.rounds]
  rounds[state.round] = round
  return { ...state, rounds }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm run test -- match`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/engine/match.ts src/engine/match.test.ts
git commit -m "feat(engine): commit y reveal con validación de hash y energía"
```

---

## Task 8: resolveRound (frentes + Aguante + desempates + banking)

**Files:**
- Modify: `src/engine/match.ts`
- Modify: `src/engine/match.test.ts`

- [ ] **Step 1: Añadir tests que fallan**

Append to `src/engine/match.test.ts`:
```ts
import { resolveRound } from './match'
import { solidez } from './solidez'

// helper: monta un estado en fase revealing con asignaciones ya puestas
async function staged(
  ca: Card, cb: Card, allocA: Allocation, allocB: Allocation, over = {},
) {
  let s = createMatch(ca, cb, cfg(over))
  const hA = await hashAllocation(allocA, 'sA')
  const hB = await hashAllocation(allocB, 'sB')
  s = commit(s, 'a', hA); s = commit(s, 'b', hB)
  s = await reveal(s, 'a', allocA, 'sA')
  s = await reveal(s, 'b', allocB, 'sB')
  return s
}

describe('resolveRound', () => {
  it('gana el frente quien pone estrictamente más', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 5, choque: 2, remate: 3 },
      { apertura: 3, choque: 4, remate: 3 }, // remate empate
    )
    s = resolveRound(s)
    expect(s.rounds[0].frontWinners!.apertura).toBe('a')
    expect(s.rounds[0].frontWinners!.choque).toBe('b')
  })

  it('empate de frente con Solidez mayor -> Aguante', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 7), // A más Solidez
      { apertura: 3, choque: 3, remate: 4 },
      { apertura: 3, choque: 5, remate: 2 }, // apertura empate (3-3)
    )
    s = resolveRound(s)
    expect(s.rounds[0].frontWinners!.apertura).toBe('a') // Aguante a A
  })

  it('empate de frente con Solidez igual -> disputed', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 3, choque: 3, remate: 4 },
      { apertura: 3, choque: 5, remate: 2 }, // apertura empate
    )
    s = resolveRound(s)
    expect(s.rounds[0].frontWinners!.apertura).toBe('disputed')
  })

  it('gana ronda quien gana más frentes y suma roundWin', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 5, choque: 5, remate: 0 }, // gana 2 frentes
      { apertura: 3, choque: 3, remate: 4 },
    )
    s = resolveRound(s)
    expect(s.rounds[0].roundWinner).toBe('a')
    expect(s.roundWins.a).toBe(1)
  })

  it('banca el sobrante para la siguiente ronda', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 3, choque: 2, remate: 2 }, // gasta 7, banca 3
      { apertura: 4, choque: 4, remate: 2 }, // gasta 10
    )
    s = resolveRound(s)
    expect(s.bankedEnergy.a).toBe(3)
    expect(s.bankedEnergy.b).toBe(0)
  })

  it('desempate de ronda por energía total comprometida', async () => {
    // 1 frente cada uno + 1 disputed -> empate de frentes -> gana quien comprometió más
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 6, choque: 1, remate: 1 }, // gana apertura, total 8
      { apertura: 1, choque: 6, remate: 1 }, // gana choque, remate disputed, total 8
    )
    // empata energía 8-8 y frentes 1-1 -> remate 1-1 disputed; desempate energía empata -> Solidez igual -> ronda nula
    s = resolveRound(s)
    expect(s.rounds[0].roundWinner).toBe('disputed')
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm run test -- match`
Expected: FAIL (resolveRound no exportado).

- [ ] **Step 3: Implementar resolveRound**

Append to `src/engine/match.ts`:
```ts
import type { FrontKey, FrontWinner } from './types'
import { solidez } from './solidez'

const FRONTS: FrontKey[] = ['apertura', 'choque', 'remate']

function resolveFront(
  aVal: number, bVal: number, solA: number, solB: number,
): FrontWinner {
  if (aVal > bVal) return 'a'
  if (bVal > aVal) return 'b'
  // empate -> Aguante por Solidez
  if (solA > solB) return 'a'
  if (solB > solA) return 'b'
  return 'disputed'
}

export function resolveRound(state: MatchState): MatchState {
  if (state.phase !== 'revealing') throw new Error('La ronda no está lista para resolverse')
  const r = state.rounds[state.round]
  if (!r.revealA || !r.revealB) throw new Error('Faltan reveals para resolver')

  const solA = solidez(state.cardA)
  const solB = solidez(state.cardB)

  const frontWinners = {} as Record<FrontKey, FrontWinner>
  let aFronts = 0, bFronts = 0
  for (const f of FRONTS) {
    const w = resolveFront(r.revealA[f], r.revealB[f], solA, solB)
    frontWinners[f] = w
    if (w === 'a') aFronts++
    else if (w === 'b') bFronts++
  }

  const totalA = r.revealA.apertura + r.revealA.choque + r.revealA.remate
  const totalB = r.revealB.apertura + r.revealB.choque + r.revealB.remate

  let roundWinner: FrontWinner
  if (aFronts > bFronts) roundWinner = 'a'
  else if (bFronts > aFronts) roundWinner = 'b'
  else if (totalA > totalB) roundWinner = 'a'      // desempate 1: energía total
  else if (totalB > totalA) roundWinner = 'b'
  else if (solA > solB) roundWinner = 'a'          // desempate 2: Solidez
  else if (solB > solA) roundWinner = 'b'
  else roundWinner = 'disputed'                    // ronda nula

  // banking: el sobrante (disponible - gastado) se banca para la siguiente ronda
  const bankedEnergy = {
    a: availableEnergy(state, 'a') - totalA,
    b: availableEnergy(state, 'b') - totalB,
  }

  const roundWins = { ...state.roundWins }
  if (roundWinner === 'a') roundWins.a++
  else if (roundWinner === 'b') roundWins.b++

  const rounds = [...state.rounds]
  rounds[state.round] = { ...r, frontWinners, roundWinner }

  return { ...state, rounds, roundWins, bankedEnergy, phase: 'roundResolved' }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm run test -- match`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/engine/match.ts src/engine/match.test.ts
git commit -m "feat(engine): resolveRound con Aguante, desempates y banking"
```

---

## Task 9: resolveBattle + avance de ronda (nextRound)

**Files:**
- Modify: `src/engine/match.ts`
- Modify: `src/engine/match.test.ts`

- [ ] **Step 1: Añadir tests que fallan**

Append to `src/engine/match.test.ts`:
```ts
import { resolveBattle, nextRound } from './match'

describe('resolveBattle + nextRound', () => {
  it('declara ganador al llegar a roundsToWin', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 5, choque: 5, remate: 0 },
      { apertura: 3, choque: 3, remate: 4 },
    )
    s = resolveRound(s)        // A gana ronda 1 (1-0)
    s = resolveBattle(s)
    expect(s.winner).toBeNull() // aún 1-0
    s = nextRound(s)
    expect(s.round).toBe(1)
    expect(s.phase).toBe('committing')

    // ronda 2: A gana otra vez
    const allocA = { apertura: 6, choque: 6, remate: 0 }
    const allocB = { apertura: 3, choque: 3, remate: 4 }
    const hA = await hashAllocation(allocA, 'sA2')
    const hB = await hashAllocation(allocB, 'sB2')
    s = commit(s, 'a', hA); s = commit(s, 'b', hB)
    s = await reveal(s, 'a', allocA, 'sA2')
    s = await reveal(s, 'b', allocB, 'sB2')
    s = resolveRound(s)        // A 2-0
    s = resolveBattle(s)
    expect(s.winner).toBe('a')
    expect(s.phase).toBe('settled')
  })

  it('una ronda nula no avanza el marcador y rejuega', async () => {
    let s = await staged(
      card('A', 1000, 9), card('B', 1000, 9),
      { apertura: 6, choque: 1, remate: 1 },
      { apertura: 1, choque: 6, remate: 1 },
    )
    s = resolveRound(s)        // disputed
    expect(s.roundWins).toEqual({ a: 0, b: 0 })
    s = resolveBattle(s)
    expect(s.winner).toBeNull()
    s = nextRound(s)
    expect(s.phase).toBe('committing')
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm run test -- match`
Expected: FAIL.

- [ ] **Step 3: Implementar resolveBattle + nextRound**

Append to `src/engine/match.ts`:
```ts
export function resolveBattle(state: MatchState): MatchState {
  if (state.roundWins.a >= state.config.roundsToWin) return { ...state, winner: 'a', phase: 'settled' }
  if (state.roundWins.b >= state.config.roundsToWin) return { ...state, winner: 'b', phase: 'settled' }
  return state
}

export function nextRound(state: MatchState): MatchState {
  if (state.phase === 'settled') throw new Error('La batalla ya terminó')
  const rounds = [...state.rounds, {}]
  return { ...state, round: state.round + 1, rounds, phase: 'committing' }
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm run test -- match`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/match.ts src/engine/match.test.ts
git commit -m "feat(engine): resolveBattle y nextRound (bo3 + ronda nula)"
```

---

## Task 10: Barrel export del motor + test de integración (batalla §2.6)

**Files:**
- Create: `src/engine/index.ts`, `src/engine/integration.test.ts`

- [ ] **Step 1: Crear barrel export**

Create `src/engine/index.ts`:
```ts
export * from './types'
export { solidez } from './solidez'
export { computeEdge } from './edge'
export { hashAllocation } from './hash'
export { createMatch, availableEnergy, commit, reveal, resolveRound, resolveBattle, nextRound } from './match'
```

- [ ] **Step 2: Escribir test de integración que falla**

Create `src/engine/integration.test.ts`. Reproduce el espíritu del ejemplo §2.6 (cartas ~$1.200 PSA8 vs ~$950 PSA7, ranked, edge≈0): la carta barata gana por economía/banking. Verifica el flujo completo de una batalla a 3 rondas:
```ts
import { describe, it, expect } from 'vitest'
import {
  createMatch, commit, reveal, resolveRound, resolveBattle, nextRound,
  hashAllocation, DEFAULT_CONFIG, type Card, type Allocation, type MatchState,
} from './index'

const cara: Card = { id: 'cara', name: 'Cara', valueUsd: 1200, gradeCompany: 'PSA', grade: 8 }
const barata: Card = { id: 'barata', name: 'Barata', valueUsd: 950, gradeCompany: 'PSA', grade: 7 }

async function playRound(s: MatchState, aA: Allocation, aB: Allocation): Promise<MatchState> {
  const hA = await hashAllocation(aA, 'sA' + s.round)
  const hB = await hashAllocation(aB, 'sB' + s.round)
  s = commit(s, 'a', hA); s = commit(s, 'b', hB)
  s = await reveal(s, 'a', aA, 'sA' + s.round)
  s = await reveal(s, 'b', aB, 'sB' + s.round)
  s = resolveRound(s)
  s = resolveBattle(s)
  return s
}

describe('integración: batalla ejemplo del SPEC §2.6', () => {
  it('ratio 1200/950 < cap, edge ~0', () => {
    const s = createMatch(cara, barata, { ...DEFAULT_CONFIG })
    expect(s.edgePerRound).toEqual({ a: 0, b: 0 }) // log2(1.26)*0.5 -> round 0
  })

  it('la barata gana la batalla por economía a lo largo de 3 rondas', async () => {
    let s = createMatch(cara, barata, { ...DEFAULT_CONFIG })
    // R1: cara 3/4/3 (gasta 10); barata 4/0/3 (gasta 7, banca 3). Apertura barata, Choque cara, Remate empate->Aguante cara (PSA8>PSA7). Ronda cara 2-1.
    s = await playRound(s, { apertura: 3, choque: 4, remate: 3 }, { apertura: 4, choque: 0, remate: 3 })
    expect(s.roundWins).toEqual({ a: 1, b: 0 })
    expect(s.bankedEnergy.b).toBe(3)
    s = nextRound(s)
    // R2: cara dispone 10, barata dispone 13 (10+3). cara 4/3/3; barata 5/0/5 (gasta 10, banca 3). Apertura y Remate barata. Ronda barata.
    s = await playRound(s, { apertura: 4, choque: 3, remate: 3 }, { apertura: 5, choque: 0, remate: 5 })
    expect(s.roundWins).toEqual({ a: 1, b: 1 })
    s = nextRound(s)
    // R3: cara dispone 10 -> 1/4/5; barata dispone 13 -> 5/5/3 (gasta 13). Apertura y Choque barata. Batalla barata.
    s = await playRound(s, { apertura: 1, choque: 4, remate: 5 }, { apertura: 5, choque: 5, remate: 3 })
    expect(s.winner).toBe('b')
  })
})
```

- [ ] **Step 3: Verificar que falla, luego ajustar números si hace falta**

Run: `npm run test -- integration`
Expected inicialmente: puede FALLAR si algún cálculo de banking/energía no cuadra con los números del ejemplo. Si falla, **no cambies el motor**: ajusta las asignaciones del test para que sean coherentes con las reglas implementadas (el objetivo es demostrar que un underdog gana por banking, no clonar cifra a cifra el SPEC). Documenta en un comentario cualquier desviación respecto al §2.6.

- [ ] **Step 4: Verificar que pasa**

Run: `npm run test`
Expected: PASS (toda la suite del motor).

- [ ] **Step 5: Commit**

```bash
git add src/engine/index.ts src/engine/integration.test.ts
git commit -m "test(engine): integración batalla §2.6 + barrel export"
```

---

## Task 11: Cartas mock

**Files:**
- Create: `src/data/cards.ts`

- [ ] **Step 1: Crear el dataset**

Create `src/data/cards.ts`:
```ts
import type { Card } from '../engine'

// Cartas mock para Fase 0. Valores y grades representativos de distintos tiers.
export const MOCK_CARDS: Card[] = [
  { id: 'c1', name: 'Charizard Base', valueUsd: 1200, gradeCompany: 'PSA', grade: 8 },
  { id: 'c2', name: 'Blastoise Base', valueUsd: 950, gradeCompany: 'PSA', grade: 7 },
  { id: 'c3', name: 'Pikachu Illustrator', valueUsd: 100000, gradeCompany: 'PSA', grade: 9 },
  { id: 'c4', name: 'Common Holo', valueUsd: 400, gradeCompany: 'CGC', grade: 9 },
  { id: 'c5', name: 'Venusaur Base', valueUsd: 2000, gradeCompany: 'BGS', grade: 9 },
  { id: 'c6', name: 'Mewtwo Promo', valueUsd: 1000, gradeCompany: 'PSA', grade: 10 },
]
```

- [ ] **Step 2: Verificar compilación**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/data/cards.ts
git commit -m "feat(data): cartas mock para Fase 0"
```

---

## Task 12: Bot (decide) — siempre válido + heurística

**Files:**
- Create: `src/bot/bot.ts`, `src/bot/bot.test.ts`

- [ ] **Step 1: Escribir tests que fallan**

Create `src/bot/bot.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { decide } from './bot'
import { createMatch, availableEnergy, DEFAULT_CONFIG, type Card } from '../engine'

const card = (id: string, v: number, g: number): Card => ({ id, name: id, valueUsd: v, gradeCompany: 'PSA', grade: g })

describe('bot.decide', () => {
  const s = createMatch(card('A', 1000, 9), card('B', 1000, 9), { ...DEFAULT_CONFIG })

  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    it(`(${difficulty}) produce asignación válida: enteros >=0 y suma <= disponible`, () => {
      for (let i = 0; i < 50; i++) {
        const a = decide(s, 'b', [], difficulty)
        const total = a.apertura + a.choque + a.remate
        expect(Number.isInteger(a.apertura)).toBe(true)
        expect(Number.isInteger(a.choque)).toBe(true)
        expect(Number.isInteger(a.remate)).toBe(true)
        expect(a.apertura).toBeGreaterThanOrEqual(0)
        expect(a.choque).toBeGreaterThanOrEqual(0)
        expect(a.remate).toBeGreaterThanOrEqual(0)
        expect(total).toBeLessThanOrEqual(availableEnergy(s, 'b'))
      }
    })
  }
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm run test -- bot`
Expected: FAIL.

- [ ] **Step 3: Implementar el bot**

Create `src/bot/bot.ts`:
```ts
import type { Allocation, MatchState, Player } from '../engine'
import { availableEnergy } from '../engine'

export type Difficulty = 'easy' | 'medium' | 'hard'

function randInt(maxInclusive: number): number {
  return Math.floor(Math.random() * (maxInclusive + 1))
}

// Reparte `budget` en 3 cubos enteros >=0 sumando <= budget.
function splitRandom(budget: number): Allocation {
  const a = randInt(budget)
  const b = randInt(budget - a)
  const c = randInt(budget - a - b)
  return { apertura: a, choque: b, remate: c }
}

// Heurística: concentra para ganar 2 de 3 frentes, deja algo sin gastar (banca).
function splitHeuristic(budget: number, spendRatio: number): Allocation {
  const spend = Math.floor(budget * spendRatio)
  // elige 2 frentes fuertes
  const fronts: (keyof Allocation)[] = ['apertura', 'choque', 'remate']
  const strong = fronts.filter(() => Math.random() < 0.66).slice(0, 2)
  const picks = strong.length >= 2 ? strong : ['apertura', 'remate']
  const half = Math.floor(spend / 2)
  const alloc: Allocation = { apertura: 0, choque: 0, remate: 0 }
  alloc[picks[0]] = half
  alloc[picks[1]] = spend - half
  return alloc
}

export function decide(
  state: MatchState,
  botPlayer: Player,
  _history: Allocation[],
  difficulty: Difficulty = 'medium',
): Allocation {
  const budget = availableEnergy(state, botPlayer)
  if (difficulty === 'easy') return splitRandom(budget)
  if (difficulty === 'medium') return splitHeuristic(budget, 0.85 + Math.random() * 0.15)
  // hard: gasta casi todo y a veces banca fuerte para spike posterior
  const spendRatio = state.round === state.config.roundsToWin - 1 ? 1 : 0.7 + Math.random() * 0.3
  return splitHeuristic(budget, spendRatio)
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm run test -- bot`
Expected: PASS (3 tests × 50 iteraciones).

- [ ] **Step 5: Commit**

```bash
git add src/bot/bot.ts src/bot/bot.test.ts
git commit -m "feat(bot): decide() con dificultades easy/medium/hard, siempre válido"
```

---

## Task 13: Instrumentación de playtest

**Files:**
- Create: `src/instrumentation/playtest.ts`, `src/instrumentation/playtest.test.ts`

- [ ] **Step 1: Escribir tests que fallan**

Create `src/instrumentation/playtest.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { recordMatch, getRecords, exportJson, clearRecords, type PlaytestRecord } from './playtest'

const rec: PlaytestRecord = {
  ts: 1, winner: 'b', rounds: 3, edgeEnabled: true, valueRatio: 1.26,
  mode: 'ranked', difficulty: 'medium', funRating: 4, comment: 'reñido',
}

describe('playtest instrumentation', () => {
  beforeEach(() => clearRecords())

  it('guarda y recupera registros', () => {
    recordMatch(rec)
    expect(getRecords()).toHaveLength(1)
    expect(getRecords()[0].winner).toBe('b')
  })

  it('exporta JSON parseable', () => {
    recordMatch(rec)
    const parsed = JSON.parse(exportJson())
    expect(parsed[0].funRating).toBe(4)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npm run test -- playtest`
Expected: FAIL.

- [ ] **Step 3: Implementar**

Create `src/instrumentation/playtest.ts`:
```ts
import type { Player, Mode } from '../engine'

export interface PlaytestRecord {
  ts: number
  winner: Player | null
  rounds: number
  edgeEnabled: boolean
  valueRatio: number
  mode: Mode
  difficulty: string
  funRating: number   // 1-5
  comment: string
}

const KEY = 'battlearena.playtest.v1'

export function getRecords(): PlaytestRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]')
  } catch {
    return []
  }
}

export function recordMatch(record: PlaytestRecord): void {
  const all = getRecords()
  all.push(record)
  localStorage.setItem(KEY, JSON.stringify(all))
}

export function clearRecords(): void {
  localStorage.removeItem(KEY)
}

export function exportJson(): string {
  return JSON.stringify(getRecords(), null, 2)
}
```

- [ ] **Step 4: Verificar que pasa**

Run: `npm run test -- playtest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/instrumentation/playtest.ts src/instrumentation/playtest.test.ts
git commit -m "feat(instrumentation): registro de playtest en localStorage + export JSON"
```

---

## Task 14: Componentes UI reutilizables (FrontSlider, EnergyHeader)

**Files:**
- Create: `src/ui/components/FrontSlider.tsx`, `src/ui/components/EnergyHeader.tsx`

- [ ] **Step 1: FrontSlider**

Create `src/ui/components/FrontSlider.tsx`:
```tsx
interface Props {
  label: string
  icon: string
  value: number
  max: number
  onChange: (v: number) => void
}

export function FrontSlider({ label, icon, value, max, onChange }: Props) {
  return (
    <div className="mb-4">
      <div className="flex justify-between font-semibold">
        <span>{icon} {label}</span>
        <span>{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
      />
    </div>
  )
}
```

- [ ] **Step 2: EnergyHeader**

Create `src/ui/components/EnergyHeader.tsx`:
```tsx
interface Props {
  available: number
  unassigned: number
  winsA: number
  winsB: number
  round: number
}

export function EnergyHeader({ available, unassigned, winsA, winsB, round }: Props) {
  const box = 'flex-1 text-center bg-slate-100 rounded p-2'
  return (
    <div className="flex gap-3 mb-4">
      <div className={box}><div className="text-xs uppercase opacity-70">Disponible</div><div className="text-2xl font-bold">{available}</div></div>
      <div className={box}><div className="text-xs uppercase opacity-70">Sin asignar</div><div className="text-2xl font-bold">{unassigned}</div></div>
      <div className={box}><div className="text-xs uppercase opacity-70">Rondas</div><div className="text-2xl font-bold">{winsA} – {winsB}</div></div>
    </div>
  )
}
```

- [ ] **Step 3: Verificar compilación**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components
git commit -m "feat(ui): componentes FrontSlider y EnergyHeader"
```

---

## Task 15: Pantallas y orquestación en App.tsx

**Files:**
- Create: `src/ui/screens/SetupScreen.tsx`, `src/ui/screens/AllocationScreen.tsx`, `src/ui/screens/PassDeviceScreen.tsx`, `src/ui/screens/RevealScreen.tsx`, `src/ui/screens/ResultScreen.tsx`, `src/ui/screens/FeedbackScreen.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`

> Esta tarea es de integración UI (no TDD estricto: el motor ya está testeado). El criterio de aceptación es **jugar una batalla completa de principio a fin** vs bot y en hotseat, sin errores en consola.

- [ ] **Step 1: SetupScreen** — formulario que elige modo (`vs-bot`|`hotseat`), carta A, carta B (de `MOCK_CARDS`), `mode` (ranked/challenge), `edgeEnabled` (checkbox), `difficulty`. Botón "Empezar" que llama `onStart(setup)`. Si `createMatch` lanza por ratio, muestra el mensaje de error.

```tsx
import { useState } from 'react'
import { MOCK_CARDS } from '../../data/cards'
import type { Mode } from '../../engine'
import type { Difficulty } from '../../bot/bot'

export interface Setup {
  opponent: 'vs-bot' | 'hotseat'
  cardAId: string
  cardBId: string
  mode: Mode
  edgeEnabled: boolean
  difficulty: Difficulty
}

export function SetupScreen({ onStart, error }: { onStart: (s: Setup) => void; error?: string }) {
  const [s, setS] = useState<Setup>({
    opponent: 'vs-bot', cardAId: MOCK_CARDS[0].id, cardBId: MOCK_CARDS[1].id,
    mode: 'ranked', edgeEnabled: true, difficulty: 'medium',
  })
  const upd = (p: Partial<Setup>) => setS({ ...s, ...p })
  const sel = 'border rounded p-2 w-full mb-3'
  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">🃏 TCG Battle Arena — Fase 0</h1>
      {error && <p className="bg-red-100 text-red-700 p-2 rounded mb-3">{error}</p>}
      <label className="block text-sm font-semibold">Rival</label>
      <select className={sel} value={s.opponent} onChange={(e) => upd({ opponent: e.target.value as Setup['opponent'] })}>
        <option value="vs-bot">vs Bot</option>
        <option value="hotseat">Hotseat (2 jugadores)</option>
      </select>
      <label className="block text-sm font-semibold">Carta A</label>
      <select className={sel} value={s.cardAId} onChange={(e) => upd({ cardAId: e.target.value })}>
        {MOCK_CARDS.map((c) => <option key={c.id} value={c.id}>{c.name} (${c.valueUsd} · {c.gradeCompany}{c.grade})</option>)}
      </select>
      <label className="block text-sm font-semibold">Carta B</label>
      <select className={sel} value={s.cardBId} onChange={(e) => upd({ cardBId: e.target.value })}>
        {MOCK_CARDS.map((c) => <option key={c.id} value={c.id}>{c.name} (${c.valueUsd} · {c.gradeCompany}{c.grade})</option>)}
      </select>
      <label className="block text-sm font-semibold">Modo</label>
      <select className={sel} value={s.mode} onChange={(e) => upd({ mode: e.target.value as Mode })}>
        <option value="ranked">Ranked (cap 4x)</option>
        <option value="challenge">Challenge (sin cap)</option>
      </select>
      <label className="block mb-3"><input type="checkbox" checked={s.edgeEnabled} onChange={(e) => upd({ edgeEnabled: e.target.checked })} /> Edge de carta activado</label>
      {s.opponent === 'vs-bot' && (
        <>
          <label className="block text-sm font-semibold">Dificultad bot</label>
          <select className={sel} value={s.difficulty} onChange={(e) => upd({ difficulty: e.target.value as Difficulty })}>
            <option value="easy">Fácil</option><option value="medium">Medio</option><option value="hard">Difícil</option>
          </select>
        </>
      )}
      <button className="w-full bg-blue-600 text-white rounded p-3 font-semibold" onClick={() => onStart(s)}>Empezar</button>
    </div>
  )
}
```

- [ ] **Step 2: AllocationScreen** — recibe `available`, `playerLabel`, y `onCommit(allocation)`. 3 `FrontSlider` + `EnergyHeader`. Cada slider limita su `max` a lo que queda disponible (`available - sumaDeLosOtros`). Botón Commit deshabilitado si `suma > available` (no debería pasar por el clamp). 

```tsx
import { useState } from 'react'
import { FrontSlider } from '../components/FrontSlider'
import { EnergyHeader } from '../components/EnergyHeader'
import type { Allocation } from '../../engine'

interface Props {
  available: number
  winsA: number
  winsB: number
  round: number
  playerLabel: string
  onCommit: (a: Allocation) => void
}

export function AllocationScreen({ available, winsA, winsB, round, playerLabel, onCommit }: Props) {
  const [a, setA] = useState<Allocation>({ apertura: 0, choque: 0, remate: 0 })
  const total = a.apertura + a.choque + a.remate
  const remaining = available - total
  const maxFor = (k: keyof Allocation) => a[k] + remaining
  return (
    <div className="max-w-md mx-auto p-6">
      <h2 className="text-lg font-bold mb-1">Ronda {round + 1} · {playerLabel}</h2>
      <EnergyHeader available={available} unassigned={remaining} winsA={winsA} winsB={winsB} round={round} />
      <FrontSlider label="Apertura" icon="⚔️" value={a.apertura} max={maxFor('apertura')} onChange={(v) => setA({ ...a, apertura: v })} />
      <FrontSlider label="Choque" icon="💥" value={a.choque} max={maxFor('choque')} onChange={(v) => setA({ ...a, choque: v })} />
      <FrontSlider label="Remate" icon="🎯" value={a.remate} max={maxFor('remate')} onChange={(v) => setA({ ...a, remate: v })} />
      <button className="w-full bg-blue-600 text-white rounded p-3 font-semibold" onClick={() => onCommit(a)}>🔒 Commit</button>
    </div>
  )
}
```

- [ ] **Step 3: PassDeviceScreen** — pantalla intermedia hotseat: "Pasa el dispositivo a {jugador}" + botón "Listo".

```tsx
export function PassDeviceScreen({ nextPlayer, onReady }: { nextPlayer: string; onReady: () => void }) {
  return (
    <div className="max-w-md mx-auto p-6 text-center min-h-[60vh] flex flex-col justify-center">
      <h2 className="text-xl font-bold mb-4">📲 Pasa el dispositivo a {nextPlayer}</h2>
      <p className="opacity-70 mb-6">Que el otro jugador no vea la pantalla anterior.</p>
      <button className="bg-blue-600 text-white rounded p-3 font-semibold" onClick={onReady}>Listo</button>
    </div>
  )
}
```

- [ ] **Step 4: RevealScreen** — recibe ambas asignaciones, `frontWinners`, `roundWinner`, nombres. Muestra ambas asignaciones lado a lado y marca el ganador de cada frente y de la ronda. Botón "Continuar".

```tsx
import type { Allocation, FrontKey, FrontWinner } from '../../engine'

interface Props {
  allocA: Allocation
  allocB: Allocation
  frontWinners: Record<FrontKey, FrontWinner>
  roundWinner: FrontWinner
  nameA: string
  nameB: string
  onContinue: () => void
}

const FRONTS: { key: FrontKey; label: string; icon: string }[] = [
  { key: 'apertura', label: 'Apertura', icon: '⚔️' },
  { key: 'choque', label: 'Choque', icon: '💥' },
  { key: 'remate', label: 'Remate', icon: '🎯' },
]

export function RevealScreen({ allocA, allocB, frontWinners, roundWinner, nameA, nameB, onContinue }: Props) {
  const tag = (w: FrontWinner) => w === 'a' ? `🟢 ${nameA}` : w === 'b' ? `🔴 ${nameB}` : '⚪ Disputado'
  return (
    <div className="max-w-md mx-auto p-6">
      <h2 className="text-lg font-bold mb-4">Reveal</h2>
      {FRONTS.map((f) => (
        <div key={f.key} className="flex justify-between border-b py-2">
          <span>{f.icon} {f.label}</span>
          <span>{allocA[f.key]} vs {allocB[f.key]}</span>
          <span className="font-semibold">{tag(frontWinners[f.key])}</span>
        </div>
      ))}
      <p className="text-center text-xl font-bold my-4">
        {roundWinner === 'disputed' ? 'Ronda nula (rejugar)' : `Gana la ronda: ${tag(roundWinner)}`}
      </p>
      <button className="w-full bg-blue-600 text-white rounded p-3 font-semibold" onClick={onContinue}>Continuar</button>
    </div>
  )
}
```

- [ ] **Step 5: ResultScreen + FeedbackScreen**

Create `src/ui/screens/ResultScreen.tsx`:
```tsx
export function ResultScreen({ winnerLabel, onFeedback }: { winnerLabel: string; onFeedback: () => void }) {
  return (
    <div className="max-w-md mx-auto p-6 text-center min-h-[60vh] flex flex-col justify-center">
      <h1 className="text-3xl font-bold mb-4">🏆 {winnerLabel}</h1>
      <button className="bg-blue-600 text-white rounded p-3 font-semibold" onClick={onFeedback}>Valorar la partida</button>
    </div>
  )
}
```

Create `src/ui/screens/FeedbackScreen.tsx`:
```tsx
import { useState } from 'react'
import { exportJson } from '../../instrumentation/playtest'

export function FeedbackScreen({ onSubmit, onPlayAgain }: { onSubmit: (rating: number, comment: string) => void; onPlayAgain: () => void }) {
  const [rating, setRating] = useState(3)
  const [comment, setComment] = useState('')
  const [done, setDone] = useState(false)
  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'playtest.json'; a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="max-w-md mx-auto p-6 text-center">
      <h2 className="text-xl font-bold mb-4">¿Fue divertida?</h2>
      <div className="flex justify-center gap-2 mb-4">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`w-10 h-10 rounded-full ${rating >= n ? 'bg-yellow-400' : 'bg-slate-200'}`} onClick={() => setRating(n)}>{n}</button>
        ))}
      </div>
      <textarea className="border rounded w-full p-2 mb-3" placeholder="Comentario (opcional)" value={comment} onChange={(e) => setComment(e.target.value)} />
      {!done ? (
        <button className="w-full bg-blue-600 text-white rounded p-3 font-semibold mb-2" onClick={() => { onSubmit(rating, comment); setDone(true) }}>Enviar</button>
      ) : (
        <p className="text-green-700 mb-2">¡Gracias! Registrado.</p>
      )}
      <div className="flex gap-2">
        <button className="flex-1 bg-slate-200 rounded p-2" onClick={download}>Exportar JSON</button>
        <button className="flex-1 bg-slate-200 rounded p-2" onClick={onPlayAgain}>Jugar otra</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: App.tsx — máquina de estados de pantallas**

Replace `src/App.tsx` con el orquestador. Estados de UI: `setup → allocate(A) → [hotseat: pass → allocate(B)] | [bot: auto-commit B] → reveal → (round resolved) → next round o result → feedback`. Mantiene `MatchState` en `useState`, genera salts con `crypto.randomUUID()`, llama al motor (`commit/reveal/resolveRound/resolveBattle/nextRound`) y al `decide` del bot. Tras `resolveBattle`, si `winner` registra `recordMatch`.

```tsx
import { useState } from 'react'
import {
  createMatch, availableEnergy, commit, reveal, resolveRound, resolveBattle, nextRound,
  hashAllocation, DEFAULT_CONFIG, type MatchState, type Allocation, type Player,
} from './engine'
import { decide } from './bot/bot'
import { MOCK_CARDS } from './data/cards'
import { recordMatch } from './instrumentation/playtest'
import { SetupScreen, type Setup } from './ui/screens/SetupScreen'
import { AllocationScreen } from './ui/screens/AllocationScreen'
import { PassDeviceScreen } from './ui/screens/PassDeviceScreen'
import { RevealScreen } from './ui/screens/RevealScreen'
import { ResultScreen } from './ui/screens/ResultScreen'
import { FeedbackScreen } from './ui/screens/FeedbackScreen'

type Screen = 'setup' | 'allocateA' | 'passToB' | 'allocateB' | 'reveal' | 'result' | 'feedback'

export default function App() {
  const [screen, setScreen] = useState<Screen>('setup')
  const [setup, setSetup] = useState<Setup | null>(null)
  const [state, setState] = useState<MatchState | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [allocA, setAllocA] = useState<Allocation | null>(null)

  const nameA = state ? state.cardA.name : 'A'
  const nameB = state ? state.cardB.name : 'B'

  function start(s: Setup) {
    try {
      const cardA = MOCK_CARDS.find((c) => c.id === s.cardAId)!
      const cardB = MOCK_CARDS.find((c) => c.id === s.cardBId)!
      const st = createMatch(cardA, cardB, { ...DEFAULT_CONFIG, mode: s.mode, edgeEnabled: s.edgeEnabled })
      setSetup(s); setState(st); setError(undefined); setScreen('allocateA')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function commitA(a: Allocation) {
    setAllocA(a)
    if (setup!.opponent === 'hotseat') setScreen('passToB')
    else await resolveBoth(a, decide(state!, 'b', [], setup!.difficulty))
  }

  async function commitB(b: Allocation) {
    await resolveBoth(allocA!, b)
  }

  async function resolveBoth(a: Allocation, b: Allocation) {
    let st = state!
    const saltA = crypto.randomUUID(), saltB = crypto.randomUUID()
    st = commit(st, 'a', await hashAllocation(a, saltA))
    st = commit(st, 'b', await hashAllocation(b, saltB))
    st = await reveal(st, 'a', a, saltA)
    st = await reveal(st, 'b', b, saltB)
    st = resolveRound(st)
    st = resolveBattle(st)
    setState(st)
    setScreen('reveal')
  }

  function continueAfterReveal() {
    let st = state!
    if (st.winner) {
      const ratio = Math.max(st.cardA.valueUsd, st.cardB.valueUsd) / Math.min(st.cardA.valueUsd, st.cardB.valueUsd)
      recordMatch({
        ts: Date.now(), winner: st.winner, rounds: st.round + 1,
        edgeEnabled: st.config.edgeEnabled, valueRatio: Number(ratio.toFixed(2)),
        mode: st.config.mode, difficulty: setup!.difficulty, funRating: 0, comment: '',
      })
      setScreen('result')
      return
    }
    st = nextRound(st)
    setState(st); setAllocA(null); setScreen('allocateA')
  }

  if (screen === 'setup' || !state) return <SetupScreen onStart={start} error={error} />

  const cur = state.rounds[state.round]

  if (screen === 'allocateA')
    return <AllocationScreen available={availableEnergy(state, 'a')} winsA={state.roundWins.a} winsB={state.roundWins.b} round={state.round} playerLabel={setup!.opponent === 'hotseat' ? `${nameA} (Jugador A)` : `Tú — ${nameA}`} onCommit={commitA} />

  if (screen === 'passToB')
    return <PassDeviceScreen nextPlayer={`${nameB} (Jugador B)`} onReady={() => setScreen('allocateB')} />

  if (screen === 'allocateB')
    return <AllocationScreen available={availableEnergy(state, 'b')} winsA={state.roundWins.a} winsB={state.roundWins.b} round={state.round} playerLabel={`${nameB} (Jugador B)`} onCommit={commitB} />

  if (screen === 'reveal')
    return <RevealScreen allocA={cur.revealA!} allocB={cur.revealB!} frontWinners={cur.frontWinners!} roundWinner={cur.roundWinner!} nameA={nameA} nameB={nameB} onContinue={continueAfterReveal} />

  if (screen === 'result') {
    const wl = state.winner === 'a' ? `Gana ${nameA}` : `Gana ${nameB}`
    return <ResultScreen winnerLabel={wl} onFeedback={() => setScreen('feedback')} />
  }

  if (screen === 'feedback')
    return <FeedbackScreen
      onSubmit={(rating, comment) => {
        // actualiza el último registro con el rating
        const ratio = Math.max(state.cardA.valueUsd, state.cardB.valueUsd) / Math.min(state.cardA.valueUsd, state.cardB.valueUsd)
        recordMatch({
          ts: Date.now(), winner: state.winner, rounds: state.round + 1,
          edgeEnabled: state.config.edgeEnabled, valueRatio: Number(ratio.toFixed(2)),
          mode: state.config.mode, difficulty: setup!.difficulty, funRating: rating, comment,
        })
      }}
      onPlayAgain={() => { setState(null); setSetup(null); setScreen('setup') }}
    />

  return null
}
```

- [ ] **Step 7: Verificar build + arrancar dev y jugar una partida completa**

Run:
```bash
npx tsc --noEmit
npm run build
npm run dev
```
Expected: compila y build OK. Abrir el navegador (o túnel) y jugar **una batalla completa vs bot** y **una en hotseat** hasta la pantalla de resultado y feedback, sin errores en consola.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): pantallas y orquestación de batalla (setup, asignación, reveal, resultado, feedback)"
```

---

## Task 16: README de Fase 0

**Files:**
- Create: `README.md`

- [ ] **Step 1: Escribir README**

Create `README.md` con: qué es (prototipo Fase 0 del SPEC), cómo arrancar (`npm install`, `npm run dev`, `npm run test`), cómo jugar (vs bot / hotseat, edge toggle), cómo exportar datos de playtest, y nota de que el motor (`src/engine/`) es la spec ejecutable del resolver on-chain de Fase 1.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README de la Fase 0"
```

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** motor (Tasks 2-10), bot (12), UI/pantallas (14-15), instrumentación (13), cartas mock (11), testing con ejemplos del SPEC incl. §2.6 (10), edge toggleable (4, en config y UI), cap de ratio (6), hotseat + vs bot (15). ✔️
- **Placeholders:** ninguno. El código de cada paso es correcto tal cual. Única flexibilidad permitida: el test §2.6 (Task 10) puede ajustar las cifras de asignación a las reglas reales (objetivo: underdog gana por banking), documentándolo en comentario.
- **Consistencia de tipos:** `Player='a'|'b'`, `FrontWinner=Player|'disputed'`, `Allocation{apertura,choque,remate}`, firmas de `commit/reveal/resolveRound/resolveBattle/nextRound/availableEnergy/decide` coherentes entre engine, bot y App. ✔️
