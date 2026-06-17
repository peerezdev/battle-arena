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
