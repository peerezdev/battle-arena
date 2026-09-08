"""Datos REALES de mainnet, capturados el 2026-09-08.

El test dorado es el primero: si el hashing del árbol se desvía lo más mínimo, deja de
casar con la root que está en la cadena y este test se pone rojo. Sin él, un cambio en
esas 20 líneas no rompe nada visible hasta que un jugador le da al botón y la cadena le
rechaza la transacción.
"""
from solders.pubkey import Pubkey

from app.services.cards_airdrop import claim_status_pda, hoja, verificar_proof

DISTRIBUTOR = "H6k7zSjCn2w5Q4em3b3E7iaPQfLrxVsF6u1bK6kD1Bhq"
MINT = "CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp"
ROOT = bytes.fromhex("edef2b3b6e41e35a7843cd3521490a576651df938ffc40fb3e79c9de146503bd")

WALLET = "8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6"
INDEX = 1687
AMOUNT = 1_483_000_000
PROOF = [
    "9Ad5fSi8QPvs8CimVj8vFwSXJkkZ5fgvnhmefmr6QEKv",
    "AyiMrqFWe4hSPXmxuMqAzVLWExLuCH4LiRBQZnWNdnzM",
    "AS2kiSZyCnX31sYKDMxnxCXcyuhXR1VRvSRLJPHFpYUW",
    "E6xE2sR5PztQDaRZZ3eNBGEiuE48Mk7JegjkWH8x3RmK",
    "6AoBdX8FvPH4cQ1XShbT3oeJCsqCCehtbQx3EFzz7neu",
    "8HbxK8ihpGv2nSQ9fXZ8Wiqogn51YnyTLqDbYVGQKYsh",
    "PrrjJUtKGF5fmTR9Yae6J6QbCKz2SzrvhqEmPVQ2XgZ",
    "4utS1WxK3ox27bMrx5uxrBQnWCX2bwFYTqK8f6doNsg9",
    "GV61PisXTh1C6f9PVWnnX9LJWwGyDcfKmXz69yq6nSsg",
    "Hg1tmDKuGtTZ4sEvZR9YDR3pqmQ9VVg3YmUJHosZ2SG",
    "HV2qmcXHb6cm7eZ1m6faMP79rR132jDJyWjcHSxVZsJ",
    "5ye3ARu1aNukAebBW8jGFLgYktiCR4C4et8ipEuQzaAo",
    "FXyuDoR4Vczd2RUfPCkQT7bviNZwDz1T3k8KWfq77mkm",
]


def proof_bytes() -> list[bytes]:
    return [bytes(Pubkey.from_string(p)) for p in PROOF]


def test_la_hoja_real_valida_contra_la_root_de_mainnet():
    assert verificar_proof(hoja(INDEX, WALLET, MINT, AMOUNT), proof_bytes(), ROOT)


def test_una_cantidad_cambiada_no_valida():
    # Es la mitad que importa: si esto pasara, cualquiera podría pedir lo que quisiera.
    assert not verificar_proof(hoja(INDEX, WALLET, MINT, AMOUNT + 1), proof_bytes(), ROOT)


def test_otra_wallet_con_el_mismo_proof_no_valida():
    otra = "FzRt4Pnh6tBpavXqkwQH1WVByeotDSefyyACKXC5kGHZ"
    assert not verificar_proof(hoja(INDEX, otra, MINT, AMOUNT), proof_bytes(), ROOT)


def test_la_hoja_tiene_la_forma_que_espera_gumdrop():
    b = hoja(INDEX, WALLET, MINT, AMOUNT)
    assert len(b) == 80                                  # 8 + 32 + 32 + 8
    assert b[:8] == INDEX.to_bytes(8, "little")
    assert b[8:40] == bytes(Pubkey.from_string(WALLET))
    assert b[40:72] == bytes(Pubkey.from_string(MINT))
    assert b[72:] == AMOUNT.to_bytes(8, "little")


def test_la_pda_de_claim_status_es_la_de_la_cadena():
    pda, bump = claim_status_pda(INDEX, DISTRIBUTOR)
    assert str(pda) == "E1frLrGw1V1mVN6R7KcTwvBYD87ezWZKrspbs5dWJH6g"
    assert bump == 255


import json

from app.services.cards_airdrop import cargar_asignaciones


def test_carga_el_fichero_de_asignaciones(tmp_path):
    f = tmp_path / "a.json"
    f.write_text(json.dumps({WALLET: {"i": INDEX, "a": AMOUNT, "p": PROOF}}))
    d = cargar_asignaciones(str(f))
    assert d[WALLET]["i"] == INDEX


def test_sin_ruta_devuelve_vacio_en_vez_de_reventar():
    # Es el estado normal en devnet: la función está apagada, no rota.
    assert cargar_asignaciones("") == {}


def test_un_fichero_que_no_existe_devuelve_vacio(tmp_path):
    assert cargar_asignaciones(str(tmp_path / "no-esta.json")) == {}


def test_un_fichero_corrupto_devuelve_vacio(tmp_path):
    # Vacío hace que los endpoints respondan 503. Lo que NO puede pasar es que un
    # fichero ilegible acabe diciéndole a un jugador elegible que no lo es.
    f = tmp_path / "roto.json"
    f.write_text("{esto no es json")
    assert cargar_asignaciones(str(f)) == {}
