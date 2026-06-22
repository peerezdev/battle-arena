import pytest
from app.db import make_engine, make_session_factory, init_db
from app.services.reservations import reserve, reserved_total, release_reservations


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
