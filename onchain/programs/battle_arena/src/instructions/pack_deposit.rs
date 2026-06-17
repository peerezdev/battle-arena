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

    // Frescura + firma del oráculo (formato 81 bytes ligado a esta batalla).
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
        if p.deposited_b {
            require!(ctx.accounts.vault.key() != p.vault_b, ErrorCode::BadVault);
        }
        p.vault_a = ctx.accounts.vault.key();
        p.nft_mint_a = nft_mint;
        p.value_usd_a = value_usd;
        p.grade_a = grade;
        p.deposited_a = true;
    } else if depositor == p.player_b {
        require!(!p.deposited_b, ErrorCode::AlreadyDeposited);
        if p.deposited_a {
            require!(ctx.accounts.vault.key() != p.vault_a, ErrorCode::BadVault);
        }
        p.vault_b = ctx.accounts.vault.key();
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
