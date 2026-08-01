"""Feed de últimos ganadores del gacha.

Dos cosas que este endpoint NO puede prometer y que los tests fijan para que no se prometan por
descuido: CC corta en 200 por llamada, y de rareza solo filtra Epic upstream. Pedir 100 Rare puede
devolver 4, y eso es correcto — lo incorrecto sería aparentar que se traen 100.
"""
import json

import pytest
import respx
from httpx import Response

from tests.test_gacha_api import BASE, _client

TIERS = {"Epic": 1, "Rare": 2, "Uncommon": 3, "Common": 4}


def _fila(rareza="Common", machine="pokemon_50", wallet="W1", valor=30):
    return {
        "winner": wallet, "nft_address": "M1", "insuredValue": valor,
        "created_at": "2026-08-01T01:00:00", "memo_slug": "cc",
        "pack_type": machine, "prize_tier": TIERS[rareza],
        # Fiel al payload real de CC: la imagen viene en content.files, con cc_cdn preferido.
        "nft": {"content": {"metadata": {"name": f"Carta {rareza}"},
                            "files": [{"uri": "https://arweave/c.jpg",
                                       "cc_cdn": "https://cdn/c.jpg"}]}},
    }


def _mock(filas):
    def handler(request):
        return Response(200, json={"success": True, "data": filas})
    respx.get(f"{BASE}/api/getAllWinners").mock(side_effect=handler)


@respx.mock
def test_devuelve_ganadores_con_carta_y_usuario():
    """Lo que pide la pantalla: qué salió y a quién."""
    _mock([_fila("Rare", wallet="ALICE", valor=140)])
    c, _ = _client(api_key="")
    w = c.get("/gacha/winners").json()[0]
    assert w["wallet"] == "ALICE"
    assert w["rarity"] == "Rare"
    assert w["insured_value"] == 140
    assert w["machine"] == "pokemon_50"
    assert w["name"] == "Carta Rare"
    assert w["images"] == ["https://cdn/c.jpg"]   # prefiere el CDN de CC al arweave


@respx.mock
def test_epic_usa_el_filtro_de_cc_no_el_nuestro():
    """Solo 1 de cada 100 tiradas es Epic: filtrar después devolvería dos o tres resultados."""
    visto = {}

    def handler(request):
        visto.update(dict(request.url.params))
        return Response(200, json={"success": True, "data": [_fila("Epic")]})
    respx.get(f"{BASE}/api/getAllWinners").mock(side_effect=handler)
    c, _ = _client(api_key="")
    assert c.get("/gacha/winners?rarity=Epic").status_code == 200
    assert visto.get("epic") == "true"


@respx.mock
def test_las_demas_rarezas_se_recortan_aqui():
    _mock([_fila("Common"), _fila("Rare"), _fila("Common"), _fila("Uncommon")])
    c, _ = _client(api_key="")
    out = c.get("/gacha/winners?rarity=Rare").json()
    assert [w["rarity"] for w in out] == ["Rare"]


@respx.mock
def test_la_maquina_se_pide_upstream():
    visto = {}

    def handler(request):
        visto.update(dict(request.url.params))
        return Response(200, json={"success": True, "data": []})
    respx.get(f"{BASE}/api/getAllWinners").mock(side_effect=handler)
    c, _ = _client(api_key="")
    c.get("/gacha/winners?machine=onepiece_50")
    assert visto.get("packType") == "onepiece_50"


@respx.mock
def test_no_se_puede_pedir_mas_de_200():
    """El tope es de CC. La API lo rechaza en vez de aceptarlo y devolver menos en silencio."""
    _mock([])
    c, _ = _client(api_key="")
    assert c.get("/gacha/winners?count=500").status_code == 422
    assert c.get("/gacha/winners?count=200").status_code == 200


@respx.mock
def test_una_respuesta_rara_de_cc_no_tumba_la_pantalla():
    respx.get(f"{BASE}/api/getAllWinners").mock(return_value=Response(200, json={"data": "ups"}))
    c, _ = _client(api_key="")
    assert c.get("/gacha/winners").json() == []
