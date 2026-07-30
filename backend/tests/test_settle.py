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
    # Dos pasadas del bote a propósito: una al principio y otra tras el bucle de cartas, que
    # es la ventana en la que CC ingresa el USDC de las auto-ventas. Con una sola, todo lo que
    # llegase después se quedaba en el escrow para siempre.
    assert sweeps == [("ESC", "A"), ("ESC", "A")]
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
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0, max_attempts=3)
    assert calls["n"] == 3   # retried 3×
    assert session.query(BattlePull).filter_by(player_wallet="A").first().transferred is False


# ── quién paga el traspaso de la carta ────────────────────────────────────────
# Mover una carta obliga a crear la token account del ganador: 2.039.280 lamports de rent. Al
# escrow se le siembran 10M fijos, o sea que cubre exactamente 4 cartas y de la quinta en adelante
# fallaba con "insufficient lamports" dejándolas dentro sin avisar. Ahora paga el operador, y por
# eso tiene que firmar. Lo que estos tests protegen es que las dos decisiones no se separen: quien
# construye pone al operador como fee-payer y quien firma añade su firma. Una sin la otra produce
# una transacción que la red rechaza.

@pytest.mark.asyncio
async def test_el_operador_cofirma_el_traspaso_de_cada_carta(session):
    b = _battle_with_pulls(session, [("A", "nftA", False), ("B", "nftB", False)])
    async def btx(esc, dest, nft): return f"tx-{nft}"
    async def sub(signed): return "sig"
    async def sweep(esc, winner): return None
    signer = _Signer()
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC", winner="A",
        build_transfer_tx=btx, submit_tx=sub, signer=signer, confirm_in_escrow=_ce,
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0,
        operator_wallet_id="op-id")
    for nft in ("nftA", "nftB"):
        firmas = [wid for wid, tx in signer.signed if tx.endswith(f"tx-{nft}")]
        assert firmas == ["eid", "op-id"], f"{nft}: firma el dueño y luego el que paga"


@pytest.mark.asyncio
async def test_sin_operador_configurado_firma_solo_el_escrow(session):
    """En un entorno sin operador, build_transfer deja al escrow como fee-payer. Añadir aquí una
    firma del operador metería una firma de una cuenta que no es firmante: transacción inválida."""
    b = _battle_with_pulls(session, [("A", "nftA", False)])
    async def btx(esc, dest, nft): return f"tx-{nft}"
    async def sub(signed): return "sig"
    async def sweep(esc, winner): return None
    signer = _Signer()
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC", winner="A",
        build_transfer_tx=btx, submit_tx=sub, signer=signer, confirm_in_escrow=_ce,
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0)
    assert [wid for wid, _ in signer.signed] == ["eid"]


# ── el bote llega tarde ───────────────────────────────────────────────────────
# CC ingresa el USDC de las auto-ventas de forma asíncrona, así que al empezar el settle el escrow
# puede estar todavía a cero. El builder devuelve None en ese caso, y antes eso provocaba `return`:
# se abandonaba en el primer intento y el dinero se quedaba dentro para siempre. Medido en devnet:
# 24 escrows retenían USDC sin entregar, hasta $3.500 en uno.

@pytest.mark.asyncio
async def test_un_bote_que_aparece_tarde_se_acaba_barriendo(session):
    b = _battle_with_pulls(session, [("A", "nftA", True)])   # todo auto-vendido: solo hay bote
    intentos = {"n": 0}

    async def sweep(esc, winner):
        """Cero, cero, y al tercer intento aparece el bote. Después ya está vacío: el builder real
        lee el saldo cada vez, así que una vez barrido devuelve None."""
        intentos["n"] += 1
        return "sweep-tx" if intentos["n"] == 3 else None

    enviados = []
    async def sub(signed): enviados.append(signed); return "sig"
    signer = _Signer()
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC", winner="A",
        build_transfer_tx=None, submit_tx=sub, signer=signer, confirm_in_escrow=_ce,
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0, max_attempts=3)
    assert enviados == ["signed-sweep-tx"], "el bote tardío tiene que acabar enviándose"


@pytest.mark.asyncio
async def test_un_escrow_de_verdad_vacio_no_manda_nada(session):
    """El caso común (nada auto-vendido) no debe inventarse una transferencia de cero."""
    b = _battle_with_pulls(session, [("A", "nftA", True)])
    async def sweep(esc, winner): return None
    enviados = []
    async def sub(signed): enviados.append(signed); return "sig"
    await settle_cards_to_winner(session, b, escrow_wallet_id="eid", escrow_address="ESC", winner="A",
        build_transfer_tx=None, submit_tx=sub, signer=_Signer(), confirm_in_escrow=_ce,
        build_usdc_sweep_tx=sweep, sleep_fn=_noslp, wait_max_attempts=1, wait_delay=0, max_attempts=3)
    assert enviados == []
