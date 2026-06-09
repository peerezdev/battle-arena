//! Harness de integración end-to-end sobre LiteSVM (in-process, determinista).
//!
//! Ejercita las instrucciones REALES del programa on-chain:
//!   initialize_battle -> join_battle -> commit -> reveal -> resolve_round
//! y verifica el estado on-chain (fase, wins, edge) y los balances del vault SPL.
//!
//! El `Harness` y los helpers reutilizables viven en `tests/common/mod.rs`
//! (compartidos con `equivalence.rs`). La atestación del oráculo se verifica
//! DE VERDAD vía una ix nativa Ed25519Program con índices auto-referenciales.

mod common;
use common::*;

use anchor_lang::{InstructionData, ToAccountMetas};
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;

// Fuente de verdad única: `attestation_msg` se reexporta desde `common`
// (importado vía `use common::*`); el hash del commit desde el crate.
use battle_arena::hashing::commit_hash;
use battle_arena::state::{Allocation, MatchConfig, Phase};

#[test]
fn happy_path_initialize_join_commit_reveal_resolve() {
    let mut h = Harness::new();

    // ---- Cuentas base ------------------------------------------------------
    let payer = Keypair::new();
    h.airdrop(&payer.pubkey(), 100_000_000_000);

    let player_a = Keypair::new();
    let player_b = Keypair::new();
    h.airdrop(&player_a.pubkey(), 10_000_000_000);
    h.airdrop(&player_b.pubkey(), 10_000_000_000);

    // Mint de stake (6 decimales) con autoridad = payer.
    let stake_mint = h.create_mint(&payer, &payer.pubkey(), 6);

    // ATAs de stake (cuentas normales, no ATA derivada — el programa no exige PDA).
    let a_stake = h.create_token_account(&payer, &stake_mint.pubkey(), &player_a.pubkey());
    let b_stake = h.create_token_account(&payer, &stake_mint.pubkey(), &player_b.pubkey());
    let treasury = h.create_token_account(&payer, &stake_mint.pubkey(), &payer.pubkey());
    h.mint_to(&payer, &stake_mint.pubkey(), &a_stake.pubkey(), 1000);
    h.mint_to(&payer, &stake_mint.pubkey(), &b_stake.pubkey(), 1000);

    // NFTs: mint de 0 decimales, supply 1, token account del jugador.
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

    // ---- PDAs --------------------------------------------------------------
    let nonce: u64 = 1;
    let (battle_pda, _) = Pubkey::find_program_address(
        &[b"battle", pa.kp.pubkey().as_ref(), &nonce.to_le_bytes()],
        &h.program_id,
    );
    let (vault_pda, _) =
        Pubkey::find_program_address(&[b"vault", battle_pda.as_ref()], &h.program_id);

    let cfg = MatchConfig {
        rounds_to_win: 2,
        base_energy: 10,
        max_edge: 4,
        value_ratio_cap: 4,
        max_rounds: 5,
        rake_bps: 0,
        edge_enabled: true,
    };

    // ---- initialize_battle -------------------------------------------------
    let stake: u64 = 100;
    let value_a: u64 = 1000;
    let grade_a: u8 = 9;
    let msg_a = attestation_msg(&pa.nft_mint, value_a, grade_a, FIXED_NOW, &battle_pda);
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
            value_usd_a: value_a,
            grade_a,
            ts_a: FIXED_NOW,
            ed25519_ix_index: 0,
        }
        .data(),
    };
    // tx = [ed25519_ix (index 0), program_ix]
    h.send(&[ed_a, init_ix], &pa.kp, &[&pa.kp]);

    let b = h.battle(&battle_pda);
    assert_eq!(b.phase, Phase::Created, "fase tras initialize");
    assert_eq!(h.token_amount(&vault_pda), 100, "vault tras initialize");
    assert_eq!(h.token_amount(&pa.stake_token), 900, "stake de A tras depósito");

    // ---- join_battle -------------------------------------------------------
    let value_b: u64 = 950;
    let grade_b: u8 = 7;
    let msg_b = attestation_msg(&pb.nft_mint, value_b, grade_b, FIXED_NOW, &battle_pda);
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
            value_usd_b: value_b,
            grade_b,
            ts_b: FIXED_NOW,
            ed25519_ix_index: 0,
        }
        .data(),
    };
    h.send(&[ed_b, join_ix], &pb.kp, &[&pb.kp]);

    let b = h.battle(&battle_pda);
    assert_eq!(b.phase, Phase::Committing, "fase tras join");
    assert_eq!(h.token_amount(&vault_pda), 200, "vault tras join");
    // ratio 1000/950 < 2 => edge 0 para ambos.
    assert_eq!(b.edge_a, 0, "edge_a sin ventaja");
    assert_eq!(b.edge_b, 0, "edge_b sin ventaja");

    // ---- Ronda 1: commit ---------------------------------------------------
    let alloc_a = Allocation { apertura: 5, choque: 5, remate: 0 };
    let alloc_b = Allocation { apertura: 3, choque: 3, remate: 4 };
    let salt_a = "sa";
    let salt_b = "sb";

    let commit_a_ix = commit_ix(&h, battle_pda, &pa.kp, commit_hash(&alloc_a, salt_a));
    h.send(&[commit_a_ix], &pa.kp, &[&pa.kp]);

    let commit_b_ix = commit_ix(&h, battle_pda, &pb.kp, commit_hash(&alloc_b, salt_b));
    h.send(&[commit_b_ix], &pb.kp, &[&pb.kp]);

    let b = h.battle(&battle_pda);
    assert_eq!(b.phase, Phase::Revealing, "fase tras ambos commits");

    // ---- Ronda 1: reveal ---------------------------------------------------
    let reveal_a_ix = reveal_ix(&h, battle_pda, &pa.kp, alloc_a, salt_a);
    h.send(&[reveal_a_ix], &pa.kp, &[&pa.kp]);

    let reveal_b_ix = reveal_ix(&h, battle_pda, &pb.kp, alloc_b, salt_b);
    h.send(&[reveal_b_ix], &pb.kp, &[&pb.kp]);

    // ---- Ronda 1: resolve --------------------------------------------------
    let resolve = Instruction {
        program_id: h.program_id,
        accounts: battle_arena::accounts::ResolveRound { battle: battle_pda }
            .to_account_metas(None),
        data: battle_arena::instruction::ResolveRound {}.data(),
    };
    h.send(&[resolve], &payer, &[&payer]);

    let b = h.battle(&battle_pda);
    // A gana apertura (5>3) y choque (5>3); B gana remate (4>0) => 2-1 => A.
    assert_eq!(b.wins_a, 1, "A gana la ronda 1");
    assert_eq!(b.wins_b, 0, "B no gana la ronda 1");
    assert_eq!(b.round, 1, "avanza a la ronda 1 (índice)");
    assert_eq!(b.phase, Phase::Committing, "vuelve a Committing para ronda 2");
    // El match no ha terminado (rounds_to_win=2).
    assert!(b.winner.is_none(), "todavía sin ganador del match");
}
