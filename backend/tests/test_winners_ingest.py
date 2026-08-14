"""Ingestor del EV tracker: parseo del feed en vivo y detección de huecos.

Las dos piezas que de verdad pueden fallar están aisladas de la red y se prueban aquí. Los
payloads son copias de mensajes REALES de mainnet.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest
import respx
from httpx import Response

from app.services.winners_ingest import eventos_sse, hay_hueco, token_ably, traer_rest

AHORA = datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc)

TIRADA = {"winner": "Ep1bux", "nft": {"address": "FKkFk"}, "timestamp": "2026-08-14T10:55:46.040Z",
          "insuredValue": 47, "weightedInsuredValue": 55.35, "gachaCode": "pokemon_50",
          "prizeTier": 4, "memo": "jupiter-6a53"}


def sse(nombre="new-winner", datos=TIRADA, como_cadena=False):
    d = json.dumps(datos) if como_cadena else datos
    return "data: " + json.dumps({"name": nombre, "data": d})


# ── parseo del flujo en vivo ──────────────────────────────────────────────────

def test_saca_la_tirada_de_un_evento():
    assert list(eventos_sse([sse()]))[0]["gachaCode"] == "pokemon_50"


def test_el_payload_tambien_puede_venir_como_cadena_json():
    """Ably entrega `data` como objeto o como cadena según el camino. Si solo se contempla el
    objeto, el ingestor se queda MUDO sin lanzar ningún error, que es el peor fallo posible."""
    assert list(eventos_sse([sse(como_cadena=True)]))[0]["gachaCode"] == "pokemon_50"


def test_ignora_lo_que_no_es_una_tirada():
    # El flujo trae latidos, confirmaciones de suscripción y líneas vacías.
    ruido = ["", ":keepalive", "event: message", sse(nombre="channel.attached"), "data: no-es-json"]
    assert list(eventos_sse(ruido)) == []


def test_un_evento_roto_no_corta_el_flujo():
    salida = list(eventos_sse(["data: {roto", sse(), "data: {\"name\":\"new-winner\"}"]))
    assert len(salida) == 1     # la buena se procesa igual


# ── detección de huecos ───────────────────────────────────────────────────────

def _f(minutos):
    return {"created_at": AHORA - timedelta(minutes=minutos)}


def test_sin_datos_previos_no_hay_hueco():
    """Primer arranque: no hemos perdido nada, es que no teníamos nada."""
    assert hay_hueco([_f(10)] * 200, None) is False


def test_si_CC_devolvio_menos_del_tope_no_falta_nada():
    """Lo importante. Aunque la más antigua sea muy posterior a lo último que teníamos, si no nos
    recortó es que eso es TODO lo que hubo. Máquinas tranquilas pasan horas sin una tirada."""
    assert hay_hueco([_f(5)] * 3, AHORA - timedelta(hours=20)) is False


def test_con_el_tope_lleno_y_sin_enlazar_si_hay_hueco():
    # 200 exactas y la más antigua posterior a lo nuestro: entre medias hubo más y se perdieron.
    assert hay_hueco([_f(m) for m in range(200)], AHORA - timedelta(hours=8)) is True


def test_con_el_tope_lleno_pero_enlazando_no_hay_hueco():
    # La más antigua que llega es ANTERIOR a lo último nuestro: los tramos se solapan.
    assert hay_hueco([_f(m) for m in range(200)], AHORA - timedelta(minutes=100)) is False


def test_la_holgura_evita_huecos_fantasma():
    """Las dos fuentes no ordenan al milisegundo. Sin margen marcaríamos un hueco en cada
    reconexión, y la pantalla acabaría diciendo siempre que la ventana está rota."""
    assert hay_hueco([_f(m) for m in range(200)], AHORA - timedelta(minutes=199, seconds=2)) is False


def test_sin_filas_no_hay_hueco():
    assert hay_hueco([], AHORA) is False


# ── red, con dobles ───────────────────────────────────────────────────────────

class _GachaFalso:
    def __init__(self, peticion=None, crudas=None):
        self._peticion = peticion if peticion is not None else {"keyName": "abc.def", "mac": "m"}
        self._crudas = crudas or []
        self.ultimo_timestamp = "sin llamar"

    async def ably_token_request(self):
        return self._peticion

    async def winners_raw(self, pack_type, count=200, timestamp=None):
        self.ultimo_timestamp = timestamp
        return self._crudas


@respx.mock
@pytest.mark.asyncio
async def test_token_ably_canjea_la_peticion():
    respx.post("https://rest.ably.io/keys/abc.def/requestToken").mock(
        return_value=Response(200, json={"token": "TOK123"}))
    assert await token_ably(_GachaFalso()) == "TOK123"


@respx.mock
@pytest.mark.asyncio
async def test_si_ably_falla_no_se_tumba_el_backend():
    """Sin feed en vivo el tracker se degrada, no se cae: el relleno REST sigue trayendo datos."""
    respx.post("https://rest.ably.io/keys/abc.def/requestToken").mock(return_value=Response(500))
    assert await token_ably(_GachaFalso()) is None
    assert await token_ably(_GachaFalso(peticion={})) is None      # sin keyName


@pytest.mark.asyncio
async def test_traer_rest_normaliza_ordena_y_acota():
    crudas = [
        {"nft_address": "b", "pack_type": "pokemon_50", "prize_tier": 4, "insuredValue": 50,
         "created_at": "2026-08-14T11:00:00Z", "winner": "W"},
        {"nft_address": "a", "pack_type": "pokemon_50", "prize_tier": 4, "insuredValue": 40,
         "created_at": "2026-08-14T10:00:00Z", "winner": "W"},
        {"nft_address": None, "pack_type": "pokemon_50", "prize_tier": 4, "insuredValue": 40,
         "created_at": "2026-08-14T10:30:00Z", "winner": "W"},      # incompleta: se descarta
    ]
    g = _GachaFalso(crudas=crudas)
    filas = await traer_rest(g, "pokemon_50", desde=AHORA - timedelta(hours=3))
    assert [f["nft_address"] for f in filas] == ["a", "b"]          # de más antigua a más nueva
    assert g.ultimo_timestamp == "2026-08-14T09:00:00Z"             # acotado, en ISO con Z


@pytest.mark.asyncio
async def test_traer_rest_sin_desde_no_manda_timestamp():
    g = _GachaFalso(crudas=[])
    await traer_rest(g, "pokemon_50")
    assert g.ultimo_timestamp is None
