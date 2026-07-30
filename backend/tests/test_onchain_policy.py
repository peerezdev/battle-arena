"""El techo de sondeos es una decisión de COSTE, no un detalle: cada sondeo es una llamada al
RPC que se paga. Estos tests lo fijan y dejan por escrito el porqué."""
import asyncio
import pytest

from app.services.onchain_policy import CONFIRM_POLLS, CONFIRM_DELAY
from app.services.pack_engine import settle_cards_to_winner


class _Session:
    def __init__(self, pulls): self._p = pulls
    def query(self, _): return self
    def filter_by(self, **k): return self
    def all(self): return self._p
    def commit(self): pass


class _Pull:
    def __init__(self, n):
        self.nft_address, self.auto_sold, self.transferred = f"nft{n}", False, False


class _Battle:
    id = "b-policy"


class _Signer:
    async def sign_solana(self, *a): return "signed"


def test_el_techo_no_sube_sin_querer():
    # 7 × 3 s = 21 s. Solana confirma en 1-2 s; subirlo multiplica el gasto de un fallo sin
    # mejorar el camino bueno, que sale del bucle en cuanto confirma.
    assert CONFIRM_POLLS == 7
    assert CONFIRM_DELAY == 3.0
    assert CONFIRM_POLLS * CONFIRM_DELAY <= 25, "más de 25s esperando algo que ya no va a confirmar"


@pytest.mark.asyncio
async def test_una_carta_que_no_confirma_gasta_como_mucho_el_techo_por_intento():
    """El peor caso está acotado: 3 intentos × CONFIRM_POLLS sondeos, y ni uno más."""
    sondeos = 0

    async def confirm_in_escrow(esc, mint):
        nonlocal sondeos
        sondeos += 1
        return False                      # nunca confirma

    async def build_transfer_tx(*a): return "tx"
    async def submit_tx(_): pass

    await settle_cards_to_winner(
        _Session([_Pull(0)]), _Battle(), escrow_wallet_id="e", escrow_address="E", winner="W",
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=_Signer(),
        confirm_in_escrow=confirm_in_escrow, build_usdc_sweep_tx=None,
        sleep_fn=lambda _: asyncio.sleep(0),
        wait_max_attempts=CONFIRM_POLLS, wait_delay=CONFIRM_DELAY,
    )

    assert sondeos == 3 * CONFIRM_POLLS == 21


@pytest.mark.asyncio
async def test_si_confirma_a_la_primera_no_se_gastan_sondeos_de_mas():
    """Lo importante del cambio: el camino bueno cuesta lo mismo con 7 que con 20."""
    sondeos = 0

    async def confirm_in_escrow(esc, mint):
        nonlocal sondeos
        sondeos += 1
        return True                       # confirma ya

    async def build_transfer_tx(*a): return "tx"
    async def submit_tx(_): pass

    pull = _Pull(0)
    await settle_cards_to_winner(
        _Session([pull]), _Battle(), escrow_wallet_id="e", escrow_address="E", winner="W",
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=_Signer(),
        confirm_in_escrow=confirm_in_escrow, build_usdc_sweep_tx=None,
        sleep_fn=lambda _: asyncio.sleep(0),
        wait_max_attempts=CONFIRM_POLLS, wait_delay=CONFIRM_DELAY,
    )

    assert sondeos == 1
    assert pull.transferred is True


def test_el_sondeo_de_collector_crypt_sigue_siendo_largo():
    """open_pack pregunta a CC, que resuelve por webhook: recortarlo haría fallar tiradas buenas
    y además no cuesta créditos de RPC."""
    import inspect
    from app.services.pack_engine import run_battle
    assert inspect.signature(run_battle).parameters["open_max_attempts"].default == 20
