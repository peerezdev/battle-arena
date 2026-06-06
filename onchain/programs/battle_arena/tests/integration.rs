//! Harness de integración end-to-end sobre LiteSVM (in-process, determinista).
//!
//! Ejercita las instrucciones REALES del programa on-chain:
//!   initialize_battle -> join_battle -> commit -> reveal -> resolve_round
//! y verifica el estado on-chain (fase, wins, edge) y los balances del vault SPL.
//!
//! La atestación del oráculo se verifica DE VERDAD: cada tx de
//! initialize/join incluye una instrucción nativa Ed25519Program con índices
//! auto-referenciales (0xFFFF) firmada con la clave del oráculo, exactamente el
//! layout que `oracle::verify_oracle_ed25519` espera. El runtime de LiteSVM
//! (feature `precompiles`) ejecuta la verificación criptográfica real.
//!
//! Helpers reutilizables por Tasks 13-14 (timeouts, settle, casos de fallo):
//!   - `Harness`: monta LiteSVM con SPL Token + precompiles + clock realista.
//!   - `Harness::setup_players`: crea mint de stake, ATAs, NFTs y los financia.
//!   - `MatchSetup` + `Harness::create_match` / `join_match`: arranca un match.
//!   - `Harness::commit` / `reveal` / `resolve_round`: avanzan una ronda.
//!   - `ed25519_attest_ix`: construye la ix Ed25519 auto-referencial.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use ed25519_dalek::{Signer as _, SigningKey};
use litesvm::LiteSVM;
use solana_clock::Clock;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_program_pack::Pack;
use solana_pubkey::Pubkey;
use solana_signer::Signer;
use solana_transaction::Transaction;

use battle_arena::hashing::commit_hash;
use battle_arena::state::{Allocation, MatchConfig, Phase};

// Reloj fijo y realista para que la comprobación de frescura del oráculo
// (`now >= ts && now - ts <= STALE_SECS`) y las ventanas commit/reveal pasen.
// LiteSVM arranca con Clock::default() (unix_timestamp = 0), así que lo fijamos.
const FIXED_NOW: i64 = 1_735_689_600; // 2025-01-01T00:00:00Z

const TOKEN_PROGRAM_ID: Pubkey =
    solana_pubkey::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// Construye los bytes de la instrucción Ed25519Program de UNA firma con
/// índices auto-referenciales (0xFFFF), firmando `msg` con `signing_key`.
/// Mismo layout que `oracle::verify_ed25519_ix_data` valida; aquí la firma SÍ
/// es real para que el precompile del runtime la verifique.
fn ed25519_attest_ix(signing_key: &SigningKey, msg: &[u8]) -> Instruction {
    const HEADER: u16 = 16;
    let signature_offset = HEADER;
    let public_key_offset = signature_offset + 64;
    let message_data_offset = public_key_offset + 32;
    let message_data_size = msg.len() as u16;

    let signature = signing_key.sign(msg).to_bytes();
    let pubkey = signing_key.verifying_key().to_bytes();

    let mut data = Vec::with_capacity(HEADER as usize + 64 + 32 + msg.len());
    data.push(1u8); // num_signatures
    data.push(0u8); // padding
    data.extend_from_slice(&signature_offset.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes()); // signature_instruction_index
    data.extend_from_slice(&public_key_offset.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes()); // public_key_instruction_index
    data.extend_from_slice(&message_data_offset.to_le_bytes());
    data.extend_from_slice(&message_data_size.to_le_bytes());
    data.extend_from_slice(&u16::MAX.to_le_bytes()); // message_instruction_index
    data.extend_from_slice(&signature);
    data.extend_from_slice(&pubkey);
    data.extend_from_slice(msg);

    Instruction {
        program_id: solana_sdk_ids::ed25519_program::ID,
        accounts: vec![],
        data,
    }
}

/// Mismo `attestation_msg` que el programa (32 mint + 8 value LE + 1 grade + 8 ts LE).
fn attestation_msg(nft_mint: &Pubkey, value_usd: u64, grade: u8, ts: i64) -> Vec<u8> {
    let mut v = Vec::with_capacity(49);
    v.extend_from_slice(nft_mint.as_ref());
    v.extend_from_slice(&value_usd.to_le_bytes());
    v.push(grade);
    v.extend_from_slice(&ts.to_le_bytes());
    v
}

/// Entorno de prueba: LiteSVM con el programa desplegado, SPL Token + precompiles
/// cargados y el reloj fijado a un timestamp realista.
struct Harness {
    svm: LiteSVM,
    program_id: Pubkey,
    /// Clave Ed25519 del oráculo (firma atestaciones; NO firma transacciones).
    oracle: SigningKey,
    oracle_pubkey: Pubkey,
}

impl Harness {
    fn new() -> Self {
        let program_id = battle_arena::id();
        // LiteSVM::new() ya carga SPL Token (with_default_programs) y, con la
        // feature `precompiles`, el programa nativo Ed25519 (with_precompiles).
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!("../../../target/deploy/battle_arena.so");
        svm.add_program(program_id, bytes).unwrap();

        // Fijar el reloj a un ts realista para la frescura del oráculo.
        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = FIXED_NOW;
        svm.set_sysvar::<Clock>(&clock);

        let oracle = SigningKey::from_bytes(&[7u8; 32]);
        let oracle_pubkey = Pubkey::new_from_array(oracle.verifying_key().to_bytes());

        Self {
            svm,
            program_id,
            oracle,
            oracle_pubkey,
        }
    }

    fn airdrop(&mut self, who: &Pubkey, lamports: u64) {
        self.svm.airdrop(who, lamports).unwrap();
    }

    fn send(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) {
        let blockhash = self.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(
            ixs,
            Some(&payer.pubkey()),
            signers,
            blockhash,
        );
        let res = self.svm.send_transaction(tx);
        if let Err(e) = res {
            panic!("transaction failed: {:?}\nlogs: {:#?}", e.err, e.meta.logs);
        }
    }

    fn token_amount(&self, token_account: &Pubkey) -> u64 {
        let acc = self.svm.get_account(token_account).unwrap();
        spl_token_interface::state::Account::unpack(&acc.data)
            .unwrap()
            .amount
    }

    fn battle(&self, battle_pda: &Pubkey) -> battle_arena::state::Battle {
        let acc = self.svm.get_account(battle_pda).unwrap();
        // Saltar el discriminador Anchor de 8 bytes.
        battle_arena::state::Battle::try_deserialize(&mut &acc.data[..]).unwrap()
    }

    // ---- SPL helpers -------------------------------------------------------

    /// Crea un mint (cualquier decimales) cuya autoridad es `authority`.
    fn create_mint(&mut self, payer: &Keypair, authority: &Pubkey, decimals: u8) -> Keypair {
        let mint = Keypair::new();
        let rent = self
            .svm
            .minimum_balance_for_rent_exemption(spl_token_interface::state::Mint::LEN);
        let create = solana_system_interface::instruction::create_account(
            &payer.pubkey(),
            &mint.pubkey(),
            rent,
            spl_token_interface::state::Mint::LEN as u64,
            &TOKEN_PROGRAM_ID,
        );
        let init = spl_token_interface::instruction::initialize_mint2(
            &TOKEN_PROGRAM_ID,
            &mint.pubkey(),
            authority,
            None,
            decimals,
        )
        .unwrap();
        self.send(&[create, init], payer, &[payer, &mint]);
        mint
    }

    /// Crea una token account propiedad de `owner` para `mint`.
    fn create_token_account(&mut self, payer: &Keypair, mint: &Pubkey, owner: &Pubkey) -> Keypair {
        let acc = Keypair::new();
        let rent = self
            .svm
            .minimum_balance_for_rent_exemption(spl_token_interface::state::Account::LEN);
        let create = solana_system_interface::instruction::create_account(
            &payer.pubkey(),
            &acc.pubkey(),
            rent,
            spl_token_interface::state::Account::LEN as u64,
            &TOKEN_PROGRAM_ID,
        );
        let init = spl_token_interface::instruction::initialize_account3(
            &TOKEN_PROGRAM_ID,
            &acc.pubkey(),
            mint,
            owner,
        )
        .unwrap();
        self.send(&[create, init], payer, &[payer, &acc]);
        acc
    }

    fn mint_to(&mut self, mint_authority: &Keypair, mint: &Pubkey, dest: &Pubkey, amount: u64) {
        let ix = spl_token_interface::instruction::mint_to(
            &TOKEN_PROGRAM_ID,
            mint,
            dest,
            &mint_authority.pubkey(),
            &[],
            amount,
        )
        .unwrap();
        self.send(&[ix], mint_authority, &[mint_authority]);
    }
}

/// Datos de un jugador montado: keypair + ATAs/NFT.
struct Player {
    kp: Keypair,
    stake_token: Pubkey,
    nft_mint: Pubkey,
    nft_token: Pubkey,
}

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
    let msg_a = attestation_msg(&pa.nft_mint, value_a, grade_a, FIXED_NOW);
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
    let msg_b = attestation_msg(&pb.nft_mint, value_b, grade_b, FIXED_NOW);
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

fn commit_ix(
    h: &Harness,
    battle_pda: Pubkey,
    player: &Keypair,
    commit: [u8; 32],
) -> Instruction {
    Instruction {
        program_id: h.program_id,
        accounts: battle_arena::accounts::CommitMove {
            player: player.pubkey(),
            battle: battle_pda,
        }
        .to_account_metas(None),
        data: battle_arena::instruction::Commit { commit }.data(),
    }
}

fn reveal_ix(
    h: &Harness,
    battle_pda: Pubkey,
    player: &Keypair,
    alloc: Allocation,
    salt: &str,
) -> Instruction {
    Instruction {
        program_id: h.program_id,
        accounts: battle_arena::accounts::RevealMove {
            player: player.pubkey(),
            battle: battle_pda,
        }
        .to_account_metas(None),
        data: battle_arena::instruction::Reveal {
            alloc,
            salt: salt.to_string(),
        }
        .data(),
    }
}
