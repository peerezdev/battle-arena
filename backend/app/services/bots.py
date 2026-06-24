"""Reserve test bots: quorum-owned Privy wallets used to fill battles for testing.

Loaded from backend/.test_players.json (gitignored manifest of {id, address}). The backend
can sign for these wallets (the quorum owns them), so they can join battles and have their
pulls signed without a Privy login — a dev/test tool, not a production feature.
"""
from __future__ import annotations

import json
import os
import random
from typing import Optional

_MANIFEST = os.path.join(os.path.dirname(__file__), "..", "..", ".test_players.json")


def load_bots() -> list[dict]:
    """Return the reserve bot wallets [{id, address}, ...]; empty if no manifest."""
    try:
        with open(_MANIFEST) as f:
            data = json.load(f)
        return [b for b in data if b.get("address") and b.get("id")]
    except (OSError, ValueError):
        return []


def eligible_bots(bots: list[dict], in_battle: set[str], balances: dict[str, int], min_units: int) -> list[dict]:
    """Bots not already in the battle whose on-chain USDC (balances[address]) covers the buy-in."""
    return [b for b in bots if b["address"] not in in_battle and balances.get(b["address"], 0) >= min_units]


def pick_bot(bots: list[dict], in_battle: set[str], balances: dict[str, int], min_units: int,
             *, rng: random.Random | None = None) -> Optional[dict]:
    """Pick a random eligible bot (free + funded), or None if none qualify."""
    elig = eligible_bots(bots, in_battle, balances, min_units)
    if not elig:
        return None
    return (rng or random).choice(elig)
