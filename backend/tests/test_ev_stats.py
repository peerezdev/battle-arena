"""Bootstrap, intervalo y veredicto del EV realizado."""
import random
import time

from app.services.ev_stats import (CONFIRMADO_NEG, CONFIRMADO_POS, SIN_CONCLUIR, edge_pct,
                                   intervalo, tiradas_para_concluir, veredicto)


def _pokemon_50(n=4000, semilla=7):
    """Una muestra con la forma real de un pack de 50 $: p .80/.15/.04/.01 y valores muy dispares."""
    rnd = random.Random(semilla)
    fuera = []
    for _ in range(n):
        u = rnd.random()
        if u < 0.80:   fuera.append(rnd.uniform(25, 50))      # Common
        elif u < 0.95: fuera.append(rnd.uniform(50, 110))     # Uncommon
        elif u < 0.99: fuera.append(rnd.uniform(110, 250))    # Rare
        else:          fuera.append(rnd.uniform(250, 1200))   # Epic
    return fuera


def test_edge_es_la_media_contra_el_precio():
    assert edge_pct([50, 50, 50], 50) == 0.0
    assert edge_pct([40, 60], 50) == 0.0
    assert round(edge_pct([45, 45], 50), 4) == -10.0
    assert edge_pct([], 50) is None and edge_pct([50], 0) is None


def test_el_intervalo_contiene_al_punto():
    r = intervalo(_pokemon_50(), 50, remuestreos=800, semilla=1)
    assert r["ci_lo_pct"] < r["edge_pct"] < r["ci_hi_pct"]
    assert r["n"] == 4000


def test_con_la_misma_semilla_sale_lo_mismo():
    """Sin esto el veredicto podría cambiar entre dos refrescos sin que cambien los datos."""
    datos = _pokemon_50(1500)
    a = intervalo(datos, 50, remuestreos=600, semilla=42)
    b = intervalo(datos, 50, remuestreos=600, semilla=42)
    assert a == b


def test_mas_muestra_estrecha_el_intervalo():
    # Es la propiedad que justifica esperar a tener ventana: con poca muestra no se puede concluir.
    poca = intervalo(_pokemon_50(300, semilla=3), 50, remuestreos=800, semilla=1)
    mucha = intervalo(_pokemon_50(8000, semilla=3), 50, remuestreos=800, semilla=1)
    ancho = lambda r: r["ci_hi_pct"] - r["ci_lo_pct"]
    assert ancho(mucha) < ancho(poca) / 2


def test_el_intervalo_es_asimetrico_con_cola_larga():
    """La razón de usar bootstrap. Con una cola así, la media no se distribuye simétrica, y un
    intervalo normal centrado mentiría sobre hacia dónde se va el error."""
    r = intervalo(_pokemon_50(600, semilla=11), 50, remuestreos=3000, semilla=5)
    abajo = r["edge_pct"] - r["ci_lo_pct"]
    arriba = r["ci_hi_pct"] - r["edge_pct"]
    assert abs(abajo - arriba) > 0.02 * max(abajo, arriba)


def test_veredicto_solo_mira_donde_cae_el_intervalo():
    assert veredicto(-8.27, -4.24) == CONFIRMADO_NEG      # entero por debajo
    assert veredicto(2.10, 6.40) == CONFIRMADO_POS        # entero por encima
    assert veredicto(-10.57, 29.48) == SIN_CONCLUIR       # lo cruza
    assert veredicto(-1.0, 0.0) == SIN_CONCLUIR           # tocar el cero no es concluir
    assert veredicto(0.0, 1.0) == SIN_CONCLUIR


def test_una_maquina_claramente_mala_se_detecta():
    # Todas las cartas valen 45 en un sobre de 50: no hay duda posible.
    r = intervalo([45.0] * 500, 50, remuestreos=500, semilla=2)
    assert veredicto(r["ci_lo_pct"], r["ci_hi_pct"]) == CONFIRMADO_NEG
    assert round(r["edge_pct"], 2) == -10.0


def test_tiradas_para_concluir():
    # Con el intervalo cruzando el cero, dice cuánto más haría falta; si ya concluye, no dice nada.
    assert tiradas_para_concluir(543, -11.14, -21.63, 0.93) > 543
    assert tiradas_para_concluir(16157, -6.21, -8.27, -4.24) is None   # ya concluido
    assert tiradas_para_concluir(500, 0.0, -5.0, 5.0) is None          # sin edge, no hay respuesta


def test_muestra_insuficiente_no_revienta():
    assert intervalo([], 50) is None
    assert intervalo([50.0], 50) is None
    assert intervalo([50.0, 50.0], 0) is None


def test_el_coste_es_asumible_para_la_maquina_mas_grande():
    """16.000 tiradas es el volumen de pokemon_50 en 48 h. Corre en segundo plano, pero si tardara
    minutos habría que replantear el diseño, así que se fija un techo."""
    datos = _pokemon_50(16000)
    t0 = time.time()
    intervalo(datos, 50, remuestreos=1000, semilla=1)
    por_mil = time.time() - t0
    assert por_mil * 10 < 60, f"10.000 remuestreos tardarían {por_mil*10:.0f}s"
