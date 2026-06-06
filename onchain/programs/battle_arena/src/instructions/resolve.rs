use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::rules::{resolve_round, solidez, RoundWinner};
use crate::state::*;

#[derive(Accounts)]
pub struct ResolveRound<'info> {
    #[account(
        mut,
        seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()],
        bump = battle.bump
    )]
    pub battle: Account<'info, Battle>,
}

pub fn handler(ctx: Context<ResolveRound>) -> Result<()> {
    let b = &mut ctx.accounts.battle;
    require!(b.phase == Phase::Revealing, ErrorCode::WrongPhase);
    let ra = b.reveal_a.ok_or(error!(ErrorCode::MissingReveals))?;
    let rb = b.reveal_b.ok_or(error!(ErrorCode::MissingReveals))?;

    let sol_a = solidez(b.grade_a);
    let sol_b = solidez(b.grade_b);

    // Banking: sobrante = disponible - gastado.
    let avail_a = b
        .banked_a
        .saturating_add(b.cfg.base_energy)
        .saturating_add(b.edge_a as u32);
    let avail_b = b
        .banked_b
        .saturating_add(b.cfg.base_energy)
        .saturating_add(b.edge_b as u32);
    b.banked_a = avail_a.saturating_sub(ra.total());
    b.banked_b = avail_b.saturating_sub(rb.total());

    match resolve_round(&ra, &rb, sol_a, sol_b) {
        RoundWinner::A => b.wins_a = b.wins_a.saturating_add(1),
        RoundWinner::B => b.wins_b = b.wins_b.saturating_add(1),
        RoundWinner::Disputed => {}
    }

    let decided = b.wins_a >= b.cfg.rounds_to_win || b.wins_b >= b.cfg.rounds_to_win;
    let cap_reached = (b.round as u16 + 1) >= b.cfg.max_rounds as u16;

    if decided {
        b.winner = Some(if b.wins_a >= b.cfg.rounds_to_win { 0 } else { 1 });
        b.phase = Phase::Settled;
    } else if cap_reached {
        // Empate por cap: solo si las victorias están igualadas.
        if b.wins_a > b.wins_b {
            b.winner = Some(0);
        } else if b.wins_b > b.wins_a {
            b.winner = Some(1);
        } else {
            b.is_draw = true;
        }
        b.phase = Phase::Settled;
    } else {
        // Siguiente ronda.
        b.round = b.round.saturating_add(1);
        b.commit_a = [0u8; 32];
        b.commit_b = [0u8; 32];
        b.reveal_a = None;
        b.reveal_b = None;
        b.phase = Phase::Committing;
        b.deadline_commit = Clock::get()?.unix_timestamp + COMMIT_WINDOW;
    }
    Ok(())
}
