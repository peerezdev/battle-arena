import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePlayer
from app.services.pack_lobby import (create_battle, join_battle, list_open, list_battles,
                                      get_battle, LobbyError, ModeNotSupported)
from datetime import datetime, timezone

@pytest.fixture
def session():
    e = make_engine("sqlite:///:memory:"); init_db(e)
    with make_session_factory(e)() as s: yield s

def test_create_battle_commits_seed_and_creator(session):
    b = create_battle(session, "WC", "wid-c", machine_code="pokemon_50", price=50_000_000, max_players=2)
    assert b.status == "lobby" and b.mode == "pack" and b.server_seed and b.server_seed_hash
    assert session.query(BattlePlayer).filter_by(battle_id=b.id).count() == 1

def test_create_rejects_royale(session):
    # This test is SUPERSEDED by test_create_royale_allowed_and_sets_mode below.
    # royale is now an accepted mode; only truly unknown modes are rejected.
    with pytest.raises(ModeNotSupported):
        create_battle(session, "WC", "wid", machine_code="pokemon_50", price=50_000_000, max_players=2, mode="tournament")


def test_create_royale_allowed_and_sets_mode(session):
    b = create_battle(session, "WC", "wid-c", machine_code="pokemon_50",
                      price=50_000_000, max_players=5, mode="royale")
    assert b.mode == "royale" and b.status == "lobby"
    # seed must be generated (used for PF tie-break in royale rounds)
    assert b.server_seed and b.server_seed_hash

def test_create_rejects_bad_max_players(session):
    with pytest.raises(LobbyError):
        create_battle(session, "WC", "wid", machine_code="pokemon_50", price=50_000_000, max_players=1)


def test_per_mode_player_bounds(session):
    mk = lambda n, mode: create_battle(session, "WC", "wid", machine_code="pokemon_50",
                                        price=50_000_000, max_players=n, mode=mode)
    # Pack Battle: 2–4 (5+ rejected)
    with pytest.raises(LobbyError): mk(5, "pack")
    assert mk(4, "pack").max_players == 4
    # Battle Royale: 5–10 (below 5 or above 10 rejected)
    with pytest.raises(LobbyError): mk(4, "royale")
    with pytest.raises(LobbyError): mk(11, "royale")
    assert mk(5, "royale").max_players == 5
    assert mk(10, "royale").max_players == 10

def test_join_fills_atomically(session):
    b = create_battle(session, "WC", "wid-c", machine_code="pokemon_50", price=50_000_000, max_players=2)
    bb, filled = join_battle(session, b.id, "WB", "wid-b")
    assert filled and bb.status == "running"
    assert session.query(BattlePlayer).filter_by(battle_id=b.id).count() == 2

def test_join_rejects_duplicate_and_full(session):
    b = create_battle(session, "WC", "wid-c", machine_code="pokemon_50", price=50_000_000, max_players=2)
    with pytest.raises(LobbyError):
        join_battle(session, b.id, "WC", "wid-c")        # creator already in
    join_battle(session, b.id, "WB", "wid-b")            # fills
    with pytest.raises(LobbyError):
        join_battle(session, b.id, "WX", "wid-x")        # not lobby anymore


def test_get_battle_hides_server_seed_until_settled(session):
    # commit-reveal gate: server_seed must NOT leak while not settled (only the hash is public).
    b = create_battle(session, "WC", "wid-c", machine_code="pokemon_50", price=50_000_000, max_players=2)
    view = get_battle(session, b.id)
    assert view["server_seed_hash"] and "server_seed" not in view

def test_create_sets_creator_wallet_and_cancel_rules(session):
    from app.services.pack_lobby import cancel_battle
    b = create_battle(session, "CREATOR", "wid", machine_code="m", price=50, max_players=2)
    assert b.creator_wallet == "CREATOR"
    # non-creator cannot cancel
    with pytest.raises(LobbyError):
        cancel_battle(session, b.id, "SOMEONE_ELSE")
    # creator cancels a lobby → cancelled
    out = cancel_battle(session, b.id, "CREATOR")
    assert out.status == "cancelled"
    # cannot cancel again (not in lobby anymore)
    with pytest.raises(LobbyError):
        cancel_battle(session, b.id, "CREATOR")


def test_get_battle_running_reveals_pulls_but_not_seed(session):
    from app.models import BattleRound, BattlePull
    b = PackBattle(id="rv", mode="royale", machine_code="m", price=50, max_players=3,
                   status="running", server_seed="ab" * 32, server_seed_hash="h", creator_wallet="A")
    session.add(b)
    session.add_all([
        BattlePlayer(battle_id="rv", player_wallet="A", eliminated_round=None, accumulated_value=120.0),
        BattlePlayer(battle_id="rv", player_wallet="B", eliminated_round=1, accumulated_value=40.0),
    ])
    session.add(BattleRound(battle_id="rv", round_number=1, client_seed="cs1",
                            eliminated_wallet="B", tie_break_index=None))
    # one resolved pull + one still "pending" (nft_address is None)
    session.add_all([
        BattlePull(battle_id="rv", player_wallet="A", memo="m1", round_number=1,
                   nft_address="nftA", rarity="Epic", insured_value=120.0, auto_sold=False),
        BattlePull(battle_id="rv", player_wallet="B", memo="m2", round_number=2, nft_address=None),
    ])
    session.commit()
    v = get_battle(session, "rv")
    assert v["creator_wallet"] == "A"
    assert v["rounds"] == [{"round_number": 1, "eliminated_wallet": "B", "tie_break_index": None}]
    # pulls ARE exposed during running (live reveal)
    assert {p["player_wallet"] for p in v["pulls"]} == {"A", "B"}
    pending = next(p for p in v["pulls"] if p["player_wallet"] == "B")
    assert pending["nft_address"] is None
    # ...but the PF seed is NOT revealed pre-settle
    assert "server_seed" not in v and "client_seed" not in v and "tie_break_index" not in v


def test_get_battle_postsettle_pull_recap(session):
    from app.models import BattlePull
    b = PackBattle(id="st", mode="pack", machine_code="m", price=50, max_players=2,
                   status="settled", winner="A", server_seed="ab" * 32, server_seed_hash="h",
                   client_seed="cs", tie_break_index=None, creator_wallet="A")
    session.add(b)
    session.add(BattlePull(battle_id="st", player_wallet="A", memo="m1", round_number=1,
                           nft_address="nftA", rarity="Epic", insured_value=500.0, auto_sold=False,
                           grade=10, year="2018", name="Charizard", buyback_amount=None))
    session.commit()
    v = get_battle(session, "st")
    assert v["server_seed"] == "ab" * 32                 # revealed post-settle
    assert v["pulls"] == [{"round_number": 1, "player_wallet": "A", "nft_address": "nftA",
                           "rarity": "Epic", "insured_value": 500.0, "auto_sold": False,
                           "grade": 10, "year": "2018", "name": "Charizard", "buyback_amount": None}]


def test_verification_royale_rounds_and_reveal_gate(session):
    from app.models import PackBattle, BattleRound
    from app.services.pack_lobby import verification
    from app.services.provably_fair import gen_server_seed
    seed, h = gen_server_seed()
    b = PackBattle(id="vr", mode="royale", machine_code="m", price=50, max_players=3,
                   status="running", server_seed=seed, server_seed_hash=h)
    session.add(b)
    session.add(BattleRound(battle_id="vr", round_number=1, client_seed="cs1",
                            eliminated_wallet="B", tie_break_index=2))
    session.commit()
    v = verification(session, b)
    assert v["mode"] == "royale" and v["server_seed_hash"] == h
    assert v["server_seed"] is None and v["commit_ok"] is None     # not settled → seed hidden
    assert v["rounds"] == [{"round_number": 1, "client_seed": "cs1",
                            "eliminated_wallet": "B", "tie_break_index": 2}]
    b.status = "settled"; session.commit()
    v2 = verification(session, b)
    assert v2["server_seed"] == seed and v2["commit_ok"] is True    # post-settle → revealed + verified


def test_verification_pack_tiebreak(session):
    from app.models import PackBattle
    from app.services.pack_lobby import verification
    from app.services.provably_fair import gen_server_seed
    seed, h = gen_server_seed()
    b = PackBattle(id="vp", mode="pack", machine_code="m", price=50, max_players=2,
                   status="settled", server_seed=seed, server_seed_hash=h,
                   client_seed="cs", tie_break_index=1)
    session.add(b); session.commit()
    v = verification(session, b)
    assert v["mode"] == "pack" and v["client_seed"] == "cs" and v["tie_break_index"] == 1
    assert v["commit_ok"] is True


def test_list_open_includes_mode_and_buyin(session):
    from app.services.royale_funding import royale_buyin
    create_battle(session, "WA", "wid-a", machine_code="pokemon_50",
                  price=50_000_000, max_players=2, mode="pack")
    create_battle(session, "WB", "wid-b", machine_code="pokemon_50",
                  price=50_000_000, max_players=5, mode="royale")
    rows = list_open(session)
    by_mode = {r["mode"]: r for r in rows}
    assert by_mode["pack"]["buyin"] == 50_000_000
    assert by_mode["royale"]["buyin"] == royale_buyin(5, 50_000_000)
    # base shape preserved
    assert set(by_mode["pack"]) == {
        "id", "mode", "machine_code", "price", "max_players", "players", "buyin",
        "creator_wallet", "player_wallets", "packs"}


def test_list_open_includes_creator_wallet(session):
    create_battle(session, "WC", "wid-c", machine_code="pokemon_50",
                  price=50_000_000, max_players=2, mode="pack")
    row = list_open(session)[0]
    assert row["creator_wallet"] == "WC"
    assert "creator_wallet" in row


def test_list_open_includes_player_wallets(session):
    # a 5-seat royale so it stays in lobby after a second player joins
    b = create_battle(session, "WC", "wid-c", machine_code="pokemon_50",
                      price=50_000_000, max_players=5, mode="royale")
    join_battle(session, b.id, "WB", "wid-b")
    row = list_open(session)[0]
    assert row["players"] == 2
    assert set(row["player_wallets"]) == {"WC", "WB"}


def test_create_battle_with_bundle_persists_packs_and_total(session):
    from app.models import BattlePack
    b = create_battle(session, "WC", "wid-c", machine_code="m25", price=125_000_000,
                      max_players=2, mode="pack",
                      packs=[("m25", 25_000_000), ("m50", 50_000_000), ("m50", 50_000_000)])
    rows = session.query(BattlePack).filter_by(battle_id=b.id).order_by(BattlePack.sequence).all()
    assert [(r.machine_code, r.price, r.sequence) for r in rows] == [
        ("m25", 25_000_000, 1), ("m50", 50_000_000, 2), ("m50", 50_000_000, 3)]
    view = get_battle(session, b.id)
    assert view["packs"] == [
        {"machine_code": "m25", "sequence": 1, "price": 25_000_000},
        {"machine_code": "m50", "sequence": 2, "price": 50_000_000},
        {"machine_code": "m50", "sequence": 3, "price": 50_000_000}]


def test_create_battle_without_packs_is_single_box_bundle(session):
    from app.models import BattlePack
    b = create_battle(session, "WC", "wid-c", machine_code="m50", price=50_000_000, max_players=2)
    rows = session.query(BattlePack).filter_by(battle_id=b.id).all()
    assert [(r.machine_code, r.price, r.sequence) for r in rows] == [("m50", 50_000_000, 1)]


def test_list_battles_covers_lobby_running_and_recent_settled(session):
    lobby = create_battle(session, "WC", "wid-c", machine_code="pokemon_50", price=50_000_000, max_players=2)
    run = create_battle(session, "WD", "wid-d", machine_code="pokemon_50", price=50_000_000, max_players=2)
    join_battle(session, run.id, "WB", "wid-b")   # fills → running
    done = create_battle(session, "WE", "wid-e", machine_code="pokemon_50", price=50_000_000, max_players=2)
    done.status, done.winner, done.settled_at = "settled", "WE", datetime.now(timezone.utc)
    session.commit()

    rows = {r["id"]: r for r in list_battles(session)}
    assert rows[lobby.id]["status"] == "lobby"
    assert rows[run.id]["status"] == "running"
    assert rows[done.id]["status"] == "settled" and rows[done.id]["winner"] == "WE"
    assert rows[done.id]["settled_at"] is not None

    # voided/cancelled must NOT surface in the list
    void = create_battle(session, "WF", "wid-f", machine_code="pokemon_50", price=50_000_000, max_players=2)
    void.status = "voided"; session.commit()
    assert void.id not in {r["id"] for r in list_battles(session)}


def test_una_batalla_terminada_lleva_el_botin_real_de_sus_cartas(session):
    """loot_usd es la suma del valor asegurado, que es lo que se lleva el ganador — no el bote
    estimado que el cliente calcula con precio × tiradas."""
    from app.models import BattlePull
    b = create_battle(session, "WA", "wid-a", machine_code="pokemon_50", price=50_000_000, max_players=2)
    b.status, b.winner, b.settled_at = "settled", "WA", datetime.now(timezone.utc)
    session.add(BattlePull(battle_id=b.id, player_wallet="WA", memo="m1", round_number=1, insured_value=120.5))
    session.add(BattlePull(battle_id=b.id, player_wallet="WB", memo="m2", round_number=1, insured_value=30.25))
    session.commit()

    row = {r["id"]: r for r in list_battles(session)}[b.id]
    assert row["loot_usd"] == 150.75


def test_una_terminada_sin_cartas_lleva_botin_cero_no_ausente(session):
    """Sin esto el cliente no distingue 'no hubo botín' de 'el backend no lo manda'."""
    b = create_battle(session, "WA", "wid-a", machine_code="pokemon_50", price=50_000_000, max_players=2)
    b.status, b.winner, b.settled_at = "settled", "WA", datetime.now(timezone.utc)
    session.commit()
    assert {r["id"]: r for r in list_battles(session)}[b.id]["loot_usd"] == 0.0


def test_las_partidas_en_curso_no_llevan_botin(session):
    """En una partida viva la suma crecería ronda a ronda; no es 'lo que se ganó'."""
    lobby = create_battle(session, "WC", "wid-c", machine_code="pokemon_50", price=50_000_000, max_players=2)
    run = create_battle(session, "WD", "wid-d", machine_code="pokemon_50", price=50_000_000, max_players=2)
    join_battle(session, run.id, "WB", "wid-b")   # se llena → running
    rows = {r["id"]: r for r in list_battles(session)}
    assert "loot_usd" not in rows[lobby.id]
    assert "loot_usd" not in rows[run.id]
