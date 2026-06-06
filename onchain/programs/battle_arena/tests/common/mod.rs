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
