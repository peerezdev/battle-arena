from app.config import get_settings


def test_settings_defaults():
    s = get_settings()
    assert s.elo_start == 1200 and s.elo_k == 32
    assert s.chain_source in ("mock", "solana")
