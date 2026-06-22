# Royale state in get_battle + PF /verify (#4a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the Battle Royale live state + a Provably-Fair verification endpoint the frontend needs, without leaking NFTs before settle.

**Architecture:** Enrich `pack_lobby.get_battle` (players→objects with elimination/accumulated state, per-round audit, creator, and a post-settle-only pull recap) and add `GET /pack-battles/{id}/verify` returning the commit-reveal proof (per-round for royale). Pure DB reads.

**Tech Stack:** Python 3.9, FastAPI, SQLAlchemy, pytest. Run from `backend/` with `PYTHONPATH=. .venv/bin/pytest`.

## Global Constraints

- **Secrecy:** `get_battle` exposes NO NFT/card data while `status != "settled"`. The pull recap (`pulls`) appears ONLY post-settle. `server_seed` is revealed ONLY post-settle (existing rule).
- Royale live state is the round/elimination structure + `accumulated_value` (a score), never the cards.
- `/verify` is public (no auth) — it is audit data; the seed is only revealed post-settle.
- Per-round royale draw is verifiable as `pick_index(server_seed, round.client_seed, n_tied) == round.tie_break_index`.

---

### Task 1: Enrich `get_battle`

**Files:**
- Modify: `backend/app/services/pack_lobby.py` (helpers + `get_battle`)
- Test: `backend/tests/test_pack_lobby.py`

**Interfaces:**
- Consumes: `PackBattle.creator_wallet`, `BattlePlayer.eliminated_round/accumulated_value`, `BattleRound`, `BattlePull` (all existing).
- Produces: `get_battle(session, battle_id)` returns `players` as `[{wallet, eliminated_round, accumulated_value}]`, plus `rounds: [{round_number, eliminated_wallet, tie_break_index}]`, `creator_wallet`, and (post-settle only) `pulls: [{round_number, player_wallet, nft_address, rarity, insured_value, auto_sold}]`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_pack_lobby.py`:

```python
def test_get_battle_royale_live_state_no_cards(session):
    from app.models import PackBattle, BattlePlayer, BattleRound
    b = PackBattle(id="rv", mode="royale", machine_code="m", price=50, max_players=3,
                   status="running", server_seed="ab" * 32, server_seed_hash="h", creator_wallet="A")
    session.add(b)
    session.add_all([
        BattlePlayer(battle_id="rv", player_wallet="A", eliminated_round=None, accumulated_value=120.0),
        BattlePlayer(battle_id="rv", player_wallet="B", eliminated_round=1, accumulated_value=40.0),
    ])
    session.add(BattleRound(battle_id="rv", round_number=1, client_seed="cs1",
                            eliminated_wallet="B", tie_break_index=None))
    session.commit()
    v = get_battle(session, "rv")
    assert v["creator_wallet"] == "A"
    pa = next(p for p in v["players"] if p["wallet"] == "A")
    pb = next(p for p in v["players"] if p["wallet"] == "B")
    assert pa["eliminated_round"] is None and pa["accumulated_value"] == 120.0
    assert pb["eliminated_round"] == 1
    assert v["rounds"] == [{"round_number": 1, "eliminated_wallet": "B", "tie_break_index": None}]
    assert "pulls" not in v and "server_seed" not in v   # running → no recap, no reveal


def test_get_battle_postsettle_pull_recap(session):
    from app.models import PackBattle, BattlePull
    b = PackBattle(id="st", mode="pack", machine_code="m", price=50, max_players=2,
                   status="settled", winner="A", server_seed="ab" * 32, server_seed_hash="h",
                   client_seed="cs", tie_break_index=None, creator_wallet="A")
    session.add(b)
    session.add(BattlePull(battle_id="st", player_wallet="A", memo="m1", round_number=1,
                           nft_address="nftA", rarity="Epic", insured_value=500.0, auto_sold=False))
    session.commit()
    v = get_battle(session, "st")
    assert v["server_seed"] == "ab" * 32                 # revealed post-settle
    assert v["pulls"] == [{"round_number": 1, "player_wallet": "A", "nft_address": "nftA",
                           "rarity": "Epic", "insured_value": 500.0, "auto_sold": False}]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_pack_lobby.py::test_get_battle_royale_live_state_no_cards -v`
Expected: FAIL (KeyError on `creator_wallet`/`rounds`, or `players` items are strings not dicts).

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/pack_lobby.py`, ensure the models import includes the new ones:

```python
from app.models import PackBattle, BattlePlayer, BattleRound, BattlePull
```

Replace the `_players` helper with three view helpers, and rewrite `get_battle`:

```python
def _player_states(session, battle_id):
    return [{"wallet": p.player_wallet, "eliminated_round": p.eliminated_round,
             "accumulated_value": p.accumulated_value}
            for p in session.query(BattlePlayer).filter_by(battle_id=battle_id)
            .order_by(BattlePlayer.joined_at).all()]


def _rounds(session, battle_id):
    return [{"round_number": r.round_number, "eliminated_wallet": r.eliminated_wallet,
             "tie_break_index": r.tie_break_index}
            for r in session.query(BattleRound).filter_by(battle_id=battle_id)
            .order_by(BattleRound.round_number).all()]


def _pull_recap(session, battle_id):
    return [{"round_number": p.round_number, "player_wallet": p.player_wallet,
             "nft_address": p.nft_address, "rarity": p.rarity,
             "insured_value": p.insured_value, "auto_sold": p.auto_sold}
            for p in session.query(BattlePull).filter_by(battle_id=battle_id)
            .order_by(BattlePull.round_number, BattlePull.id).all()]


def get_battle(session, battle_id):
    b = session.get(PackBattle, battle_id)
    if b is None:
        raise LobbyError("no existe")
    out = {"id": b.id, "mode": b.mode, "machine_code": b.machine_code, "price": b.price,
           "max_players": b.max_players, "status": b.status, "winner": b.winner,
           "creator_wallet": b.creator_wallet,
           "players": _player_states(session, battle_id),
           "rounds": _rounds(session, battle_id),
           "server_seed_hash": b.server_seed_hash}
    if b.status == "settled":   # reveal + recap only after settle (secrecy)
        out.update(server_seed=b.server_seed, client_seed=b.client_seed,
                   tie_break_index=b.tie_break_index, pulls=_pull_recap(session, battle_id))
    return out
```

(Delete the old `_players` helper — it is now unused. Leave `verification` for Task 2.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_pack_lobby.py -v`
Expected: PASS (new tests + the existing `test_get_battle_hides_server_seed_until_settled`, which only checks `server_seed_hash` present + `server_seed` absent — still holds).

- [ ] **Step 5: Run full suite + commit**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest -q`
Expected: all green.

```bash
git add backend/app/services/pack_lobby.py backend/tests/test_pack_lobby.py
git commit -m "feat(lobby): enrich get_battle with royale state + post-settle pull recap"
```

---

### Task 2: `verification(session, battle)` + `GET /pack-battles/{id}/verify`

**Files:**
- Modify: `backend/app/services/pack_lobby.py` (`verification`), `backend/app/main.py` (new endpoint + import)
- Test: `backend/tests/test_pack_lobby.py`, `backend/tests/test_pack_lobby_api.py`

**Interfaces:**
- Consumes: `verify_commit` (already imported in pack_lobby), `BattleRound`.
- Produces: `verification(session, battle) -> dict` (commit-reveal proof; per-round for royale); endpoint `GET /pack-battles/{battle_id}/verify`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_pack_lobby.py`:

```python
def test_verification_royale_rounds_and_reveal_gate(session):
    from app.models import PackBattle, BattleRound
    from app.services.pack_lobby import verification
    from app.services.provably_fair import gen_server_seed
    seed, h = gen_server_seed()
    b = PackBattle(id="vr", mode="royale", machine_code="m", price=50, max_players=3,
                   status="running", server_seed=seed, server_seed_hash=h)
    session.add(b)
    session.add(BattleRound(battle_id="vr", round_number=1, client_seed="cs1",
                            eliminated_wallet="B", tie_break_index=2))
    session.commit()
    v = verification(session, b)
    assert v["mode"] == "royale" and v["server_seed_hash"] == h
    assert v["server_seed"] is None and v["commit_ok"] is None     # not settled → seed hidden
    assert v["rounds"] == [{"round_number": 1, "client_seed": "cs1",
                            "eliminated_wallet": "B", "tie_break_index": 2}]
    b.status = "settled"; session.commit()
    v2 = verification(session, b)
    assert v2["server_seed"] == seed and v2["commit_ok"] is True    # post-settle → revealed + verified


def test_verification_pack_tiebreak(session):
    from app.models import PackBattle
    from app.services.pack_lobby import verification
    from app.services.provably_fair import gen_server_seed
    seed, h = gen_server_seed()
    b = PackBattle(id="vp", mode="pack", machine_code="m", price=50, max_players=2,
                   status="settled", server_seed=seed, server_seed_hash=h,
                   client_seed="cs", tie_break_index=1)
    session.add(b); session.commit()
    v = verification(session, b)
    assert v["mode"] == "pack" and v["client_seed"] == "cs" and v["tie_break_index"] == 1
    assert v["commit_ok"] is True
```

Append to `backend/tests/test_pack_lobby_api.py`:

```python
def test_verify_endpoint_pre_settle_and_404(client_priv, monkeypatch):
    c, priv = client_priv

    async def _high(*args, **kwargs):
        return 100_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())

    assert c.get("/pack-battles/does-not-exist/verify").status_code == 404

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    bid = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs).json()["id"]
    r = c.get(f"/pack-battles/{bid}/verify")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["server_seed_hash"] and body["server_seed"] is None   # pre-settle
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_pack_lobby.py::test_verification_royale_rounds_and_reveal_gate -v`
Expected: FAIL (`verification` takes one arg / has no `mode`/`rounds`; or `/verify` 404 route missing).

- [ ] **Step 3: Write minimal implementation**

In `backend/app/services/pack_lobby.py`, replace `verification`:

```python
def verification(session, battle):
    """Commit-reveal proof. server_seed/commit_ok revealed only post-settle. Per-round for royale."""
    settled = battle.status == "settled"
    out = {
        "mode": battle.mode,
        "server_seed_hash": battle.server_seed_hash,
        "server_seed": battle.server_seed if settled else None,
        "commit_ok": (verify_commit(battle.server_seed, battle.server_seed_hash)
                      if settled and battle.server_seed else None),
    }
    if battle.mode == "royale":
        out["rounds"] = [{"round_number": r.round_number, "client_seed": r.client_seed,
                          "eliminated_wallet": r.eliminated_wallet, "tie_break_index": r.tie_break_index}
                         for r in session.query(BattleRound).filter_by(battle_id=battle.id)
                         .order_by(BattleRound.round_number).all()]
    else:
        out["client_seed"] = battle.client_seed
        out["tie_break_index"] = battle.tie_break_index
    return out
```

In `backend/app/main.py`, add `verification` to the `pack_lobby` import (alongside `get_battle`, `cancel_battle`, etc.), then add the endpoint after `get_pack_battle`:

```python
    @app.get("/pack-battles/{battle_id}/verify")
    async def verify_pack_battle(battle_id: str, s: Session = Depends(db)):
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        return verification(s, b)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_pack_lobby.py tests/test_pack_lobby_api.py -v`
Expected: PASS.

- [ ] **Step 5: Run full suite + commit**

Run: `cd backend && PYTHONPATH=. .venv/bin/pytest -q`
Expected: all green.

```bash
git add backend/app/services/pack_lobby.py backend/app/main.py backend/tests/test_pack_lobby.py backend/tests/test_pack_lobby_api.py
git commit -m "feat(api): PF /verify endpoint (per-round for royale) + verification(session, battle)"
```

---

## Self-Review

**1. Spec coverage:**
- `get_battle` enriched (players→objects, rounds, creator_wallet, post-settle pulls; secrecy) → Task 1. ✓
- `verification(session, battle)` + `GET /verify` (per-round royale, reveal-gated) → Task 2. ✓
- 404 on missing battle → Task 2 (endpoint guard + test). ✓
- Secrecy (no pulls/seed pre-settle) → Task 1 (gated on `status == "settled"`) + tests. ✓

**2. Placeholder scan:** No TBD/TODO; complete code in every step; tests assert real shapes (royale players/rounds, post-settle recap, reveal gate, commit_ok, 404).

**3. Type consistency:** `get_battle` keys and `verification(session, battle)` signature match the spec and the Task 2 endpoint call (`verification(s, b)`); `_player_states`/`_rounds`/`_pull_recap` used only inside `get_battle`. The `verification` signature change is safe — it has no existing callers.

## No-goals
Frontend (#4b/#4c/#4d); exposing NFTs pre-settle; auth on `/verify`; engine/PF-algorithm changes.
