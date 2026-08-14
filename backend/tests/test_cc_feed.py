"""El normalizador de las dos fuentes de tiradas de Collector Crypt.

Los payloads de aquí están copiados de respuestas REALES de mainnet, no inventados.
"""
from datetime import datetime, timezone

from app.services.cc_feed import normalizar_vivo, normalizar_rest

VIVO = {
    "winner": "Ep1buxz6icLbYXbsv96q74oASq4xaDqpqEShfsTBYEVw",
    "prizeWallet": "Low6UekJP3QrFVMfNRTL8CPK2SiGFhvp57sgF2pkmVu",
    "nft": {"address": "FKkFkFHxwLpjbh8XYEsYBkXHhMnjm54tbXE7mCN8bL7z",
            "name": "2026 Pokemon Mega Promo First Pa", "certid": "6177704046",
            "gradingCompany": "CGC", "grade": None},
    "timestamp": "2026-08-14T10:55:46.040Z",
    "insuredValue": 47, "weightedInsuredValue": 55.35579788039756,
    "gachaCode": "pokemon_50", "prizeTier": 4,
    "memo": "jupiter-6a5314f8-623b-49b4-a270-9cb67e193c2b",
}

REST = {
    "winner": "KyvsuGtPvcKSFFysCfBaZhq6ancn6R5R4PcSzYsrHM6",
    "nft_address": "EedF4qVjjkgfiHSTZvzXgEuDUNSy7rKesLgmFDvYzxhH",
    "insuredValue": 55, "created_at": "2026-08-14T10:57:32.648Z",
    "memo_slug": "cc", "pack_type": "pokemon_50", "prize_tier": 4,
}


def test_vivo_saca_la_direccion_de_dentro_del_nft():
    r = normalizar_vivo(VIVO)
    assert r["nft_address"] == "FKkFkFHxwLpjbh8XYEsYBkXHhMnjm54tbXE7mCN8bL7z"
    assert r["machine"] == "pokemon_50"          # gachaCode, no pack_type
    assert r["prize_tier"] == 4 and r["insured_value"] == 47.0
    assert r["weighted_insured_value"] == 55.35579788039756
    assert r["memo"].startswith("jupiter-")      # completo, no el prefijo
    assert r["source"] == "live"


def test_rest_traduce_sus_nombres():
    r = normalizar_rest(REST)
    assert r["nft_address"] == "EedF4qVjjkgfiHSTZvzXgEuDUNSy7rKesLgmFDvYzxhH"
    assert r["machine"] == "pokemon_50"          # pack_type
    assert r["insured_value"] == 55.0
    assert r["source"] == "rest"


def test_el_memo_del_rest_NO_se_guarda():
    """`memo_slug` es el prefijo del integrador (`cc`, `jupiter`), compartido por miles de tiradas.

    Guardarlo en el mismo campo donde en vivo va el memo entero mezclaría dos cosas distintas bajo
    el mismo nombre. Se prefiere el hueco al dato engañoso.
    """
    assert normalizar_rest(REST)["memo"] is None


def test_las_dos_fuentes_producen_la_misma_forma():
    # Es lo que permite que el ingestor guarde sin saber de dónde vino cada fila.
    assert set(normalizar_vivo(VIVO)) == set(normalizar_rest(REST))


def test_las_fechas_salen_con_zona_y_en_utc():
    # Mezclar instantes con y sin zona rompe las comparaciones de la ventana de formas silenciosas.
    for r in (normalizar_vivo(VIVO), normalizar_rest(REST)):
        assert r["created_at"].tzinfo is not None
        assert r["created_at"].utcoffset().total_seconds() == 0
    assert normalizar_vivo(VIVO)["created_at"] == datetime(2026, 8, 14, 10, 55, 46, 40000, tzinfo=timezone.utc)


def test_acepta_epoch_en_segundos_y_en_milisegundos():
    # No lo hemos visto, pero el formato no está documentado y un cambio ahí es silencioso.
    seg = normalizar_vivo({**VIVO, "timestamp": 1785624346})
    ms = normalizar_vivo({**VIVO, "timestamp": 1785624346000})
    assert seg["created_at"] == ms["created_at"]


def test_una_tirada_incompleta_se_descarta():
    """Sin dirección, máquina, fecha o valor no sirve para medir, y guardarla contaminaría la media."""
    assert normalizar_vivo({**VIVO, "nft": None}) is None
    assert normalizar_vivo({**VIVO, "insuredValue": None}) is None
    assert normalizar_vivo({**VIVO, "gachaCode": None}) is None
    assert normalizar_vivo({**VIVO, "timestamp": "no es una fecha"}) is None
    assert normalizar_rest({**REST, "nft_address": ""}) is None


def test_un_valor_de_cero_SI_es_valido():
    # 0 es un valor legítimo y `not 0` es cierto: con la comprobación descuidada se perdería.
    assert normalizar_vivo({**VIVO, "insuredValue": 0})["insured_value"] == 0.0


def test_basura_no_revienta():
    assert normalizar_vivo(None) is None and normalizar_rest("texto") is None
