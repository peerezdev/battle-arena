# Router + App Shell — Diseño

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Alcance:** Introducir React Router (navegación con URL + botón atrás), un shell
de juego compartido (cohesión visual + "volver" siempre presente), y descomponer
`App.tsx` (429 líneas con todo el estado de flujos inline) en contenedores de
flujo. No cambia la lógica de juego (motor) ni el backend; es navegación +
estructura + chrome.

## Problema

- No hay router: la navegación es un state machine en `App.tsx`. Desde algunos
  modos (p.ej. Mana Duel) **no hay forma de volver atrás**; el botón atrás del
  navegador no hace nada.
- Las pantallas de juego son páginas sueltas **sin el "marco" del hub** (top bar,
  fondo, estilo), así que no se sienten parte de la misma app.

## Decisiones (cerradas con el usuario)

1. **React Router** (`react-router-dom`): cada pantalla con URL, back del
   navegador funciona, enlaces compartibles.
2. **Shell completo en el hub / top bar mínima en juego**: el Hub conserva su
   shell propio (rail + top bar); los juegos van bajo un `GameLayout` con una
   **top bar fina** (← Lobby + logo + balance) y **fondo compartido**, sin rail,
   para no robar espacio al tablero.

## Rutas

| Ruta | Pantalla | Layout |
|---|---|---|
| `/` | Landing | sin shell (su propia nav) |
| `/app` | Hub | self-contained (rail + top bar propios) |
| `/play/mana` | Mana Duel (flujo offline) | `GameLayout` |
| `/play/royale` | Battle Royale (demo) | `GameLayout` |
| `/play/arena` | Flujo on-chain (connect→collection→lobby→battle) | `GameLayout` + `AppKitProvider` (lazy) |

- Ruta desconocida → redirige a `/`.
- Los **pasos internos** de cada flujo (setup→allocate→reveal→result; o
  connect→…→battle) siguen siendo **estado interno del contenedor**, no sub-rutas.
  El "volver" que pedía el usuario es volver al lobby (`/app`), que da el
  `GameLayout` + el back del navegador.

## Componentes

```
src/App.tsx                      (reescribir — BrowserRouter + Routes; ~60 líneas)
src/ui/layouts/GameLayout.tsx    (nuevo — top bar fina + backdrop + <Outlet/>)
src/ui/flows/ManaDuelFlow.tsx    (nuevo — state machine offline, extraído de App)
src/ui/flows/RoyaleFlow.tsx      (nuevo — estado royale, extraído de App)
src/ui/flows/OnchainFlow.tsx     (nuevo — estado onchain + AppKitProvider, extraído)
```

- **`GameLayout`**: flex-column de `100dvh` → top bar fina (botón "← Lobby" que
  hace `navigate('/app')`, logo BattleArena, balance pill de **ejemplo**) + un
  `ArenaBackdrop`/fondo compartido + `<Outlet/>` que ocupa `flex:1`. Respeta
  `useReducedMotion`. El balance es presentacional (mismo criterio que el Hub).
- **Contenedores de flujo**: cada uno posee el estado que hoy vive en `App.tsx`
  (offline: `setup/state/allocA/offlineScreen/showVsIntro`; royale:
  `royaleState/royaleScreen`; onchain: `onchainScreen/authToken/selectedCard/
  currentBattle`) y renderiza sus pantallas internas. Reciben lo que necesiten;
  para "salir al lobby" usan `useNavigate()('/app')`.
- **`OnchainFlow`** envuelve su contenido en `AppKitProvider` (carga lazy, igual
  que ahora) — así el bundle de wallet solo entra en `/play/arena`.

## Navegación

- **Landing**: "Launch App" y las tarjetas → `useNavigate()('/app')` (la prop
  `onLaunch` se sustituye por navegación interna, o se mantiene y App la cablea a
  navigate).
- **Hub**: el `LeftRail`/tiles/QuickMatch dejan de recibir callbacks `onPlayMana`
  etc. y usan `useNavigate()`: mana→`/play/mana`, royale→`/play/royale`,
  pack/gacha/create/find→`/play/arena`; lobby/ranks → quedarse (estado interno).
- **GameLayout**: "← Lobby" → `/app`. Back del navegador: de un juego vuelve a
  `/app` (de donde se entró).
- Los "salir/volver al menú" internos de los flujos → `/app`.

## Ajuste de altura del tablero

Los tableros a pantalla completa (`BattleBoard` usa `height:'100dvh'`) pasan a
vivir bajo la top bar fina. `GameLayout` es flex-column; el contenido (`<Outlet/>`)
es `flex:1; min-height:0; overflow:hidden`. Se ajusta `BattleBoard` (y el board de
Royale) para ocupar `height:'100%'` del contenedor en vez de `100dvh`, evitando
scroll/overflow bajo la top bar.

## Consistencia de estilo

El shell compartido (top bar fina + fondo) es lo que más unifica. Las pantallas
ya usan los tokens (`theme.ts`) tras el rediseño; en esta pasada solo se retoca
donde algún panel/espaciado se desvíe del lenguaje del hub (sin rehacer pantallas).

## Verificación

- `tsc` + `vitest` (102 tests de motor, intactos) + `build` verdes.
- Visual por preview: `/` Landing → Launch App → `/app` Hub → cada modo abre su
  ruta con la top bar fina + ← Lobby; el **back del navegador** vuelve al hub;
  recargar una URL de juego carga esa pantalla; rutas desconocidas → `/`.

## No-goals (YAGNI)

- Sub-rutas para cada paso interno de un flujo (no hace falta para el "volver").
- Rutas para Ranks/Friends u otras secciones aún no construidas (placeholder).
- Persistir estado de juego en la URL/recarga (recargar un juego a medias lo
  reinicia — aceptable; el estado vive en memoria del contenedor).
- Tocar el motor o el backend.

## Riesgos

- **Refactor amplio de `App.tsx`** → mitigado moviendo el estado tal cual a
  contenedores (mecánico) y verificando build a cada paso.
- **`react-router-dom` nueva dependencia** → estándar, bajo riesgo.
- **Altura del board bajo la top bar** → el cambio de `100dvh` a `100%` debe
  probarse en móvil y escritorio (la verificación visual lo cubre).
- **AppKitProvider** debe quedar SOLO en la rama `/play/arena` (no global), para
  no cargar el bundle de wallet en práctica/landing.
