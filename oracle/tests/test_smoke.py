from app.config import get_settings


def test_settings_defaults():
    s = get_settings()
    assert s.pricing_source in ("mock", "collectorcrypt")
    assert s.cc_base_url.startswith("https://")
