import base64, json
import pytest, respx
from httpx import Response
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
from app.services.privy_signer import (PrivySigner, PrivySignerError, PrivyNoVerificable,
                                       authorization_signature)

def _p256_pem():
    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption()).decode(), key.public_key()

def test_authorization_signature_is_verifiable_p256():
    pem, pub = _p256_pem()
    body = {"method": "signAndSendTransaction", "caip2": "solana:dev", "params": {"transaction": "AA", "encoding": "base64"}}
    sig = authorization_signature("POST", "https://api.privy.io/v1/wallets/w1/rpc", body, "app123", pem)
    # canonical payload must match what we signed
    payload = {"version": 1, "method": "POST", "url": "https://api.privy.io/v1/wallets/w1/rpc",
               "body": body, "headers": {"privy-app-id": "app123"}}
    msg = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    pub.verify(base64.b64decode(sig), msg, ec.ECDSA(hashes.SHA256()))  # raises if invalid

@respx.mock
@pytest.mark.asyncio
async def test_sign_and_send_builds_request_and_returns_hash():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(
        return_value=Response(200, json={"data": {"hash": "SIG123", "caip2": "solana:dev"}}))
    s = PrivySigner(app_id="app123", app_secret="sek", auth_key_pem=pem, cluster_caip2="solana:dev")
    out = await s.sign_and_send_solana("w1", "BASE64TX")
    assert out == "SIG123"
    req = route.calls.last.request
    assert req.headers["privy-app-id"] == "app123"
    assert req.headers["authorization"].startswith("Basic ")
    assert "privy-authorization-signature" in req.headers
    sent = json.loads(req.content)
    assert sent["method"] == "signAndSendTransaction"
    assert sent["caip2"] == "solana:dev"
    assert sent["params"] == {"transaction": "BASE64TX", "encoding": "base64"}

@respx.mock
@pytest.mark.asyncio
async def test_sign_and_send_raises_on_error():
    pem, _ = _p256_pem()
    respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(return_value=Response(400, json={"error": "bad"}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev")
    with pytest.raises(PrivySignerError):
        await s.sign_and_send_solana("w1", "TX")

def test_disabled_without_auth_key():
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem="", cluster_caip2="solana:dev")
    assert s.enabled is False

@pytest.mark.asyncio
async def test_create_solana_wallet_raises_when_disabled():
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem="", cluster_caip2="solana:dev")
    with pytest.raises(PrivySignerError, match="privy signer disabled"):
        await s.create_solana_wallet()

@respx.mock
@pytest.mark.asyncio
async def test_sign_and_send_sponsor_flag():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(
        return_value=Response(200, json={"data": {"hash": "H"}}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev")
    await s.sign_and_send_solana("w1", "TX", sponsor=True)
    assert json.loads(route.calls.last.request.content)["sponsor"] is True

@respx.mock
@pytest.mark.asyncio
async def test_create_solana_wallet():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets").mock(
        return_value=Response(200, json={"id": "wid", "address": "ADDR", "chain_type": "solana"}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev",
                    quorum_id="kq1")
    out = await s.create_solana_wallet()
    assert out == {"id": "wid", "address": "ADDR"}
    sent = json.loads(route.calls.last.request.content)
    assert sent["chain_type"] == "solana" and sent["owner_id"] == "kq1"

@respx.mock
@pytest.mark.asyncio
async def test_sign_solana_returns_signed_tx():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(
        return_value=Response(200, json={"data": {"signed_transaction": "SIGNED"}}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev")
    out = await s.sign_solana("w1", "TX")
    assert out == "SIGNED"
    sent = json.loads(route.calls.last.request.content)
    assert sent["method"] == "signTransaction"
    assert "caip2" not in sent

@pytest.mark.asyncio
async def test_sign_solana_disabled_raises():
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem="", cluster_caip2="solana:dev")
    with pytest.raises(PrivySignerError, match="privy signer disabled"):
        await s.sign_solana("w1", "TX")

@respx.mock
@pytest.mark.asyncio
async def test_sign_solana_returns_signed_tx_camelcase():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(
        return_value=Response(200, json={"data": {"signedTransaction": "SIGNED_CAMEL"}}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev")
    out = await s.sign_solana("w1", "TX")
    assert out == "SIGNED_CAMEL"


# ── podemos_firmar: la puerta de delegación ───────────────────────────────────────────────────
#
# La forma real de la respuesta está tomada de una wallet de verdad: el dueño es un key quorum con
# el usuario dentro, y nuestro quorum aparece en `additional_signers`.

QUORUM = "q9782k24n3445yoqmzwbgapg"


def _signer(**kw):
    pem, _ = _p256_pem()
    return PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem,
                       cluster_caip2="solana:dev", quorum_id=QUORUM, **kw)


def _ficha(owner="quorum-del-usuario", firmantes=()):
    return {"id": "w1", "address": "So1ana", "chain_type": "solana", "owner_id": owner,
            "policy_ids": [], "additional_signers": [{"signer_id": f} for f in firmantes]}


@respx.mock
@pytest.mark.asyncio
async def test_podemos_firmar_si_estamos_entre_los_firmantes():
    respx.get("https://api.privy.io/v1/wallets/w1").mock(
        return_value=Response(200, json=_ficha(firmantes=[QUORUM])))
    assert await _signer().podemos_firmar("w1") is True


@respx.mock
@pytest.mark.asyncio
async def test_no_podemos_firmar_si_no_nos_ha_delegado():
    # El caso que tumbó una Pack Battle de 250 $ en mainnet.
    respx.get("https://api.privy.io/v1/wallets/w1").mock(
        return_value=Response(200, json=_ficha(firmantes=["quorum-de-otra-app"])))
    assert await _signer().podemos_firmar("w1") is False


@respx.mock
@pytest.mark.asyncio
async def test_podemos_firmar_si_la_wallet_es_nuestra():
    # Los escrows los creamos nosotros con owner_id = nuestro quorum, sin firmantes añadidos.
    respx.get("https://api.privy.io/v1/wallets/w1").mock(
        return_value=Response(200, json=_ficha(owner=QUORUM)))
    assert await _signer().podemos_firmar("w1") is True


@respx.mock
@pytest.mark.asyncio
async def test_la_lectura_no_lleva_firma_de_autorizacion():
    """Mandar `privy-authorization-signature` en este GET hace que Privy conteste 403/1010.

    Esa cabecera es para el `/rpc`, que USA la wallet, y va calculada sobre método+url+cuerpo.
    """
    ruta = respx.get("https://api.privy.io/v1/wallets/w1").mock(
        return_value=Response(200, json=_ficha(firmantes=[QUORUM])))
    await _signer().podemos_firmar("w1")
    enviadas = ruta.calls.last.request.headers
    assert "privy-authorization-signature" not in enviadas
    assert enviadas["privy-app-id"] == "a"
    assert enviadas["authorization"].startswith("Basic ")


@respx.mock
@pytest.mark.asyncio
async def test_privy_caido_no_es_un_no():
    """No saber y saber que no son cosas distintas: quien llama tiene que poder distinguirlas."""
    respx.get("https://api.privy.io/v1/wallets/w1").mock(return_value=Response(503, json={}))
    with pytest.raises(PrivyNoVerificable):
        await _signer().podemos_firmar("w1")


@pytest.mark.asyncio
async def test_sin_quorum_configurado_no_se_deja_pasar_a_nadie():
    # Sin quorum este servidor no puede firmar por nadie; decir "sí" sería mandarlos a una partida
    # que se va a caer igual.
    pem, _ = _p256_pem()
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev")
    with pytest.raises(PrivyNoVerificable):
        await s.podemos_firmar("w1")


@respx.mock
@pytest.mark.asyncio
async def test_el_si_se_cachea_y_el_no_no():
    """Asimetría deliberada: guardar el "no" castigaría al que acaba de delegar y reintenta."""
    ruta = respx.get("https://api.privy.io/v1/wallets/w1").mock(
        return_value=Response(200, json=_ficha(firmantes=["otro"])))
    s = _signer(ttl_verificacion=999)
    assert await s.podemos_firmar("w1") is False
    assert await s.podemos_firmar("w1") is False
    assert ruta.call_count == 2                    # el "no" vuelve a preguntar SIEMPRE

    # Delega y reintenta: se entera al momento, sin esperar a que expire nada.
    ruta.mock(return_value=Response(200, json=_ficha(firmantes=[QUORUM])))
    assert await s.podemos_firmar("w1") is True
    assert await s.podemos_firmar("w1") is True
    assert ruta.call_count == 3                    # el "sí" ya no pregunta


@respx.mock
@pytest.mark.asyncio
async def test_el_si_cacheado_caduca():
    ruta = respx.get("https://api.privy.io/v1/wallets/w1").mock(
        return_value=Response(200, json=_ficha(firmantes=[QUORUM])))
    s = _signer(ttl_verificacion=0)                # sin ventana: revocar se nota al instante
    assert await s.podemos_firmar("w1") is True
    assert await s.podemos_firmar("w1") is True
    assert ruta.call_count == 2
