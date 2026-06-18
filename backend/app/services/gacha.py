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


_MACHINE_FIELDS = ("code", "name", "price", "odds", "stock", "ev", "image",
                   "shortName", "thumbnailUrl", "instantBuyback", "contains",
                   "videoSrc", "videoHevc")
_NFT_FIELDS = ("nft_address", "name", "image", "rarity", "insured_value")
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

    def _absolutize(self, url: Any) -> Any:
        if isinstance(url, str) and url.startswith("/"):
            return f"{self._base}{url}"
        return url

    def _check_enabled(self) -> None:
        if not self.enabled:
            raise GachaDisabled()

    async def _request(self, method: str, path: str, json: Optional[dict] = None,
                       params: Optional[dict] = None) -> Any:
        self._check_enabled()
        url = f"{self._base}{path}"
        headers = {"accept": "application/json"}
        if self._key:
            headers["x-api-key"] = self._key
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                resp = await client.request(method, url, json=json, params=params, headers=headers)
                resp.raise_for_status()
                return resp.json()
            except httpx.HTTPStatusError as e:
                reason = None
                try:
                    body = e.response.json()
                    if isinstance(body, dict):
                        reason = body.get("details") or body.get("error")
                except Exception:
                    reason = None
                raise GachaUpstreamError(str(reason)[:140] if reason else "gacha upstream no disponible")
            except (httpx.HTTPError, ValueError) as e:
                raise GachaUpstreamError("gacha upstream no disponible")

    async def _availability(self) -> dict:
        """code -> available (status == 'open') from /api/status. Fail-open: {} on error."""
        try:
            raw = await self._request("GET", "/api/status")
        except GachaUpstreamError:
            return {}
        gachas = raw.get("gachas") if isinstance(raw, dict) else None
        avail = {}
        if isinstance(gachas, list):
            for g in gachas:
                if isinstance(g, dict) and g.get("code"):
                    avail[g["code"]] = (g.get("status") == "open")
        return avail

    async def machines(self) -> list[dict]:
        self._check_enabled()
        now = self._now()
        if self._machines_cache and now - self._machines_cache[0] < _CACHE_TTL:
            return self._machines_cache[1]
        raw = await self._request("GET", "/api/machines")
        if isinstance(raw, dict):
            items = raw.get("machines", [])
        elif isinstance(raw, list):
            items = raw
        else:
            items = []
        out = [{k: m.get(k) for k in _MACHINE_FIELDS} for m in items if isinstance(m, dict)]
        for mach in out:
            for f in ("image", "thumbnailUrl", "videoSrc", "videoHevc"):
                mach[f] = self._absolutize(mach.get(f))
        avail = await self._availability()
        for mach in out:
            mach["available"] = avail.get(mach.get("code"), True)  # default available if unknown
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

    async def buyback_available(self, wallet: str, nft: str) -> dict:
        raw = await self._request("GET", "/api/buyback/available",
                                  params={"wallet": wallet, "nft": nft})
        available = bool(raw.get("available")) if isinstance(raw, dict) else False
        amount = raw.get("amount") if (isinstance(raw, dict) and available) else None
        return {"available": available, "amount": amount}

    async def buyback(self, player_address: str, nft_address: str) -> dict:
        raw = await self._request("POST", "/api/buyback",
                                  json={"playerAddress": player_address, "nftAddress": nft_address})
        return {
            "serialized_transaction": raw.get("serializedTransaction"),
            "refund_amount": raw.get("refundAmount"),
            "memo": raw.get("memo"),
        }

    async def open_pack(self, memo: str) -> dict:
        raw = await self._request("POST", "/api/openPack", json={"memo": memo})
        if raw.get("code") == "WAITING_FOR_WEBHOOK":
            return {"pending": True}
        if not raw.get("nft_address"):
            raise GachaUpstreamError("gacha upstream: respuesta openPack sin nft_address")
        nft_won = raw.get("nftWon") or {}
        content = nft_won.get("content") or {}
        metadata = content.get("metadata") or {}
        attributes = nft_won.get("attributes") or metadata.get("attributes") or []
        attr = {t.get("trait_type"): t.get("value") for t in attributes if isinstance(t, dict)}
        name = metadata.get("name") or nft_won.get("name")

        # images: prefer content.files (cc_cdn > cdn_uri > uri); fallback to the single image
        images = self._extract_images(content, nft_won.get("image"))

        # insured value: top-level number, else the "Insured Value" attribute
        insured = nft_won.get("insured_value")
        if insured is None:
            iv = attr.get("Insured Value")
            if isinstance(iv, (int, float)):
                insured = iv
            elif isinstance(iv, str):
                try:
                    insured = float(iv.replace(",", "").strip())
                except ValueError:
                    pass

        authed = attr.get("Authenticated")
        authenticated = (str(authed).strip().lower() == "true") if authed is not None else None

        return {
            "pending": False,
            "nft_address": raw.get("nft_address"),
            "rarity": raw.get("rarity"),
            "name": name,
            "image": images[0] if images else nft_won.get("image"),
            "images": images,
            "year": self._extract_year(attributes, name),
            "grade": self._extract_grade(attributes),
            "grading_company": attr.get("Grading Company"),
            "grading_id": attr.get("Grading ID"),
            "authenticated": authenticated,
            "insured_value": insured,
        }

    @staticmethod
    def _extract_images(content: dict, fallback: Optional[str]) -> list:
        images: list = []
        for f in (content.get("files") or []):
            if isinstance(f, dict):
                u = f.get("cc_cdn") or f.get("cdn_uri") or f.get("uri")
                if u and u not in images:
                    images.append(u)
        if not images and fallback:
            images = [fallback]
        return images

    @staticmethod
    def _extract_grade(attributes: list) -> Optional[str]:
        a = {t.get("trait_type"): t.get("value") for t in attributes if isinstance(t, dict)}
        company = (a.get("Grading Company") or "").strip()
        label = str(a.get("The Grade") or a.get("GradeNum") or "").strip()
        grade = f"{company} {label}".strip()
        return grade or None

    @staticmethod
    def _extract_year(attributes: list, name: Optional[str] = None) -> Optional[str]:
        a = {t.get("trait_type"): t.get("value") for t in attributes if isinstance(t, dict)}
        year = a.get("Year")
        if year:
            return str(year)
        if name:
            import re
            m = re.match(r"\s*(\d{4})\b", name)
            if m:
                return m.group(1)
        return None

    async def get_nfts(self, code: str, rarity: Optional[str] = None,
                       page: int = 1, limit: int = 20) -> list:
        self._check_enabled()
        params: dict = {"code": code, "page": page, "limit": limit}
        if rarity:
            params["rarity"] = rarity
        raw = await self._request("GET", "/api/getNfts", params=params)
        if isinstance(raw, dict):
            items = raw.get("nfts", [])
        elif isinstance(raw, list):
            items = raw
        else:
            items = []
        out = []
        for n in items:
            if not isinstance(n, dict):
                continue
            attributes = n.get("attributes") or []
            a = {t.get("trait_type"): t.get("value") for t in attributes if isinstance(t, dict)}
            authed = a.get("Authenticated")
            gradenum = a.get("GradeNum")
            card = {k: n.get(k) for k in _NFT_FIELDS}
            card["grade"] = self._extract_grade(attributes)
            card["images"] = self._extract_images(n.get("content") or {}, n.get("image"))
            card["grading_company"] = a.get("Grading Company")
            card["grading_id"] = a.get("Grading ID")
            card["the_grade"] = a.get("The Grade")
            card["generic_grade"] = str(gradenum) if gradenum is not None else None
            card["authenticated"] = (str(authed).strip().lower() == "true") if authed is not None else None
            card["year"] = self._extract_year(attributes, n.get("name"))
            out.append(card)
        return out
