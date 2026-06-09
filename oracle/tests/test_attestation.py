import json
import os
import based58
from nacl.signing import SigningKey
from app.attestation import build_message, sign_attestation


FIX = os.path.join(os.path.dirname(__file__), "fixtures", "attestation_vectors.json")

# Batalla fija de 32 bytes cero (System Program) usada en los vectores de prueba.
BATTLE_ZERO = "11111111111111111111111111111111"


def test_message_layout():
    # mint de 32 bytes cero, value 1200, grade 9, ts 1700000000, battle de 32 bytes cero
    mint = "11111111111111111111111111111111"
    msg = build_message(mint, 1200, 9, 1700000000, BATTLE_ZERO)
    # Longitud: 32 (mint) + 8 (value_usd) + 1 (grade) + 8 (ts) + 32 (battle) = 81 bytes
    assert len(msg) == 81
    assert msg[:32] == b"\x00" * 32
    assert msg[32:40] == (1200).to_bytes(8, "little")
    assert msg[40] == 9
    assert msg[41:49] == (1700000000).to_bytes(8, "little", signed=True)
    # Los últimos 32 bytes son el battle (ceros).
    assert msg[49:81] == b"\x00" * 32


def test_message_changes_with_each_field():
    base = build_message("11111111111111111111111111111111", 1200, 9, 1700000000, BATTLE_ZERO)
    assert base != build_message("11111111111111111111111111111111", 1201, 9, 1700000000, BATTLE_ZERO)
    assert base != build_message("11111111111111111111111111111111", 1200, 8, 1700000000, BATTLE_ZERO)
    assert base != build_message("11111111111111111111111111111111", 1200, 9, 1700000001, BATTLE_ZERO)
    # Cambiar battle también cambia el mensaje.
    different_battle = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
    assert base != build_message("11111111111111111111111111111111", 1200, 9, 1700000000, different_battle)


def test_signature_verifies():
    key = SigningKey.generate()
    mint = "11111111111111111111111111111111"
    res = sign_attestation(key, mint, 1200, 9, 1700000000, BATTLE_ZERO)
    # la firma verifica con la verify_key
    msg = bytes.fromhex(res["message_hex"])
    key.verify_key.verify(msg, bytes.fromhex(res["signature_hex"]))
    assert res["message_hex"] == build_message(mint, 1200, 9, 1700000000, BATTLE_ZERO).hex()


def test_shared_vector_matches():
    with open(FIX) as f:
        vectors = json.load(f)
    for v in vectors:
        msg = build_message(v["mint"], v["value_usd"], v["grade"], v["ts"], v["battle"])
        assert msg.hex() == v["message_hex"], f"vector {v} desincronizado"
