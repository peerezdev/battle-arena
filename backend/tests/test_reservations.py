import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePlayer
from app.services.reservations import (
    reserve, reserved_total, royale_locked_total, release_reservations, consume,
    battle_in_progress,
)
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


def test_consume_shrinks_the_hold_as_money_leaves_on_chain(session):
    # The hold must shrink by exactly what was just paid: the on-chain balance already
    # dropped by that much, so keeping it reserved would subtract the same money twice.
    reserve(session, "A", "b1", 65_000_000)
    assert consume(session, "A", "b1", 30_000_000) == 30_000_000
    assert reserved_total(session, "A") == 35_000_000
    assert consume(session, "A", "b1", 35_000_000) == 35_000_000
    assert reserved_total(session, "A") == 0


def test_consume_releases_the_row_once_drained(session):
    reserve(session, "A", "b1", 50_000_000)
    consume(session, "A", "b1", 50_000_000)
    # drained → released, so a later release_reservations finds nothing left to flip
    assert release_reservations(session, "b1") == 0


def test_consume_never_goes_negative_and_touches_only_its_own_wallet_and_battle(session):
    reserve(session, "A", "b1", 20_000_000)
    reserve(session, "A", "b2", 70_000_000)
    reserve(session, "B", "b1", 90_000_000)
    # asked for more than is held → consumes what's there, never below zero
    assert consume(session, "A", "b1", 999_000_000) == 20_000_000
    assert reserved_total(session, "A") == 70_000_000   # b2 untouched
    assert reserved_total(session, "B") == 90_000_000   # other wallet untouched


def test_consume_on_missing_reservation_is_a_noop(session):
    assert consume(session, "A", "nope", 10_000_000) == 0
    assert reserved_total(session, "A") == 0


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


def _add_pack(session, bid, status, players=()):
    session.add(PackBattle(id=bid, mode="pack", machine_code="m", price=50_000_000,
                           max_players=2, status=status))
    for w in players:
        session.add(BattlePlayer(battle_id=bid, player_wallet=w))
    session.commit()


def test_en_lobby_cuenta_como_partida_sin_terminar(session):
    # Apuntado y esperando a que se llene: su dinero ya tiene destino.
    _add_royale(session, "r1", "lobby", players=["A"])
    assert battle_in_progress(session, "A") == "r1"


def test_jugandose_tambien(session):
    _add_royale(session, "r2", "running", players=["A"])
    assert battle_in_progress(session, "A") == "r2"


def test_pack_battle_igual_que_royale(session):
    # La puerta no es solo del royale: en pack battle el dinero también sigue comprometido.
    _add_pack(session, "p1", "running", players=["A"])
    assert battle_in_progress(session, "A") == "p1"


def test_una_partida_terminada_no_bloquea(session):
    for estado in ("settled", "voided", "cancelled"):
        _add_royale(session, f"r-{estado}", estado, players=["A"])
    assert battle_in_progress(session, "A") is None


def test_solo_mira_las_partidas_del_wallet(session):
    # La partida de otro no puede bloquearme el retiro.
    _add_royale(session, "r3", "running", players=["B"])
    assert battle_in_progress(session, "A") is None


def test_sin_partidas_no_bloquea(session):
    assert battle_in_progress(session, "A") is None
