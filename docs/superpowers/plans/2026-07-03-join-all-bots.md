# Join All Bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Join All Bots" button to the battle waiting room that fills every empty seat with funded reserve bots in one click (DEV/TEST only).

**Architecture:** Extract the existing single-bot join logic into a reusable `_add_one_bot` helper; add a `join-all-bots` endpoint that loops it until the lobby fills or no eligible bot remains. Front end adds a `joinAllBots` client call and a button in `BattleFlow.tsx` (the shared pack+royale lobby).

**Tech Stack:** FastAPI + SQLAlchemy (backend), React + TypeScript + Vite (frontend), pytest + vitest.

## Global Constraints

- `POST /pack-battles/{id}/join-all-bots` MUST be gated on `dev_endpoints_enabled` and return 404 when disabled — identical to the existing `/join-bot`.
- Best-effort fill: add bots until the lobby is full or no eligible funded bot remains; return 409 ONLY if not a single bot could be added.
- No palette / design-token changes; reuse `COLORS`, `FONTS`, `GRADIENT` from `src/ui/theme`.
- The existing per-slot "+ Join Bot" button and `joinBot` client stay; the refactor must not change their behaviour.
- Both endpoints keep the DEV/TEST security posture: unauthenticated, moves real USDC, dev-gated.

---

### Task 1: Backend — `_add_one_bot` helper + `join-all-bots` endpoint

**Files:**
- Modify: `backend/app/main.py` (refactor the `join_bot_pack_battle` handler at ~855-914; add the new handler after it)
- Test: `backend/tests/test_pack_lobby_api.py` (append tests)

**Interfaces:**
- Consumes (all already in the `create_app` closure): `dev_endpoints_enabled`, `load_bots`, `pick_bot`, `royale_buyin`, `usdc_balance_base_units`, `solana_rpc_url`, `cc_usdc_mint`, `collect_buyin_confirmed`, `join_battle`, `reserve`, `_run_bg`, `_run_royale_bg`, `fetch_latest_blockhash`, `distribute_usdc`, `privy_signer`, `privy_operator_wallet_id`, `privy_operator_address`, `get_battle`, `PackBattle`, `BattlePlayer`, `LobbyError`, `HTTPException`, `logger`.
- Produces: `POST /pack-battles/{battle_id}/join-all-bots` → returns the battle dict (same shape as `join-bot`), and an internal `async def _add_one_bot(s, b) -> Optional[bool]`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_pack_lobby_api.py` (reuses existing helpers `_build_client`, `_auth_headers`, `WALLET_A`, `WALLET_ID_A`; `asyncio` is already imported):

```python
# ── Join All Bots (DEV/TEST) ──────────────────────────────────────────────────

_BOTS_3 = [
    {"id": "bot-1", "address": "So1anaBOT11111111111111111111111111111111"},
    {"id": "bot-2", "address": "So1anaBOT22222222222222222222222222222222"},
    {"id": "bot-3", "address": "So1anaBOT33333333333333333333333333333333"},
]


def _mock_battle_env(monkeypatch, *, bots, run_called):
    async def _high_balance(*args, **kwargs):
        return 100_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    async def _fake_run(session, battle, *, gacha, signer, **kwargs):
        run_called.append(battle.id)

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    monkeypatch.setattr("app.main.run_pack_battle_live", _fake_run)
    monkeypatch.setattr("app.main.load_bots", lambda: bots)


def _create_pack(c, priv, max_players):
    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": max_players}, headers=hdrs)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _tick():
    async def _drain():
        await asyncio.sleep(0)
    asyncio.get_event_loop().run_until_complete(_drain())


def test_join_all_bots_fills_lobby_and_schedules_run(monkeypatch):
    c, priv = _build_client(dev_endpoints_enabled=True)
    run_called: list = []
    _mock_battle_env(monkeypatch, bots=_BOTS_3, run_called=run_called)

    battle_id = _create_pack(c, priv, max_players=4)  # creator = 1 player, 3 empty seats
    r = c.post(f"/pack-battles/{battle_id}/join-all-bots")

    assert r.status_code == 200, r.text
    assert len(r.json()["players"]) == 4  # creator + 3 bots → full
    _tick()
    assert run_called, "run_pack_battle_live was not scheduled after bots filled the lobby"


def test_join_all_bots_409_when_no_eligible_bots(monkeypatch):
    c, priv = _build_client(dev_endpoints_enabled=True)
    _mock_battle_env(monkeypatch, bots=[], run_called=[])  # no bots configured

    battle_id = _create_pack(c, priv, max_players=2)
    r = c.post(f"/pack-battles/{battle_id}/join-all-bots")

    assert r.status_code == 409, r.text


def test_join_all_bots_404_when_dev_disabled(monkeypatch):
    c, priv = _build_client(dev_endpoints_enabled=False)
    _mock_battle_env(monkeypatch, bots=_BOTS_3, run_called=[])

    battle_id = _create_pack(c, priv, max_players=2)
    r = c.post(f"/pack-battles/{battle_id}/join-all-bots")

    assert r.status_code == 404, r.text


def test_join_bot_still_adds_exactly_one(monkeypatch):
    """Regression: the refactored /join-bot adds a single bot without filling a 4-seat lobby."""
    c, priv = _build_client(dev_endpoints_enabled=True)
    _mock_battle_env(monkeypatch, bots=_BOTS_3, run_called=[])

    battle_id = _create_pack(c, priv, max_players=4)
    r = c.post(f"/pack-battles/{battle_id}/join-bot")

    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["players"]) == 2  # creator + exactly one bot
    assert body["status"] == "lobby"  # not full → not started
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_pack_lobby_api.py -k "join_all_bots or join_bot_still" -q`
Expected: FAIL — `test_join_all_bots_*` 404 (endpoint doesn't exist yet). `test_join_bot_still_adds_exactly_one` may pass already (existing endpoint) — that's fine.

- [ ] **Step 3: Refactor `join-bot` into `_add_one_bot` + thin handler**

In `backend/app/main.py`, replace the current `join_bot_pack_battle` handler (the block starting at `@app.post("/pack-battles/{battle_id}/join-bot")`, ~lines 855-914) with the helper + thin handler below. Keep the DEV-only security docstring on both.

```python
    async def _add_one_bot(s: Session, b: PackBattle) -> Optional[bool]:
        """Add one funded reserve bot to lobby `b`.

        Returns the `filled` flag (True if this bot completed the lobby and the
        battle was started) when a bot was added, or None if no eligible funded
        bot is available. Raises HTTPException on on-chain failure (buy-in
        collection) or a late-join race.
        """
        bots = load_bots()
        if not bots:
            return None
        in_battle = {p.player_wallet for p in s.query(BattlePlayer).filter_by(battle_id=b.id).all()}
        buyin = royale_buyin(b.max_players, b.price) if b.mode == "royale" else b.price
        candidates = [bot for bot in bots if bot["address"] not in in_battle]
        balances = {bot["address"]: await usdc_balance_base_units(solana_rpc_url, bot["address"], cc_usdc_mint)
                    for bot in candidates}
        bot = pick_bot(bots, in_battle, balances, buyin)
        if bot is None:
            return None
        bw, bid = bot["address"], bot["id"]
        if b.mode == "royale":
            # Collect the bot's buy-in into the escrow BEFORE joining — single attempt. If the
            # charge fails, the bot is NOT joined and the caller surfaces the error (toast):
            # no silent unfunded joins, no double charge.
            try:
                await collect_buyin_confirmed(bid, bw, b.escrow_address, buyin)
            except Exception as exc:
                raise HTTPException(502, f"No se pudo cobrar el buy-in del bot: {exc}")
            try:
                _b2, filled = join_battle(s, b.id, bw, bid)
            except LobbyError as e:
                # Joined too late — refund the buy-in we just collected so it isn't stuck.
                try:
                    bh2 = await fetch_latest_blockhash(solana_rpc_url)
                    await distribute_usdc(solana_rpc_url, privy_signer, b.escrow_wallet_id,
                                          b.escrow_address, bw, cc_usdc_mint, buyin, bh2,
                                          operator_wallet_id=privy_operator_wallet_id,
                                          operator_address=privy_operator_address)
                except Exception:
                    logger.warning("join-bot refund failed for %s in %s", bw, b.id)
                raise HTTPException(409, str(e))
            if filled:
                asyncio.create_task(_run_royale_bg(b.id))
        else:
            try:
                _b2, filled = join_battle(s, b.id, bw, bid)
            except LobbyError as e:
                raise HTTPException(409, str(e))
            reserve(s, bw, b.id, b.price)
            if filled:
                asyncio.create_task(_run_bg(b.id))
        return filled

    @app.post("/pack-battles/{battle_id}/join-bot")
    async def join_bot_pack_battle(battle_id: str, s: Session = Depends(db)):
        """DEV/TEST: drop a random funded reserve bot into a lobby slot (no auth).

        SECURITY: unauthenticated and moves real USDC on-chain. MUST stay disabled in
        production — 404s unless DEV_ENDPOINTS_ENABLED is set.
        """
        if not dev_endpoints_enabled:
            raise HTTPException(404, "Not Found")
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        if b.status != "lobby":
            raise HTTPException(409, "la batalla no está en lobby")
        filled = await _add_one_bot(s, b)
        if filled is None:
            raise HTTPException(409, "no hay bots libres con saldo suficiente")
        return get_battle(s, battle_id)
```

- [ ] **Step 4: Add the `join-all-bots` handler**

Immediately after the `join_bot_pack_battle` handler, add:

```python
    @app.post("/pack-battles/{battle_id}/join-all-bots")
    async def join_all_bots_pack_battle(battle_id: str, s: Session = Depends(db)):
        """DEV/TEST: fill every empty lobby seat with funded reserve bots.

        Same posture as /join-bot (unauthenticated, moves real USDC, dev-gated).
        Best-effort: adds bots until the lobby fills or no eligible funded bot
        remains; 409 only if it could not add a single bot.
        """
        if not dev_endpoints_enabled:
            raise HTTPException(404, "Not Found")
        b = s.get(PackBattle, battle_id)
        if b is None:
            raise HTTPException(404, "no existe")
        if b.status != "lobby":
            raise HTTPException(409, "la batalla no está en lobby")
        added = 0
        while True:
            filled = await _add_one_bot(s, b)
            if filled is None:   # no eligible funded bot left
                break
            added += 1
            if filled:           # lobby completed → battle started
                break
        if added == 0:
            raise HTTPException(409, "no hay bots libres con saldo suficiente")
        return get_battle(s, battle_id)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && python -m pytest tests/test_pack_lobby_api.py -k "join_all_bots or join_bot_still" -q`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full backend suite (no regressions)**

Run: `cd backend && source .venv/bin/activate && python -m pytest -q`
Expected: PASS (all — was 321 passed before this task).

- [ ] **Step 7: Commit**

```bash
git add backend/app/main.py backend/tests/test_pack_lobby_api.py
git commit -m "feat(bots): join-all-bots endpoint fills a lobby with reserve bots (dev-only)"
```

---

### Task 2: Frontend — `joinAllBots` client + "Join All Bots" button

**Files:**
- Modify: `src/onchain/packBattleClient.ts` (add `joinAllBots`)
- Modify: `src/ui/flows/BattleFlow.tsx` (import, state, handler, button, style)
- Test: `src/onchain/packBattleClient.test.ts` (append one test)

**Interfaces:**
- Consumes: `POST /pack-battles/{id}/join-all-bots` (from Task 1), `battleFetch`, `Battle` (both in `packBattleClient.ts`).
- Produces: `joinAllBots(id: string): Promise<Battle>`.

- [ ] **Step 1: Write the failing client test**

Append inside the existing `describe` block in `src/onchain/packBattleClient.test.ts` (mirrors the `joinBot` test above it; `client`, `mockFetch`, `config` are already imported):

```typescript
  it('joinAllBots POSTs the join-all-bots path with NO auth header', async () => {
    const f = mockFetch({ id: 'b1' }); vi.stubGlobal('fetch', f)
    await client.joinAllBots('b1')
    expect(f.mock.calls[0][0]).toBe(`${config.backendUrl}/pack-battles/b1/join-all-bots`)
    expect(f.mock.calls[0][1].method).toBe('POST')
    expect((f.mock.calls[0][1]?.headers ?? {}).Authorization).toBeUndefined()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/onchain/packBattleClient.test.ts`
Expected: FAIL — `client.joinAllBots is not a function`.

- [ ] **Step 3: Add the `joinAllBots` client function**

In `src/onchain/packBattleClient.ts`, immediately after the existing `joinBot` function:

```typescript
/** DEV/TEST: fill every empty lobby slot with funded reserve bots (no auth). */
export function joinAllBots(id: string): Promise<Battle> {
  return battleFetch<Battle>(`/pack-battles/${encodeURIComponent(id)}/join-all-bots`, { method: 'POST' })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/onchain/packBattleClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the button to the lobby in `BattleFlow.tsx`**

5a. Extend the client import (line 6):

```typescript
import { cancelBattle, joinBot, joinAllBots, joinBattle } from '../../onchain/packBattleClient'
```

5b. Add state next to `joiningBot` (after line 39):

```typescript
  const [joiningAll, setJoiningAll] = useState(false)
```

5c. Add the handler next to `onJoinBot` (after its closing brace, ~line 72):

```typescript
  function onJoinAllBots() {
    if (!battle) return
    setBotError(null)
    setJoiningAll(true)
    joinAllBots(battle.id)
      .catch((e) => {
        const m = e instanceof Error ? e.message : String(e)
        setBotError(m)
        showToast(m)
      })
      .finally(() => setJoiningAll(false))
  }
```

5d. Render the button in the lobby, right after the `{battle.players.length}/{battle.max_players} · {battle.mode.toUpperCase()}` counter `</div>` (after line 93), gated on `spaceAvailable`:

```tsx
        {spaceAvailable && (
          <button onClick={onJoinAllBots} disabled={joiningAll} style={joinAllBotsBtn}>
            {joiningAll ? 'Adding bots…' : 'Join All Bots'}
          </button>
        )}
```

5e. Add the button style next to `joinBotBtn` (after its closing brace, ~line 189):

```typescript
const joinAllBotsBtn: CSSProperties = {
  padding: '10px 22px', borderRadius: 12, border: `1px solid ${COLORS.violet}`,
  background: 'transparent', color: COLORS.violet, fontFamily: FONTS.display,
  fontWeight: 800, fontSize: 13, cursor: 'pointer',
}
```

- [ ] **Step 6: Type-check + build + full frontend suite**

Run: `npm run build && npx vitest run`
Expected: build EXIT 0; all vitest pass (was 274 before this task, +1 new).

- [ ] **Step 7: Commit**

```bash
git add src/onchain/packBattleClient.ts src/onchain/packBattleClient.test.ts src/ui/flows/BattleFlow.tsx
git commit -m "feat(bots): Join All Bots button in the battle waiting room"
```
