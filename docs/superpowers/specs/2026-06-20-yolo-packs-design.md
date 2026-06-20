# YOLO packs (bulk open + Turbo) — design spec

Date: 2026-06-20
Status: approved-pending-review

## Goal

Let a player open **N packs (1–10) of a machine at once** ("YOLO"), optionally in **Turbo** mode
(auto-sell Common wins for USDC), with a one-by-one staged reveal that supports **Skip pack** /
**Skip all**, ending in a summary of everything won.

## CC API (verified from docs; keyless on devnet)
- `POST /api/generateYoloPacks` body `{ playerAddress, packType, count (1–100), turbo? }` →
  `{ "yoloId": str, "count": int, "transactions": [ { "memo": str, "transaction": base64 }, … ] }`.
  Each transaction is signed + submitted individually via `/api/submitTransaction`, then opened by
  its `memo` via `/api/openPack` (same per-pack flow as a single pack).
- `/api/openPack` response is the SAME shape as a normal open, plus — when a Common was auto-sold in
  Turbo — `"code": "TURBO_MODE_BUYBACK"` and `"buybackAmount"` (USDC base units, 6 decimals). The NFT
  fields (`nft_address`, `nftWon`, `rarity`) are still present. Turbo is fixed at generation; openPack
  takes no turbo parameter.
- Same odds/price/EV as single packs (YOLO is bulk convenience).

## Decisions (from brainstorming)
- Count 1–10 via a **stepper (− N +)** plus presets **x3 / x5 / x10**. Total cost = `count × price`.
- **Turbo** toggle, shown only when `machine.turboMode` is truthy.
- Reveal is **one-by-one** (reuse the existing staged reveal) with **Skip pack** (skip the current
  card's animation) and **Skip all** (reveal the rest and jump to the summary).
- The YOLO controls live **in the MachineDetailPanel**, below the existing single "OPEN NOW".
- Partial failure is safe: unsubmitted packs are never charged (a Solana tx only charges on submit).

## Backend (`backend/`)
- `GachaService.generate_yolo_packs(player_address: str, pack_type: str, count: int, turbo: bool) -> dict`
  → `POST /api/generateYoloPacks` body `{playerAddress, packType, count, turbo}` → returns
  `{"yolo_id": raw.get("yoloId"), "count": raw.get("count"), "transactions": [{"memo","transaction"} …]}`
  (whitelisted; each tx item built from explicit keys; drop any item missing memo/transaction).
- `GachaService.open_pack` (modify): when `raw.get("code") == "TURBO_MODE_BUYBACK"`, set
  `auto_sold = True` and `buyback_amount = raw.get("buybackAmount")`; otherwise `auto_sold = False`,
  `buyback_amount = None`. Add both to the non-pending result dict. (`WAITING_FOR_WEBHOOK` still →
  `{pending:True}` as today.) Backward-compatible for single packs.
- Endpoint `POST /gacha/yolo` (authed via `current_user`; `s: Session`):
  - Body `YoloBody { pack_type: str; count: int = Field(ge=1, le=10); turbo: bool = False }`.
  - `_gacha_throttle(wallet)`; call `generate_yolo_packs(player_address=wallet, pack_type, count, turbo)`.
  - Insert a `GachaPack(memo, wallet, pack_type)` row for EACH returned tx's memo (mirror
    `gacha_generate`'s idempotent insert: skip if it already exists for the same wallet, 502 if a memo
    belongs to another wallet). Then return the whitelisted dict.
  - Errors: `GachaDisabled` → 503 `"gacha_disabled"`; `GachaUpstreamError` → 502 with the reason; 502
    if the upstream returned no transactions.
- Submit + open reuse the existing `/gacha/submit-tx` and `/gacha/open-pack` (open-pack already
  verifies `GachaPack[memo].wallet == caller` and marks `opened_at`/`nft_address`).

## Frontend (`src/`)

### gachaClient (`src/onchain/gachaClient.ts`)
- `interface YoloTx { memo: string; transaction: string }`
- `interface YoloPacksResponse { yolo_id: string | null; count: number; transactions: YoloTx[] }`
- `generateYoloPacks(token: string, packType: string, count: number, turbo: boolean): Promise<YoloPacksResponse>`
  → `POST /gacha/yolo` (Bearer) body `{ pack_type, count, turbo }`.
- Extend the non-pending `OpenPackResult` with `auto_sold: boolean` and `buyback_amount: number | null`.
- `export function yoloTotalCost(price: number, count: number): number` → `price * count` (pure, tested).
- `export function clampCount(n: number): number` → integer clamped to `[1, 10]` (pure, tested).

### YOLO controls — `src/ui/screens/gacha/MachineDetailPanel.tsx`
- New props: `onYolo: (count: number, turbo: boolean) => void` and the existing `usdc`/`authed`.
- A "YOLO" section below OPEN NOW: a stepper (`−` / count / `+`, clamp 1–10 via `clampCount`), preset
  buttons `x3`/`x5`/`x10`, a Turbo toggle rendered only when `machine.turboMode`, a live total
  `formatUsd(yoloTotalCost(price, count))`, and an "Open ×N" button. Button disabled (with reason)
  when `!authed`, `machine.available === false`, or `usdc != null && usdc < total`. Reuse theme tokens.
- Local state for `count` (default 1) + `turbo` (default false) lives in the panel; `onYolo(count,turbo)`
  is called on click.

### Orchestration + reveal — `src/ui/screens/gacha/GachaVault.tsx`
- New `Phase` variants:
  - `{ kind: 'yolo'; step: 'firmando' | 'enviando' | 'abriendo'; done: number; total: number }`
  - `{ kind: 'yolo-reveal'; results: YoloResult[]; index: number }`
  - `{ kind: 'yolo-summary'; results: YoloResult[] }`
  where `YoloResult = Extract<OpenPackResult, { pending: false }>` (the opened cards; pending packs are
  dropped from the reveal and noted in the summary count).
- `handleYolo(count, turbo)`:
  1. `generateYoloPacks(token, machine.code, count, turbo)` → `transactions`.
  2. For each tx (sequential): `signTransactionBase64(tx.transaction)` then `submitTx(token, signed)`;
     update `{kind:'yolo', step:'firmando'|'enviando', done:i, total}`. On throw at i, STOP; keep the
     first i submitted memos.
  3. For each submitted memo (sequential): `pollOpenPack(() => openPack(token, memo))`; update
     `{kind:'yolo', step:'abriendo', done:i, total}`. Collect non-pending results (record `recordDrop`
     for each, like single open).
  4. → `{kind:'yolo-reveal', results, index:0}`.
- Reveal overlay for YOLO: reuse the staged `RevealResult` for `results[index]`, with a counter
  "Pack {index+1}/{results.length}", an auto-sold badge ("Auto-sold {formatUsd(buyback_amount/1e6)}")
  when `results[index].auto_sold`, and three controls:
  - **Skip pack** → mark the current card fully revealed (skip remaining animation stages).
  - **Next** (after the card is shown) → `index+1`, or → `yolo-summary` when at the last.
  - **Skip all** → `{kind:'yolo-summary', results}`.
- `yolo-summary`: a grid of all `results` cards (image + name + value, auto-sold ones badged), the
  **total insured value won** (`sum(insured_value)`), and for Turbo the **count auto-sold + total USDC
  received** (`sum(buyback_amount)/1e6`). A close button → `{kind:'machines'}`.

## Error handling / edge cases
- `generateYoloPacks` fails → openError banner; nothing charged.
- A sign/submit throws at pack i → stop; open the first i; reveal those; summary notes "opened i of N".
- A pack stays pending after polling → excluded from the reveal; summary shows "{k} still opening".
- USDC gate uses the live `usdc` vs `count × price`; the on-chain tx still surfaces any real shortfall.
- Turbo toggle hidden when `!machine.turboMode`; sending `turbo:false` is always valid.

## Testing
- Backend (pytest): `generate_yolo_packs` maps/whitelists `{yolo_id,count,transactions}`; `/gacha/yolo`
  validates `count` (0 and 11 → 422), requires auth (401), stores one `GachaPack` per memo with the
  caller wallet, sets `playerAddress`=caller; `open_pack` adds `auto_sold/buyback_amount` on
  `TURBO_MODE_BUYBACK` and `false/None` otherwise; 502 when upstream returns no transactions.
- Frontend (vitest, pure): `generateYoloPacks` (URL/body/Bearer/error), `yoloTotalCost`, `clampCount`.
  The orchestration/reveal verified by `tsc`/build + manual.
- `npx tsc --noEmit` + `npm run build` clean; suites green.

## No-goals (YAGNI)
- count > 10; `altPlayerAddress` delivery; resuming abandoned (generated-but-unsubmitted) packs; a
  separate YOLO history view; parallel signing (sequential is simpler and safe).
