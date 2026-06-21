"""Commit-reveal Provably-Fair primitives (pure). server_seed committed as sha256 hash at battle
creation; the tie-break draw is HMAC(server_seed, client_seed) where client_seed derives from the
public pulls. Reveal server_seed at settle → anyone recomputes + verifies."""
from __future__ import annotations
import hashlib
import hmac
import os


def gen_server_seed() -> tuple[str, str]:
    seed = os.urandom(32).hex()
    return seed, seed_hash(seed)


def seed_hash(server_seed: str) -> str:
    return hashlib.sha256(server_seed.encode()).hexdigest()


def verify_commit(server_seed: str, server_seed_hash: str) -> bool:
    return seed_hash(server_seed) == server_seed_hash


def client_seed_from_nfts(nft_addresses: list[str]) -> str:
    return hashlib.sha256(":".join(sorted(nft_addresses)).encode()).hexdigest()


def pick_index(server_seed: str, client_seed: str, n: int) -> int:
    digest = hmac.new(server_seed.encode(), client_seed.encode(), hashlib.sha256).digest()
    return int.from_bytes(digest[:8], "big") % n


def client_seed_round(round_number: int, nft_addresses: list[str]) -> str:
    return hashlib.sha256((f"{round_number}:" + ":".join(sorted(nft_addresses))).encode()).hexdigest()
