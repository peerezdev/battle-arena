# Fase 1 (ciclo 1) — Programa Anchor: escrow + commit-reveal + settlement

**Fecha:** 2026-06-06
**Estado:** Diseño aprobado, listo para plan de implementación
**Alcance:** SOLO el programa on-chain (Solana/Anchor) probado en localnet/devnet. Es el primer subsistema de la Fase 1 del SPEC.

## Objetivo

Construir el "árbitro automático" trustless: un programa Anchor que **custodia la apuesta en USDC**, ejecuta el **commit-reveal** anti-trampas, **resuelve la batalla de forma determinista** (port fiel del motor de Fase 0) y **paga al ganador** sin intervención humana. Se valida en localnet con dinero de juguete (mint SPL de test), de-riskeando el mayor desconocido técnico del proyecto (Rust/Anchor + escrow + commit-reveal) sin tocar dinero real, auditoría ni legal.

**Principio rector:** el motor de reglas se porta a Rust de forma **fiel**, y se verifica con **vectores de equivalencia** derivados del motor TypeScript de Fase 0 (mismos inputs → mismos resultados, incluida la batalla ejemplo §2.6).

## No-objetivos (otros ciclos)

- Servicio de oráculo real / TCG Pricing Intelligence (aquí se usa un **keypair de oráculo de test** que firma atestaciones).
- Backend, ELO/MMR, matchmaking online, historial, anti-colusión.
- Frontend, wallet adapter, vista de colección.
- Integración slug / Collector Crypt.
- Dinero real, USDC de mainnet, auditoría, verificación legal, mainnet.

## Decisiones aprobadas

1. **Edge sin float (enteros puros).** El bonus por valor de carta se recalcula con comparaciones enteras (sin `log2` flotante), dando los mismos resultados que el motor TS. Algoritmo: para `Vhigh ≥ Vlow`, `edge = 0`; `+1` si `Vhigh ≥ Vlow·2`; `+2` si `≥ Vlow·8`; `+3` si `≥ Vlow·32`; `+4` si `≥ Vlow·128` (tope 4). Esto es exactamente `min(4, round(0.5·log2(Vhigh/Vlow)))` reescrito con enteros (los umbrales salen de `2^(2k-1) ≤ ratio < 2^(2k+1)`). Casos del SPEC: ratio 2→+1, ratio 100→+3, ratio enorme→+4 (cap). El programa recibe `value_usd` de ambas cartas vía atestación firmada del oráculo y calcula el edge on-chain.
2. **Ronda nula con cap.** Empate total de ronda (frentes, energía y Solidez iguales) → ronda nula. En cadena no se rejuega indefinidamente: hay un **cap de rondas totales** (`maxRounds`, default 5). Si se agota sin que nadie alcance `roundsToWin`, se declara **empate de batalla** y **cada jugador recupera su depósito** (sin rake). Garantiza que el escrow nunca queda atascado.

## Arquitectura on-chain

Workspace Anchor nuevo en `onchain/` (programa `battle_arena`). Cliente de tests en TypeScript (`onchain/tests/`).

### Cuentas

- **`Battle`** (PDA, `seeds = [b"battle", player_a, nonce_le]`):
  - `player_a`, `player_b: Pubkey`
  - `nft_mint_a`, `nft_mint_b: Pubkey`
  - `value_usd_a`, `value_usd_b: u64` (atestados por el oráculo)
  - `grade_a`, `grade_b: u8` (atestados; `solidez = grade·10`)
  - `oracle: Pubkey` (clave del oráculo registrada en la cuenta de config/al crear)
  - `stake_mint: Pubkey` (mint SPL que hace de USDC)
  - `stake: u64` (cantidad que deposita cada jugador)
  - `cfg: MatchConfig` → `rounds_to_win:u8 (2)`, `base_energy:u32 (10)`, `max_edge:u8 (4)`, `value_ratio_cap:u8 (4)`, `max_rounds:u8 (5)`, `rake_bps:u16 (0–500)`, `edge_enabled:bool`
  - `edge_a`, `edge_b: u8` (bonus por ronda, calculado al unir B)
  - `banked_a`, `banked_b: u32` (energía bancada, oculta en UX; en cadena es pública pero no afecta a fairness porque el commit ya bloqueó)
  - `wins_a`, `wins_b: u8`
  - `round: u8` (0-based)
  - `phase: Phase` → `Created | Committing | Revealing | RoundResolved | Settled`
  - `commit_a`, `commit_b: [u8;32]` (hash de la ronda actual; `[0;32]` = sin commit)
  - `reveal_a`, `reveal_b: Option<Allocation>` (ronda actual)
  - `deadline_commit`, `deadline_reveal: i64` (unix ts; 0 = sin fijar)
  - `winner: Option<u8>` (0=a, 1=b; None hasta settle/empate)
  - `is_draw: bool`
  - `bump: u8`
- **`escrow_vault`**: token account SPL (PDA, `seeds=[b"vault", battle]`, authority = Battle PDA) que acumula `2·stake`.
- **`treasury`** (token account destino del rake): se pasa como cuenta en `settle`; el rake va ahí.

`Allocation = { apertura:u32, choque:u32, remate:u32 }`. `Phase` y `Allocation` son enums/structs Anchor serializables.

### Máquina de estados

`Created → (join) → Committing → (ambos commit) → Revealing → (ambos reveal) → resolve_round → RoundResolved → [siguiente ronda → Committing] | [batalla decidida o cap → Settled]`

### Instrucciones

1. **`initialize_battle`** (firma: `player_a`)
   - args: `nonce:u64`, `stake:u64`, `cfg`, atestación de A `(nft_mint_a, value_usd_a, ts_a, sig)`.
   - Verifica firma del oráculo sobre `(nft_mint_a, value_usd_a, ts_a)` (ver §Oráculo) y rechaza si `ts` es stale (`now - ts > 300s`).
   - Verifica **propiedad NFT**: el token account de A para `nft_mint_a` tiene `amount ≥ 1` y `owner == player_a`. La NFT **no se transfiere**.
   - Crea `Battle` PDA + `escrow_vault`; transfiere `stake` de A al vault.
   - `phase = Created`. Guarda `oracle`, `stake_mint`, `cfg`, `value_usd_a`.
2. **`join_battle`** (firma: `player_b`)
   - args: atestación de B `(nft_mint_b, value_usd_b, ts_b, sig)`.
   - Verifica firma + staleness + propiedad NFT de B.
   - Verifica `value_usd_a > 0 && value_usd_b > 0`.
   - **Cap de ratio (ranked):** si `mode ranked` y `max(va,vb) > value_ratio_cap · min(va,vb)` → error (rechazo de matchup). (Para MVP el modo se infiere de `cfg`; si `value_ratio_cap == 0` se interpreta como challenge/sin cap.)
   - Calcula `edge_a`/`edge_b` (algoritmo entero) si `edge_enabled`.
   - Transfiere `stake` de B al vault. `phase = Committing`; fija `deadline_commit = now + COMMIT_WINDOW`.
3. **`commit`** (firma: jugador)
   - Solo en `Committing` y `now ≤ deadline_commit`. Rechaza doble commit del mismo jugador.
   - Guarda `commit_x`. Cuando ambos han commiteado → `phase = Revealing`, `deadline_reveal = now + REVEAL_WINDOW`.
4. **`reveal`** (firma: jugador)
   - Solo en `Revealing`. Valida `sum(alloc) ≤ available(jugador)` donde `available = banked_x + base_energy + edge_x`. (Campos `u32` ⇒ no negativos por tipo.)
   - Recalcula `hash = sha256("apertura|choque|remate|salt")` (canónico idéntico al motor TS) y exige `hash == commit_x`.
   - Guarda `reveal_x`.
5. **`resolve_round`** (firma: cualquiera, permissionless)
   - Requiere `phase == Revealing` y ambos reveals presentes.
   - Resuelve frentes (gana energía estricta; empate → mayor Solidez = Aguante; si Solidez igual → disputado), ronda (más frentes; desempate energía total; desempate Solidez; si todo igual → ronda nula), banca el sobrante (`available − gastado`), incrementa `wins_x`.
   - **Solidez** se deriva on-chain del grade (se pasa el grade en la atestación o se guarda al crear; `solidez = grade·10`). → guardar `grade_a`, `grade_b: u8` en `Battle` (añadir a atestación).
   - Decide transición: si `wins_x ≥ rounds_to_win` → `winner`, `phase = Settled` (pendiente de pago). Si `round+1 ≥ max_rounds` sin ganador → `is_draw = true`, `phase = Settled`. Si no → `round += 1`, limpia `commit_*`/`reveal_*`, `phase = Committing`, nuevo `deadline_commit`.
6. **`settle`** (firma: cualquiera)
   - Solo `phase == Settled`.
   - Si `winner` definido: `rake = pot · rake_bps / 10000`; transfiere `rake` al `treasury` y `pot − rake` al token account del ganador. (`pot = 2·stake`.)
   - Si `is_draw`: devuelve `stake` a cada jugador, sin rake.
   - Cierra `escrow_vault` (rent al pagador) tras vaciarlo.
7. **`claim_timeout`** (firma: cualquiera) — anti-grief
   - Si `phase == Committing` y `now > deadline_commit`: si solo uno commiteó, **ese gana la batalla** (forfeit del ausente) → `winner`, `phase = Settled`. Si ninguno commiteó → `is_draw`, `phase = Settled`.
   - Si `phase == Revealing` y `now > deadline_reveal`: si solo uno reveló, ese gana; si ninguno, draw. → `Settled`.

### Oráculo (verificación de firma ed25519)

El oráculo firma `msg = nft_mint || value_usd_le || grade || ts_le` con ed25519. El programa **no** verifica ed25519 en su propio código (caro/no nativo); usa el patrón estándar Solana: la transacción incluye una instrucción del **programa nativo Ed25519** y el programa **introspecciona el sysvar `Instructions`** para confirmar que existe una verificación ed25519 válida de `msg` con la pubkey `oracle`. En tests, un keypair de oráculo de test firma. (Es la parte técnicamente más delicada del ciclo; se aísla en su propio módulo `oracle.rs` y se testea aparte.)

### Hash canónico (commit-reveal)

`sha256` (vía `solana_program::hash::hash`, que es SHA-256) sobre la cadena UTF-8 `"{apertura}|{choque}|{remate}|{salt}"`, **idéntico** al motor TS (`src/engine/hash.ts`). Así un cliente puede commitear igual y los vectores de equivalencia casan.

### Restricciones de determinismo

- **Cero floats.** Toda la resolución y el edge son enteros. Energía/banking en `u32`.
- Sin `Clock` para lógica de juego salvo deadlines (timeouts) — la resolución no depende del tiempo.
- Aritmética chequeada (`checked_add`/`checked_sub`) para evitar overflow/underflow.

## Estrategia de test (localnet)

`anchor test` con cliente TS (`@coral-xyz/anchor`). Setup: validador local, keypair de oráculo de test, mint SPL de test ("USDC") minteado a ambos jugadores, mints de NFT de test (supply 1) con token accounts de los jugadores.

Cobertura:
- **Unit (Rust, `cargo test`):** algoritmo de edge entero (casos SPEC + barrido de ratios comparado con la fórmula); resolución de frente (Aguante); resolución de ronda (desempates, ronda nula); banking; hash canónico (mismo vector que TS).
- **Vectores de equivalencia:** escenarios tomados del motor TS (incluida la batalla §2.6) → el programa produce el mismo ganador, mismas victorias por ronda y mismo banking. Se exportan como JSON desde un script que usa el motor TS y se cargan en los tests Anchor.
- **Integración (localnet):** flujo completo create→join→commit→reveal→resolve→settle; pago correcto al ganador (pot − rake) y rake al treasury; empate por cap → reembolso; timeouts → forfeit; rechazos (ratio cap, NFT no poseída, atestación stale, firma de oráculo inválida, hash de reveal que no casa, asignación que excede el disponible, doble commit, llamadas fuera de fase).

## Riesgos / notas

- **Curva Anchor/Rust** (riesgo del SPEC): mitigado aislando módulos puros (`rules.rs`, `edge.rs`, `oracle.rs`) testeables con `cargo test` sin validador, y usando el motor TS como oráculo de equivalencia.
- **Verificación ed25519 vía introspección** es el punto más frágil; se implementa y testea aislado primero.
- **Tamaño de cuenta `Battle`**: fijar `space` con margen; `Option<Allocation>` y campos por ronda son pequeños.
- **`value_ratio_cap` y modo**: para MVP el "modo" se modela con `value_ratio_cap` (0 = sin cap/challenge). Más adelante el backend lo fija.
- El banking es público on-chain (a diferencia de la UX oculta de Fase 0); no afecta a fairness porque el commit ya bloqueó la jugada de la ronda. Se documenta.
