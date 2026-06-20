import pytest
from app.db import Base, make_engine, make_session_factory, init_db
from app.models import User, Match, RatingHistory


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


def test_create_and_query():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        s.add(User(wallet="A", elo=1200))
        s.add(Match(battle_pubkey="B1", creator="A", stake=100, status="open"))
        s.commit()
        u = s.get(User, "A")
        m = s.get(Match, "B1")
        assert u.elo == 1200 and u.games_played == 0
        assert m.creator == "A" and m.status == "open" and m.elo_applied is False
        assert m.min_elo is None and m.max_elo is None


def test_pack_battle_models_persist(session):
    from app.models import PackBattle, BattlePlayer, BattlePull
    b = PackBattle(id="b1", mode="pack", machine_code="pokemon_50", price=50, max_players=3, status="lobby")
    session.add(b)
    session.add(BattlePlayer(battle_id="b1", player_wallet="W1"))
    session.add(BattlePull(battle_id="b1", player_wallet="W1", memo="m1"))
    session.commit()
    got = session.get(PackBattle, "b1")
    assert got.status == "lobby" and got.max_players == 3 and got.winner is None
    assert session.query(BattlePull).filter_by(battle_id="b1").one().memo == "m1"
