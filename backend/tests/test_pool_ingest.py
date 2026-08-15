"""El barrido del pool: paginar `getNfts`, resumir por rareza y guardarlo."""
import pytest

from app.models import GachaPoolTier
from app.services.pool_ingest import POR_PAGINA, desfase, guardar_pool, traer_pool, valor

ODDS = {"common": 0.75, "uncommon": 0.2, "rare": 0.04, "epic": 0.01}


class GachaFalso:
    """Doble de CC. `pools` es {rareza: [valores]}; se sirve paginado como hace ella."""

    def __init__(self, pools):
        self.pools = pools
        self.llamadas = []

    async def get_nfts(self, code, rarity=None, page=1, limit=20):
        self.llamadas.append((code, rarity, page, limit))
        todo = self.pools.get(rarity, [])
        trozo = todo[(page - 1) * limit: page * limit]
        return [{"insured_value": v} for v in trozo]


@pytest.mark.asyncio
async def test_resume_cada_rareza_del_pool():
    g = GachaFalso({"common": [10.0, 20.0], "uncommon": [40.0], "rare": [], "epic": [100.0]})
    r = await traer_pool(g, "comic_25", ODDS, pausa_s=0)
    assert r["common"]["n_cards"] == 2 and r["common"]["avg_value"] == 15.0
    assert r["common"]["probability"] == 0.75
    assert r["rare"]["n_cards"] == 0 and r["rare"]["avg_value"] is None


@pytest.mark.asyncio
async def test_pagina_hasta_agotar_la_rareza():
    """Con 250 cartas hay que pedir tres páginas; parando en la primera saldría una media sobre el
    tercio más reciente del pool, que no es la media del pool."""
    g = GachaFalso({"common": [float(i) for i in range(250)]})
    r = await traer_pool(g, "m", {"common": 0.75}, pausa_s=0)
    assert r["common"]["n_cards"] == 250
    paginas = [p for (_, rar, p, _) in g.llamadas if rar == "common"]
    assert paginas == [1, 2, 3]


@pytest.mark.asyncio
async def test_para_cuando_la_pagina_viene_incompleta():
    """"Vino menos de lo que cabía" es la señal de fin. Sin ella se pediría una página de más por
    rareza, que son 48 peticiones inútiles por barrido."""
    g = GachaFalso({"common": [1.0] * (POR_PAGINA - 1)})
    await traer_pool(g, "m", {"common": 0.75}, pausa_s=0)
    assert [p for (_, rar, p, _) in g.llamadas if rar == "common"] == [1]


@pytest.mark.asyncio
async def test_una_carta_sin_valor_no_cuenta_como_cero():
    """Contarla como 0 bajaría la media del tier e inventaría una máquina peor de lo que es."""
    g = GachaFalso({"common": []})
    g.pools["common"] = [10.0, 30.0]
    original = g.get_nfts

    async def con_una_rota(code, rarity=None, page=1, limit=20):
        filas = await original(code, rarity=rarity, page=page, limit=limit)
        return filas + ([{"insured_value": None}] if rarity == "common" and page == 1 else [])
    g.get_nfts = con_una_rota

    r = await traer_pool(g, "m", {"common": 0.75}, pausa_s=0)
    assert r["common"]["n_cards"] == 2 and r["common"]["avg_value"] == 20.0


class TestValor:
    def test_numero(self):
        assert valor(223) == 223.0

    def test_texto_de_dinero(self):
        # CC lo sirve de las dos formas según el sitio.
        assert valor("$5,000.00") == 5000.0

    def test_lo_que_no_es_un_valor(self):
        assert valor(None) is None and valor("") is None and valor("n/a") is None


class TestGuardar:
    def test_guarda_y_luego_pisa(self, Session):
        with Session() as s:
            guardar_pool(s, "m", {"common": {"n_cards": 2, "avg_value": 15.0, "min_value": 10.0,
                                             "max_value": 20.0, "probability": 0.75}})
            guardar_pool(s, "m", {"common": {"n_cards": 3, "avg_value": 30.0, "min_value": 10.0,
                                             "max_value": 60.0, "probability": 0.75}})
            fila = s.get(GachaPoolTier, ("m", "common"))
            assert (fila.n_cards, fila.avg_value) == (3, 30.0)

    def test_una_rareza_que_se_agota_se_pone_a_cero_y_no_se_deja_la_vieja(self, Session):
        """Si CC agota un tier, lo que había deja de ser cierto: conservarlo daría un EV de modelo
        calculado sobre cartas que ya no están."""
        with Session() as s:
            guardar_pool(s, "m", {"epic": {"n_cards": 5, "avg_value": 900.0, "min_value": 800.0,
                                           "max_value": 1000.0, "probability": 0.01}})
            guardar_pool(s, "m", {"epic": {"n_cards": 0, "avg_value": None, "min_value": None,
                                           "max_value": None, "probability": 0.01}})
            fila = s.get(GachaPoolTier, ("m", "epic"))
            assert fila.n_cards == 0 and fila.avg_value is None


class TestDesfase:
    def test_cuadrar_con_collector_crypt_da_cero(self):
        # Comprobado en mainnet: comic_25 da 26.998 por los dos lados.
        assert desfase(26.998, 26.998) == 0.0

    def test_lo_mide_en_relativo(self):
        assert desfase(27.0, 30.0) == -0.1

    def test_sin_alguno_de_los_dos_no_hay_desfase_que_medir(self):
        assert desfase(None, 26.9) is None and desfase(26.9, None) is None
        assert desfase(26.9, 0) is None
