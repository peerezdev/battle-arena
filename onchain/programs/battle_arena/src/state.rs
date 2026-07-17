use anchor_lang::prelude::*;

/// Ventanas de tiempo (segundos) para fases commit/reveal y frescura de oráculo.
pub const COMMIT_WINDOW: i64 = 300;
pub const REVEAL_WINDOW: i64 = 300;
pub const STALE_SECS: i64 = 300;

/// Máximo rake permitido on-chain (5 %).
pub const MAX_RAKE_BPS: u16 = 500;

/// Oráculo de precios DE CONFIANZA. Solo las atestaciones firmadas por ESTA clave
/// pueden fijar `value_usd`/`grade` on-chain. Antes, el oráculo se aceptaba como
/// argumento del creador de la batalla y solo se guardaba (sin validar), lo que
/// permitía a un atacante firmar su propia atestación inflada con un keypair propio
/// y ganar siempre llevándose el NFT del rival. Aquí lo fijamos: cada instrucción que
/// acepta una atestación exige que el oráculo coincida con `TRUSTED_ORACLE`.
///
/// Por defecto (build de producción / despliegue) es la clave real del servicio
/// `oracle/` y DEBE coincidir con `VITE_ORACLE_PUBKEY` del frontend. Rotar el oráculo
/// requiere actualizar esta constante y redeplegar el programa.
///
/// Bajo la feature `test-oracle` (solo para los tests de integración LiteSVM) se usa
/// la clave derivada del seed `[7u8; 32]` que el harness emplea para firmar, de modo
/// que `cargo test` pueda ejercitar el camino feliz sin conocer el secreto de producción.
/// La feature NUNCA debe activarse en un build de despliegue.
#[cfg(not(feature = "test-oracle"))]
pub const TRUSTED_ORACLE: Pubkey = Pubkey::new_from_array([
    71, 23, 61, 152, 212, 66, 197, 157, 177, 162, 49, 229, 243, 10, 211, 177,
    220, 182, 116, 187, 4, 109, 59, 146, 82, 41, 254, 169, 38, 193, 168, 118,
]); // 5nWW3DELE8nMpPK9yyC3GECkCfArQJ6k2iormwVx4sLy

/// Oráculo de prueba: clave pública del seed Ed25519 `[7u8; 32]` que usa el harness
/// de integración (`tests/common/mod.rs`). Solo activa bajo la feature `test-oracle`.
#[cfg(feature = "test-oracle")]
pub const TRUSTED_ORACLE: Pubkey = Pubkey::new_from_array([
    234, 74, 108, 99, 226, 156, 82, 10, 190, 245, 80, 123, 19, 46, 197, 249,
    149, 71, 118, 174, 190, 190, 123, 146, 66, 30, 234, 105, 20, 70, 210, 44,
]); // GmaDrppBC7P5ARKV8g3djiwP89vz1jLK23V2GBjuAEGB

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
