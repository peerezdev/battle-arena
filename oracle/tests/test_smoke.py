import pytest
from pydantic import ValidationError
from app.config import get_settings, Settings


def test_settings_defaults():
    s = get_settings()
    assert s.pricing_source in ("mock", "collectorcrypt")
    assert s.cc_base_url.startswith("https://")


def test_cc_base_url_requires_https():
    """cc_base_url con http:// externo debe ser rechazado (FIX E)."""
    with pytest.raises((ValidationError, ValueError)):
        Settings(cc_base_url="http://evil.example.com")


def test_cc_base_url_allows_localhost_http():
    """http://localhost y http://127.0.0.1 están permitidos para dev (FIX E)."""
    s1 = Settings(cc_base_url="http://localhost:8080")
    assert s1.cc_base_url == "http://localhost:8080"
    s2 = Settings(cc_base_url="http://127.0.0.1:9000")
    assert s2.cc_base_url == "http://127.0.0.1:9000"


def test_cc_base_url_allows_https():
    s = Settings(cc_base_url="https://api.example.com")
    assert s.cc_base_url == "https://api.example.com"


def test_rate_limit_default():
    s = Settings()
    assert s.rate_limit_per_min == 30


def test_cors_origins_default_empty():
    s = Settings()
    assert s.cors_origins == []
