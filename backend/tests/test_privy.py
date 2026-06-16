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
