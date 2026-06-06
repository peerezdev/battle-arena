use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Operacion no permitida en la fase actual")]
    WrongPhase,
    #[msg("Atestacion del oraculo obsoleta")]
    StaleAttestation,
    #[msg("Firma del oraculo invalida")]
    BadOracleSig,
    #[msg("El NFT no pertenece al jugador")]
    NftNotOwned,
    #[msg("Se excedio el limite de ratio de valor")]
    RatioCapExceeded,
    #[msg("El valor debe ser positivo")]
    NonPositiveValue,
    #[msg("El reveal no coincide con el commit")]
    CommitMismatch,
    #[msg("Se asigno mas energia de la disponible")]
    OverAllocated,
    #[msg("El jugador ya hizo commit")]
    AlreadyCommitted,
    #[msg("Faltan reveals para resolver la ronda")]
    MissingReveals,
    #[msg("Aun no se alcanzo el deadline")]
    DeadlineNotReached,
    #[msg("Overflow aritmetico")]
    MathOverflow,
    #[msg("rake_bps excede el máximo permitido")]
    RakeTooHigh,
}
