pub mod commit;
pub mod initialize;
pub mod join;
pub mod pack_create;
pub mod pack_deposit;
pub mod pack_join;
pub mod pack_settle_direct;
pub mod resolve;
pub mod reveal;
pub mod settle;
pub mod timeout;

// Re-export the `#[derive(Accounts)]` context structs so that `lib.rs`'s
// `#[program]` fn signatures can reference them via `use super::*`.
pub use commit::CommitMove;
pub use initialize::InitializeBattle;
pub use join::JoinBattle;
pub use pack_create::CreatePackBattle;
pub use pack_deposit::DepositCard;
pub use pack_join::JoinPackBattle;
pub use pack_settle_direct::SettleDirect;
pub use resolve::ResolveRound;
pub use reveal::RevealMove;
pub use settle::Settle;
pub use timeout::ClaimTimeout;

// Re-export Anchor-generated client account modules (pub(crate)) so that the
// `#[program]` macro expansion can resolve them at the crate root.
pub(crate) use commit::__client_accounts_commit_move;
pub(crate) use initialize::__client_accounts_initialize_battle;
pub(crate) use join::__client_accounts_join_battle;
pub(crate) use pack_create::__client_accounts_create_pack_battle;
pub(crate) use pack_deposit::__client_accounts_deposit_card;
pub(crate) use pack_join::__client_accounts_join_pack_battle;
pub(crate) use pack_settle_direct::__client_accounts_settle_direct;
pub(crate) use resolve::__client_accounts_resolve_round;
pub(crate) use reveal::__client_accounts_reveal_move;
pub(crate) use settle::__client_accounts_settle;
pub(crate) use timeout::__client_accounts_claim_timeout;
