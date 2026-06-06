use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct ClaimTimeout<'info> {
    #[account(
        mut,
        seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()],
        bump = battle.bump
    )]
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
            if a && !bb {
                b.winner = Some(0);
            } else if bb && !a {
                b.winner = Some(1);
            } else {
                // Ninguno (o ambos, que pasaría a Revealing): empate.
                b.is_draw = true;
            }
            b.phase = Phase::Settled;
        }
        Phase::Revealing => {
            require!(now > b.deadline_reveal, ErrorCode::DeadlineNotReached);
            let a = b.reveal_a.is_some();
            let bb = b.reveal_b.is_some();
            if a && !bb {
                b.winner = Some(0);
            } else if bb && !a {
                b.winner = Some(1);
            } else {
                b.is_draw = true;
            }
            b.phase = Phase::Settled;
        }
        _ => return err!(ErrorCode::WrongPhase),
    }
    Ok(())
}
