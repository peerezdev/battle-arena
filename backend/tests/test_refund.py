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
