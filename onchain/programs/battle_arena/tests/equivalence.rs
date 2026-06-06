//! Vectores de equivalencia: prueba que el programa Anchor on-chain produce los
//! MISMOS resultados de batalla que el motor Fase 0 (TypeScript).
//!
//! Los vectores en `tests/fixtures/vectors.json` los genera
//! `onchain/scripts/gen-vectors.ts` conduciendo el motor TS REAL (no son valores
//! escritos a mano). Aquí, para CADA vector, montamos un match fresco en LiteSVM,
//! reproducimos exactamente las mismas asignaciones por ronda contra las
//! instrucciones REALES del programa (initialize/join/commit/reveal/resolve) y
//! comprobamos que el estado on-chain (`wins_a`/`wins_b`/`winner`/`is_draw`)
//! coincide con el resultado esperado del motor TS.
//!
//! Esta es la prueba central: mismas asignaciones -> mismo ganador en TS y Rust.

mod common;
use common::*;

use anchor_lang::{InstructionData, ToAccountMetas};
use serde::Deserialize;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;

use battle_arena::hashing::commit_hash;
use battle_arena::state::{Allocation, MatchConfig, Phase};

// ---- Esquema del vector (mismo formato que vectors.json) --------------------

#[derive(Debug, Deserialize)]
struct VectorCard {
    #[serde(rename = "valueUsd")]
    value_usd: u64,
    grade: u8,
}

#[derive(Debug, Deserialize)]
struct OnChainCfg {
    #[serde(rename = "roundsToWin")]
    rounds_to_win: u8,
    #[serde(rename = "baseEnergy")]
    base_energy: u32,
    #[serde(rename = "maxEdge")]
    max_edge: u8,
    #[serde(rename = "valueRatioCap")]
    value_ratio_cap: u8,
    #[serde(rename = "maxRounds")]
    max_rounds: u8,
    #[serde(rename = "rakeBps")]
    rake_bps: u16,
    #[serde(rename = "edgeEnabled")]
    edge_enabled: bool,
}

#[derive(Debug, Deserialize)]
struct VecAlloc {
    apertura: u32,
    choque: u32,
    remate: u32,
}

impl From<&VecAlloc> for Allocation {
    fn from(a: &VecAlloc) -> Self {
        Allocation {
            apertura: a.apertura,
            choque: a.choque,
            remate: a.remate,
        }
    }
}

#[derive(Debug, Deserialize)]
struct RoundAlloc {
    #[serde(rename = "allocA")]
    alloc_a: VecAlloc,
    #[serde(rename = "allocB")]
    alloc_b: VecAlloc,
}

#[derive(Debug, Deserialize)]
struct Expected {
    winner: String, // "a" | "b" | "draw"
    #[serde(rename = "winsA")]
    wins_a: u8,
    #[serde(rename = "winsB")]
    wins_b: u8,
}

#[derive(Debug, Deserialize)]
struct Vector {
    name: String,
    #[serde(rename = "cardA")]
    card_a: VectorCard,
    #[serde(rename = "cardB")]
    card_b: VectorCard,
    cfg: OnChainCfg,
    rounds: Vec<RoundAlloc>,
    expected: Expected,
}

// Los vectores se incrustan en el binario de test en tiempo de compilación.
const VECTORS_JSON: &str = include_str!("fixtures/vectors.json");

/// Reproduce UN vector contra el programa on-chain y comprueba el resultado.
fn replay_vector(v: &Vector) {
    let mut h = Harness::new();

    let payer = Keypair::new();
    h.airdrop(&payer.pubkey(), 100_000_000_000);

    let player_a = Keypair::new();
    let player_b = Keypair::new();
    h.airdrop(&player_a.pubkey(), 10_000_000_000);
    h.airdrop(&player_b.pubkey(), 10_000_000_000);

    // Mint de stake con saldo holgado.
    let stake_mint = h.create_mint(&payer, &payer.pubkey(), 6);
    let a_stake = h.create_token_account(&payer, &stake_mint.pubkey(), &player_a.pubkey());
    let b_stake = h.create_token_account(&payer, &stake_mint.pubkey(), &player_b.pubkey());
    let treasury = h.create_token_account(&payer, &stake_mint.pubkey(), &payer.pubkey());
    h.mint_to(&payer, &stake_mint.pubkey(), &a_stake.pubkey(), 1_000_000);
    h.mint_to(&payer, &stake_mint.pubkey(), &b_stake.pubkey(), 1_000_000);

    // NFTs (mint de 0 decimales, supply 1).
    let nft_mint_a = h.create_mint(&payer, &payer.pubkey(), 0);
    let nft_token_a = h.create_token_account(&payer, &nft_mint_a.pubkey(), &player_a.pubkey());
    h.mint_to(&payer, &nft_mint_a.pubkey(), &nft_token_a.pubkey(), 1);
    let nft_mint_b = h.create_mint(&payer, &payer.pubkey(), 0);
    let nft_token_b = h.create_token_account(&payer, &nft_mint_b.pubkey(), &player_b.pubkey());
    h.mint_to(&payer, &nft_mint_b.pubkey(), &nft_token_b.pubkey(), 1);

    let pa = Player {
        kp: player_a,
        stake_token: a_stake.pubkey(),
        nft_mint: nft_mint_a.pubkey(),
        nft_token: nft_token_a.pubkey(),
    };
    let pb = Player {
        kp: player_b,
        stake_token: b_stake.pubkey(),
        nft_mint: nft_mint_b.pubkey(),
        nft_token: nft_token_b.pubkey(),
    };

    let nonce: u64 = 1;
    let (battle_pda, _) = Pubkey::find_program_address(
        &[b"battle", pa.kp.pubkey().as_ref(), &nonce.to_le_bytes()],
        &h.program_id,
    );
    let (vault_pda, _) =
        Pubkey::find_program_address(&[b"vault", battle_pda.as_ref()], &h.program_id);

    let cfg = MatchConfig {
        rounds_to_win: v.cfg.rounds_to_win,
        base_energy: v.cfg.base_energy,
        max_edge: v.cfg.max_edge,
        value_ratio_cap: v.cfg.value_ratio_cap,
        max_rounds: v.cfg.max_rounds,
        rake_bps: v.cfg.rake_bps,
        edge_enabled: v.cfg.edge_enabled,
    };

    // ---- initialize_battle -------------------------------------------------
    let stake: u64 = 100;
    let msg_a = attestation_msg(&pa.nft_mint, v.card_a.value_usd, v.card_a.grade, FIXED_NOW);
    let ed_a = ed25519_attest_ix(&h.oracle, &msg_a);
    let init_ix = Instruction {
        program_id: h.program_id,
        accounts: battle_arena::accounts::InitializeBattle {
            player_a: pa.kp.pubkey(),
            battle: battle_pda,
            stake_mint: stake_mint.pubkey(),
            escrow_vault: vault_pda,
            player_a_token: pa.stake_token,
            nft_token_a: pa.nft_token,
            instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID,
            token_program: TOKEN_PROGRAM_ID,
            system_program: solana_sdk_ids::system_program::ID,
            rent: solana_sdk_ids::sysvar::rent::ID,
        }
        .to_account_metas(None),
        data: battle_arena::instruction::InitializeBattle {
            nonce,
            stake,
            cfg,
            oracle: h.oracle_pubkey,
            treasury: treasury.pubkey(),
            nft_mint_a: pa.nft_mint,
            value_usd_a: v.card_a.value_usd,
            grade_a: v.card_a.grade,
            ts_a: FIXED_NOW,
            ed25519_ix_index: 0,
        }
        .data(),
    };
    h.send(&[ed_a, init_ix], &pa.kp, &[&pa.kp]);

    // ---- join_battle -------------------------------------------------------
    let msg_b = attestation_msg(&pb.nft_mint, v.card_b.value_usd, v.card_b.grade, FIXED_NOW);
    let ed_b = ed25519_attest_ix(&h.oracle, &msg_b);
    let join_ix = Instruction {
        program_id: h.program_id,
        accounts: battle_arena::accounts::JoinBattle {
            player_b: pb.kp.pubkey(),
            battle: battle_pda,
            escrow_vault: vault_pda,
            player_b_token: pb.stake_token,
            nft_token_b: pb.nft_token,
            instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID,
            token_program: TOKEN_PROGRAM_ID,
        }
        .to_account_metas(None),
        data: battle_arena::instruction::JoinBattle {
            nft_mint_b: pb.nft_mint,
            value_usd_b: v.card_b.value_usd,
            grade_b: v.card_b.grade,
            ts_b: FIXED_NOW,
            ed25519_ix_index: 0,
        }
        .data(),
    };
    h.send(&[ed_b, join_ix], &pb.kp, &[&pb.kp]);

    let b = h.battle(&battle_pda);
    assert_eq!(b.phase, Phase::Committing, "[{}] fase tras join", v.name);

    let resolve_ix = Instruction {
        program_id: h.program_id,
        accounts: battle_arena::accounts::ResolveRound { battle: battle_pda }
            .to_account_metas(None),
        data: battle_arena::instruction::ResolveRound {}.data(),
    };

    // ---- Reproducir cada ronda ---------------------------------------------
    for (i, r) in v.rounds.iter().enumerate() {
        // Avanzar el blockhash para que las tx de `resolve_round` (idénticas
        // entre rondas, mismo payer y datos) no colisionen como AlreadyProcessed.
        h.expire_blockhash();
        // Si el programa ya alcanzó Settled (alguien llegó a rounds_to_win),
        // no reproducimos rondas extra para este vector.
        let cur = h.battle(&battle_pda);
        if cur.phase == Phase::Settled {
            break;
        }
        assert_eq!(
            cur.phase,
            Phase::Committing,
            "[{}] ronda {}: se esperaba Committing",
            v.name,
            i
        );

        let alloc_a: Allocation = (&r.alloc_a).into();
        let alloc_b: Allocation = (&r.alloc_b).into();
        // El salt es interno al replay; cualquier salt válido sirve porque el
        // programa solo comprueba commit == hash(alloc, salt) con SU propio salt.
        let salt_a = format!("a{i}");
        let salt_b = format!("b{i}");

        let commit_a = commit_ix(&h, battle_pda, &pa.kp, commit_hash(&alloc_a, &salt_a));
        h.send(&[commit_a], &pa.kp, &[&pa.kp]);
        let commit_b = commit_ix(&h, battle_pda, &pb.kp, commit_hash(&alloc_b, &salt_b));
        h.send(&[commit_b], &pb.kp, &[&pb.kp]);

        let reveal_a = reveal_ix(&h, battle_pda, &pa.kp, alloc_a, &salt_a);
        h.send(&[reveal_a], &pa.kp, &[&pa.kp]);
        let reveal_b = reveal_ix(&h, battle_pda, &pb.kp, alloc_b, &salt_b);
        h.send(&[reveal_b], &pb.kp, &[&pb.kp]);

        h.send(&[resolve_ix.clone()], &payer, &[&payer]);
    }

    // ---- Asertar equivalencia con el motor TS ------------------------------
    let b = h.battle(&battle_pda);
    assert_eq!(
        b.wins_a, v.expected.wins_a,
        "[{}] wins_a on-chain != TS",
        v.name
    );
    assert_eq!(
        b.wins_b, v.expected.wins_b,
        "[{}] wins_b on-chain != TS",
        v.name
    );

    match v.expected.winner.as_str() {
        "a" => {
            assert_eq!(b.winner, Some(0), "[{}] ganador on-chain != 'a'", v.name);
            assert!(!b.is_draw, "[{}] no debería ser empate", v.name);
        }
        "b" => {
            assert_eq!(b.winner, Some(1), "[{}] ganador on-chain != 'b'", v.name);
            assert!(!b.is_draw, "[{}] no debería ser empate", v.name);
        }
        "draw" => {
            assert!(b.is_draw, "[{}] debería ser empate on-chain", v.name);
            assert!(b.winner.is_none(), "[{}] empate sin ganador", v.name);
        }
        other => panic!("[{}] ganador esperado desconocido: {other}", v.name),
    }
}

#[test]
fn equivalence_vectors_match_ts_engine() {
    let vectors: Vec<Vector> =
        serde_json::from_str(VECTORS_JSON).expect("vectors.json debe deserializar");
    assert!(!vectors.is_empty(), "debe haber al menos un vector");

    // Confirmar que el vector del SPEC §2.6 está presente y que el motor TS dice
    // que gana la barata ('b').
    let spec = vectors
        .iter()
        .find(|v| v.name == "spec-2.6-barata-gana")
        .expect("falta el vector del SPEC §2.6");
    assert_eq!(spec.expected.winner, "b", "§2.6: la barata ('b') debe ganar en TS");

    for v in &vectors {
        replay_vector(v);
    }
}
