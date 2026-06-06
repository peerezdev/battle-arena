pub mod constants;
pub mod edge;
pub mod error;
pub mod hashing;
pub mod instructions;
pub mod oracle;
pub mod rules;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk");

#[program]
pub mod battle_arena {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    pub fn initialize_battle(
        ctx: Context<InitializeBattle>,
        nonce: u64,
        stake: u64,
        cfg: MatchConfig,
        oracle: Pubkey,
        treasury: Pubkey,
        nft_mint_a: Pubkey,
        value_usd_a: u64,
        grade_a: u8,
        ts_a: i64,
        ed25519_ix_index: u8,
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            nonce,
            stake,
            cfg,
            oracle,
            treasury,
            nft_mint_a,
            value_usd_a,
            grade_a,
            ts_a,
            ed25519_ix_index,
        )
    }

    pub fn join_battle(
        ctx: Context<JoinBattle>,
        nft_mint_b: Pubkey,
        value_usd_b: u64,
        grade_b: u8,
        ts_b: i64,
        ed25519_ix_index: u8,
    ) -> Result<()> {
        instructions::join::handler(ctx, nft_mint_b, value_usd_b, grade_b, ts_b, ed25519_ix_index)
    }

    pub fn commit(ctx: Context<CommitMove>, commit: [u8; 32]) -> Result<()> {
        instructions::commit::handler(ctx, commit)
    }

    pub fn reveal(ctx: Context<RevealMove>, alloc: Allocation, salt: String) -> Result<()> {
        instructions::reveal::handler(ctx, alloc, salt)
    }

    pub fn resolve_round(ctx: Context<ResolveRound>) -> Result<()> {
        instructions::resolve::handler(ctx)
    }

    pub fn settle(ctx: Context<Settle>) -> Result<()> {
        instructions::settle::handler(ctx)
    }

    pub fn claim_timeout(ctx: Context<ClaimTimeout>) -> Result<()> {
        instructions::timeout::handler(ctx)
    }
}
