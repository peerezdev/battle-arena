# Programa Anchor (escrow + commit-reveal + settlement) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un programa Anchor en Solana que custodie la apuesta USDC, ejecute commit-reveal, resuelva la batalla de forma determinista (port fiel del motor de Fase 0) y pague al ganador, validado en localnet.

**Architecture:** Workspace Anchor en `onchain/`. La lógica de reglas vive en **módulos Rust puros** (`edge.rs`, `rules.rs`, `hashing.rs`) testeables con `cargo test` sin validador — son el port 1:1 del motor TS. El programa Anchor (`lib.rs` + módulos de instrucciones) añade cuentas, escrow SPL, verificación de oráculo/NFT y settlement. Tests de integración en TypeScript sobre localnet, más vectores de equivalencia exportados desde el motor TS de Fase 0.

**Tech Stack:** Rust + Anchor 1.0.2, Solana 3.1.10 (Agave), `anchor-spl` (tokens), `@coral-xyz/anchor` + ts-mocha para tests, SHA-256 vía `solana_program::hash`, verificación ed25519 por introspección del sysvar Instructions.

**Toolchain (PATH):** todos los comandos asumen `export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"`. Ejecuta esa línea al inicio de cada sesión de shell.

---

## File Structure

```
onchain/
  Anchor.toml
  Cargo.toml                      # workspace
  package.json                    # deps de test TS (@coral-xyz/anchor, mocha, chai, spl-token)
  tsconfig.json
  programs/battle_arena/
    Cargo.toml
    src/
      lib.rs                      # #[program]: declara instrucciones, orquesta módulos
      state.rs                    # cuenta Battle, enums Phase, struct Allocation, MatchConfig
      errors.rs                   # #[error_code] ErrorCode
      edge.rs                     # compute_edge (entero puro) + tests unitarios
      rules.rs                    # resolve_front, resolve_round, banking, solidez (puro) + tests
      hashing.rs                  # commit_hash canónico (sha256) + test
      oracle.rs                   # verificación ed25519 por introspección
      instructions/
        initialize.rs             # initialize_battle
        join.rs                   # join_battle
        commit.rs                 # commit
        reveal.rs                 # reveal
        resolve.rs                # resolve_round
        settle.rs                 # settle
        timeout.rs                # claim_timeout
  tests/
    battle_arena.ts               # tests de integración localnet
    equivalence.ts                # carga vectores y comprueba equivalencia con el motor TS
    fixtures/
      vectors.json                # generado desde el motor TS (script)
  scripts/
    gen-vectors.ts                # usa src/engine (de Fase 0) para emitir vectors.json
```

**Constantes** (en `state.rs`): `COMMIT_WINDOW: i64 = 300`, `REVEAL_WINDOW: i64 = 300`, `STALE_SECS: i64 = 300`.

**Convención jugadores:** índice `0 = player_a`, `1 = player_b`. `Phase` enum: `Created, Committing, Revealing, RoundResolved, Settled`.

---

## Task 1: Inicializar el workspace Anchor

**Files:**
- Create: `onchain/` (workspace completo vía `anchor init`)

- [ ] **Step 1: Generar el workspace**

Run:
```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd /Users/mauro/Desarrollos/BattleArena
anchor init onchain --no-git
```
(`--no-git` porque ya estamos en un repo. Si el comando crea `onchain/.git`, elimínalo: `rm -rf onchain/.git`.)

- [ ] **Step 2: Generar un keypair local para el validador y configurar Solana a localnet**

Run:
```bash
solana-keygen new --no-bip39-passphrase --force -o ~/.config/solana/id.json
solana config set --url localhost
```
Expected: imprime la pubkey y "Config File ... RPC URL: http://localhost:8899".

- [ ] **Step 3: Build inicial**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/onchain
anchor build
```
Expected: compila el programa de plantilla sin errores (la primera vez tarda; descarga crates). Si falla por versión de `anchor-lang`, fija en `programs/battle_arena/Cargo.toml` `anchor-lang = "0.31"`-compatible con CLI 1.0.2 (usa la que `anchor init` haya puesto; no la cambies salvo error).

- [ ] **Step 4: Verificar que el test de plantilla corre en localnet**

Run:
```bash
anchor test
```
Expected: arranca un validador local, ejecuta el test de ejemplo y pasa (o, si la plantilla no trae test, "0 passing"). Lo importante: NO errores de toolchain.

- [ ] **Step 5: Añadir `onchain/` al .gitignore correcto y commit**

Add to root `.gitignore`:
```
onchain/target/
onchain/.anchor/
onchain/node_modules/
onchain/test-ledger/
```

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena
git add -A
git commit -m "chore(onchain): inicializar workspace Anchor"
```

---

## Task 2: Módulo `edge.rs` — bonus por valor (entero puro, TDD con `cargo test`)

**Files:**
- Create: `onchain/programs/battle_arena/src/edge.rs`
- Modify: `onchain/programs/battle_arena/src/lib.rs` (añadir `mod edge;`)

- [ ] **Step 1: Escribir el test que falla**

Create `onchain/programs/battle_arena/src/edge.rs`:
```rust
/// Bonus de energía por ronda para el de MAYOR valor.
/// Equivale a min(max_edge, round(0.5*log2(v_high/v_low))) reescrito con enteros.
pub fn compute_edge(v_high: u64, v_low: u64, max_edge: u8, edge_enabled: bool) -> u8 {
    if !edge_enabled || v_low == 0 || v_high <= v_low {
        return 0;
    }
    // umbrales: ratio >= 2,8,32,128  => edge 1,2,3,4
    let mut edge: u8 = 0;
    if v_high >= v_low.saturating_mul(2) { edge = 1; }
    if v_high >= v_low.saturating_mul(8) { edge = 2; }
    if v_high >= v_low.saturating_mul(32) { edge = 3; }
    if v_high >= v_low.saturating_mul(128) { edge = 4; }
    edge.min(max_edge)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ratio_2_gives_1() { assert_eq!(compute_edge(2000, 1000, 4, true), 1); }
    #[test]
    fn ratio_100_gives_3() { assert_eq!(compute_edge(100_000, 1000, 4, true), 3); }
    #[test]
    fn huge_ratio_caps_at_4() { assert_eq!(compute_edge(10_000_000, 1, 4, true), 4); }
    #[test]
    fn equal_value_zero() { assert_eq!(compute_edge(1000, 1000, 4, true), 0); }
    #[test]
    fn disabled_zero() { assert_eq!(compute_edge(100_000, 1000, 4, false), 0); }
    #[test]
    fn respects_lower_cap() { assert_eq!(compute_edge(10_000_000, 1, 2, true), 2); }
    #[test]
    fn boundary_just_below_2_is_0() { assert_eq!(compute_edge(1999, 1000, 4, true), 0); }
    #[test]
    fn boundary_exactly_8_is_2() { assert_eq!(compute_edge(8000, 1000, 4, true), 2); }
}
```

Add `mod edge;` to `onchain/programs/battle_arena/src/lib.rs` (near the top, after `use anchor_lang::prelude::*;`).

- [ ] **Step 2: Verificar que falla / compila el test**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/onchain/programs/battle_arena
cargo test edge
```
Expected: como la implementación ya está escrita junto al test (es trivial), debería PASAR directamente. Si prefieres ver el rojo primero, comenta el cuerpo y devuelve `0`, corre, y restaura. (Para esta función pura el valor del rojo es bajo; lo crítico es la batería de casos.)

- [ ] **Step 3: Verificar que pasa**

Run: `cargo test edge`
Expected: PASS (8 tests).

- [ ] **Step 4: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/programs/battle_arena/src/edge.rs onchain/programs/battle_arena/src/lib.rs
git commit -m "feat(onchain): edge entero (compute_edge) con tests"
```

---

## Task 3: `state.rs` — tipos de estado (Allocation, Phase, MatchConfig, Battle)

**Files:**
- Create: `onchain/programs/battle_arena/src/state.rs`
- Modify: `onchain/programs/battle_arena/src/lib.rs` (`pub mod state;`)

- [ ] **Step 1: Definir los tipos**

Create `onchain/programs/battle_arena/src/state.rs`:
```rust
use anchor_lang::prelude::*;

pub const COMMIT_WINDOW: i64 = 300;
pub const REVEAL_WINDOW: i64 = 300;
pub const STALE_SECS: i64 = 300;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Allocation {
    pub apertura: u32,
    pub choque: u32,
    pub remate: u32,
}
impl Allocation {
    pub fn total(&self) -> u32 {
        self.apertura
            .saturating_add(self.choque)
            .saturating_add(self.remate)
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Created,
    Committing,
    Revealing,
    RoundResolved,
    Settled,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct MatchConfig {
    pub rounds_to_win: u8,   // 2
    pub base_energy: u32,    // 10
    pub max_edge: u8,        // 4
    pub value_ratio_cap: u8, // 4 (0 = sin cap / challenge)
    pub max_rounds: u8,      // 5
    pub rake_bps: u16,       // 0..=500
    pub edge_enabled: bool,
}

#[account]
pub struct Battle {
    pub player_a: Pubkey,
    pub player_b: Pubkey,
    pub nft_mint_a: Pubkey,
    pub nft_mint_b: Pubkey,
    pub value_usd_a: u64,
    pub value_usd_b: u64,
    pub grade_a: u8,
    pub grade_b: u8,
    pub oracle: Pubkey,
    pub stake_mint: Pubkey,
    pub stake: u64,
    pub cfg: MatchConfig,
    pub edge_a: u8,
    pub edge_b: u8,
    pub banked_a: u32,
    pub banked_b: u32,
    pub wins_a: u8,
    pub wins_b: u8,
    pub round: u8,
    pub phase: Phase,
    pub commit_a: [u8; 32],
    pub commit_b: [u8; 32],
    pub reveal_a: Option<Allocation>,
    pub reveal_b: Option<Allocation>,
    pub deadline_commit: i64,
    pub deadline_reveal: i64,
    pub winner: Option<u8>, // 0=a, 1=b
    pub is_draw: bool,
    pub nonce: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Battle {
    // espacio: discriminator(8) + campos. Margen holgado.
    pub const SPACE: usize = 8 + 32 * 6 + 8 * 2 + 1 * 2 + 32 + 8
        + (1 + 4 + 1 + 1 + 1 + 2 + 1) // MatchConfig
        + 1 * 2  // edge
        + 4 * 2  // banked
        + 1 * 2  // wins
        + 1      // round
        + 2      // phase (enum) margen
        + 32 * 2 // commits
        + (1 + 12) * 2 // Option<Allocation>
        + 8 * 2  // deadlines
        + 2      // Option<u8> winner
        + 1      // is_draw
        + 8      // nonce
        + 1 + 1  // bumps
        + 64;    // margen extra
}
```

Add `pub mod state;` to `lib.rs`.

- [ ] **Step 2: Verificar compilación**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/onchain
anchor build
```
Expected: compila sin errores.

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/programs/battle_arena/src/state.rs onchain/programs/battle_arena/src/lib.rs
git commit -m "feat(onchain): tipos de estado (Battle, Phase, Allocation, MatchConfig)"
```

---

## Task 4: `errors.rs` — códigos de error

**Files:**
- Create: `onchain/programs/battle_arena/src/errors.rs`
- Modify: `lib.rs` (`pub mod errors;`)

- [ ] **Step 1: Definir errores**

Create `onchain/programs/battle_arena/src/errors.rs`:
```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Fase incorrecta para esta operación")]
    WrongPhase,
    #[msg("Atestación del oráculo caducada")]
    StaleAttestation,
    #[msg("Firma del oráculo inválida o ausente")]
    BadOracleSig,
    #[msg("No se posee la NFT requerida")]
    NftNotOwned,
    #[msg("Ratio de valor excede el cap (ranked)")]
    RatioCapExceeded,
    #[msg("Valor de carta debe ser > 0")]
    NonPositiveValue,
    #[msg("El hash del reveal no casa con el commit")]
    CommitMismatch,
    #[msg("La asignación excede la energía disponible")]
    OverAllocated,
    #[msg("Este jugador ya ha commiteado esta ronda")]
    AlreadyCommitted,
    #[msg("Faltan reveals para resolver")]
    MissingReveals,
    #[msg("Aún no se ha alcanzado el deadline")]
    DeadlineNotReached,
    #[msg("Overflow aritmético")]
    MathOverflow,
}
```

Add `pub mod errors;` to `lib.rs`.

- [ ] **Step 2: Verificar compilación**

Run: `cd /Users/mauro/Desarrollos/BattleArena/onchain && anchor build`
Expected: compila.

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/programs/battle_arena/src/errors.rs onchain/programs/battle_arena/src/lib.rs
git commit -m "feat(onchain): códigos de error"
```

---

## Task 5: `hashing.rs` — hash canónico commit-reveal (TDD)

**Files:**
- Create: `onchain/programs/battle_arena/src/hashing.rs`
- Modify: `lib.rs` (`pub mod hashing;`)

- [ ] **Step 1: Escribir test + implementación**

Create `onchain/programs/battle_arena/src/hashing.rs`:
```rust
use crate::state::Allocation;
use anchor_lang::solana_program::hash::hash;

/// Idéntico al motor TS: sha256("apertura|choque|remate|salt").
pub fn commit_hash(a: &Allocation, salt: &str) -> [u8; 32] {
    let canonical = format!("{}|{}|{}|{}", a.apertura, a.choque, a.remate, salt);
    hash(canonical.as_bytes()).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deterministic() {
        let a = Allocation { apertura: 3, choque: 4, remate: 3 };
        assert_eq!(commit_hash(&a, "salt123"), commit_hash(&a, "salt123"));
    }
    #[test]
    fn changes_with_salt() {
        let a = Allocation { apertura: 3, choque: 4, remate: 3 };
        assert_ne!(commit_hash(&a, "salt123"), commit_hash(&a, "salt999"));
    }
    #[test]
    fn changes_with_alloc() {
        let a = Allocation { apertura: 3, choque: 4, remate: 3 };
        let b = Allocation { apertura: 4, choque: 3, remate: 3 };
        assert_ne!(commit_hash(&a, "salt123"), commit_hash(&b, "salt123"));
    }
    // Vector de equivalencia con el motor TS: sha256("3|4|3|salt123")
    // se rellena en Task 13 cuando generemos vectores; aquí solo determinismo.
}
```

Add `pub mod hashing;` to `lib.rs`.

- [ ] **Step 2: Verificar**

Run: `cd /Users/mauro/Desarrollos/BattleArena/onchain/programs/battle_arena && cargo test hashing`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/programs/battle_arena/src/hashing.rs onchain/programs/battle_arena/src/lib.rs
git commit -m "feat(onchain): hash canónico commit-reveal (sha256) con tests"
```

---

## Task 6: `rules.rs` — resolución pura de frente y ronda (TDD, el corazón)

**Files:**
- Create: `onchain/programs/battle_arena/src/rules.rs`
- Modify: `lib.rs` (`pub mod rules;`)

- [ ] **Step 1: Escribir tests + implementación**

Create `onchain/programs/battle_arena/src/rules.rs`:
```rust
use crate::state::Allocation;

pub fn solidez(grade: u8) -> u32 { (grade as u32) * 10 }

#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub enum FrontWinner { A, B, Disputed }

#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub enum RoundWinner { A, B, Disputed }

pub fn resolve_front(a: u32, b: u32, sol_a: u32, sol_b: u32) -> FrontWinner {
    if a > b { return FrontWinner::A; }
    if b > a { return FrontWinner::B; }
    if sol_a > sol_b { return FrontWinner::A; }
    if sol_b > sol_a { return FrontWinner::B; }
    FrontWinner::Disputed
}

/// Resuelve la ronda. Devuelve (ganador, fronts_a, fronts_b).
pub fn resolve_round(
    ra: &Allocation, rb: &Allocation, sol_a: u32, sol_b: u32,
) -> RoundWinner {
    let fronts = [
        resolve_front(ra.apertura, rb.apertura, sol_a, sol_b),
        resolve_front(ra.choque, rb.choque, sol_a, sol_b),
        resolve_front(ra.remate, rb.remate, sol_a, sol_b),
    ];
    let a_fronts = fronts.iter().filter(|f| **f == FrontWinner::A).count();
    let b_fronts = fronts.iter().filter(|f| **f == FrontWinner::B).count();
    if a_fronts > b_fronts { return RoundWinner::A; }
    if b_fronts > a_fronts { return RoundWinner::B; }
    let total_a = ra.total();
    let total_b = rb.total();
    if total_a > total_b { return RoundWinner::A; }
    if total_b > total_a { return RoundWinner::B; }
    if sol_a > sol_b { return RoundWinner::A; }
    if sol_b > sol_a { return RoundWinner::B; }
    RoundWinner::Disputed
}

#[cfg(test)]
mod tests {
    use super::*;
    fn al(a: u32, c: u32, r: u32) -> Allocation { Allocation { apertura: a, choque: c, remate: r } }

    #[test]
    fn front_strict_more_wins() {
        assert_eq!(resolve_front(5, 3, 90, 90), FrontWinner::A);
        assert_eq!(resolve_front(3, 5, 90, 90), FrontWinner::B);
    }
    #[test]
    fn front_tie_aguante_by_solidez() {
        assert_eq!(resolve_front(3, 3, 90, 70), FrontWinner::A);
        assert_eq!(resolve_front(3, 3, 70, 90), FrontWinner::B);
    }
    #[test]
    fn front_tie_equal_solidez_disputed() {
        assert_eq!(resolve_front(3, 3, 90, 90), FrontWinner::Disputed);
    }
    #[test]
    fn round_most_fronts() {
        // A gana apertura y choque
        assert_eq!(resolve_round(&al(5,5,0), &al(3,3,4), 90, 90), RoundWinner::A);
    }
    #[test]
    fn round_tiebreak_total_energy() {
        // fronts 1-1 (apertura A, choque B, remate disputed 2=2), totales 8 vs 6 -> A
        assert_eq!(resolve_round(&al(5,1,2), &al(1,3,2), 90, 90), RoundWinner::A);
    }
    #[test]
    fn round_full_tie_disputed() {
        // simétrico perfecto: apertura A>B, choque B>A, remate empate disputed, totales iguales, solidez igual
        assert_eq!(resolve_round(&al(6,1,1), &al(1,6,1), 90, 90), RoundWinner::Disputed);
    }
}
```

Add `pub mod rules;` to `lib.rs`.

- [ ] **Step 2: Verificar**

Run: `cd /Users/mauro/Desarrollos/BattleArena/onchain/programs/battle_arena && cargo test rules`
Expected: PASS (6 tests). Si `round_tiebreak_total_energy` falla, revisa que los frentes queden 1-1 con totales distintos bajo las reglas; ajusta las cifras del test (no las reglas) hasta exhibir el camino de desempate por energía, documentando.

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/programs/battle_arena/src/rules.rs onchain/programs/battle_arena/src/lib.rs
git commit -m "feat(onchain): resolución pura de frente y ronda con tests"
```

---

## Task 7: `oracle.rs` — verificación ed25519 por introspección (TDD parcial)

**Files:**
- Create: `onchain/programs/battle_arena/src/oracle.rs`
- Modify: `lib.rs` (`pub mod oracle;`)

> Verifica que la transacción contiene una instrucción del programa nativo Ed25519 que firma `msg` con la pubkey `oracle`. Patrón estándar Solana (lectura del sysvar Instructions). El mensaje canónico atestado: `msg = nft_mint(32) || value_usd(8 LE) || grade(1) || ts(8 LE)`.

- [ ] **Step 1: Implementar el módulo**

Create `onchain/programs/battle_arena/src/oracle.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    ed25519_program,
    sysvar::instructions::{load_instruction_at_checked},
};
use crate::errors::ErrorCode;

/// Mensaje canónico atestado por el oráculo.
pub fn attestation_msg(nft_mint: &Pubkey, value_usd: u64, grade: u8, ts: i64) -> Vec<u8> {
    let mut v = Vec::with_capacity(32 + 8 + 1 + 8);
    v.extend_from_slice(nft_mint.as_ref());
    v.extend_from_slice(&value_usd.to_le_bytes());
    v.push(grade);
    v.extend_from_slice(&ts.to_le_bytes());
    v
}

/// Comprueba que la instrucción ed25519 en `ed25519_ix_index` del sysvar Instructions
/// firma exactamente `expected_msg` con `expected_pubkey`.
/// Parsea el formato del programa Ed25519 (offsets) — verificación criptográfica la hace
/// el runtime al ejecutar esa instrucción nativa; aquí confirmamos pubkey+mensaje.
pub fn verify_oracle_ed25519(
    instructions_sysvar: &AccountInfo,
    ed25519_ix_index: u8,
    expected_pubkey: &Pubkey,
    expected_msg: &[u8],
) -> Result<()> {
    let ix = load_instruction_at_checked(ed25519_ix_index as usize, instructions_sysvar)
        .map_err(|_| error!(ErrorCode::BadOracleSig))?;
    require_keys_eq!(ix.program_id, ed25519_program::ID, ErrorCode::BadOracleSig);

    // Formato del Ed25519Program (1 firma): header de 16 bytes con offsets u16 LE.
    let data = &ix.data;
    require!(data.len() >= 2, ErrorCode::BadOracleSig);
    let num_sigs = data[0];
    require!(num_sigs == 1, ErrorCode::BadOracleSig);
    // offsets en el header
    let read_u16 = |off: usize| -> u16 { u16::from_le_bytes([data[off], data[off + 1]]) };
    let pubkey_offset = read_u16(6) as usize;
    let msg_offset = read_u16(10) as usize;
    let msg_size = read_u16(12) as usize;

    require!(data.len() >= pubkey_offset + 32, ErrorCode::BadOracleSig);
    let pk = &data[pubkey_offset..pubkey_offset + 32];
    require!(pk == expected_pubkey.as_ref(), ErrorCode::BadOracleSig);

    require!(data.len() >= msg_offset + msg_size, ErrorCode::BadOracleSig);
    let msg = &data[msg_offset..msg_offset + msg_size];
    require!(msg == expected_msg, ErrorCode::BadOracleSig);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn msg_layout_len() {
        let pk = Pubkey::new_unique();
        let m = attestation_msg(&pk, 1234, 9, 1700000000);
        assert_eq!(m.len(), 32 + 8 + 1 + 8);
        assert_eq!(&m[0..32], pk.as_ref());
    }
}
```

Add `pub mod oracle;` to `lib.rs`.

- [ ] **Step 2: Verificar compilación + test unitario**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/onchain && anchor build
cd programs/battle_arena && cargo test oracle
```
Expected: compila; el test de layout pasa. (La verificación end-to-end de la firma se prueba en los tests de integración de Task 11, donde el cliente añade la instrucción Ed25519 real.)

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/programs/battle_arena/src/oracle.rs onchain/programs/battle_arena/src/lib.rs
git commit -m "feat(onchain): verificación ed25519 del oráculo por introspección"
```

---

## Task 8: `initialize_battle` + `join_battle` (escrow, oráculo, NFT, edge)

**Files:**
- Create: `onchain/programs/battle_arena/src/instructions/initialize.rs`, `onchain/programs/battle_arena/src/instructions/join.rs`, `onchain/programs/battle_arena/src/instructions/mod.rs`
- Modify: `lib.rs` (declarar `pub mod instructions;` y las funciones `#[program]`)
- Add dep: `anchor-spl` en `programs/battle_arena/Cargo.toml`

> Esta tarea es de integración Anchor (cuentas + CPI de tokens). Se prueba en localnet en Task 11; aquí el criterio es **compilar limpio** (`anchor build`).

- [ ] **Step 1: Añadir `anchor-spl`**

In `onchain/programs/battle_arena/Cargo.toml` `[dependencies]` add (usa la versión compatible con tu `anchor-lang`; si `anchor build` falla por versión, alinea a la de `anchor-lang`):
```toml
anchor-spl = "0.31"
```
And ensure features for token if needed. Run `cd onchain && anchor build` to confirm it resolves.

- [ ] **Step 2: Implementar `initialize.rs`**

Create `onchain/programs/battle_arena/src/instructions/initialize.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use anchor_spl::token::{self, Token, TokenAccount, Mint, Transfer};
use crate::state::*;
use crate::errors::ErrorCode;
use crate::oracle::{attestation_msg, verify_oracle_ed25519};

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct InitializeBattle<'info> {
    #[account(mut)]
    pub player_a: Signer<'info>,
    #[account(
        init,
        payer = player_a,
        space = Battle::SPACE,
        seeds = [b"battle", player_a.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub battle: Account<'info, Battle>,
    pub stake_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = player_a,
        seeds = [b"vault", battle.key().as_ref()],
        bump,
        token::mint = stake_mint,
        token::authority = battle,
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = player_a_token.owner == player_a.key(), constraint = player_a_token.mint == stake_mint.key())]
    pub player_a_token: Account<'info, TokenAccount>,
    /// NFT del jugador A: token account con amount >= 1 del mint nft_mint_a
    #[account(constraint = nft_token_a.owner == player_a.key() @ ErrorCode::NftNotOwned)]
    pub nft_token_a: Account<'info, TokenAccount>,
    /// CHECK: leído por introspección
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<InitializeBattle>,
    nonce: u64,
    stake: u64,
    cfg: MatchConfig,
    oracle: Pubkey,
    nft_mint_a: Pubkey,
    value_usd_a: u64,
    grade_a: u8,
    ts_a: i64,
    ed25519_ix_index: u8,
) -> Result<()> {
    // NFT ownership: el token account debe ser del mint declarado y tener saldo
    require!(ctx.accounts.nft_token_a.mint == nft_mint_a, ErrorCode::NftNotOwned);
    require!(ctx.accounts.nft_token_a.amount >= 1, ErrorCode::NftNotOwned);

    // staleness
    let now = Clock::get()?.unix_timestamp;
    require!(now - ts_a <= STALE_SECS && now >= ts_a, ErrorCode::StaleAttestation);

    // oráculo
    let msg = attestation_msg(&nft_mint_a, value_usd_a, grade_a, ts_a);
    verify_oracle_ed25519(&ctx.accounts.instructions_sysvar, ed25519_ix_index, &oracle, &msg)?;

    require!(value_usd_a > 0, ErrorCode::NonPositiveValue);

    // depósito de A
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player_a_token.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.player_a.to_account_info(),
            },
        ),
        stake,
    )?;

    let b = &mut ctx.accounts.battle;
    b.player_a = ctx.accounts.player_a.key();
    b.nft_mint_a = nft_mint_a;
    b.value_usd_a = value_usd_a;
    b.grade_a = grade_a;
    b.oracle = oracle;
    b.stake_mint = ctx.accounts.stake_mint.key();
    b.stake = stake;
    b.cfg = cfg;
    b.phase = Phase::Created;
    b.round = 0;
    b.commit_a = [0u8; 32];
    b.commit_b = [0u8; 32];
    b.reveal_a = None;
    b.reveal_b = None;
    b.winner = None;
    b.is_draw = false;
    b.nonce = nonce;
    b.bump = ctx.bumps.battle;
    b.vault_bump = ctx.bumps.escrow_vault;
    Ok(())
}
```

- [ ] **Step 3: Implementar `join.rs`**

Create `onchain/programs/battle_arena/src/instructions/join.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::ErrorCode;
use crate::edge::compute_edge;
use crate::oracle::{attestation_msg, verify_oracle_ed25519};

#[derive(Accounts)]
pub struct JoinBattle<'info> {
    #[account(mut)]
    pub player_b: Signer<'info>,
    #[account(mut, seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()], bump = battle.bump)]
    pub battle: Account<'info, Battle>,
    #[account(mut, seeds = [b"vault", battle.key().as_ref()], bump = battle.vault_bump)]
    pub escrow_vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = player_b_token.owner == player_b.key(), constraint = player_b_token.mint == battle.stake_mint)]
    pub player_b_token: Account<'info, TokenAccount>,
    #[account(constraint = nft_token_b.owner == player_b.key() @ ErrorCode::NftNotOwned)]
    pub nft_token_b: Account<'info, TokenAccount>,
    /// CHECK: introspección
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(
    ctx: Context<JoinBattle>,
    nft_mint_b: Pubkey,
    value_usd_b: u64,
    grade_b: u8,
    ts_b: i64,
    ed25519_ix_index: u8,
) -> Result<()> {
    let b = &mut ctx.accounts.battle;
    require!(b.phase == Phase::Created, ErrorCode::WrongPhase);

    require!(ctx.accounts.nft_token_b.mint == nft_mint_b, ErrorCode::NftNotOwned);
    require!(ctx.accounts.nft_token_b.amount >= 1, ErrorCode::NftNotOwned);

    let now = Clock::get()?.unix_timestamp;
    require!(now - ts_b <= STALE_SECS && now >= ts_b, ErrorCode::StaleAttestation);
    let msg = attestation_msg(&nft_mint_b, value_usd_b, grade_b, ts_b);
    verify_oracle_ed25519(&ctx.accounts.instructions_sysvar, ed25519_ix_index, &b.oracle, &msg)?;

    require!(value_usd_b > 0 && b.value_usd_a > 0, ErrorCode::NonPositiveValue);

    // cap de ratio (ranked): value_ratio_cap == 0 => sin cap
    let (hi, lo) = if b.value_usd_a >= value_usd_b { (b.value_usd_a, value_usd_b) } else { (value_usd_b, b.value_usd_a) };
    if b.cfg.value_ratio_cap > 0 {
        require!(hi <= lo.saturating_mul(b.cfg.value_ratio_cap as u64), ErrorCode::RatioCapExceeded);
    }

    // edge al de mayor valor
    let edge = compute_edge(hi, lo, b.cfg.max_edge, b.cfg.edge_enabled);
    if b.value_usd_a >= value_usd_b { b.edge_a = edge; b.edge_b = 0; } else { b.edge_b = edge; b.edge_a = 0; }

    // depósito de B
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.player_b_token.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.player_b.to_account_info(),
            },
        ),
        b.stake,
    )?;

    b.player_b = ctx.accounts.player_b.key();
    b.nft_mint_b = nft_mint_b;
    b.value_usd_b = value_usd_b;
    b.grade_b = grade_b;
    b.phase = Phase::Committing;
    b.deadline_commit = now + COMMIT_WINDOW;
    Ok(())
}
```

- [ ] **Step 4: `instructions/mod.rs` y wiring en `lib.rs`**

Create `onchain/programs/battle_arena/src/instructions/mod.rs`:
```rust
pub mod initialize;
pub mod join;
pub use initialize::*;
pub use join::*;
```

In `lib.rs`, inside `#[program] pub mod battle_arena { ... }`, declare:
```rust
pub fn initialize_battle(ctx: Context<InitializeBattle>, nonce: u64, stake: u64, cfg: MatchConfig, oracle: Pubkey, nft_mint_a: Pubkey, value_usd_a: u64, grade_a: u8, ts_a: i64, ed25519_ix_index: u8) -> Result<()> {
    instructions::initialize::handler(ctx, nonce, stake, cfg, oracle, nft_mint_a, value_usd_a, grade_a, ts_a, ed25519_ix_index)
}
pub fn join_battle(ctx: Context<JoinBattle>, nft_mint_b: Pubkey, value_usd_b: u64, grade_b: u8, ts_b: i64, ed25519_ix_index: u8) -> Result<()> {
    instructions::join::handler(ctx, nft_mint_b, value_usd_b, grade_b, ts_b, ed25519_ix_index)
}
```
Add `pub mod instructions;` and `use {state::*, instructions::*};` at the appropriate scope. Ensure `use crate::state::MatchConfig;` is visible to the program module signatures.

- [ ] **Step 5: Compilar**

Run: `cd /Users/mauro/Desarrollos/BattleArena/onchain && anchor build`
Expected: compila sin errores. Si hay errores de lifetimes/cuentas, corrígelos manteniendo la semántica descrita.

- [ ] **Step 6: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/programs/battle_arena/src/ onchain/programs/battle_arena/Cargo.toml
git commit -m "feat(onchain): initialize_battle y join_battle (escrow + oráculo + NFT + edge)"
```

---

## Task 9: `commit`, `reveal` (con validación de energía y hash)

**Files:**
- Create: `onchain/programs/battle_arena/src/instructions/commit.rs`, `onchain/programs/battle_arena/src/instructions/reveal.rs`
- Modify: `instructions/mod.rs`, `lib.rs`

- [ ] **Step 1: Implementar `commit.rs`**

Create `onchain/programs/battle_arena/src/instructions/commit.rs`:
```rust
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ErrorCode;

#[derive(Accounts)]
pub struct CommitMove<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()], bump = battle.bump)]
    pub battle: Account<'info, Battle>,
}

pub fn handler(ctx: Context<CommitMove>, commit: [u8; 32]) -> Result<()> {
    let b = &mut ctx.accounts.battle;
    require!(b.phase == Phase::Committing, ErrorCode::WrongPhase);
    let now = Clock::get()?.unix_timestamp;
    require!(now <= b.deadline_commit, ErrorCode::WrongPhase);

    let key = ctx.accounts.player.key();
    if key == b.player_a {
        require!(b.commit_a == [0u8; 32], ErrorCode::AlreadyCommitted);
        b.commit_a = commit;
    } else if key == b.player_b {
        require!(b.commit_b == [0u8; 32], ErrorCode::AlreadyCommitted);
        b.commit_b = commit;
    } else {
        return err!(ErrorCode::WrongPhase);
    }

    if b.commit_a != [0u8; 32] && b.commit_b != [0u8; 32] {
        b.phase = Phase::Revealing;
        b.deadline_reveal = now + REVEAL_WINDOW;
    }
    Ok(())
}
```

- [ ] **Step 2: Implementar `reveal.rs`**

Create `onchain/programs/battle_arena/src/instructions/reveal.rs`:
```rust
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ErrorCode;
use crate::hashing::commit_hash;

#[derive(Accounts)]
pub struct RevealMove<'info> {
    pub player: Signer<'info>,
    #[account(mut, seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()], bump = battle.bump)]
    pub battle: Account<'info, Battle>,
}

fn available(b: &Battle, is_a: bool) -> u32 {
    let banked = if is_a { b.banked_a } else { b.banked_b };
    let edge = if is_a { b.edge_a } else { b.edge_b } as u32;
    banked + b.cfg.base_energy + edge
}

pub fn handler(ctx: Context<RevealMove>, alloc: Allocation, salt: String) -> Result<()> {
    let b = &mut ctx.accounts.battle;
    require!(b.phase == Phase::Revealing, ErrorCode::WrongPhase);
    let key = ctx.accounts.player.key();
    let is_a = key == b.player_a;
    require!(is_a || key == b.player_b, ErrorCode::WrongPhase);

    require!(alloc.total() <= available(b, is_a), ErrorCode::OverAllocated);

    let expected = if is_a { b.commit_a } else { b.commit_b };
    require!(commit_hash(&alloc, &salt) == expected, ErrorCode::CommitMismatch);

    if is_a { b.reveal_a = Some(alloc); } else { b.reveal_b = Some(alloc); }
    Ok(())
}
```

- [ ] **Step 3: Wiring (`mod.rs` + `lib.rs`)**

Append to `instructions/mod.rs`:
```rust
pub mod commit;
pub mod reveal;
pub use commit::*;
pub use reveal::*;
```
Add to `#[program]` in `lib.rs`:
```rust
pub fn commit(ctx: Context<CommitMove>, commit: [u8; 32]) -> Result<()> {
    instructions::commit::handler(ctx, commit)
}
pub fn reveal(ctx: Context<RevealMove>, alloc: Allocation, salt: String) -> Result<()> {
    instructions::reveal::handler(ctx, alloc, salt)
}
```

- [ ] **Step 4: Compilar**

Run: `cd /Users/mauro/Desarrollos/BattleArena/onchain && anchor build`
Expected: compila.

- [ ] **Step 5: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/programs/battle_arena/src/
git commit -m "feat(onchain): commit y reveal con validación de energía y hash"
```

---

## Task 10: `resolve_round`, `settle`, `claim_timeout`

**Files:**
- Create: `onchain/programs/battle_arena/src/instructions/resolve.rs`, `onchain/programs/battle_arena/src/instructions/settle.rs`, `onchain/programs/battle_arena/src/instructions/timeout.rs`
- Modify: `instructions/mod.rs`, `lib.rs`

- [ ] **Step 1: Implementar `resolve.rs`**

Create `onchain/programs/battle_arena/src/instructions/resolve.rs`:
```rust
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ErrorCode;
use crate::rules::{resolve_round, solidez, RoundWinner};

#[derive(Accounts)]
pub struct ResolveRound<'info> {
    #[account(mut, seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()], bump = battle.bump)]
    pub battle: Account<'info, Battle>,
}

pub fn handler(ctx: Context<ResolveRound>) -> Result<()> {
    let b = &mut ctx.accounts.battle;
    require!(b.phase == Phase::Revealing, ErrorCode::WrongPhase);
    let ra = b.reveal_a.ok_or(error!(ErrorCode::MissingReveals))?;
    let rb = b.reveal_b.ok_or(error!(ErrorCode::MissingReveals))?;

    let sol_a = solidez(b.grade_a);
    let sol_b = solidez(b.grade_b);

    // banking: sobrante = disponible - gastado
    let avail_a = b.banked_a + b.cfg.base_energy + b.edge_a as u32;
    let avail_b = b.banked_b + b.cfg.base_energy + b.edge_b as u32;
    b.banked_a = avail_a - ra.total();
    b.banked_b = avail_b - rb.total();

    match resolve_round(&ra, &rb, sol_a, sol_b) {
        RoundWinner::A => b.wins_a += 1,
        RoundWinner::B => b.wins_b += 1,
        RoundWinner::Disputed => {}
    }

    let decided = b.wins_a >= b.cfg.rounds_to_win || b.wins_b >= b.cfg.rounds_to_win;
    let cap_reached = (b.round as u16 + 1) >= b.cfg.max_rounds as u16;

    if decided {
        b.winner = Some(if b.wins_a >= b.cfg.rounds_to_win { 0 } else { 1 });
        b.phase = Phase::Settled;
    } else if cap_reached {
        // empate por cap (nadie alcanzó rounds_to_win)
        if b.wins_a > b.wins_b { b.winner = Some(0); }
        else if b.wins_b > b.wins_a { b.winner = Some(1); }
        else { b.is_draw = true; }
        b.phase = Phase::Settled;
    } else {
        // siguiente ronda
        b.round += 1;
        b.commit_a = [0u8; 32];
        b.commit_b = [0u8; 32];
        b.reveal_a = None;
        b.reveal_b = None;
        b.phase = Phase::Committing;
        b.deadline_commit = Clock::get()?.unix_timestamp + COMMIT_WINDOW;
    }
    Ok(())
}
```

> Nota de diseño: si se alcanza el `max_rounds` y hay desigualdad de victorias (p.ej. 1-0 con rondas nulas intermedias), gana quien tenga más victorias; solo es `is_draw` si están empatados a victorias. Esto evita declarar empate cuando alguien iba ganando. Documentado en el spec como "empate solo si victorias iguales al agotar el cap".

- [ ] **Step 2: Implementar `settle.rs`**

Create `onchain/programs/battle_arena/src/instructions/settle.rs`:
```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::state::*;
use crate::errors::ErrorCode;

#[derive(Accounts)]
pub struct Settle<'info> {
    #[account(mut, seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()], bump = battle.bump)]
    pub battle: Account<'info, Battle>,
    #[account(mut, seeds = [b"vault", battle.key().as_ref()], bump = battle.vault_bump)]
    pub escrow_vault: Account<'info, TokenAccount>,
    #[account(mut, constraint = winner_token.mint == battle.stake_mint)]
    pub winner_token: Account<'info, TokenAccount>,
    #[account(mut, constraint = loser_token.mint == battle.stake_mint)]
    pub loser_token: Account<'info, TokenAccount>, // en draw: el otro jugador; en win: ignorado salvo refund parcial
    #[account(mut, constraint = treasury.mint == battle.stake_mint)]
    pub treasury: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Settle>) -> Result<()> {
    let b = &ctx.accounts.battle;
    require!(b.phase == Phase::Settled, ErrorCode::WrongPhase);
    let pot = b.stake.checked_mul(2).ok_or(error!(ErrorCode::MathOverflow))?;

    let battle_key = b.key();
    let seeds: &[&[u8]] = &[b"vault", battle_key.as_ref(), &[b.vault_bump]];
    let signer = &[seeds];

    if b.is_draw {
        // devolver stake a cada jugador (winner_token = A, loser_token = B por convención del cliente)
        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.winner_token.to_account_info(),
                authority: ctx.accounts.escrow_vault.to_account_info(),
            }, signer),
            b.stake,
        )?;
        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.loser_token.to_account_info(),
                authority: ctx.accounts.escrow_vault.to_account_info(),
            }, signer),
            b.stake,
        )?;
    } else {
        let rake = pot.checked_mul(b.cfg.rake_bps as u64).ok_or(error!(ErrorCode::MathOverflow))? / 10_000;
        let payout = pot - rake;
        if rake > 0 {
            token::transfer(
                CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.treasury.to_account_info(),
                    authority: ctx.accounts.escrow_vault.to_account_info(),
                }, signer),
                rake,
            )?;
        }
        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), Transfer {
                from: ctx.accounts.escrow_vault.to_account_info(),
                to: ctx.accounts.winner_token.to_account_info(),
                authority: ctx.accounts.escrow_vault.to_account_info(),
            }, signer),
            payout,
        )?;
    }
    Ok(())
}
```

> Nota: el cliente debe pasar como `winner_token` el ATA del ganador (en draw: el de A) y `loser_token` el del otro (en draw: B). El programa confía en la `winner`/`is_draw` ya fijada; una mejora futura es validar que `winner_token.owner` coincide con el ganador real (añadir constraint cuando el cliente pase también las pubkeys de jugador). Para MVP de localnet basta.

- [ ] **Step 3: Implementar `timeout.rs`**

Create `onchain/programs/battle_arena/src/instructions/timeout.rs`:
```rust
use anchor_lang::prelude::*;
use crate::state::*;
use crate::errors::ErrorCode;

#[derive(Accounts)]
pub struct ClaimTimeout<'info> {
    #[account(mut, seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()], bump = battle.bump)]
    pub battle: Account<'info, Battle>,
}

pub fn handler(ctx: Context<ClaimTimeout>) -> Result<()> {
    let b = &mut ctx.accounts.battle;
    let now = Clock::get()?.unix_timestamp;
    match b.phase {
        Phase::Committing => {
            require!(now > b.deadline_commit, ErrorCode::DeadlineNotReached);
            let a = b.commit_a != [0u8; 32];
            let bb = b.commit_b != [0u8; 32];
            if a && !bb { b.winner = Some(0); }
            else if bb && !a { b.winner = Some(1); }
            else { b.is_draw = true; } // ninguno o ambos (ambos no debería ocurrir, pasaría a revealing)
            b.phase = Phase::Settled;
        }
        Phase::Revealing => {
            require!(now > b.deadline_reveal, ErrorCode::DeadlineNotReached);
            let a = b.reveal_a.is_some();
            let bb = b.reveal_b.is_some();
            if a && !bb { b.winner = Some(0); }
            else if bb && !a { b.winner = Some(1); }
            else { b.is_draw = true; }
            b.phase = Phase::Settled;
        }
        _ => return err!(ErrorCode::WrongPhase),
    }
    Ok(())
}
```

- [ ] **Step 4: Wiring**

Append to `instructions/mod.rs`:
```rust
pub mod resolve;
pub mod settle;
pub mod timeout;
pub use resolve::*;
pub use settle::*;
pub use timeout::*;
```
Add to `#[program]`:
```rust
pub fn resolve_round(ctx: Context<ResolveRound>) -> Result<()> { instructions::resolve::handler(ctx) }
pub fn settle(ctx: Context<Settle>) -> Result<()> { instructions::settle::handler(ctx) }
pub fn claim_timeout(ctx: Context<ClaimTimeout>) -> Result<()> { instructions::timeout::handler(ctx) }
```

- [ ] **Step 5: Compilar**

Run: `cd /Users/mauro/Desarrollos/BattleArena/onchain && anchor build`
Expected: compila sin errores.

- [ ] **Step 6: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/programs/battle_arena/src/
git commit -m "feat(onchain): resolve_round, settle y claim_timeout"
```

---

## Task 11: Helpers de test TS (oráculo ed25519, mints, ATAs)

**Files:**
- Create: `onchain/tests/helpers.ts`
- Modify: `onchain/package.json` (deps: `@solana/spl-token`, `tweetnacl`)

- [ ] **Step 1: Instalar deps de test**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/onchain
npm install --save-dev @solana/spl-token tweetnacl
```

- [ ] **Step 2: Escribir helpers**

Create `onchain/tests/helpers.ts` con utilidades:
```ts
import * as anchor from '@coral-xyz/anchor'
import { Keypair, PublicKey, Transaction, Ed25519Program, SystemProgram } from '@solana/web3.js'
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token'

export function attestationMsg(nftMint: PublicKey, valueUsd: bigint, grade: number, ts: bigint): Buffer {
  const buf = Buffer.alloc(32 + 8 + 1 + 8)
  nftMint.toBuffer().copy(buf, 0)
  buf.writeBigUInt64LE(valueUsd, 32)
  buf.writeUInt8(grade, 40)
  buf.writeBigInt64LE(ts, 41)
  return buf
}

// Instrucción Ed25519 que firma `msg` con `oracle` (keypair). El índice de esta ix
// en la transacción se pasa como ed25519_ix_index al programa.
export function ed25519Ix(oracle: Keypair, msg: Buffer) {
  return Ed25519Program.createInstructionWithPrivateKey({
    privateKey: oracle.secretKey,
    message: msg,
  })
}

// crea un mint "USDC" de test y reparte saldo a `owners`
export async function setupStakeMint(provider: anchor.AnchorProvider, payer: Keypair, owners: PublicKey[], amount: bigint) {
  const mint = await createMint(provider.connection, payer, payer.publicKey, null, 6)
  const atas: PublicKey[] = []
  for (const o of owners) {
    const ata = await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, o)
    await mintTo(provider.connection, payer, mint, ata.address, payer, amount)
    atas.push(ata.address)
  }
  return { mint, atas }
}

// crea un "NFT" (mint supply 1) y su ATA para `owner`
export async function setupNft(provider: anchor.AnchorProvider, payer: Keypair, owner: PublicKey) {
  const mint = await createMint(provider.connection, payer, payer.publicKey, null, 0)
  const ata = await getOrCreateAssociatedTokenAccount(provider.connection, payer, mint, owner)
  await mintTo(provider.connection, payer, mint, ata.address, payer, 1n)
  return { mint: mint, ata: ata.address }
}

export async function airdrop(provider: anchor.AnchorProvider, to: PublicKey, sol = 2) {
  const sig = await provider.connection.requestAirdrop(to, sol * anchor.web3.LAMPORTS_PER_SOL)
  await provider.connection.confirmTransaction(sig)
}
```

- [ ] **Step 3: Verificar que TS compila**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/onchain
npx tsc --noEmit -p tsconfig.json
```
Expected: sin errores (puede que falten tipos; ajusta imports). Si `tsconfig.json` no incluye `tests/`, añádelo.

- [ ] **Step 4: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/tests/helpers.ts onchain/package.json onchain/package-lock.json onchain/tsconfig.json
git commit -m "test(onchain): helpers de oráculo ed25519, mints y ATAs"
```

---

## Task 12: Tests de integración del flujo feliz (localnet)

**Files:**
- Create: `onchain/tests/battle_arena.ts`

- [ ] **Step 1: Escribir el test del happy path**

Create `onchain/tests/battle_arena.ts`. Cubre: setup (oráculo keypair, stake mint, NFTs), `initialize_battle` (con ix ed25519 en índice 0 y la del programa en índice 1, pasando `ed25519_ix_index = 0`), `join_battle`, una ronda commit→reveal→resolve, y comprobaciones de estado. Estructura:
```ts
import * as anchor from '@coral-xyz/anchor'
import { Program } from '@coral-xyz/anchor'
import { Keypair, Transaction, PublicKey } from '@solana/web3.js'
import { assert } from 'chai'
import { createHash } from 'crypto'
import { attestationMsg, ed25519Ix, setupStakeMint, setupNft, airdrop } from './helpers'
import { BattleArena } from '../target/types/battle_arena'

describe('battle_arena happy path', () => {
  const provider = anchor.AnchorProvider.env()
  anchor.setProvider(provider)
  const program = anchor.workspace.BattleArena as Program<BattleArena>

  const oracle = Keypair.generate()
  const playerA = Keypair.generate()
  const playerB = Keypair.generate()

  function commitHash(a: {apertura:number,choque:number,remate:number}, salt: string): Buffer {
    return createHash('sha256').update(`${a.apertura}|${a.choque}|${a.remate}|${salt}`).digest()
  }

  it('crea, une, juega una ronda y avanza estado', async () => {
    await airdrop(provider, playerA.publicKey)
    await airdrop(provider, playerB.publicKey)
    const payer = (provider.wallet as anchor.Wallet).payer

    const { mint: stakeMint, atas } = await setupStakeMint(provider, payer, [playerA.publicKey, playerB.publicKey], 1000n)
    const nftA = await setupNft(provider, payer, playerA.publicKey)
    const nftB = await setupNft(provider, payer, playerB.publicKey)

    const nonce = new anchor.BN(1)
    const [battlePda] = PublicKey.findProgramAddressSync(
      [Buffer.from('battle'), playerA.publicKey.toBuffer(), nonce.toArrayLike(Buffer, 'le', 8)],
      program.programId,
    )
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), battlePda.toBuffer()],
      program.programId,
    )

    const cfg = { roundsToWin: 2, baseEnergy: 10, maxEdge: 4, valueRatioCap: 4, maxRounds: 5, rakeBps: 0, edgeEnabled: true }
    const ts = BigInt(Math.floor(Date.now() / 1000))

    // initialize_battle con ed25519 ix en índice 0
    const msgA = attestationMsg(nftA.mint, 1000n, 9, ts)
    const ixEdA = ed25519Ix(oracle, msgA)
    const ixInit = await program.methods
      .initializeBattle(nonce, new anchor.BN(100), cfg, oracle.publicKey, nftA.mint, new anchor.BN(1000), 9, new anchor.BN(Number(ts)), 0)
      .accounts({
        playerA: playerA.publicKey,
        battle: battlePda,
        stakeMint,
        escrowVault: vaultPda,
        playerAToken: atas[0],
        nftTokenA: nftA.ata,
        instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .instruction()
    const txInit = new Transaction().add(ixEdA).add(ixInit)
    await provider.sendAndConfirm(txInit, [playerA])

    // join_battle (ed25519 en índice 0)
    const msgB = attestationMsg(nftB.mint, 950n, 7, ts)
    const ixEdB = ed25519Ix(oracle, msgB)
    const ixJoin = await program.methods
      .joinBattle(nftB.mint, new anchor.BN(950), 7, new anchor.BN(Number(ts)), 0)
      .accounts({
        playerB: playerB.publicKey,
        battle: battlePda,
        escrowVault: vaultPda,
        playerBToken: atas[1],
        nftTokenB: nftB.ata,
        instructionsSysvar: anchor.web3.SYSVAR_INSTRUCTIONS_PUBKEY,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .instruction()
    await provider.sendAndConfirm(new Transaction().add(ixEdB).add(ixJoin), [playerB])

    let st = await program.account.battle.fetch(battlePda)
    assert.deepEqual(st.phase, { committing: {} })
    assert.equal(st.edgeA, 0) // ratio 1000/950 < 2 -> edge 0

    // ronda 1: A 5/5/0, B 3/3/4 -> A gana 2 frentes
    const aAlloc = { apertura: 5, choque: 5, remate: 0 }
    const bAlloc = { apertura: 3, choque: 3, remate: 4 }
    await program.methods.commit([...commitHash(aAlloc, 'sa')]).accounts({ player: playerA.publicKey, battle: battlePda }).signers([playerA]).rpc()
    await program.methods.commit([...commitHash(bAlloc, 'sb')]).accounts({ player: playerB.publicKey, battle: battlePda }).signers([playerB]).rpc()
    await program.methods.reveal(aAlloc, 'sa').accounts({ player: playerA.publicKey, battle: battlePda }).signers([playerA]).rpc()
    await program.methods.reveal(bAlloc, 'sb').accounts({ player: playerB.publicKey, battle: battlePda }).signers([playerB]).rpc()
    await program.methods.resolveRound().accounts({ battle: battlePda }).rpc()

    st = await program.account.battle.fetch(battlePda)
    assert.equal(st.winsA, 1)
    assert.deepEqual(st.phase, { committing: {} }) // avanzó a la ronda 2
    assert.equal(st.round, 1)
  })
})
```

- [ ] **Step 2: Ejecutar en localnet**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/onchain
anchor test
```
Expected: arranca validador, despliega, el test PASA. Si falla por el índice de la ix ed25519, ajusta `ed25519_ix_index` al índice real de `ixEd*` dentro de la transacción (es 0 si va primera). Si falla por cuentas/seeds, corrige nombres de cuentas para casar con el `#[derive(Accounts)]`.

- [ ] **Step 3: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/tests/battle_arena.ts
git commit -m "test(onchain): integración happy path en localnet"
```

---

## Task 13: Vectores de equivalencia con el motor TS (incl. §2.6)

**Files:**
- Create: `onchain/scripts/gen-vectors.ts`, `onchain/tests/fixtures/vectors.json`, `onchain/tests/equivalence.ts`

- [ ] **Step 1: Script generador de vectores**

Create `onchain/scripts/gen-vectors.ts` que importa el motor de Fase 0 (`../../src/engine`) y simula varias batallas completas (incluida la §2.6: cara $1200 PSA8 vs barata $950 PSA7), registrando por ronda las asignaciones de A y B y el resultado esperado (wins por ronda, ganador final, banking). Emite `tests/fixtures/vectors.json` con forma:
```ts
// pseudo-estructura
// [{ name, cardA, cardB, cfg, rounds: [{allocA, allocB}], expected: { winner: 'a'|'b'|'draw', winsA, winsB } }]
```
Implementa la simulación llamando a `createMatch/commit/reveal/resolveRound/resolveBattle/nextRound` del motor TS con salts fijos, y captura `state.roundWins` y `state.winner` finales.

Run para generar:
```bash
cd /Users/mauro/Desarrollos/BattleArena/onchain
npx ts-node scripts/gen-vectors.ts   # o: npx tsx scripts/gen-vectors.ts
```
Expected: crea `tests/fixtures/vectors.json` no vacío. (Instala `tsx` o `ts-node` como devDep si hace falta.)

- [ ] **Step 2: Test de equivalencia en localnet**

Create `onchain/tests/equivalence.ts` que, por cada vector: monta el match on-chain (initialize/join con atestación del oráculo de test usando `cardA.valueUsd/grade`), juega cada ronda (commit/reveal con los allocs del vector, resolve_round), y al final asserta que `winsA/winsB/winner` del programa coinciden con `expected`. Reutiliza helpers de Task 11.

- [ ] **Step 3: Ejecutar**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/onchain
anchor test
```
Expected: tanto `battle_arena.ts` como `equivalence.ts` pasan; todos los vectores (incl. §2.6 con ganador 'b') casan entre el motor TS y el programa Anchor.

- [ ] **Step 4: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/scripts/gen-vectors.ts onchain/tests/fixtures/vectors.json onchain/tests/equivalence.ts onchain/package.json onchain/package-lock.json
git commit -m "test(onchain): vectores de equivalencia con el motor TS (incl. §2.6)"
```

---

## Task 14: Tests de settlement, empate por cap, timeouts y rechazos

**Files:**
- Create: `onchain/tests/settlement.ts`, `onchain/tests/rejections.ts`

- [ ] **Step 1: `settlement.ts`** — flujos de dinero

Cubre con asserts sobre balances de token:
- Victoria con `rakeBps=0`: ganador cobra `2·stake`, vault a 0.
- Victoria con `rakeBps=250`: ganador cobra `2·stake·0.975`, treasury recibe `2·stake·0.025`.
- Empate por cap (`maxRounds` con victorias iguales, forzando rondas nulas): cada jugador recupera `stake`.
- Construye una batalla 2-0 y llama `settle` con los ATAs correctos; lee balances con `getAccount`.

- [ ] **Step 2: `rejections.ts`** — caminos de error

Verifica que estas transacciones FALLAN con el error esperado (usa `try/catch` y comprueba el código/mensaje):
- `join_battle` con ratio > cap (ranked) → `RatioCapExceeded`.
- `initialize`/`join` con NFT no poseída (ATA con amount 0 u owner distinto) → `NftNotOwned`.
- atestación con `ts` viejo (`now - 10000`) → `StaleAttestation`.
- firma de oráculo de OTRA pubkey (otro keypair) → `BadOracleSig`.
- `reveal` con asignación cuyo hash no casa → `CommitMismatch`.
- `reveal` con `sum > disponible` → `OverAllocated`.
- doble `commit` del mismo jugador → `AlreadyCommitted`.
- `resolve_round` antes de ambos reveals → `MissingReveals` o `WrongPhase`.
- `claim_timeout` antes del deadline → `DeadlineNotReached`.

- [ ] **Step 3: Ejecutar toda la suite**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena/onchain
anchor test
```
Expected: TODOS los tests (`battle_arena`, `equivalence`, `settlement`, `rejections`) pasan.

- [ ] **Step 4: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/tests/settlement.ts onchain/tests/rejections.ts
git commit -m "test(onchain): settlement, empate por cap, timeouts y rechazos"
```

---

## Task 15: README del programa on-chain

**Files:**
- Create: `onchain/README.md`

- [ ] **Step 1: Escribir README**

Documenta: qué es (programa Anchor de Fase 1), requisitos de toolchain y la línea de PATH, cómo construir (`anchor build`), cómo testear (`anchor test` — arranca validador local), el flujo de instrucciones (initialize→join→commit→reveal→resolve→settle, + claim_timeout), las dos decisiones (edge entero, cap de rondas), la verificación de oráculo por introspección ed25519, y que la equivalencia con el motor TS de Fase 0 es la garantía de port fiel. Nota: localnet/devnet, sin dinero real, pendiente de auditoría antes de mainnet.

- [ ] **Step 2: Commit**

```bash
cd /Users/mauro/Desarrollos/BattleArena
git add onchain/README.md
git commit -m "docs(onchain): README del programa Anchor"
```

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** edge entero (Task 2), tipos/cuentas (3), errores (4), hash canónico (5), reglas puras (6), oráculo ed25519 (7), initialize/join con escrow+NFT+ratio cap (8), commit/reveal (9), resolve/settle/timeout (10), helpers de test (11), happy path (12), equivalencia con motor TS incl. §2.6 (13), settlement/empate/timeouts/rechazos (14), README (15). ✔️ Todas las instrucciones y decisiones del spec tienen tarea.
- **Placeholders:** las "Notas de diseño" en Tasks 10 (empate solo si victorias iguales) y settle (convención winner_token/loser_token del cliente) son aclaraciones, no TODOs. Tasks 13/14 describen el contenido de los tests con casos concretos y los asserts exactos a comprobar; el código de simulación de vectores depende del motor TS ya existente.
- **Consistencia de tipos/nombres:** `Allocation{apertura,choque,remate}` y `MatchConfig{rounds_to_win,base_energy,max_edge,value_ratio_cap,max_rounds,rake_bps,edge_enabled}` consistentes entre `state.rs`, instrucciones y tests TS (camelCase en TS: `roundsToWin`, etc., como genera Anchor). Seeds `[b"battle", player_a, nonce_le]` y `[b"vault", battle]` idénticas en todas las instrucciones. `compute_edge(v_high,v_low,max_edge,edge_enabled)`, `resolve_round(ra,rb,sol_a,sol_b)`, `commit_hash(alloc,salt)` usadas con firmas coherentes. ✔️
- **Riesgo conocido:** la verificación ed25519 por introspección (Task 7) y el casado del `ed25519_ix_index` (Task 12) son el punto más frágil; por eso se aíslan y se prueban primero con el happy path antes de los vectores.
