import based58
from nacl.signing import SigningKey


def build_message(mint_b58: str, value_usd: int, grade: int, ts: int, battle_b58: str) -> bytes:
    """Mensaje canónico idéntico a attestation_msg del contrato:
    mint(32) || value_usd(8 LE u64) || grade(1) || ts(8 LE i64) || battle(32) = 81 bytes.
    El campo battle liga la atestación al PDA concreto de la batalla (anti-replay)."""
    mint_bytes = based58.b58decode(mint_b58.encode())
    if len(mint_bytes) != 32:
        raise ValueError(f"mint no es 32 bytes: {mint_b58}")
    battle_bytes = based58.b58decode(battle_b58.encode())
    if len(battle_bytes) != 32:
        raise ValueError(f"battle no es 32 bytes: {battle_b58}")
    out = bytearray()
    out += mint_bytes
    out += int(value_usd).to_bytes(8, "little", signed=False)
    out += int(grade).to_bytes(1, "little", signed=False)
    out += int(ts).to_bytes(8, "little", signed=True)
    out += battle_bytes
    return bytes(out)


def sign_attestation(key: SigningKey, mint_b58: str, value_usd: int, grade: int, ts: int, battle_b58: str) -> dict:
    msg = build_message(mint_b58, value_usd, grade, ts, battle_b58)
    sig = key.sign(msg).signature
    return {"message_hex": msg.hex(), "signature_hex": sig.hex()}
