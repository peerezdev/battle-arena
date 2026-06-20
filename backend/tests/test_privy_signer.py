import base64, json
import pytest, respx
from httpx import Response
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
from app.services.privy_signer import PrivySigner, PrivySignerError, authorization_signature

def _p256_pem():
    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption()).decode(), key.public_key()

def test_authorization_signature_is_verifiable_p256():
    pem, pub = _p256_pem()
    body = {"method": "signAndSendTransaction", "caip2": "solana:dev", "params": {"transaction": "AA", "encoding": "base64"}}
    sig = authorization_signature("POST", "https://api.privy.io/v1/wallets/w1/rpc", body, "app123", pem)
    # canonical payload must match what we signed
    payload = {"version": 1, "method": "POST", "url": "https://api.privy.io/v1/wallets/w1/rpc",
               "body": body, "headers": {"privy-app-id": "app123"}}
    msg = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    pub.verify(base64.b64decode(sig), msg, ec.ECDSA(hashes.SHA256()))  # raises if invalid

@respx.mock
@pytest.mark.asyncio
async def test_sign_and_send_builds_request_and_returns_hash():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(
        return_value=Response(200, json={"data": {"hash": "SIG123", "caip2": "solana:dev"}}))
    s = PrivySigner(app_id="app123", app_secret="sek", auth_key_pem=pem, cluster_caip2="solana:dev")
    out = await s.sign_and_send_solana("w1", "BASE64TX")
    assert out == "SIG123"
    req = route.calls.last.request
    assert req.headers["privy-app-id"] == "app123"
    assert req.headers["authorization"].startswith("Basic ")
    assert "privy-authorization-signature" in req.headers
    sent = json.loads(req.content)
    assert sent["method"] == "signAndSendTransaction"
    assert sent["caip2"] == "solana:dev"
    assert sent["params"] == {"transaction": "BASE64TX", "encoding": "base64"}

@respx.mock
@pytest.mark.asyncio
async def test_sign_and_send_raises_on_error():
    pem, _ = _p256_pem()
    respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(return_value=Response(400, json={"error": "bad"}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev")
    with pytest.raises(PrivySignerError):
        await s.sign_and_send_solana("w1", "TX")

def test_disabled_without_auth_key():
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem="", cluster_caip2="solana:dev")
    assert s.enabled is False

@pytest.mark.asyncio
async def test_create_solana_wallet_raises_when_disabled():
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem="", cluster_caip2="solana:dev")
    with pytest.raises(PrivySignerError, match="privy signer disabled"):
        await s.create_solana_wallet()

@respx.mock
@pytest.mark.asyncio
async def test_sign_and_send_sponsor_flag():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(
        return_value=Response(200, json={"data": {"hash": "H"}}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev")
    await s.sign_and_send_solana("w1", "TX", sponsor=True)
    assert json.loads(route.calls.last.request.content)["sponsor"] is True

@respx.mock
@pytest.mark.asyncio
async def test_create_solana_wallet():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets").mock(
        return_value=Response(200, json={"id": "wid", "address": "ADDR", "chain_type": "solana"}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev",
                    quorum_id="kq1")
    out = await s.create_solana_wallet()
    assert out == {"id": "wid", "address": "ADDR"}
    sent = json.loads(route.calls.last.request.content)
    assert sent["chain_type"] == "solana" and sent["owner_id"] == "kq1"
