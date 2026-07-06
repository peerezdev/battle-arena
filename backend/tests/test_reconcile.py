"""Tests de reconcile_unresolved_pulls / has_pending_refunds."""
import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePull


@pytest.fixture
def session():
    e = make_engine("sqlite:///:memory:")
    init_db(e)
    with make_session_factory(e)() as s:
        yield s


def _mk(session, bid="v1", pulls=()):
    session.add(PackBattle(id=bid, mode="pack", machine_code="m", price=50, max_players=2,
                           status="voided", escrow_wallet_id="eid", escrow_address="ESC"))
    for p in pulls:
        session.add(p)
    session.commit()
    return session.get(PackBattle, bid)


class _Gacha:
    """opens: memo -> resultado; los memos que no estén devuelven pending=True siempre."""
    def __init__(self, opens):
        self.opens = opens
        self.calls = []

    async def open_pack(self, memo):
        self.calls.append(memo)
        return self.opens.get(memo, {"pending": True})


async def _noslp(_):
    return None


@pytest.mark.asyncio
async def test_reconcile_resuelve_pull_pendiente_y_persiste_campos(session):
    from app.services.reconcile import reconcile_unresolved_pulls
    b = _mk(session, pulls=[BattlePull(battle_id="v1", player_wallet="A", memo="mA", round_number=1)])
    gacha = _Gacha({"mA": {"pending": False, "nft_address": "nftA", "insured_value": 120,
                           "grade": 9, "rarity": "Epic", "year": "1999", "name": "Charizard",
                           "auto_sold": False}})
    n = await reconcile_unresolved_pulls(session, b, gacha=gacha, sleep_fn=_noslp)
    assert n == 1
    p = session.query(BattlePull).filter_by(battle_id="v1").first()
    assert p.nft_address == "nftA" and p.insured_value == 120 and p.rarity == "Epic"
    assert p.name == "Charizard" and p.auto_sold is False


@pytest.mark.asyncio
async def test_reconcile_pull_que_nunca_resuelve_devuelve_cero_sin_lanzar(session):
    from app.services.reconcile import reconcile_unresolved_pulls
    b = _mk(session, pulls=[BattlePull(battle_id="v1", player_wallet="A", memo="mA", round_number=1)])
    gacha = _Gacha({})   # siempre pending
    n = await reconcile_unresolved_pulls(session, b, gacha=gacha, sleep_fn=_noslp, max_attempts=2)
    assert n == 0
    assert session.query(BattlePull).filter_by(battle_id="v1").first().nft_address is None


@pytest.mark.asyncio
async def test_reconcile_ignora_pulls_ya_resueltas(session):
    from app.services.reconcile import reconcile_unresolved_pulls
    b = _mk(session, pulls=[BattlePull(battle_id="v1", player_wallet="A", memo="mA",
                                       nft_address="nftA", round_number=1)])
    gacha = _Gacha({})
    n = await reconcile_unresolved_pulls(session, b, gacha=gacha, sleep_fn=_noslp)
    assert n == 0 and gacha.calls == []


@pytest.mark.asyncio
async def test_reconcile_gacha_exception_no_lanza(session):
    from app.services.reconcile import reconcile_unresolved_pulls
    b = _mk(session, pulls=[BattlePull(battle_id="v1", player_wallet="A", memo="mA", round_number=1)])
    class _Boom:
        async def open_pack(self, memo):
            raise RuntimeError("cc down")
    n = await reconcile_unresolved_pulls(session, b, gacha=_Boom(), sleep_fn=_noslp)
    assert n == 0


def test_has_pending_refunds(session):
    from app.services.reconcile import has_pending_refunds
    b = _mk(session, pulls=[
        BattlePull(battle_id="v1", player_wallet="A", memo="mA", nft_address="nftA",
                   refunded=True, round_number=1),
        BattlePull(battle_id="v1", player_wallet="B", memo="mB", round_number=1),
    ])
    assert has_pending_refunds(session, b) is True
    session.query(BattlePull).filter_by(player_wallet="B").first().refunded = True
    session.commit()
    assert has_pending_refunds(session, b) is False
