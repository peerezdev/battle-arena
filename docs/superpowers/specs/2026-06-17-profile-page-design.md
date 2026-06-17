# Profile page — design spec

Date: 2026-06-17
Status: approved-pending-review

## Goal

Replace the topbar **Log out** button with a **Profile** button that opens a dropdown
(View profile / Log out) and routes to a `/profile` page with three tabs: **Overview**,
**Inventory**, **Settings**. In Settings the user sets a **unique username**; that username
is then shown instead of the wallet address wherever the player's identity appears
(chat, account chip, leaderboard already uses it).

## Decisions (from brainstorming)

- **Username**: unique across users (case-insensitive), 3–20 chars, `[A-Za-z0-9_]`.
- **Log out**: lives in a dropdown menu on the Profile button (not in Settings).
- **Tabs**: Overview + Inventory + Settings.
- **Inventory**: on-chain detection across **both** linked Solana wallets (embedded + connected
  Phantom), filtered to **Collector Crypt only**, mirroring MarketAgg's approach.

## Inventory — reuse MarketAgg's pattern

MarketAgg (`packages/adapters/src/collectorCrypt/das-client.ts`) reads NFTs via a thin
**DAS JSON-RPC client** (`getAssetsByOwner`) over a Helius RPC, and filters to Collector
Crypt by the DAS **collection grouping**:

- CC collection mint (mainnet): `CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf`
- Filter: `asset.grouping.some(g => g.group_key === 'collection' && g.group_value === <CC mint>)`
- insuredValue is **not** in DAS; MarketAgg gets it from CC REST (`api.collectorcrypt.com?ownerAddress=`, mainnet).

We mirror this client-side (same place we already read balances in `useUsdcBalance`):

- New `src/inventory/dasClient.ts` — `getAssetsByOwner(owner)` JSON-RPC, returns
  `{ id, grouping, content: { metadata.name, links.image, metadata.attributes } }`.
- New `src/inventory/useCollectorCryptNfts.ts` — for each linked Solana wallet, fetch assets,
  filter by CC collection grouping, map to `{ mint, name, image, source: 'embedded' | 'connected', insuredValue? }`.
- insuredValue: best-effort from DAS metadata attributes if present; otherwise omitted
  (CC REST integration is a later layer; same value the oracle attests).

### Config (config.ts + .env.example)

- `VITE_CC_COLLECTION_MINT` — default `CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf`
  (overridable for the devnet CC collection when the user provides it).
- `VITE_DAS_RPC` — optional; DAS-capable RPC (Helius). Falls back to `VITE_SOLANA_RPC`.
- Empty-state shown when no CC NFTs are found or DAS RPC is unavailable; the rest of the
  page works regardless.

## Backend changes

### Username uniqueness + validation — `services/users.py`, `main.py`, `models.py`

- `AliasBody`: tighten to `pattern=r"^[A-Za-z0-9_]+$"`, `min_length=3`, `max_length=20`.
- `set_alias(session, wallet, alias)`: before assigning, query for another user with
  `func.lower(User.alias) == alias.lower()` and a different wallet → raise new
  `AliasTakenError` (defined in `services/users.py`).
- `POST /users/me/alias`: catch `AliasTakenError` → `HTTPException(409, "username_taken")`.
- `models.py`: add a case-insensitive unique index on `lower(alias)` for robustness
  (`Index("ux_users_alias_lower", func.lower(User.alias), unique=True)`); NULLs allowed.
  Dev DB is recreated by `init_db`.

### Chat shows username — `main.py` `ws_chat`

- Resolve the connecting wallet's display name once at connect:
  `display = read_user_view(session, wallet, elo_start)["alias"] or abbreviate(wallet)`,
  using `session_factory` already in `create_app` scope (open/close a short-lived session).
- Broadcast that as the message `user` field. Unauthenticated stays `login_required`.

## Frontend changes

### AuthButtons → Profile button + dropdown — `ui/components/AuthButtons.tsx`

- Authenticated state: the account chip becomes a clickable **Profile** button showing the
  username (or email / `ABcd…WXyz` fallback) + green dot.
- Click opens a dropdown: **View profile** → `navigate('/profile')`; **Log out** → `logout()`.
- Click-outside closes it. Works in both `nav` (Landing) and `compact` (Hub) variants
  (both already inside `<BrowserRouter>`, so `useNavigate` is safe).

### Current-user profile hook — `src/hooks/useProfile.ts`

- Reads `GET /users/{embeddedAddress}` → `{ alias, elo, games_played }`; exposes
  `{ username, elo, gamesPlayed, loading, refresh }`. Used by the chip and Overview.

### Route + page — `App.tsx`, `ui/screens/Profile/ProfilePage.tsx`

- Add `<Route path="/profile" element={<ProfilePage />} />` under the existing
  `<Route element={<GameLayout />}>` group (gives the "← Lobby" shell + balance + Deposit).
- `ProfilePage`: tab state (Overview | Inventory | Settings), themed (Sora/JetBrains Mono,
  panel #161b24, border #ffffff14, accents green/violet).

### Tabs

- **Overview**: stat cards from `GET /users/{wallet}` (ELO, games played) +
  `GET /users/{wallet}/history` (win/loss/draw counts). No backend change.
- **Inventory**: grid from `useCollectorCryptNfts()`, grouped by source (Embedded / Connected),
  card = image + name + grade/insuredValue when available; empty-state otherwise.
- **Settings**: username input (prefilled from `useProfile`), Save → `POST /users/me/alias`
  with the identity token; inline error on 409 `username_taken` and on validation; success
  confirmation; `refresh()` the profile after save.

### Linked Solana wallets helper — `src/wallet/embedded.ts`

- Add `useLinkedSolanaWallets()` → `[{ address, source: 'embedded' | 'connected' }]` from
  `user.linkedAccounts` (embedded = `walletClientType === 'privy'`; connected = other
  `chainType === 'solana'` wallets, e.g. Phantom). `useEmbeddedSolanaAddress` stays.

## Testing

- **Backend**: alias uniqueness (409 case-insensitive), validation (charset/length),
  chat broadcasts alias when set and abbreviated wallet otherwise.
- **Frontend**: `dasClient` parse + CC-collection filter (pure), `useCollectorCryptNfts`
  grouping/filter, username client-side validation, AuthButtons dropdown actions,
  ProfilePage tab switching, Settings save/409 handling.

## Out of scope (later)

- CC REST integration for insuredValue/grade enrichment (mainnet).
- Real devnet CC collection mint (user provides → set `VITE_CC_COLLECTION_MINT`).
- Inventory actions (list/sell/transfer), avatars.
- Token-in-query-string hardening for the chat WS (tracked separately).
```
