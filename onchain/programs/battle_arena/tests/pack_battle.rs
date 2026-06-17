//! Tests de integración — Pack Battle Directo (Fase 1).
//!
//! Cubre:
//!   1. Camino feliz: A gana por mayor valor.
//!   2. Empate real: reembolso a cada dueño.
//!   3. Empate por valor → desempate por grade (B gana).
//!   4. Rechazo: settle antes de que ambos depositen.
//!   5. Rechazo: depósito con oráculo incorrecto.
//!   6. Timeout: A deposita, B nunca; A reclama pasado el deadline.

mod pack_common;
mod common;

use common::*;
use pack_common::PackScenario;

// ── 1. A gana (valor mayor) ─────────────────────────────────────────────────

#[test]
fn direct_higher_value_takes_both_cards() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);

    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);

    let oracle = h.oracle.clone();
    h.send(
        &s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 1000, 9, &oracle),
        &s.player_a,
        &[&s.player_a],
    );
    h.send(
        &s.deposit_ixs(&h, &s.player_b, s.vault_b, s.nft_mint_b, 500, 8, &oracle),
        &s.player_b,
        &[&s.player_b],
    );

    assert_eq!(
        h.pack(&s.pack_pda).phase,
        battle_arena::pack_state::PackPhase::Ready
    );

    // A gana → ambas cartas van a player_a.
    h.send(
        &[s.settle_direct_ix(&h, s.dest_a_for_a, s.dest_b_for_a)],
        &s.payer,
        &[&s.payer],
    );

    assert_eq!(h.token_amount(&s.dest_a_for_a), 1);
    assert_eq!(h.token_amount(&s.dest_b_for_a), 1);
    assert_eq!(h.token_amount(&s.vault_a), 0);
    assert_eq!(h.token_amount(&s.vault_b), 0);

    let p = h.pack(&s.pack_pda);
    assert_eq!(p.phase, battle_arena::pack_state::PackPhase::Settled);
    assert_eq!(p.winner, Some(0));
}

// ── 2. Empate real → reembolso ───────────────────────────────────────────────

#[test]
fn direct_true_tie_refunds_each_card() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);

    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);

    let oracle = h.oracle.clone();
    // Mismo valor y grade → empate real.
    h.send(
        &s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 700, 9, &oracle),
        &s.player_a,
        &[&s.player_a],
    );
    h.send(
        &s.deposit_ixs(&h, &s.player_b, s.vault_b, s.nft_mint_b, 700, 9, &oracle),
        &s.player_b,
        &[&s.player_b],
    );

    // Empate → carta A vuelve a A, carta B vuelve a B.
    h.send(
        &[s.settle_direct_ix(&h, s.dest_a_for_a, s.dest_b_for_b)],
        &s.payer,
        &[&s.payer],
    );

    assert_eq!(h.token_amount(&s.dest_a_for_a), 1);
    assert_eq!(h.token_amount(&s.dest_b_for_b), 1);

    let p = h.pack(&s.pack_pda);
    assert!(p.is_draw);
    assert_eq!(p.winner, None);
}

// ── 3. Empate de valor → desempate por grade (B gana) ───────────────────────

#[test]
fn direct_equal_value_grade_breaks_tie() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);

    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);

    let oracle = h.oracle.clone();
    // Valor igual, pero grade de B (10) > grade de A (7).
    h.send(
        &s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 700, 7, &oracle),
        &s.player_a,
        &[&s.player_a],
    );
    h.send(
        &s.deposit_ixs(&h, &s.player_b, s.vault_b, s.nft_mint_b, 700, 10, &oracle),
        &s.player_b,
        &[&s.player_b],
    );

    // B gana → ambas cartas van a player_b.
    h.send(
        &[s.settle_direct_ix(&h, s.dest_a_for_b, s.dest_b_for_b)],
        &s.payer,
        &[&s.payer],
    );

    assert_eq!(h.token_amount(&s.dest_a_for_b), 1);
    assert_eq!(h.token_amount(&s.dest_b_for_b), 1);

    let p = h.pack(&s.pack_pda);
    assert_eq!(p.phase, battle_arena::pack_state::PackPhase::Settled);
    assert_eq!(p.winner, Some(1));
}

// ── 4. Rechazo: settle antes de que ambos depositen ─────────────────────────

#[test]
fn settle_rejected_before_both_deposit() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);

    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);

    let oracle = h.oracle.clone();
    // Solo A deposita; B nunca deposita (pack.vault_b queda en Pubkey::default()).
    h.send(
        &s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 800, 8, &oracle),
        &s.player_a,
        &[&s.player_a],
    );

    // settle_direct rechaza porque pack.phase != Ready (solo A depositó).
    // Anchor evalúa la constraint `vault_b.key() == pack.vault_b` antes del
    // handler; como pack.vault_b es Pubkey::default() y vault_b es el vault real,
    // la constraint falla con BadVault (6020) en lugar de NotAllDeposited (6019).
    // Ambos errores demuestran que el settle es rechazado correctamente antes de
    // que ambas cartas estén en escrow; aceptamos cualquiera de los dos.
    let logs = h
        .try_send(
            &[s.settle_direct_ix(&h, s.dest_a_for_a, s.dest_b_for_a)],
            &s.payer,
            &[&s.payer],
        )
        .expect_err("se esperaba fallo");

    let joined = logs.join("\n");
    assert!(
        joined.contains("NotAllDeposited")
            || joined.contains(&format!("custom program error: {}", err::NOT_ALL_DEPOSITED))
            || joined.contains("BadVault")
            || joined.contains(&format!("custom program error: {}", err::BAD_VAULT)),
        "se esperaba NotAllDeposited (6019) o BadVault (6020) en los logs:\n{joined}"
    );
}

// ── 5. Rechazo: firma de oráculo incorrecta ──────────────────────────────────

#[test]
fn deposit_rejected_with_wrong_oracle() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);

    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);

    // Oráculo impostor (distinto al registrado en el pack).
    let impostor = ed25519_dalek::SigningKey::from_bytes(&[9u8; 32]);
    let logs = h
        .try_send(
            &s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 1000, 9, &impostor),
            &s.player_a,
            &[&s.player_a],
        )
        .expect_err("se esperaba fallo por firma inválida");

    assert_error(&logs, "BadOracleSig", err::BAD_ORACLE_SIG);
}

// ── 6. Timeout: A recupera su carta cuando B nunca deposita ─────────────────

#[test]
fn timeout_lets_depositor_reclaim_when_opponent_never_deposits() {
    let mut h = Harness::new();
    let s = PackScenario::setup(&mut h);

    h.send(&[s.create_ix(&h)], &s.player_a, &[&s.player_a]);
    h.send(&[s.join_ix(&h)], &s.player_b, &[&s.player_b]);

    let oracle = h.oracle.clone();
    // A deposita, B nunca deposita.
    h.send(
        &s.deposit_ixs(&h, &s.player_a, s.vault_a, s.nft_mint_a, 500, 7, &oracle),
        &s.player_a,
        &[&s.player_a],
    );

    // Avanzar el reloj por encima del deadline.
    let deadline = h.pack(&s.pack_pda).deadline_join;
    h.advance_clock_past(deadline);

    // A reclama su carta de vuelta.
    h.send(
        &[s.claim_timeout_ix(&h, s.vault_a, s.dest_a_for_a)],
        &s.player_a,
        &[&s.player_a],
    );

    assert_eq!(h.token_amount(&s.dest_a_for_a), 1);
    assert_eq!(h.token_amount(&s.vault_a), 0);

    let p = h.pack(&s.pack_pda);
    assert_eq!(p.phase, battle_arena::pack_state::PackPhase::Settled);
}
