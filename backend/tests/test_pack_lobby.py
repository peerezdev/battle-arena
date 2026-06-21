import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePlayer
from app.services.pack_lobby import (create_battle, join_battle, list_open, get_battle,
                                      LobbyError, ModeNotSupported)

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
                      price=50_000_000, max_players=4, mode="royale")
    assert b.mode == "royale" and b.status == "lobby"
    # seed must be generated (used for PF tie-break in royale rounds)
    assert b.server_seed and b.server_seed_hash

def test_create_rejects_bad_max_players(session):
    with pytest.raises(LobbyError):
        create_battle(session, "WC", "wid", machine_code="pokemon_50", price=50_000_000, max_players=1)

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
