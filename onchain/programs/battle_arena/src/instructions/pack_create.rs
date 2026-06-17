use anchor_lang::prelude::*;

use crate::pack_state::*;

#[derive(Accounts)]
#[instruction(nonce: u64)]
pub struct CreatePackBattle<'info> {
    #[account(mut)]
    pub player_a: Signer<'info>,
    #[account(
        init,
        payer = player_a,
        space = PackBattle::SPACE,
        seeds = [b"pack", player_a.key().as_ref(), &nonce.to_le_bytes()],
        bump
    )]
    pub pack: Account<'info, PackBattle>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreatePackBattle>, nonce: u64, oracle: Pubkey, mode: PackMode) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let p = &mut ctx.accounts.pack;
    p.player_a = ctx.accounts.player_a.key();
    p.player_b = Pubkey::default();
    p.oracle = oracle;
    p.mode = mode;
    p.nft_mint_a = Pubkey::default();
    p.nft_mint_b = Pubkey::default();
    p.vault_a = Pubkey::default();
    p.vault_b = Pubkey::default();
    p.value_usd_a = 0;
    p.value_usd_b = 0;
    p.grade_a = 0;
    p.grade_b = 0;
    p.deposited_a = false;
    p.deposited_b = false;
    p.phase = PackPhase::Open;
    p.winner = None;
    p.is_draw = false;
    p.deadline_join = now + PACK_JOIN_WINDOW;
    p.nonce = nonce;
    p.bump = ctx.bumps.pack;
    Ok(())
}
