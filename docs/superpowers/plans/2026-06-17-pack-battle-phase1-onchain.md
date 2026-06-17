# Pack Battle — Phase 1: On-chain NFT escrow + Directo settle (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an on-chain Pack Battle escrow to the `battle_arena` Anchor program where the pot is two NFTs (the players' gacha pulls) and the **Directo** mode pays both NFTs to the higher oracle-attested `insured_value`, with a timeout fallback.

**Architecture:** A new `PackBattle` account + instruction set living **alongside** the existing Mana-Duel `Battle` flow (it does not modify it). Each player's pulled NFT is held in a **PDA-owned vault token account** (created by the deliverer — the mock/gacha in later phases, the test harness here). The program records each card's mint/value/grade via the **existing** oracle ed25519 attestation (81-byte message `mint‖value‖grade‖ts‖battle`, reused unchanged), then `settle_direct` compares values and transfers both NFTs out of the vaults with PDA-signed CPIs (mirroring `instructions/settle.rs`). No USDC, no rake, no Blotto in this phase (Duelo de maña is Phase 4).

**Tech Stack:** Rust, Anchor (`anchor-lang`, `anchor-spl` token CPIs), LiteSVM in-process tests (`tests/common/mod.rs` harness). Tests run with `cargo test` from `onchain/`.

**Scope boundary:** This phase is on-chain only. Backend `GachaProvider`/mock, lobby, oracle service changes, and the frontend are later phases. The deposit model here is **verify-vault** (the NFT is already in a PDA-owned vault token account before the deposit instruction): in tests the harness mints it there directly, simulating the real gacha `altRecipient`→PDA delivery validated in Phase 5.

**Conventions (match the existing program):**
- Instruction handlers live in `onchain/programs/battle_arena/src/instructions/<name>.rs`, wired in `instructions.rs` and exposed in `lib.rs`.
- PDAs: `battle` seeds already used by Mana Duel are `[b"battle", player_a, nonce]`. Pack Battle uses a **distinct** seed prefix `[b"pack", player_a, nonce]` to avoid any collision.
- Build the program before running LiteSVM tests (the harness loads `target/deploy/battle_arena.so`): `anchor build` (or `cargo build-sbf`) then `cargo test`.

---

## Task 1: `PackBattle` state + `PackPhase` enum

**Files:**
- Create: `onchain/programs/battle_arena/src/pack_state.rs`
- Modify: `onchain/programs/battle_arena/src/lib.rs` (add `pub mod pack_state;` and `pub use pack_state::*;`)
- Modify: `onchain/programs/battle_arena/src/error.rs` (add new error variants)

- [ ] **Step 1: Add error variants**

In `src/error.rs`, append these variants to the existing `ErrorCode` enum (keep existing variants first so their 6000+ numbers don't shift):

```rust
    #[msg("El oponente todavía no se ha unido al duelo.")]
    OpponentNotJoined,
    #[msg("Este lado ya depositó su carta.")]
    AlreadyDeposited,
    #[msg("Faltan cartas por depositar en el escrow.")]
    NotAllDeposited,
    #[msg("La cuenta de vault no es del PDA o no contiene la carta esperada.")]
    BadVault,
```

- [ ] **Step 2: Create the state file**

Create `src/pack_state.rs`. The `PackBattle` account mirrors the shape/space style of `Battle` in `state.rs` but holds NFT-escrow fields only (no USDC/rake/Blotto fields in this phase):

```rust
use anchor_lang::prelude::*;

/// Ventana (segundos) para que el oponente se una/deposite antes de poder reclamar.
pub const PACK_JOIN_WINDOW: i64 = 600;

/// Modo de resolución del duelo de packs.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PackMode {
    /// Mayor insured_value se lleva ambas cartas.
    Direct,
    /// Reservado para Fase 4 (Duelo de maña / Blotto).
    Mana,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PackPhase {
    Open,       // A creó el duelo; falta que B se una
    Joined,     // B se unió; faltan depósitos
    Ready,      // ambas cartas en escrow; se puede settle
    Settled,    // transferidas al ganador; terminal
}

#[account]
pub struct PackBattle {
    pub player_a: Pubkey,
    pub player_b: Pubkey,
    pub oracle: Pubkey,
    pub mode: PackMode,
    pub nft_mint_a: Pubkey,
    pub nft_mint_b: Pubkey,
    pub value_usd_a: u64,
    pub value_usd_b: u64,
    pub grade_a: u8,
    pub grade_b: u8,
    pub deposited_a: bool,
    pub deposited_b: bool,
    pub phase: PackPhase,
    pub winner: Option<u8>, // 0 = A, 1 = B
    pub is_draw: bool,
    pub deadline_join: i64,
    pub nonce: u64,
    pub bump: u8,
}

impl PackBattle {
    pub const SPACE: usize = 8        // discriminator
        + 32 * 3                      // player_a, player_b, oracle
        + 2                           // mode (enum, holgado)
        + 32 * 2                      // nft_mint_a, nft_mint_b
        + 8 * 2                       // value_usd_a, value_usd_b
        + 1 * 2                       // grade_a, grade_b
        + 1 * 2                       // deposited_a, deposited_b
        + 2                           // phase (enum, holgado)
        + (1 + 1)                     // winner (Option<u8>)
        + 1                           // is_draw
        + 8                           // deadline_join
        + 8                           // nonce
        + 1                           // bump
        + 32;                         // colchón
}
```

- [ ] **Step 3: Wire the module**

In `src/lib.rs`, add after the existing `pub mod` lines:
```rust
pub mod pack_state;
```
and after the existing `pub use state::*;`:
```rust
pub use pack_state::*;
```

- [ ] **Step 4: Build to verify it compiles**

Run: `cd onchain && cargo build-sbf 2>&1 | tail -5` (or `anchor build`)
Expected: builds with no errors (no tests yet).

- [ ] **Step 5: Commit**
```bash
git add onchain/programs/battle_arena/src/pack_state.rs onchain/programs/battle_arena/src/lib.rs onchain/programs/battle_arena/src/error.rs
git commit -m "feat(onchain): estado PackBattle + PackPhase/PackMode + errores de pack battle"
```

---

## Task 2: `create_pack_battle` + `join_pack_battle` instructions

**Files:**
- Create: `onchain/programs/battle_arena/src/instructions/pack_create.rs`
- Create: `onchain/programs/battle_arena/src/instructions/pack_join.rs`
- Modify: `onchain/programs/battle_arena/src/instructions.rs` (add `pub mod pack_create; pub mod pack_join;` and re-export their `*`)
- Modify: `onchain/programs/battle_arena/src/lib.rs` (add the two `#[program]` entrypoints)

- [ ] **Step 1: `create_pack_battle` context + handler**

Create `src/instructions/pack_create.rs`. Mirror the PDA-init style of `initialize.rs` but with the `pack` seed and no vault/token accounts (no NFT is known yet at creation):

```rust
use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::pack_state::*;

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreatePackBattle<'info> {
    #[account(mut)]
    pub player_a: Signer<'info>,
    #[account(
        init,
        payer = player_a,
        space = PackBattle::SPACE,
        seeds = [b"pack", player_a.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub pack: Account<'info, PackBattle>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreatePackBattle>, nonce: u64, oracle: Pubkey, mode: PackMode) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let p = &mut ctx.accounts.pack;
    p.player_a = ctx.accounts.player_a.key();
    p.player_b = Pubkey::default();
    p.oracle = oracle;
    p.mode = mode;
    p.nft_mint_a = Pubkey::default();
    p.nft_mint_b = Pubkey::default();
    p.value_usd_a = 0;
    p.value_usd_b = 0;
    p.grade_a = 0;
    p.grade_b = 0;
    p.deposited_a = false;
    p.deposited_b = false;
    p.phase = PackPhase::Open;
    p.winner = None;
    p.is_draw = false;
    p.deadline_join = now + PACK_JOIN_WINDOW;
    p.nonce = nonce;
    p.bump = ctx.bumps.pack;
    Ok(())
}
```

- [ ] **Step 2: `join_pack_battle` context + handler**

Create `src/instructions/pack_join.rs`:

```rust
use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::pack_state::*;

#[derive(Accounts)]
pub struct JoinPackBattle<'info> {
    pub player_b: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pack", pack.player_a.as_ref(), &pack.nonce.to_le_bytes()],
        bump = pack.bump
    )]
    pub pack: Account<'info, PackBattle>,
}

pub fn handler(ctx: Context<JoinPackBattle>) -> Result<()> {
    let p = &mut ctx.accounts.pack;
    require!(p.phase == PackPhase::Open, ErrorCode::WrongPhase);
    require!(p.player_b == Pubkey::default(), ErrorCode::AlreadyDeposited);
    require!(ctx.accounts.player_b.key() != p.player_a, ErrorCode::UnauthorizedTokenAccount);
    p.player_b = ctx.accounts.player_b.key();
    p.phase = PackPhase::Joined;
    Ok(())
}
```

- [ ] **Step 3: Wire `instructions.rs` and `lib.rs`**

In `src/instructions.rs` add:
```rust
pub mod pack_create;
pub mod pack_join;
```
In `src/lib.rs` `#[program] mod battle_arena`, add:
```rust
    pub fn create_pack_battle(ctx: Context<CreatePackBattle>, nonce: u64, oracle: Pubkey, mode: PackMode) -> Result<()> {
        instructions::pack_create::handler(ctx, nonce, oracle, mode)
    }

    pub fn join_pack_battle(ctx: Context<JoinPackBattle>) -> Result<()> {
        instructions::pack_join::handler(ctx)
    }
```
Ensure `use super::*;` already re-exports the contexts (it does via `pub use instructions::*;` + `pub use pack_state::*;`).

- [ ] **Step 4: Build**

Run: `cd onchain && cargo build-sbf 2>&1 | tail -5`
Expected: compiles clean.

- [ ] **Step 5: Commit**
```bash
git add onchain/programs/battle_arena/src/instructions/pack_create.rs onchain/programs/battle_arena/src/instructions/pack_join.rs onchain/programs/battle_arena/src/instructions.rs onchain/programs/battle_arena/src/lib.rs
git commit -m "feat(onchain): create_pack_battle + join_pack_battle"
```

---

## Task 3: `deposit_card` instruction (verify-vault + oracle attestation)

**Files:**
- Create: `onchain/programs/battle_arena/src/instructions/pack_deposit.rs`
- Modify: `onchain/programs/battle_arena/src/instructions.rs`, `src/lib.rs`

The depositor proves their pulled NFT is in a **PDA-owned vault token account** and binds its mint/value/grade with the oracle attestation. Mirror the oracle-verification block from `initialize.rs` (`attestation_msg` + `verify_oracle_ed25519`, using `pack.key()` as the bound battle id) and the freshness check.

- [ ] **Step 1: Context + handler**

Create `src/instructions/pack_deposit.rs`:

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::error::ErrorCode;
use crate::oracle::{attestation_msg, verify_oracle_ed25519};
use crate::pack_state::*;
use crate::state::STALE_SECS;

#[derive(Accounts)]
pub struct DepositCard<'info> {
    pub depositor: Signer<'info>,
    #[account(
        mut,
        seeds = [b"pack", pack.player_a.as_ref(), &pack.nonce.to_le_bytes()],
        bump = pack.bump
    )]
    pub pack: Account<'info, PackBattle>,
    /// Vault PDA-owned que ya contiene la carta (entregada por el gacha/altRecipient).
    #[account(
        constraint = vault.owner == pack.key() @ ErrorCode::BadVault,
        constraint = vault.amount == 1 @ ErrorCode::BadVault,
    )]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// CHECK: validado por address; leído por introspección en verify_oracle_ed25519.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
}

#[allow(clippy::too_many_arguments)]
pub fn handler(
    ctx: Context<DepositCard>,
    nft_mint: Pubkey,
    value_usd: u64,
    grade: u8,
    ts: i64,
    ed25519_ix_index: u8,
) -> Result<()> {
    let depositor = ctx.accounts.depositor.key();
    let pack_key = ctx.accounts.pack.key();
    let p = &mut ctx.accounts.pack;
    require!(p.phase == PackPhase::Joined, ErrorCode::WrongPhase);
    require!(value_usd > 0, ErrorCode::NonPositiveValue);

    // El vault debe contener exactamente la carta declarada.
    require!(ctx.accounts.vault.mint == nft_mint, ErrorCode::BadVault);

    // Frescura + firma del oráculo (mismo formato 81 bytes ligado a esta batalla).
    let now = Clock::get()?.unix_timestamp;
    require!(now >= ts && now - ts <= STALE_SECS, ErrorCode::StaleAttestation);
    let msg = attestation_msg(&nft_mint, value_usd, grade, ts, &pack_key);
    verify_oracle_ed25519(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        ed25519_ix_index,
        &p.oracle,
        &msg,
    )?;

    // Atribuir el depósito al lado correcto.
    if depositor == p.player_a {
        require!(!p.deposited_a, ErrorCode::AlreadyDeposited);
        p.nft_mint_a = nft_mint;
        p.value_usd_a = value_usd;
        p.grade_a = grade;
        p.deposited_a = true;
    } else if depositor == p.player_b {
        require!(!p.deposited_b, ErrorCode::AlreadyDeposited);
        p.nft_mint_b = nft_mint;
        p.value_usd_b = value_usd;
        p.grade_b = grade;
        p.deposited_b = true;
    } else {
        return err!(ErrorCode::UnauthorizedTokenAccount);
    }

    if p.deposited_a && p.deposited_b {
        p.phase = PackPhase::Ready;
    }
    Ok(())
}
```

- [ ] **Step 2: Wire `instructions.rs` + `lib.rs`**

`instructions.rs`: `pub mod pack_deposit;`
`lib.rs` entrypoint:
```rust
    pub fn deposit_card(ctx: Context<DepositCard>, nft_mint: Pubkey, value_usd: u64, grade: u8, ts: i64, ed25519_ix_index: u8) -> Result<()> {
        instructions::pack_deposit::handler(ctx, nft_mint, value_usd, grade, ts, ed25519_ix_index)
    }
```

- [ ] **Step 3: Build**
Run: `cd onchain && cargo build-sbf 2>&1 | tail -5` → compiles clean.

- [ ] **Step 4: Commit**
```bash
git add onchain/programs/battle_arena/src/instructions/pack_deposit.rs onchain/programs/battle_arena/src/instructions.rs onchain/programs/battle_arena/src/lib.rs
git commit -m "feat(onchain): deposit_card (verifica vault PDA + atestación del oráculo)"
```

---

## Task 4: `settle_direct` instruction (compare + transfer both NFTs)

**Files:**
- Create: `onchain/programs/battle_arena/src/instructions/pack_settle_direct.rs`
- Modify: `onchain/programs/battle_arena/src/instructions.rs`, `src/lib.rs`

Compare `value_usd_a` vs `value_usd_b`; tiebreak by `grade` (higher wins); a true tie (equal value and grade) → `is_draw`, each card returns to its own player. Transfer the NFTs out of the two PDA-owned vaults with PDA-signed CPIs — **mirror the `CpiContext::new_with_signer` + `pack` seeds pattern from `instructions/settle.rs`** (seeds here: `[b"pack", player_a, nonce, [bump]]`).

- [ ] **Step 1: Context + handler**

Create `src/instructions/pack_settle_direct.rs`:

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::pack_state::*;

#[derive(Accounts)]
pub struct SettleDirect<'info> {
    #[account(
        mut,
        seeds = [b"pack", pack.player_a.as_ref(), &pack.nonce.to_le_bytes()],
        bump = pack.bump
    )]
    pub pack: Account<'info, PackBattle>,
    #[account(mut, constraint = vault_a.owner == pack.key() @ ErrorCode::BadVault,
              constraint = vault_a.mint == pack.nft_mint_a @ ErrorCode::BadVault)]
    pub vault_a: Box<Account<'info, TokenAccount>>,
    #[account(mut, constraint = vault_b.owner == pack.key() @ ErrorCode::BadVault,
              constraint = vault_b.mint == pack.nft_mint_b @ ErrorCode::BadVault)]
    pub vault_b: Box<Account<'info, TokenAccount>>,
    /// Destino para la carta A (mint nft_mint_a).
    #[account(mut, constraint = dest_a.mint == pack.nft_mint_a @ ErrorCode::BadVault)]
    pub dest_a: Box<Account<'info, TokenAccount>>,
    /// Destino para la carta B (mint nft_mint_b).
    #[account(mut, constraint = dest_b.mint == pack.nft_mint_b @ ErrorCode::BadVault)]
    pub dest_b: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<SettleDirect>) -> Result<()> {
    {
        let p = &ctx.accounts.pack;
        require!(p.mode == PackMode::Direct, ErrorCode::WrongPhase);
        require!(p.phase == PackPhase::Ready, ErrorCode::NotAllDeposited);
    }

    // Determinar ganador (o empate real) por valor, desempate por grade.
    let (winner, is_draw) = {
        let p = &ctx.accounts.pack;
        if p.value_usd_a > p.value_usd_b { (Some(0u8), false) }
        else if p.value_usd_b > p.value_usd_a { (Some(1u8), false) }
        else if p.grade_a > p.grade_b { (Some(0u8), false) }
        else if p.grade_b > p.grade_a { (Some(1u8), false) }
        else { (None, true) }
    };

    // Seeds del PDA `pack` para firmar las salidas de los vaults.
    let player_a = ctx.accounts.pack.player_a;
    let nonce_le = ctx.accounts.pack.nonce.to_le_bytes();
    let bump = ctx.accounts.pack.bump;
    let seeds: &[&[u8]] = &[b"pack", player_a.as_ref(), &nonce_le, &[bump]];
    let signer: &[&[&[u8]]] = &[seeds];

    // dest_a/dest_b deben pertenecer al receptor correcto según el resultado.
    // Empate: cada carta vuelve a su dueño. Si gana 0: ambas a A. Si gana 1: ambas a B.
    let (recv_a, recv_b): (Pubkey, Pubkey) = if is_draw {
        (ctx.accounts.pack.player_a, ctx.accounts.pack.player_b)
    } else if winner == Some(0) {
        (ctx.accounts.pack.player_a, ctx.accounts.pack.player_a)
    } else {
        (ctx.accounts.pack.player_b, ctx.accounts.pack.player_b)
    };
    require!(ctx.accounts.dest_a.owner == recv_a, ErrorCode::UnauthorizedTokenAccount);
    require!(ctx.accounts.dest_b.owner == recv_b, ErrorCode::UnauthorizedTokenAccount);

    // Transferir carta A (vault_a -> dest_a) y carta B (vault_b -> dest_b), amount 1.
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_a.to_account_info(),
                to: ctx.accounts.dest_a.to_account_info(),
                authority: ctx.accounts.pack.to_account_info(),
            },
            signer,
        ),
        1,
    )?;
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault_b.to_account_info(),
                to: ctx.accounts.dest_b.to_account_info(),
                authority: ctx.accounts.pack.to_account_info(),
            },
            signer,
        ),
        1,
    )?;

    let p = &mut ctx.accounts.pack;
    p.winner = winner;
    p.is_draw = is_draw;
    p.phase = PackPhase::Settled;
    Ok(())
}
```

> NOTE: `instructions/settle.rs` uses `ctx.accounts.token_program.key()` as the first CpiContext arg; `to_account_info()` is the correct `AccountInfo`. If the existing code compiles with `.key()`, match whatever the existing `settle.rs` uses to stay consistent — verify against that file when implementing.

- [ ] **Step 2: Wire `instructions.rs` + `lib.rs`**
`instructions.rs`: `pub mod pack_settle_direct;`
`lib.rs`:
```rust
    pub fn settle_direct(ctx: Context<SettleDirect>) -> Result<()> {
        instructions::pack_settle_direct::handler(ctx)
    }
```

- [ ] **Step 3: Build**
Run: `cd onchain && cargo build-sbf 2>&1 | tail -5` → compiles clean.

- [ ] **Step 4: Commit**
```bash
git add onchain/programs/battle_arena/src/instructions/pack_settle_direct.rs onchain/programs/battle_arena/src/instructions.rs onchain/programs/battle_arena/src/lib.rs
git commit -m "feat(onchain): settle_direct (mayor insured_value se lleva ambas cartas; empate reembolsa)"
```

---

## Task 5: `claim_pack_timeout` (creator reclaims if opponent never completes)

**Files:**
- Create: `onchain/programs/battle_arena/src/instructions/pack_timeout.rs`
- Modify: `onchain/programs/battle_arena/src/instructions.rs`, `src/lib.rs`

If the deadline passed and the battle never reached `Ready` (opponent didn't join or didn't deposit), the player who DID deposit reclaims their card from its vault. Mirror the deadline + PDA-signed transfer pattern.

- [ ] **Step 1: Context + handler**

Create `src/instructions/pack_timeout.rs`:

```rust
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::pack_state::*;

#[derive(Accounts)]
pub struct ClaimPackTimeout<'info> {
    #[account(
        mut,
        seeds = [b"pack", pack.player_a.as_ref(), &pack.nonce.to_le_bytes()],
        bump = pack.bump
    )]
    pub pack: Account<'info, PackBattle>,
    /// El vault del jugador que reclama (debe contener su carta).
    #[account(mut, constraint = vault.owner == pack.key() @ ErrorCode::BadVault,
              constraint = vault.amount == 1 @ ErrorCode::BadVault)]
    pub vault: Box<Account<'info, TokenAccount>>,
    /// Destino del reclamante (mismo mint que el vault).
    #[account(mut, constraint = dest.mint == vault.mint @ ErrorCode::BadVault)]
    pub dest: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<ClaimPackTimeout>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    {
        let p = &ctx.accounts.pack;
        require!(p.phase != PackPhase::Ready && p.phase != PackPhase::Settled, ErrorCode::WrongPhase);
        require!(now > p.deadline_join, ErrorCode::DeadlineNotReached);
        // Solo el lado que depositó puede reclamar su carta; su vault es el que tiene saldo.
        let claimant_is_a = p.deposited_a && ctx.accounts.vault.mint == p.nft_mint_a;
        let claimant_is_b = p.deposited_b && ctx.accounts.vault.mint == p.nft_mint_b;
        require!(claimant_is_a || claimant_is_b, ErrorCode::BadVault);
        let recv = if claimant_is_a { p.player_a } else { p.player_b };
        require!(ctx.accounts.dest.owner == recv, ErrorCode::UnauthorizedTokenAccount);
    }

    let player_a = ctx.accounts.pack.player_a;
    let nonce_le = ctx.accounts.pack.nonce.to_le_bytes();
    let bump = ctx.accounts.pack.bump;
    let seeds: &[&[u8]] = &[b"pack", player_a.as_ref(), &nonce_le, &[bump]];
    let signer: &[&[&[u8]]] = &[seeds];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.dest.to_account_info(),
                authority: ctx.accounts.pack.to_account_info(),
            },
            signer,
        ),
        1,
    )?;

    let p = &mut ctx.accounts.pack;
    p.phase = PackPhase::Settled;
    Ok(())
}
```

- [ ] **Step 2: Wire + build + commit**
`instructions.rs`: `pub mod pack_timeout;`; `lib.rs`:
```rust
    pub fn claim_pack_timeout(ctx: Context<ClaimPackTimeout>) -> Result<()> {
        instructions::pack_timeout::handler(ctx)
    }
```
Build: `cd onchain && cargo build-sbf 2>&1 | tail -5` → clean.
```bash
git add onchain/programs/battle_arena/src/instructions/pack_timeout.rs onchain/programs/battle_arena/src/instructions.rs onchain/programs/battle_arena/src/lib.rs
git commit -m "feat(onchain): claim_pack_timeout (reclamar la carta si el rival no completa)"
```

---

## Task 6: LiteSVM test harness for Pack Battle

**Files:**
- Create: `onchain/programs/battle_arena/tests/pack_common.rs` (a `mod` included by the pack test files)
- (Tests added in Task 7 use it.)

Extend the existing harness patterns from `tests/common/mod.rs`. Reuse `Harness` (it loads the same `.so`, SPL Token, Ed25519 precompile, fixed clock, oracle key) and `ed25519_attest_ix` + `attestation_msg`. Add a Pack-Battle scenario builder that, crucially, mints each NFT **directly into a PDA-owned vault token account** (simulating the gacha `altRecipient`→PDA delivery).

- [ ] **Step 1: Create the pack scenario builder**

Create `tests/pack_common.rs`:

```rust
#![allow(dead_code)]
mod common; // reuse Harness, ed25519_attest_ix, attestation_msg, FIXED_NOW, TOKEN_PROGRAM_ID, err, assert_error

use anchor_lang::{InstructionData, ToAccountMetas};
use common::*;
use ed25519_dalek::SigningKey;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;

pub struct PackScenario {
    pub payer: Keypair,
    pub player_a: Keypair,
    pub player_b: Keypair,
    pub nonce: u64,
    pub pack_pda: Pubkey,
    // NFT A
    pub nft_mint_a: Pubkey,
    pub vault_a: Pubkey,   // PDA-owned token account holding card A
    pub dest_a_for_a: Pubkey, // A's own ATA-like account for mint A (winner receives here)
    pub dest_a_for_b: Pubkey, // B's account for mint A
    // NFT B
    pub nft_mint_b: Pubkey,
    pub vault_b: Pubkey,
    pub dest_b_for_a: Pubkey,
    pub dest_b_for_b: Pubkey,
}

impl PackScenario {
    /// Crea jugadores y, para cada carta, un mint supply-1 ya depositado en un
    /// vault propiedad del PDA `pack` (emula altRecipient->PDA). También crea
    /// cuentas destino para ambos jugadores en cada mint.
    pub fn setup(h: &mut Harness) -> Self {
        let payer = Keypair::new();
        h.airdrop(&payer.pubkey(), 100_000_000_000);
        let player_a = Keypair::new();
        let player_b = Keypair::new();
        h.airdrop(&player_a.pubkey(), 10_000_000_000);
        h.airdrop(&player_b.pubkey(), 10_000_000_000);

        let nonce: u64 = 1;
        let (pack_pda, _) = Pubkey::find_program_address(
            &[b"pack", player_a.pubkey().as_ref(), &nonce.to_le_bytes()],
            &h.program_id,
        );

        // Mint A (decimals 0, supply 1) entregado al vault del PDA.
        let nft_mint_a = h.create_mint(&payer, &payer.pubkey(), 0);
        let vault_a = h.create_token_account(&payer, &nft_mint_a.pubkey(), &pack_pda);
        h.mint_to(&payer, &nft_mint_a.pubkey(), &vault_a.pubkey(), 1);
        let dest_a_for_a = h.create_token_account(&payer, &nft_mint_a.pubkey(), &player_a.pubkey());
        let dest_a_for_b = h.create_token_account(&payer, &nft_mint_a.pubkey(), &player_b.pubkey());

        // Mint B.
        let nft_mint_b = h.create_mint(&payer, &payer.pubkey(), 0);
        let vault_b = h.create_token_account(&payer, &nft_mint_b.pubkey(), &pack_pda);
        h.mint_to(&payer, &nft_mint_b.pubkey(), &vault_b.pubkey(), 1);
        let dest_b_for_a = h.create_token_account(&payer, &nft_mint_b.pubkey(), &player_a.pubkey());
        let dest_b_for_b = h.create_token_account(&payer, &nft_mint_b.pubkey(), &player_b.pubkey());

        Self {
            payer, player_a, player_b, nonce, pack_pda,
            nft_mint_a: nft_mint_a.pubkey(), vault_a: vault_a.pubkey(),
            dest_a_for_a: dest_a_for_a.pubkey(), dest_a_for_b: dest_a_for_b.pubkey(),
            nft_mint_b: nft_mint_b.pubkey(), vault_b: vault_b.pubkey(),
            dest_b_for_a: dest_b_for_a.pubkey(), dest_b_for_b: dest_b_for_b.pubkey(),
        }
    }

    pub fn create_ix(&self, h: &Harness) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::CreatePackBattle {
                player_a: self.player_a.pubkey(),
                pack: self.pack_pda,
                system_program: solana_sdk_ids::system_program::ID,
            }.to_account_metas(None),
            data: battle_arena::instruction::CreatePackBattle {
                nonce: self.nonce,
                oracle: h.oracle_pubkey,
                mode: battle_arena::pack_state::PackMode::Direct,
            }.data(),
        }
    }

    pub fn join_ix(&self, h: &Harness) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::JoinPackBattle {
                player_b: self.player_b.pubkey(),
                pack: self.pack_pda,
            }.to_account_metas(None),
            data: battle_arena::instruction::JoinPackBattle {}.data(),
        }
    }

    /// `[ed25519_ix, deposit_ix]` para un depositante (A o B) con su vault y mint.
    pub fn deposit_ixs(&self, h: &Harness, depositor: &Keypair, vault: Pubkey,
                       nft_mint: Pubkey, value: u64, grade: u8, oracle: &SigningKey) -> Vec<Instruction> {
        let msg = attestation_msg(&nft_mint, value, grade, FIXED_NOW, &self.pack_pda);
        let ed = ed25519_attest_ix(oracle, &msg);
        let dep = Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::DepositCard {
                depositor: depositor.pubkey(),
                pack: self.pack_pda,
                vault,
                instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID,
            }.to_account_metas(None),
            data: battle_arena::instruction::DepositCard {
                nft_mint, value_usd: value, grade, ts: FIXED_NOW, ed25519_ix_index: 0,
            }.data(),
        };
        vec![ed, dep]
    }

    pub fn settle_direct_ix(&self, h: &Harness, dest_a: Pubkey, dest_b: Pubkey) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::SettleDirect {
                pack: self.pack_pda,
                vault_a: self.vault_a,
                vault_b: self.vault_b,
                dest_a, dest_b,
                token_program: TOKEN_PROGRAM_ID,
            }.to_account_metas(None),
            data: battle_arena::instruction::SettleDirect {}.data(),
        }
    }

    pub fn claim_timeout_ix(&self, h: &Harness, vault: Pubkey, dest: Pubkey) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::ClaimPackTimeout {
                pack: self.pack_pda, vault, dest, token_program: TOKEN_PROGRAM_ID,
            }.to_account_metas(None),
            data: battle_arena::instruction::ClaimPackTimeout {}.data(),
        }
    }
}
```

> NOTE: confirm the generated `battle_arena::accounts::*` / `battle_arena::instruction::*` names match the snake_case instruction names (Anchor camel-cases them: `create_pack_battle` → `CreatePackBattle`). Mirror how `tests/common/mod.rs` references `battle_arena::accounts::InitializeBattle` etc.

- [ ] **Step 2: Build the program (tests load the .so)**
Run: `cd onchain && cargo build-sbf 2>&1 | tail -5` → clean. (No test yet; Task 7 adds them.)

- [ ] **Step 3: Commit**
```bash
git add onchain/programs/battle_arena/tests/pack_common.rs
git commit -m "test(onchain): harness de Pack Battle (entrega NFT al vault del PDA)"
```

---

## Task 7: Integration + rejection tests (LiteSVM)

**Files:**
- Create: `onchain/programs/battle_arena/tests/pack_battle.rs`

Each test follows the lifecycle and asserts on-chain state + NFT balances via `h.battle(...)`-style reads (add a `pack(...)` reader) and `h.token_amount(...)`.

- [ ] **Step 1: Add a `pack(...)` reader to the harness**

In `tests/common/mod.rs`, add a method on `Harness` (mirrors the existing `battle(...)`):
```rust
    pub fn pack(&self, pack_pda: &Pubkey) -> battle_arena::pack_state::PackBattle {
        let acc = self.svm.get_account(pack_pda).unwrap();
        battle_arena::pack_state::PackBattle::try_deserialize(&mut &acc.data[..]).unwrap()
    }
```

- [ ] **Step 2: Write the happy-path test (A higher value wins both)**

Create `tests/pack_battle.rs`:
```rust
mod pack_common;
mod common;
use common::*;
use pack_common::PackScenario;

#[test]
fn direct_higher_value_takes_both_cards() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);

    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);

    let oracle = h.oracle.clone();
    // A: value 1000, B: value 500 → A wins.
    h.send(&s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 1000, 9, &oracle), &s.player_a, &[&s.player_a]);
    h.send(&s.deposit_ixs(&h, &s.player_b, s.vault_b, s.nft_mint_b, 500, 8, &oracle), &s.player_b, &[&s.player_b]);

    let p = h.pack(&s.pack_pda);
    assert_eq!(p.phase, battle_arena::pack_state::PackPhase::Ready);

    // Winner is A → both cards to A's accounts.
    h.send(&[s.settle_direct_ix(&h, s.dest_a_for_a, s.dest_b_for_a)], &s.payer, &[&s.payer]);

    assert_eq!(h.token_amount(&s.dest_a_for_a), 1); // card A to A
    assert_eq!(h.token_amount(&s.dest_b_for_a), 1); // card B to A
    assert_eq!(h.token_amount(&s.vault_a), 0);
    assert_eq!(h.token_amount(&s.vault_b), 0);
    let p = h.pack(&s.pack_pda);
    assert_eq!(p.phase, battle_arena::pack_state::PackPhase::Settled);
    assert_eq!(p.winner, Some(0));
}
```

- [ ] **Step 3: Run it — expect PASS (after build)**
Run: `cd onchain && cargo build-sbf && cargo test --test pack_battle direct_higher_value -- --nocapture 2>&1 | tail -20`
Expected: PASS. If `accounts::`/`instruction::` names differ, fix the harness references and re-run.

- [ ] **Step 4: Add the draw test (equal value + grade → each reclaims own card)**
Append to `tests/pack_battle.rs`:
```rust
#[test]
fn direct_true_tie_refunds_each_card() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);
    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);
    let oracle = h.oracle.clone();
    h.send(&s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 700, 9, &oracle), &s.player_a, &[&s.player_a]);
    h.send(&s.deposit_ixs(&h, &s.player_b, s.vault_b, s.nft_mint_b, 700, 9, &oracle), &s.player_b, &[&s.player_b]);
    // Draw → card A back to A, card B back to B.
    h.send(&[s.settle_direct_ix(&h, s.dest_a_for_a, s.dest_b_for_b)], &s.payer, &[&s.payer]);
    assert_eq!(h.token_amount(&s.dest_a_for_a), 1);
    assert_eq!(h.token_amount(&s.dest_b_for_b), 1);
    let p = h.pack(&s.pack_pda);
    assert!(p.is_draw);
    assert_eq!(p.winner, None);
}
```

- [ ] **Step 5: Add the grade-tiebreak test (equal value, higher grade wins)**
```rust
#[test]
fn direct_equal_value_grade_breaks_tie() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);
    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);
    let oracle = h.oracle.clone();
    h.send(&s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 700, 7, &oracle), &s.player_a, &[&s.player_a]);
    h.send(&s.deposit_ixs(&h, &s.player_b, s.vault_b, s.nft_mint_b, 700, 10, &oracle), &s.player_b, &[&s.player_b]);
    // B has higher grade → both to B.
    h.send(&[s.settle_direct_ix(&h, s.dest_a_for_b, s.dest_b_for_b)], &s.payer, &[&s.payer]);
    assert_eq!(h.token_amount(&s.dest_a_for_b), 1);
    assert_eq!(h.token_amount(&s.dest_b_for_b), 1);
    assert_eq!(h.pack(&s.pack_pda).winner, Some(1));
}
```

- [ ] **Step 6: Add rejection tests**
```rust
#[test]
fn settle_rejected_before_both_deposit() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);
    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);
    let oracle = h.oracle.clone();
    h.send(&s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 1000, 9, &oracle), &s.player_a, &[&s.player_a]);
    // Only A deposited → settle must fail with NotAllDeposited.
    let logs = h.try_send(&[s.settle_direct_ix(&h, s.dest_a_for_a, s.dest_b_for_a)], &s.payer, &[&s.payer]).unwrap_err();
    assert_error(&logs, "NotAllDeposited", err::INVALID_SETTLE_STATE + 100); // see note
}

#[test]
fn deposit_rejected_with_wrong_oracle() {
    use ed25519_dalek::SigningKey;
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);
    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);
    let evil = SigningKey::from_bytes(&[9u8; 32]); // not the battle's oracle
    let ixs = s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 1000, 9, &evil);
    let logs = h.try_send(&ixs, &s.player_a, &[&s.player_a]).unwrap_err();
    assert_error(&logs, "BadOracleSig", err::BAD_ORACLE_SIG);
}

#[test]
fn timeout_lets_depositor_reclaim_when_opponent_never_deposits() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);
    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);
    let oracle = h.oracle.clone();
    h.send(&s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 1000, 9, &oracle), &s.player_a, &[&s.player_a]);
    // B never deposits; advance past deadline.
    let deadline = h.pack(&s.pack_pda).deadline_join;
    h.advance_clock_past(deadline);
    h.send(&[s.claim_timeout_ix(&h, s.vault_a, s.dest_a_for_a)], &s.payer, &[&s.payer]);
    assert_eq!(h.token_amount(&s.dest_a_for_a), 1);
}
```

> NOTE on the `assert_error` code for `NotAllDeposited`: the exact custom error number depends on where the new variants were appended in `ErrorCode` (Task 1). When implementing, read the final `error.rs` order and use the correct `6000+idx` constant (add it to the `err` module in `tests/common/mod.rs`). The `assert_error` helper also matches by name (`"NotAllDeposited"`), so the name check will pass regardless; set the numeric arg to the real value.

- [ ] **Step 7: Run the full pack test file**
Run: `cd onchain && cargo build-sbf && cargo test --test pack_battle 2>&1 | tail -25`
Expected: all pack tests PASS.

- [ ] **Step 8: Run the WHOLE on-chain suite (no regressions to Mana Duel)**
Run: `cd onchain && cargo test 2>&1 | tail -25`
Expected: existing Mana-Duel tests + new pack tests all PASS.

- [ ] **Step 9: Commit**
```bash
git add onchain/programs/battle_arena/tests/pack_battle.rs onchain/programs/battle_arena/tests/common/mod.rs
git commit -m "test(onchain): Pack Battle Directo — happy path, empate, desempate por grade, rechazos y timeout"
```

---

## Self-review checklist (run after all tasks)
- `cd onchain && cargo build-sbf` clean; `cargo test` fully green (Mana Duel + Pack Battle).
- No changes to existing `Battle`/Mana-Duel instructions (Pack Battle is additive).
- PDA seeds use the `pack` prefix everywhere (state, all 5 instructions, harness).
- Oracle attestation reused unchanged (81-byte `attestation_msg` bound to the `pack` PDA key).
- `settle_direct` only runs in `PackPhase::Ready` and is terminal (`Settled`), preventing double-settle.
- Vault constraints (`owner == pack`, `mint`, `amount == 1`) guard every transfer.

## What this phase deliberately defers
- Backend `GachaProvider` (real + mock), lobby, battle↔memo↔mint registry → Phase 2.
- Frontend Pack Battle flow → Phase 3.
- Duelo de maña settle (reuse Blotto engine) → Phase 4.
- Real CC gacha wiring + the `altRecipient`→PDA validation checklist → Phase 5.
