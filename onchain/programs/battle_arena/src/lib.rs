pub mod constants;
pub mod edge;
pub mod error;
pub mod hashing;
pub mod instructions;
pub mod oracle;
pub mod rules;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk");

#[program]
pub mod battle_arena {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
