"""Verificación del access token de Privy (JWT ES256) vía su JWKS.

La clave pública se resuelve por `kid` desde el JWKS de Privy, con un resolver
inyectable para tests (sin red).
"""
from __future__ import annotations

from typing import Any, Callable, Optional

import httpx
import jwt
from jwt.algorithms import ECAlgorithm


class PrivyAuthError(Exception):
    pass


KeyResolver = Callable[[str], Any]


class PrivyVerifier:
    def __init__(self, app_id: str, jwks_url: Optional[str] = None,
                 key_resolver: Optional[KeyResolver] = None):
        self._app_id = app_id
        self._jwks_url = jwks_url
        self._resolver = key_resolver or self._jwks_resolver
        self._jwks_cache: dict[str, Any] = {}

    def _jwks_resolver(self, kid: str) -> Any:
        if not self._jwks_url:
            raise PrivyAuthError("sin jwks_url ni key_resolver")
        if kid not in self._jwks_cache:
            try:
                resp = httpx.get(self._jwks_url, timeout=10.0)
                resp.raise_for_status()
                for jwk in resp.json().get("keys", []):
                    if jwk.get("kid"):
                        self._jwks_cache[jwk["kid"]] = ECAlgorithm.from_jwk(jwk)
            except (httpx.HTTPError, ValueError, KeyError) as e:
                raise PrivyAuthError(f"no se pudo cargar JWKS: {type(e).__name__}")
        key = self._jwks_cache.get(kid)
        if key is None:
            raise PrivyAuthError("kid desconocido")
        return key

    def verify(self, token: str) -> dict:
        try:
            kid = jwt.get_unverified_header(token).get("kid", "")
            public_key = self._resolver(kid)
            return jwt.decode(token, public_key, algorithms=["ES256"],
                              audience=self._app_id, issuer="privy.io")
        except PrivyAuthError:
            raise
        except jwt.PyJWTError as e:
            raise PrivyAuthError(f"token inválido: {type(e).__name__}")
