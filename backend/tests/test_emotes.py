import pytest
from app.db import make_engine, make_session_factory, init_db
from app.services import emotes


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


def test_catalog_has_codes_and_urls():
    cat = emotes.catalog()
    assert {e["code"] for e in cat} >= {"charmander", "bulbasaur", "squirtle"}
    assert all(e["video_url"].startswith("/") for e in cat)


def test_read_grants_defaults_on_first_access(session):
    out = emotes.read_user_emotes(session, "WALLET_A")
    assert set(out["owned"]) == set(emotes.DEFAULT_EMOTES)
    # slots default to the first 3 owned, in catalog order
    assert out["slots"] == out["owned"][:emotes.MAX_SLOTS]


def test_set_slots_keeps_only_owned_and_caps_at_three(session):
    emotes.read_user_emotes(session, "A")  # grants defaults
    out = emotes.set_emote_slots(session, "A", ["squirtle", "not_owned", "charmander", "bulbasaur"])
    assert out["slots"] == ["squirtle", "charmander", "bulbasaur"]   # dropped not_owned, order preserved
    # persists on re-read
    assert emotes.read_user_emotes(session, "A")["slots"] == ["squirtle", "charmander", "bulbasaur"]


def test_set_slots_dedupes_and_drops_unowned(session):
    emotes.read_user_emotes(session, "B")
    out = emotes.set_emote_slots(session, "B", ["charmander", "charmander", "ghost"])
    assert out["slots"] == ["charmander"]


def test_owns(session):
    emotes.read_user_emotes(session, "C")
    assert emotes.owns(session, "C", "charmander") is True
    assert emotes.owns(session, "C", "nope") is False
