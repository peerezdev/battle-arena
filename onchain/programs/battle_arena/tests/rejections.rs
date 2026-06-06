//! Tests de rechazo: control de acceso y validación. Cada test afirma que la
//! transacción FALLA y, cuando es practicable, fija el error específico (por
//! nombre Anchor o por código 6000+idx) inspeccionando los logs.
//!
//! Cubre el FIX crítico de seguridad del escrow (un tercero no puede desviar el
//! pago a cuentas que no pertenecen a los jugadores / treasury) más las
//! validaciones de oráculo, NFT, ratio, commit/reveal y deadlines.
//!
//! `Harness`, builder `Match` y helpers en `tests/common/mod.rs`.

mod common;
use common::*;

use anchor_lang::{InstructionData, ToAccountMetas};
use ed25519_dalek::SigningKey;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;

use battle_arena::hashing::commit_hash;
use battle_arena::state::{Allocation, Phase};

/// Lleva un match a una victoria 2-0 de A (mismo patrón que settlement.rs).
fn drive_to_a_win(h: &mut Harness, m: &Match) {
    let alloc_a = Allocation { apertura: 5, choque: 5, remate: 0 };
    let alloc_b = Allocation { apertura: 3, choque: 3, remate: 4 };
    m.play_round(h, alloc_a, alloc_b, "r1");
    m.play_round(h, alloc_a, alloc_b, "r2");
    assert_eq!(h.battle(&m.battle_pda).phase, Phase::Settled);
    assert_eq!(h.battle(&m.battle_pda).winner, Some(0));
}

// ---- FIX crítico: robo de payout por un tercero ----------------------------

#[test]
fn stranger_payout_theft_rejected() {
    let mut h = Harness::new();
    let stake: u64 = 100;
    let m = Match::setup(&mut h, stake, 1000);
    m.init(&mut h, default_cfg(), 1000, 7);
    m.join(&mut h, 1000, 7);
    drive_to_a_win(&mut h, &m);

    // Un atacante crea una ATA del mismo mint cuyo owner NO es ningún jugador.
    let attacker = Keypair::new();
    let attacker_ata =
        h.create_token_account(&m.payer, &m.stake_mint.pubkey(), &attacker.pubkey());

    // (1) settle pasando player_a_token = ATA del atacante -> falla la constraint
    //     `player_a_token.owner == battle.player_a`. No paga al atacante.
    let theft_a = m.settle_ix_with(&h, attacker_ata.pubkey(), m.pb.stake_token, m.treasury);
    let logs = h
        .try_send(&[theft_a], &m.payer, &[&m.payer])
        .expect_err("settle con player_a_token ajeno debe fallar");
    // Constraint sin `@`: Anchor emite ConstraintRaw (code 2003).
    assert!(
        logs.join("\n").contains("ConstraintRaw") || logs.join("\n").contains("constraint"),
        "se esperaba violación de constraint de owner, logs:\n{}",
        logs.join("\n")
    );

    // (2) settle pasando treasury != battle.treasury -> falla la constraint
    //     `treasury.key() == battle.treasury`.
    h.expire_blockhash();
    let fake_treasury =
        h.create_token_account(&m.payer, &m.stake_mint.pubkey(), &attacker.pubkey());
    let theft_t = m.settle_ix_with(&h, m.pa.stake_token, m.pb.stake_token, fake_treasury.pubkey());
    let logs = h
        .try_send(&[theft_t], &m.payer, &[&m.payer])
        .expect_err("settle con treasury falso debe fallar");
    assert!(
        logs.join("\n").contains("ConstraintRaw") || logs.join("\n").contains("constraint"),
        "se esperaba violación de constraint de treasury, logs:\n{}",
        logs.join("\n")
    );

    // El dinero sigue intacto en el vault; el atacante no recibió nada.
    assert_eq!(h.token_amount(&m.vault_pda), 2 * stake, "fondos intactos");
    assert_eq!(h.token_amount(&attacker_ata.pubkey()), 0, "atacante sin pago");
    assert_eq!(h.battle(&m.battle_pda).phase, Phase::Settled, "sigue Settled");

    // Sanity: el settle legítimo SÍ funciona y paga a A.
    h.expire_blockhash();
    h.send(&[m.settle_ix(&h)], &m.payer, &[&m.payer]);
    assert_eq!(h.token_amount(&m.pa.stake_token), 1000 + stake, "A cobra al settle legítimo");
}

// ---- Validaciones de join: ratio cap ---------------------------------------

#[test]
fn ratio_cap_exceeded_rejected() {
    let mut h = Harness::new();
    let m = Match::setup(&mut h, 100, 1_000_000);
    // value_ratio_cap = 4 (default). A=1000, B=10000 -> ratio 10 > 4.
    m.init(&mut h, default_cfg(), 1000, 7);

    let oracle = h.oracle.clone();
    let ixs = m.join_ixs(&h, 10_000, 7, FIXED_NOW, &oracle);
    let logs = h
        .try_send(&ixs, &m.pb.kp, &[&m.pb.kp])
        .expect_err("ratio 10>4 debe fallar");
    assert_error(&logs, "RatioCapExceeded", err::RATIO_CAP_EXCEEDED);
}

// ---- Validaciones de NFT: no poseído --------------------------------------

#[test]
fn nft_not_owned_rejected() {
    let mut h = Harness::new();
    let m = Match::setup(&mut h, 100, 1000);

    // NFT de A con amount 0 (mint creado pero sin mint_to) -> NftNotOwned.
    let empty_nft_mint = h.create_mint(&m.payer, &m.payer.pubkey(), 0);
    let empty_nft_token =
        h.create_token_account(&m.payer, &empty_nft_mint.pubkey(), &m.pa.kp.pubkey());

    let msg_a = attestation_msg(&empty_nft_mint.pubkey(), 1000, 7, FIXED_NOW);
    let ed_a = ed25519_attest_ix(&h.oracle, &msg_a);
    let init_ix = Instruction {
        program_id: h.program_id,
        accounts: battle_arena::accounts::InitializeBattle {
            player_a: m.pa.kp.pubkey(),
            battle: m.battle_pda,
            stake_mint: m.stake_mint.pubkey(),
            escrow_vault: m.vault_pda,
            player_a_token: m.pa.stake_token,
            nft_token_a: empty_nft_token.pubkey(), // amount 0
            instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID,
            token_program: TOKEN_PROGRAM_ID,
            system_program: solana_sdk_ids::system_program::ID,
            rent: solana_sdk_ids::sysvar::rent::ID,
        }
        .to_account_metas(None),
        data: battle_arena::instruction::InitializeBattle {
            nonce: m.nonce,
            stake: m.stake,
            cfg: default_cfg(),
            oracle: h.oracle_pubkey,
            treasury: m.treasury,
            nft_mint_a: empty_nft_mint.pubkey(),
            value_usd_a: 1000,
            grade_a: 7,
            ts_a: FIXED_NOW,
            ed25519_ix_index: 0,
        }
        .data(),
    };
    let logs = h
        .try_send(&[ed_a, init_ix], &m.pa.kp, &[&m.pa.kp])
        .expect_err("NFT con amount 0 debe fallar");
    assert_error(&logs, "NftNotOwned", err::NFT_NOT_OWNED);
}

// ---- Validaciones de oráculo: atestación obsoleta -------------------------

#[test]
fn stale_attestation_rejected() {
    let mut h = Harness::new();
    let m = Match::setup(&mut h, 100, 1000);

    // ts muy en el pasado: now - ts = 10_000 > STALE_SECS (300).
    let stale_ts = FIXED_NOW - 10_000;
    let oracle = h.oracle.clone();
    let ixs = m.init_ixs(&h, default_cfg(), 1000, 7, stale_ts, &oracle);
    let logs = h
        .try_send(&ixs, &m.pa.kp, &[&m.pa.kp])
        .expect_err("atestación obsoleta debe fallar");
    assert_error(&logs, "StaleAttestation", err::STALE_ATTESTATION);
}

// ---- Validaciones de oráculo: firma de clave equivocada -------------------

#[test]
fn bad_oracle_sig_rejected() {
    let mut h = Harness::new();
    let m = Match::setup(&mut h, 100, 1000);

    // Firmamos la atestación con una clave DISTINTA del oráculo declarado.
    // El precompile Ed25519 valida la firma contra la pubkey EMBEBIDA (la del
    // impostor, así que pasa cripto), pero el programa compara esa pubkey con
    // `battle.oracle` -> BadOracleSig.
    let impostor = SigningKey::from_bytes(&[9u8; 32]);
    let ixs = m.init_ixs(&h, default_cfg(), 1000, 7, FIXED_NOW, &impostor);
    let logs = h
        .try_send(&ixs, &m.pa.kp, &[&m.pa.kp])
        .expect_err("firma de clave equivocada debe fallar");
    assert_error(&logs, "BadOracleSig", err::BAD_ORACLE_SIG);
}

// ---- Reveal: commit mismatch ----------------------------------------------

#[test]
fn commit_mismatch_rejected() {
    let mut h = Harness::new();
    let m = Match::setup(&mut h, 100, 1000);
    m.init(&mut h, default_cfg(), 1000, 7);
    m.join(&mut h, 1000, 7);

    // Ambos hacen commit (de allocs con total <= 10 para no chocar con energía).
    let alloc_a = Allocation { apertura: 5, choque: 5, remate: 0 };
    let alloc_b = Allocation { apertura: 4, choque: 3, remate: 3 };
    h.send(&[commit_ix(&h, m.battle_pda, &m.pa.kp, commit_hash(&alloc_a, "sa"))], &m.pa.kp, &[&m.pa.kp]);
    h.send(&[commit_ix(&h, m.battle_pda, &m.pb.kp, commit_hash(&alloc_b, "sb"))], &m.pb.kp, &[&m.pb.kp]);
    assert_eq!(h.battle(&m.battle_pda).phase, Phase::Revealing);

    // A revela una asignación DISTINTA (total 10, pasa la chequeo de energía)
    // pero cuyo hash != commit -> CommitMismatch.
    let wrong = Allocation { apertura: 2, choque: 4, remate: 4 };
    assert_eq!(wrong.apertura + wrong.choque + wrong.remate, 10);
    let logs = h
        .try_send(&[reveal_ix(&h, m.battle_pda, &m.pa.kp, wrong, "sa")], &m.pa.kp, &[&m.pa.kp])
        .expect_err("reveal con hash distinto debe fallar");
    assert_error(&logs, "CommitMismatch", err::COMMIT_MISMATCH);
}

// ---- Reveal: sobre-asignación de energía ----------------------------------

#[test]
fn over_allocated_rejected() {
    let mut h = Harness::new();
    let m = Match::setup(&mut h, 100, 1000);
    m.init(&mut h, default_cfg(), 1000, 7);
    m.join(&mut h, 1000, 7);

    // available ronda 1 = base_energy = 10 (sin edge, valores iguales).
    // A commitea una asignación con total 11 y luego la revela: el chequeo de
    // energía (`alloc.total() <= available`) salta ANTES que el de hash.
    let over = Allocation { apertura: 5, choque: 5, remate: 1 }; // total 11
    assert_eq!(over.apertura + over.choque + over.remate, 11);
    let alloc_b = Allocation { apertura: 3, choque: 3, remate: 3 };
    h.send(&[commit_ix(&h, m.battle_pda, &m.pa.kp, commit_hash(&over, "sa"))], &m.pa.kp, &[&m.pa.kp]);
    h.send(&[commit_ix(&h, m.battle_pda, &m.pb.kp, commit_hash(&alloc_b, "sb"))], &m.pb.kp, &[&m.pb.kp]);

    let logs = h
        .try_send(&[reveal_ix(&h, m.battle_pda, &m.pa.kp, over, "sa")], &m.pa.kp, &[&m.pa.kp])
        .expect_err("reveal con total 11 > 10 disponible debe fallar");
    assert_error(&logs, "OverAllocated", err::OVER_ALLOCATED);
}

// ---- Commit: doble commit del mismo jugador --------------------------------

#[test]
fn double_commit_rejected() {
    let mut h = Harness::new();
    let m = Match::setup(&mut h, 100, 1000);
    m.init(&mut h, default_cfg(), 1000, 7);
    m.join(&mut h, 1000, 7);

    let alloc_a = Allocation { apertura: 5, choque: 5, remate: 0 };
    h.send(&[commit_ix(&h, m.battle_pda, &m.pa.kp, commit_hash(&alloc_a, "sa"))], &m.pa.kp, &[&m.pa.kp]);

    // Segundo commit de A en la misma ronda -> AlreadyCommitted.
    h.expire_blockhash();
    let other = Allocation { apertura: 1, choque: 1, remate: 1 };
    let logs = h
        .try_send(&[commit_ix(&h, m.battle_pda, &m.pa.kp, commit_hash(&other, "sa2"))], &m.pa.kp, &[&m.pa.kp])
        .expect_err("doble commit debe fallar");
    assert_error(&logs, "AlreadyCommitted", err::ALREADY_COMMITTED);
}

// ---- Resolve: faltan reveals -----------------------------------------------

#[test]
fn missing_reveals_rejected() {
    let mut h = Harness::new();
    let m = Match::setup(&mut h, 100, 1000);
    m.init(&mut h, default_cfg(), 1000, 7);
    m.join(&mut h, 1000, 7);

    // Ambos commit (-> Revealing), pero solo A revela.
    let alloc_a = Allocation { apertura: 5, choque: 5, remate: 0 };
    let alloc_b = Allocation { apertura: 3, choque: 3, remate: 4 };
    h.send(&[commit_ix(&h, m.battle_pda, &m.pa.kp, commit_hash(&alloc_a, "sa"))], &m.pa.kp, &[&m.pa.kp]);
    h.send(&[commit_ix(&h, m.battle_pda, &m.pb.kp, commit_hash(&alloc_b, "sb"))], &m.pb.kp, &[&m.pb.kp]);
    assert_eq!(h.battle(&m.battle_pda).phase, Phase::Revealing);
    h.send(&[reveal_ix(&h, m.battle_pda, &m.pa.kp, alloc_a, "sa")], &m.pa.kp, &[&m.pa.kp]);

    // resolve_round con reveal_b ausente: fase es Revealing (gating pasa),
    // así que el programa devuelve MissingReveals.
    let logs = h
        .try_send(&[m.resolve_ix(&h)], &m.payer, &[&m.payer])
        .expect_err("resolve sin reveal de B debe fallar");
    assert_error(&logs, "MissingReveals", err::MISSING_REVEALS);
}

// ---- Timeout: deadline no alcanzado ----------------------------------------

#[test]
fn deadline_not_reached_rejected() {
    let mut h = Harness::new();
    let m = Match::setup(&mut h, 100, 1000);
    m.init(&mut h, default_cfg(), 1000, 7);
    m.join(&mut h, 1000, 7); // fase Committing, deadline_commit = FIXED_NOW + 300

    // claim_timeout dentro de la ventana (reloj sigue en FIXED_NOW) -> DeadlineNotReached.
    let logs = h
        .try_send(&[m.claim_timeout_ix(&h)], &m.payer, &[&m.payer])
        .expect_err("timeout antes del deadline debe fallar");
    assert_error(&logs, "DeadlineNotReached", err::DEADLINE_NOT_REACHED);
}

// ---- Timeout: forfeit por no-commit del rival + payout ---------------------

#[test]
fn timeout_forfeit_then_settle_pays_winner() {
    let mut h = Harness::new();
    let stake: u64 = 100;
    let m = Match::setup(&mut h, stake, 1000);
    m.init(&mut h, default_cfg(), 1000, 7);
    m.join(&mut h, 1000, 7);

    // En Committing, solo A commitea; B no responde.
    let alloc_a = Allocation { apertura: 5, choque: 5, remate: 0 };
    h.send(&[commit_ix(&h, m.battle_pda, &m.pa.kp, commit_hash(&alloc_a, "sa"))], &m.pa.kp, &[&m.pa.kp]);
    let b = h.battle(&m.battle_pda);
    assert_eq!(b.phase, Phase::Committing, "sigue en Committing (B no commiteó)");

    // Avanzar el reloj más allá de deadline_commit y reclamar timeout.
    h.advance_clock_past(b.deadline_commit);
    h.expire_blockhash();
    h.send(&[m.claim_timeout_ix(&h)], &m.payer, &[&m.payer]);

    let b = h.battle(&m.battle_pda);
    assert_eq!(b.winner, Some(0), "A (único que commiteó) gana por forfeit");
    assert!(!b.is_draw, "no es empate");
    assert_eq!(b.phase, Phase::Settled, "liquidable tras timeout");

    // settle paga el pot completo (rake 0) a A.
    let a_before = h.token_amount(&m.pa.stake_token);
    h.expire_blockhash();
    h.send(&[m.settle_ix(&h)], &m.payer, &[&m.payer]);
    assert_eq!(h.token_amount(&m.pa.stake_token), a_before + 2 * stake, "A cobra el pot");
    assert_eq!(h.token_amount(&m.vault_pda), 0, "vault vacío");
    assert_eq!(h.battle(&m.battle_pda).phase, Phase::Closed, "fase Closed");
}
