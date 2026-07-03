import pytest
from app.db import make_engine, make_session_factory, init_db
from app.chat import save_chat_message, recent_chat_messages
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
