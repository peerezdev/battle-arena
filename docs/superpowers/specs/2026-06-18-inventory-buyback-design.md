# Inventory card modal + buyback — design spec

Date: 2026-06-18
Status: approved-pending-review

## Goal

In the Profile → Inventory tab, clicking a card opens a modal with the NFT's info (image, name,
rarity, insured value, grading, token id). If a **buyback** is still available for that card
(won via the gacha within CC's 72-hour window, not yet sold), the modal shows an **"Accept
Buyback $X"** action with an explicit confirmation step before selling it back for USDC.

## Decisions (from brainstorming)
- Buyback only on **embedded-wallet** cards (`source === 'embedded'`) — those are won via the
  gacha, eligible for the window, and the embedded wallet can sign for them. Connected-wallet
  (Phantom/Backpack) cards get the info modal but **no** buyback button.
- **Explicit confirm step**: "Accept Buyback $X" → a confirm state ("Sell [card] for $X? …") →
  on confirm, generate → sign → submit. (The Privy embedded wallet may sign silently, so the
  in-app confirm prevents an accidental, irreversible sell.)
- The buyback claim reuses the **pack-purchase pattern**: `POST /api/buyback` returns a base64
  tx → sign with the embedded wallet → submit via the existing submit endpoint.

## CC API (verified; keyless on devnet)
- `GET /api/buyback/available?wallet=&nft=` → `{ available: bool, amount?: number }` (amount in
  USDC base units, 6 decimals; already adjusted for the pack buyback % and capped).
- `POST /api/buyback` body `{ playerAddress, nftAddress, altRecipient? }` →
  `{ success, serializedTransaction (base64), refundAmount, memo }`. Then sign + submit via
  `/api/submitTransaction`. Eligibility = won within 72h and no confirmed buyback yet.

## Backend (`backend/`)
Add to `GachaService` + `main.py` (keyless on devnet, like the other gacha proxies; field-
whitelisted; `GachaUpstreamError` → 502 with the reason; `GachaDisabled` → 503):
- `GachaService.buyback_available(wallet, nft) -> {"available": bool, "amount": int | None}`
  → `GET /api/buyback/available?wallet=&nft=`.
- `GachaService.buyback(player_address, nft_address) -> {"serialized_transaction": str,
  "refund_amount": int | None, "memo": str | None}` → `POST /api/buyback`
  body `{playerAddress, nftAddress}`.
- Endpoints:
  - `GET /gacha/buyback/available?wallet=&nft=` (public read, like `/gacha/machines`) →
    the availability dict.
  - `POST /gacha/buyback` (authed via `current_user`; `playerAddress` = the caller's embedded
    wallet; body `BuybackBody { nft_address: str }`) → the whitelisted tx dict.
- Submit reuses the existing `POST /gacha/submit-tx`.

## Frontend (`src/`)

### Enrich inventory cards
Extend `dasAssetToCard` (and `InventoryCard`) in `src/inventory/dasClient.ts` to also extract,
from the DAS asset's `content.metadata.attributes`: `rarity` (from the asset, lower-cased),
`grade` (compose "Grading Company" + "The Grade", reusing the same logic as the gacha proxy),
`gradingCompany`, `gradingId`, `year`, `authenticated`. All nullable. (These are the same
traits CC returns; the modal renders whichever are present.)

### gachaClient additions (`src/onchain/gachaClient.ts`)
- `fetchBuybackAvailable(wallet, nft): Promise<{ available: boolean; amount: number | null }>`
  → `GET /gacha/buyback/available?...` (public; no token).
- `requestBuyback(token, nftAddress): Promise<{ serialized_transaction: string; refund_amount: number | null; memo: string | null }>`
  → `POST /gacha/buyback` with the Bearer identity token.

### Inventory modal (`src/ui/screens/Profile/InventoryCardModal.tsx`)
- Props: `{ card: OwnedCard; onClose: () => void; onSold: () => void }`.
- Shows the NFT info (image, name, rarity badge, insured value via `formatUsd`, grade /
  grading company+id / year / authenticated rows when present, Token ID = abbreviated mint +
  copy + a "View token ↗" link to the Solana explorer devnet). Styled consistently with the
  gacha "Card Details" view (reuse the same visual language/tokens).
- **Buyback** (only when `card.source === 'embedded'`): on mount, call
  `fetchBuybackAvailable(embeddedAddress, card.mint)`. While checking → a muted "Checking
  buyback…". If `available` → an "Accept Buyback $X" button (X = `amount / 1e6` via `formatUsd`).
  - Click → **confirm state**: "Sell {name} for $X? You return the card and get USDC." with
    **Confirm** / **Cancel**.
  - Confirm → `requestBuyback(token, mint)` → `signTransactionBase64(serialized_transaction)` →
    `submitTx(token, signed)` → success state ("Sold — $X credited") → call `onSold()` (closes +
    refreshes inventory). Errors surface inline (reuse the gacha error message surfacing).
  - If not available → no buyback button (optionally a muted "Buyback not available").

### InventoryTab wiring (`src/ui/screens/Profile/InventoryTab.tsx`)
- Make each `CardTile` clickable (button/role) → sets a `selected: OwnedCard | null` state →
  renders `<InventoryCardModal card={selected} onClose={…} onSold={…} />`.
- `onSold` triggers an inventory refresh (see below) and closes the modal.

### Inventory refresh (`src/inventory/useCollectorCryptNfts.ts`)
- Add a `refresh()` to the hook (a nonce that re-runs the fetch effect), so after a sell the
  sold card disappears. Balance updates via `useUsdcBalance`'s existing 30s poll.

## Error handling
- Buyback availability fetch failure → treat as not available (no button); don't block the modal.
- `requestBuyback` / submit failure → inline error in the modal; stay on the card (no state
  change; the user can retry or cancel).
- Not authenticated → no buyback button (info modal still shows). The embedded address comes
  from `useEmbeddedSolanaAddress`.

## Testing
- Backend (pytest): `buyback_available` maps `{available, amount}`; `buyback` whitelists the tx
  fields; endpoints return the right shapes; 502 on upstream error with reason; the authed
  endpoint uses the caller wallet as `playerAddress`.
- Frontend (vitest, pure): `fetchBuybackAvailable`/`requestBuyback` client (URL + body +
  surfaced error), and the enriched `dasAssetToCard` (grade/rarity/year extraction). The modal
  flow is verified by `tsc`/build + manual eyeball.
- `npx tsc --noEmit` + `npm run build` clean; suites green.

## No-goals (YAGNI)
- Buyback for connected-wallet (Phantom) cards (can't sign; not won here).
- Bulk buyback / sell-all.
- A buyback-status/history view (`/api/buyback/check`) — not needed for this flow.
- Showing buyback availability on the inventory grid tiles (checked lazily per modal only, to
  avoid N availability calls on render).
