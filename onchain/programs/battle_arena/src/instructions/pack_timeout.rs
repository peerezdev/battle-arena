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
    /// El vault del jugador que reclama (debe ser el vault almacenado de su lado y tener su carta).
    #[account(mut, constraint = vault.amount == 1 @ ErrorCode::BadVault)]
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
        // No se puede reclamar si ya hay ambas cartas (Ready) o si ya se liquidó (Settled).
        require!(p.phase != PackPhase::Ready && p.phase != PackPhase::Settled, ErrorCode::WrongPhase);
        require!(now > p.deadline_join, ErrorCode::DeadlineNotReached);

        // Solo el lado que depositó puede reclamar su propia carta: el vault pasado
        // debe ser EXACTAMENTE el vault almacenado de un lado que sí depositó.
        let vk = ctx.accounts.vault.key();
        let claimant_is_a = p.deposited_a && vk == p.vault_a;
        let claimant_is_b = p.deposited_b && vk == p.vault_b;
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
            ctx.accounts.token_program.key(),
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
