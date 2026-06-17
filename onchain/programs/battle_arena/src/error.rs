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
    #[msg("Configuracion de match invalida (rounds_to_win, base_energy o max_rounds)")]
    InvalidConfig,
    #[msg("Estado de settle invalido: la batalla debe tener ganador o empate")]
    InvalidSettleState,
    #[msg("El commit no puede ser todo ceros")]
    InvalidCommit,
    #[msg("La cuenta de tokens de stake no pertenece al jugador")]
    UnauthorizedTokenAccount,
    #[msg("El oponente todavía no se ha unido al duelo.")]
    OpponentNotJoined,
    #[msg("Este lado ya depositó su carta.")]
    AlreadyDeposited,
    #[msg("Faltan cartas por depositar en el escrow.")]
    NotAllDeposited,
    #[msg("La cuenta de vault no es del PDA o no contiene la carta esperada.")]
    BadVault,
    #[msg("El oponente ya se unió al duelo.")]
    AlreadyJoined,
    #[msg("No puedes unirte a tu propio duelo.")]
    SelfJoinNotAllowed,
}
