from app.db import Base, make_engine, make_session_factory, init_db
from app.models import User, Match, RatingHistory


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
