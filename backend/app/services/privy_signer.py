"""Server-side signing of Solana txs for delegated Privy embedded wallets.

PRIVY_AUTH_KEY (P-256 PEM) lives only in backend/.env. Never log tx bytes/keys/signatures.
"""
from __future__ import annotations
import base64, json, time
import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec


class PrivySignerError(Exception):
    pass


class PrivyNoVerificable(PrivySignerError):
    """No se ha podido AVERIGUAR quién puede firmar por la wallet: Privy no contestó.

    Es distinto de "esa wallet no nos tiene como firmante". Una es no saber; la otra es saber que
    no. Quien la reciba tiene que tratarla como un fallo temporal —reintentable— y no como un
    rechazo al jugador, que no ha hecho nada mal.
    """


def authorization_signature(method: str, url: str, body: dict, app_id: str, auth_key_pem: str) -> str:
    payload = {"version": 1, "method": method, "url": url, "body": body,
               "headers": {"privy-app-id": app_id}}
    msg = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    key = serialization.load_pem_private_key(auth_key_pem.encode(), password=None)
    der = key.sign(msg, ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(der).decode()


class PrivySigner:
    def __init__(self, app_id: str, app_secret: str, auth_key_pem: str, cluster_caip2: str,
                 base_url: str = "https://api.privy.io", timeout: float = 15.0,
                 quorum_id: str = "", ttl_verificacion: float = 60.0):
        self._app_id = app_id
        self._app_secret = app_secret
        self._auth_key = auth_key_pem
        self._caip2 = cluster_caip2
        self._base = base_url.rstrip("/")
        self._timeout = timeout
        self._quorum_id = quorum_id
        # wallet_id -> instante (monotónico) hasta el que vale el "sí". Ver `podemos_firmar`.
        self._ttl_verificacion = ttl_verificacion
        self._verificadas: dict = {}

    @property
    def enabled(self) -> bool:
        return bool(self._auth_key and self._app_id and self._app_secret)

    def _build_headers(self, url: str, body: dict) -> dict:
        basic = base64.b64encode(f"{self._app_id}:{self._app_secret}".encode()).decode()
        return {
            "Authorization": f"Basic {basic}",
            "privy-app-id": self._app_id,
            "privy-authorization-signature": authorization_signature("POST", url, body, self._app_id, self._auth_key),
            "Content-Type": "application/json",
        }

    async def _post_rpc_raw(self, url: str, body: dict) -> dict:
        """POST to url with Privy auth headers; returns the full parsed JSON dict."""
        headers = self._build_headers(url, body)
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                resp = await client.post(url, json=body, headers=headers)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as e:
                reason = None
                try:
                    j = e.response.json()
                    reason = j.get("error") or j.get("message")
                except Exception:
                    reason = None
                raise PrivySignerError(str(reason)[:160] if reason else "privy rpc error")
            except (httpx.HTTPError, ValueError):
                raise PrivySignerError("privy rpc unavailable")

    async def _post_rpc(self, url: str, body: dict, key: str) -> dict:
        """POST and return the value at top-level `key` in the response JSON."""
        data = await self._post_rpc_raw(url, body)
        return (data or {}).get(key, {})

    async def sign_and_send_solana(self, wallet_id: str, tx_base64: str, sponsor: bool = False) -> str:
        if not self.enabled:
            raise PrivySignerError("privy signer disabled (PRIVY_AUTH_KEY unset)")
        url = f"{self._base}/v1/wallets/{wallet_id}/rpc"
        body = {"method": "signAndSendTransaction", "caip2": self._caip2,
                "params": {"transaction": tx_base64, "encoding": "base64"}}
        if sponsor:
            body["sponsor"] = True
        data = await self._post_rpc(url, body, key="data")
        h = (data or {}).get("hash")
        if not h:
            raise PrivySignerError("privy rpc: no hash in response")
        return h

    async def sign_solana(self, wallet_id: str, tx_base64: str) -> str:
        if not self.enabled:
            raise PrivySignerError("privy signer disabled (PRIVY_AUTH_KEY unset)")
        url = f"{self._base}/v1/wallets/{wallet_id}/rpc"
        body = {"method": "signTransaction",
                "params": {"transaction": tx_base64, "encoding": "base64"}}
        # NOTE: signTransaction (sign-only) does NOT take a caip2 key — unlike signAndSendTransaction.
        # Privy routes sign-only requests without cluster disambiguation.
        response = await self._post_rpc_raw(url, body)
        data = response.get("data") or {}
        signed = data.get("signed_transaction") or data.get("signedTransaction")
        if not signed:
            raise PrivySignerError("privy rpc: no signed_transaction in response")
        return signed

    async def _wallet(self, wallet_id: str) -> dict:
        """La ficha de una wallet: dueño, firmantes añadidos, políticas.

        OJO CON LAS CABECERAS. Este GET lleva SOLO `Authorization: Basic` y `privy-app-id`. NO
        lleva `privy-authorization-signature`: esa firma es para las llamadas que USAN la wallet
        (el `/rpc`), va calculada sobre método+url+cuerpo, y mandarla aquí hace que Privy conteste
        **403 con código 1010**. Es el error contra el que se estrella todo el que copia el patrón
        de `_build_headers` para leer. Confirmado en su documentación de "Get wallet".
        """
        basic = base64.b64encode(f"{self._app_id}:{self._app_secret}".encode()).decode()
        headers = {"Authorization": f"Basic {basic}", "privy-app-id": self._app_id,
                   "accept": "application/json",
                   # Sin User-Agent, Cloudflare responde 403 a las lecturas de la API de Privy.
                   "user-agent": "battlearena-backend"}
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                resp = await client.get(f"{self._base}/v1/wallets/{wallet_id}", headers=headers)
                resp.raise_for_status()
                return resp.json()
            except (httpx.HTTPError, ValueError) as e:
                raise PrivyNoVerificable(f"privy no respondió: {type(e).__name__}")

    async def podemos_firmar(self, wallet_id: str) -> bool:
        """¿Puede este servidor firmar por esa wallet?

        Las embedded de la app son TEE wallets: para que el servidor firme, el jugador tiene que
        habernos añadido como firmante (session signer). Si no lo ha hecho, cualquier intento de
        firmar responde "No valid authorization keys or user signing keys available".

        Cuenta como sí que nuestro quorum sea el DUEÑO o esté entre los firmantes añadidos. Lo
        primero es el caso de los escrows, que creamos nosotros; lo segundo, el de los jugadores.

        CACHÉ: solo se guarda el SÍ, y solo `ttl_verificacion` segundos. La asimetría es
        deliberada. Guardar el "no" castigaría justo al que acaba de delegar y reintenta: se
        quedaría fuera hasta que expirase, sin entender por qué. Guardar el "sí" solo arriesga que
        una delegación revocada tarde ese rato en notarse, y revocar es rarísimo comparado con
        delegar-y-reintentar.

        Levanta `PrivyNoVerificable` si Privy no contesta: no saber no es lo mismo que un no.
        """
        if not self._quorum_id:
            # Sin quorum configurado este servidor no puede firmar por nadie, así que decir "sí"
            # sería mentir y dejar entrar a todos a una partida que se va a caer igual.
            raise PrivyNoVerificable("PRIVY_QUORUM_ID sin configurar")
        ahora = time.monotonic()
        vence = self._verificadas.get(wallet_id)
        if vence is not None and vence > ahora:
            return True
        w = await self._wallet(wallet_id)
        firmantes = {f.get("signer_id") for f in (w.get("additional_signers") or [])
                     if isinstance(f, dict)}
        vale = w.get("owner_id") == self._quorum_id or self._quorum_id in firmantes
        if vale:
            self._verificadas[wallet_id] = ahora + self._ttl_verificacion
        return vale

    async def create_solana_wallet(self) -> dict:
        if not self.enabled:
            raise PrivySignerError("privy signer disabled (PRIVY_AUTH_KEY unset)")
        url = f"{self._base}/v1/wallets"
        body = {"chain_type": "solana", "owner_id": self._quorum_id}
        data = await self._post_rpc_raw(url, body)
        return {"id": data.get("id"), "address": data.get("address")}
