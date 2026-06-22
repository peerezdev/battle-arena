"""Tests for royale_engine.run_royale — multi-round Battle Royale loop.

Fake design:
  _Gacha: `generate_pack` encodes the player wallet in memo as "m-{wallet}".
          `open_pack` looks up (wallet, pull_count) from self.values, where
          pull_count is the number of times that wallet has been pulled so far
          (1-indexed: first pull → 1, second → 2, etc.).
          This lets us drive round-by-round outcomes without any shared mutable
          state outside the fake.
"""
import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePlayer, BattlePull, BattleRound
from app.services.royale_engine import run_royale
from app.services.provably_fair import client_seed_round, pick_index


# ─────────────────────────── session fixture ───────────────────────────────

@pytest.fixture
def session():
    e = make_engine("sqlite:///:memory:")
    init_db(e)
    with make_session_factory(e)() as s:
        yield s


# ─────────────────────────── clean fake gacha ───────────────────────────────

class _Gacha:
    """
    values: dict[(wallet, round_n)] -> insured_value (int/float)
    generate_pack encodes wallet in memo "m-{wallet}".
    open_pack extracts wallet from memo, increments per-wallet pull counter,
    returns nft_address=f"nft-{wallet}-{n}" and the value from self.values.
    """
    def __init__(self, values: dict):
        self.values = values
        self.pull_counts: dict[str, int] = {}  # wallet -> how many times pulled

    async def generate_pack(self, player_address, pack_type, alt_player_address=None, turbo=False):
        return {"memo": f"m-{player_address}", "transaction": f"tx-{player_address}"}

    async def open_pack(self, memo):
        wallet = memo.split("m-", 1)[1]
        n = self.pull_counts.get(wallet, 0) + 1
        self.pull_counts[wallet] = n
        value = self.values.get((wallet, n), 0)
        return {
            "pending": False,
            "nft_address": f"nft-{wallet}-{n}",
            "insured_value": value,
            "grade": 9,
        }

    async def submit_tx(self, signed):
        return {"signature": "ccsig", "confirmation_status": "confirmed"}


class _Signer:
    def __init__(self):
        self.signed = []

    async def create_solana_wallet(self):
        return {"id": "esc-id", "address": "ESC"}

    async def sign_solana(self, wallet_id, tx):
        self.signed.append((wallet_id, tx))
        return f"sig-{tx}"


# ─────────────────────────── helper to build a battle ───────────────────────

def _mk(session, bid, players, server_seed="ab" * 32):
    session.add(PackBattle(
        id=bid, mode="royale", machine_code="pokemon_50",
        price=50_000_000, max_players=len(players),
        status="running", server_seed=server_seed,
    ))
    for w in players:
        session.add(BattlePlayer(battle_id=bid, player_wallet=w))
    session.commit()


async def _noop(d=None):
    pass


def _std_fakes():
    """Return a dict of standard async fakes (all succeed)."""
    dists = []
    built = []
    submits = []
    prepared = []

    async def distribute(esc, p, amt):
        dists.append((p, amt))

    async def confirm_usdc(p, m):
        return True

    async def confirm_in_escrow(esc, nft):
        return True

    async def build_transfer_tx(esc, dest, nft):
        built.append((dest, nft))
        return f"x-{nft}"

    async def submit_tx(s):
        submits.append(s)
        return "sig"

    async def prepare_escrow(addr):
        prepared.append(addr)

    return {
        "distribute": distribute,
        "confirm_usdc": confirm_usdc,
        "confirm_in_escrow": confirm_in_escrow,
        "build_transfer_tx": build_transfer_tx,
        "submit_tx": submit_tx,
        "prepare_escrow": prepare_escrow,
        "dists": dists,
        "built": built,
        "submits": submits,
        "prepared": prepared,
    }


# ════════════════════════════════════════════════════════════════════════════
# Test 1: 3-player deterministic winner
# Round 1: A=10, B=20, C=30  → A eliminated (lowest)
# Round 2: B+=5→25, C+=5→35  → B eliminated (lowest)
# Winner: C
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_royale_3player_deterministic_winner(session):
    values = {
        ("A", 1): 10,
        ("B", 1): 20, ("B", 2): 5,
        ("C", 1): 30, ("C", 2): 5,
    }
    _mk(session, "r1", ["A", "B", "C"])
    gacha = _Gacha(values)
    signer = _Signer()
    fakes = _std_fakes()

    out = await run_royale(
        session, session.get(PackBattle, "r1"),
        gacha=gacha, signer=signer,
        resolve_wallet_id=lambda w: f"{w}-id",
        distribute=fakes["distribute"],
        confirm_usdc=fakes["confirm_usdc"],
        confirm_in_escrow=fakes["confirm_in_escrow"],
        build_transfer_tx=fakes["build_transfer_tx"],
        submit_tx=fakes["submit_tx"],
        prepare_escrow=fakes["prepare_escrow"],
        price_base=50_000_000,
        now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
        sleep_fn=_noop,
    )

    assert out == "settled"
    battle = session.get(PackBattle, "r1")
    assert battle.winner == "C"
    assert battle.status == "settled"

    rounds = (
        session.query(BattleRound)
        .filter_by(battle_id="r1")
        .order_by(BattleRound.round_number)
        .all()
    )
    assert len(rounds) == 2
    assert rounds[0].eliminated_wallet == "A"
    assert rounds[1].eliminated_wallet == "B"


# ════════════════════════════════════════════════════════════════════════════
# Test 2: distribute is called before the pull for each player each round
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_royale_distribute_before_pull(session):
    """distribute(player) must appear in the call log BEFORE generate_pack(player)
    in every round."""
    values = {
        ("A", 1): 10,
        ("B", 1): 20, ("B", 2): 5,
        ("C", 1): 30, ("C", 2): 5,
    }
    _mk(session, "r2", ["A", "B", "C"])

    call_log = []

    class _LogGacha(_Gacha):
        async def generate_pack(self, player_address, pack_type, alt_player_address=None, turbo=False):
            call_log.append(("generate", player_address))
            return await super().generate_pack(player_address, pack_type, alt_player_address, turbo=turbo)

    async def distribute(esc, p, amt):
        call_log.append(("distribute", p))

    gacha = _LogGacha(values)
    signer = _Signer()
    fakes = _std_fakes()

    out = await run_royale(
        session, session.get(PackBattle, "r2"),
        gacha=gacha, signer=signer,
        resolve_wallet_id=lambda w: f"{w}-id",
        distribute=distribute,
        confirm_usdc=fakes["confirm_usdc"],
        confirm_in_escrow=fakes["confirm_in_escrow"],
        build_transfer_tx=fakes["build_transfer_tx"],
        submit_tx=fakes["submit_tx"],
        prepare_escrow=fakes["prepare_escrow"],
        price_base=50_000_000,
        now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
        sleep_fn=_noop,
    )

    assert out == "settled"
    # For every generate(player), the most recent distribute(player) must come before it
    for i, (kind, wallet) in enumerate(call_log):
        if kind == "generate":
            # Find the last distribute for this wallet before position i
            preceding_dists = [
                j for j, (k2, w2) in enumerate(call_log[:i])
                if k2 == "distribute" and w2 == wallet
            ]
            assert preceding_dists, (
                f"No distribute({wallet!r}) found before generate({wallet!r}) at position {i}. "
                f"call_log={call_log}"
            )


# ════════════════════════════════════════════════════════════════════════════
# Test 3: forced tie → PF tie-break
# Two players tie → BattleRound.tie_break_index is set and the eliminated
# wallet equals sorted(tied)[pick_index(server_seed, client_seed_round(...))]
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_royale_forced_tie_uses_provably_fair(session):
    server_seed = "ab" * 32
    # Round 1: A=10, B=10 — they tie! PF decides which is eliminated.
    values = {
        ("A", 1): 10,
        ("B", 1): 10,
    }
    _mk(session, "r3", ["A", "B"], server_seed=server_seed)
    gacha = _Gacha(values)
    signer = _Signer()
    fakes = _std_fakes()

    out = await run_royale(
        session, session.get(PackBattle, "r3"),
        gacha=gacha, signer=signer,
        resolve_wallet_id=lambda w: f"{w}-id",
        distribute=fakes["distribute"],
        confirm_usdc=fakes["confirm_usdc"],
        confirm_in_escrow=fakes["confirm_in_escrow"],
        build_transfer_tx=fakes["build_transfer_tx"],
        submit_tx=fakes["submit_tx"],
        prepare_escrow=fakes["prepare_escrow"],
        price_base=50_000_000,
        now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
        sleep_fn=_noop,
    )

    assert out == "settled"
    rounds = session.query(BattleRound).filter_by(battle_id="r3").all()
    assert len(rounds) == 1
    r = rounds[0]
    assert r.tie_break_index is not None

    # The round's NFTs (alphabetically sorted wallets = A, B)
    # nft-A-1 and nft-B-1 were pulled in round 1
    round_nfts = ["nft-A-1", "nft-B-1"]
    cs = client_seed_round(1, round_nfts)
    expected_idx = pick_index(server_seed, cs, 2)
    tied = sorted(["A", "B"])
    expected_elim = tied[expected_idx]

    assert r.eliminated_wallet == expected_elim
    assert r.tie_break_index == expected_idx


# ════════════════════════════════════════════════════════════════════════════
# Test 4: void — confirm_usdc returns False → engine raises → returns "voided"
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_royale_voids_when_confirm_usdc_fails(session):
    values = {("A", 1): 10, ("B", 1): 20}
    _mk(session, "r4", ["A", "B"])
    gacha = _Gacha(values)
    signer = _Signer()
    fakes = _std_fakes()

    async def confirm_usdc_fail(p, m):
        return False  # always False → timeout → raise

    out = await run_royale(
        session, session.get(PackBattle, "r4"),
        gacha=gacha, signer=signer,
        resolve_wallet_id=lambda w: f"{w}-id",
        distribute=fakes["distribute"],
        confirm_usdc=confirm_usdc_fail,
        confirm_in_escrow=fakes["confirm_in_escrow"],
        build_transfer_tx=fakes["build_transfer_tx"],
        submit_tx=fakes["submit_tx"],
        prepare_escrow=fakes["prepare_escrow"],
        price_base=50_000_000,
        now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
        sleep_fn=_noop,
        max_attempts=2,   # keep it fast
    )

    assert out == "voided"
    battle = session.get(PackBattle, "r4")
    assert battle.status == "voided"


@pytest.mark.asyncio
async def test_royale_voids_when_prepare_escrow_raises(session):
    """prepare_escrow raising → _void → "voided"."""
    values = {("A", 1): 10, ("B", 1): 20}
    _mk(session, "r5", ["A", "B"])
    gacha = _Gacha(values)
    signer = _Signer()
    fakes = _std_fakes()

    async def bad_prepare(addr):
        raise RuntimeError("escrow seed failed")

    out = await run_royale(
        session, session.get(PackBattle, "r5"),
        gacha=gacha, signer=signer,
        resolve_wallet_id=lambda w: f"{w}-id",
        distribute=fakes["distribute"],
        confirm_usdc=fakes["confirm_usdc"],
        confirm_in_escrow=fakes["confirm_in_escrow"],
        build_transfer_tx=fakes["build_transfer_tx"],
        submit_tx=fakes["submit_tx"],
        prepare_escrow=bad_prepare,
        price_base=50_000_000,
        now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
        sleep_fn=_noop,
    )

    assert out == "voided"
    battle = session.get(PackBattle, "r5")
    assert battle.status == "voided"


# ════════════════════════════════════════════════════════════════════════════
# Test 6: pre-created escrow is REUSED — create_solana_wallet must NOT be called
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_royale_reuses_pre_created_escrow(session):
    """If escrow_wallet_id and escrow_address are already set on the battle,
    run_royale must NOT call signer.create_solana_wallet() and must keep
    the original escrow fields unchanged."""
    values = {
        ("A", 1): 10,
        ("B", 1): 20,
    }
    _mk(session, "r6", ["A", "B"])

    # Set pre-created escrow fields on the battle
    battle = session.get(PackBattle, "r6")
    battle.escrow_wallet_id = "pre-esc-id"
    battle.escrow_address = "PRE_ESC"
    session.commit()

    class _NoCreateSigner:
        """Signer that raises if create_solana_wallet is ever called."""
        async def create_solana_wallet(self):
            raise AssertionError("should not be called")

        async def sign_solana(self, wallet_id, tx):
            return f"sig-{tx}"

    gacha = _Gacha(values)
    signer = _NoCreateSigner()
    fakes = _std_fakes()

    out = await run_royale(
        session, session.get(PackBattle, "r6"),
        gacha=gacha, signer=signer,
        resolve_wallet_id=lambda w: f"{w}-id",
        distribute=fakes["distribute"],
        confirm_usdc=fakes["confirm_usdc"],
        confirm_in_escrow=fakes["confirm_in_escrow"],
        build_transfer_tx=fakes["build_transfer_tx"],
        submit_tx=fakes["submit_tx"],
        prepare_escrow=fakes["prepare_escrow"],
        price_base=50_000_000,
        now_fn=lambda: __import__("datetime").datetime(2026, 6, 21),
        sleep_fn=_noop,
    )

    assert out == "settled"
    battle = session.get(PackBattle, "r6")
    assert battle.escrow_wallet_id == "pre-esc-id", "escrow_wallet_id was overwritten"
    assert battle.escrow_address == "PRE_ESC", "escrow_address was overwritten"


# ════════════════════════════════════════════════════════════════════════════
# Fakes for Task 7 test
# ════════════════════════════════════════════════════════════════════════════

class _RoyaleGacha:
    """Fake gacha for turbo+rarity test: generate_pack records turbo kwarg."""
    def __init__(self, opens: dict):
        self.opens = opens
        self.turbo = None

    async def generate_pack(self, player_address, pack_type, alt_player_address=None, turbo=False):
        self.turbo = turbo
        return {"memo": f"m-{player_address}", "transaction": f"tx-{player_address}"}

    async def open_pack(self, memo):
        wallet = memo.split("m-", 1)[1]
        return {"pending": False, **self.opens[wallet]}

    async def submit_tx(self, signed):
        return {"signature": "ccsig"}


class _RoyaleSigner:
    async def create_solana_wallet(self):
        return {"id": "esc-id", "address": "ESC"}

    async def sign_solana(self, wallet_id, tx):
        return f"sig-{tx}"


async def _ok():
    return "ccsig"


# ════════════════════════════════════════════════════════════════════════════
# Test 7: turbo pulls + rarity/auto_sold persisted + resilient settle
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.asyncio
async def test_run_royale_turbo_persists_rarity_and_resilient_settle(session):
    # Minimal 2-player royale: round 1, A pulls common (auto-sold), B pulls epic → A eliminated, B wins.
    b = PackBattle(id="r1", mode="royale", machine_code="pokemon_50", price=50, max_players=2,
                   status="running", server_seed="ab" * 32,
                   escrow_wallet_id="eid", escrow_address="ESC")
    session.add(b)
    session.add_all([BattlePlayer(battle_id="r1", player_wallet="A"),
                     BattlePlayer(battle_id="r1", player_wallet="B")])
    session.commit()

    opens = {
        "A": {"nft_address": "nftA", "insured_value": 50, "grade": None, "rarity": "Common", "auto_sold": True, "buyback_amount": 42_500_000},
        "B": {"nft_address": "nftB", "insured_value": 500, "grade": 9, "rarity": "Epic", "auto_sold": False},
    }
    gacha = _RoyaleGacha(opens)          # existing fake in this test module
    signer = _RoyaleSigner()
    transfers, sweeps = [], []
    async def btx(esc, dest, nft): transfers.append((dest, nft)); return f"tx-{nft}"
    async def sweep(esc, winner): sweeps.append(winner); return "sweep-tx"
    async def distribute(esc, w, amt): return "dsig"
    async def confirm_usdc(w, amt): return True
    async def ce(esc, nft): return True
    async def prep(esc): return "ok"
    async def noslp(_): return None

    out = await run_royale(session, b, gacha=gacha, signer=signer,
        resolve_wallet_id=lambda w: f"id-{w}", distribute=distribute, confirm_usdc=confirm_usdc,
        confirm_in_escrow=ce, build_transfer_tx=btx, submit_tx=lambda s: _ok(), prepare_escrow=prep,
        price_base=50, now_fn=lambda: __import__("datetime").datetime.now(),
        sleep_fn=noslp, build_usdc_sweep_tx=sweep)

    assert out == "settled" and b.winner == "B"
    assert gacha.turbo is True
    assert transfers == [("B", "nftB")]      # only the kept epic
    assert sweeps == ["B"]
    a_pull = session.query(BattlePull).filter_by(battle_id="r1", player_wallet="A").first()
    assert a_pull.rarity == "Common" and a_pull.auto_sold is True
    assert a_pull.buyback_amount == 42_500_000
