# Fase 0 — Prototipo web del Blotto (TCG Battle Arena)

**Fecha:** 2026-06-06
**Estado:** Diseño aprobado, listo para plan de implementación
**Alcance:** Solo Fase 0 del SPEC_BATTLE_ARENA. Sin blockchain, sin USDC, sin oráculo real, sin backend, sin red.

## Objetivo

Validar que el **loop de habilidad** (asignación de recursos tipo Coronel Blotto + commit-reveal + lectura del rival) es **divertido y retiene**, antes de invertir en Solana/Anchor, auditorías y legal. Es el riesgo nº1 del proyecto (§13) y su mitigación obligatoria (§10 Fase 0).

Validar además la tesis **"el valor de la carta es ventaja, no destino"**: un jugador hábil con carta barata puede ganar a uno con carta cara.

## No-objetivos (fuera de Fase 0)

- Blockchain, escrow USDC, programa Anchor, wallet (Fase 1+).
- Oráculo de pricing real, firma de atestaciones (se usan valores mock).
- Backend, ELO/MMR real, matchmaking online, persistencia en servidor.
- Online multijugador, anti-cheat de red, anti-colusión.
- Token (explícitamente fuera, §4.3).
- Techo de apuesta por tier (eje 1): no aplica sin USDC.

## Decisiones de diseño tomadas

1. **Rival:** Bot (IA simple) + Hotseat (dos humanos, mismo dispositivo, por turnos). Sin red.
2. **Valor de carta:** Blotto puro con **edge de carta toggleable** (`edgeEnabled`). Permite jugar simétrico puro o con bonus logarítmico + Aguante, para aislar de dónde viene la diversión.
3. **Arquitectura (enfoque A):** SPA cliente con **motor de juego puro y aislado** en `src/engine/` (TypeScript, sin React, TDD). UI y bot consumen el motor. El motor es la **spec ejecutable del resolver on-chain** de Fase 1.
4. **Stack:** React + Vite + Tailwind (alineado con Fase 4). Vitest para tests. Sitio estático (fácil de tunelar para playtests móviles).
5. **Parámetros** (defaults del SPEC, todos configurables): `roundsToWin=2`, `baseEnergyPerRound=10`, `K=0.5`, `maxEdge=4`, `valueRatioCap=4`.

## Arquitectura

```
BattleArena/
  src/
    engine/        # motor puro determinista (TDD, sin React) — núcleo
    bot/           # IA: decide(state, history) -> allocation; consume engine
    data/          # cartas mock (valor, grade)
    ui/            # componentes React (setup, batalla, reveal, resultado, feedback)
    instrumentation/  # captura de playtest -> localStorage -> export JSON
  docs/superpowers/specs/
  index.html, vite.config, tailwind config, package.json
```

Flujo de dependencias: `ui → bot → engine`, `ui → engine`, `ui → instrumentation`. El motor no depende de nada del resto.

## Sección 1 — Motor de juego (`src/engine/`)

### Modelo de datos

- **`Card`**: `{ id, name, valueUsd, gradeCompany: 'PSA'|'CGC'|'BGS', grade: number }`.
  - **Poder** = `valueUsd`.
  - **Solidez** = score normalizado del grade. Curva inicial: `PSA10→100, PSA9→90, PSA8→80, PSA7→70, …` (escalón de 10 por punto de nota; CGC/BGS mapean igual por nota en Fase 0). Ajustable.
- **`MatchConfig`**: `{ roundsToWin:2, baseEnergyPerRound:10, K:0.5, maxEdge:4, valueRatioCap:4, edgeEnabled:boolean, mode:'ranked'|'challenge' }`.
- **`Allocation`**: `{ apertura:number, choque:number, remate:number }` (enteros ≥0).
- **`MatchState`**: rondas jugadas, `bankedEnergy` por jugador (oculta al rival), `roundWins` por jugador, fase (`Committing|Revealing|RoundResolved|Settled`), commits/reveals por ronda, `winner|null`.

### Energía

- Cada ronda, ambos suman `+baseEnergyPerRound (10)` a su pool bancado.
- El de **mayor valor** suma además `bonus = min(maxEdge, round(K · log2(Vhigh/Vlow)))` si `edgeEnabled`. Valor igual → 0. Edge desactivado → 0.
- Energía no asignada **se banca** (oculta al rival) y se arrastra a rondas siguientes.
- **Disponible en ronda** = bancado previo + 10 (+ bonus si aplica).

### Asignación

- Reparto entero ≥0 entre `Apertura / Choque / Remate` con `suma ≤ disponible`. El sobrante se banca.
- Validación en commit; reveal debe casar con `hash(allocation ‖ salt)`.

### Resolución de frente (§2.3.1)

- Gana quien asigna **estrictamente más** energía.
- Empate de energía → **Aguante**: gana el de **Solidez estrictamente mayor**. Si Solidez igual → frente **disputado** (de nadie).

### Resolución de ronda (§2.3.2)

- Gana quien gane **más frentes**.
- Desempate 1: **mayor energía total** comprometida esa ronda.
- Desempate 2: **mayor Solidez**.
- Si persiste el empate (frentes, energía y Solidez iguales): **ronda nula** → se rejuega con +10 frescos. Caso borde raro; cap de rejugadas para evitar bucles, tras el cap se marca empate técnico de partida (solo posible con cartas idénticas en Solidez).

### Resolución de batalla (§2.3.3)

- Primero a `roundsToWin (2)` rondas gana. En Fase 0 = victoria (sin USDC ni rake).

### Restricción de valor

- `mode='ranked'`: matchup con `Vhigh/Vlow > valueRatioCap (4)` se **rechaza** en `createMatch`.
- `mode='challenge'`: permitido (giant-killer).

### API pública (funciones puras)

`createMatch(cardA, cardB, config)`, `availableEnergy(state, player)`, `computeEdge(cardHigh, cardLow, config)`, `hashAllocation(allocation, salt)`, `commit(state, player, hash)`, `reveal(state, player, allocation, salt)`, `resolveRound(state)`, `resolveBattle(state)`. Sin estado global oculto; todo entra/sale por parámetros → testeable y portable a Rust.

## Sección 2 — Bot (`src/bot/`)

Función pura `decide(state, botPlayer, history, difficulty) → Allocation`. Consume el motor.

- **Fácil:** reparto aleatorio válido del disponible.
- **Medio (default):** heurística — intenta ganar 2 de 3 frentes, banca ocasionalmente, con ruido para no ser predecible.
- **Difícil:** modela tendencias del rival a partir de `history`, usa estrategia mixta (impredecible) y gestiona banking para hacer "spike" en una ronda.

Garantía testeable: el bot **siempre** produce una asignación válida (`suma ≤ disponible`, enteros ≥0).

## Sección 3 — UI (`src/ui/`, React)

Pantallas:

1. **Setup:** elegir modo (vs Bot / Hotseat), elegir cartas mock (lista con valor y grade), Ranked/Challenge, toggle `edgeEnabled`, dificultad de bot.
2. **Batalla / asignación:** sliders por frente (Apertura/Choque/Remate) + indicadores Disponible / Sin asignar (se banca) / Marcador de rondas + botón Commit. En **hotseat**: A asigna → pantalla "pasa el dispositivo" → B asigna. Vs **bot**: el bot commitea oculto.
3. **Reveal:** animación de reveal simultáneo (se voltean ambas asignaciones), resolución frente a frente (mostrando desempate Aguante), ganador de la ronda.
4. **Resumen de ronda** → siguiente ronda (arrastra bancado oculto).
5. **Resultado de batalla.**
6. **Feedback de playtest:** ¿divertido? 1-5 + comentario libre.

Layout de batalla validado con mockup (sliders por frente + cabecera Disponible/Bancado/Marcador).

## Sección 4 — Instrumentación (`src/instrumentation/`)

Por partida se registra: ganador, nº de rondas, asignaciones de cada ronda, `edgeEnabled`, ratio de valor, modo, dificultad, y rating de diversión (1-5) + comentario. Persistencia en `localStorage`; botón de **export a JSON** para analizar los playtests.

## Sección 5 — Estrategia de test

- **TDD (Vitest) sobre el motor**, exhaustivo:
  - `computeEdge`: ejemplos del SPEC — `2k vs 1k → +1`; `100k vs 1k → log2≈6.6 → round=3` (≤cap 4); ratio que daría >4 se capa a 4; valor igual → 0; `edgeEnabled=false` → 0.
  - Resolución de frente: mayor gana; empate con Solidez mayor → Aguante; empate con Solidez igual → disputado.
  - Resolución de ronda: más frentes; cadena de desempates (energía total, Solidez); ronda nula → rejuega.
  - Banking: sobrante se arrastra y queda oculto; disponible correcto por ronda.
  - Batalla: primero a 2 rondas; secuencias 2-0 y 2-1.
  - Cap de valor: `ranked` rechaza ratio >4; `challenge` lo permite.
  - Commit-reveal: hash correcto valida; reveal que no casa con el commit se rechaza; reveal con `suma > disponible` se rechaza.
  - **Integración:** la batalla ejemplo del §2.6 reproduce el resultado descrito (gana la barata por economía/lectura).
- **Bot:** property test — para estados arbitrarios, la salida es siempre una asignación válida.
- **UI:** smoke tests ligeros de componentes (no es el foco de Fase 0).

## Criterios de éxito de Fase 0

- El loop es jugable de principio a fin (vs bot y hotseat) sin errores.
- El motor pasa todos los tests, incluida la batalla ejemplo del SPEC.
- Playtests con personas reales: rating de diversión y observación de si "valor = ventaja, no destino" se siente justo (underdog puede ganar; whale no domina trivialmente).
- Datos exportables para iterar balance (`K`, `maxEdge`, energía base, banking).

## Riesgos / notas

- Hotseat en un solo móvil es algo incómodo: mitigado con pantalla de traspaso "pasa el dispositivo".
- El edge logarítmico y el banking pueden necesitar tuning tras playtests; por eso todo es configurable y se instrumenta.
- El motor se diseña pensando en su port a Rust/Anchor (determinismo, funciones puras, sin floats en la resolución salvo el cálculo de edge que se redondea a entero).
