# Pack battle multi-pack — backend (#4e-1) — design

Date: 2026-06-22
Status: approved-pending-review
Parent: Pack Battle engine, Reserved balance + cancel (#3c), Void refunds (#3d), Watch + reveal (#4b-3).
Part of #4e (multi-pack pack battles). This is the **backend** sub-project: a creator builds a *bundle* of packs (e.g. 1×$25 + 2×$50 = 3 boxes); each player opens the same bundle; highest **total** insured value wins all. The create UI is #4e-2.

## Goal
Generalize the single-box pack battle to a **bundle of 1–10 boxes**:
- Creator picks a bundle: a list of `{machine_code, count}` (any number of machines, total boxes 1–10).
- 2–10 players; **each player opens the same bundle**. Cost per player = Σ(machine price × count).
- Winner = highest **sum** of `insured_value` across their N pulls; **winner takes all** (every player's pulls transfer to the winner). Tie on the total → Provably-Fair `pick_index` among the tied players (one draw, at the end).
- A single-box battle is the degenerate bundle (N=1) and must behave **identically** to today.

## Background (current code)
- **Model** (`backend/app/models.py`): `PackBattle{ id, mode, machine_code, price (base units), max_players, status, winner, creator_wallet, escrow_*, server_seed/_hash, client_seed, tie_break_index, ... }` — a **single** `machine_code` + `price`. `BattlePull{ battle_id, player_wallet, memo, nft_address, insured_value, rarity, auto_sold, buyback_amount, round_number (default 1) }`.
- **Create** (`main.py` `create_pack_battle`, pack branch): `price = await _machine_price(body.machine_code)` (`= int(machine.price) * 1_000_000` base units; 409 if unavailable); `_require_available(wallet, price)`; `create_battle(s, wallet, wallet_id, machine_code=..., price=..., max_players=..., mode="pack")`; `reserve(s, wallet, b.id, price)`. `CreateBattleBody{ machine_code: str, max_players: int, mode: str = "pack" }`.
- `create_battle(session, creator_wallet, creator_wallet_id, *, machine_code, price, max_players, mode="pack")` (`pack_lobby.py`): validates `mode`, `2 <= max_players <= 10`, generates the PF seed, inserts `PackBattle` + the creator's `BattlePlayer`.
- **Join** (`main.py`, pack branch): `_require_available(wallet, b.price)`; `join_battle(...)`; `reserve(s, wallet, battle_id, b.price)`; when full → `_run_bg`. (Uses `b.price` — so once `price` is the bundle total, join reserves the total automatically.)
- **Engine** (`pack_engine.py` `run_battle`): `for w in players:` → ONE `gacha.generate_pack(pack_type=battle.machine_code, ...)` per player → persist a `BattlePull` → poll open → record `PullOutcome`. Then `determine_winner(outcomes, server_seed, client_seed)` = max single `insured_value` with PF tie-break; `settle_cards_to_winner(...)` transfers **all** `BattlePull` rows to the winner; sets `winner`/`status=settled`. Voids on any pull/winner failure.
- **`determine_winner(pulls, *, server_seed, client_seed)`**: `maxv = max(insured_value)`; `candidates = wallets at maxv`; 1 → that wallet; tie → `pick_index(server_seed, client_seed, len(candidates))`.
- **Void refund** (`refund.py` `refund_pack_void`): iterates **all** `BattlePull` rows → returns each pull to `p.player_wallet` (the NFT, or the auto-sold common's `buyback_amount` USDC). Already per-pull → generalizes to N pulls/player for free.
- **Settle** (`pack_engine.settle_cards_to_winner`): iterates **all** `BattlePull` rows → transfers each non-auto-sold NFT to the winner + sweeps escrow USDC. Already all-pulls → generalizes for free.
- **Royale engine** (`royale_engine.py`) is the template for **round-by-round** pulling (`for round: for player: pull` with `round_number`).
- `get_battle`/`list_open`/`verification` (`pack_lobby.py`): `list_open` returns `price`/`buyin` (pack `buyin == price`); `get_battle` returns `machine_code`/`price` + the `pulls` recap (grouped by `round_number` for the #4b-3 reveal). PF is a single draw for pack (`client_seed`/`tie_break_index`), per-round for royale — **multi-pack keeps the single pack draw**.

## Schema
New child table **`BattlePack`** (the ordered bundle):
```python
class BattlePack(Base):
    __tablename__ = "battle_packs"
    id: int (PK, autoincrement)
    battle_id: str (index)
    machine_code: str
    price: int           # USDC base units, per box
    sequence: int        # 1..N, order within the bundle
```
- `PackBattle.price` becomes the **bundle total** (Σ per-box prices). `PackBattle.machine_code` stays as a representative (the first box's machine) for display/back-compat.
- `init_db` (`create_all`) creates the new table; additive, no migration of existing rows. A legacy battle with no `BattlePack` rows is treated as a 1-box bundle of its `machine_code`/`price` (back-compat in the engine).

## Create (`POST /pack-battles`, pack mode)
`CreateBattleBody` gains an optional bundle (royale unaffected — it ignores `packs`):
```python
class PackSel(BaseModel):
    machine_code: str
    count: int
class CreateBattleBody(BaseModel):
    machine_code: str | None = None     # legacy single-pack / royale
    max_players: int
    mode: str = "pack"
    packs: list[PackSel] | None = None  # multi-pack bundle (pack mode only)
```
Pack-branch flow:
1. Build the bundle as an ordered list of `(machine_code, price_per_box)`:
   - if `body.packs`: for each `sel`, `price = await _machine_price(sel.machine_code)` (409 if unavailable), append `(sel.machine_code, price)` × `sel.count` (preserving order).
   - else: `[(body.machine_code, await _machine_price(body.machine_code))]` (legacy single box). `machine_code` is required in this path.
2. Validate `1 <= len(bundle) <= 10` → else `HTTPException(422, "el bundle debe tener entre 1 y 10 cajas")`. Each `count >= 1` → else 422.
3. `total = sum(price for _, price in bundle)`; `await _require_available(wallet, total, s)`.
4. `b = create_battle(s, wallet, wallet_id, machine_code=bundle[0][0], price=total, max_players=body.max_players, mode="pack", packs=bundle)`.
5. `reserve(s, wallet, b.id, total)`; return `get_battle(s, b.id)`.

`create_battle(...)` gains `packs: list[tuple[str, int]] | None = None`:
- if `packs` is None → `packs = [(machine_code, price)]` (single box).
- inserts a `BattlePack` row per entry with `sequence = 1..N`.
- everything else (seed, creator `BattlePlayer`, validation) unchanged.

**Join** is unchanged: it already reserves/`_require_available`s `b.price`, which is now the bundle total.

## Engine (`run_battle` — generalized, round-by-round)
- Read the bundle: `packs = session.query(BattlePack).filter_by(battle_id=battle.id).order_by(BattlePack.sequence).all()`; if empty (legacy) → a 1-element bundle `[(battle.machine_code, battle.price)]`.
- Pull **round by round** (mirrors `royale_engine`): `for k, (machine_code, _price) in enumerate(bundle, start=1): for w in players:` → `gacha.generate_pack(player_address=w, pack_type=machine_code, alt_player_address=esc, turbo=True)` → persist a `BattlePull(round_number=k, ...)` → submit → poll open → fill `nft_address/insured_value/rarity/auto_sold/buyback_amount` → record a `PullOutcome(player_wallet=w, ...)`. (Round-by-round so the #4b-3 reveal shows everyone's box k together.)
- Any pull failure → void (existing behavior). `refund_pack_void` already returns each persisted pull to its owner.
- **Winner by total:** `determine_winner` is generalized to aggregate by wallet:
  ```python
  def determine_winner(pulls, *, server_seed, client_seed):
      totals = {}
      for p in pulls:
          totals[p.player_wallet] = totals.get(p.player_wallet, 0.0) + (p.insured_value or 0)
      maxv = max(totals.values())
      candidates = sorted([w for w, t in totals.items() if t == maxv])
      if len(candidates) == 1: return candidates[0], None
      if not server_seed: raise ValueError("server_seed must be set before a tie-break draw")
      idx = pick_index(server_seed, client_seed, len(candidates))
      return candidates[idx], idx
  ```
  For a 1-box battle (one pull per wallet) this is identical to today (each total == that pull's value).
- `client_seed = client_seed_from_nfts([o.nft_address for o in outcomes])` (all pulled NFTs), the single `tie_break_index`, `settle_cards_to_winner(...)` — **all reused unchanged** (settle already transfers every `BattlePull`).

## Read (`get_battle`)
`get_battle` adds the bundle so the UI (#4e-2) can render "1×$25 + 2×$50":
```
packs: [ { machine_code, sequence, price } ]   # ordered; [] for legacy battles
```
`list_open`/`buyin` already reflect the total via `price`. The #4b-3 reveal already groups `pulls` by `round_number` → multi-round reveal needs no backend change beyond `round_number` now spanning 1..N (the engine sets it).

## Error handling
- Bundle out of range (0 or >10 boxes) / `count < 1` → 422. Unavailable machine → 409 (existing `_machine_price`). Insufficient available funds → 402 (existing `_require_available`).
- A pull/winner failure mid-bundle → void; `refund_pack_void` returns each completed pull to its puller (a player who opened boxes 1–2 but not 3 gets boxes 1–2 back; box 3 was never pulled/charged). No new refund logic.
- Reservations release on settle/void/cancel as today (`release_reservations` by `battle_id`, the total).

## Testing
- **`determine_winner` (unit):** by-total — three wallets with multi-pull totals → highest total wins; one pull per wallet (single-box) → identical to the prior behavior; a tie of totals → deterministic PF `pick_index` among the tied wallets (regression: the existing single-pull tie test still passes).
- **`create_battle` (unit):** with `packs=[("m25",25_000_000),("m50",50_000_000),("m50",50_000_000)]` (base units, 1×$25 + 2×$50) → 3 `BattlePack` rows with `sequence` 1/2/3, `PackBattle.price == 125_000_000`, `machine_code == "m25"`; with `packs=None` → one `BattlePack` row from `machine_code`/`price`.
- **`POST /pack-battles` (API, monkeypatched balance + machines):** a `packs` bundle reserves the correct total and persists the bundle; `> 10` boxes → 422; an unavailable machine → 409; legacy `{machine_code}` (no `packs`) → a 1-box bundle reserving the single price (existing create test stays green). `get_battle` returns the `packs` list.
- **`run_battle` multi-pack** (mocked gacha/signer/transfer, in-memory DB): a 3-box bundle, 2 players → 6 `BattlePull` rows with `round_number` 1/1/2/2/3/3; winner = the wallet with the higher summed `insured_value`; `settle` transfers all 6; a void mid-bundle returns each completed pull to its owner.
- **Regression:** all existing `pack_engine`/`pack_lobby`/`refund` single-box tests stay green (behavior preserved).

## No-goals
- The multi-pack **create UI** (#4e-2) — selecting machines/counts, showing the bundle/cost.
- Royale changes; per-round PF for multi-pack (it is a single end-of-battle draw); changing the PF algorithm.
- Multi-pack for royale (royale keeps its same-machine per-round model).
- Online mana.
