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


from app.models import BattlePlayer, BattleRound  # noqa: E402
from app.services.refund import refund_royale_void  # noqa: E402


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
