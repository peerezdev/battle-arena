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

    // Delegar el parseo/validacion de los bytes a la funcion pura testeable.
    verify_ed25519_ix_data(&ix.data, expected_pubkey, expected_msg)
}

/// Valida los bytes de una instrucción Ed25519Program de UNA firma:
/// confirma num_signatures==1, que los índices de instrucción son auto-referenciales (0xFFFF),
/// y que pubkey y mensaje embebidos casan con lo esperado. NO comprueba la firma criptográfica
/// (eso lo hace el runtime al ejecutar la ix nativa); aquí ligamos (pubkey, msg) a la verificación.
pub fn verify_ed25519_ix_data(
    data: &[u8],
    expected_pubkey: &Pubkey,
    expected_msg: &[u8],
) -> Result<()> {
    // Cabecera: 2 bytes (num_signatures + padding) + 14 bytes de offsets = 16.
    require!(data.len() >= 16, ErrorCode::BadOracleSig);

    // byte[0] = num_signatures, debe ser 1.
    require!(data[0] == 1, ErrorCode::BadOracleSig);

    // CRITICO: los indices de instruccion deben ser auto-referenciales (0xFFFF).
    // Si no lo son, el runtime resuelve pubkey/mensaje desde OTRA instruccion de la
    // misma tx (verificando una atestacion legitima pero ajena), mientras este codigo
    // compara los bytes de ESTA instruccion. Un atacante explotaria esa divergencia
    // para colar una atestacion forjada. Por eso solo aceptamos el caso 0xFFFF, que
    // es el unico en el que los offsets que leemos abajo son validos contra `data`.
    let signature_instruction_index = u16::from_le_bytes([data[4], data[5]]);
    let public_key_instruction_index = u16::from_le_bytes([data[8], data[9]]);
    let message_instruction_index = u16::from_le_bytes([data[14], data[15]]);
    // Defensa en profundidad: tambien la firma debe ser auto-referencial.
    require!(
        signature_instruction_index == u16::MAX,
        ErrorCode::BadOracleSig
    );
    require!(
        public_key_instruction_index == u16::MAX,
        ErrorCode::BadOracleSig
    );
    require!(
        message_instruction_index == u16::MAX,
        ErrorCode::BadOracleSig
    );

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

    /// Construye un buffer de datos de instruccion Ed25519Program de UNA firma,
    /// con indices auto-referenciales (0xFFFF) y los offsets/tamanos colocados
    /// correctamente. Layout: cabecera de 16 bytes, luego firma (64B), pubkey (32B)
    /// y mensaje, concatenados.
    fn build_ed25519_ix_data(pubkey: &Pubkey, msg: &[u8]) -> Vec<u8> {
        const HEADER: usize = 16;
        let signature_offset: u16 = HEADER as u16;
        let public_key_offset: u16 = signature_offset + 64;
        let message_data_offset: u16 = public_key_offset + 32;
        let message_data_size: u16 = msg.len() as u16;

        let mut data = Vec::new();
        data.push(1u8); // [0] num_signatures
        data.push(0u8); // [1] padding
        data.extend_from_slice(&signature_offset.to_le_bytes()); // [2..4]
        data.extend_from_slice(&u16::MAX.to_le_bytes()); // [4..6] signature_instruction_index
        data.extend_from_slice(&public_key_offset.to_le_bytes()); // [6..8]
        data.extend_from_slice(&u16::MAX.to_le_bytes()); // [8..10] public_key_instruction_index
        data.extend_from_slice(&message_data_offset.to_le_bytes()); // [10..12]
        data.extend_from_slice(&message_data_size.to_le_bytes()); // [12..14]
        data.extend_from_slice(&u16::MAX.to_le_bytes()); // [14..16] message_instruction_index

        // Cuerpo: firma (64B dummy), pubkey (32B), mensaje.
        data.extend_from_slice(&[0u8; 64]);
        data.extend_from_slice(pubkey.as_ref());
        data.extend_from_slice(msg);
        data
    }

    #[test]
    fn accepts_valid_self_referential() {
        let pk = Pubkey::new_unique();
        let msg = attestation_msg(&pk, 1000, 5, 1_700_000_000);
        let data = build_ed25519_ix_data(&pk, &msg);
        assert!(verify_ed25519_ix_data(&data, &pk, &msg).is_ok());
    }

    #[test]
    fn rejects_redirected_pubkey_index() {
        // ATAQUE CRITICO: public_key_instruction_index apunta a otra instruccion (0).
        let pk = Pubkey::new_unique();
        let msg = attestation_msg(&pk, 1000, 5, 1_700_000_000);
        let mut data = build_ed25519_ix_data(&pk, &msg);
        data[8..10].copy_from_slice(&0u16.to_le_bytes());
        assert!(verify_ed25519_ix_data(&data, &pk, &msg).is_err());
    }

    #[test]
    fn rejects_redirected_message_index() {
        // ATAQUE CRITICO: message_instruction_index apunta a otra instruccion (0).
        let pk = Pubkey::new_unique();
        let msg = attestation_msg(&pk, 1000, 5, 1_700_000_000);
        let mut data = build_ed25519_ix_data(&pk, &msg);
        data[14..16].copy_from_slice(&0u16.to_le_bytes());
        assert!(verify_ed25519_ix_data(&data, &pk, &msg).is_err());
    }

    #[test]
    fn rejects_num_sigs_not_one() {
        let pk = Pubkey::new_unique();
        let msg = attestation_msg(&pk, 1000, 5, 1_700_000_000);

        let mut zero = build_ed25519_ix_data(&pk, &msg);
        zero[0] = 0;
        assert!(verify_ed25519_ix_data(&zero, &pk, &msg).is_err());

        let mut two = build_ed25519_ix_data(&pk, &msg);
        two[0] = 2;
        assert!(verify_ed25519_ix_data(&two, &pk, &msg).is_err());
    }

    #[test]
    fn rejects_short_data() {
        let pk = Pubkey::new_unique();
        let msg = attestation_msg(&pk, 1000, 5, 1_700_000_000);
        let data = vec![1u8; 15]; // < 16
        assert!(verify_ed25519_ix_data(&data, &pk, &msg).is_err());
    }

    #[test]
    fn rejects_wrong_pubkey() {
        let pk = Pubkey::new_unique();
        let other = Pubkey::new_unique();
        let msg = attestation_msg(&pk, 1000, 5, 1_700_000_000);
        let data = build_ed25519_ix_data(&pk, &msg);
        assert!(verify_ed25519_ix_data(&data, &other, &msg).is_err());
    }

    #[test]
    fn rejects_wrong_message() {
        let pk = Pubkey::new_unique();
        let msg = attestation_msg(&pk, 1000, 5, 1_700_000_000);
        let forged = attestation_msg(&pk, 9999, 5, 1_700_000_000);
        let data = build_ed25519_ix_data(&pk, &msg);
        assert!(verify_ed25519_ix_data(&data, &pk, &forged).is_err());
    }

    #[test]
    fn rejects_oob_offset() {
        let pk = Pubkey::new_unique();
        let msg = attestation_msg(&pk, 1000, 5, 1_700_000_000);
        let mut data = build_ed25519_ix_data(&pk, &msg);
        // message_data_offset mas alla del final del buffer.
        data[10..12].copy_from_slice(&u16::MAX.to_le_bytes());
        assert!(verify_ed25519_ix_data(&data, &pk, &msg).is_err());
    }

    #[test]
    fn shared_attestation_vector_matches() {
        // Fixture compartido con el oráculo Python.
        // La ruta es relativa a este archivo fuente (src/oracle.rs).
        let fixture = include_str!("../tests/fixtures/attestation_vectors.json");

        // Extracción mínima del primer "message_hex" sin dependencia externa.
        let key = "\"message_hex\"";
        let key_pos = fixture
            .find(key)
            .expect("fixture debe contener message_hex");
        let after_key = &fixture[key_pos + key.len()..];
        // Avanzar hasta la primera comilla de apertura del valor.
        let open = after_key.find('"').expect("comilla de apertura del valor");
        let value_start = &after_key[open + 1..];
        let close = value_start.find('"').expect("comilla de cierre del valor");
        let expected_hex = &value_start[..close];

        // Construir el mensaje con los parámetros del primer vector.
        let msg = attestation_msg(&Pubkey::new_from_array([0u8; 32]), 1200, 9, 1700000000);
        let built_hex: String = msg.iter().map(|b| format!("{:02x}", b)).collect();

        assert_eq!(
            built_hex, expected_hex,
            "El formato del mensaje del contrato difiere del fixture del oráculo.\n  contrato: {}\n  fixture:  {}",
            built_hex, expected_hex
        );
    }

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
