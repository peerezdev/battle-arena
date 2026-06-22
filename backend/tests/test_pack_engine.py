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


def test_determine_winner_single_max_no_draw():
    from app.services.pack_engine import determine_winner
    pulls = [_po("A", 100, 9), _po("B", 300, 8)]
    w, idx = determine_winner(pulls, server_seed="ab"*32, client_seed="00"*32)
    assert w == "B" and idx is None


def test_determine_winner_tie_uses_provably_fair_draw():
    from app.services.pack_engine import determine_winner
    from app.services.provably_fair import pick_index
    pulls = [_po("A", 100, 9), _po("B", 100, 8), _po("C", 100, 7)]
    cands = sorted(["A", "B", "C"])
    expect_idx = pick_index("ab"*32, "00"*32, 3)
    w, idx = determine_winner(pulls, server_seed="ab"*32, client_seed="00"*32)
    assert idx == expect_idx and w == cands[expect_idx]


class _Gacha:
    def __init__(self, opens):  # opens: wallet -> open result dict
        self.opens = opens; self.alt = None; self.turbo = None; self.pulled = []
    async def generate_pack(self, player_address, pack_type, alt_player_address=None, turbo=False):
        self.alt = alt_player_address; self.turbo = turbo; self.pulled.append(player_address)
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


# Module-level async fakes reused by multiple tests
async def _btx(esc, dest, mint): return f"xfer-{mint}->{dest}"
async def _sub(signed): return "ccsig"
async def _ce(esc, nft): return True
async def _noop(): return "ok"
async def _noslp(_): return None


@pytest.mark.asyncio
async def test_run_battle_settles_to_winner(session):
    b = PackBattle(id="b1", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="running", server_seed="ab"*32)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b1", player_wallet="A"),
                     BattlePlayer(battle_id="b1", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9},
                    "B": {"nft_address": "nB", "insured_value": 300, "grade": 8}})
    signer = _Signer()
    built, submits = [], []
    async def build_transfer_tx(esc, dest, mint):
        built.append((esc, dest, mint)); return f"xfer-{mint}->{dest}"
    async def submit_tx(signed):
        submits.append(signed); return "ccsig"
    async def confirm_in_escrow(esc, nft): return True
    seeded = []
    async def prepare_escrow(addr): seeded.append(addr)
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           confirm_in_escrow=confirm_in_escrow,
                           prepare_escrow=prepare_escrow,
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026, 6, 21))
    assert out == "settled"
    assert b.winner == "B" and b.status == "settled" and b.escrow_address == "ESC"
    assert gacha.alt == "ESC"                       # pulls delivered to escrow
    # Transfers now go via async build_transfer_tx + sign_solana + submit_tx (not sign_and_send_solana)
    assert ("ESC", "B", "nA") in built and ("ESC", "B", "nB") in built
    assert "signed-xfer-nA->B" in submits and "signed-xfer-nB->B" in submits
    assert session.query(BattlePull).filter_by(battle_id="b1").count() == 2
    pull_wallets = {s[0] for s in signer.signed}
    assert "A-id" in pull_wallets and "B-id" in pull_wallets
    rows = {r.player_wallet: r for r in session.query(BattlePull).filter_by(battle_id="b1").all()}
    assert rows["A"].nft_address == "nA" and rows["A"].insured_value == 100 and rows["A"].grade == 9
    assert rows["B"].nft_address == "nB" and rows["B"].insured_value == 300
    assert seeded == ["ESC"]  # prepare_escrow was called with the escrow address


@pytest.mark.asyncio
async def test_run_battle_settles_with_async_transfer(session):
    b = PackBattle(id="b8", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="running", server_seed="ab"*32)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b8", player_wallet="A"),
                     BattlePlayer(battle_id="b8", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9},
                    "B": {"nft_address": "nB", "insured_value": 300, "grade": 8}})
    signer = _Signer()
    built, submits = [], []
    async def build_transfer_tx(esc, dest, mint):
        built.append((esc, dest, mint)); return f"xfer-{mint}->{dest}"
    async def submit_tx(signed):
        submits.append(signed); return "ccsig"
    async def confirm_in_escrow(esc, nft): return True
    seeded = []
    async def prepare_escrow(addr): seeded.append(addr)
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           confirm_in_escrow=confirm_in_escrow,
                           prepare_escrow=prepare_escrow,
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026, 6, 21))
    assert out == "settled" and b.winner == "B"
    assert ("ESC", "B", "nA") in built and ("ESC", "B", "nB") in built   # both → winner from escrow addr
    assert {s for s in submits} == {"signed-xfer-nA->B", "signed-xfer-nB->B"}  # sign_solana then submit
    assert seeded == ["ESC"]


@pytest.mark.asyncio
async def test_run_battle_settles_despite_unsupported_standard(session):
    """Resilient settle: UnsupportedNftStandard flags the pull but does NOT void the battle."""
    from app.services.nft_transfer import UnsupportedNftStandard
    b = PackBattle(id="b9", mode="pack", machine_code="pokemon_50", price=50, max_players=1, status="running", server_seed="ab"*32)
    session.add(b); session.add(BattlePlayer(battle_id="b9", player_wallet="A")); session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}})
    signer = _Signer()
    async def build_transfer_tx(esc, dest, mint): raise UnsupportedNftStandard("cnft")
    async def submit_tx(signed): return "x"
    async def confirm_in_escrow(esc, nft): return True
    seeded = []
    async def prepare_escrow(addr): seeded.append(addr)
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           confirm_in_escrow=confirm_in_escrow,
                           prepare_escrow=prepare_escrow,
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026, 6, 21))
    assert out == "settled" and b.winner == "A"
    pull = session.query(BattlePull).filter_by(battle_id="b9", player_wallet="A").first()
    assert pull.transferred is False  # flagged but not voided


@pytest.mark.asyncio
async def test_run_battle_sponsor_flag_propagates(session):
    """sponsor param is kept in signature for API stability but no longer drives transfer logic."""
    b = PackBattle(id="b3", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="running", server_seed="ab"*32)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b3", player_wallet="A"),
                     BattlePlayer(battle_id="b3", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9},
                    "B": {"nft_address": "nB", "insured_value": 300, "grade": 8}})
    signer = _Signer()
    built, submits = [], []
    async def build_transfer_tx(esc, dest, mint):
        built.append((esc, dest, mint)); return f"xfer-{mint}->{dest}"
    async def submit_tx(signed):
        submits.append(signed); return "ccsig"
    async def confirm_in_escrow(esc, nft): return True
    seeded = []
    async def prepare_escrow(addr): seeded.append(addr)
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           confirm_in_escrow=confirm_in_escrow,
                           prepare_escrow=prepare_escrow,
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
                           sponsor=True)
    assert out == "settled"
    # Transfers go via submit_tx (not sign_and_send_solana), so signer.sent is empty.
    assert signer.sent == []
    assert len(submits) == 2  # both NFTs transferred via submit_tx


@pytest.mark.asyncio
async def test_run_battle_voids_when_player_cannot_play(session):
    b = PackBattle(id="b2", mode="pack", machine_code="pokemon_50", price=50, max_players=2, status="running", server_seed="ab"*32)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="b2", player_wallet="A"),
                     BattlePlayer(battle_id="b2", player_wallet="B")])
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}})
    signer = _Signer()
    async def build_transfer_tx(esc, dest, mint): return "x"
    async def submit_tx(signed): return "ccsig"
    async def confirm_in_escrow(esc, nft): return True
    seeded = []
    async def prepare_escrow(addr): seeded.append(addr)
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           confirm_in_escrow=confirm_in_escrow,
                           prepare_escrow=prepare_escrow,
                           can_play=lambda w: w != "B", now_fn=lambda: __import__("datetime").datetime(2026, 6, 21))
    assert out == "voided" and b.status == "voided" and b.winner is None
    assert b.escrow_address is None
    assert signer.sent == []
    assert seeded == []  # escrow never created when pre-flight fails


@pytest.mark.asyncio
async def test_run_battle_polls_open_pack_while_pending(session):
    b = PackBattle(id="b4", mode="pack", machine_code="pokemon_50", price=50, max_players=1, status="running", server_seed="ab"*32)
    session.add(b)
    session.add(BattlePlayer(battle_id="b4", player_wallet="A"))
    session.commit()

    class _PendingGacha(_Gacha):
        def __init__(self, opens, pending_times):
            super().__init__(opens); self._left = pending_times
        async def open_pack(self, memo):
            w = memo.split("m-")[1]
            if self._left > 0:
                self._left -= 1
                return {"pending": True}
            return {"pending": False, **self.opens[w]}

    gacha = _PendingGacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}}, pending_times=2)
    signer = _Signer()
    slept = []
    async def no_sleep(d): slept.append(d)
    built, submits = [], []
    async def build_transfer_tx(esc, dest, mint):
        built.append((esc, dest, mint)); return f"xfer-{mint}->{dest}"
    async def submit_tx(signed):
        submits.append(signed); return "ccsig"
    async def confirm_in_escrow(esc, nft): return True
    seeded = []
    async def prepare_escrow(addr): seeded.append(addr)
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           confirm_in_escrow=confirm_in_escrow,
                           prepare_escrow=prepare_escrow,
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
                           sleep_fn=no_sleep)
    assert out == "settled" and b.winner == "A"
    assert len(slept) == 2          # polled past the 2 pending responses


@pytest.mark.asyncio
async def test_run_battle_voids_if_open_pack_never_resolves(session):
    b = PackBattle(id="b5", mode="pack", machine_code="pokemon_50", price=50, max_players=1, status="running", server_seed="ab"*32)
    session.add(b)
    session.add(BattlePlayer(battle_id="b5", player_wallet="A"))
    session.commit()

    class _AlwaysPending(_Gacha):
        async def open_pack(self, memo):
            return {"pending": True}

    gacha = _AlwaysPending({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}})
    signer = _Signer()
    async def no_sleep(d): pass
    async def build_transfer_tx(esc, dest, mint): return "x"
    async def submit_tx(signed): return "ccsig"
    async def confirm_in_escrow(esc, nft): return True
    seeded = []
    async def prepare_escrow(addr): seeded.append(addr)
    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           confirm_in_escrow=confirm_in_escrow,
                           prepare_escrow=prepare_escrow,
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
                           open_max_attempts=3, sleep_fn=no_sleep)
    assert out == "voided"


@pytest.mark.asyncio
async def test_run_battle_waits_for_nft_in_escrow(session):
    """confirm_in_escrow returning False twice then True → settles after polling."""
    b = PackBattle(id="b6", mode="pack", machine_code="pokemon_50", price=50, max_players=1, status="running", server_seed="ab"*32)
    session.add(b)
    session.add(BattlePlayer(battle_id="b6", player_wallet="A"))
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}})
    signer = _Signer()
    built, submits = [], []
    async def build_transfer_tx(esc, dest, mint):
        built.append((esc, dest, mint)); return f"xfer-{mint}->{dest}"
    async def submit_tx(signed):
        submits.append(signed); return "ccsig"

    poll_count = {"n": 0}
    async def confirm_in_escrow(esc, nft):
        poll_count["n"] += 1
        return poll_count["n"] >= 3  # False, False, True

    slept = []
    async def no_sleep(d): slept.append(d)

    seeded = []
    async def prepare_escrow(addr): seeded.append(addr)

    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           confirm_in_escrow=confirm_in_escrow,
                           prepare_escrow=prepare_escrow,
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
                           sleep_fn=no_sleep)
    assert out == "settled"
    assert poll_count["n"] == 3       # polled 3 times (2 False + 1 True)
    assert len(slept) == 2            # slept between polls (2 failures before success)


@pytest.mark.asyncio
async def test_run_battle_settles_if_nft_never_in_escrow(session):
    """Resilient settle: NFT never confirmed in escrow logs warning and continues — does NOT void."""
    b = PackBattle(id="b7", mode="pack", machine_code="pokemon_50", price=50, max_players=1, status="running", server_seed="ab"*32)
    session.add(b)
    session.add(BattlePlayer(battle_id="b7", player_wallet="A"))
    session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}})
    signer = _Signer()
    async def build_transfer_tx(esc, dest, mint): return "x"
    async def submit_tx(signed): return "ccsig"
    async def confirm_in_escrow(esc, nft): return False
    async def no_sleep(d): pass
    seeded = []
    async def prepare_escrow(addr): seeded.append(addr)

    out = await run_battle(session, b, gacha=gacha, signer=signer,
                           resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=build_transfer_tx, submit_tx=submit_tx,
                           confirm_in_escrow=confirm_in_escrow,
                           prepare_escrow=prepare_escrow,
                           can_play=lambda w: True, now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
                           escrow_max_attempts=3, sleep_fn=no_sleep)
    assert out == "settled"
    assert b.status == "settled"
    assert b.winner == "A"
    pull = session.query(BattlePull).filter_by(battle_id="b7", player_wallet="A").first()
    assert pull.transferred is False  # retries exhausted but not voided


@pytest.mark.asyncio
async def test_run_battle_voids_if_escrow_seed_fails(session):
    b = PackBattle(id="bs", mode="pack", machine_code="pokemon_50", price=50, max_players=1,
                   status="running", server_seed="ab"*32)
    session.add(b); session.add(BattlePlayer(battle_id="bs", player_wallet="A")); session.commit()
    gacha = _Gacha({"A": {"nft_address": "nA", "insured_value": 100, "grade": 9}})
    signer = _Signer()
    async def prepare_escrow(addr): raise RuntimeError("seed failed")
    out = await run_battle(session, b, gacha=gacha, signer=signer, resolve_wallet_id=lambda w: f"{w}-id",
                           build_transfer_tx=_btx, submit_tx=_sub, confirm_in_escrow=_ce,
                           prepare_escrow=prepare_escrow, can_play=lambda w: True,
                           now_fn=lambda: __import__("datetime").datetime(2026, 6, 21))
    assert out == "voided"


@pytest.mark.asyncio
async def test_run_battle_turbo_autosold_common_not_transferred(session):
    # A pulls a common CC auto-sells (no NFT to transfer); B pulls an epic kept in escrow → B wins.
    b = PackBattle(id="bt", mode="pack", machine_code="pokemon_50", price=50, max_players=2,
                   status="lobby", server_seed="ab" * 32)
    session.add(b)
    session.add_all([BattlePlayer(battle_id="bt", player_wallet="A"),
                     BattlePlayer(battle_id="bt", player_wallet="B")])
    session.commit()

    gacha = _Gacha({
        "A": {"nft_address": "nftA", "insured_value": 50, "grade": None, "rarity": "Common", "auto_sold": True},
        "B": {"nft_address": "nftB", "insured_value": 500, "grade": 9, "rarity": "Epic", "auto_sold": False},
    })
    signer = _Signer()
    transfers, sweeps = [], []
    async def btx(esc, dest, nft): transfers.append((dest, nft)); return f"tx-{nft}"
    async def sweep(esc, winner): sweeps.append(winner); return "sweep-tx"

    out = await run_battle(session, b, gacha=gacha, signer=signer,
        resolve_wallet_id=lambda w: f"id-{w}", build_transfer_tx=btx, submit_tx=_sub,
        prepare_escrow=lambda a: _noop(), confirm_in_escrow=_ce, can_play=lambda w: True,
        now_fn=lambda: __import__("datetime").datetime.now(),
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp)

    assert out == "settled" and b.winner == "B"
    assert gacha.turbo is True                          # battles pull in turbo
    assert transfers == [("B", "nftB")]                 # only the kept epic transferred
    assert sweeps == ["B"]                              # USDC swept to winner
    a_pull = session.query(BattlePull).filter_by(battle_id="bt", player_wallet="A").first()
    assert a_pull.auto_sold is True and a_pull.transferred is False
