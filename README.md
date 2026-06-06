# TCG Battle Arena — Fase 0 (prototipo del Blotto)

Prototipo web jugable del juego de batallas de cartas tipo **Coronel Blotto** descrito en el SPEC. Esta es la **Fase 0**: validar que el loop de habilidad (asignación de recursos en secreto + commit-reveal + lectura del rival) es **divertido y retiene**, antes de construir nada on-chain.

**Sin blockchain, sin USDC, sin oráculo real, sin backend.** Cartas con valores mock; rival = bot o segundo humano en hotseat.

## Cómo arrancar

```bash
npm install
npm run dev      # arranca el prototipo en http://localhost:5173
npm run test     # corre la suite (motor, bot, instrumentación) — 46 tests
npm run build    # build de producción
```

## Cómo jugar

1. **Setup:** elige rival (vs Bot / Hotseat), dos cartas, modo (Ranked con cap de valor 4x / Challenge sin cap), si el *edge de carta* está activo, y la dificultad del bot.
2. **Asignación:** reparte tu energía disponible entre 3 frentes — **Apertura, Choque, Remate** — en secreto, y commitea. Lo que no gastas se **banca** (oculto al rival) y se arrastra a la siguiente ronda.
3. **Reveal:** se revelan ambas asignaciones a la vez y se resuelve frente a frente. Empate de frente → lo gana la carta de mayor **Solidez** (pasivo *Aguante*).
4. **Ronda:** la gana quien gane más frentes (desempates: energía total comprometida → Solidez). **Al mejor de 3.**
5. En **hotseat**, una pantalla intermedia "pasa el dispositivo" evita que el otro jugador vea tu reparto.

### El valor de la carta (toggle `edge`)
Con el edge activado, la carta de mayor valor recibe un pequeño bonus de energía por ronda, **logarítmico y capado** (`bonus = min(4, round(0.5·log2(V_alto/V_bajo)))`). 100x de valor ≈ +3 de energía, no 100x de fuerza: **valor = ventaja, no destino**. Desactívalo para jugar Blotto simétrico puro.

## Datos de playtest

Cada partida terminada registra (en `localStorage`): ganador, nº de rondas, si el edge estaba activo, ratio de valor, modo, dificultad y tu **valoración de diversión (1-5)** + comentario. En la pantalla de feedback puedes **exportar todo a JSON** para analizar los playtests e iterar el balance.

## Arquitectura

```
src/
  engine/          # MOTOR PURO determinista (TDD) — toda la lógica de reglas
  bot/             # IA: decide(state, history, difficulty) -> asignación
  data/            # cartas mock
  instrumentation/ # registro de playtest -> localStorage -> export JSON
  ui/              # React: setup, asignación, reveal, resultado, feedback
```

> **El motor (`src/engine/`) es la spec ejecutable del resolver on-chain de la Fase 1.** Es puro, determinista y está exhaustivamente testeado (incluida la batalla de ejemplo del SPEC §2.6) precisamente para poder portarlo fielmente a Rust/Anchor cuando se construya la liquidación trustless en Solana. Toda la resolución es entera salvo el cálculo del edge, que se redondea a entero.

## Documentos

- Diseño: [`docs/superpowers/specs/2026-06-06-fase0-blotto-prototype-design.md`](docs/superpowers/specs/2026-06-06-fase0-blotto-prototype-design.md)
- Plan de implementación: [`docs/superpowers/plans/2026-06-06-fase0-blotto-prototype.md`](docs/superpowers/plans/2026-06-06-fase0-blotto-prototype.md)

## Estado y próximos pasos

Fase 0 completa: motor + bot + hotseat + UI + instrumentación. **Siguiente paso real: playtests con coleccionistas** para validar diversión/retención y tunear `K`, `maxEdge`, energía base y banking con los datos exportados — antes de pasar a la Fase 1 (on-chain).
