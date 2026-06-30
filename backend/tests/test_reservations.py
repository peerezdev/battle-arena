import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePlayer
from app.services.reservations import reserve, reserved_total, royale_locked_total, release_reservations
from app.services.royale_funding import royale_buyin


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


def test_reserved_total_sums_only_active_for_wallet(session):
    reserve(session, "A", "b1", 50_000_000)
    reserve(session, "A", "b2", 30_000_000)
    reserve(session, "B", "b3", 99_000_000)
    assert reserved_total(session, "A") == 80_000_000
    assert reserved_total(session, "B") == 99_000_000
    assert reserved_total(session, "C") == 0


def test_release_reservations_flips_active_and_is_idempotent(session):
    reserve(session, "A", "b1", 50_000_000)
    reserve(session, "A", "b1", 10_000_000)   # two rows same battle
    n = release_reservations(session, "b1")
    assert n == 2
    assert reserved_total(session, "A") == 0
    # released rows carry released_at; a second release is a no-op
    assert release_reservations(session, "b1") == 0


def _add_royale(session, bid, status, n=4, price=250_000_000, players=()):
    session.add(PackBattle(id=bid, mode="royale", machine_code="m", price=price, max_players=n, status=status))
    for w in players:
        session.add(BattlePlayer(battle_id=bid, player_wallet=w))
    session.commit()


def test_royale_locked_counts_open_royales_for_player(session):
    _add_royale(session, "r1", "lobby", n=4, price=250_000_000, players=["A"])
    assert royale_locked_total(session, "A") == royale_buyin(4, 250_000_000)  # 562_500_000
    assert royale_locked_total(session, "B") == 0   # not a player in any open royale


def test_royale_locked_ignores_settled_voided_and_pack(session):
    _add_royale(session, "r1", "settled", players=["A"])
    _add_royale(session, "r2", "voided", players=["A"])
    # an OPEN pack battle must not be counted by the royale-locked tally
    session.add(PackBattle(id="p1", mode="pack", machine_code="m", price=50_000_000, max_players=2, status="lobby"))
    session.add(BattlePlayer(battle_id="p1", player_wallet="A"))
    session.commit()
    assert royale_locked_total(session, "A") == 0


def test_royale_locked_sums_multiple_open(session):
    _add_royale(session, "r1", "lobby", n=4, price=250_000_000, players=["A"])
    _add_royale(session, "r2", "running", n=2, price=100_000_000, players=["A"])
    assert royale_locked_total(session, "A") == royale_buyin(4, 250_000_000) + royale_buyin(2, 100_000_000)
