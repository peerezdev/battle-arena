import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app.db import make_engine, make_session_factory, init_db


@pytest.fixture
def Session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    return make_session_factory(engine)


# ── Helpers compartidos de Privy para tests de API ───────────────────────────

def make_es256():
    """Genera una clave privada EC/P-256 para tests."""
    return ec.generate_private_key(ec.SECP256R1())


def make_id_token(priv, app_id, linked_accounts, sub="did:privy:abc", exp_delta=3600):
    """Construye un identity token de Privy firmado con `priv`."""
    now = int(time.time())
    payload = {
        "aud": app_id,
        "iss": "privy.io",
        "sub": sub,
        "iat": now,
        "exp": now + exp_delta,
        "linked_accounts": json.dumps(linked_accounts),
    }
    return jwt.encode(payload, priv, algorithm="ES256", headers={"kid": "test-kid", "alg": "ES256"})


def solana_embedded(addr):
    """Devuelve un linked_account de embedded Solana wallet con la forma REAL del
    identity token de Privy: connector_type viene None y la embedded se identifica
    por wallet_client_type == "privy"."""
    return {"type": "wallet", "chain_type": "solana", "connector_type": None,
            "wallet_client_type": "privy", "address": addr}


def privy_auth_headers(priv, app_id, wallet_addr):
    """Devuelve un dict de headers Authorization para autenticar como `wallet_addr`."""
    token = make_id_token(priv, app_id, [solana_embedded(wallet_addr)])
    return {"Authorization": f"Bearer {token}"}
