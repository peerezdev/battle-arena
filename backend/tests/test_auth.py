import pytest
import based58
from nacl.signing import SigningKey
from app.auth import AuthService, auth_message, AuthError


def _wallet(key: SigningKey) -> str:
    return based58.b58encode(bytes(key.verify_key)).decode()


def test_nonce_then_verify_issues_token():
    key = SigningKey.generate()
    wallet = _wallet(key)
    auth = AuthService(nonce_fn=lambda: "NONCE123", token_fn=lambda: "TOK", now_fn=lambda: 1000, ttl=3600)
    nonce = auth.issue_nonce(wallet)
    assert nonce == "NONCE123"
    sig = key.sign(auth_message(nonce).encode()).signature
    token = auth.verify(wallet, sig.hex())
    assert token == "TOK"
    assert auth.wallet_for_token("TOK") == wallet


def test_bad_signature_rejected():
    key = SigningKey.generate()
    other = SigningKey.generate()
    wallet = _wallet(key)
    auth = AuthService(nonce_fn=lambda: "N", token_fn=lambda: "T", now_fn=lambda: 0, ttl=3600)
    auth.issue_nonce(wallet)
    bad = other.sign(auth_message("N").encode()).signature  # firma de otra clave
    with pytest.raises(AuthError):
        auth.verify(wallet, bad.hex())


def test_verify_without_nonce_rejected():
    key = SigningKey.generate()
    auth = AuthService(nonce_fn=lambda: "N", token_fn=lambda: "T", now_fn=lambda: 0, ttl=3600)
    with pytest.raises(AuthError):
        auth.verify(_wallet(key), "00")


def test_nonce_single_use_replay():
    key = SigningKey.generate(); wallet = _wallet(key)
    auth = AuthService(nonce_fn=lambda: "N", token_fn=lambda: "T", now_fn=lambda: 0, ttl=3600)
    auth.issue_nonce(wallet)
    sig = key.sign(auth_message("N").encode()).signature.hex()
    auth.verify(wallet, sig)            # primer uso OK
    with pytest.raises(AuthError):
        auth.verify(wallet, sig)        # replay del mismo nonce/firma -> rechazado


def test_expired_token_returns_none():
    t = {"v": 0}
    auth = AuthService(nonce_fn=lambda: "N", token_fn=lambda: "T", now_fn=lambda: t["v"], ttl=10)
    key = SigningKey.generate(); wallet = _wallet(key)
    auth.issue_nonce(wallet)
    sig = key.sign(auth_message("N").encode()).signature
    auth.verify(wallet, sig.hex())
    t["v"] = 100  # pasa el TTL
    assert auth.wallet_for_token("T") is None
