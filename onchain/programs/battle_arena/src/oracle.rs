use anchor_lang::prelude::*;
use solana_instructions_sysvar::load_instruction_at_checked;
use solana_sdk_ids::ed25519_program::ID as ED25519_PROGRAM_ID;

use crate::error::ErrorCode;

/// Construye el mensaje canonico de atestacion del oraculo.
///
/// Layout: 32 (mint) + 8 (value_usd LE) + 1 (grade) + 8 (ts LE) = 49 bytes.
pub fn attestation_msg(nft_mint: &Pubkey, value_usd: u64, grade: u8, ts: i64) -> Vec<u8> {
    let mut v = Vec::with_capacity(49);
    v.extend_from_slice(nft_mint.as_ref());
    v.extend_from_slice(&value_usd.to_le_bytes());
    v.push(grade);
    v.extend_from_slice(&ts.to_le_bytes());
    v
}

/// Verifica una atestacion Ed25519 mediante introspeccion del sysvar de
/// instrucciones.
///
/// El patron estandar de Solana: la misma transaccion incluye una instruccion
/// nativa del programa Ed25519 que firma `expected_msg` con `expected_pubkey`.
/// El runtime ejecuta la verificacion criptografica real; aqui solo confirmamos
/// que esa instruccion existe y contiene los datos esperados.
pub fn verify_oracle_ed25519(
    instructions_sysvar: &AccountInfo,
    ed25519_ix_index: u8,
    expected_pubkey: &Pubkey,
    expected_msg: &[u8],
) -> Result<()> {
    // Cargar la instruccion indicada del sysvar de instrucciones.
    let ix = load_instruction_at_checked(ed25519_ix_index as usize, instructions_sysvar)
        .map_err(|_| error!(ErrorCode::BadOracleSig))?;

    // Debe ser el programa nativo Ed25519.
    require!(ix.program_id == ED25519_PROGRAM_ID, ErrorCode::BadOracleSig);

    let data = ix.data.as_slice();

    // Cabecera: 2 bytes (num_signatures + padding) + 14 bytes de offsets = 16.
    require!(data.len() >= 16, ErrorCode::BadOracleSig);

    // byte[0] = num_signatures, debe ser 1.
    require!(data[0] == 1, ErrorCode::BadOracleSig);

    // Offsets little-endian de la cabecera de la firma (empiezan en el byte 2).
    let public_key_offset = u16::from_le_bytes([data[6], data[7]]) as usize;
    let message_data_offset = u16::from_le_bytes([data[10], data[11]]) as usize;
    let message_data_size = u16::from_le_bytes([data[12], data[13]]) as usize;

    // Leer y comparar la clave publica (32 bytes).
    let pubkey_end = public_key_offset
        .checked_add(32)
        .ok_or_else(|| error!(ErrorCode::BadOracleSig))?;
    require!(pubkey_end <= data.len(), ErrorCode::BadOracleSig);
    let pubkey_bytes = &data[public_key_offset..pubkey_end];
    require!(
        pubkey_bytes == expected_pubkey.as_ref(),
        ErrorCode::BadOracleSig
    );

    // Leer y comparar el mensaje.
    let msg_end = message_data_offset
        .checked_add(message_data_size)
        .ok_or_else(|| error!(ErrorCode::BadOracleSig))?;
    require!(msg_end <= data.len(), ErrorCode::BadOracleSig);
    let msg_bytes = &data[message_data_offset..msg_end];
    require!(msg_bytes == expected_msg, ErrorCode::BadOracleSig);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attestation_msg_layout() {
        let mint = Pubkey::new_unique();
        let value_usd: u64 = 1_234_567;
        let grade: u8 = 7;
        let ts: i64 = 1_700_000_000;

        let msg = attestation_msg(&mint, value_usd, grade, ts);

        // Longitud total esperada.
        assert_eq!(msg.len(), 49);

        // Los primeros 32 bytes son el mint.
        assert_eq!(&msg[0..32], mint.as_ref());

        // value_usd LE en bytes 32..40.
        assert_eq!(&msg[32..40], &value_usd.to_le_bytes());

        // grade en el byte 40.
        assert_eq!(msg[40], grade);

        // ts LE en bytes 41..49.
        assert_eq!(&msg[41..49], &ts.to_le_bytes());
    }
}
