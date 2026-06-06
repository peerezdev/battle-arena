use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct Settle<'info> {
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
    pub escrow_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = player_a_token.owner == battle.player_a,
        constraint = player_a_token.mint == battle.stake_mint
    )]
    pub player_a_token: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = player_b_token.owner == battle.player_b,
        constraint = player_b_token.mint == battle.stake_mint
    )]
    pub player_b_token: Box<Account<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = treasury.key() == battle.treasury,
        constraint = treasury.mint == battle.stake_mint
    )]
    pub treasury: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<Settle>) -> Result<()> {
    let b = &ctx.accounts.battle;
    require!(b.phase == Phase::Settled, ErrorCode::WrongPhase);
    let pot = b.stake.checked_mul(2).ok_or(error!(ErrorCode::MathOverflow))?;

    // La autoridad del vault es la PDA `battle`. Firmamos las salidas con sus seeds.
    let player_a = b.player_a;
    let nonce_le = b.nonce.to_le_bytes();
    let bump = b.bump;
    let seeds: &[&[u8]] = &[b"battle", player_a.as_ref(), &nonce_le, &[bump]];
    let signer: &[&[&[u8]]] = &[seeds];

    if b.is_draw {
        // Reembolsar el stake a cada jugador en sus token accounts vinculadas on-chain.
        let stake = b.stake;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.player_a_token.to_account_info(),
                    authority: ctx.accounts.battle.to_account_info(),
                },
                signer,
            ),
            stake,
        )?;
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: ctx.accounts.player_b_token.to_account_info(),
                    authority: ctx.accounts.battle.to_account_info(),
                },
                signer,
            ),
            stake,
        )?;
    } else {
        let rake = pot
            .checked_mul(b.cfg.rake_bps as u64)
            .ok_or(error!(ErrorCode::MathOverflow))?
            / 10_000;
        let payout = pot.checked_sub(rake).ok_or(error!(ErrorCode::MathOverflow))?;

        // El ganador se determina por `battle.winner`, no por convención del cliente.
        let winner_token = if b.winner == Some(0) {
            ctx.accounts.player_a_token.to_account_info()
        } else {
            ctx.accounts.player_b_token.to_account_info()
        };

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                Transfer {
                    from: ctx.accounts.escrow_vault.to_account_info(),
                    to: winner_token,
                    authority: ctx.accounts.battle.to_account_info(),
                },
                signer,
            ),
            payout,
        )?;
        if rake > 0 {
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    Transfer {
                        from: ctx.accounts.escrow_vault.to_account_info(),
                        to: ctx.accounts.treasury.to_account_info(),
                        authority: ctx.accounts.battle.to_account_info(),
                    },
                    signer,
                ),
                rake,
            )?;
        }
    }

    // Fase terminal: previene un segundo settle (anti-replay).
    let b = &mut ctx.accounts.battle;
    b.phase = Phase::Closed;
    Ok(())
}
