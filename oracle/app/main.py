import time
from collections import defaultdict
from typing import Callable, Optional
import based58
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from nacl.signing import SigningKey

from .attestation import sign_attestation, build_message
from .keys import load_or_create_signing_key, pubkey_base58
from .pricing.base import PricingSource, ValueUnavailable
from .pricing.mock import MockPricingSource
from .pricing.collector_crypt import CollectorCryptSource
from .config import get_settings


def _validate_pubkey(value: str, field_name: str = "mint") -> None:
    """Raises HTTPException(422) if value is not a valid 32-byte base58 pubkey."""
    try:
        decoded = based58.b58decode(value.encode())
    except Exception:
        raise HTTPException(status_code=422, detail=f"{field_name} inválido (no es base58): {value}")
    if len(decoded) != 32:
        raise HTTPException(status_code=422, detail=f"{field_name} debe decodificar a 32 bytes, got {len(decoded)}: {value}")


def _validate_mint(mint: str) -> None:
    """Raises HTTPException(422) if mint is not a valid 32-byte base58 pubkey."""
    _validate_pubkey(mint, "mint")


class _RateLimiter:
    """Fixed-window rate limiter keyed by IP. No-op when limit <= 0."""

    def __init__(self, max_per_min: int):
        self._limit = max_per_min
        self._windows: dict[str, tuple[float, int]] = {}

    def check(self, ip: str) -> None:
        if self._limit <= 0:
            return
        now = time.time()
        window_start, count = self._windows.get(ip, (now, 0))
        if now - window_start >= 60:
            window_start, count = now, 0
        count += 1
        self._windows[ip] = (window_start, count)
        # Prune old windows to avoid unbounded growth (keep only last 10k IPs)
        if len(self._windows) > 10_000:
            cutoff = now - 60
            self._windows = {k: v for k, v in self._windows.items() if v[0] >= cutoff}
        if count > self._limit:
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")


def create_app(signing_key: SigningKey, pricing: PricingSource,
               now_fn: Callable[[], int] = lambda: int(time.time()),
               rate_limit_per_min: int = 30,
               cors_origins: Optional[list] = None) -> FastAPI:
    app = FastAPI(title="Battle Arena — Oráculo de pricing")
    oracle_b58 = pubkey_base58(signing_key)
    limiter = _RateLimiter(rate_limit_per_min)

    if cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cors_origins,
            allow_methods=["GET"],
            allow_headers=["*"],
        )

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/pubkey")
    async def pubkey():
        return {"oracle_pubkey": oracle_b58}

    @app.get("/attest")
    async def attest(
        request: Request,
        mint: str = Query(..., min_length=1, max_length=44),
        battle: str = Query(..., min_length=1, max_length=44),
    ):
        limiter.check(request.client.host if request.client else "unknown")
        _validate_mint(mint)
        _validate_pubkey(battle, "battle")
        try:
            card = await pricing.get_value(mint)
        except ValueUnavailable as e:
            raise HTTPException(status_code=409, detail=str(e))
        ts = now_fn()
        try:
            signed = sign_attestation(signing_key, mint, card["value_usd"], card["grade"], ts, battle)
        except (ValueError, OverflowError) as e:
            raise HTTPException(status_code=422, detail=str(e))
        return {
            "mint": mint, "value_usd": card["value_usd"], "grade": card["grade"],
            "grading_company": card["grading_company"], "ts": ts,
            "message_hex": signed["message_hex"], "signature_hex": signed["signature_hex"],
            "oracle_pubkey": oracle_b58,
        }

    return app


def build_default_app() -> FastAPI:
    """Entrypoint de producción/dev: arma la app desde settings de entorno."""
    s = get_settings()
    key = load_or_create_signing_key(s.oracle_key_path)
    pricing: PricingSource = (
        CollectorCryptSource(s.cc_base_url, s.pricing_cache_ttl)
        if s.pricing_source == "collectorcrypt"
        else MockPricingSource()
    )
    return create_app(key, pricing,
                      rate_limit_per_min=s.rate_limit_per_min,
                      cors_origins=s.cors_origins)


app = build_default_app()
