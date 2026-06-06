//! Tests de liquidación (`settle`): flujos de dinero reales sobre balances SPL.
//!
//! Ejercita las instrucciones REALES del programa on-chain hasta `Phase::Settled`
//! y luego llama `settle`, verificando los balances de las token accounts ANTES y
//! DESPUÉS (pago al ganador con/sin rake, reembolso en empate, anti-doble-settle).
//!
//! El `Harness`, el builder `Match` y los helpers viven en `tests/common/mod.rs`.

mod common;
use common::*;

use battle_arena::state::{Allocation, Phase};

/// Lleva un match a una victoria 2-0 de A: dos rondas idénticas donde A toma
/// apertura y choque (5/5/0) y B solo el remate (3/3/4) -> A gana cada ronda.
/// Con valores iguales no hay edge; available = base_energy = 10 cada ronda.
fn drive_to_a_win(h: &mut Harness, m: &Match) {
    let alloc_a = Allocation { apertura: 5, choque: 5, remate: 0 };
    let alloc_b = Allocation { apertura: 3, choque: 3, remate: 4 };
    m.play_round(h, alloc_a, alloc_b, "r1");
    let b = h.battle(&m.battle_pda);
    assert_eq!(b.wins_a, 1, "A gana ronda 1");
    assert_eq!(b.phase, Phase::Committing, "sigue jugando tras ronda 1");

    m.play_round(h, alloc_a, alloc_b, "r2");
    let b = h.battle(&m.battle_pda);
    assert_eq!(b.wins_a, 2, "A gana ronda 2");
    assert_eq!(b.winner, Some(0), "ganador = A");
    assert!(!b.is_draw, "no es empate");
    assert_eq!(b.phase, Phase::Settled, "match liquidable");
}

#[test]
fn settle_win_payout_rake_zero() {
    let mut h = Harness::new();
    let stake: u64 = 100;
    let funded: u64 = 1000;
    let m = Match::setup(&mut h, stake, funded);

    let cfg = default_cfg(); // rake_bps = 0
    m.init(&mut h, cfg, 1000, 7);
    m.join(&mut h, 1000, 7);
    drive_to_a_win(&mut h, &m);

    // Tras los depósitos, cada jugador tiene funded - stake; el vault tiene 2*stake.
    let pot = 2 * stake;
    assert_eq!(h.token_amount(&m.vault_pda), pot, "vault = pot antes de settle");
    let a_before = h.token_amount(&m.pa.stake_token);
    let b_before = h.token_amount(&m.pb.stake_token);
    assert_eq!(a_before, funded - stake, "A depositó stake");
    assert_eq!(b_before, funded - stake, "B depositó stake");

    h.send(&[m.settle_ix(&h)], &m.payer, &[&m.payer]);

    // A (ganador) recibe el pot completo (rake 0); B no cambia; vault vacío.
    assert_eq!(
        h.token_amount(&m.pa.stake_token),
        a_before + pot,
        "A recibe el pot completo (2*stake)"
    );
    assert_eq!(h.token_amount(&m.pb.stake_token), b_before, "B sin cambios");
    assert_eq!(h.token_amount(&m.vault_pda), 0, "vault vacío tras settle");
    assert_eq!(h.token_amount(&m.treasury), 0, "treasury sin rake");
    assert_eq!(h.battle(&m.battle_pda).phase, Phase::Closed, "fase Closed");

    // Conservación: el ganador recupera su saldo inicial + el stake de B.
    assert_eq!(h.token_amount(&m.pa.stake_token), funded + stake);
}

#[test]
fn settle_win_payout_rake_250() {
    let mut h = Harness::new();
    let stake: u64 = 100;
    let funded: u64 = 1000;
    let m = Match::setup(&mut h, stake, funded);

    let mut cfg = default_cfg();
    cfg.rake_bps = 250; // 2.5%
    m.init(&mut h, cfg, 1000, 7);
    m.join(&mut h, 1000, 7);
    drive_to_a_win(&mut h, &m);

    let pot = 2 * stake;
    let rake = pot * 250 / 10_000; // 200 * 250 / 10000 = 5
    let payout = pot - rake; // 195
    assert_eq!(rake, 5);
    assert_eq!(payout, 195);

    let a_before = h.token_amount(&m.pa.stake_token);
    let b_before = h.token_amount(&m.pb.stake_token);
    let t_before = h.token_amount(&m.treasury);

    h.send(&[m.settle_ix(&h)], &m.payer, &[&m.payer]);

    assert_eq!(
        h.token_amount(&m.pa.stake_token),
        a_before + payout,
        "ganador recibe pot - rake"
    );
    assert_eq!(
        h.token_amount(&m.treasury),
        t_before + rake,
        "treasury recibe el rake"
    );
    assert_eq!(h.token_amount(&m.pb.stake_token), b_before, "B sin cambios");
    assert_eq!(h.token_amount(&m.vault_pda), 0, "vault vacío");
    assert_eq!(h.battle(&m.battle_pda).phase, Phase::Closed, "fase Closed");
}

#[test]
fn settle_draw_refund() {
    let mut h = Harness::new();
    let stake: u64 = 100;
    let funded: u64 = 1000;
    let m = Match::setup(&mut h, stake, funded);

    // max_rounds = 1: tras una sola ronda se alcanza el cap. La hacemos DISPUTED
    // y simétrica (mismos totales, misma solidez) -> wins 0-0 -> is_draw.
    let mut cfg = default_cfg();
    cfg.max_rounds = 1;
    cfg.rounds_to_win = 2; // no se decide por victorias en 1 ronda
    // Valores iguales y MISMO grade => solidez igual => desempates fallan => Disputed.
    m.init(&mut h, cfg, 1000, 5);
    m.join(&mut h, 1000, 5);

    // A 6/1/1 vs B 1/6/1: front apertura -> A, choque -> B, remate empata
    //   (1==1, solidez igual) -> Disputed. Fronts 1-1, totales iguales (8==8),
    //   solidez igual -> RoundWinner::Disputed -> wins 0-0.
    let alloc_a = Allocation { apertura: 6, choque: 1, remate: 1 };
    let alloc_b = Allocation { apertura: 1, choque: 6, remate: 1 };
    m.play_round(&mut h, alloc_a, alloc_b, "d1");

    let b = h.battle(&m.battle_pda);
    assert_eq!(b.wins_a, 0, "ronda disputada: A no gana");
    assert_eq!(b.wins_b, 0, "ronda disputada: B no gana");
    assert!(b.is_draw, "cap alcanzado con victorias igualadas -> empate");
    assert!(b.winner.is_none(), "sin ganador en empate");
    assert_eq!(b.phase, Phase::Settled, "liquidable");

    let pot = 2 * stake;
    assert_eq!(h.token_amount(&m.vault_pda), pot, "vault = pot antes de settle");
    let a_before = h.token_amount(&m.pa.stake_token);
    let b_before = h.token_amount(&m.pb.stake_token);

    h.send(&[m.settle_ix(&h)], &m.payer, &[&m.payer]);

    // Empate -> cada uno recupera su stake.
    assert_eq!(h.token_amount(&m.pa.stake_token), a_before + stake, "A reembolsado");
    assert_eq!(h.token_amount(&m.pb.stake_token), b_before + stake, "B reembolsado");
    assert_eq!(h.token_amount(&m.pa.stake_token), funded, "A restaurado a inicial");
    assert_eq!(h.token_amount(&m.pb.stake_token), funded, "B restaurado a inicial");
    assert_eq!(h.token_amount(&m.vault_pda), 0, "vault vacío");
    assert_eq!(h.token_amount(&m.treasury), 0, "treasury sin rake en empate");
    assert_eq!(h.battle(&m.battle_pda).phase, Phase::Closed, "fase Closed");
}

#[test]
fn double_settle_rejected() {
    let mut h = Harness::new();
    let stake: u64 = 100;
    let m = Match::setup(&mut h, stake, 1000);

    m.init(&mut h, default_cfg(), 1000, 7);
    m.join(&mut h, 1000, 7);
    drive_to_a_win(&mut h, &m);

    // Primer settle: éxito (fase pasa a Closed).
    h.send(&[m.settle_ix(&h)], &m.payer, &[&m.payer]);
    assert_eq!(h.battle(&m.battle_pda).phase, Phase::Closed);

    // Segundo settle: debe fallar con WrongPhase (fase Closed, no Settled).
    h.expire_blockhash();
    let logs = h
        .try_send(&[m.settle_ix(&h)], &m.payer, &[&m.payer])
        .expect_err("el segundo settle debe fallar");
    assert_error(&logs, "WrongPhase", err::WRONG_PHASE);

    // El balance del ganador no cambió tras el intento fallido (no doble pago).
    assert_eq!(h.token_amount(&m.pa.stake_token), 1000 + stake, "sin doble pago");
    assert_eq!(h.token_amount(&m.vault_pda), 0, "vault sigue vacío");
}
