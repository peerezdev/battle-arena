"""Platform fee on battles: config, schema, base computation and collection."""
import pytest
from app.config import Settings
from app.models import PackBattle


def test_fee_settings_defaults():
    s = Settings()
    assert s.battle_fee_pct_per_player == 0.005
    assert s.battle_fee_pct_cap == 0.03
    assert s.fee_wallet_address == ""


def test_packbattle_fee_columns_default(Session):
    s = Session()
    b = PackBattle(id="bf1", mode="pack", machine_code="m", price=50_000_000,
                   max_players=2, status="settled")
    s.add(b); s.commit()
    got = s.get(PackBattle, "bf1")
    assert got.fee_charged is False
    assert got.fee_base_units is None
    assert got.fee_pct is None
