"""El EV del modelo: lo que una máquina debería pagar según las cartas que tiene dentro."""
import pytest

from app.models import GachaPoolTier
from app.services.pool_model import modelo, resumen_por_rareza

# Las odds y el pool reales de `comic_25` en mainnet, medidos sobre sus 481 cartas. Collector Crypt
# publica para esa máquina un `ev` de 26.998, y la suma de gross de aquí da exactamente eso: es la
# comprobación de que este cálculo es el mismo que el suyo.
COMIC_25 = [
    ("common", 0.75, 12, 19.75), ("uncommon", 0.2, 27, 38.89),
    ("rare", 0.04, 231, 70.14), ("epic", 0.01, 211, 160.22),
]


def sembrar(s, machine="comic_25", filas=COMIC_25):
    for tier, p, n, avg in filas:
        s.add(GachaPoolTier(machine=machine, tier=tier, probability=p, n_cards=n, avg_value=avg))
    s.commit()


def test_reproduce_el_ev_que_publica_collector_crypt(Session):
    """La prueba de que el cálculo es el correcto: su `ev` de comic_25 es 26.998, y sale de sumar
    probabilidad × valor medio de cada rareza. Sin buyback, que es su número bruto."""
    with Session() as s:
        sembrar(s)
        r = modelo(s, "comic_25", precio=25.0)
        assert r["model_ev"] == pytest.approx(26.998, abs=0.01)


def test_sale_en_VALOR_DE_CARTA_y_no_con_la_recompra_puesta(Session):
    """La misma base en la que se mide lo realizado, para que las dos mitades sean comparables tal
    y como vienen. Aplicar la recompra es cosa del interruptor de la pantalla, que la aplica a las
    dos por igual: si el modelo llegara ya convertido, el interruptor tendría que hacer una cosa
    distinta con cada una y cualquier despiste parecería una diferencia entre modelo y realidad."""
    with Session() as s:
        sembrar(s)
        r = modelo(s, "comic_25", precio=25.0)
        assert r["model_ev"] == pytest.approx(26.998, abs=0.01)     # NO 22.95
        assert r["model_ratio"] == pytest.approx(1.08, abs=0.001)
        assert r["model_edge_pct"] == pytest.approx(8.0, abs=0.1)


def test_el_desglose_sale_por_rareza(Session):
    """El motivo de calcularlo nosotros en vez de copiar su `ev`: dos máquinas con el mismo EV no
    son la misma máquina si una lo tiene concentrado en un tier casi imposible."""
    with Session() as s:
        sembrar(s)
        tiers = modelo(s, "comic_25", precio=25.0)["model_tiers"]
        assert [t["tier"] for t in tiers] == ["Common", "Uncommon", "Rare", "Epic"]
        epic = next(t for t in tiers if t["tier"] == "Epic")
        assert epic["gross"] == pytest.approx(1.602, abs=0.001)   # 0.01 × 160.22
        assert epic["probability"] == 0.01 and epic["n_cards"] == 211


def test_sin_pool_guardado_NO_se_devuelve_un_cero(Session):
    """Un ratio de 0 pintaría la aguja al fondo, como si la máquina fuera un robo, cuando lo único
    que pasa es que todavía no hemos mirado sus cartas."""
    with Session() as s:
        r = modelo(s, "nunca_vista", precio=25.0)
        assert r["model_ev"] is None and r["model_ratio"] is None
        assert r["model_edge_pct"] is None and r["model_tiers"] == []


def test_con_el_desglose_incompleto_tampoco(Session):
    """Con tres rarezas de cuatro la suma sale igual de limpia y es sistemáticamente baja, así que
    publicarla sería inventar una máquina peor de lo que es."""
    with Session() as s:
        sembrar(s, filas=COMIC_25[:3])
        r = modelo(s, "comic_25", precio=25.0)
        assert r["model_ev"] is None
        assert len(r["model_tiers"]) == 3      # el desglose parcial SÍ se enseña, el total no


def test_una_rareza_sin_cartas_no_cuenta_como_que_no_aporta_valor(Session):
    """CC tiene máquinas con el pool a cero. Un gross de 0 se leería como "esta rareza no vale
    nada", que es muy distinto de "no se sabe lo que vale"."""
    with Session() as s:
        s.add(GachaPoolTier(machine="vacia", tier="epic", probability=0.01, n_cards=0,
                            avg_value=None))
        s.commit()
        t = modelo(s, "vacia", precio=25.0)["model_tiers"][0]
        assert t["gross"] is None and t["value"] is None and t["n_cards"] == 0


def test_sin_precio_no_hay_ratio(Session):
    with Session() as s:
        sembrar(s)
        assert modelo(s, "comic_25", precio=0.0)["model_ratio"] is None


def test_solo_mira_su_maquina(Session):
    with Session() as s:
        sembrar(s, machine="otra")
        assert modelo(s, "comic_25", precio=25.0)["model_tiers"] == []


class TestResumenPorRareza:
    def test_guarda_cuantas_hay_y_cuanto_valen(self):
        r = resumen_por_rareza([10.0, 20.0, 60.0], 0.04)
        assert r == {"n_cards": 3, "avg_value": 30.0, "min_value": 10.0, "max_value": 60.0,
                     "probability": 0.04}

    def test_guarda_el_minimo_y_el_maximo_ademas_de_la_media(self):
        """El EV de un tier con una carta de 50.000 entre cien de 200 no se parece en nada al de
        cien cartas de 700, y las dos medias son la misma."""
        concentrado = resumen_por_rareza([50_000.0] + [200.0] * 99, 0.01)   # una gorda y 99 flojas
        repartido = resumen_por_rareza([698.0] * 100, 0.01)                 # cien iguales
        # Misma media exacta: por sí sola no distingue las dos máquinas.
        assert concentrado["avg_value"] == repartido["avg_value"] == 698.0
        # El máximo sí.
        assert (concentrado["max_value"], repartido["max_value"]) == (50_000.0, 698.0)

    def test_sin_cartas_no_hay_medias(self):
        r = resumen_por_rareza([], 0.01)
        assert r["n_cards"] == 0 and r["avg_value"] is None
        assert r["probability"] == 0.01      # la odd se conserva: es de la máquina, no del pool
