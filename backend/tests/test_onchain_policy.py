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


def test_pocas_llamadas_pero_sin_perder_paciencia():
    """Los dos números son independientes y confundirlos sale caro.

    Se midió que cartas dadas por "no confirmadas en el escrow" SÍ estaban ahí al mirarlas
    después: llegaban más tarde que la ventana. Así que la ventana no se recorta — se preguntan
    menos veces, más espaciado.
    """
    assert CONFIRM_POLLS <= 8, "cada sondeo es una llamada al RPC que se paga"
    ventana = CONFIRM_POLLS * CONFIRM_DELAY
    assert ventana >= 50, f"solo {ventana:.0f}s de paciencia: dejaría cartas atrapadas en el escrow"


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
    """Lo importante del cambio: el camino bueno cuesta lo mismo con 7 que con 20.

    Son DOS sondeos, no uno: "¿ha llegado la carta al escrow?" antes de mover, y "¿se ha ido?"
    después de enviar. El segundo es el precio de no mentir — sin él, una transacción aceptada por
    el RPC que nunca aterriza marcaba la carta como entregada (mainnet, 11/08). Una llamada por
    carta a cambio de que `transferred` signifique algo.
    """
    sondeos = 0
    dentro = True

    async def confirm_in_escrow(esc, mint):
        nonlocal sondeos
        sondeos += 1
        return dentro                     # dentro hasta que el traspaso se ejecuta

    async def build_transfer_tx(*a): return "tx"

    async def submit_tx(_):
        nonlocal dentro
        dentro = False                    # el traspaso surte efecto de verdad

    pull = _Pull(0)
    await settle_cards_to_winner(
        _Session([pull]), _Battle(), escrow_wallet_id="e", escrow_address="E", winner="W",
        build_transfer_tx=build_transfer_tx, submit_tx=submit_tx, signer=_Signer(),
        confirm_in_escrow=confirm_in_escrow, build_usdc_sweep_tx=None,
        sleep_fn=lambda _: asyncio.sleep(0),
        wait_max_attempts=CONFIRM_POLLS, wait_delay=CONFIRM_DELAY,
    )

    assert sondeos == 2
    assert pull.transferred is True


def test_el_sondeo_de_collector_crypt_sigue_siendo_largo():
    """open_pack pregunta a CC, que resuelve por webhook: recortarlo haría fallar tiradas buenas
    y además no cuesta créditos de RPC."""
    import inspect
    from app.services.pack_engine import run_battle
    assert inspect.signature(run_battle).parameters["open_max_attempts"].default == 20
