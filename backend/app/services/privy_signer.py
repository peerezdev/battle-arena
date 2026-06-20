"""Server-side signing of Solana txs for delegated Privy embedded wallets.

PRIVY_AUTH_KEY (P-256 PEM) lives only in backend/.env. Never log tx bytes/keys/signatures.
"""
from __future__ import annotations
import base64, json
import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec


class PrivySignerError(Exception):
    pass


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
                 quorum_id: str = ""):
        self._app_id = app_id
        self._app_secret = app_secret
        self._auth_key = auth_key_pem
        self._caip2 = cluster_caip2
        self._base = base_url.rstrip("/")
        self._timeout = timeout
        self._quorum_id = quorum_id

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

    async def create_solana_wallet(self) -> dict:
        url = f"{self._base}/v1/wallets"
        body = {"chain_type": "solana", "owner_id": self._quorum_id}
        data = await self._post_rpc_raw(url, body)
        return {"id": data.get("id"), "address": data.get("address")}
