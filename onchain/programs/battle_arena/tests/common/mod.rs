//! Helpers compartidos de integración sobre LiteSVM (in-process, determinista).
//!
//! Por convención de Rust, `common/mod.rs` NO se compila como un binario de test
//! propio (no contiene `#[test]`), así que múltiples ficheros de test
//! (`integration.rs`, `equivalence.rs`, ...) pueden hacer `mod common; use
//! common::*;` para reutilizar el `Harness` y las utilidades.
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
//! Fuente de verdad única: el mensaje canónico de atestación y el hash del
//! commit se importan del propio crate (`battle_arena::oracle::attestation_msg`
//! y `battle_arena::hashing::commit_hash`), no se duplican aquí.

#![allow(dead_code)]

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

// Re-exportado para que los tests usen una única fuente de verdad del mensaje
// canónico de atestación, en vez de duplicar el layout.
pub use battle_arena::oracle::attestation_msg;
use battle_arena::state::Allocation;

// Reloj fijo y realista para que la comprobación de frescura del oráculo
// (`now >= ts && now - ts <= STALE_SECS`) y las ventanas commit/reveal pasen.
// LiteSVM arranca con Clock::default() (unix_timestamp = 0), así que lo fijamos.
pub const FIXED_NOW: i64 = 1_735_689_600; // 2025-01-01T00:00:00Z

pub const TOKEN_PROGRAM_ID: Pubkey =
    solana_pubkey::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

/// Construye los bytes de la instrucción Ed25519Program de UNA firma con
/// índices auto-referenciales (0xFFFF), firmando `msg` con `signing_key`.
/// Mismo layout que `oracle::verify_ed25519_ix_data` valida; aquí la firma SÍ
/// es real para que el precompile del runtime la verifique.
pub fn ed25519_attest_ix(signing_key: &SigningKey, msg: &[u8]) -> Instruction {
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

/// Entorno de prueba: LiteSVM con el programa desplegado, SPL Token + precompiles
/// cargados y el reloj fijado a un timestamp realista.
pub struct Harness {
    pub svm: LiteSVM,
    pub program_id: Pubkey,
    /// Clave Ed25519 del oráculo (firma atestaciones; NO firma transacciones).
    pub oracle: SigningKey,
    pub oracle_pubkey: Pubkey,
}

impl Harness {
    pub fn new() -> Self {
        let program_id = battle_arena::id();
        // LiteSVM::new() ya carga SPL Token (with_default_programs) y, con la
        // feature `precompiles`, el programa nativo Ed25519 (with_precompiles).
        let mut svm = LiteSVM::new();
        let bytes = include_bytes!("../../../../target/deploy/battle_arena.so");
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

    pub fn airdrop(&mut self, who: &Pubkey, lamports: u64) {
        self.svm.airdrop(who, lamports).unwrap();
    }

    /// Avanza el blockhash para que transacciones idénticas en rondas sucesivas
    /// (p. ej. `resolve_round` enviada por el mismo payer) no colisionen como
    /// `AlreadyProcessed` en LiteSVM.
    pub fn expire_blockhash(&mut self) {
        self.svm.expire_blockhash();
    }

    pub fn send(&mut self, ixs: &[Instruction], payer: &Keypair, signers: &[&Keypair]) {
        let blockhash = self.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), signers, blockhash);
        let res = self.svm.send_transaction(tx);
        if let Err(e) = res {
            panic!("transaction failed: {:?}\nlogs: {:#?}", e.err, e.meta.logs);
        }
    }

    /// Como `send`, pero NO hace panic en fallo: devuelve el resultado para que
    /// los tests de rechazo puedan afirmar `is_err()` e inspeccionar logs.
    /// Devuelve `Ok(logs)` en éxito y `Err(logs)` con los logs de la tx fallida.
    pub fn try_send(
        &mut self,
        ixs: &[Instruction],
        payer: &Keypair,
        signers: &[&Keypair],
    ) -> Result<Vec<String>, Vec<String>> {
        let blockhash = self.svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), signers, blockhash);
        match self.svm.send_transaction(tx) {
            Ok(meta) => Ok(meta.logs),
            Err(e) => Err(e.meta.logs),
        }
    }

    /// Lee el reloj actual del runtime.
    pub fn clock(&self) -> Clock {
        self.svm.get_sysvar::<Clock>()
    }

    /// Fija el `unix_timestamp` del reloj a `ts` (mantiene el resto del Clock).
    pub fn set_clock(&mut self, ts: i64) {
        let mut clock = self.svm.get_sysvar::<Clock>();
        clock.unix_timestamp = ts;
        self.svm.set_sysvar::<Clock>(&clock);
    }

    /// Avanza el reloj para superar `deadline` (deadline + 1).
    pub fn advance_clock_past(&mut self, deadline: i64) {
        self.set_clock(deadline + 1);
    }

    pub fn token_amount(&self, token_account: &Pubkey) -> u64 {
        let acc = self.svm.get_account(token_account).unwrap();
        spl_token_interface::state::Account::unpack(&acc.data)
            .unwrap()
            .amount
    }

    pub fn battle(&self, battle_pda: &Pubkey) -> battle_arena::state::Battle {
        let acc = self.svm.get_account(battle_pda).unwrap();
        // Saltar el discriminador Anchor de 8 bytes.
        battle_arena::state::Battle::try_deserialize(&mut &acc.data[..]).unwrap()
    }

    // ---- SPL helpers -------------------------------------------------------

    /// Crea un mint (cualquier decimales) cuya autoridad es `authority`.
    pub fn create_mint(&mut self, payer: &Keypair, authority: &Pubkey, decimals: u8) -> Keypair {
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
    pub fn create_token_account(
        &mut self,
        payer: &Keypair,
        mint: &Pubkey,
        owner: &Pubkey,
    ) -> Keypair {
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

    pub fn mint_to(&mut self, mint_authority: &Keypair, mint: &Pubkey, dest: &Pubkey, amount: u64) {
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

impl Default for Harness {
    fn default() -> Self {
        Self::new()
    }
}

/// Datos de un jugador montado: keypair + ATAs/NFT.
pub struct Player {
    pub kp: Keypair,
    pub stake_token: Pubkey,
    pub nft_mint: Pubkey,
    pub nft_token: Pubkey,
}

/// Número de error custom de Anchor para una variante de `ErrorCode`.
/// Las variantes custom empiezan en 6000 en el orden de declaración.
pub mod err {
    pub const WRONG_PHASE: u32 = 6000;
    pub const STALE_ATTESTATION: u32 = 6001;
    pub const BAD_ORACLE_SIG: u32 = 6002;
    pub const NFT_NOT_OWNED: u32 = 6003;
    pub const RATIO_CAP_EXCEEDED: u32 = 6004;
    pub const NON_POSITIVE_VALUE: u32 = 6005;
    pub const COMMIT_MISMATCH: u32 = 6006;
    pub const OVER_ALLOCATED: u32 = 6007;
    pub const ALREADY_COMMITTED: u32 = 6008;
    pub const MISSING_REVEALS: u32 = 6009;
    pub const DEADLINE_NOT_REACHED: u32 = 6010;
}

/// Afirma que los logs de una tx fallida contienen el error Anchor esperado,
/// ya sea por nombre (`name`, p. ej. "WrongPhase") o por código (`6000+idx`).
/// Anchor emite ambos: `Error Code: <Name>.` y `Error Number: <num>.`.
pub fn assert_error(logs: &[String], name: &str, code: u32) {
    let joined = logs.join("\n");
    assert!(
        joined.contains(name) || joined.contains(&format!("custom program error: {code}"))
            || joined.contains(&format!("Error Number: {code}")),
        "se esperaba el error `{name}` (code {code}) en los logs:\n{joined}"
    );
}

// ---- Builder de match completo --------------------------------------------

/// Configuración por defecto razonable; los tests la ajustan según el caso.
pub fn default_cfg() -> battle_arena::state::MatchConfig {
    battle_arena::state::MatchConfig {
        rounds_to_win: 2,
        base_energy: 10,
        max_edge: 4,
        value_ratio_cap: 4,
        max_rounds: 5,
        rake_bps: 0,
        edge_enabled: true,
    }
}

/// Monta el escenario completo de un match: payer, dos jugadores con ATAs de
/// stake (saldo holgado) y NFTs (supply 1), treasury, mint y PDAs derivadas.
/// No envía ninguna instrucción del programa; eso lo hacen `init`/`join`.
pub struct Match {
    pub stake: u64,
    pub nonce: u64,
    pub payer: Keypair,
    pub stake_mint: Keypair,
    pub treasury: Pubkey,
    pub pa: Player,
    pub pb: Player,
    pub battle_pda: Pubkey,
    pub vault_pda: Pubkey,
    pub initial_a: u64,
    pub initial_b: u64,
}

impl Match {
    /// Crea el escenario con `stake` y saldo inicial `funded` para cada jugador.
    pub fn setup(h: &mut Harness, stake: u64, funded: u64) -> Self {
        let payer = Keypair::new();
        h.airdrop(&payer.pubkey(), 100_000_000_000);
        let player_a = Keypair::new();
        let player_b = Keypair::new();
        h.airdrop(&player_a.pubkey(), 10_000_000_000);
        h.airdrop(&player_b.pubkey(), 10_000_000_000);

        let stake_mint = h.create_mint(&payer, &payer.pubkey(), 6);
        let a_stake = h.create_token_account(&payer, &stake_mint.pubkey(), &player_a.pubkey());
        let b_stake = h.create_token_account(&payer, &stake_mint.pubkey(), &player_b.pubkey());
        let treasury = h.create_token_account(&payer, &stake_mint.pubkey(), &payer.pubkey());
        h.mint_to(&payer, &stake_mint.pubkey(), &a_stake.pubkey(), funded);
        h.mint_to(&payer, &stake_mint.pubkey(), &b_stake.pubkey(), funded);

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

        Self {
            stake,
            nonce,
            payer,
            stake_mint,
            treasury: treasury.pubkey(),
            pa,
            pb,
            battle_pda,
            vault_pda,
            initial_a: funded,
            initial_b: funded,
        }
    }

    /// Construye (sin enviar) la ix `initialize_battle` para A con la atestación
    /// del oráculo. Devuelve `[ed25519_ix, init_ix]`.
    pub fn init_ixs(
        &self,
        h: &Harness,
        cfg: battle_arena::state::MatchConfig,
        value_a: u64,
        grade_a: u8,
        ts_a: i64,
        oracle_signer: &SigningKey,
    ) -> Vec<Instruction> {
        let msg_a = attestation_msg(&self.pa.nft_mint, value_a, grade_a, ts_a);
        let ed_a = ed25519_attest_ix(oracle_signer, &msg_a);
        let init_ix = Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::InitializeBattle {
                player_a: self.pa.kp.pubkey(),
                battle: self.battle_pda,
                stake_mint: self.stake_mint.pubkey(),
                escrow_vault: self.vault_pda,
                player_a_token: self.pa.stake_token,
                nft_token_a: self.pa.nft_token,
                instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID,
                token_program: TOKEN_PROGRAM_ID,
                system_program: solana_sdk_ids::system_program::ID,
                rent: solana_sdk_ids::sysvar::rent::ID,
            }
            .to_account_metas(None),
            data: battle_arena::instruction::InitializeBattle {
                nonce: self.nonce,
                stake: self.stake,
                cfg,
                oracle: h.oracle_pubkey,
                treasury: self.treasury,
                nft_mint_a: self.pa.nft_mint,
                value_usd_a: value_a,
                grade_a,
                ts_a,
                ed25519_ix_index: 0,
            }
            .data(),
        };
        vec![ed_a, init_ix]
    }

    /// Inicializa con cfg y valores dados (camino feliz, oráculo correcto).
    pub fn init(&self, h: &mut Harness, cfg: battle_arena::state::MatchConfig, value_a: u64, grade_a: u8) {
        let oracle = h.oracle.clone();
        let ixs = self.init_ixs(h, cfg, value_a, grade_a, FIXED_NOW, &oracle);
        h.send(&ixs, &self.pa.kp, &[&self.pa.kp]);
    }

    /// Construye (sin enviar) la ix `join_battle` para B.
    pub fn join_ixs(
        &self,
        h: &Harness,
        value_b: u64,
        grade_b: u8,
        ts_b: i64,
        oracle_signer: &SigningKey,
    ) -> Vec<Instruction> {
        let msg_b = attestation_msg(&self.pb.nft_mint, value_b, grade_b, ts_b);
        let ed_b = ed25519_attest_ix(oracle_signer, &msg_b);
        let join_ix = Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::JoinBattle {
                player_b: self.pb.kp.pubkey(),
                battle: self.battle_pda,
                escrow_vault: self.vault_pda,
                player_b_token: self.pb.stake_token,
                nft_token_b: self.pb.nft_token,
                instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID,
                token_program: TOKEN_PROGRAM_ID,
            }
            .to_account_metas(None),
            data: battle_arena::instruction::JoinBattle {
                nft_mint_b: self.pb.nft_mint,
                value_usd_b: value_b,
                grade_b,
                ts_b,
                ed25519_ix_index: 0,
            }
            .data(),
        };
        vec![ed_b, join_ix]
    }

    /// B se une (camino feliz, oráculo correcto).
    pub fn join(&self, h: &mut Harness, value_b: u64, grade_b: u8) {
        let oracle = h.oracle.clone();
        let ixs = self.join_ixs(h, value_b, grade_b, FIXED_NOW, &oracle);
        h.send(&ixs, &self.pb.kp, &[&self.pb.kp]);
    }

    /// Construye la ix `resolve_round`.
    pub fn resolve_ix(&self, h: &Harness) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::ResolveRound { battle: self.battle_pda }
                .to_account_metas(None),
            data: battle_arena::instruction::ResolveRound {}.data(),
        }
    }

    /// Construye la ix `settle` con las token accounts dadas (permite inyectar
    /// cuentas maliciosas en los tests de rechazo).
    pub fn settle_ix_with(
        &self,
        h: &Harness,
        player_a_token: Pubkey,
        player_b_token: Pubkey,
        treasury: Pubkey,
    ) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::Settle {
                battle: self.battle_pda,
                escrow_vault: self.vault_pda,
                player_a_token,
                player_b_token,
                treasury,
                token_program: TOKEN_PROGRAM_ID,
            }
            .to_account_metas(None),
            data: battle_arena::instruction::Settle {}.data(),
        }
    }

    /// `settle` con las cuentas legítimas vinculadas on-chain.
    pub fn settle_ix(&self, h: &Harness) -> Instruction {
        self.settle_ix_with(h, self.pa.stake_token, self.pb.stake_token, self.treasury)
    }

    /// Construye la ix `claim_timeout`.
    pub fn claim_timeout_ix(&self, h: &Harness) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::ClaimTimeout { battle: self.battle_pda }
                .to_account_metas(None),
            data: battle_arena::instruction::ClaimTimeout {}.data(),
        }
    }

    /// Juega una ronda completa: ambos hacen commit, ambos reveal y se resuelve.
    /// Usa salts derivados de `tag` para no colisionar entre rondas.
    pub fn play_round(&self, h: &mut Harness, alloc_a: Allocation, alloc_b: Allocation, tag: &str) {
        let salt_a = format!("a{tag}");
        let salt_b = format!("b{tag}");
        h.send(
            &[commit_ix(h, self.battle_pda, &self.pa.kp, battle_arena::hashing::commit_hash(&alloc_a, &salt_a))],
            &self.pa.kp,
            &[&self.pa.kp],
        );
        h.send(
            &[commit_ix(h, self.battle_pda, &self.pb.kp, battle_arena::hashing::commit_hash(&alloc_b, &salt_b))],
            &self.pb.kp,
            &[&self.pb.kp],
        );
        h.send(&[reveal_ix(h, self.battle_pda, &self.pa.kp, alloc_a, &salt_a)], &self.pa.kp, &[&self.pa.kp]);
        h.send(&[reveal_ix(h, self.battle_pda, &self.pb.kp, alloc_b, &salt_b)], &self.pb.kp, &[&self.pb.kp]);
        h.expire_blockhash();
        let resolve = self.resolve_ix(h);
        h.send(&[resolve], &self.payer, &[&self.payer]);
        h.expire_blockhash();
    }
}

/// Construye la ix `commit` para un jugador.
pub fn commit_ix(
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

/// Construye la ix `reveal` para un jugador.
pub fn reveal_ix(
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
