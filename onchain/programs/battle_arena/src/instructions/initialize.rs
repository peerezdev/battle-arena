use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;

use crate::error::ErrorCode;
use crate::oracle::{attestation_msg, verify_oracle_ed25519};
use crate::state::*;

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
    pub stake_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = player_a,
        seeds = [b"vault", battle.key().as_ref()],
        bump,
        token::mint = stake_mint,
        token::authority = battle,
    )]
    pub escrow_vault: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = player_a_token.owner == player_a.key() @ ErrorCode::NftNotOwned,
        constraint = player_a_token.mint == stake_mint.key()
    )]
    pub player_a_token: Box<Account<'info, TokenAccount>>,
    /// NFT del jugador A: token account con amount >= 1 del mint nft_mint_a.
    #[account(constraint = nft_token_a.owner == player_a.key() @ ErrorCode::NftNotOwned)]
    pub nft_token_a: Box<Account<'info, TokenAccount>>,
    /// CHECK: validado por `address` y leído por introspección en `verify_oracle_ed25519`.
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
    // Posesión de NFT: el token account debe ser del mint declarado y con saldo.
    require!(
        ctx.accounts.nft_token_a.mint == nft_mint_a,
        ErrorCode::NftNotOwned
    );
    require!(ctx.accounts.nft_token_a.amount >= 1, ErrorCode::NftNotOwned);

    // Frescura de la atestación.
    let now = Clock::get()?.unix_timestamp;
    require!(
        now >= ts_a && now - ts_a <= STALE_SECS,
        ErrorCode::StaleAttestation
    );

    // Verificación de la firma del oráculo por introspección.
    let msg = attestation_msg(&nft_mint_a, value_usd_a, grade_a, ts_a);
    verify_oracle_ed25519(
        &ctx.accounts.instructions_sysvar,
        ed25519_ix_index,
        &oracle,
        &msg,
    )?;

    require!(value_usd_a > 0, ErrorCode::NonPositiveValue);

    // Depósito de A en el vault de escrow.
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.key(),
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
    b.player_b = Pubkey::default();
    b.nft_mint_a = nft_mint_a;
    b.nft_mint_b = Pubkey::default();
    b.value_usd_a = value_usd_a;
    b.value_usd_b = 0;
    b.grade_a = grade_a;
    b.grade_b = 0;
    b.oracle = oracle;
    b.stake_mint = ctx.accounts.stake_mint.key();
    b.stake = stake;
    b.cfg = cfg;
    b.edge_a = 0;
    b.edge_b = 0;
    b.banked_a = 0;
    b.banked_b = 0;
    b.wins_a = 0;
    b.wins_b = 0;
    b.round = 0;
    b.phase = Phase::Created;
    b.commit_a = [0u8; 32];
    b.commit_b = [0u8; 32];
    b.reveal_a = None;
    b.reveal_b = None;
    b.deadline_commit = 0;
    b.deadline_reveal = 0;
    b.winner = None;
    b.is_draw = false;
    b.nonce = nonce;
    b.bump = ctx.bumps.battle;
    b.vault_bump = ctx.bumps.escrow_vault;
    Ok(())
}
