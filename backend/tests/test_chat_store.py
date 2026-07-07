import pytest
from app.db import make_engine, make_session_factory, init_db
from app.chat import save_chat_message, recent_chat_messages, big_hit_multiple
from app.models import ChatMessage


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


def test_saves_and_returns_in_wire_format_chronological(session):
    save_chat_message(session, "alice", "hello", ts=100)
    save_chat_message(session, "bob", "hi there", ts=101)
    save_chat_message(session, "alice", "bye", ts=102)
    hist = recent_chat_messages(session)
    assert hist == [
        {"user": "alice", "text": "hello", "ts": 100},
        {"user": "bob", "text": "hi there", "ts": 101},
        {"user": "alice", "text": "bye", "ts": 102},
    ]


def test_prunes_to_newest_50(session):
    for i in range(55):
        save_chat_message(session, "u", f"m{i}", ts=1000 + i)
    assert session.query(ChatMessage).count() == 50            # table stays bounded
    hist = recent_chat_messages(session)
    assert len(hist) == 50
    assert hist[0]["text"] == "m5" and hist[-1]["text"] == "m54"   # newest 50, in order


def test_recent_limit_is_respected(session):
    for i in range(10):
        save_chat_message(session, "u", f"m{i}", ts=i)
    assert [m["text"] for m in recent_chat_messages(session, limit=3)] == ["m7", "m8", "m9"]


def test_empty_history_is_empty_list(session):
    assert recent_chat_messages(session) == []


def test_normal_message_carries_no_kind_or_action(session):
    save_chat_message(session, "alice", "hey", ts=1)
    (m,) = recent_chat_messages(session)
    assert m == {"user": "alice", "text": "hey", "ts": 1}   # no kind/action for plain chat


def test_system_announcement_persists_kind_and_action(session):
    action = {"label": "Unirse", "battleId": "b1", "mode": "pack"}
    save_chat_message(session, "📢 Arena", "Nueva Pack Battle", ts=5, kind="system", action=action)
    save_chat_message(session, "📢 Arena", "🔥 big hit", ts=6, kind="system")   # no action
    hist = recent_chat_messages(session)
    assert hist[0] == {"user": "📢 Arena", "text": "Nueva Pack Battle", "ts": 5,
                       "kind": "system", "action": action}
    assert hist[1] == {"user": "📢 Arena", "text": "🔥 big hit", "ts": 6, "kind": "system"}


def test_structured_event_persists_event_and_amount(session):
    # A persisted big-hit / winner must round-trip its event tag + gold value so it
    # re-renders in the structured style (not plain text) after a reconnect.
    save_chat_message(session, "neo", "sacó Charizard", ts=7, kind="system",
                      event="hit", amount_usd=320.0)
    save_chat_message(session, "mole", "ganó Pack Battle", ts=8, kind="system",
                      event="winner", amount_usd=1200.0,
                      action={"label": "Ver", "battleId": "b9", "mode": "pack"})
    hist = recent_chat_messages(session)
    assert hist[0] == {"user": "neo", "text": "sacó Charizard", "ts": 7,
                       "kind": "system", "event": "hit", "amountUsd": 320.0}
    assert hist[1] == {"user": "mole", "text": "ganó Pack Battle", "ts": 8,
                       "kind": "system", "event": "winner", "amountUsd": 1200.0,
                       "action": {"label": "Ver", "battleId": "b9", "mode": "pack"}}


@pytest.mark.parametrize("value,cost_base,expected", [
    (150.0, 50_000_000, 3.0),     # $150 hit on a $50 pull → x3
    (500.0, 50_000_000, 10.0),
    (49.0, 50_000_000, 0.98),     # below x1
    (None, 50_000_000, None),     # missing value
    (100.0, None, None),          # missing cost
    (100.0, 0, None),             # zero cost
    (0.0, 50_000_000, None),      # zero value
])
def test_big_hit_multiple(value, cost_base, expected):
    got = big_hit_multiple(value, cost_base)
    if expected is None:
        assert got is None
    else:
        assert got == pytest.approx(expected)
