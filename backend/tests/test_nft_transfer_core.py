import base64
from typing import Optional
from solders.pubkey import Pubkey
from solders.transaction import Transaction
from app.services.nft_transfer import (
    build_core_transfer, read_core_collection, MPL_CORE_PROGRAM, SYS_PROGRAM)

ASSET = "4VE7wrGvS3hBNb9kyManAx2pWmRQJftQAqGsEE7C5Tff"
ESCROW = "9oZgd4eviozqaYu7KwCTctAYgsRTWtF3McJARaztPsRQ"
WINNER = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
COLLECTION = "CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac"
BLOCKHASH = "11111111111111111111111111111111"


def _core_ix(out):
    tx = Transaction.from_bytes(base64.b64decode(out))
    keys = tx.message.account_keys
    core = Pubkey.from_string(MPL_CORE_PROGRAM)
    ix = next(i for i in tx.message.instructions if keys[i.program_id_index] == core)
    return tx, keys, ix


def test_build_core_transfer_with_collection():
    tx, keys, ix = _core_ix(build_core_transfer(ESCROW, WINNER, ASSET, BLOCKHASH, collection=COLLECTION))
    assert keys[0] == Pubkey.from_string(ESCROW)            # fee payer
    assert bytes(ix.data) == bytes([14, 0])                 # TransferV1, compression_proof None
    assert len(ix.accounts) == 7
    a = [str(keys[i]) for i in ix.accounts]
    assert a == [ASSET, COLLECTION, ESCROW, ESCROW, WINNER, str(SYS_PROGRAM), MPL_CORE_PROGRAM]


def test_build_core_transfer_no_collection_uses_program_id():
    tx, keys, ix = _core_ix(build_core_transfer(ESCROW, WINNER, ASSET, BLOCKHASH, collection=None))
    assert len(ix.accounts) == 7
    a = [str(keys[i]) for i in ix.accounts]
    assert a[1] == MPL_CORE_PROGRAM                         # None → CoRE program id


def test_read_core_collection_variant2_returns_pubkey():
    data = bytes([1]) + bytes(32) + bytes([2]) + bytes(Pubkey.from_string(COLLECTION))
    assert str(read_core_collection(data)) == COLLECTION


def test_read_core_collection_variant1_or_0_returns_none():
    assert read_core_collection(bytes([1]) + bytes(32) + bytes([1]) + bytes(32)) is None
    assert read_core_collection(bytes([1]) + bytes(32) + bytes([0])) is None


def test_read_core_collection_truncated_returns_none():
    assert read_core_collection(b"\x01" + b"\x00" * 10) is None


# ── nft_in_owner con Metaplex Core ────────────────────────────────────────────
# Un Core NO tiene token account: el dueño vive dentro del propio asset. Preguntando solo por
# token accounts, un Core es invisible por mucho que se sondee — el settle esperaba en balde y
# daba la carta por no entregable, dejándola atrapada en el escrow aunque estuviera justo ahí.

import base64 as _b64
import json as _json
import pytest
import respx
from httpx import Response
from app.services.nft_transfer import nft_in_owner, read_core_owner

RPC = "https://rpc.test"


def _core_asset_data(owner: str) -> str:
    """AssetV1 mínimo: key(1) + owner(32) + update_authority=None(0)."""
    return _b64.b64encode(bytes([1]) + bytes(Pubkey.from_string(owner)) + bytes([0])).decode()


def test_read_core_owner_lee_el_dueno_del_asset():
    raw = _b64.b64decode(_core_asset_data(ESCROW))
    assert str(read_core_owner(raw)) == ESCROW


def test_read_core_owner_con_buffer_truncado_devuelve_none():
    assert read_core_owner(b"\x01\x02") is None


@respx.mock
@pytest.mark.anyio
async def test_core_en_el_escrow_se_detecta():
    def handler(request):
        body = _json.loads(request.content)
        assert body["method"] == "getAccountInfo"      # con Core NO se pregunta por token accounts
        return Response(200, json={"result": {"value": {
            "owner": MPL_CORE_PROGRAM, "data": [_core_asset_data(ESCROW), "base64"]}}})
    respx.post(RPC).mock(side_effect=handler)
    assert await nft_in_owner(RPC, ESCROW, ASSET) is True


@respx.mock
@pytest.mark.anyio
async def test_core_de_otro_dueno_no_se_confunde():
    def handler(request):
        return Response(200, json={"result": {"value": {
            "owner": MPL_CORE_PROGRAM, "data": [_core_asset_data(WINNER), "base64"]}}})
    respx.post(RPC).mock(side_effect=handler)
    assert await nft_in_owner(RPC, ESCROW, ASSET) is False


@respx.mock
@pytest.mark.anyio
async def test_spl_sigue_usando_token_accounts():
    """El camino clásico no cambia: se resuelve por token accounts como siempre."""
    seen = []
    def handler(request):
        m = _json.loads(request.content)["method"]
        seen.append(m)
        if m == "getAccountInfo":
            return Response(200, json={"result": {"value": {
                "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "data": ["", "base64"]}}})
        return Response(200, json={"result": {"value": [
            {"account": {"data": {"parsed": {"info": {"tokenAmount": {"uiAmountString": "1"}}}}}}]}})
    respx.post(RPC).mock(side_effect=handler)
    assert await nft_in_owner(RPC, ESCROW, ASSET) is True
    assert "getTokenAccountsByOwner" in seen


@respx.mock
@pytest.mark.anyio
async def test_cuenta_inexistente_no_esta_en_el_escrow():
    """Sin cuenta y sin que DAS lo conozca: el mint no existe y punto."""
    def handler(request):
        m = _json.loads(request.content)["method"]
        if m == "getAsset":
            return Response(200, json={"error": {"code": -32601, "message": "not supported"}})
        return Response(200, json={"result": {"value": None}})
    respx.post(RPC).mock(side_effect=handler)
    assert await nft_in_owner(RPC, ESCROW, ASSET) is False


# ── nft_in_owner con cNFT comprimidos ─────────────────────────────────────────
# Un cNFT es peor que un Core: no tiene NI cuenta propia, es una hoja de un árbol de Merkle. Ni
# getAccountInfo ni las token accounts lo ven, así que sin DAS es indistinguible de un mint que no
# existe. Medido en devnet: 28 cartas se reportaban "fuera del escrow" siendo el escrow su dueño.

def _sin_cuenta_pero_das(owner: Optional[str]):
    """Handler RPC: la cuenta no existe; DAS conoce el asset y dice quién es su dueño."""
    def handler(request):
        m = _json.loads(request.content)["method"]
        if m == "getAsset":
            if owner is None:
                return Response(200, json={"error": {"code": -32601, "message": "not supported"}})
            return Response(200, json={"result": {"compression": {"compressed": True},
                                                  "ownership": {"owner": owner}}})
        return Response(200, json={"result": {"value": None}})
    return handler


@respx.mock
@pytest.mark.anyio
async def test_cnft_en_el_escrow_se_detecta_por_das():
    respx.post(RPC).mock(side_effect=_sin_cuenta_pero_das(ESCROW))
    assert await nft_in_owner(RPC, ESCROW, ASSET) is True


@respx.mock
@pytest.mark.anyio
async def test_cnft_de_otro_dueno_no_se_confunde():
    respx.post(RPC).mock(side_effect=_sin_cuenta_pero_das(WINNER))
    assert await nft_in_owner(RPC, ESCROW, ASSET) is False


@respx.mock
@pytest.mark.anyio
async def test_sin_das_el_comportamiento_es_el_de_antes():
    """Un RPC que no habla DAS no debe romper nada: responde False, como hacía siempre."""
    respx.post(RPC).mock(side_effect=_sin_cuenta_pero_das(None))
    assert await nft_in_owner(RPC, ESCROW, ASSET) is False
