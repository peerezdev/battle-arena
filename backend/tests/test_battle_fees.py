"""Platform fee on battles: config, schema, base computation and collection."""
import pytest
from app.config import Settings
from app.models import PackBattle, BattlePull, BattlePack
from app.services.battle_fees import fee_pct_total, compute_fee_base_units


def test_fee_settings_defaults():
    s = Settings()
    assert s.battle_fee_pct_per_player == 0.005
    assert s.battle_fee_pct_cap == 0.03
    # fee_wallet_address is deployment-specific (set directly in config.py or via env) —
    # only pin its type, not its value.
    assert isinstance(s.fee_wallet_address, str)


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


from app.services.battle_fees import collect_battle_fee


class _Signer:
    def __init__(self):
        self.signed = []
    async def sign_solana(self, wallet_id, tx):
        self.signed.append(wallet_id)
        return f"signed:{tx}"


def _fee_env(monkeypatch, **over):
    import app.services.battle_fees as bf
    defaults = dict(battle_fee_pct_per_player=0.005, battle_fee_pct_cap=0.03,
                    fee_wallet_address="FEEWALLET")
    defaults.update(over)
    monkeypatch.setattr(bf, "get_settings", lambda: Settings(**defaults))


def _collect_kwargs(signer, submitted, balance=1_000_000_000, transfers=None):
    async def usdc_balance(addr):
        return balance
    async def build_usdc_transfer_tx(src, dest, amount):
        if transfers is not None:
            transfers.append((src, dest, amount))
        return f"tx:{src}->{dest}:{amount}"
    async def submit_tx(signed):
        submitted.append(signed)
    return dict(signer=signer, resolve_wallet_id=lambda w: f"{w}-id", submit_tx=submit_tx,
                usdc_balance=usdc_balance, build_usdc_transfer_tx=build_usdc_transfer_tx,
                operator_wallet_id="op-id", sleep_fn=_nosleep, delay=0.0)


async def _nosleep(_):
    return None


def _loot(s, bid, insured=100.0):
    """One kept-NFT card worth `insured` from machine m50 (85%)."""
    s.add(BattlePull(battle_id=bid, player_wallet="WIN", memo="a", round_number=1,
                     nft_address="n1", insured_value=insured, auto_sold=False))
    s.commit()


GACHA85 = _MachGacha([{"code": "m50", "instantBuyback": 85}])


@pytest.mark.asyncio
async def test_collect_full_charge_and_persist(Session, monkeypatch):
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc1"); _loot(s, "bc1")            # base $85
    signer, submitted, transfers = _Signer(), [], []
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted, transfers=transfers))
    assert charged == 850_000                          # $85 × 1% = $0.85
    assert transfers == [("WIN", "FEEWALLET", 850_000)]
    assert signer.signed == ["WIN-id", "op-id"]        # winner signs, operator pays gas
    assert len(submitted) == 1
    got = s.get(PackBattle, "bc1")
    assert got.fee_charged is True and got.fee_base_units == 850_000
    assert got.fee_pct == pytest.approx(0.01)


@pytest.mark.asyncio
async def test_collect_caps_at_winner_balance(Session, monkeypatch):
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc2"); _loot(s, "bc2")            # fee would be 850_000
    signer, submitted, transfers = _Signer(), [], []
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted, balance=300_000, transfers=transfers))
    assert charged == 300_000                          # only what the winner holds
    assert transfers == [("WIN", "FEEWALLET", 300_000)]
    assert s.get(PackBattle, "bc2").fee_base_units == 300_000


@pytest.mark.asyncio
async def test_collect_zero_balance_marks_charged_no_transfer(Session, monkeypatch):
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc3"); _loot(s, "bc3")
    signer, submitted = _Signer(), []
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted, balance=0))
    assert charged == 0 and submitted == []
    got = s.get(PackBattle, "bc3")
    assert got.fee_charged is True and got.fee_base_units == 0


@pytest.mark.asyncio
async def test_collect_idempotent_second_call_noop(Session, monkeypatch):
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc4"); _loot(s, "bc4")
    signer, submitted = _Signer(), []
    kw = _collect_kwargs(signer, submitted)
    await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85, **kw)
    again = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85, **kw)
    assert again == 0 and len(submitted) == 1          # no double transfer


@pytest.mark.asyncio
async def test_collect_transfer_failure_never_raises_flag_stays_false(Session, monkeypatch, caplog):
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc5"); _loot(s, "bc5")
    signer = _Signer()
    async def usdc_balance(addr): return 1_000_000_000
    async def build_usdc_transfer_tx(src, dest, amount): return "tx"
    async def submit_tx(signed): raise RuntimeError("rpc down")
    charged = await collect_battle_fee(
        s, b, "WIN", 2, gacha=GACHA85, signer=signer, resolve_wallet_id=lambda w: f"{w}-id",
        submit_tx=submit_tx, usdc_balance=usdc_balance,
        build_usdc_transfer_tx=build_usdc_transfer_tx, operator_wallet_id="op-id",
        sleep_fn=_nosleep, delay=0.0)
    assert charged == 0
    assert s.get(PackBattle, "bc5").fee_charged is False   # retryable later
    assert any(r.levelname == "ERROR" for r in caplog.records)


@pytest.mark.asyncio
async def test_collect_skips_when_no_fee_wallet_configured(Session, monkeypatch):
    _fee_env(monkeypatch, fee_wallet_address="", privy_operator_address="")
    s = Session()
    b = _battle(s, "bc6"); _loot(s, "bc6")
    signer, submitted = _Signer(), []
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted))
    assert charged == 0 and submitted == []
    assert s.get(PackBattle, "bc6").fee_charged is False


@pytest.mark.asyncio
async def test_collect_rate_zero_is_kill_switch(Session, monkeypatch):
    _fee_env(monkeypatch, battle_fee_pct_per_player=0.0)
    s = Session()
    b = _battle(s, "bc7"); _loot(s, "bc7")
    signer, submitted = _Signer(), []
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted))
    assert charged == 0 and submitted == []


@pytest.mark.asyncio
async def test_collect_commit_failure_after_submit_never_resubmits(Session, monkeypatch, caplog):
    """If persisting the flag fails AFTER the transfer was submitted, we must NOT retry the
    transfer (double charge on-chain) — log ERROR and report the charge as made."""
    _fee_env(monkeypatch)
    s = Session()
    b = _battle(s, "bc8"); _loot(s, "bc8")
    signer, submitted = _Signer(), []
    real_commit, boom = s.commit, {"armed": False}

    def flaky_commit():
        if boom["armed"]:
            boom["armed"] = False
            raise RuntimeError("db gone")
        real_commit()

    monkeypatch.setattr(s, "commit", flaky_commit)
    boom["armed"] = True   # only the post-submit persistence commit fails
    charged = await collect_battle_fee(s, b, "WIN", 2, gacha=GACHA85,
                                       **_collect_kwargs(signer, submitted))
    assert charged == 850_000
    assert len(submitted) == 1                          # ONE submission — never re-sent
    assert any(r.levelname == "ERROR" for r in caplog.records)
