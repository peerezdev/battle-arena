use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::state::*;

#[derive(Accounts)]
pub struct CommitMove<'info> {
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()],
        bump = battle.bump
    )]
    pub battle: Account<'info, Battle>,
}

pub fn handler(ctx: Context<CommitMove>, commit: [u8; 32]) -> Result<()> {
    require!(commit != [0u8; 32], ErrorCode::InvalidCommit);
    let b = &mut ctx.accounts.battle;
    require!(b.phase == Phase::Committing, ErrorCode::WrongPhase);
    let now = Clock::get()?.unix_timestamp;
    require!(now <= b.deadline_commit, ErrorCode::WrongPhase);

    let key = ctx.accounts.player.key();
    if key == b.player_a {
        require!(b.commit_a == [0u8; 32], ErrorCode::AlreadyCommitted);
        b.commit_a = commit;
    } else if key == b.player_b {
        require!(b.commit_b == [0u8; 32], ErrorCode::AlreadyCommitted);
        b.commit_b = commit;
    } else {
        return err!(ErrorCode::WrongPhase);
    }

    if b.commit_a != [0u8; 32] && b.commit_b != [0u8; 32] {
        b.phase = Phase::Revealing;
        b.deadline_reveal = now + REVEAL_WINDOW;
    }
    Ok(())
}
