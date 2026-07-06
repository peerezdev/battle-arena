"""resume_royale: retomar una royale huérfana en 'running' tras un restart del backend."""
import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import PackBattle, BattlePlayer, BattlePull, BattleRound
from app.services.royale_engine import resume_royale


@pytest.fixture
def session():
    e = make_engine("sqlite:///:memory:")
    init_db(e)
    with make_session_factory(e)() as s:
        yield s


class _Gacha:
    """values: (wallet, n) -> insured_value, n = nº de pull POST-RESUME de esa wallet (1-indexed).
    opens_by_memo: memo -> resultado para open_pack de memos pre-sembrados (reconciliación)."""
    def __init__(self, values, opens_by_memo=None):
        self.values = values
        self.opens_by_memo = opens_by_memo or {}
        self.pull_counts = {}
        self.generated = []

    async def generate_pack(self, player_address, pack_type, alt_player_address=None, turbo=False):
        self.generated.append(player_address)
        return {"memo": f"m-{player_address}", "transaction": f"tx-{player_address}"}

    async def open_pack(self, memo):
        if memo in self.opens_by_memo:
            return self.opens_by_memo[memo]
        wallet = memo.split("m-", 1)[1]
        n = self.pull_counts.get(wallet, 0) + 1
        self.pull_counts[wallet] = n
        return {"pending": False, "nft_address": f"nft-{wallet}-{n}",
                "insured_value": self.values.get((wallet, n), 0), "grade": 9}

    async def submit_tx(self, signed):
        return {"signature": "ccsig"}


class _Signer:
    async def sign_solana(self, wallet_id, tx):
        return f"sig-{tx}"


async def _noslp(_):
    return None


def _mk(session, bid, players, server_seed="ab" * 32):
    session.add(PackBattle(id=bid, mode="royale", machine_code="pokemon_50", price=50_000_000,
                           max_players=len(players), status="running", server_seed=server_seed,
                           escrow_wallet_id="eid", escrow_address="ESC"))
    for w in players:
        session.add(BattlePlayer(battle_id=bid, player_wallet=w))
    session.commit()
    return session.get(PackBattle, bid)


def _fund_fakes(prefunded=()):
    """distribute/confirm_usdc con balances simulados: confirm devuelve True si la wallet
    fue fondeada (distribute) o venía pre-fondeada (el distribute pre-crash aterrizó)."""
    balances = {w: True for w in prefunded}
    dists = []

    async def distribute(esc, w, amt):
        balances[w] = True
        dists.append(w)

    async def confirm_usdc(w, amt):
        return balances.get(w, False)

    return distribute, confirm_usdc, dists


def _std(session, bid, gacha, distribute, confirm_usdc, **over):
    kw = dict(gacha=gacha, signer=_Signer(), resolve_wallet_id=lambda w: f"{w}-id",
              distribute=distribute, confirm_usdc=confirm_usdc,
              confirm_in_escrow=_ce, build_transfer_tx=_btx, submit_tx=_sub,
              price_base=50_000_000, now_fn=lambda: __import__("datetime").datetime(2026, 7, 6),
              sleep_fn=_noslp, max_attempts=2, reconcile_max_attempts=1)
    kw.update(over)
    return resume_royale(session, session.get(PackBattle, bid), **kw)


async def _ce(esc, nft): return True
async def _btx(esc, dest, nft): return f"x-{nft}"
async def _sub(s): return "sig"


# Estado pre-sembrado común: 3 jugadores A/B/C, ronda 1 COMPLETA (A eliminado con 10;
# B=20, C=30) y BattleRound persistida.
def _seed_round1_complete(session, bid="rr1"):
    b = _mk(session, bid, ["A", "B", "C"])
    session.add_all([
        BattlePull(battle_id=bid, player_wallet="A", memo="pm-A", nft_address="nft-A-pre",
                   insured_value=10, round_number=1),
        BattlePull(battle_id=bid, player_wallet="B", memo="pm-B", nft_address="nft-B-pre",
                   insured_value=20, round_number=1),
        BattlePull(battle_id=bid, player_wallet="C", memo="pm-C", nft_address="nft-C-pre",
                   insured_value=30, round_number=1),
        BattleRound(battle_id=bid, round_number=1, client_seed="", eliminated_wallet="A"),
    ])
    ba = session.query(BattlePlayer).filter_by(battle_id=bid, player_wallet="A").first()
    ba.eliminated_round = 1
    session.commit()
    return b


@pytest.mark.asyncio
async def test_resume_entre_rondas_continua_y_settlea(session):
    """Restart tras completar la ronda 1 → resume juega la ronda 2 y gana C."""
    _seed_round1_complete(session)
    # Post-resume: B tira 1 vez (5 → 25), C tira 1 vez (6 → 36) → B eliminado, C gana.
    gacha = _Gacha({("B", 1): 5, ("C", 1): 6})
    distribute, confirm_usdc, dists = _fund_fakes()
    out = await _std(session, "rr1", gacha, distribute, confirm_usdc)
    assert out == "settled"
    b = session.get(PackBattle, "rr1")
    assert b.winner == "C" and b.status == "settled"
    rounds = session.query(BattleRound).filter_by(battle_id="rr1").order_by(BattleRound.round_number).all()
    assert [r.eliminated_wallet for r in rounds] == ["A", "B"]
    assert "A" not in gacha.generated            # el eliminado no vuelve a tirar
    assert session.query(BattlePull).filter_by(battle_id="rr1").count() == 5  # 3 pre + 2 nuevas


@pytest.mark.asyncio
async def test_resume_a_mitad_de_ronda_no_repite_pulls(session):
    """Crash a mitad de la ronda 1: A ya tiró (resuelta), B y C no. Nadie re-tira."""
    b = _mk(session, "rr2", ["A", "B", "C"])
    session.add(BattlePull(battle_id="rr2", player_wallet="A", memo="pm-A",
                           nft_address="nft-A-pre", insured_value=10, round_number=1))
    session.commit()
    # B y C tiran en el resume: B=20, C=30 → A (10) eliminado en ronda 1.
    # Ronda 2: B tira de nuevo (5 → 25), C (6 → 36) → B fuera, C gana.
    gacha = _Gacha({("B", 1): 20, ("C", 1): 30, ("B", 2): 5, ("C", 2): 6})
    distribute, confirm_usdc, dists = _fund_fakes()
    out = await _std(session, "rr2", gacha, distribute, confirm_usdc)
    assert out == "settled"
    assert session.get(PackBattle, "rr2").winner == "C"
    # A no re-tiró en la ronda 1 (su pull pre-sembrada cuenta):
    assert gacha.generated.count("A") == 0
    assert session.query(BattlePull).filter_by(battle_id="rr2", player_wallet="A").count() == 1


@pytest.mark.asyncio
async def test_resume_guard_anti_doble_fondeo(session):
    """En la ronda interrumpida, un jugador ya fondeado (distribute pre-crash aterrizó)
    no recibe un segundo distribute; el resto sí se fondea."""
    _mk(session, "rr3", ["A", "B"])
    gacha = _Gacha({("A", 1): 10, ("B", 1): 20})
    distribute, confirm_usdc, dists = _fund_fakes(prefunded=("A",))
    out = await _std(session, "rr3", gacha, distribute, confirm_usdc)
    assert out == "settled"
    assert "A" not in dists and "B" in dists


@pytest.mark.asyncio
async def test_resume_reconcilia_pull_sin_resolver_y_continua(session):
    """La pull interrumpida de A resuelve al re-poll → se completa y la partida sigue."""
    b = _mk(session, "rr4", ["A", "B"])
    session.add(BattlePull(battle_id="rr4", player_wallet="A", memo="pm-A", round_number=1))
    session.commit()
    gacha = _Gacha({("B", 1): 20},
                   opens_by_memo={"pm-A": {"pending": False, "nft_address": "nft-A-late",
                                           "insured_value": 10, "grade": 9}})
    distribute, confirm_usdc, dists = _fund_fakes()
    out = await _std(session, "rr4", gacha, distribute, confirm_usdc)
    assert out == "settled"
    assert session.get(PackBattle, "rr4").winner == "B"   # A=10 < B=20
    pa = session.query(BattlePull).filter_by(battle_id="rr4", player_wallet="A").first()
    assert pa.nft_address == "nft-A-late" and pa.insured_value == 10
    assert gacha.generated.count("A") == 0                # reconciliada, no re-tirada


@pytest.mark.asyncio
async def test_resume_pull_irrecuperable_hace_void(session):
    """La pull interrumpida nunca resuelve → void (el wiring refundea después)."""
    b = _mk(session, "rr5", ["A", "B"])
    session.add(BattlePull(battle_id="rr5", player_wallet="A", memo="pm-A", round_number=1))
    session.commit()
    gacha = _Gacha({}, opens_by_memo={"pm-A": {"pending": True}})
    distribute, confirm_usdc, dists = _fund_fakes()
    out = await _std(session, "rr5", gacha, distribute, confirm_usdc)
    assert out == "voided"
    assert session.get(PackBattle, "rr5").status == "voided"


@pytest.mark.asyncio
async def test_resume_sin_escrow_hace_void(session):
    b = _mk(session, "rr6", ["A", "B"])
    b.escrow_wallet_id = None
    b.escrow_address = None
    session.commit()
    gacha = _Gacha({})
    distribute, confirm_usdc, dists = _fund_fakes()
    out = await _std(session, "rr6", gacha, distribute, confirm_usdc)
    assert out == "voided"


@pytest.mark.asyncio
async def test_resume_escrow_drenado_hace_void(session):
    """confirm_usdc nunca llega a True para un jugador sin fondear → void limpio."""
    _mk(session, "rr7", ["A", "B"])
    gacha = _Gacha({})
    async def distribute(esc, w, amt): pass          # el pool no tiene fondos: nunca llega
    async def confirm_usdc(w, amt): return False
    out = await _std(session, "rr7", gacha, distribute, confirm_usdc)
    assert out == "voided"
