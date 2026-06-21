import pytest
from app.db import Base, make_engine, make_session_factory, init_db
from app.services.pack_engine import determine_winner, run_battle, PullOutcome
from app.models import PackBattle, BattlePlayer, BattlePull


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        yield s


def _po(w, v, g):
    return PullOutcome(player_wallet=w, memo=f"m-{w}", nft_address=f"nft-{w}", insured_value=v, grade=g)


def test_winner_by_value_then_grade_then_join_order():
    order = ["A", "B", "C"]
    assert determine_winner([_po("A", 100, 9), _po("B", 200, 8), _po("C", 50, 10)], order) == "B"
    assert determine_winner([_po("A", 100, 8), _po("B", 100, 9), _po("C", 100, 7)], order) == "B"  # grade
    assert determine_winner([_po("A", 100, 9), _po("B", 100, 9)], order) == "A"  # earliest join


class _Gacha:
    def __init__(self, opens):  # opens: wallet -> open result dict
        self.opens = opens; self.alt = None; self.pulled = []
    async def generate_pack(self, player_address, pack_type, alt_player_address=None):
        self.alt = alt_player_address; self.pulled.append(player_address)
        return {"memo": f"m-{player_address}", "transaction": f"tx-{player_address}"}
    async def open_pack(self, memo):
        w = memo.split("m-")[1]
        return {"pending": False, **self.opens[w]}
    async def submit_tx(self, signed_transaction):
        return {"signature": "ccsig", "confirmation_status": "confirmed"}


class _Signer:
    def __init__(self): self.sent = []; self.signed = []
    async def create_solana_wallet(self): return {"id": "esc-id", "address": "ESC"}
    async def sign_solana(self, wallet_id, tx):
        self.signed.append((wallet_id, tx)); return f"signed-{tx}"
    async def sign_and_send_solana(self, wallet_id, tx, sponsor=False):
        self.sent.append((wallet_id, tx, sponsor)); return f"sig-{len(self.sent)}"


@pytest.mark.asyncio
async def test_run_battle_settles_to_winner(session):
    b = PackBattle(id="b1", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="running")
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b1", player_wallet="A"),
                     BattlePlayer(battle_id="b1", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9},
                    "B": {"nft_address": "nB", "insured_value": 300, "grade": 8}})
    signer = _Signer()
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=lambda esc, win, nft: f"xfer-{nft}->{win}",
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026,6,21))
    assert out == "settled"
    assert b.winner == "B" and b.status == "settled" and b.escrow_address == "ESC"
    assert gacha.alt == "ESC"                       # pulls delivered to escrow
    # default is user-pays (sponsor=False): every broadcast carries sponsor=False
    assert all(s[2] is False for s in signer.sent)
    assert ("esc-id", "xfer-nA->B", False) in signer.sent and ("esc-id", "xfer-nB->B", False) in signer.sent
    assert session.query(BattlePull).filter_by(battle_id="b1").count() == 2
    pull_wallets = {s[0] for s in signer.signed}
    assert "A-id" in pull_wallets and "B-id" in pull_wallets
    rows = {r.player_wallet: r for r in session.query(BattlePull).filter_by(battle_id="b1").all()}
    assert rows["A"].nft_address == "nA" and rows["A"].insured_value == 100 and rows["A"].grade == 9
    assert rows["B"].nft_address == "nB" and rows["B"].insured_value == 300


@pytest.mark.asyncio
async def test_run_battle_sponsor_flag_propagates(session):
    b = PackBattle(id="b3", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="running")
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b3", player_wallet="A"),
                     BattlePlayer(battle_id="b3", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9},
                    "B": {"nft_address": "nB", "insured_value": 300, "grade": 8}})
    signer = _Signer()
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=lambda esc, win, nft: f"xfer-{nft}->{win}",
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026,6,21),
                           sponsor=True)
    assert out == "settled"
    # signer.sent contains only escrow→winner transfers (sponsor=True propagated).
    # Pull TXs go through sign_solana (sign-only) + gacha.submit_tx — no sponsor param by design.
    assert signer.sent and all(s[2] is True for s in signer.sent)


@pytest.mark.asyncio
async def test_run_battle_voids_when_player_cannot_play(session):
    b = PackBattle(id="b2", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="running")
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b2", player_wallet="A"),
                     BattlePlayer(battle_id="b2", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}})
    signer = _Signer()
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=lambda esc, win, nft: "x",
                           can_play=lambda w: w != "B", now_fn=lambda: __import__("datetime").datetime(2026,6,21))
    assert out == "voided" and b.status == "voided" and b.winner is None
    assert b.escrow_address is None
    assert signer.sent == []
