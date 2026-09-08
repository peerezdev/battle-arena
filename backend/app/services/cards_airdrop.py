"""Claim del airdrop $CARDS de Collector Crypt, que es un Metaplex Gumdrop.

Las piezas puras van separadas de todo lo que habla con la red porque son las únicas que
se pueden probar de verdad: el hashing del árbol se contrasta contra una entrada real de
mainnet sin abrir un socket.
"""
from __future__ import annotations

import struct

from Crypto.Hash import keccak
from solders.pubkey import Pubkey

GUMDROP_PROGRAM = Pubkey.from_string("gdrpGjVffourzkdDRrQmySw4aTHr8a3xmQzzxSwFD1a")


def _keccak256(data: bytes) -> bytes:
    h = keccak.new(digest_bits=256)
    h.update(data)
    return h.digest()


def hoja(index: int, claimant: str, mint: str, amount: int) -> bytes:
    """La hoja del árbol: index_le8 || claimant(32) || mint(32) || amount_le8.

    El orden y el endianness no son negociables: es lo que hashea el programa on-chain
    para comprobar el proof, así que cualquier variación lo invalida.
    """
    return (
        struct.pack("<Q", index)
        + bytes(Pubkey.from_string(claimant))
        + bytes(Pubkey.from_string(mint))
        + struct.pack("<Q", amount)
    )


def verificar_proof(hoja_bytes: bytes, proof: list[bytes], root: bytes) -> bool:
    """Rehace el camino de la hoja hasta la raíz y compara.

    Gumdrop prefija 0x00 a las hojas y 0x01 a los nodos internos (para que una hoja no
    pueda hacerse pasar por un nodo), y ordena los dos hijos byte a byte antes de
    juntarlos, así que el proof no necesita decir si cada hermano va a izquierda o derecha.
    """
    h = _keccak256(b"\x00" + hoja_bytes)
    for hermano in proof:
        izq, der = sorted([h, hermano])
        h = _keccak256(b"\x01" + izq + der)
    return h == root


def claim_status_pda(index: int, distributor: str) -> tuple[Pubkey, int]:
    """Que esta cuenta exista es la ÚNICA señal fiable de "ya reclamado".

    El saldo de la wallet no vale: los tokens se pueden haber vendido y seguiría siendo
    cierto que ya se reclamaron. Y nuestra propia tabla tampoco, porque alguien puede
    haber reclamado en la web de CC sin pasar por aquí.
    """
    return Pubkey.find_program_address(
        [b"ClaimStatus", struct.pack("<Q", index), bytes(Pubkey.from_string(distributor))],
        GUMDROP_PROGRAM,
    )
