"""Persistencia de tiradas y contabilidad de huecos del EV tracker."""
from datetime import datetime, timedelta, timezone

from app.models import GachaCoverage, GachaWinner
from app.services.winners_store import (anotar_tramo, guardar, maquinas_con_datos, ultima_vista,
                                        ventana)

AHORA = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)


def fila(nft, machine="pokemon_50", valor=47.0, minutos=0, source="live"):
    return {"nft_address": nft, "machine": machine, "prize_tier": 4, "insured_value": valor,
            "weighted_insured_value": None, "memo": None, "winner": "W",
            "created_at": AHORA - timedelta(minutes=minutos), "source": source}


def test_guardar_cuenta_solo_las_nuevas(Session):
    with Session() as s:
        assert guardar(s, [fila("a"), fila("b")]) == 2
        assert guardar(s, [fila("b"), fila("c")]) == 1
        assert s.query(GachaWinner).count() == 3


def test_la_misma_tirada_por_las_dos_fuentes_no_se_duplica(Session):
    """Llega por el feed en vivo y otra vez por el relleno REST. Es el mismo hecho."""
    with Session() as s:
        guardar(s, [fila("x", minutos=5, source="live")])
        assert guardar(s, [fila("x", minutos=5, source="rest")]) == 0
        assert s.query(GachaWinner).count() == 1
        assert s.query(GachaWinner).one().source == "live"   # gana la primera


def test_la_MISMA_carta_en_dos_momentos_son_DOS_tiradas(Session):
    """El buyback devuelve las cartas al pool, así que una carta se entrega varias veces. Medido en
    mainnet: 183 direcciones distintas en 200 tiradas de onepiece_50. Contarla una sola vez
    descontaría tiradas reales y sesgaría el EV a la baja sin que nada lo delatara."""
    with Session() as s:
        assert guardar(s, [fila("misma", minutos=10), fila("misma", minutos=40)]) == 2
        assert s.query(GachaWinner).count() == 2


def test_el_lote_puede_traer_la_misma_tirada_repetida(Session):
    """El feed devuelve duplicados dentro de UNA sola respuesta. Sin deduplicar dentro del lote, la
    inserción entera revienta por clave duplicada y no se guarda nada de esa máquina."""
    with Session() as s:
        assert guardar(s, [fila("a", minutos=5), fila("a", minutos=5), fila("b")]) == 2
        assert s.query(GachaWinner).count() == 2


def test_guardar_ignora_los_descartes_del_normalizador(Session):
    # El normalizador devuelve None para las filas incompletas; el almacén no debe atragantarse.
    with Session() as s:
        assert guardar(s, [fila("a"), None, fila("b")]) == 2


def test_un_tramo_que_enlaza_no_deja_hueco(Session):
    with Session() as s:
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=5), AHORA - timedelta(hours=1), enlaza=True)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=1), AHORA, enlaza=True)
        c = s.get(GachaCoverage, "pokemon_50")
        assert c.gaps is None
        assert c.continuous_since.replace(tzinfo=timezone.utc) == AHORA - timedelta(hours=5)


def test_un_tramo_que_NO_enlaza_apunta_el_hueco_y_mueve_el_origen(Session):
    """Lo importante: `continuous_since` salta al tramo nuevo.

    Lo anterior al agujero sigue en la base, pero una ventana que lo cruce ya no es fiable, y si el
    origen no se moviera la seguiríamos dando por completa.
    """
    with Session() as s:
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=10), AHORA - timedelta(hours=6), enlaza=True)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=2), AHORA, enlaza=False)
        c = s.get(GachaCoverage, "pokemon_50")
        assert c.gaps is not None and len(__import__("json").loads(c.gaps)) == 1
        assert c.continuous_since.replace(tzinfo=timezone.utc) == AHORA - timedelta(hours=2)


def test_ventana_completa_solo_si_hay_continuidad_desde_antes(Session):
    with Session() as s:
        guardar(s, [fila(f"n{i}", minutos=i * 10) for i in range(20)])
        # Continuidad desde hace 50 h: la ventana de 48 h queda cubierta entera.
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=50), AHORA, enlaza=True)
        v = ventana(s, "pokemon_50", horas=48, ahora=AHORA)
        assert v["completa"] is True and v["horas_cubiertas"] == 48
        assert v["n"] == 20


def test_ventana_a_medias_lo_dice_y_cuenta_las_horas(Session):
    """El primer día, y tras cualquier arranque en frío. Es el estado BUILDING de la tarjeta."""
    with Session() as s:
        guardar(s, [fila("a", minutos=30)])
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=6), AHORA, enlaza=True)
        v = ventana(s, "pokemon_50", horas=48, ahora=AHORA)
        assert v["completa"] is False
        assert v["horas_cubiertas"] == 6.0


def test_la_ventana_solo_coge_lo_que_cae_dentro(Session):
    with Session() as s:
        guardar(s, [fila("dentro", minutos=10), fila("fuera", minutos=60 * 50)])
        v = ventana(s, "pokemon_50", horas=48, ahora=AHORA)
        assert v["n"] == 1


def test_los_huecos_viejos_no_ensucian_la_ventana(Session):
    """Un agujero de hace tres días no dice nada de las últimas 48 h y no debe salir en la tarjeta."""
    with Session() as s:
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=80), AHORA - timedelta(hours=75), enlaza=True)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=70), AHORA, enlaza=False)  # hueco viejo
        v = ventana(s, "pokemon_50", horas=48, ahora=AHORA)
        assert v["huecos"] == []


def test_un_hueco_dentro_de_la_ventana_si_sale(Session):
    with Session() as s:
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=60), AHORA - timedelta(hours=10), enlaza=True)
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=8), AHORA, enlaza=False)
        v = ventana(s, "pokemon_50", horas=48, ahora=AHORA)
        assert len(v["huecos"]) == 1


def test_ultima_vista_y_maquinas(Session):
    with Session() as s:
        guardar(s, [fila("a"), fila("b", machine="pokemon_25")])
        anotar_tramo(s, "pokemon_50", AHORA - timedelta(hours=1), AHORA, enlaza=True)
        assert ultima_vista(s, "pokemon_50").replace(tzinfo=timezone.utc) == AHORA
        assert ultima_vista(s, "no_existe") is None
        assert set(maquinas_con_datos(s)) == {"pokemon_50", "pokemon_25"}


def test_maquina_sin_datos_devuelve_ventana_vacia_no_error(Session):
    with Session() as s:
        v = ventana(s, "no_existe", ahora=AHORA)
        assert v["n"] == 0 and v["completa"] is False and v["horas_cubiertas"] == 0.0
