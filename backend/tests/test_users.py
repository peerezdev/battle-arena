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


def test_royale_wager_and_history_use_buyin(Session):
    """Royale wager/history use the per-player buy-in, not b.price (the per-box price)."""
    from app.services.royale_funding import royale_buyin
    with Session() as s:
        s.add(PackBattle(id="r1", mode="royale", machine_code="pokemon_50", price=50_000_000, max_players=4, status="settled", winner="W2"))
        s.add_all([BattlePlayer(battle_id="r1", player_wallet="W1"), BattlePlayer(battle_id="r1", player_wallet="W2")])
        s.commit()
        buyin = royale_buyin(4, 50_000_000) / 1_000_000    # 112.5, not 50
        assert buyin > 50.0

        st = read_user_stats(s, "W1")
        assert st["battles"] == 1
        assert st["totalWageredUsd"] == buyin

        rows = read_user_battles(s, "W1")
        assert rows[0]["result"] == "loss" and rows[0]["amountUsd"] == -buyin


def test_gacha_out_of_wager_but_in_history(Session):
    """El gacha NO cuenta en `totalWageredUsd` —esa cifra es lo apostado en batallas— pero sí
    aparece en el historial, sobre a sobre, con su neto (valor − coste)."""
    from datetime import datetime, timezone
    from app.models import GachaPack
    with Session() as s:
        s.add(GachaPack(memo="g1", wallet="W1", pack_type="pokemon_50",
                        opened_at=datetime.now(timezone.utc), nft_address="N1",
                        price=50_000_000, insured_value=180.0, name="Charizard"))
        s.add(GachaPack(memo="g2", wallet="W1", pack_type="pokemon_50"))  # generated, not opened → ignored
        s.commit()

        st = read_user_stats(s, "W1")
        assert st["totalWageredUsd"] == 0.0         # sin batallas, el gacha no aporta nada

        rows = read_user_battles(s, "W1")
        gacha = [r for r in rows if r["kind"] == "gacha"]
        assert len(gacha) == 1
        assert gacha[0]["amountUsd"] == 130.0       # 180 pulled − 50 spent
        assert gacha[0]["pullName"] == "Charizard" and gacha[0]["machineCode"] == "pokemon_50"


def test_wager_with_battles_and_gacha_counts_only_battles(Session):
    """El caso que de verdad separa: un jugador con partida Y gacha. Sin este, un `wagered` que
    sumase el gacha pasaría el test de arriba, porque allí no hay ninguna batalla con la que
    contrastar."""
    from datetime import datetime, timezone
    from app.models import GachaPack
    with Session() as s:
        s.add(PackBattle(id="b1", mode="pack", machine_code="pokemon_25", price=25_000_000,
                         max_players=2, status="settled", winner="W1"))
        s.add(BattlePlayer(battle_id="b1", player_wallet="W1"))
        s.add(GachaPack(memo="g1", wallet="W1", pack_type="pokemon_50",
                        opened_at=datetime.now(timezone.utc), nft_address="N1",
                        price=50_000_000, insured_value=180.0))
        s.commit()

        # 25 de la batalla. Si el gacha contase serían 75.
        assert read_user_stats(s, "W1")["totalWageredUsd"] == 25.0


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


# ── best hit: las tres fuentes compiten ───────────────────────────────────────
# El mejor tirón del perfil miraba SOLO battle_pulls, así que una carta sacada en el gacha nunca
# podía ser la mejor por buena que fuese. Son la misma acción para el jugador: abrir un sobre.

from app.models import GachaPack  # noqa: E402


def _batalla_con_pull(s, bid, wallet, valor, *, mode="pack", ganador=None):
    s.add(PackBattle(id=bid, mode=mode, machine_code="pokemon_50", price=50_000_000,
                     max_players=2, status="settled", winner=ganador or wallet))
    s.add(BattlePlayer(battle_id=bid, player_wallet=wallet))
    s.add(BattlePull(battle_id=bid, player_wallet=wallet, memo=f"m-{bid}",
                     nft_address=f"nft-{bid}", insured_value=valor, name=f"Carta {valor}",
                     rarity="Rare", grade=9, year="2020"))


def _sobre(s, wallet, valor, *, memo="g1", abierto=True):
    s.add(GachaPack(memo=memo, wallet=wallet, pack_type="pokemon_50",
                    nft_address=f"nft-{memo}", insured_value=valor, name=f"Gacha {valor}",
                    rarity="Epic", price=50_000_000,
                    opened_at=__import__("datetime").datetime(2026, 7, 1) if abierto else None))


def test_best_hit_toma_la_del_gacha_si_es_la_mejor(Session):
    with Session() as s:
        _batalla_con_pull(s, "b1", "W1", 100.0)
        _sobre(s, "W1", 900.0)
        s.commit()
        bh = read_user_stats(s, "W1")["bestHit"]
        assert bh["valueUsd"] == 900.0
        assert bh["name"] == "Gacha 900.0"
        assert bh["source"] == "gacha"


def test_best_hit_toma_la_de_batalla_si_es_la_mejor(Session):
    with Session() as s:
        _batalla_con_pull(s, "b1", "W1", 500.0)
        _sobre(s, "W1", 40.0)
        s.commit()
        bh = read_user_stats(s, "W1")["bestHit"]
        assert bh["valueUsd"] == 500.0
        assert bh["source"] == "battle"
        assert (bh["grade"], bh["year"]) == (9, "2020")


def test_un_sobre_sin_abrir_no_cuenta(Session):
    """Todavía no se sabe qué hay dentro: contarlo sería enseñar una carta que el jugador no ha visto."""
    with Session() as s:
        _batalla_con_pull(s, "b1", "W1", 100.0)
        _sobre(s, "W1", 900.0, abierto=False)
        s.commit()
        assert read_user_stats(s, "W1")["bestHit"]["valueUsd"] == 100.0


def test_el_gacha_de_otro_jugador_no_cuenta(Session):
    with Session() as s:
        _batalla_con_pull(s, "b1", "W1", 100.0)
        _sobre(s, "OTRO", 900.0)
        s.commit()
        assert read_user_stats(s, "W1")["bestHit"]["valueUsd"] == 100.0


def test_sin_nada_no_hay_best_hit(Session):
    with Session() as s:
        assert read_user_stats(s, "W1")["bestHit"] is None


# ── best victory: la mejor carta de ESA partida ───────────────────────────────

def test_best_victory_trae_la_mejor_carta_de_la_partida(Session):
    with Session() as s:
        s.add(PackBattle(id="bv", mode="pack", machine_code="pokemon_50", price=50_000_000,
                         max_players=2, status="settled", winner="W1"))
        s.add_all([BattlePlayer(battle_id="bv", player_wallet="W1"),
                   BattlePlayer(battle_id="bv", player_wallet="W2")])
        # El botín son las tres; la mejor carta es la de 300.
        s.add(BattlePull(battle_id="bv", player_wallet="W1", memo="m1", nft_address="n1",
                         insured_value=120.0, name="Media", rarity="Rare", grade=8, year="2019"))
        s.add(BattlePull(battle_id="bv", player_wallet="W2", memo="m2", nft_address="n2",
                         insured_value=300.0, name="La buena", rarity="Epic", grade=10, year="2021"))
        s.add(BattlePull(battle_id="bv", player_wallet="W1", memo="m3", nft_address="n3",
                         insured_value=30.0, name="Chusta", rarity="Common", grade=6, year="2018"))
        s.commit()
        bv = read_user_stats(s, "W1")["bestVictory"]
        assert bv["amountUsd"] == 450.0          # el botín sigue siendo la suma
        assert bv["bestCard"]["name"] == "La buena"
        assert bv["bestCard"]["valueUsd"] == 300.0
        assert bv["bestCard"]["nftAddress"] == "n2"


def test_una_victoria_sin_cartas_no_inventa_una(Session):
    with Session() as s:
        s.add(PackBattle(id="bv", mode="pack", machine_code="pokemon_50", price=50_000_000,
                         max_players=2, status="settled", winner="W1"))
        s.add(BattlePlayer(battle_id="bv", player_wallet="W1"))
        s.commit()
        bv = read_user_stats(s, "W1")["bestVictory"]
        assert bv is not None and bv["bestCard"] is None
