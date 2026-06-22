import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePull
from app.services.pack_engine import settle_cards_to_winner
from app.services.nft_transfer import UnsupportedNftStandard


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:"); init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


class _Signer:
    def __init__(self): self.signed = []
    async def sign_solana(self, wallet_id, tx):
        self.signed.append((wallet_id, tx)); return f"signed-{tx}"


async def _noslp(_): return None
async def _ce(esc, nft): return True


def _battle_with_pulls(session, pulls):
    b = PackBattle(id="b1", mode="pack", machine_code="m", price=50, max_players=4, status="running")
    session.add(b)
    for w, nft, auto in pulls:
        session.add(BattlePull(battle_id="b1", player_wallet=w, memo=f"m-{w}",
                               nft_address=nft, auto_sold=auto))
    session.commit()
    return b


@pytest.mark.asyncio
async def test_settle_transfers_non_autosold_and_sweeps_usdc(session):
    b = _battle_with_pulls(session, [("A", "nftA", False), ("B", "nftB", True), ("C", None, False)])
    transfers, sweeps = [], []
    async def btx(esc, dest, nft): transfers.append((dest, nft)); return f"tx-{nft}"
    async def sub(signed): return "sig"
    async def sweep(esc, winner): sweeps.append((esc, winner)); return "sweep-tx"
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC", winner="A",
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), confirm_in_escrow=_ce,
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=2, wait_delay=0)
    # only the non-auto-sold pull with an nft was transferred
    assert transfers == [("A", "nftA")]
    assert sweeps == [("ESC", "A")]
    a = session.query(BattlePull).filter_by(player_wallet="A").first()
    bb = session.query(BattlePull).filter_by(player_wallet="B").first()
    assert a.transferred is True and bb.transferred is False


@pytest.mark.asyncio
async def test_settle_flags_unsupported_without_raising(session):
    b = _battle_with_pulls(session, [("A", "nftA", False)])
    async def btx(esc, dest, nft): raise UnsupportedNftStandard("cnft")
    async def sub(signed): return "sig"
    async def sweep(esc, winner): return None
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC", winner="A",
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), confirm_in_escrow=_ce,
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0)
    assert session.query(BattlePull).filter_by(player_wallet="A").first().transferred is False


@pytest.mark.asyncio
async def test_settle_retries_transient_then_flags(session):
    b = _battle_with_pulls(session, [("A", "nftA", False)])
    calls = {"n": 0}
    async def btx(esc, dest, nft):
        calls["n"] += 1; raise RuntimeError("rpc hiccup")
    async def sub(signed): return "sig"
    async def sweep(esc, winner): return None
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC", winner="A",
        build_transfer_tx=btx, submit_tx=sub, signer=_Signer(), confirm_in_escrow=_ce,
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0, retries=3)
    assert calls["n"] == 3   # retried 3×
    assert session.query(BattlePull).filter_by(player_wallet="A").first().transferred is False
