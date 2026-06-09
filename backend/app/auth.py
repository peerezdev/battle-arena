from __future__ import annotations

import secrets
import time
from typing import Callable, Optional
import based58
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError

NONCE_TTL = 300  # seconds a nonce stays valid


class AuthError(Exception):
    pass


def auth_message(nonce: str) -> str:
    return f"BattleArena auth: {nonce}"


class AuthService:
    def __init__(self, nonce_fn: Callable[[], str] = lambda: secrets.token_urlsafe(16),
                 token_fn: Callable[[], str] = lambda: secrets.token_urlsafe(24),
                 now_fn: Callable[[], float] = time.time, ttl: int = 3600,
                 nonce_ttl: int = NONCE_TTL) -> None:
        self._nonce_fn = nonce_fn
        self._token_fn = token_fn
        self._now = now_fn
        self._ttl = ttl
        self._nonce_ttl = nonce_ttl
        self._nonces: dict[str, tuple[str, float]] = {}       # wallet -> (nonce, issued_at)
        self._tokens: dict[str, tuple[str, float]] = {}       # token -> (wallet, expiry)

    def issue_nonce(self, wallet: str) -> str:
        now = self._now()
        existing = self._nonces.get(wallet)
        if existing is not None:
            nonce, issued_at = existing
            if now - issued_at < self._nonce_ttl:
                return nonce  # still fresh — return the same nonce
        # mint a new nonce (either first time or stale)
        nonce = self._nonce_fn()
        self._nonces[wallet] = (nonce, now)
        return nonce

    def verify(self, wallet: str, signature_hex: str) -> str:
        # prune expired tokens on every verify to cap store growth
        now = self._now()
        expired_tokens = [t for t, (_, exp) in self._tokens.items() if now > exp]
        for t in expired_tokens:
            del self._tokens[t]

        entry = self._nonces.get(wallet)
        if entry is None:
            raise AuthError("sin nonce para esta wallet")
        nonce, issued_at = entry
        if now - issued_at >= self._nonce_ttl:
            del self._nonces[wallet]
            raise AuthError("nonce caducado")
        try:
            vk = VerifyKey(based58.b58decode(wallet.encode()))
            vk.verify(auth_message(nonce).encode(), bytes.fromhex(signature_hex))
        except (BadSignatureError, ValueError) as e:
            raise AuthError(f"firma inválida: {e}")
        del self._nonces[wallet]  # un solo uso
        token = self._token_fn()
        self._tokens[token] = (wallet, now + self._ttl)
        return token

    def wallet_for_token(self, token: str) -> Optional[str]:
        entry = self._tokens.get(token)
        if entry is None:
            return None
        wallet, expiry = entry
        if self._now() > expiry:
            del self._tokens[token]
            return None
        return wallet

    def revoke(self, token: str) -> None:
        self._tokens.pop(token, None)
