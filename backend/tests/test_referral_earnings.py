"""Rev-share del rake: esquema del ledger, devengo y consultas de claim."""
from app.models import (BattlePlayer, PackBattle, ReferralCode, ReferralEarning,
                        ReferralPayout, User)
from app.services.referral_earnings import accrue_rake_earnings


def test_referral_code_rake_share_default(Session):
    s = Session()
    rc = ReferralCode(code="IBAI", name="Ibai")
    s.add(rc); s.commit()
    assert s.get(ReferralCode, "IBAI").rake_share_pct == 0.25


def test_earning_and_payout_tables_exist(Session):
    s = Session()
    s.add(ReferralEarning(code="IBAI", referrer_wallet="W_OWNER", referred_wallet="W_REF",
                          battle_id="b1", amount_base_units=500_000))
    s.add(ReferralPayout(wallet="W_OWNER", amount_base_units=500_000, status="pending"))
    s.commit()
    e = s.query(ReferralEarning).one()
    assert e.payout_id is None and e.amount_base_units == 500_000
    p = s.query(ReferralPayout).one()
    assert p.status == "pending" and p.signature is None


def test_rake_share_column_migrates_on_existing_db():
    """Una BD con referral_codes SIN la columna debe ganarla al init (no hay framework de
    migraciones: _ENSURE_COLUMNS es el mecanismo)."""
    from sqlalchemy import create_engine, inspect, text
    from sqlalchemy.pool import StaticPool
    from app.db import init_db
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    with engine.begin() as c:
        c.execute(text("CREATE TABLE referral_codes (code VARCHAR PRIMARY KEY, name VARCHAR, "
                       "boost_pct FLOAT, referrer_pct FLOAT, owner_wallet VARCHAR, "
                       "earned INTEGER, created_at DATETIME)"))
    init_db(engine)
    assert "rake_share_pct" in {c["name"] for c in inspect(engine).get_columns("referral_codes")}


def _battle_with(session, bid, players):
    """Crea una batalla settled con `players` = lista de (wallet, código o None)."""
    session.add(PackBattle(id=bid, mode="pack", machine_code="m50", price=50_000_000,
                           max_players=len(players), status="settled"))
    for wallet, code in players:
        session.add(BattlePlayer(battle_id=bid, player_wallet=wallet))
        session.add(User(wallet=wallet, referred_by=code))
    session.commit()


def test_reparto_por_jugador_gane_o_pierda(Session):
    s = Session()
    s.add(ReferralCode(code="IBAI", name="Ibai", owner_wallet="W_IBAI", rake_share_pct=0.25))
    s.add(ReferralCode(code="MAURO", name="Mauro", owner_wallet="W_MAURO", rake_share_pct=0.25))
    s.commit()
    # 4 jugadores, fee cobrado $8 → parte por jugador $2 → 25% = $0.50 por referido
    _battle_with(s, "b1", [("ANA", "IBAI"), ("BRUNO", "IBAI"),
                           ("CARLA", "MAURO"), ("DAVID", None)])
    rows = accrue_rake_earnings(s, "b1", 8_000_000)
    s.commit()
    by_ref = {}
    for r in rows:
        by_ref[r.referrer_wallet] = by_ref.get(r.referrer_wallet, 0) + r.amount_base_units
    assert by_ref == {"W_IBAI": 1_000_000, "W_MAURO": 500_000}   # IBAI cobra por 2 referidos
    assert len(rows) == 3                                        # DAVID no genera fila


def test_redondeo_siempre_a_la_baja(Session):
    """El caso tiene que distinguir truncar de redondear, o no prueba nada.

    Con 1_000_002 y 3 jugadores: 333_334 × 0,25 = 83_333,5 exacto. Truncando da 83_333;
    redondeando daría 83_334, o sea medio céntimo que la plataforma no cobró. Con la fracción
    a 0,25 (el caso obvio) los dos caminos dan lo mismo y el test pasaría igual estando mal.
    """
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "b2", [("A", "C"), ("B", None), ("D", None)])
    rows = accrue_rake_earnings(s, "b2", 1_000_002)
    assert rows[0].amount_base_units == 83_333    # el polvo queda en plataforma


def test_fee_parcial_devenga_proporcionalmente(Session):
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "b3", [("A", "C"), ("B", None)])
    # El ganador solo cubrió $5 de los $8 teóricos → se devenga sobre $5
    rows = accrue_rake_earnings(s, "b3", 5_000_000)
    assert rows[0].amount_base_units == 625_000    # (5_000_000 // 2) * 0.25


def test_auto_referido_no_devenga(Session):
    """Me hago una segunda cuenta y me refiero a mí mismo: no puede pagar."""
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="ME", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "b4", [("ME", "C"), ("B", None)])
    assert accrue_rake_earnings(s, "b4", 8_000_000) == []


def test_codigo_sin_owner_no_devenga(Session):
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet=None, rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "b5", [("A", "C"), ("B", None)])
    assert accrue_rake_earnings(s, "b5", 8_000_000) == []


def test_sin_referidos_no_devenga(Session):
    s = Session()
    _battle_with(s, "b6", [("A", None), ("B", None)])
    assert accrue_rake_earnings(s, "b6", 8_000_000) == []


def test_fee_cero_no_devenga(Session):
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "b7", [("A", "C"), ("B", None)])
    assert accrue_rake_earnings(s, "b7", 0) == []


def test_rake_share_por_codigo_se_respeta(Session):
    s = Session()
    s.add(ReferralCode(code="VIP", name="vip", owner_wallet="W_VIP", rake_share_pct=0.40))
    s.commit()
    _battle_with(s, "b8", [("A", "VIP"), ("B", None)])
    rows = accrue_rake_earnings(s, "b8", 8_000_000)
    assert rows[0].amount_base_units == 1_600_000   # (8M // 2) * 0.40
