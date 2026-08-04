"""Pool de wallets de escrow.

El riesgo de este módulo no es que falle: es que acierte por defecto. Si "no he podido comprobar el
saldo" se parece a "está vacío", el pool entrega una wallet con dinero dentro a la partida siguiente
y su settle barre ese saldo hacia otro ganador. Medido en devnet antes de escribirlo: 18 escrows con
USDC (uno con $3.500) y 10 con cartas, sobre 79.

Por eso la mayoría de estos tests son sobre lo que pasa cuando el RPC no contesta.
"""
import json

import pytest
import respx
from httpx import Response

from app.db import make_engine, make_session_factory, init_db
from app.models import EscrowWallet
from app.services import escrow_pool as pool

RPC = "https://rpc.test"
USDC = "Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"
A = "FjTn11BNndEsew3PwNcofMozX8tAAjcscTKEHZELnzcG"
B = "6d4vjzRTFXhVFDPQnJHqvJK5jVUY5uJTHiSDwCsyDPTn"


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    with make_session_factory(engine)() as s:
        yield s


class _Signer:
    def __init__(self):
        self.creadas = 0

    async def create_solana_wallet(self):
        self.creadas += 1
        return {"id": f"new-id-{self.creadas}", "address": f"NuevaWallet{self.creadas}"}


def _libre(session, address, wallet_id="wid"):
    session.add(EscrowWallet(address=address, wallet_id=wallet_id, status="free"))
    session.commit()


def _rpc(*, cartas=0, usdc=None, fallo=None, ata_inexistente=False):
    """Handler que simula el RPC. `usdc` en base units; `ata_inexistente` → value:null."""
    def handler(request):
        m = json.loads(request.content)["method"]
        if fallo == m:
            return Response(429, text="slow down")
        if m == "getAssetsByOwner":
            return Response(200, json={"result": {"items": [{"id": f"a{i}"} for i in range(cartas)]}})
        if ata_inexistente:
            return Response(200, json={"result": {"value": None},
                                       "error": {"message": "could not find account"}})
        return Response(200, json={"result": {"value": {"amount": str(usdc or 0)}}})
    return handler


# ── lo que protege el dinero ───────────────────────────────────────────────────

@respx.mock
@pytest.mark.anyio
async def test_un_escrow_con_usdc_no_se_libera():
    respx.post(RPC).mock(side_effect=_rpc(usdc=3_500_000_000))
    assert await pool.motivo_retencion(RPC, A, USDC) == "3500.00 USDC"


@respx.mock
@pytest.mark.anyio
async def test_un_escrow_con_cartas_no_se_libera():
    respx.post(RPC).mock(side_effect=_rpc(cartas=2))
    assert await pool.motivo_retencion(RPC, A, USDC) == "2 carta(s)"


@respx.mock
@pytest.mark.anyio
async def test_el_rpc_caido_no_cuenta_como_vacio():
    """El fallo que este módulo existe para evitar: un 429 no es un saldo de cero."""
    respx.post(RPC).mock(side_effect=_rpc(fallo="getTokenAccountBalance"))
    with pytest.raises(pool.EstadoDesconocido):
        await pool.motivo_retencion(RPC, A, USDC)


@respx.mock
@pytest.mark.anyio
async def test_das_caido_tampoco():
    respx.post(RPC).mock(side_effect=_rpc(fallo="getAssetsByOwner"))
    with pytest.raises(pool.EstadoDesconocido):
        await pool.motivo_retencion(RPC, A, USDC)


@respx.mock
@pytest.mark.anyio
async def test_una_respuesta_de_das_sin_items_no_se_lee_como_vacio():
    """Un error de DAS trae un cuerpo sin 'items'. Contar 0 ahí sería inventarse el dato."""
    respx.post(RPC).mock(return_value=Response(200, json={"error": {"message": "boom"}}))
    with pytest.raises(pool.EstadoDesconocido):
        await pool.motivo_retencion(RPC, A, USDC)


@respx.mock
@pytest.mark.anyio
async def test_sin_ata_de_usdc_si_es_cero_de_verdad():
    """value:null con 200 significa que la cuenta no existe: nunca tuvo USDC."""
    respx.post(RPC).mock(side_effect=_rpc(ata_inexistente=True))
    assert await pool.motivo_retencion(RPC, A, USDC) is None


@respx.mock
@pytest.mark.anyio
async def test_liberar_retiene_y_escribe_el_motivo(session):
    session.add(EscrowWallet(address=A, wallet_id="w", status="in_use", battle_id="b1"))
    session.commit()
    respx.post(RPC).mock(side_effect=_rpc(usdc=112_500_000))
    assert await pool.liberar(session, RPC, A, USDC) is False
    fila = session.get(EscrowWallet, A)
    assert fila.status == "retained"
    assert "112.50 USDC" in fila.unavailable_reason


@respx.mock
@pytest.mark.anyio
async def test_liberar_no_revienta_si_no_puede_comprobar(session):
    """Liberar es limpieza al cerrar la partida: no debe tumbar el cierre."""
    session.add(EscrowWallet(address=A, wallet_id="w", status="in_use", battle_id="b1"))
    session.commit()
    respx.post(RPC).mock(side_effect=_rpc(fallo="getAssetsByOwner"))
    assert await pool.liberar(session, RPC, A, USDC) is False
    fila = session.get(EscrowWallet, A)
    assert fila.status == "retained"
    assert fila.unavailable_reason.startswith("sin comprobar")


@respx.mock
@pytest.mark.anyio
async def test_liberar_devuelve_al_pool_lo_que_esta_vacio(session):
    session.add(EscrowWallet(address=A, wallet_id="w", status="in_use", battle_id="b1"))
    session.commit()
    respx.post(RPC).mock(side_effect=_rpc(ata_inexistente=True))
    assert await pool.liberar(session, RPC, A, USDC) is True
    fila = session.get(EscrowWallet, A)
    assert (fila.status, fila.battle_id) == ("free", None)
    assert fila.released_at is not None


# ── reclamar ──────────────────────────────────────────────────────────────────

@pytest.mark.anyio
async def test_se_reutiliza_en_vez_de_crear(session):
    _libre(session, A, "wid-A")
    signer = _Signer()
    esc = await pool.adquirir(session, signer, "b1")
    assert esc == {"id": "wid-A", "address": A}
    assert signer.creadas == 0, "con el pool lleno no se toca Privy"
    assert session.get(EscrowWallet, A).status == "in_use"


@pytest.mark.anyio
async def test_solo_se_crea_wallet_nueva_si_el_pool_esta_vacio(session):
    signer = _Signer()
    esc = await pool.adquirir(session, signer, "b1")
    assert signer.creadas == 1
    fila = session.get(EscrowWallet, esc["address"])
    assert (fila.status, fila.battle_id, fila.times_used) == ("in_use", "b1", 1)


@pytest.mark.anyio
async def test_una_en_uso_no_se_entrega_a_otra_partida(session):
    _libre(session, A)
    signer = _Signer()
    await pool.adquirir(session, signer, "b1")
    await pool.adquirir(session, signer, "b2")
    assert signer.creadas == 1, "la segunda partida no puede recibir la wallet de la primera"


@pytest.mark.anyio
async def test_una_retenida_no_vuelve_a_entregarse(session):
    """El escrow con $3.500 dentro no puede reaparecer como libre."""
    session.add(EscrowWallet(address=A, wallet_id="w", status="retained",
                             unavailable_reason="3500.00 USDC"))
    session.commit()
    signer = _Signer()
    esc = await pool.adquirir(session, signer, "b1")
    assert esc["address"] != A
    assert signer.creadas == 1


@pytest.mark.anyio
async def test_el_ciclo_completo_no_gasta_wallets_nuevas(session):
    """Tres partidas seguidas con una sola wallet: es el objetivo del módulo."""
    _libre(session, A, "wid-A")
    signer = _Signer()
    with respx.mock:
        respx.post(RPC).mock(side_effect=_rpc(ata_inexistente=True))
        for n in range(3):
            esc = await pool.adquirir(session, signer, f"b{n}")
            assert esc["address"] == A
            assert await pool.liberar(session, RPC, A, USDC) is True
    assert signer.creadas == 0
    assert session.get(EscrowWallet, A).times_used == 3


@pytest.mark.anyio
async def test_reclamar_del_pool_sin_nada_libre_devuelve_none(session):
    assert pool.reclamar_del_pool(session, "b1") is None


@pytest.mark.anyio
async def test_reclamar_termina_aunque_ningun_candidato_sea_reclamable(session):
    """Descubierto rompiendo el código a propósito: con `while True` reconsultando lo mismo, que el
    SELECT y el UPDATE dejaran de coincidir bastaba para girar sin fin — el servidor colgado al
    empezar una partida, no un test en rojo. Aquí se simula esa discrepancia dejando filas que el
    SELECT vería como libres pero que el UPDATE no puede tomar."""
    for i in range(3):
        session.add(EscrowWallet(address=f"W{i}", wallet_id=f"w{i}", status="free"))
    session.commit()
    # Alguien las pone en uso justo después de que el SELECT las viera: el UPDATE no cogerá ninguna.
    original = pool._ahora

    def _sabotaje():
        session.query(EscrowWallet).update({"status": "in_use"}, synchronize_session=False)
        return original()
    pool._ahora = _sabotaje
    try:
        assert pool.reclamar_del_pool(session, "b1") is None    # termina, no cuelga
    finally:
        pool._ahora = original


# ── que la api-key no acabe en disco ──────────────────────────────────────────

@respx.mock
@pytest.mark.anyio
async def test_el_motivo_guardado_no_contiene_la_api_key(session):
    """Pasó de verdad: un 429 imprimió la clave de Helius entera. El texto del error de httpx trae
    la URL, y ese texto se escribe en unavailable_reason — o sea que la clave quedaba en la base."""
    rpc = "https://devnet.helius-rpc.com/?api-key=SECRETO123"
    session.add(EscrowWallet(address=A, wallet_id="w", status="in_use", battle_id="b1"))
    session.commit()
    respx.post(rpc).mock(return_value=Response(429, text="slow down"))
    assert await pool.liberar(session, rpc, A, USDC) is False
    motivo = session.get(EscrowWallet, A).unavailable_reason
    assert "SECRETO123" not in motivo
    assert "[redactada]" in motivo


# ── Inventario COMPARTIDO entre redes ─────────────────────────────────────────
#
# Una wallet de Privy es la misma en todas las cadenas; lo que cambia por red es lo que tiene
# dentro. El inventario guarda la IDENTIDAD (dirección + wallet_id) y `escrow_wallets` sigue
# guardando el ESTADO de cada red. Así mainnet deja de crear wallets teniendo decenas ya hechas,
# y la lista deja de vivir en la base de devnet.

class _SignerQueCrea:
    """Cuenta cuántas wallets NUEVAS se piden a Privy. Es la cifra que hay que bajar a cero."""

    def __init__(self):
        self.creadas = 0

    async def create_solana_wallet(self):
        self.creadas += 1
        return {"id": f"wid-nueva-{self.creadas}", "address": f"NuevaWallet{self.creadas}"}


@pytest.fixture
def inventario(tmp_path, monkeypatch):
    """Inventario compartido en un fichero temporal, con la caché del módulo limpia."""
    from app.services import escrow_inventory as inv
    from app.config import Settings, get_settings
    ruta = f"sqlite:///{tmp_path/'inventario.db'}"
    monkeypatch.setattr(inv, "get_settings",
                        lambda: Settings(escrow_inventory_url=ruta))
    inv._factory = None; inv._url_cacheada = None
    return inv


@pytest.mark.anyio
async def test_sin_inventario_todo_sigue_igual(session, monkeypatch):
    # Por defecto está apagado: una instalación que no lo quiera no cambia por actualizar.
    from app.services import escrow_inventory as inv
    inv._factory = None; inv._url_cacheada = None
    signer = _SignerQueCrea()
    r = await pool.adquirir(session, signer, "b1")
    assert signer.creadas == 1
    assert r["address"] == "NuevaWallet1"


@pytest.mark.anyio
async def test_una_red_nueva_reutiliza_las_del_inventario_sin_crear_ninguna(session, inventario):
    # El caso que motiva todo: mainnet arranca con el pool vacío y 79 wallets ya existentes.
    inventario.registrar("WalletDeDevnet1", "wid-1")
    inventario.registrar("WalletDeDevnet2", "wid-2")
    signer = _SignerQueCrea()

    r1 = await pool.adquirir(session, signer, "b1")
    r2 = await pool.adquirir(session, signer, "b2")

    assert signer.creadas == 0, "no se puede pedir una wallet nueva teniendo inventario"
    assert {r1["address"], r2["address"]} == {"WalletDeDevnet1", "WalletDeDevnet2"}
    assert r1["id"] == "wid-1"          # el wallet_id viaja: es lo que hace falta para firmar
    # Y quedan con su fila de ESTADO en esta red, ocupadas por su partida.
    fila = session.get(EscrowWallet, r1["address"])
    assert fila.status == "in_use" and fila.battle_id == "b1"


@pytest.mark.anyio
async def test_no_reparte_dos_veces_la_misma_en_la_misma_red(session, inventario):
    inventario.registrar("Unica", "wid-u")
    signer = _SignerQueCrea()
    r1 = await pool.adquirir(session, signer, "b1")
    r2 = await pool.adquirir(session, signer, "b2")
    assert r1["address"] == "Unica"
    # Agotado el inventario, la segunda SÍ tiene que ser nueva: repetir la misma daría dos
    # partidas simultáneas escribiendo en el mismo escrow de la misma cadena.
    assert r2["address"] == "NuevaWallet1" and signer.creadas == 1


@pytest.mark.anyio
async def test_una_retenida_de_esta_red_no_se_vuelve_a_repartir(session, inventario):
    # Aunque el inventario la liste, si aquí tiene algo dentro no se puede tocar.
    session.add(EscrowWallet(address="Sucia", wallet_id="wid-s", status="retained",
                             unavailable_reason="2 carta(s)"))
    session.commit()
    inventario.registrar("Sucia", "wid-s")
    signer = _SignerQueCrea()
    r = await pool.adquirir(session, signer, "b1")
    assert r["address"] != "Sucia"
    assert signer.creadas == 1


@pytest.mark.anyio
async def test_la_wallet_nueva_entra_al_inventario_para_la_otra_red(session, inventario):
    # Si la red que la estrena se la guardase, el inventario dejaría de servir con el tiempo.
    signer = _SignerQueCrea()
    r = await pool.adquirir(session, signer, "b1")
    assert [w["address"] for w in inventario.todas()] == [r["address"]]


@pytest.mark.anyio
async def test_el_pool_de_la_red_manda_sobre_el_inventario(session, inventario):
    # Una libre de aquí ya está comprobada vacía ON-CHAIN en esta cadena; la del inventario no
    # se ha usado nunca aquí. Se prefiere la conocida.
    session.add(EscrowWallet(address="LibreAqui", wallet_id="wid-l", status="free"))
    session.commit()
    inventario.registrar("DelInventario", "wid-i")
    signer = _SignerQueCrea()
    r = await pool.adquirir(session, signer, "b1")
    assert r["address"] == "LibreAqui"
    assert signer.creadas == 0
