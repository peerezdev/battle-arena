"""Huecos por rareza: cuántas tiradas lleva cada una sin salir.

El feed llega de más reciente a más antiguo, así que el hueco es la posición. Lo delicado es el
caso de la rareza que NO aparece en la muestra: darle un número sería inventarse una medición.
"""
from app.services.rarity_gaps import RAREZAS, gaps


def f(rareza):
    return {"rarity": rareza}


def test_la_de_la_ultima_tirada_tiene_hueco_cero():
    assert gaps([f("Epic"), f("Common")])["Epic"] == 0


def test_el_hueco_es_la_posicion_en_el_feed():
    filas = [f("Common"), f("Common"), f("Rare"), f("Common"), f("Epic")]
    g = gaps(filas)
    assert g["Common"] == 0
    assert g["Rare"] == 2
    assert g["Epic"] == 4


def test_una_rareza_que_no_sale_en_la_muestra_es_none_y_no_un_numero():
    """Redondearla al tamaño de la muestra daría por medido algo que no se midió."""
    g = gaps([f("Common")] * 50)
    assert g["Common"] == 0
    assert g["Epic"] is None
    assert g["Rare"] is None


def test_solo_cuenta_la_primera_aparicion():
    g = gaps([f("Common"), f("Epic"), f("Epic"), f("Epic")])
    assert g["Epic"] == 1


def test_sin_datos_todas_son_none():
    assert gaps([]) == {r: None for r in RAREZAS}


def test_una_rareza_desconocida_no_estorba():
    """Si CC añadiera un tier nuevo, no puede romper el cálculo de los que sí conocemos."""
    g = gaps([f("Mythic"), f("Rare")])
    assert g["Rare"] == 1
    assert "Mythic" not in g


def test_devuelve_las_cuatro_siempre():
    assert set(gaps([f("Common")])) == set(RAREZAS)
