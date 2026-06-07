import time
from typing import Callable, Optional
from fastapi import FastAPI, HTTPException, Query
from nacl.signing import SigningKey

from .attestation import sign_attestation, build_message
from .keys import load_or_create_signing_key, pubkey_base58
from .pricing.base import PricingSource, ValueUnavailable
from .pricing.mock import MockPricingSource
from .pricing.collector_crypt import CollectorCryptSource
from .config import get_settings


def create_app(signing_key: SigningKey, pricing: PricingSource,
               now_fn: Callable[[], int] = lambda: int(time.time())) -> FastAPI:
    app = FastAPI(title="Battle Arena — Oráculo de pricing")
    oracle_b58 = pubkey_base58(signing_key)

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/pubkey")
    async def pubkey():
        return {"oracle_pubkey": oracle_b58}

    @app.get("/attest")
    async def attest(mint: str = Query(..., min_length=1, max_length=44)):
        try:
            card = await pricing.get_value(mint)
        except ValueUnavailable as e:
            raise HTTPException(status_code=409, detail=str(e))
        ts = now_fn()
        try:
            signed = sign_attestation(signing_key, mint, card["value_usd"], card["grade"], ts)
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
    return create_app(key, pricing)


app = build_default_app()
