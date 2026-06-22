# Pack battle multi-pack — frontend create UI (#4e-2) — design

Date: 2026-06-23
Status: approved-pending-review
Parent: Pack battle multi-pack backend (#4e-1), Lobby online (#4b-2).
Part of #4e. The **create UI**: in `CreateBattleModal`, the Pack mode becomes a bundle builder (pick machines + counts, ≤10 boxes) that sends `packs: [{machine_code, count}]`. Royale is unchanged. Frontend-only — the backend (#4e-1) already accepts the bundle.

## Goal
Let a creator build a multi-pack bundle for a Pack battle:
- For each available gacha machine, a `−/+` stepper sets how many of that box go in the bundle.
- Show running totals: **X/10 cajas · $Y total**; cap the bundle at 10 boxes; require ≥1.
- Submit sends `packs: [{machine_code, count}]` (only machines with `count > 0`) to `POST /pack-battles`.
- Royale mode keeps the existing single-machine picker.

## Background (current code)
- `CreateBattleModal` (`src/ui/screens/Hub/CreateBattleModal.tsx`): a mode toggle (`pack`/`royale`), a single machine `<select>` (`machineCode` state), a player-count selector (`PLAYER_COUNTS = [2,3,4,5,6,8,10]`, `players` state), a delegation gate, and a `submit()` that calls `buildCreateBody(mode, machineCode, players)` → `createBattle(token, body)`. `fetchMachines()` (`GachaMachine{ code, name, price (USD), available?, ... }`) loads the list on mount.
- `buildCreateBody(mode, machineCode, players)` (`src/ui/screens/Hub/createBattleBody.ts`) → `{ machine_code, max_players, mode }`.
- `createBattle(token, body: { machine_code: string; max_players: number; mode?: BattleMode })` (`src/onchain/packBattleClient.ts`).
- **Backend (#4e-1, shipped):** `POST /pack-battles` accepts `packs: list[PackSel]` (`PackSel{ machine_code, count }`); builds a 1–10-box bundle; `machine_code` is now optional; `> 10` boxes or `count < 1` → 422; unavailable machine → 409; the reserved total = Σ(price × count). `get_battle` returns `packs`.

## Data layer
- `createBattle` body type gains an optional bundle:
  ```ts
  createBattle(token, body: {
    machine_code?: string; max_players: number; mode?: BattleMode
    packs?: { machine_code: string; count: number }[]
  }): Promise<Battle>
  ```
  (Additive; royale/legacy single-machine callers unchanged.)
- New pure helpers in `src/ui/screens/Hub/createBattleBody.ts` (`counts` is a `Record<machineCode, number>`):
  - `bundleToPacks(counts: Record<string, number>): { machine_code: string; count: number }[]` — entries with `count > 0`, in `Object.keys` insertion order.
  - `totalBoxes(counts: Record<string, number>): number` — Σ counts.
  - `bundleCostUsd(counts: Record<string, number>, machines: GachaMachine[]): number` — Σ(`machine.price` × count) over machines present in `counts` (missing machine → 0).
- `buildCreateBody` (single-machine, royale) stays as-is.

## `CreateBattleModal`
- New state `counts: Record<string, number>` (machine code → box count), initialized `{}`.
- **Constant** `MAX_BOXES = 10`.
- **Pack mode** (`mode === 'pack'`) renders a **stepper list** instead of the single `<select>`: one row per machine where `available !== false`, showing `name · $price` and a `[−] n [+]` control bound to `counts[code] ?? 0`.
  - `+`: increments `counts[code]`, disabled when `totalBoxes(counts) >= MAX_BOXES`.
  - `−`: decrements (floor 0), disabled when `counts[code]` is 0.
  - Footer line: `{totalBoxes(counts)}/10 cajas · {formatUsd(bundleCostUsd(counts, machines))} total`.
- **Royale mode** keeps the existing single machine `<select>` (`machineCode`).
- Player-count selector unchanged (both modes).
- **Submit** branches on mode:
  - pack → `createBattle(identityToken, { packs: bundleToPacks(counts), max_players: players, mode: 'pack' })`.
  - royale → unchanged (`buildCreateBody('royale', machineCode, players)`).
- **Create disabled** when: `busy`, no `identityToken`, or (pack && `totalBoxes(counts) === 0`), or (royale && no `machineCode`).
- The delegation gate, error display, and `onCreated(b.id)` flow are unchanged.

## Data flow
1. Modal opens → `fetchMachines()` → machine list.
2. Pack mode: user steps counts up/down → `counts` → footer recomputes boxes/cost; `+` capped at 10.
3. Create → delegation gate → `createBattle({ packs, max_players, mode:'pack' })` → backend builds the bundle → `onCreated(id)` → Hub navigates to `/play/battle/:id` (existing).

## Error handling
- Backend `422` (somehow >10 or empty — the UI prevents this, but defensively) / `409` (unavailable machine) / `402` (insufficient funds) → surfaced inline via the existing `error` state.
- A machine that becomes unavailable between load and submit → backend 409 → inline error; the user adjusts.
- Empty bundle is prevented client-side (Create disabled).

## Testing
- `bundleToPacks`: `{a:2, b:0, c:1}` → `[{machine_code:'a',count:2},{machine_code:'c',count:1}]` (drops 0); `{}` → `[]`.
- `totalBoxes`: sums counts; `{}` → 0.
- `bundleCostUsd`: `{m25:1, m50:2}` with machines `[{code:'m25',price:25},{code:'m50',price:50}]` → 125; unknown machine code → contributes 0.
- `CreateBattleModal` (mock `fetchMachines` + `createBattle`): in pack mode, clicking `+` on a machine increments and the footer shows `1/10`; Create is disabled at 0 boxes and enabled after adding; submitting calls `createBattle` with `{ packs: [...], max_players, mode:'pack' }`; the `+` is disabled once total boxes reach 10.

## No-goals
- Any backend change (done in #4e-1).
- Changing royale (stays single-machine).
- The multi-round reveal (#4b-3 already groups by `round_number`).
- Exact base-unit cost (the backend reserves the true total; the UI shows an approximate USD sum from `machine.price`).
- Per-machine odds/EV display in the builder (later polish).
