use anchor_lang::prelude::*;

/// Ventana (segundos) para que el oponente se una/deposite antes de poder reclamar.
pub const PACK_JOIN_WINDOW: i64 = 600;

/// Modo de resolución del duelo de packs.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PackMode {
    /// Mayor insured_value se lleva ambas cartas.
    Direct,
    /// Reservado para Fase 4 (Duelo de maña / Blotto).
    Mana,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum PackPhase {
    Open,       // A creó el duelo; falta que B se una
    Joined,     // B se unió; faltan depósitos
    Ready,      // ambas cartas en escrow; se puede settle
    Settled,    // transferidas al ganador; terminal
}

#[account]
pub struct PackBattle {
    pub player_a: Pubkey,
    pub player_b: Pubkey,
    pub oracle: Pubkey,
    pub mode: PackMode,
    pub nft_mint_a: Pubkey,
    pub nft_mint_b: Pubkey,
    pub vault_a: Pubkey,
    pub vault_b: Pubkey,
    pub value_usd_a: u64,
    pub value_usd_b: u64,
    pub grade_a: u8,
    pub grade_b: u8,
    pub deposited_a: bool,
    pub deposited_b: bool,
    pub phase: PackPhase,
    pub winner: Option<u8>, // 0 = A, 1 = B
    pub is_draw: bool,
    pub deadline_join: i64,
    pub nonce: u64,
    pub bump: u8,
}

impl PackBattle {
    pub const SPACE: usize = 8        // discriminator
        + 32 * 3                      // player_a, player_b, oracle
        + 2                           // mode (enum, holgado)
        + 32 * 2                      // nft_mint_a, nft_mint_b
        + 32 * 2                      // vault_a, vault_b
        + 8 * 2                       // value_usd_a, value_usd_b
        + 1 * 2                       // grade_a, grade_b
        + 1 * 2                       // deposited_a, deposited_b
        + 2                           // phase (enum, holgado)
        + (1 + 1)                     // winner (Option<u8>)
        + 1                           // is_draw
        + 8                           // deadline_join
        + 8                           // nonce
        + 1                           // bump
        + 32;                         // colchón
}
