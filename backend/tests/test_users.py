from app.services.users import get_or_create_user, read_user_view, read_user_stats, read_user_battles, set_alias, leaderboard, history
from app.models import RatingHistory, PackBattle, BattlePlayer, BattlePull


def test_read_user_battles(Session):
    with Session() as s:
        s.add(PackBattle(id="b1", mode="pack", machine_code="pokemon_50", price=50_000_000, max_players=2, status="settled", winner="W1"))
        s.add_all([BattlePlayer(battle_id="b1", player_wallet="W1"), BattlePlayer(battle_id="b1", player_wallet="W2")])
        s.add_all([
            BattlePull(battle_id="b1", player_wallet="W1", memo="m", nft_address="N1", insured_value=100.0),
            BattlePull(battle_id="b1", player_wallet="W2", memo="m", nft_address="N2", insured_value=30.0),
        ])
        s.add(PackBattle(id="b2", mode="pack", machine_code="pokemon_25", price=25_000_000, max_players=2, status="settled", winner="W2"))
        s.add_all([BattlePlayer(battle_id="b2", player_wallet="W1"), BattlePlayer(battle_id="b2", player_wallet="W2")])
        s.commit()

        rows = read_user_battles(s, "W1")
        assert len(rows) == 2
        byid = {r["battleId"]: r for r in rows}
        assert byid["b1"]["result"] == "win" and byid["b1"]["amountUsd"] == 130.0 and byid["b1"]["cards"] == 1
        assert byid["b1"]["opponents"] == ["W2"]
        assert byid["b2"]["result"] == "loss" and byid["b2"]["amountUsd"] == -25.0


def test_read_user_stats(Session):
    with Session() as s:
        # Battle 1: W1 wins. Pulls: W1=$100 (best hit), W2=$30 → combined loot $130.
        s.add(PackBattle(id="b1", mode="pack", machine_code="pokemon_50", price=50_000_000, max_players=2, status="settled", winner="W1"))
        s.add_all([BattlePlayer(battle_id="b1", player_wallet="W1"), BattlePlayer(battle_id="b1", player_wallet="W2")])
        s.add_all([
            BattlePull(battle_id="b1", player_wallet="W1", memo="m", nft_address="N1", insured_value=100.0, name="Big Card", grade=10, rarity="rare", year="2016"),
            BattlePull(battle_id="b1", player_wallet="W2", memo="m", nft_address="N2", insured_value=30.0),
        ])
        # Battle 2: W1 loses (still counts toward battles + wagered).
        s.add(PackBattle(id="b2", mode="pack", machine_code="pokemon_25", price=25_000_000, max_players=2, status="settled", winner="W2"))
        s.add_all([BattlePlayer(battle_id="b2", player_wallet="W1"), BattlePlayer(battle_id="b2", player_wallet="W2")])
        # Battle 3: still in lobby → ignored.
        s.add(PackBattle(id="b3", mode="pack", machine_code="pokemon_50", price=50_000_000, max_players=2, status="lobby"))
        s.add(BattlePlayer(battle_id="b3", player_wallet="W1"))
        s.commit()

        st = read_user_stats(s, "W1")
        assert st["battles"] == 2
        assert st["wins"] == 1
        assert st["totalWageredUsd"] == 75.0          # (50M + 25M) / 1e6
        assert abs(st["winRate"] - 0.5) < 1e-9
        assert st["bestHit"]["valueUsd"] == 100.0 and st["bestHit"]["name"] == "Big Card"
        assert st["bestVictory"]["amountUsd"] == 130.0  # 100 + 30, the won battle's combined loot
        assert st["bestVictory"]["opponents"] == ["W2"]


def test_read_user_view_default_and_existing(Session):
    with Session() as s:
        assert read_user_view(s, "GHOST", 1200) == {"wallet": "GHOST", "alias": None, "elo": 1200,
                                                     "games_played": 0, "gimmighouls": 0, "referred_by": None,
                                                     "withdraw_address": None}
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
