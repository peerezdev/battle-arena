//! Harness y builders de instrucción para los tests de Pack Battle.
//!
//! Proporciona `PackScenario`: un escenario listo con dos NFTs ya acuñados
//! en vaults cuyo owner es el PDA del pack (simulando la entrega del gacha).
//!
//! Los builders de instrucción (`create_ix`, `join_ix`, `deposit_ixs`,
//! `settle_direct_ix`, `claim_timeout_ix`) devuelven instrucciones Anchor con
//! los tipos generados exactos del crate `battle_arena`.

#![allow(dead_code)]

use anchor_lang::{InstructionData, ToAccountMetas};
use crate::common::*;
use ed25519_dalek::SigningKey;
use solana_instruction::Instruction;
use solana_keypair::Keypair;
use solana_pubkey::Pubkey;
use solana_signer::Signer;

/// Escenario completo de un Pack Battle:
/// - Dos jugadores (player_a, player_b) con SOL.
/// - NFT A en vault_a (owner=pack PDA); NFT B en vault_b (owner=pack PDA).
/// - Cuentas destino para cada combinación (quién recibe qué carta).
pub struct PackScenario {
    pub payer: Keypair,
    pub player_a: Keypair,
    pub player_b: Keypair,
    pub nonce: u64,
    pub pack_pda: Pubkey,
    // Carta de A
    pub nft_mint_a: Pubkey,
    pub vault_a: Pubkey,
    pub dest_a_for_a: Pubkey, // nft_mint_a → player_a
    pub dest_a_for_b: Pubkey, // nft_mint_a → player_b
    // Carta de B
    pub nft_mint_b: Pubkey,
    pub vault_b: Pubkey,
    pub dest_b_for_a: Pubkey, // nft_mint_b → player_a
    pub dest_b_for_b: Pubkey, // nft_mint_b → player_b
}

impl PackScenario {
    /// Monta el escenario completo sin enviar ninguna instrucción del programa.
    /// Los NFTs ya están acuñados en los vaults PDA-owned, listos para que
    /// `deposit_card` los valide.
    pub fn setup(h: &mut Harness) -> Self {
        let payer = Keypair::new();
        h.airdrop(&payer.pubkey(), 100_000_000_000);
        let player_a = Keypair::new();
        let player_b = Keypair::new();
        h.airdrop(&player_a.pubkey(), 10_000_000_000);
        h.airdrop(&player_b.pubkey(), 10_000_000_000);

        let nonce: u64 = 1;
        let (pack_pda, _) = Pubkey::find_program_address(
            &[b"pack", player_a.pubkey().as_ref(), &nonce.to_le_bytes()],
            &battle_arena::id(),
        );

        // NFT A: acuñado en vault_a cuyo owner es el pack PDA.
        let nft_mint_a = h.create_mint(&payer, &payer.pubkey(), 0);
        let vault_a = h.create_token_account(&payer, &nft_mint_a.pubkey(), &pack_pda);
        h.mint_to(&payer, &nft_mint_a.pubkey(), &vault_a.pubkey(), 1);
        let dest_a_for_a =
            h.create_token_account(&payer, &nft_mint_a.pubkey(), &player_a.pubkey());
        let dest_a_for_b =
            h.create_token_account(&payer, &nft_mint_a.pubkey(), &player_b.pubkey());

        // NFT B: acuñado en vault_b cuyo owner es el pack PDA.
        let nft_mint_b = h.create_mint(&payer, &payer.pubkey(), 0);
        let vault_b = h.create_token_account(&payer, &nft_mint_b.pubkey(), &pack_pda);
        h.mint_to(&payer, &nft_mint_b.pubkey(), &vault_b.pubkey(), 1);
        let dest_b_for_a =
            h.create_token_account(&payer, &nft_mint_b.pubkey(), &player_a.pubkey());
        let dest_b_for_b =
            h.create_token_account(&payer, &nft_mint_b.pubkey(), &player_b.pubkey());

        Self {
            payer,
            player_a,
            player_b,
            nonce,
            pack_pda,
            nft_mint_a: nft_mint_a.pubkey(),
            vault_a: vault_a.pubkey(),
            dest_a_for_a: dest_a_for_a.pubkey(),
            dest_a_for_b: dest_a_for_b.pubkey(),
            nft_mint_b: nft_mint_b.pubkey(),
            vault_b: vault_b.pubkey(),
            dest_b_for_a: dest_b_for_a.pubkey(),
            dest_b_for_b: dest_b_for_b.pubkey(),
        }
    }

    /// Instrucción `create_pack_battle` (firmada por player_a).
    pub fn create_ix(&self, h: &Harness) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::CreatePackBattle {
                player_a: self.player_a.pubkey(),
                pack: self.pack_pda,
                system_program: solana_sdk_ids::system_program::ID,
            }
            .to_account_metas(None),
            data: battle_arena::instruction::CreatePackBattle {
                nonce: self.nonce,
                oracle: h.oracle_pubkey,
                mode: battle_arena::pack_state::PackMode::Direct,
            }
            .data(),
        }
    }

    /// Instrucción `join_pack_battle` (firmada por player_b).
    pub fn join_ix(&self, h: &Harness) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::JoinPackBattle {
                player_b: self.player_b.pubkey(),
                pack: self.pack_pda,
            }
            .to_account_metas(None),
            data: battle_arena::instruction::JoinPackBattle {}.data(),
        }
    }

    /// Devuelve `[ed25519_ix, deposit_ix]` para el depositor indicado.
    /// `ed25519_ix_index: 0` porque el ix Ed25519 va en primer lugar de la tx.
    pub fn deposit_ixs(
        &self,
        h: &Harness,
        depositor: &Keypair,
        vault: Pubkey,
        nft_mint: Pubkey,
        value: u64,
        grade: u8,
        oracle: &SigningKey,
    ) -> Vec<Instruction> {
        let msg = attestation_msg(&nft_mint, value, grade, FIXED_NOW, &self.pack_pda);
        let ed = ed25519_attest_ix(oracle, &msg);
        let dep = Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::DepositCard {
                depositor: depositor.pubkey(),
                pack: self.pack_pda,
                vault,
                instructions_sysvar: solana_sdk_ids::sysvar::instructions::ID,
            }
            .to_account_metas(None),
            data: battle_arena::instruction::DepositCard {
                nft_mint,
                value_usd: value,
                grade,
                ts: FIXED_NOW,
                ed25519_ix_index: 0,
            }
            .data(),
        };
        vec![ed, dep]
    }

    /// Instrucción `settle_direct` con los destinos indicados.
    pub fn settle_direct_ix(&self, h: &Harness, dest_a: Pubkey, dest_b: Pubkey) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::SettleDirect {
                pack: self.pack_pda,
                vault_a: self.vault_a,
                vault_b: self.vault_b,
                dest_a,
                dest_b,
                token_program: TOKEN_PROGRAM_ID,
            }
            .to_account_metas(None),
            data: battle_arena::instruction::SettleDirect {}.data(),
        }
    }

    /// Instrucción `claim_pack_timeout` (permisionless).
    pub fn claim_timeout_ix(&self, h: &Harness, vault: Pubkey, dest: Pubkey) -> Instruction {
        Instruction {
            program_id: h.program_id,
            accounts: battle_arena::accounts::ClaimPackTimeout {
                pack: self.pack_pda,
                vault,
                dest,
                token_program: TOKEN_PROGRAM_ID,
            }
            .to_account_metas(None),
            data: battle_arena::instruction::ClaimPackTimeout {}.data(),
        }
    }
}
