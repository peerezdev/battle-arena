"""Rev-share del rake: esquema del ledger, devengo y consultas de claim."""
from app.models import (BattlePlayer, PackBattle, ReferralCode, ReferralEarning,
                        ReferralPayout, User)
from app.services.battle_fees import collect_battle_fee
from app.config import Settings
from app.services.referral_earnings import (accrue_rake_earnings, claim_earnings,
                                            mark_payout_failed, mark_payout_sent,
                                            referrer_summary)


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


class _Gacha:
    async def machines(self):
        return [{"code": "m50", "instantBuyback": 1.0}]


async def _noop(*a, **k):
    return None


def _fee_deps(balance=100_000_000):
    """Dependencias inyectadas de collect_battle_fee: todo falso, nada toca la red."""
    async def usdc_balance(_w):
        return balance
    async def build_tx(_a, _b, _amt):
        return "TX"
    async def submit(_signed):
        return "SIG"
    class _Signer:
        async def sign_solana(self, _wid, tx):
            return tx
    return dict(gacha=_Gacha(), signer=_Signer(), resolve_wallet_id=lambda w: f"wid-{w}",
                submit_tx=submit, usdc_balance=usdc_balance, build_usdc_transfer_tx=build_tx,
                sleep_fn=_noop)


async def test_cobrar_el_fee_devenga_rev_share(Session):
    from app.models import BattlePull
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "bf", [("A", "C"), ("B", None)])
    b = s.get(PackBattle, "bf")
    # Base del fee: una carta auto-vendida por $400 → fee 1% (0.5% × 2) = $4
    s.add(BattlePull(battle_id="bf", player_wallet="A", memo="m", round_number=1,
                     nft_address="n1", insured_value=400.0, auto_sold=True,
                     buyback_amount=400_000_000))
    s.commit()

    charged = await collect_battle_fee(s, b, "A", 2, **_fee_deps())

    assert charged == 4_000_000 and b.fee_charged is True
    rows = s.query(ReferralEarning).filter_by(battle_id="bf").all()
    assert len(rows) == 1
    assert rows[0].amount_base_units == 500_000    # (4M // 2) * 0.25


async def test_settle_repetido_no_duplica_devengos(Session):
    """El guard fee_charged ya protege el cobro; el devengo hereda esa protección."""
    from app.models import BattlePull
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "bf2", [("A", "C"), ("B", None)])
    b = s.get(PackBattle, "bf2")
    s.add(BattlePull(battle_id="bf2", player_wallet="A", memo="m", round_number=1,
                     nft_address="n1", insured_value=400.0, auto_sold=True,
                     buyback_amount=400_000_000))
    s.commit()

    await collect_battle_fee(s, b, "A", 2, **_fee_deps())
    await collect_battle_fee(s, b, "A", 2, **_fee_deps())   # segunda pasada

    assert s.query(ReferralEarning).filter_by(battle_id="bf2").count() == 1


async def test_sin_saldo_no_devenga(Session):
    """Fee no cobrado (ganador a cero) → no hay dinero que repartir."""
    from app.models import BattlePull
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "bf3", [("A", "C"), ("B", None)])
    b = s.get(PackBattle, "bf3")
    s.add(BattlePull(battle_id="bf3", player_wallet="A", memo="m", round_number=1,
                     nft_address="n1", insured_value=400.0, auto_sold=True,
                     buyback_amount=400_000_000))
    s.commit()

    await collect_battle_fee(s, b, "A", 2, **_fee_deps(balance=0))

    assert s.query(ReferralEarning).filter_by(battle_id="bf3").count() == 0


def test_claim_min_default():
    assert Settings().referral_claim_min_base_units == 5_000_000   # $5


def test_summary_sin_codigos_devuelve_ceros(Session):
    s = Session()
    out = referrer_summary(s, "NADIE")
    assert out["codes"] == []
    assert out["unclaimed_base_units"] == 0 and out["lifetime_base_units"] == 0


def test_summary_cuenta_referidos_unclaimed_y_lifetime(Session):
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.add_all([User(wallet="A", referred_by="C"), User(wallet="B", referred_by="C"),
               User(wallet="X", referred_by=None)])
    s.add(ReferralEarning(code="C", referrer_wallet="W_OWNER", referred_wallet="A",
                          battle_id="b1", amount_base_units=500_000))
    s.add(ReferralEarning(code="C", referrer_wallet="W_OWNER", referred_wallet="B",
                          battle_id="b1", amount_base_units=300_000, payout_id=7))
    s.commit()
    out = referrer_summary(s, "W_OWNER")
    assert out["codes"] == [{"code": "C", "rake_share_pct": 0.25, "referred_count": 2}]
    assert out["unclaimed_base_units"] == 500_000    # la de payout_id=7 ya se cobró
    assert out["lifetime_base_units"] == 800_000


def test_claim_agrega_lo_pendiente_y_deja_el_payout_en_pending(Session):
    s = Session()
    s.add_all([
        ReferralEarning(code="C", referrer_wallet="W", referred_wallet="A",
                        battle_id="b1", amount_base_units=500_000),
        ReferralEarning(code="C", referrer_wallet="W", referred_wallet="B",
                        battle_id="b2", amount_base_units=250_000),
        ReferralEarning(code="C", referrer_wallet="OTRO", referred_wallet="Z",
                        battle_id="b3", amount_base_units=999_000),
    ])
    s.commit()
    payout, ids = claim_earnings(s, "W")
    assert payout.amount_base_units == 750_000 and payout.status == "pending"
    assert len(ids) == 2                       # no arrastra las de OTRO
    # Hasta que no se marque como pagado, las earnings siguen sin payout_id. El commit es
    # necesario para que la comprobación sea real: la sesión va con autoflush=False, así que sin
    # él la consulta lee la base sin los cambios pendientes y pasaría aunque claim_earnings las
    # hubiera marcado ya — que es justo el fallo que este test existe para impedir.
    s.commit()
    assert s.query(ReferralEarning).filter_by(payout_id=None).count() == 3


def test_claim_sin_pendientes_devuelve_none(Session):
    s = Session()
    assert claim_earnings(s, "W") == (None, [])


def test_mark_sent_marca_earnings_y_firma(Session):
    s = Session()
    s.add(ReferralEarning(code="C", referrer_wallet="W", referred_wallet="A",
                          battle_id="b1", amount_base_units=500_000))
    s.commit()
    payout, ids = claim_earnings(s, "W")
    mark_payout_sent(s, payout, ids, "SIG123")
    assert payout.status == "sent" and payout.signature == "SIG123"
    assert s.query(ReferralEarning).one().payout_id == payout.id
    assert referrer_summary(s, "W")["unclaimed_base_units"] == 0


def test_mark_failed_deja_las_earnings_reclamables(Session):
    s = Session()
    s.add(ReferralEarning(code="C", referrer_wallet="W", referred_wallet="A",
                          battle_id="b1", amount_base_units=500_000))
    s.commit()
    payout, ids = claim_earnings(s, "W")
    mark_payout_failed(s, payout)
    assert payout.status == "failed"
    # El dinero no se pierde: se puede volver a reclamar
    assert referrer_summary(s, "W")["unclaimed_base_units"] == 500_000


# ── que no se pueda pagar dos veces por lo mismo ──────────────────────────────
# El devengo no duplica porque vive dentro del guard `fee_charged` del cobro. Esa protección es
# PRESTADA: si alguien mueve el devengo de sitio o cambia cómo funciona el guard, el referidor
# empezaría a acumular el doble y nadie se enteraría, porque no habría nada que lo comprobase.
# Estas dos defensas lo convierten en imposible en vez de en improbable.

def test_no_se_devenga_dos_veces_por_el_mismo_referido(Session):
    """Defensa 1, en el código: si ya hay devengo de esta batalla para este jugador, se salta."""
    s = Session()
    s.add(ReferralCode(code="C", name="c", owner_wallet="W_OWNER", rake_share_pct=0.25))
    s.commit()
    _battle_with(s, "bd", [("A", "C"), ("B", None)])

    primera = accrue_rake_earnings(s, "bd", 8_000_000)
    s.commit()
    segunda = accrue_rake_earnings(s, "bd", 8_000_000)   # el guard de arriba se rompió
    s.commit()

    assert len(primera) == 1
    assert segunda == [], "una segunda pasada no puede volver a devengar"
    assert s.query(ReferralEarning).filter_by(battle_id="bd").count() == 1


def test_la_base_rechaza_el_duplicado_aunque_se_inserte_a_mano(Session):
    """Defensa 2, en la base: la última línea, por si alguien inserta saltándose la función."""
    import pytest
    from sqlalchemy.exc import IntegrityError
    s = Session()
    s.add(ReferralEarning(code="C", referrer_wallet="W", referred_wallet="A",
                          battle_id="bx", amount_base_units=500_000))
    s.commit()
    s.add(ReferralEarning(code="C", referrer_wallet="W", referred_wallet="A",
                          battle_id="bx", amount_base_units=500_000))
    with pytest.raises(IntegrityError):
        s.commit()
    s.rollback()


def test_el_mismo_jugador_en_otra_batalla_si_devenga(Session):
    """La restricción es por (batalla, referido): jugar más partidas tiene que seguir pagando."""
    s = Session()
    s.add(ReferralEarning(code="C", referrer_wallet="W", referred_wallet="A",
                          battle_id="b_uno", amount_base_units=500_000))
    s.add(ReferralEarning(code="C", referrer_wallet="W", referred_wallet="A",
                          battle_id="b_dos", amount_base_units=500_000))
    s.commit()
    assert s.query(ReferralEarning).filter_by(referred_wallet="A").count() == 2
