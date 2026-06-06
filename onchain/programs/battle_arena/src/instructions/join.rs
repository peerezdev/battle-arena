use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::edge::compute_edge;
use crate::error::ErrorCode;
use crate::oracle::{attestation_msg, verify_oracle_ed25519};
use crate::state::*;

#[derive(Accounts)]
pub struct JoinBattle<'info> {
    #[account(mut)]
    pub player_b: Signer<'info>,
    #[account(
        mut,
        seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()],
        bump = battle.bump
    )]
    pub battle: Account<'info, Battle>,
    #[account(
        mut,
        seeds = [b"vault", battle.key().as_ref()],
        bump = battle.vault_bump
    )]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = player_b_token.owner == player_b.key() @ ErrorCode::NftNotOwned,
        constraint = player_b_token.mint == battle.stake_mint
    )]
    pub player_b_token: Box<Account<'info, TokenAccount>>,
    /// NFT del jugador B: token account con amount >= 1 del mint nft_mint_b.
    #[account(constraint = nft_token_b.owner == player_b.key() @ ErrorCode::NftNotOwned)]
    pub nft_token_b: Box<Account<'info, TokenAccount>>,
    /// CHECK: validado por `address` y leído por introspección en `verify_oracle_ed25519`.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: UncheckedAccount<'info>,
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
    require!(
        ctx.accounts.battle.phase == Phase::Created,
        ErrorCode::WrongPhase
    );

    require!(
        ctx.accounts.nft_token_b.mint == nft_mint_b,
        ErrorCode::NftNotOwned
    );
    require!(ctx.accounts.nft_token_b.amount >= 1, ErrorCode::NftNotOwned);

    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ts_b && now - ts_b <= STALE_SECS,
        ErrorCode::StaleAttestation
    );

    let oracle = ctx.accounts.battle.oracle;
    let msg = attestation_msg(&nft_mint_b, value_usd_b, grade_b, ts_b);
    verify_oracle_ed25519(
        &ctx.accounts.instructions_sysvar.to_account_info(),
        ed25519_ix_index,
        &oracle,
        &msg,
    )?;

    let value_usd_a = ctx.accounts.battle.value_usd_a;
    require!(
        value_usd_b > 0 && value_usd_a > 0,
        ErrorCode::NonPositiveValue
    );

    // Cap de ratio (ranked): value_ratio_cap == 0 => sin cap.
    let cfg = ctx.accounts.battle.cfg;
    let (hi, lo) = if value_usd_a >= value_usd_b {
        (value_usd_a, value_usd_b)
    } else {
        (value_usd_b, value_usd_a)
    };
    if cfg.value_ratio_cap > 0 {
        require!(
            hi <= lo.saturating_mul(cfg.value_ratio_cap as u64),
            ErrorCode::RatioCapExceeded
        );
    }

    // Edge al jugador de mayor valor.
    let edge = compute_edge(hi, lo, cfg.max_edge, cfg.edge_enabled);

    let stake = ctx.accounts.battle.stake;
    // Depósito de B en el vault.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.player_b_token.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
                authority: ctx.accounts.player_b.to_account_info(),
            },
        ),
        stake,
    )?;

    let b = &mut ctx.accounts.battle;
    if value_usd_a >= value_usd_b {
        b.edge_a = edge;
        b.edge_b = 0;
    } else {
        b.edge_b = edge;
        b.edge_a = 0;
    }
    b.player_b = ctx.accounts.player_b.key();
    b.nft_mint_b = nft_mint_b;
    b.value_usd_b = value_usd_b;
    b.grade_b = grade_b;
    b.phase = Phase::Committing;
    b.deadline_commit = now + COMMIT_WINDOW;
    Ok(())
}
