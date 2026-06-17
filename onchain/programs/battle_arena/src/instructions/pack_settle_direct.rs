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
    #[account(mut,
        constraint = vault_a.key() == pack.vault_a @ ErrorCode::BadVault,
        constraint = vault_a.amount == 1 @ ErrorCode::BadVault)]
    pub vault_a: Box<Account<'info, TokenAccount>>,
    #[account(mut,
        constraint = vault_b.key() == pack.vault_b @ ErrorCode::BadVault,
        constraint = vault_b.amount == 1 @ ErrorCode::BadVault)]
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

    // Ganador por valor; desempate por grade; empate real => reembolso.
    let (winner, is_draw) = {
        let p = &ctx.accounts.pack;
        if p.value_usd_a > p.value_usd_b { (Some(0u8), false) }
        else if p.value_usd_b > p.value_usd_a { (Some(1u8), false) }
        else if p.grade_a > p.grade_b { (Some(0u8), false) }
        else if p.grade_b > p.grade_a { (Some(1u8), false) }
        else { (None, true) }
    };

    // Receptor de cada carta: empate => a su dueño; gana 0 => ambas a A; gana 1 => ambas a B.
    let (recv_a, recv_b): (Pubkey, Pubkey) = if is_draw {
        (ctx.accounts.pack.player_a, ctx.accounts.pack.player_b)
    } else if winner == Some(0) {
        (ctx.accounts.pack.player_a, ctx.accounts.pack.player_a)
    } else {
        (ctx.accounts.pack.player_b, ctx.accounts.pack.player_b)
    };
    require!(ctx.accounts.dest_a.owner == recv_a, ErrorCode::UnauthorizedTokenAccount);
    require!(ctx.accounts.dest_b.owner == recv_b, ErrorCode::UnauthorizedTokenAccount);

    // Firmar las salidas con las seeds del PDA `pack`.
    let player_a = ctx.accounts.pack.player_a;
    let nonce_le = ctx.accounts.pack.nonce.to_le_bytes();
    let bump = ctx.accounts.pack.bump;
    let seeds: &[&[u8]] = &[b"pack", player_a.as_ref(), &nonce_le, &[bump]];
    let signer: &[&[&[u8]]] = &[seeds];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
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
            ctx.accounts.token_program.key(),
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
