import pytest
from app.config import Settings
from app.models import GachaPack


def test_settings_gacha_defaults():
    s = Settings(_env_file=None)
    assert s.gacha_base_url == "https://dev-gacha.collectorcrypt.com"
    assert s.gacha_api_key == ""


def test_gacha_pack_model(Session):
    s = Session()
    p = GachaPack(memo="slug-abc-123", wallet="W" * 43, pack_type="pokemon_50")
    s.add(p)
    s.commit()
    row = s.get(GachaPack, "slug-abc-123")
    assert row.wallet == "W" * 43
    assert row.opened_at is None and row.nft_address is None
    s.close()
