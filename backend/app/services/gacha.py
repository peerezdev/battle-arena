"""Proxy fino hacia la API del Gacha de Collector Crypt.

La x-api-key vive SOLO aquí (server-side). Las respuestas upstream nunca se
reenvían crudas: cada método devuelve un dict con whitelist de campos.
"""
from __future__ import annotations

import time
from typing import Any, Callable, Optional

import httpx


class GachaDisabled(Exception):
    """Gacha deshabilitado: no hay gacha_base_url configurado (kill-switch)."""


class GachaUpstreamError(Exception):
    """La API del Gacha falló (4xx/5xx/timeout/JSON inválido)."""


_MACHINE_FIELDS = ("code", "name", "price", "odds", "stock", "ev", "image")
_CACHE_TTL = 60.0


class GachaService:
    def __init__(self, base_url: str, api_key: str,
                 now_fn: Callable[[], float] = time.time, timeout: float = 15.0):
        self._base = base_url.rstrip("/")
        self._key = api_key
        self._now = now_fn
        self._timeout = timeout
        self._machines_cache: Optional[tuple[float, list[dict]]] = None

    @property
    def enabled(self) -> bool:
        return bool(self._base)

    def _check_enabled(self) -> None:
        if not self.enabled:
            raise GachaDisabled()

    async def _request(self, method: str, path: str, json: Optional[dict] = None) -> Any:
        self._check_enabled()
        url = f"{self._base}{path}"
        headers = {"accept": "application/json"}
        if self._key:
            headers["x-api-key"] = self._key
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                resp = await client.request(method, url, json=json, headers=headers)
                resp.raise_for_status()
                return resp.json()
            except (httpx.HTTPError, ValueError) as e:
                # Nunca propagar el cuerpo upstream: solo la clase de error.
                raise GachaUpstreamError(f"gacha upstream: {type(e).__name__}")

    async def machines(self) -> list[dict]:
        self._check_enabled()
        now = self._now()
        if self._machines_cache and now - self._machines_cache[0] < _CACHE_TTL:
            return self._machines_cache[1]
        raw = await self._request("GET", "/api/machines")
        items = raw if isinstance(raw, list) else []
        out = [{k: m.get(k) for k in _MACHINE_FIELDS} for m in items if isinstance(m, dict)]
        self._machines_cache = (now, out)
        return out

    async def generate_pack(self, player_address: str, pack_type: str) -> dict:
        raw = await self._request("POST", "/api/generatePack",
                                  json={"playerAddress": player_address, "packType": pack_type})
        return {"memo": raw.get("memo"), "transaction": raw.get("transaction")}

    async def submit_tx(self, signed_transaction: str) -> dict:
        raw = await self._request("POST", "/api/submitTransaction",
                                  json={"signedTransaction": signed_transaction})
        return {"signature": raw.get("signature"),
                "confirmation_status": raw.get("confirmationStatus")}

    async def open_pack(self, memo: str) -> dict:
        raw = await self._request("POST", "/api/openPack", json={"memo": memo})
        if raw.get("code") == "WAITING_FOR_WEBHOOK":
            return {"pending": True}
        if not raw.get("nft_address"):
            raise GachaUpstreamError("gacha upstream: respuesta openPack sin nft_address")
        nft_won = raw.get("nftWon") or {}
        metadata = ((nft_won.get("content") or {}).get("metadata") or {})
        return {
            "pending": False,
            "nft_address": raw.get("nft_address"),
            "rarity": raw.get("rarity"),
            "name": metadata.get("name"),
            "image": nft_won.get("image"),
        }
