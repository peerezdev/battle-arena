from __future__ import annotations

import secrets
import time
from typing import Callable, Optional
import based58
from nacl.signing import VerifyKey
from nacl.exceptions import BadSignatureError


class AuthError(Exception):
    pass


def auth_message(nonce: str) -> str:
    return f"BattleArena auth: {nonce}"


class AuthService:
    def __init__(self, nonce_fn: Callable[[], str] = lambda: secrets.token_urlsafe(16),
                 token_fn: Callable[[], str] = lambda: secrets.token_urlsafe(24),
                 now_fn: Callable[[], float] = time.time, ttl: int = 3600) -> None:
        self._nonce_fn = nonce_fn
        self._token_fn = token_fn
        self._now = now_fn
        self._ttl = ttl
        self._nonces: dict[str, str] = {}            # wallet -> nonce
        self._tokens: dict[str, tuple[str, float]] = {}  # token -> (wallet, expiry)

    def issue_nonce(self, wallet: str) -> str:
        nonce = self._nonce_fn()
        self._nonces[wallet] = nonce
        return nonce

    def verify(self, wallet: str, signature_hex: str) -> str:
        nonce = self._nonces.get(wallet)
        if nonce is None:
            raise AuthError("sin nonce para esta wallet")
        try:
            vk = VerifyKey(based58.b58decode(wallet.encode()))
            vk.verify(auth_message(nonce).encode(), bytes.fromhex(signature_hex))
        except (BadSignatureError, ValueError) as e:
            raise AuthError(f"firma inválida: {e}")
        del self._nonces[wallet]  # un solo uso
        token = self._token_fn()
        self._tokens[token] = (wallet, self._now() + self._ttl)
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
