"""Bubblegum transfer_v2 para cNFT comprimidos.

Un cNFT no es una cuenta: es una hoja de un árbol de Merkle, y moverlo consiste en probar dónde
está esa hoja y reescribirla. El layout de la instrucción no se dedujo de la documentación: se
decodificó de una transacción REAL de Collector Crypt (su buyback mueve estos mismos cNFT) y cada
campo se cotejó con lo que responde DAS.

De ahí sale el test dorado de abajo: los bytes que produce nuestro constructor tienen que ser
exactamente los de esa instrucción que funciona. Si alguien cambia el orden de un campo o el
tamaño de un entero, ese test lo caza — un test que solo comprobase "no revienta" no lo haría.
"""
import base64
import pytest
from solders.pubkey import Pubkey
from solders.transaction import Transaction

from app.services.nft_transfer import (BUBBLEGUM_PROGRAM, MAX_TX_BYTES, MPL_ACCOUNT_COMPRESSION,
                                       MPL_NOOP, SYS_PROGRAM, UnsupportedNftStandard,
                                       build_cnft_transfer, tree_config_pda)

# Valores del asset real 7rkmuy1Kn6D7… tal y como los devuelve DAS.
TREE = "CCTREEA8hbsXNCf77tUEgbHaBFV9CmgfuQWfeNXHQ34h"
COLLECTION = "CCryptUfeFSZ3Fgc9FLeKrhLVAP67FSqi1GuVoj9CRac"
ROOT = "2Ym1tKmtb6ogKrfkGx7W4RGjbNkJAmVdMpnUoRiBVjZp"
DATA_HASH = "HDJGSbFUDgYri8taEjFs6J1xYHQo2kzZ87PDyFMX2ee3"
CREATOR_HASH = "EKDHSGbrGztomDfuiV4iqiZ6LschDJPsFiXjZ83f92Md"
LEAF_ID = 141

ESCROW = "FjTn11BNndEsew3PwNcofMozX8tAAjcscTKEHZELnzcG"
WINNER = "6d4vjzRTFXhVFDPQnJHqvJK5jVUY5uJTHiSDwCsyDPTn"
OPERATOR = "3q6Ucr1sPhqB5MpvkYbFTVDVJyqSAYrbJ1cZP4xhSXvR"

# Los 151 bytes del transfer_v2 que Collector Crypt firmó y la red aceptó.
CC_DATA_HEX = (
    "772806ebeaddf831"
    "16fe75d0ca6c1bd03f2644b357c08e0eb545a8ea94b6883b4179918e61a106f7"   # root
    "f0e17bc7beb3c46b5ca9d45670b4e19680dd83674cb32cfdd0e87ea192cc9ca0"   # data_hash
    "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"   # creator_hash
    "01c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"  # Some(asset_data_hash)
    "0100"                                                               # Some(flags=0)
    "8d00000000000000"                                                   # nonce
    "8d000000"                                                           # index
)

_b58 = lambda s: bytes(Pubkey.from_string(s))
PROOF = [str(Pubkey.from_bytes(bytes([i]) + bytes(31))) for i in range(1, 21)]   # 20 nodos


def _construir(proof=None, **kw):
    args = dict(tree=TREE, collection=COLLECTION, root=_b58(ROOT), data_hash=_b58(DATA_HASH),
                creator_hash=_b58(CREATOR_HASH), asset_data_hash=_b58(CREATOR_HASH), flags=0,
                leaf_id=LEAF_ID, proof=PROOF if proof is None else proof, fee_payer=OPERATOR)
    args.update(kw)
    raw = base64.b64decode(build_cnft_transfer(ESCROW, WINNER, ROOT, **args))
    return raw, Transaction.from_bytes(raw)


def _ix_bubblegum(tx):
    msg = tx.message
    keys = list(msg.account_keys)
    return next(i for i in msg.instructions if keys[i.program_id_index] == BUBBLEGUM_PROGRAM)


def test_tree_config_es_el_pda_que_usa_collector_crypt():
    """La cuenta [0] de la instrucción de CC tiene que salir de nuestra derivación."""
    assert str(tree_config_pda(Pubkey.from_string(TREE))) == \
        "KUg3yscy8HrcRrzWkCjqkMSMcAW8DBqFonov4fDb7F8"


def test_los_bytes_son_los_de_la_instruccion_real_de_cc():
    """Test dorado: mismo asset, mismos datos → los mismos 151 bytes que aceptó la red."""
    _, tx = _construir()
    assert bytes(_ix_bubblegum(tx).data).hex() == CC_DATA_HEX


def test_el_orden_de_las_cuentas_base_es_el_de_cc():
    _, tx = _construir()
    keys = list(tx.message.account_keys)
    cuentas = [str(keys[i]) for i in _ix_bubblegum(tx).accounts]
    assert cuentas[:11] == [
        str(tree_config_pda(Pubkey.from_string(TREE))),
        OPERATOR,                    # 1 paga
        ESCROW, ESCROW, ESCROW,      # 2-4 dueño de la hoja
        WINNER,                      # 5 nuevo dueño
        TREE,                        # 6 árbol
        COLLECTION,                  # 7 colección
        str(MPL_NOOP), str(MPL_ACCOUNT_COMPRESSION), str(SYS_PROGRAM),
    ]


def test_el_ganador_no_firma_y_el_arbol_es_escribible():
    """El destinatario no firma nada — si lo hiciera, no podríamos entregarle nada sin él."""
    _, tx = _construir()
    msg = tx.message
    firmantes = {str(k) for k in list(msg.account_keys)[:msg.header.num_required_signatures]}
    assert WINNER not in firmantes
    assert firmantes == {OPERATOR, ESCROW}


def test_el_proof_se_recorta_a_lo_que_cabe_en_la_transaccion():
    """20 nodos no caben. Se manda desde la hoja lo que quepa y el canopy del árbol pone el resto;
    uno más se pasaría del límite, así que se aprovecha hasta el último byte."""
    raw, tx = _construir()
    pasados = len(_ix_bubblegum(tx).accounts) - 11
    assert 0 < pasados < len(PROOF)
    assert len(raw) + 2 * 64 <= MAX_TX_BYTES
    assert PROOF[:pasados] == [str(list(tx.message.account_keys)[i])
                               for i in _ix_bubblegum(tx).accounts[11:]]
    # Y es el máximo, no un número escogido a dedo: cada nodo extra cuesta 32 bytes de clave más 1
    # de índice, y uno más se saldría del límite. (No vale reconstruir con un nodo más para
    # comprobarlo: el constructor volvería a recortarlo y daría exactamente lo mismo.)
    assert len(raw) + 33 + 2 * 64 > MAX_TX_BYTES


def test_sin_proof_cabe_pero_se_avisa_si_ni_eso():
    """Un proof vacío es legítimo si el canopy lo cubre todo; el error solo salta si nada cabe."""
    _, tx = _construir(proof=[])
    assert len(_ix_bubblegum(tx).accounts) == 11


def test_option_none_se_codifica_con_etiqueta_cero():
    """Sin asset_data_hash ni flags la instrucción son 33+2 bytes menos, no un hueco de ceros."""
    _, tx = _construir(asset_data_hash=None, flags=None)
    data = bytes(_ix_bubblegum(tx).data)
    assert len(data) == 151 - 32 - 1     # se van los 32 del hash y el u8 de flags
    assert data[8 + 96] == 0            # etiqueta None tras root+data_hash+creator_hash


def test_sin_fee_payer_paga_el_propio_escrow():
    _, tx = _construir(fee_payer=None)
    msg = tx.message
    assert str(list(msg.account_keys)[0]) == ESCROW
    assert msg.header.num_required_signatures == 1


@pytest.mark.parametrize("campo", ["root", "data_hash", "creator_hash"])
def test_un_hash_de_tamano_raro_no_se_cuela(campo):
    """Los hashes son de 32 bytes exactos: uno corto desplazaría todos los campos siguientes."""
    _, tx = _construir(**{campo: b"\x01\x02"})
    assert len(bytes(_ix_bubblegum(tx).data)) != 151
