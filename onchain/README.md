# Battle Arena — Programa on-chain (Anchor / Solana)

Programa Anchor de la **Fase 1** del SPEC: el "árbitro automático" trustless que custodia la apuesta en USDC, ejecuta el commit-reveal anti-trampas, resuelve la batalla de forma determinista (port fiel del motor de Fase 0) y paga al ganador — sin intervención humana.

**Estado:** validado en localnet/devnet con dinero de juguete (mint SPL de test). **Sin dinero real, sin auditoría, sin mainnet.** Pendiente de auditoría antes de cualquier despliegue con fondos reales.

## Toolchain

Las herramientas no están en el PATH por defecto. Al inicio de cada sesión:

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
```

Versiones: rustc/cargo 1.96 (el workspace fija 1.89 vía `rust-toolchain.toml`), solana-cli 3.1.10 (Agave), anchor-cli 1.0.2.

## Construir y testear

```bash
cd onchain
anchor build            # compila el programa -> target/deploy/battle_arena.so + IDL

# tests: rápidos, in-process (litesvm), sin validador
cd programs/battle_arena
cargo test              # 47 tests: lógica pura + integración + equivalencia + settlement + rechazos
```

> Nota: `anchor test` por defecto intenta usar `surfpool` (no instalado). Si lo necesitas, usa `anchor test --validator legacy`. Para iterar, `cargo test` es más rápido y no requiere validador — los tests de integración usan **litesvm** (con la feature `precompiles`, necesaria para verificar la firma ed25519 del oráculo).

## Flujo de instrucciones

```
initialize_battle (A deposita) → join_battle (B deposita)
   → [por ronda] commit (×2) → reveal (×2) → resolve_round
   → ... hasta 2 victorias o cap de rondas → settle (paga al ganador / reembolsa en empate)
claim_timeout: forfeit anti-grief si alguien no commitea/revela antes del deadline
```

- **Cuentas:** `Battle` PDA (`[b"battle", player_a, nonce_le]`), `escrow_vault` token PDA (`[b"vault", battle]`, authority = Battle PDA).
- **Estados:** `Created → Committing → Revealing → RoundResolved → Settled → Closed`.
- **Settle** liga los destinos a identidades on-chain: paga solo a `player_a`/`player_b` (token accounts con `owner` verificado), rake solo al `treasury` fijado en `initialize`, y transiciona a `Closed` (anti-replay). La NFT **nunca** se transfiere ni se custodia: solo se verifica propiedad (`amount ≥ 1`, owner correcto).

## Dos decisiones de diseño

1. **Edge entero (sin float).** El bonus por valor de carta se calcula con comparaciones enteras (`compute_edge`): `+1` si `V_alto ≥ V_bajo·2`, `+2` si `·8`, `+3` si `·32`, `+4` si `·128` (tope 4). Equivale a `min(4, round(0.5·log2(ratio)))` pero es determinista en cadena.
2. **Cap de rondas.** Empate total de ronda → ronda nula; con `max_rounds` (default 5) se evita que el escrow quede atascado. Si se agota sin 2 victorias y las victorias están empatadas → empate de batalla, cada jugador recupera su depósito (sin rake).

## Oráculo de valor (atestación firmada)

El valor `(nft_mint, value_usd, grade, ts)` lo firma un oráculo con **ed25519**. El programa **no** verifica la firma en su propio código: introspecciona el sysvar `Instructions` y confirma que la transacción incluye una instrucción del programa nativo Ed25519 que firma exactamente ese mensaje con la pubkey del oráculo registrada (`oracle.rs`). Se exige que los índices de instrucción del layout ed25519 sean **auto-referenciales (`0xFFFF`)** para impedir el ataque de redirección (verificar una firma legítima de *otra* instrucción mientras se comparan bytes forjados). Se rechazan atestaciones con `ts` viejo (> 5 min).

## Garantía de port fiel

El motor de reglas (`edge.rs`, `rules.rs`, `hashing.rs`) es la reescritura en Rust del motor TypeScript de Fase 0. La equivalencia se prueba con **vectores generados desde el propio motor TS** (`scripts/gen-vectors.ts` → `tests/fixtures/vectors.json`) que se reproducen on-chain y deben dar el **mismo ganador** (incluida la batalla de ejemplo del SPEC §2.6, donde gana la carta barata). Toda la resolución es entera; solo `compute_edge` parte de un ratio y redondea a entero.

## Layout

```
onchain/
  programs/battle_arena/src/
    lib.rs            # #[program]: declara las 7 instrucciones
    state.rs          # Battle (cuenta), Phase, Allocation, MatchConfig, constantes
    error.rs          # ErrorCode
    edge.rs           # compute_edge (entero)
    rules.rs          # resolve_front / resolve_round / solidez (puro)
    hashing.rs        # commit_hash (sha256 canónico, idéntico al motor TS)
    oracle.rs         # verificación ed25519 por introspección
    instructions/     # initialize, join, commit, reveal, resolve, settle, timeout
  programs/battle_arena/tests/
    common/mod.rs     # harness litesvm reutilizable
    integration.rs    # happy path end-to-end
    equivalence.rs    # replay de vectores del motor TS
    settlement.rs     # pagos, rake, empate, doble-settle
    rejections.rs     # control de acceso y validación (incl. robo de payout)
  scripts/gen-vectors.ts
```

## Riesgos residuales (resolver ANTES de mainnet / fondos reales)

Aceptables para un MVP de localnet, pero registrados explícitamente porque importan con dinero real (salieron de la revisión final):

1. **Rent bloqueado:** las cuentas `Battle` y `escrow_vault` no se cierran tras `settle`. El USDC del escrow siempre sale, pero el rent en SOL queda atrapado por batalla. Falta un cierre terminal (`close` en `settle`/instrucción `close_battle`) que devuelva el rent al pagador.
2. **Atestación del oráculo sin nonce ligado a la batalla:** una atestación `(mint, value, grade, ts)` válida es reutilizable por cualquiera dentro de la ventana de 5 min. Antes de mainnet: ligar la atestación al PDA de la batalla / jugador / nonce, y considerar rotación de clave o oráculo multi-firma.
3. **NFT no bloqueada:** solo se verifica propiedad (`amount ≥ 1`) en el momento; la misma NFT puede respaldar varias batallas simultáneas. Revisar si la escasez debe imponerse.
4. **Cranking permissionless:** `resolve_round`/`settle`/`claim_timeout` no requieren firmante (correcto y determinista, pero sin modelo de keeper/rate-limit). Decidir y documentar para mainnet.
5. **Auditoría de seguridad obligatoria** (el escrow custodia USDC) y verificación legal antes de cualquier despliegue con fondos reales.

## Próximos pasos (otros ciclos)

Servicio de oráculo real (TCG Pricing Intelligence), backend/ELO/matchmaking, frontend + wallet adapter, integración slug.
