import json
import time
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from app.privy import PrivyVerifier, PrivyAuthError


def _es256():
    return ec.generate_private_key(ec.SECP256R1())


def _make_token(priv, app_id, sub="did:privy:abc", extra=None, exp_delta=3600):
    now = int(time.time())
    payload = {"aud": app_id, "iss": "privy.io", "sub": sub, "iat": now, "exp": now + exp_delta}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, priv, algorithm="ES256", headers={"kid": "test-kid", "alg": "ES256"})


def test_verifies_valid_token_and_returns_sub():
    priv = _es256()
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: priv.public_key())
    claims = v.verify(_make_token(priv, "app123"))
    assert claims["sub"] == "did:privy:abc"


def test_rejects_wrong_audience():
    priv = _es256()
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: priv.public_key())
    with pytest.raises(PrivyAuthError):
        v.verify(_make_token(priv, "other-app"))


def test_rejects_expired():
    priv = _es256()
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: priv.public_key())
    with pytest.raises(PrivyAuthError):
        v.verify(_make_token(priv, "app123", exp_delta=-10))


def test_rejects_tampered_signature():
    priv, other = _es256(), _es256()
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: other.public_key())
    with pytest.raises(PrivyAuthError):
        v.verify(_make_token(priv, "app123"))


def _make_id_token(priv, app_id, linked_accounts, sub="did:privy:abc", exp_delta=3600):
    now = int(time.time())
    payload = {"aud": app_id, "iss": "privy.io", "sub": sub, "iat": now, "exp": now + exp_delta,
               "linked_accounts": json.dumps(linked_accounts)}
    return jwt.encode(payload, priv, algorithm="ES256", headers={"kid": "test-kid", "alg": "ES256"})


def _solana_embedded(addr):
    """Forma REAL del identity token de Privy: connector_type None, la embedded se
    distingue por wallet_client_type == "privy"."""
    return {"type": "wallet", "chain_type": "solana", "connector_type": None,
            "wallet_client_type": "privy", "address": addr}


def _solana_external(addr, client="Phantom"):
    """Wallet externa de Solana vinculada (p.ej. Phantom): wallet_client_type != 'privy'."""
    return {"type": "wallet", "chain_type": "solana", "connector_type": None,
            "wallet_client_type": client, "address": addr}


def test_embedded_solana_wallet_extracts_address():
    priv = _es256()
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: priv.public_key())
    tok = _make_id_token(priv, "app123", [
        {"type": "email", "address": "a@b.c"},
        {"type": "wallet", "chain_type": "ethereum", "connector_type": "embedded", "address": "0xabc"},
        _solana_embedded("So1anaAddr111111111111111111111111111111111"),
    ])
    assert v.embedded_solana_wallet(tok) == "So1anaAddr111111111111111111111111111111111"


def test_embedded_solana_wallet_picks_embedded_over_external_phantom():
    """Regresión: el identity token real trae Phantom + embedded, ambas con
    connector_type None. Debe devolver la embedded (wallet_client_type 'privy'),
    NO la externa Phantom. (Antes el matcher exigía connector_type=='embedded' y
    fallaba con 'sin embedded Solana wallet' → el chat respondía login_required.)"""
    priv = _es256()
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: priv.public_key())
    tok = _make_id_token(priv, "app123", [
        _solana_external("PhantomExternalAddr2222222222222222222222222"),
        _solana_embedded("EmbeddedPrivyAddr11111111111111111111111111"),
    ])
    assert v.embedded_solana_wallet(tok) == "EmbeddedPrivyAddr11111111111111111111111111"


def test_embedded_solana_wallet_rejects_only_external():
    """Si solo hay una wallet externa de Solana (sin embedded), debe rechazar."""
    priv = _es256()
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: priv.public_key())
    tok = _make_id_token(priv, "app123", [
        _solana_external("PhantomExternalAddr2222222222222222222222222"),
    ])
    with pytest.raises(PrivyAuthError):
        v.embedded_solana_wallet(tok)


def test_embedded_solana_wallet_requires_embedded_solana():
    priv = _es256()
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: priv.public_key())
    tok = _make_id_token(priv, "app123", [
        {"type": "wallet", "chain_type": "solana", "connector_type": "wallet_connect", "address": "ext"},
    ])
    with pytest.raises(PrivyAuthError):
        v.embedded_solana_wallet(tok)


def test_embedded_solana_wallet_rejects_tampered():
    priv, other = _es256(), _es256()
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: other.public_key())
    tok = _make_id_token(priv, "app123", [_solana_embedded("x")])
    with pytest.raises(PrivyAuthError):
        v.embedded_solana_wallet(tok)
