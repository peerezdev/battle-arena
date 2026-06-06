use anchor_lang::prelude::*;

/// Ventanas de tiempo (segundos) para fases commit/reveal y frescura de oráculo.
pub const COMMIT_WINDOW: i64 = 300;
pub const REVEAL_WINDOW: i64 = 300;
pub const STALE_SECS: i64 = 300;

/// Reparto de energía entre los tres frentes de una ronda.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct Allocation {
    pub apertura: u32,
    pub choque: u32,
    pub remate: u32,
}

impl Allocation {
    pub fn total(&self) -> u32 {
        self.apertura
            .saturating_add(self.choque)
            .saturating_add(self.remate)
    }
}

/// Fase actual de la batalla.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Created,
    Committing,
    Revealing,
    RoundResolved,
    Settled,
    Closed,
}

/// Parámetros de configuración del match.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct MatchConfig {
    pub rounds_to_win: u8,
    pub base_energy: u32,
    pub max_edge: u8,
    pub value_ratio_cap: u8,
    pub max_rounds: u8,
    pub rake_bps: u16,
    pub edge_enabled: bool,
}

/// Cuenta principal de una batalla.
#[account]
pub struct Battle {
    pub player_a: Pubkey,
    pub player_b: Pubkey,
    pub nft_mint_a: Pubkey,
    pub nft_mint_b: Pubkey,
    pub value_usd_a: u64,
    pub value_usd_b: u64,
    pub grade_a: u8,
    pub grade_b: u8,
    pub oracle: Pubkey,
    pub treasury: Pubkey,
    pub stake_mint: Pubkey,
    pub stake: u64,
    pub cfg: MatchConfig,
    pub edge_a: u8,
    pub edge_b: u8,
    pub banked_a: u32,
    pub banked_b: u32,
    pub wins_a: u8,
    pub wins_b: u8,
    pub round: u8,
    pub phase: Phase,
    pub commit_a: [u8; 32],
    pub commit_b: [u8; 32],
    pub reveal_a: Option<Allocation>,
    pub reveal_b: Option<Allocation>,
    pub deadline_commit: i64,
    pub deadline_reveal: i64,
    pub winner: Option<u8>,
    pub is_draw: bool,
    pub nonce: u64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Battle {
    /// Tamaño generoso (sobreestimado) en bytes, incluyendo el discriminador de 8 bytes.
    pub const SPACE: usize = 8        // discriminator
        + 32 * 7                      // player_a, player_b, nft_mint_a, nft_mint_b, oracle, treasury, stake_mint
        + 8 * 2                       // value_usd_a, value_usd_b
        + 1 * 2                       // grade_a, grade_b
        + 8                           // stake
        + 16                          // cfg (MatchConfig, holgado)
        + 1 * 2                       // edge_a, edge_b
        + 4 * 2                       // banked_a, banked_b
        + 1 * 2                       // wins_a, wins_b
        + 1                           // round
        + 2                           // phase (enum, holgado)
        + 32 * 2                      // commit_a, commit_b
        + (1 + 12) * 2                // reveal_a, reveal_b (Option<Allocation>)
        + 8 * 2                       // deadline_commit, deadline_reveal
        + (1 + 1)                     // winner (Option<u8>)
        + 1                           // is_draw
        + 8                           // nonce
        + 1                           // bump
        + 1                           // vault_bump
        + 64; // colchón extra
}
