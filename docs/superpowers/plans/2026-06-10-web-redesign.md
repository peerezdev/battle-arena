# Rediseño web (Dirección Crypto Platform) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Aplicar la dirección visual "Crypto Platform" (paleta Solana violeta→verde, Sora/JetBrains Mono/Inter, sombras suaves) a toda la web, añadir una landing nueva como entrada, y traducir toda la UI a inglés.

**Architecture:** Centralizar tokens en `src/ui/theme.ts` + `src/index.css` (propaga el restyle a casi todas las pantallas), luego construir la landing y pulir/traducir pantalla por pantalla. El motor (`src/engine`, `src/royale`) NO se toca — solo capa visual y texto.

**Tech Stack:** React + TS + framer-motion + Tailwind (tokens vía objetos JS `COLORS`/`FONTS` y CSS vars en `index.css`).

**Spec:** `docs/superpowers/specs/2026-06-10-web-redesign-design.md`. Mockups de referencia (gitignored): `.superpowers/brainstorm/13875-1781607395/content/{landing-en,game-board-c}.html`.

**Verificación (no hay tests de snapshot visual):** cada tarea debe dejar `npx tsc --noEmit`, `npm run build` y `npx vitest run` (102 tests, todos de motor) en verde. La verificación visual es manual vía `npm run preview`.

**Mapping de jugador clave:** tú = verde `#14F195`, rival = violeta `#9945FF`. El rojo `#ff5c72` queda SOLO para peligro/derrota/eliminación. En `BattleBoard.tsx` hay usos de `COLORS.red` para el rival (revelado/ganador) Y para el timer urgente: los **del rival pasan a violeta**, los **de urgencia se quedan en rojo**.

---

### Task 1: Tokens de diseño + fuentes (fundación del restyle global)

**Files:**
- Modify: `src/ui/theme.ts`
- Modify: `src/index.css`
- Modify (migración mecánica): los 11 archivos que usan `FONTS.orbitron` → `FONTS.display`

- [ ] **Step 1: Reescribe `src/ui/theme.ts`**

```ts
// Shared "Crypto Platform" design tokens — UI only, no engine logic.
export const COLORS = {
  bg: '#0b0e14',
  panel: '#161b24',
  panel2: '#1b212c',   // superficies elevadas
  border: '#ffffff14', // blanco 8%
  muted: '#9aa3b2',
  text: '#e9edf5',
  green: '#14F195',    // jugador A / "tú"
  violet: '#9945FF',   // jugador B / rival
  red: '#ff5c72',      // SOLO peligro / derrota / eliminación
} as const

/** Gradiente de marca (Solana). */
export const GRADIENT = 'linear-gradient(90deg,#9945FF,#14F195)'

export const SHADOW = {
  panel: '0 8px 24px #00000055',
  glow: (accent: string) => `0 0 16px ${accent}33`,
} as const

export const player = {
  a: {
    color: COLORS.green,
    glow: '0 0 8px #14F19566',
    glowLg: '0 0 16px #14F19533',
    gradient: 'linear-gradient(90deg,#0f2a1e,#0b0e14)',
    borderColor: '#14F19555',
    label: '🟢',
    sliderClass: 'slider-green',
  },
  b: {
    color: COLORS.violet,
    glow: '0 0 8px #9945FF66',
    glowLg: '0 0 16px #9945FF33',
    gradient: 'linear-gradient(90deg,#1a1430,#0b0e14)',
    borderColor: '#9945FF55',
    label: '🟣',
    sliderClass: 'slider-violet',
  },
} as const

/** Colores por rareza (Gacha / Pack Battle / Royale). */
export const RARITY = {
  common: COLORS.muted,
  uncommon: COLORS.green,
  rare: '#5ad1ff',
  epic: '#f0b54a', // oro — evita chocar con el violeta del rival
} as const

/** Format USD value: ≥1000 → "$1.2k", else "$380" */
export function formatUsd(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}k`
  return `$${v}`
}

export const FONTS = {
  display: "'Sora', system-ui, sans-serif", // titulares y números grandes (sustituye a Orbitron)
  mono: "'JetBrains Mono', 'Courier New', monospace",
  body: "'Inter', system-ui, sans-serif",
} as const
```

- [ ] **Step 2: Actualiza `src/index.css`** (líneas 1–17 y el slider rojo + orb default)

Reemplaza la línea 1 (el `@import`):
```css
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@500;700;800&family=Inter:wght@400;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
```
Cambia `body` background/color a los nuevos tokens:
```css
body {
  background-color: #0b0e14;
  color: #e9edf5;
  font-family: 'Inter', system-ui, sans-serif;
  min-height: 100dvh;
}
```
Reemplaza el bloque `:root`:
```css
:root {
  --font-display: 'Sora', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', 'Courier New', monospace;
}
```
En `@keyframes orb-pulse`, cambia los `#34e29b` por `#14F195` (color del orbe verde nuevo).
Busca la clase del slider del rival `.slider-red` y renómbrala a `.slider-violet`, cambiando su color de `#ff5c72` a `#9945FF` (mantén `.slider-green` pero actualiza su verde a `#14F195` si usa el antiguo `#34e29b`).

- [ ] **Step 3: Migra `FONTS.orbitron` → `FONTS.display`** en los 11 archivos:
`src/mode/ModeSelect.tsx`, `src/ui/components/BattleBoard.tsx`, `src/ui/components/CardSlab.tsx`, `src/ui/components/EnergyAllocator.tsx`, `src/ui/components/VsIntro.tsx`, `src/ui/screens/ResultScreen.tsx`, `src/ui/screens/SetupScreen.tsx`, `src/ui/screens/onchain/GachaScreen.tsx`, `src/ui/screens/royale/RoyaleBoard.tsx`, `src/ui/screens/royale/RoyaleResultScreen.tsx`, `src/ui/screens/royale/RoyaleSetupScreen.tsx`.

Comando para hacerlo de una (revísalo después):
```bash
grep -rl "FONTS.orbitron" src --include="*.tsx" --include="*.ts" | xargs sed -i '' 's/FONTS\.orbitron/FONTS.display/g'
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc limpio, 102 tests verdes, build OK. (No debe quedar ninguna referencia a `FONTS.orbitron`: `grep -rn "FONTS.orbitron" src` → vacío.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/theme.ts src/index.css src/
git commit -m "feat(ui): tokens y fuentes de la dirección Crypto Platform (verde/violeta, Sora)"
```

---

### Task 2: Landing nueva + routing de entrada

**Files:**
- Create: `src/ui/screens/Landing.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Crea `src/ui/screens/Landing.tsx`**

Port en React del mockup `.superpowers/brainstorm/13875-1781607395/content/landing-en.html`, usando los tokens de `theme.ts` (`COLORS`, `GRADIENT`, `FONTS`). En inglés, responsive (1 columna en móvil vía un `useIsWide`/matchMedia o CSS). Props:
```ts
interface Props {
  onPlayOffline: () => void  // Mana Duel demo
  onPlayRoyale: () => void   // Battle Royale demo
  onConnect: () => void      // flujo on-chain (Gacha / Pack Battle / wallet)
}
```
Estructura (igual que el mockup): nav (logo + "Connect wallet"→`onConnect`); hero (badge "Built on Solana", titular *"Graded cards, made playable."* con gradiente, subtítulo, CTAs **"Play demo"**→`onPlayOffline` y **"Connect wallet"**→`onConnect`, chips *Non-custodial · No seed phrase · Deposit from any chain*, visual de duelo verde-vs-violeta); sección Games (4 tarjetas en orden **Pack Battle, Battle Royale, Gacha, Mana Duel**; cada tarjeta clicable lanza su flujo: Pack Battle→`onConnect`, Battle Royale→`onPlayRoyale`, Gacha→`onConnect`, Mana Duel→`onPlayOffline`); trust band (Trustless settlement · Anti-manipulation · Provably fair). Respeta `useReducedMotion`.

- [ ] **Step 2: Conecta en `src/App.tsx`**

- Import: `import { Landing } from './ui/screens/Landing'`.
- En el bloque `if (appMode === null)` (≈línea 299), sustituye el render de `<ModeSelect .../>` por:
```tsx
return (
  <Landing
    onPlayOffline={() => setAppMode('offline')}
    onPlayRoyale={() => setAppMode('royale')}
    onConnect={() => setAppMode('onchain')}
  />
)
```
(Mantén el `import { type AppMode } from './mode/ModeSelect'` para el tipo; `ModeSelect` deja de renderizarse — queda como código muerto aceptable, no lo borres para no tocar el export del tipo.)

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: todo verde.

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/Landing.tsx src/App.tsx
git commit -m "feat(ui): landing nueva como pantalla de entrada (dirección Crypto Platform, EN)"
```

---

### Task 3: Restyle + traducción — Mana Duel

**Files:**
- Modify: `src/ui/components/BattleBoard.tsx`, `src/ui/components/EnergyAllocator.tsx`, `src/ui/components/CardSlab.tsx`, `src/ui/components/VsIntro.tsx`, `src/ui/screens/SetupScreen.tsx`, `src/ui/screens/ResultScreen.tsx`

**Antes:** lee `game-board-c.html` como referencia visual.

- [ ] **Step 1: Rival rojo → violeta en `BattleBoard.tsx`.** Sustituye los usos de `COLORS.red` que representan al **rival/jugador B** (revelado, ganador 'b', borde/box-shadow/color del valor del rival — alrededor de líneas 459, 561, 563, 569, 579, 1203) por `COLORS.violet`. **NO** cambies los usos de urgencia del timer (líneas ≈1074, 1128, 1154, 1164) — esos se quedan en `COLORS.red` (peligro). Tras el cambio, verifica que el rival se ve violeta y el timer urgente rojo.

- [ ] **Step 2: Sombras suaves.** Donde haya glows neón duros del estilo `0 0 Npx <color>88/aa`, suavízalos a la línea del mockup (sombra de panel `SHADOW.panel` para contenedores; glow sutil `SHADOW.glow(accent)` solo para ganador/activo). No es find/replace mecánico: ajusta a ojo siguiendo `game-board-c.html`.

- [ ] **Step 3: Traduce a inglés** todas las cadenas visibles de estos 6 archivos. Frentes: **Opening / Clash / Finisher** (apertura/choque/remate). Ejemplos: "Ronda"→"Round", "Gana la ronda"→"Round winner", "Tu"/"Tú"→"You", "Rival"→"Opponent", "Continuar"→"Continue", "reserva oculta"→"hidden reserve", "ventaja"→"edge", "Asignar maná"→"Allocate mana", etc. Revisa cada archivo y no dejes español.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: todo verde. (`grep -rniE "ronda|gana|rival|asign|reserva|ventaja" src/ui/components/BattleBoard.tsx src/ui/screens/SetupScreen.tsx src/ui/screens/ResultScreen.tsx` → sin cadenas en español visibles.)

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/BattleBoard.tsx src/ui/components/EnergyAllocator.tsx src/ui/components/CardSlab.tsx src/ui/components/VsIntro.tsx src/ui/screens/SetupScreen.tsx src/ui/screens/ResultScreen.tsx
git commit -m "feat(ui): Mana Duel — rival violeta, sombras suaves y textos en inglés"
```

---

### Task 4: Restyle + traducción — Gacha y Battle Royale

**Files:**
- Modify: `src/ui/screens/onchain/GachaScreen.tsx`
- Modify: `src/ui/screens/royale/RoyaleSetupScreen.tsx`, `src/ui/screens/royale/RoyaleBoard.tsx`, `src/ui/screens/royale/RoyaleResultScreen.tsx`

- [ ] **Step 1: Colores de rareza** → usa la tabla `RARITY` de `theme.ts` en ambos (Gacha y Royale): common muted, uncommon verde, rare `#5ad1ff`, epic oro `#f0b54a`. Sustituye cualquier mapa de rareza local (p.ej. el `#c084fc` morado anterior) por `RARITY`.

- [ ] **Step 2: Battle Royale — rojo para eliminados.** En `RoyaleBoard.tsx`/`RoyaleResultScreen.tsx`, los jugadores eliminados usan `COLORS.red` (atenuado/borde) como señal de peligro/eliminación; "tú" en verde. Aplica sombras suaves de los tokens.

- [ ] **Step 3: Traduce a inglés** todas las cadenas visibles de los 4 archivos. Ejemplos Royale: "RONDA"→"ROUND", "Abrir pack"→"Open pack", "supervivientes"→"survivors", "bote"→"pot", "Ver resultado"→"See result", "Jugar otra"→"Play again", "Salir"→"Exit", "Estás eliminado"→"You're out", "Caíste en la ronda N"→"Out in round N", "Empezar"→"Start", "jugadores"→"players". Gacha: "Abrir pack", "Crear desafío con esta carta"→"Create a challenge with this card", "Vender de vuelta (buyback)"→"Sell back (buyback)", "El Gacha no está disponible"→"Gacha is unavailable", "Cargando máquinas"→"Loading machines", etc.

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: todo verde.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/onchain/GachaScreen.tsx src/ui/screens/royale/
git commit -m "feat(ui): Gacha y Battle Royale — rareza/eliminación con tokens nuevos y textos en inglés"
```

---

### Task 5: Restyle + traducción — pantallas on-chain y Mode Select

**Files:**
- Modify: `src/ui/screens/onchain/ConnectScreen.tsx`, `CollectionScreen.tsx`, `LobbyScreen.tsx`, `OnchainBattleScreen.tsx`
- Modify: `src/mode/ModeSelect.tsx` (aunque ya no se renderiza, déjalo coherente con los tokens por si se reusa; mínimo)

- [ ] **Step 1:** Estas pantallas ya usan `COLORS`/`FONTS`, así que el restyle global de la Task 1 ya las cubre en su mayoría. Revisa cada una y: (a) sustituye cualquier `COLORS.red` que represente al **rival/jugador B** por `COLORS.violet` (en `OnchainBattleScreen`/`LobbyScreen` que usan `player.b`, ya viene por token — verifica); (b) suaviza glows duros a sombras; (c) usa el botón gradiente para la acción principal donde encaje.

- [ ] **Step 2: Traduce a inglés** todas las cadenas visibles de estas pantallas (Connect/Collection/Lobby/OnchainBattle). Ej.: "Conectar wallet"→"Connect wallet", "Tu colección"→"Your collection", "Crear desafío"→"Create challenge", "Unirse"→"Join", "Diferencia de nivel"→"Level gap", "Esperando rival"→"Waiting for opponent", etc.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: todo verde.

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/onchain/ src/mode/ModeSelect.tsx
git commit -m "feat(ui): pantallas on-chain — tokens nuevos y textos en inglés"
```

---

### Task 6: Verificación final + barrido de español

- [ ] **Step 1: Barrido de español residual en UI** (excluye comentarios de código y specs):
```bash
grep -rniE "\b(ronda|jugador|rival|partida|abrir|ganar|gana|perder|reserva|ventaja|conectar|colección|esperando|empezar|salir|cartas|bote)\b" src --include="*.tsx" | grep -v "//" | head -40
```
Revisa los resultados y traduce lo que sea cadena visible (ignora identificadores/variables y comentarios). Repite hasta que solo queden identificadores/comentarios.

- [ ] **Step 2: Suite completa**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc limpio, 102 tests verdes, build OK.

- [ ] **Step 3: Verificación visual manual** (`npm run preview`): landing → "Play demo" → Mana Duel (rival violeta, números Sora, inglés); Battle Royale (eliminados en rojo, inglés); que no quede Orbitron ni verde/rojo viejo ni texto en español. Dejar anotado para que el usuario lo revise en el preview.

- [ ] **Step 4: Commit (si quedaron correcciones del barrido)**

```bash
git add src/
git commit -m "chore(ui): barrido final de traducción a inglés"
```
