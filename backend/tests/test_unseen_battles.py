from datetime import datetime, timezone

from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.db import init_db, make_session_factory
from app.models import PackBattle, BattlePlayer, BattlePull
from app.services.users import read_unseen_battles, mark_battles_seen

WA = "So1anaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1"
WB = "So1anaBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB1"


def _session():
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    return make_session_factory(engine)()


def _battle(s, bid, *, mode="pack", status="settled", winner=None, players=(WA,), price=50_000_000):
    s.add(PackBattle(id=bid, mode=mode, machine_code="pokemon_50", price=price,
                     max_players=len(players), status=status, winner=winner,
                     settled_at=datetime.now(timezone.utc)))
    for w in players:
        s.add(BattlePlayer(battle_id=bid, player_wallet=w))
    s.commit()


def test_lista_las_terminadas_no_vistas_del_jugador():
    s = _session()
    _battle(s, "b1", winner=WA, players=(WA, WB))
    rows = read_unseen_battles(s, WA)
    assert [r["battle_id"] for r in rows] == ["b1"]
    assert rows[0]["won"] is True and rows[0]["mode"] == "pack"


def test_una_batalla_ya_vista_no_aparece():
    s = _session()
    _battle(s, "b1", winner=WA, players=(WA, WB))
    assert len(read_unseen_battles(s, WA)) == 1
    assert mark_battles_seen(s, WA, ["b1"]) == 1
    assert read_unseen_battles(s, WA) == []


def test_una_en_lobby_o_running_no_cuenta_como_pendiente():
    s = _session()
    _battle(s, "lobby", status="lobby", players=(WA,))
    _battle(s, "run", status="running", players=(WA,))
    assert read_unseen_battles(s, WA) == []


def test_una_anulada_aparece_con_la_entrada_como_reembolso():
    s = _session()
    _battle(s, "v1", status="voided", players=(WA, WB), price=50_000_000)
    rows = read_unseen_battles(s, WA)
    assert len(rows) == 1
    assert rows[0]["status"] == "voided"
    assert rows[0]["won"] is False
    assert rows[0]["amount_usd"] == 50.0     # la entrada, devuelta


def test_la_derrota_muestra_la_entrada_en_negativo():
    s = _session()
    _battle(s, "b1", winner=WB, players=(WA, WB), price=50_000_000)
    rows = read_unseen_battles(s, WA)
    assert rows[0]["won"] is False
    assert rows[0]["amount_usd"] == -50.0


def test_la_victoria_suma_el_botin():
    s = _session()
    _battle(s, "b1", winner=WA, players=(WA, WB))
    s.add(BattlePull(battle_id="b1", player_wallet=WA, memo="m1", round_number=1, insured_value=120.0))
    s.add(BattlePull(battle_id="b1", player_wallet=WB, memo="m2", round_number=1, insured_value=30.0))
    s.commit()
    rows = read_unseen_battles(s, WA)
    assert rows[0]["won"] is True
    assert rows[0]["amount_usd"] == 150.0    # todo el loot de la batalla va al ganador


def test_no_lista_ni_marca_batallas_de_otra_wallet():
    s = _session()
    _battle(s, "b1", winner=WB, players=(WB,))   # WA no participó
    assert read_unseen_battles(s, WA) == []
    assert mark_battles_seen(s, WA, ["b1"]) == 0
    # y la de WB sigue sin marcar
    assert len(read_unseen_battles(s, WB)) == 1


def test_marcar_visto_es_idempotente():
    s = _session()
    _battle(s, "b1", winner=WA, players=(WA,))
    assert mark_battles_seen(s, WA, ["b1"]) == 1
    assert mark_battles_seen(s, WA, ["b1"]) == 0    # ya estaba vista


def test_la_columna_seen_at_se_migra_en_una_db_existente():
    from sqlalchemy import inspect, text
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    # tabla battle_players en forma ANTIGUA, sin seen_at
    with engine.begin() as c:
        c.execute(text("CREATE TABLE battle_players (id INTEGER PRIMARY KEY, battle_id VARCHAR, "
                       "player_wallet VARCHAR, wallet_id VARCHAR, joined_at DATETIME, "
                       "eliminated_round INTEGER, accumulated_value FLOAT)"))
    init_db(engine)
    assert "seen_at" in {c["name"] for c in inspect(engine).get_columns("battle_players")}


def test_endpoints_exigen_auth():
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.chain.mock import MockChainSource
    engine = create_engine("sqlite:///:memory:",
                           connect_args={"check_same_thread": False}, poolclass=StaticPool)
    init_db(engine)
    app = create_app(make_session_factory(engine), MockChainSource(), privy=None)
    c = TestClient(app)
    assert c.get("/users/me/battles/unseen").status_code in (401, 503)
    assert c.post("/users/me/battles/seen", json={"battle_ids": ["x"]}).status_code in (401, 503)
