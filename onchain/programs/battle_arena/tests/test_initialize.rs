use {litesvm::LiteSVM, solana_keypair::Keypair, solana_signer::Signer};

/// Smoke test de despliegue: el programa carga en LiteSVM.
///
/// El instruction de plantilla `initialize` fue reemplazado por las 7
/// instrucciones reales (initialize_battle, join_battle, commit, reveal,
/// resolve_round, settle, claim_timeout). El flujo end-to-end (incluyendo
/// cuentas SPL, NFT y la atestación Ed25519 del oráculo) se ejercita en
/// `tests/integration.rs` sobre LiteSVM. Aquí solo se confirma que el binario
/// compilado se despliega sin error.
#[test]
fn program_loads() {
    let program_id = battle_arena::id();
    let payer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/battle_arena.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    assert_eq!(battle_arena::id(), program_id);
}
