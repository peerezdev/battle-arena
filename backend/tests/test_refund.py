import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePull
from app.services.refund import refund_pack_void


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


class _Signer:
    async def sign_solana(self, wallet_id, tx): return f"signed-{tx}"


async def _noslp(_): return None
async def _ce(esc, nft): return True


def _battle(session, pulls):
    b = PackBattle(id="b1", mode="pack", machine_code="m", price=50, max_players=4, status="voided")
    session.add(b)
    for w, nft, auto, bb in pulls:
        session.add(BattlePull(battle_id="b1", player_wallet=w, memo=f"m-{w}",
                               nft_address=nft, auto_sold=auto, buyback_amount=bb))
    session.commit()
    return b


@pytest.mark.asyncio
async def test_refund_pack_void_returns_cards_and_usdc_to_pullers(session):
    # A: non-common card → returned to A. B: auto-sold common → 42 USDC to B. C: no pull → nothing.
    b = _battle(session, [("A", "nftA", False, None), ("B", "nftB", True, 42_000_000), ("C", None, False, None)])
    cards, usdc = [], []
    async def btx(esc, dest, nft): cards.append((dest, nft)); return f"tx-{nft}"
    async def usdctx(src, dest, amt): usdc.append((dest, amt)); return f"u-{dest}"
    async def sub(signed): return "sig"
    await refund_pack_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), build_usdc_transfer_tx=usdctx,
        confirm_in_escrow=_ce, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0)
    assert cards == [("A", "nftA")]
    assert usdc == [("B", 42_000_000)]


@pytest.mark.asyncio
async def test_refund_pack_void_noop_without_escrow(session):
    b = _battle(session, [("A", "nftA", False, None)])
    cards = []
    async def btx(esc, dest, nft): cards.append((dest, nft)); return "x"
    async def usdctx(src, dest, amt): return "u"
    async def sub(signed): return "sig"
    await refund_pack_void(session, b, escrow_wallet_id=None, escrow_address=None,
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), build_usdc_transfer_tx=usdctx,
        confirm_in_escrow=_ce, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0)
    assert cards == []   # no escrow → nothing refunded


from app.models import BattlePlayer  # noqa: E402
from app.services.refund import refund_royale_void  # noqa: E402


@pytest.mark.asyncio
async def test_refund_royale_void_noop_without_escrow(session):
    """No escrow → refund_royale_void is a no-op; no cards, no USDC, no buybacks."""
    b = PackBattle(id="r0", mode="royale", machine_code="m", price=50, max_players=2, status="voided")
    session.add(b)
    session.add(BattlePlayer(battle_id="r0", player_wallet="A", eliminated_round=None))
    session.add(BattlePull(battle_id="r0", player_wallet="A", memo="mA", round_number=1,
                           nft_address="nftA", auto_sold=False))
    session.commit()

    cards, usdc, bought = [], [], []
    async def btx(esc, dest, nft): cards.append((dest, nft)); return f"tx-{nft}"
    async def usdctx(src, dest, amt): usdc.append((dest, amt)); return f"u-{dest}"
    async def sub(signed): return "sig"
    async def buyback(nft): bought.append(nft)
    async def esc_bal(esc): return 0

    await refund_royale_void(session, b, escrow_wallet_id=None, escrow_address=None,
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), build_usdc_transfer_tx=usdctx,
        buyback_to_escrow=buyback, escrow_usdc_balance=esc_bal, confirm_in_escrow=_ce,
        sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0)

    assert cards == []
    assert usdc == []
    assert bought == []


@pytest.mark.asyncio
async def test_refund_royale_void_alive_get_pulls_eliminated_bought_back_leftover_split(session):
    # 3-player royale; C eliminated round 1. A & B alive.
    # Pulls: A r1 non-common nftA1; A r2 auto-sold common (bb=42); B r1 non-common nftB1;
    #        C r1 non-common nftC1 (eliminated → bought back).
    b = PackBattle(id="r1", mode="royale", machine_code="m", price=50, max_players=3, status="voided")
    session.add(b)
    session.add_all([
        BattlePlayer(battle_id="r1", player_wallet="A", eliminated_round=None),
        BattlePlayer(battle_id="r1", player_wallet="B", eliminated_round=None),
        BattlePlayer(battle_id="r1", player_wallet="C", eliminated_round=1),
    ])
    session.add_all([
        BattlePull(battle_id="r1", player_wallet="A", memo="mA1", round_number=1, nft_address="nftA1", auto_sold=False),
        BattlePull(battle_id="r1", player_wallet="A", memo="mA2", round_number=2, nft_address="nftA2", auto_sold=True, buyback_amount=42_000_000),
        BattlePull(battle_id="r1", player_wallet="B", memo="mB1", round_number=1, nft_address="nftB1", auto_sold=False),
        BattlePull(battle_id="r1", player_wallet="C", memo="mC1", round_number=1, nft_address="nftC1", auto_sold=False),
    ])
    session.commit()

    cards, usdc, bought = [], [], []
    async def btx(esc, dest, nft): cards.append((dest, nft)); return f"tx-{nft}"
    async def usdctx(src, dest, amt): usdc.append((dest, amt)); return f"u-{dest}-{amt}"
    async def sub(signed): return "sig"
    async def buyback(nft): bought.append(nft)
    async def esc_bal(esc): return 300_000_000  # leftover after alive refunds + buybacks (mocked)

    await refund_royale_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), build_usdc_transfer_tx=usdctx,
        buyback_to_escrow=buyback, escrow_usdc_balance=esc_bal, confirm_in_escrow=_ce,
        sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0)

    # Alive cards returned to their owners (A's nftA1, B's nftB1); C's card NOT returned to C.
    assert sorted(cards) == [("A", "nftA1"), ("B", "nftB1")]
    # C's eliminated card was bought back.
    assert bought == ["nftC1"]
    # A's auto-sold common refunded (42), then leftover 300 split equally → 150 each alive.
    assert ("A", 42_000_000) in usdc
    assert usdc.count(("A", 150_000_000)) == 1 and usdc.count(("B", 150_000_000)) == 1
    # C gets nothing.
    assert all(dest != "C" for dest, _ in usdc)
    assert all(dest != "C" for dest, _ in cards)


# ── Idempotencia vía BattlePull.refunded ─────────────────────────────────────

def _mk_pack_void(session, bid="pv1"):
    from app.models import PackBattle, BattlePull
    session.add(PackBattle(id=bid, mode="pack", machine_code="m", price=50, max_players=2,
                           status="voided", escrow_wallet_id="eid", escrow_address="ESC"))
    session.add(BattlePull(battle_id=bid, player_wallet="A", memo="mA", nft_address="nftA",
                           insured_value=100, round_number=1))
    session.add(BattlePull(battle_id=bid, player_wallet="B", memo="mB", auto_sold=True,
                           buyback_amount=42_000_000, round_number=1))
    session.commit()
    return session.get(PackBattle, bid)


class _Signer:
    async def sign_solana(self, wallet_id, tx):
        return f"signed-{tx}"


async def _noslp(_):
    return None


@pytest.mark.asyncio
async def test_refund_pack_void_marks_refunded_and_second_call_is_noop(session):
    from app.models import BattlePull
    from app.services.refund import refund_pack_void
    b = _mk_pack_void(session)
    built, usdc = [], []
    async def btx(esc, dest, nft): built.append((dest, nft)); return f"x-{nft}"
    async def utx(src, dest, amt): usdc.append((dest, amt)); return "u-tx"
    async def sub(s): return "sig"
    async def ce(esc, nft): return True

    await refund_pack_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
                           build_transfer_tx=btx, submit_tx=sub, signer=_Signer(),
                           build_usdc_transfer_tx=utx, confirm_in_escrow=ce, sleep_fn=_noslp)
    assert built == [("A", "nftA")] and usdc == [("B", 42_000_000)]
    pulls = {p.player_wallet: p for p in session.query(BattlePull).filter_by(battle_id="pv1").all()}
    assert pulls["A"].refunded is True and pulls["B"].refunded is True

    # Segunda pasada (barrido): no se re-transfiere nada.
    await refund_pack_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
                           build_transfer_tx=btx, submit_tx=sub, signer=_Signer(),
                           build_usdc_transfer_tx=utx, confirm_in_escrow=ce, sleep_fn=_noslp)
    assert built == [("A", "nftA")] and usdc == [("B", 42_000_000)]


@pytest.mark.asyncio
async def test_refund_pack_void_autosold_sin_buyback_se_marca_sin_mover_fondos(session):
    from app.models import PackBattle, BattlePull
    from app.services.refund import refund_pack_void
    session.add(PackBattle(id="pv2", mode="pack", machine_code="m", price=50, max_players=2,
                           status="voided", escrow_wallet_id="eid", escrow_address="ESC"))
    session.add(BattlePull(battle_id="pv2", player_wallet="A", memo="mA", auto_sold=True,
                           buyback_amount=None, round_number=1))
    session.commit()
    b = session.get(PackBattle, "pv2")
    moved = []
    async def utx(src, dest, amt): moved.append(amt); return "u"
    async def btx(esc, dest, nft): moved.append(nft); return "x"
    async def sub(s): return "sig"
    async def ce(esc, nft): return True
    await refund_pack_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
                           build_transfer_tx=btx, submit_tx=sub, signer=_Signer(),
                           build_usdc_transfer_tx=utx, confirm_in_escrow=ce, sleep_fn=_noslp)
    assert moved == []
    p = session.query(BattlePull).filter_by(battle_id="pv2").first()
    assert p.refunded is True


@pytest.mark.asyncio
async def test_refund_pack_void_fallo_no_marca_refunded(session):
    """Si el submit falla todas las veces, refunded queda False (reintentable en el barrido)."""
    from app.models import BattlePull
    from app.services.refund import refund_pack_void
    b = _mk_pack_void(session, bid="pv3")
    async def btx(esc, dest, nft): return f"x-{nft}"
    async def utx(src, dest, amt): return "u-tx"
    async def sub_fail(s): raise RuntimeError("rpc down")
    async def ce(esc, nft): return True
    await refund_pack_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
                           build_transfer_tx=btx, submit_tx=sub_fail, signer=_Signer(),
                           build_usdc_transfer_tx=utx, confirm_in_escrow=ce,
                           sleep_fn=_noslp, max_attempts=2)
    pulls = session.query(BattlePull).filter_by(battle_id="pv3").all()
    assert all(p.refunded is False for p in pulls)


@pytest.mark.asyncio
async def test_refund_royale_void_marca_refunded_y_es_reentrante(session):
    from app.models import PackBattle, BattlePlayer, BattlePull
    from app.services.refund import refund_royale_void
    session.add(PackBattle(id="rv1", mode="royale", machine_code="m", price=50, max_players=3,
                           status="voided", escrow_wallet_id="eid", escrow_address="ESC"))
    session.add_all([
        BattlePlayer(battle_id="rv1", player_wallet="A"),                      # vivo
        BattlePlayer(battle_id="rv1", player_wallet="B"),                      # vivo
        BattlePlayer(battle_id="rv1", player_wallet="E", eliminated_round=1),  # eliminado
    ])
    session.add_all([
        BattlePull(battle_id="rv1", player_wallet="A", memo="mA", nft_address="nftA", round_number=1),
        BattlePull(battle_id="rv1", player_wallet="B", memo="mB", auto_sold=True,
                   buyback_amount=10_000_000, round_number=1),
        BattlePull(battle_id="rv1", player_wallet="E", memo="mE", nft_address="nftE", round_number=1),
        BattlePull(battle_id="rv1", player_wallet="E", memo="mE2", auto_sold=True,
                   buyback_amount=5_000_000, round_number=2),
    ])
    session.commit()
    b = session.get(PackBattle, "rv1")
    built, usdc, buybacks = [], [], []
    async def btx(esc, dest, nft): built.append((dest, nft)); return f"x-{nft}"
    async def utx(src, dest, amt): usdc.append((dest, amt)); return "u"
    async def sub(s): return "sig"
    async def ce(esc, nft): return True
    async def bb(nft): buybacks.append(nft)
    async def bal(esc): return 0   # sin sobrante → sin split

    kw = dict(escrow_wallet_id="eid", escrow_address="ESC", build_transfer_tx=btx,
              submit_tx=sub, signer=_Signer(), build_usdc_transfer_tx=utx,
              buyback_to_escrow=bb, escrow_usdc_balance=bal, confirm_in_escrow=ce,
              sleep_fn=_noslp)
    await refund_royale_void(session, b, **kw)
    assert built == [("A", "nftA")]
    assert usdc == [("B", 10_000_000)]
    assert buybacks == ["nftE"]
    pulls = session.query(BattlePull).filter_by(battle_id="rv1").all()
    assert all(p.refunded is True for p in pulls)   # incl. auto-sold del eliminado (nada que devolver)

    # Re-ejecución completa (barrido): nada se repite.
    await refund_royale_void(session, b, **kw)
    assert built == [("A", "nftA")] and usdc == [("B", 10_000_000)] and buybacks == ["nftE"]


# ── libro de caja del buy-in ──────────────────────────────────────────────────
# El reparto del sobrante llamaba a _sign_submit_retry y TIRABA su resultado. Un envío fallido no
# dejaba rastro: su parte se quedaba en el escrow sin dueño conocido. Medido en devnet, una royale
# anulada de 4 jugadores retenía exactamente una parte, y sin registro por jugador no había forma de
# saber cuál de los cuatro se quedó sin cobrar — solo forense on-chain.

def _royale_anulada(session, wallets, buyin=100_000_000):
    b = PackBattle(id="rv", mode="royale", machine_code="m", price=50,
                   max_players=len(wallets), status="voided")
    session.add(b)
    for w in wallets:
        session.add(BattlePlayer(battle_id="rv", player_wallet=w, buyin_paid=buyin))
    session.commit()
    return b


async def _sin_pulls(session, b, *, falla_para=(), saldo=400_000_000):
    enviados = []

    async def usdctx(src, dest, amt):
        if dest in falla_para:
            raise RuntimeError("la red dijo que no")
        enviados.append((dest, amt))
        return f"u-{dest}"

    async def sub(signed):
        return "sig"

    async def saldo_escrow(esc):
        return saldo

    async def buyback(nft):
        return None

    async def btx(esc, dest, nft):
        return "x"

    await refund_royale_void(session, b, escrow_wallet_id="eid", escrow_address="ESC",
                             build_transfer_tx=btx, submit_tx=sub, signer=_Signer(),
                             build_usdc_transfer_tx=usdctx, buyback_to_escrow=buyback,
                             escrow_usdc_balance=saldo_escrow, confirm_in_escrow=_ce,
                             sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0, max_attempts=2)
    return enviados


@pytest.mark.asyncio
async def test_el_reembolso_del_sobrante_queda_anotado(session):
    b = _royale_anulada(session, ["A", "B", "C", "D"])
    enviados = await _sin_pulls(session, b)
    assert len(enviados) == 4
    for p in session.query(BattlePlayer).filter_by(battle_id="rv").all():
        assert p.refunded_at is not None, f"{p.player_wallet} cobró pero no consta"
        assert p.refund_amount == 100_000_000


@pytest.mark.asyncio
async def test_a_quien_no_cobra_se_le_ve_la_deuda(session):
    """Lo que hacía irreconciliable el lío: ahora el que falla queda señalado."""
    b = _royale_anulada(session, ["A", "B", "C", "D"])
    await _sin_pulls(session, b, falla_para={"C"})
    filas = {p.player_wallet: p for p in session.query(BattlePlayer).filter_by(battle_id="rv").all()}
    assert filas["C"].refunded_at is None, "C no cobró: no puede constar como reembolsado"
    assert filas["C"].buyin_paid == 100_000_000, "y sigue constando lo que pagó"
    for w in ("A", "B", "D"):
        assert filas[w].refunded_at is not None
    # Esta consulta es la que antes no se podía hacer: ¿a quién se le debe dinero?
    deudores = [p.player_wallet for p in session.query(BattlePlayer)
                .filter_by(battle_id="rv", refunded_at=None).all() if p.buyin_paid > 0]
    assert deudores == ["C"]
