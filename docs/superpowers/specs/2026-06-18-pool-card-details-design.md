# Gacha pool card details modal + CollectorCrypt link — design spec

Date: 2026-06-18
Status: approved-pending-review

## Goal

In the Gacha, make each card in a machine's pool **clickable** to open a read-only **Card Details**
modal (matching CollectorCrypt's own card modal: front/back thumbnails + large image, title,
insured-value box with Token ID, grading details), and make the "View Card" / "View on
CollectorCrypt" links point to the real CC asset page.

## Decisions (from brainstorming)
- The CC asset URL is `https://collectorcrypt.com/assets/solana/<nft_address>` (the mint changes
  per card). Use it for the pool modal's "View Card" and "View on CollectorCrypt", AND replace the
  Solana-devnet-explorer links currently used in the gacha **reveal** view and the **inventory**
  modal (it's the correct link; keep those components' internals otherwise unchanged).
- The pool modal is **read-only** — pool cards aren't owned by the user, so **no buyback** there.
- **No** "Vault" / "Contract" collapsibles from CC's modal (we don't have that data) — YAGNI.

## CC data (verified; keyless devnet)
`GET /api/getNfts?code=&page=&limit=` returns per NFT: `nft_address`, `name`, `rarity`, `image`,
`insured_value`, `content.files[]` (front + back image URLs), and `attributes[{trait_type,value}]`
including `Year`, `Grading Company`, `Grading ID`, `The Grade` ("GEM-MT 10"), `GradeNum` ("10"),
`Authenticated` ("true").

## Backend (`backend/`)
Enrich `GachaService.get_nfts` (`backend/app/services/gacha.py`) to return, per card, in addition
to the current `nft_address/name/image/rarity/insured_value/grade`:
- `images: list[str]` — from `content.files` (`cc_cdn` > `cdn_uri` > `uri`), fallback `[image]`.
- `grading_company: str | None` — attr `Grading Company`.
- `grading_id: str | None` — attr `Grading ID`.
- `the_grade: str | None` — attr `The Grade`.
- `generic_grade: str | None` — attr `GradeNum`.
- `authenticated: bool | None` — attr `Authenticated` == "true".
- `year: str | None` — attr `Year` (else 4-digit prefix of name, reusing `_extract_year`).

Keep the existing composed `grade` (used by the pool tile). Reuse the same image/attr extraction
helpers as `open_pack` where practical (extract small shared statics if it avoids duplication).
The response stays field-whitelisted (no raw upstream passthrough).

## Frontend (`src/`)

### gachaClient (`src/onchain/gachaClient.ts`)
- Extend `MachineCard` with: `images: string[]`, `grading_company: string | null`,
  `grading_id: string | null`, `the_grade: string | null`, `generic_grade: string | null`,
  `authenticated: boolean | null`, `year: string | null`.
- Add `export function ccAssetUrl(mint: string): string` → `https://collectorcrypt.com/assets/solana/${mint}` (pure, unit-tested).
- `fetchMachineCards` is unchanged structurally (it returns whatever the backend sends); the type
  widening is enough.

### Card details modal (`src/ui/screens/gacha/CardDetailsModal.tsx`)
- Props: `{ card: MachineCard; onClose: () => void }`.
- Layout mirrors the CC modal (reuse theme tokens + the visual language of the existing reveal
  `CardDetailsView`):
  - Header "Card Details" + ✕ close.
  - Left: clickable front/back thumbnails (from `card.images`, fallback `card.image`) selecting a
    large preview image.
  - Right: "Guaranteed Authenticity" line; title = `card.name`; an **Insured Value** box showing
    `formatUsd(card.insured_value)`, the abbreviated **Token ID** (`card.nft_address`) with a copy
    button, and a **"View Card ↗"** link → `ccAssetUrl(card.nft_address)`.
  - A **Grading** section: rows for Grading Company / Grading ID / Grade (`the_grade`) / Generic
    Grade (`generic_grade`) / Authenticated (Yes/No) — each rendered only when present.
  - A **"View on CollectorCrypt ↗"** link → `ccAssetUrl(card.nft_address)`.
- Backdrop click + ✕ close; inner click stops propagation. No buyback controls.
- Links rendered only when `card.nft_address` is non-null.

### Pool grid (`src/ui/screens/gacha/CardPoolGrid.tsx`)
- Each tile becomes clickable (`role="button"`, `tabIndex={0}`, Enter/Space, `cursor:pointer`) →
  calls an `onSelect(card)` passed from the parent.
- `CardPoolGrid` holds `selected: MachineCard | null` and renders `<CardDetailsModal card={selected}
  onClose={() => setSelected(null)} />` when a card is selected. (Self-contained — GachaVault is
  unchanged.)

### CC link in existing views (link-only change)
- `src/ui/screens/gacha/GachaVault.tsx` reveal `CardDetailsView`: change its explorer `href` from the
  Solana devnet explorer to `ccAssetUrl(result.nft_address)` (relabel to "View on CollectorCrypt").
- `src/ui/screens/Profile/InventoryCardModal.tsx`: change `explorerUrl` from the Solana devnet
  explorer to `ccAssetUrl(card.mint)` (relabel the link to "View on CollectorCrypt").

## Error handling / edge cases
- Missing `nft_address` → no "View Card"/"View on CollectorCrypt" links (don't render a broken href).
- Missing images → fall back to `card.image`, else the 🃏 placeholder.
- Grading rows omitted individually when their value is null.

## Testing
- Backend (pytest): `get_nfts` returns the enriched fields — mock CC `getNfts` with the verified
  attribute set + `content.files`, assert `images`, `grading_company`, `grading_id`, `the_grade`,
  `generic_grade`, `authenticated`, `year`; existing fields unchanged; whitelist holds.
- Frontend (vitest, pure): `ccAssetUrl(mint)` returns the exact CC URL. The modal itself is verified
  by `tsc`/build + manual eyeball.
- `npx tsc --noEmit` + `npm run build` clean; suites green.

## No-goals (YAGNI)
- Buyback on pool cards (not owned).
- CC "Vault" / "Contract" collapsibles.
- Refactoring the reveal `CardDetailsView` or `InventoryCardModal` internals — only their outbound
  link changes here.
- Pre-loading full details on the grid (the data already arrives with the pool fetch; the modal just
  renders it).
