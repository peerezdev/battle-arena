"""Rev-share del rake: esquema del ledger, devengo y consultas de claim."""
from app.models import ReferralCode, ReferralEarning, ReferralPayout


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
