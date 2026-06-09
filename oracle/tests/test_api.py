import pytest
import based58
from fastapi.testclient import TestClient
from nacl.signing import SigningKey
from tests.conftest import MINT_HAPPY, MINT_NOVALUE
from app.main import create_app
from app.pricing.base import PricingSource, CardValue, ValueUnavailable

# Batalla fija de 32 bytes cero (System Program) para los tests.
BATTLE_ZERO = "11111111111111111111111111111111"


def test_health(client):
    c, _ = client
    r = c.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_pubkey(client):
    c, key = client
    r = c.get("/pubkey")
    assert r.status_code == 200
    assert r.json()["oracle_pubkey"] == based58.b58encode(bytes(key.verify_key)).decode()


def test_attest_happy(client):
    c, key = client
    r = c.get("/attest", params={"mint": MINT_HAPPY, "battle": BATTLE_ZERO})
    assert r.status_code == 200
    body = r.json()
    assert body["value_usd"] == 1200 and body["grade"] == 9 and body["ts"] == 1700000000
    # la firma verifica
    key.verify_key.verify(bytes.fromhex(body["message_hex"]), bytes.fromhex(body["signature_hex"]))


def test_attest_unavailable(client):
    c, _ = client
    r = c.get("/attest", params={"mint": MINT_NOVALUE, "battle": BATTLE_ZERO})
    assert r.status_code == 409


def test_attest_missing_battle(client):
    """Sin el parámetro battle → 422 (parámetro obligatorio)."""
    c, _ = client
    r = c.get("/attest", params={"mint": MINT_HAPPY})
    assert r.status_code == 422


def test_attest_invalid_battle(client):
    """battle que no decodifica a 32 bytes → 422."""
    c, _ = client
    r = c.get("/attest", params={"mint": MINT_HAPPY, "battle": "notvalidbattle!!!"})
    assert r.status_code == 422


def test_attest_invalid_mint(client):
    c, _ = client
    r = c.get("/attest", params={"mint": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "battle": BATTLE_ZERO})  # 32 chars but decodes to <32 bytes
    assert r.status_code == 422  # mint de longitud inválida → siempre 422


def test_attest_invalid_mint_not_base58(client):
    c, _ = client
    r = c.get("/attest", params={"mint": "not-a-base58-mint!!!", "battle": BATTLE_ZERO})
    assert r.status_code == 422


def test_attest_invalid_mint_does_not_call_pricing():
    """Mint inválido → 422 sin llamar al pricing source (FIX B)."""
    call_count = 0

    class TrackingSource(PricingSource):
        async def get_value(self, mint: str) -> CardValue:
            nonlocal call_count
            call_count += 1
            raise ValueUnavailable("should not be called")

    key = SigningKey.generate()
    app = create_app(signing_key=key, pricing=TrackingSource(),
                     now_fn=lambda: 0, rate_limit_per_min=0)
    c = TestClient(app)
    r = c.get("/attest", params={"mint": "tooshort", "battle": BATTLE_ZERO})
    assert r.status_code == 422
    assert call_count == 0  # pricing source never called


def test_rate_limiter_returns_429():
    """Rate limiter retorna 429 cuando se supera el límite (FIX C)."""
    from app.pricing.mock import MockPricingSource
    key = SigningKey.generate()
    src = MockPricingSource(overrides={MINT_HAPPY: {"value_usd": 100, "grade": 5, "grading_company": "PSA"}})
    app = create_app(signing_key=key, pricing=src, now_fn=lambda: 1700000000,
                     rate_limit_per_min=2)
    c = TestClient(app)
    r1 = c.get("/attest", params={"mint": MINT_HAPPY, "battle": BATTLE_ZERO})
    r2 = c.get("/attest", params={"mint": MINT_HAPPY, "battle": BATTLE_ZERO})
    r3 = c.get("/attest", params={"mint": MINT_HAPPY, "battle": BATTLE_ZERO})
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert r3.status_code == 429
