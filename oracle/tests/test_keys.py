import os
from app.keys import load_or_create_signing_key, pubkey_base58
from nacl.signing import SigningKey


def test_load_or_create_persists(tmp_path):
    p = str(tmp_path / "k.json")
    k1 = load_or_create_signing_key(p)
    assert isinstance(k1, SigningKey)
    assert os.path.exists(p)
    k2 = load_or_create_signing_key(p)  # reload, debe ser la misma
    assert bytes(k1.verify_key) == bytes(k2.verify_key)


def test_pubkey_base58_len(tmp_path):
    k = load_or_create_signing_key(str(tmp_path / "k.json"))
    b58 = pubkey_base58(k)
    assert isinstance(b58, str) and 32 <= len(b58) <= 44
