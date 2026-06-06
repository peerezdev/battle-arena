use anchor_lang::prelude::*;

use crate::error::ErrorCode;
use crate::hashing::commit_hash;
use crate::state::*;

#[derive(Accounts)]
pub struct RevealMove<'info> {
    pub player: Signer<'info>,
    #[account(
        mut,
        seeds = [b"battle", battle.player_a.as_ref(), &battle.nonce.to_le_bytes()],
        bump = battle.bump
    )]
    pub battle: Account<'info, Battle>,
}

/// Energía disponible esta ronda para el jugador: banco + base + edge.
fn available(b: &Battle, is_a: bool) -> u32 {
    let banked = if is_a { b.banked_a } else { b.banked_b };
    let edge = if is_a { b.edge_a } else { b.edge_b } as u32;
    banked
        .saturating_add(b.cfg.base_energy)
        .saturating_add(edge)
}

pub fn handler(ctx: Context<RevealMove>, alloc: Allocation, salt: String) -> Result<()> {
    let b = &mut ctx.accounts.battle;
    require!(b.phase == Phase::Revealing, ErrorCode::WrongPhase);
    let key = ctx.accounts.player.key();
    let is_a = key == b.player_a;
    require!(is_a || key == b.player_b, ErrorCode::WrongPhase);

    require!(alloc.total() <= available(b, is_a), ErrorCode::OverAllocated);

    let expected = if is_a { b.commit_a } else { b.commit_b };
    require!(commit_hash(&alloc, &salt) == expected, ErrorCode::CommitMismatch);

    if is_a {
        b.reveal_a = Some(alloc);
    } else {
        b.reveal_b = Some(alloc);
    }
    Ok(())
}
