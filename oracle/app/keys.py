import json
import os
import based58
from nacl.signing import SigningKey


def load_or_create_signing_key(path: str) -> SigningKey:
    """Carga la semilla de 32 bytes (hex) desde `path`, o genera y persiste una nueva (solo dev)."""
    if os.path.exists(path):
        with open(path) as f:
            data = json.load(f)
        seed = bytes.fromhex(data["seed_hex"])
        return SigningKey(seed)
    key = SigningKey.generate()
    with open(path, "w") as f:
        json.dump({"seed_hex": bytes(key).hex()}, f)
    return key


def pubkey_base58(key: SigningKey) -> str:
    return based58.b58encode(bytes(key.verify_key)).decode()
