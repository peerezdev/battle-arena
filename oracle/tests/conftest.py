import pytest
from fastapi.testclient import TestClient
from app.main import create_app
from app.pricing.mock import MockPricingSource
from nacl.signing import SigningKey

# Valid 32-byte base58 mints (Solana well-known addresses used as stable test fixtures)
MINT_HAPPY = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"   # USDC mint
MINT_NOVALUE = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"   # USDT mint


@pytest.fixture
def client(tmp_path):
    key = SigningKey.generate()
    src = MockPricingSource(
        overrides={MINT_HAPPY: {"value_usd": 1200, "grade": 9, "grading_company": "PSA"}},
        unavailable={MINT_NOVALUE},
    )
    app = create_app(signing_key=key, pricing=src, now_fn=lambda: 1700000000)
    return TestClient(app), key
