import based58
from tests.conftest import MINT_HAPPY, MINT_NOVALUE


def test_health(client):
    c, _ = client
    r = c.get("/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_pubkey(client):
    c, key = client
    r = c.get("/pubkey")
    assert r.status_code == 200
    assert r.json()["oracle_pubkey"] == based58.b58encode(bytes(key.verify_key)).decode()


def test_attest_happy(client):
    c, key = client
    r = c.get("/attest", params={"mint": MINT_HAPPY})
    assert r.status_code == 200
    body = r.json()
    assert body["value_usd"] == 1200 and body["grade"] == 9 and body["ts"] == 1700000000
    # la firma verifica
    key.verify_key.verify(bytes.fromhex(body["message_hex"]), bytes.fromhex(body["signature_hex"]))


def test_attest_unavailable(client):
    c, _ = client
    r = c.get("/attest", params={"mint": MINT_NOVALUE})
    assert r.status_code == 409
