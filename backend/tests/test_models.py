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


def test_battle_player_wallet_id_persists(session):
    """BattlePlayer.wallet_id is nullable; when provided it round-trips correctly."""
    from app.models import PackBattle, BattlePlayer
    b = PackBattle(id="b2", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="lobby")
    session.add(b)
    p1 = BattlePlayer(battle_id="b2", player_wallet="W1", wallet_id="privy-wallet-id-abc")
    p2 = BattlePlayer(battle_id="b2", player_wallet="W2")  # wallet_id=None by default
    session.add_all([p1, p2])
    session.commit()
    rows = {r.player_wallet: r for r in session.query(BattlePlayer).filter_by(battle_id="b2").all()}
    assert rows["W1"].wallet_id == "privy-wallet-id-abc"
    assert rows["W2"].wallet_id is None


def test_royale_model_columns(session):
    from app.models import PackBattle, BattlePlayer, BattlePull, BattleRound
    session.add(PackBattle(id="r1", mode="royale", machine_code="pokemon_50", price=50_000_000, max_players=4, status="lobby"))
    session.add(BattlePlayer(battle_id="r1", player_wallet="A", eliminated_round=1, accumulated_value=10.0))
    session.add(BattlePull(battle_id="r1", player_wallet="A", memo="m", round_number=2))
    session.add(BattleRound(battle_id="r1", round_number=1, client_seed="cs", eliminated_wallet="A", tie_break_index=None))
    session.commit()
    assert session.query(BattleRound).filter_by(battle_id="r1").one().eliminated_wallet == "A"
    assert session.get(BattlePlayer, session.query(BattlePlayer).filter_by(battle_id="r1").one().id).accumulated_value == 10.0


def test_battle_pull_auto_sold_and_transferred_defaults():
    from app.db import make_engine, make_session_factory, init_db
    from app.models import BattlePull
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        p = BattlePull(battle_id="b1", player_wallet="A", memo="m1")
        s.add(p); s.commit()
        row = s.query(BattlePull).first()
        assert row.auto_sold is False and row.transferred is False
        row.auto_sold = True; row.transferred = True; s.commit()
        assert s.query(BattlePull).first().auto_sold is True


def test_reservation_defaults_and_packbattle_creator_wallet():
    from app.db import make_engine, make_session_factory, init_db
    from app.models import Reservation, PackBattle
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        r = Reservation(wallet="W", battle_id="b1", amount=50_000_000)
        s.add(r); s.commit()
        row = s.query(Reservation).first()
        assert row.status == "active" and row.amount == 50_000_000 and row.released_at is None
        b = PackBattle(id="b1", mode="pack", machine_code="m", price=50, max_players=2,
                       creator_wallet="W")
        s.add(b); s.commit()
        assert s.get(PackBattle, "b1").creator_wallet == "W"
