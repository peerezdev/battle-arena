"""Platform fee on battles: config, schema, base computation and collection."""
import pytest
from app.config import Settings
from app.models import PackBattle, BattlePull, BattlePack
from app.services.battle_fees import fee_pct_total, compute_fee_base_units


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


class _MachGacha:
    """gacha.machines() fake."""
    def __init__(self, machines):
        self._machines = machines
    async def machines(self):
        return self._machines


class _BrokenGacha:
    async def machines(self):
        raise RuntimeError("cc down")


def _battle(s, bid, mode="pack", machine="m50", players=2):
    b = PackBattle(id=bid, mode=mode, machine_code=machine, price=50_000_000,
                   max_players=players, status="settled")
    s.add(b); s.commit()
    return b


def test_fee_pct_total_scales_and_caps(monkeypatch):
    import app.services.battle_fees as bf
    monkeypatch.setattr(bf, "get_settings",
                        lambda: Settings(battle_fee_pct_per_player=0.005, battle_fee_pct_cap=0.03))
    assert fee_pct_total(2) == pytest.approx(0.01)   # 0.5% × 2
    assert fee_pct_total(10) == pytest.approx(0.03)  # 5% capped at 3%


@pytest.mark.asyncio
async def test_base_matches_user_example_multi_pack(Session):
    """$100 card from the $50 pack (85%) + $200 card from the $250 pack (90%) → $265 base."""
    s = Session()
    b = _battle(s, "bx1")
    s.add(BattlePack(battle_id="bx1", machine_code="m50", price=50_000_000, sequence=1))
    s.add(BattlePack(battle_id="bx1", machine_code="m250", price=250_000_000, sequence=2))
    s.add(BattlePull(battle_id="bx1", player_wallet="W", memo="a", round_number=1,
                     nft_address="n1", insured_value=100.0, auto_sold=False))
    s.add(BattlePull(battle_id="bx1", player_wallet="W", memo="b", round_number=2,
                     nft_address="n2", insured_value=200.0, auto_sold=False))
    s.commit()
    gacha = _MachGacha([{"code": "m50", "instantBuyback": 85},
                        {"code": "m250", "instantBuyback": 90}])
    base = await compute_fee_base_units(s, b, gacha)
    assert base == 265_000_000  # $85 + $180 in base units


@pytest.mark.asyncio
async def test_base_mixes_auto_sold_real_amount_and_nft_theoretical(Session):
    s = Session()
    b = _battle(s, "bx2")  # no BattlePack rows → battle.machine_code for every round
    s.add(BattlePull(battle_id="bx2", player_wallet="W", memo="a", round_number=1,
                     nft_address="n1", insured_value=40.0, auto_sold=True,
                     buyback_amount=34_000_000))                       # real: $34
    s.add(BattlePull(battle_id="bx2", player_wallet="W", memo="b", round_number=1,
                     nft_address="n2", insured_value=100.0, auto_sold=False))  # 85% → $85
    s.commit()
    gacha = _MachGacha([{"code": "m50", "instantBuyback": 85}])
    assert await compute_fee_base_units(s, b, gacha) == 119_000_000


@pytest.mark.asyncio
async def test_base_machine_without_buyback_pct_drops_nft_cards(Session):
    s = Session()
    b = _battle(s, "bx3")
    s.add(BattlePull(battle_id="bx3", player_wallet="W", memo="a", round_number=1,
                     nft_address="n1", insured_value=100.0, auto_sold=False))   # dropped
    s.add(BattlePull(battle_id="bx3", player_wallet="W", memo="b", round_number=1,
                     nft_address="n2", insured_value=40.0, auto_sold=True,
                     buyback_amount=34_000_000))                                # kept
    s.commit()
    gacha = _MachGacha([{"code": "m50", "instantBuyback": None}])
    assert await compute_fee_base_units(s, b, gacha) == 34_000_000


@pytest.mark.asyncio
async def test_base_survives_machines_api_failure(Session):
    s = Session()
    b = _battle(s, "bx4")
    s.add(BattlePull(battle_id="bx4", player_wallet="W", memo="a", round_number=1,
                     nft_address="n1", insured_value=100.0, auto_sold=False))   # dropped (no pcts)
    s.add(BattlePull(battle_id="bx4", player_wallet="W", memo="b", round_number=1,
                     nft_address="n2", insured_value=40.0, auto_sold=True,
                     buyback_amount=34_000_000))
    s.commit()
    assert await compute_fee_base_units(s, b, _BrokenGacha()) == 34_000_000
