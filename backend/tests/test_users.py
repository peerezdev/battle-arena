from app.services.users import get_or_create_user, read_user_view, set_alias, leaderboard, history
from app.models import RatingHistory


def test_read_user_view_default_and_existing(Session):
    with Session() as s:
        assert read_user_view(s, "GHOST", 1200) == {"wallet": "GHOST", "alias": None, "elo": 1200, "games_played": 0}
        get_or_create_user(s, "A", 1200).elo = 1400
        s.commit()
        assert read_user_view(s, "A", 1200)["elo"] == 1400


def test_get_or_create(Session):
    with Session() as s:
        u = get_or_create_user(s, "A", elo_start=1200)
        s.commit()
        assert u.elo == 1200
        u2 = get_or_create_user(s, "A", elo_start=1200)
        assert u2.wallet == "A"  # no duplica


def test_set_alias(Session):
    with Session() as s:
        get_or_create_user(s, "A", elo_start=1200)
        set_alias(s, "A", "Mauro")
        s.commit()
        assert get_or_create_user(s, "A", elo_start=1200).alias == "Mauro"


def test_leaderboard_orders_by_elo(Session):
    with Session() as s:
        get_or_create_user(s, "A", elo_start=1200).elo = 1300
        get_or_create_user(s, "B", elo_start=1200).elo = 1500
        get_or_create_user(s, "C", elo_start=1200).elo = 1100
        s.commit()
        top = leaderboard(s, limit=2)
        assert [u.wallet for u in top] == ["B", "A"]


def test_history_returns_rows_desc(Session):
    with Session() as s:
        get_or_create_user(s, "A", elo_start=1200)
        s.add(RatingHistory(wallet="A", battle_pubkey="B1", elo_before=1200, elo_after=1216, result="win"))
        s.commit()
        rows = history(s, "A")
        assert len(rows) == 1 and rows[0].result == "win" and rows[0].elo_after == 1216
