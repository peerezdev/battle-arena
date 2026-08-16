"""La fila que consume la pantalla, y sobre todo cuándo se NIEGA a dar un veredicto."""
from datetime import datetime, timedelta, timezone

import pytest

from app.services.ev_view import CONSTRUYENDO, CON_HUECO, SIN_MUESTRA, fila_ev
from app.services.ev_stats import CONFIRMADO_NEG, SIN_CONCLUIR
from app.services.winners_store import anotar_tramo, guardar

AHORA = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)


def sembrar(s, n, valor=45.0, machine="pokemon_50", disperso=False):
    filas = []
    for i in range(n):
        v = valor if not disperso else (valor if i % 100 else valor * 12)
        filas.append({"nft_address": f"{machine}-{i}", "machine": machine, "prize_tier": 4,
                      "insured_value": v, "weighted_insured_value": None, "memo": None,
                      "winner": "W", "created_at": AHORA - timedelta(minutes=i % 2000),
                      "source": "live"})
    guardar(s, filas)


def test_ventana_completa_y_maquina_mala_da_veredicto(Session):
    with Session() as s:
        sembrar(s, 400)                                   # todas a 45 en un sobre de 50
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=60), AHORA, enlaza=True)
        f = fila_ev(s, "pokemon_50", precio=50, buyback_pct=0.85, remuestreos=400, ahora=AHORA)
        assert f["realized_verdict"] == CONFIRMADO_NEG
        assert round(f["realized_edge_pct"], 1) == -10.0
        assert f["window_complete"] is True and f["hours_covered"] == 48


def test_sin_ventana_completa_NO_hay_veredicto_aunque_sobren_datos(Session):
    """El caso que decidimos explícitamente: con 6 h se puede calcular un intervalo estrechísimo,
    y publicarlo como CONFIDENT sería el error que hunde la credibilidad de la pantalla."""
    with Session() as s:
        sembrar(s, 400)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=6), AHORA, enlaza=True)
        f = fila_ev(s, "pokemon_50", precio=50, remuestreos=400, ahora=AHORA)
        assert f["realized_verdict"] == CONSTRUYENDO
        assert f["hours_covered"] == 6.0
        assert f["realized_edge_pct"] is not None      # el dato SÍ se publica, el veredicto no


def test_un_hueco_dentro_de_la_ventana_retira_el_veredicto(Session):
    """La media saldría igual de limpia, y por eso mismo engaña: nadie sabría que falta un trozo."""
    with Session() as s:
        sembrar(s, 400)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=60), AHORA - timedelta(hours=10), enlaza=True)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=8), AHORA, enlaza=False)
        f = fila_ev(s, "pokemon_50", precio=50, remuestreos=400, ahora=AHORA)
        assert f["realized_verdict"] == CON_HUECO
        assert len(f["gaps"]) == 1


def test_muestra_corta_con_ventana_completa_no_es_lo_mismo_que_construyendo(Session):
    """La ventana está entera; lo que pasa es que esa máquina no se juega. Son estados distintos y
    la pantalla tiene que poder decir cosas distintas."""
    with Session() as s:
        sembrar(s, 5)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=60), AHORA, enlaza=True)
        f = fila_ev(s, "pokemon_50", precio=50, ahora=AHORA)
        assert f["realized_verdict"] == SIN_MUESTRA
        assert f["realized_edge_pct"] is None          # ni se intenta el bootstrap


def test_una_maquina_sin_datos_no_revienta(Session):
    with Session() as s:
        f = fila_ev(s, "vacia", precio=50, ahora=AHORA)
        assert f["realized_n_pulls"] == 0 and f["realized_verdict"] == CONSTRUYENDO


def test_con_cola_larga_el_veredicto_queda_sin_concluir(Session):
    """Una de cada cien vale doce veces más: la cola abre el intervalo y cruzar el cero es la
    respuesta honesta, no un fallo."""
    with Session() as s:
        sembrar(s, 300, valor=50.0, disperso=True)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=60), AHORA, enlaza=True)
        f = fila_ev(s, "pokemon_50", precio=50, remuestreos=1200, ahora=AHORA)
        assert f["realized_verdict"] == SIN_CONCLUIR
        assert f["pulls_to_conclude"] is None or f["pulls_to_conclude"] > 300


def test_el_intervalo_es_estable_entre_llamadas(Session):
    """Sin semilla fija, el veredicto podría cambiar entre dos refrescos sin cambiar los datos."""
    with Session() as s:
        sembrar(s, 300, disperso=True)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=60), AHORA, enlaza=True)
        a = fila_ev(s, "pokemon_50", precio=50, remuestreos=500, ahora=AHORA)
        b = fila_ev(s, "pokemon_50", precio=50, remuestreos=500, ahora=AHORA)
        assert a == b


# ── el modelo: lo que la máquina DEBERÍA pagar ────────────────────────────────

def sembrar_rarezas(s, tiers, machine="pokemon_50"):
    """`tiers` de MÁS ANTIGUA a más reciente. El `sembrar` de arriba pone siempre Common."""
    guardar(s, [{"nft_address": f"{machine}-r{i}", "machine": machine, "prize_tier": t,
                 "insured_value": 40.0, "weighted_insured_value": None, "memo": None,
                 "winner": "W", "created_at": AHORA - timedelta(minutes=len(tiers) - i),
                 "source": "live"} for i, t in enumerate(tiers)])


def _pool(s, machine="pokemon_50"):
    """Las odds y el pool de `comic_25`, que son los que cuadran con el `ev` publicado por CC."""
    from app.models import GachaPoolTier
    for tier, p, n, avg in (("common", 0.75, 12, 19.75), ("uncommon", 0.2, 27, 38.89),
                            ("rare", 0.04, 231, 70.14), ("epic", 0.01, 211, 160.22)):
        s.add(GachaPoolTier(machine=machine, tier=tier, probability=p, n_cards=n, avg_value=avg))
    s.commit()


def test_la_fila_trae_el_ev_del_modelo(Session):
    with Session() as s:
        _pool(s)
        f = fila_ev(s, "pokemon_50", precio=25.0, buyback_pct=0.85)
        # En valor de carta, igual que lo realizado: la recompra la aplica el interruptor.
        assert f["model_ev"] == pytest.approx(26.998, abs=0.01)
        assert f["model_edge_pct"] == pytest.approx(8.0, abs=0.1)


def test_cada_rareza_junta_lo_observado_y_lo_esperado(Session):
    """En la tarjeta es UNA tabla: "sale un 4% de las veces, vale 70 de media, aporta 2.81 al EV, y
    lleva 8 tiradas sin salir"."""
    with Session() as s:
        _pool(s)
        sembrar_rarezas(s, [2] + [4] * 9)             # Rare y luego 9 Commons
        rare = next(t for t in fila_ev(s, "pokemon_50", precio=25.0)["tiers"] if t["tier"] == "Rare")
        assert rare["current"] == 9                    # lo observado
        assert rare["probability"] == 0.04             # lo esperado
        assert rare["gross"] == pytest.approx(2.806, abs=0.001)


def test_sin_pool_barrido_las_rachas_siguen_saliendo(Session):
    """Manda la tabla de rachas: es útil desde la primera hora, y no puede quedarse esperando a un
    barrido del pool que tarda."""
    with Session() as s:
        sembrar_rarezas(s, [4] * 10)
        f = fila_ev(s, "pokemon_50", precio=25.0)
        assert [t["tier"] for t in f["tiers"]] == ["Common", "Uncommon", "Rare", "Epic"]
        assert f["model_ev"] is None
        assert all("gross" not in t or t["gross"] is None for t in f["tiers"])


def test_lo_realizado_y_lo_del_modelo_NO_se_mezclan(Session):
    """Son dos afirmaciones distintas y el valor de la pantalla está en poder compararlas: si el
    modelo pisara el edge realizado, la tarjeta diría haber medido lo que solo ha calculado."""
    with Session() as s:
        _pool(s)
        sembrar(s, 40)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=60), AHORA, enlaza=True)
        # `ahora=AHORA` es obligatorio: sin él la ventana de 48 h se mide contra el reloj REAL y
        # las filas sembradas se salen de ella en cuanto pasan dos días. El test pasaba solo
        # mientras la fecha del fixture estuviera cerca de hoy.
        f = fila_ev(s, "pokemon_50", precio=25.0, buyback_pct=0.85, remuestreos=200, ahora=AHORA)
        assert f["model_edge_pct"] is not None and f["realized_edge_pct"] is not None
        assert f["model_edge_pct"] != f["realized_edge_pct"]
