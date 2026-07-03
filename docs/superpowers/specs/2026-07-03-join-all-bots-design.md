# Join All Bots — Design Spec

**Date:** 2026-07-03
**Status:** Approved (design)

## Goal

Add a **"Join All Bots"** button to the battle waiting room (shared by Pack
Battle and Battle Royale) that fills every empty seat with funded reserve
bots in one click — a DEV/TEST convenience to start a battle without manually
adding bots one by one.

## Context

- The waiting room lives in `src/ui/flows/BattleFlow.tsx` (route
  `/play/battle/:battleId`) and is shared by both modes — royale battles are
  `PackBattle` rows with `mode == "royale"` and render the same lobby.
- A single-bot mechanism already exists: `POST
  /pack-battles/{battle_id}/join-bot` picks one random funded reserve bot,
  collects its buy-in on-chain (royale) or reserves it (pack), joins it, and
  starts the battle's background runner when the lobby fills.
- That endpoint is **DEV/TEST only**: gated on `dev_endpoints_enabled`
  (404 when off), unauthenticated, and moves real USDC. It MUST stay disabled
  in production.
- The frontend "+ Join Bot" button (per empty slot, `BattleFlow.tsx:125`)
  calls `packBattleClient.joinBot(id)` and is rendered unconditionally
  (no frontend dev-gate).

## Global Constraints

- `POST /pack-battles/{id}/join-all-bots` MUST be gated on
  `dev_endpoints_enabled` and 404 when disabled — identical to `join-bot`.
- Do NOT change production behaviour: with dev endpoints off, the endpoint
  404s and the button is a no-op that surfaces the error toast (same as the
  existing `+ Join Bot`).
- No palette / design-token changes; reuse existing theme tokens and button
  styling idioms from `BattleFlow.tsx`.
- Card value source is unchanged (bots' buy-in mechanics are untouched — we
  only loop the existing single-bot flow).

## Backend

### Refactor: extract `_add_one_bot`

Extract the body of the current `join_bot_pack_battle` handler into a helper
defined in the same `create_app` closure (so it keeps access to
`load_bots`, `pick_bot`, `usdc_balance_base_units`, `collect_buyin_confirmed`,
`join_battle`, `reserve`, `_run_bg`, `_run_royale_bg`, `royale_buyin`,
signer/RPC/mint vars):

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
        try:
            await collect_buyin_confirmed(bid, bw, b.escrow_address, buyin)
        except Exception as exc:
            raise HTTPException(502, f"No se pudo cobrar el buy-in del bot: {exc}")
        try:
            _b2, filled = join_battle(s, b.id, bw, bid)
        except LobbyError as e:
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
```

The existing `join-bot` handler becomes a thin caller:

```python
@app.post("/pack-battles/{battle_id}/join-bot")
async def join_bot_pack_battle(battle_id: str, s: Session = Depends(db)):
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

The `join-bot` docstring/security comment (DEV-only, moves USDC) is preserved
on both handlers.

### New endpoint: `join-all-bots`

```python
@app.post("/pack-battles/{battle_id}/join-all-bots")
async def join_all_bots_pack_battle(battle_id: str, s: Session = Depends(db)):
    """DEV/TEST: fill every empty lobby seat with funded reserve bots.

    Same security posture as /join-bot (unauthenticated, moves real USDC,
    dev-gated). Best-effort: adds bots until the lobby fills or no eligible
    funded bot remains; 409 only if it could not add a single bot.
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
        if filled is None:  # no eligible funded bot left
            break
        added += 1
        if filled:          # lobby completed → battle started
            break
    if added == 0:
        raise HTTPException(409, "no hay bots libres con saldo suficiente")
    return get_battle(s, battle_id)
```

Each `_add_one_bot` call re-derives `in_battle` from the DB, so successive
iterations exclude already-added bots and pick a fresh one. The loop
terminates: it stops on fill, on no-eligible-bot, or when the finite bot
roster is exhausted (each iteration adds a distinct bot).

## Frontend

### Client: `joinAllBots`

`src/onchain/packBattleClient.ts` — mirror `joinBot`, no auth header:

```typescript
export function joinAllBots(id: string): Promise<Battle> {
  return battleFetch<Battle>(`/pack-battles/${encodeURIComponent(id)}/join-all-bots`, { method: 'POST' })
}
```

### Button: BattleFlow lobby

In `BattleFlow.tsx`, add a `joiningAll` state and an `onJoinAllBots` handler
(mirror `onJoinBot`: clear error, set loading, call `joinAllBots(battle.id)`,
catch → `botError` + `showToast`, finally clear loading). Render a single
prominent **"Join All Bots"** button in the lobby, near the
`{players}/{max}` counter, shown when `spaceAvailable` (≥1 empty seat).
Disabled while `joiningAll`. The existing per-slot "+ Join Bot" stays.
`useBattle`'s poll reflects the lobby filling as bots join.

## Testing

**Backend** (`backend/tests/`, mirror the `join-bot` test setup — mock
`load_bots`, bot balances, `collect_buyin_confirmed`/`join_battle` as the
existing bot tests do):
- Fills the last empty seat of a lobby and returns the battle (and starts the
  background runner when filled).
- Adds multiple bots when several seats are empty and enough funded bots exist.
- Returns **409** when no eligible funded bot exists (zero added).
- Returns **404** when `dev_endpoints_enabled` is false.
- Regression: the refactored `join-bot` still adds exactly one bot / 409s with
  no bots.

**Frontend** (`src/onchain/packBattleClient.test.ts`, mirror the `joinBot`
test):
- `joinAllBots('b1')` POSTs `/pack-battles/b1/join-all-bots` with **no** auth
  header.

## Out of scope

- No Hub "Live games" card button (explicitly chosen: waiting-room only).
- No change to bot selection, funding, or the anti-spoiler drop delay.
- No production exposure — remains dev-gated.
