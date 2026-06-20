"""Verificación del access token de Privy (JWT ES256) vía su JWKS.

La clave pública se resuelve por `kid` desde el JWKS de Privy, con un resolver
inyectable para tests (sin red).
"""
from __future__ import annotations

import json
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

    def _embedded_solana_account(self, token: str) -> dict:
        """Verifica el token y devuelve el dict de la embedded Solana wallet de Privy,
        o lanza PrivyAuthError si no existe."""
        claims = self.verify(token)
        raw = claims.get("linked_accounts")
        try:
            accounts = json.loads(raw) if isinstance(raw, str) else (raw or [])
        except (TypeError, ValueError):
            raise PrivyAuthError("linked_accounts ilegible")
        for acc in accounts:
            # La embedded wallet de Privy se identifica por wallet_client_type == "privy".
            # OJO: en el identity token real, connector_type viene None (no "embedded"),
            # así que NO se puede discriminar por connector_type. Una wallet externa
            # (Phantom, Solflare…) trae wallet_client_type == "Phantom"/"Solflare"/… y
            # nunca "privy", por lo que queda excluida. Mantenemos connector_type ==
            # "embedded" como fallback por compatibilidad. Debe coincidir con el selector
            # del frontend en src/wallet/embedded.ts.
            if (acc.get("type") == "wallet" and acc.get("chain_type") == "solana"
                    and (acc.get("wallet_client_type") == "privy"
                         or acc.get("connector_type") == "embedded")
                    and acc.get("address")):
                return acc
        raise PrivyAuthError("sin embedded Solana wallet")

    def embedded_solana_wallet(self, token: str) -> str:
        return self._embedded_solana_account(token)["address"]

    def embedded_solana_wallet_id(self, token: str) -> str:
        """Devuelve el `id` (wallet id) de la embedded Solana wallet de Privy.
        El wallet id es el valor que necesita la RPC de wallets de Privy para firmar.
        Si la cuenta no trae `id` (shape antiguo), lanza PrivyAuthError para que el
        llamador pueda hacer fallback a la API de usuarios de Privy."""
        acc = self._embedded_solana_account(token)
        wallet_id = acc.get("id")
        if not wallet_id:
            raise PrivyAuthError("embedded Solana wallet sin id (token antiguo)")
        return wallet_id
