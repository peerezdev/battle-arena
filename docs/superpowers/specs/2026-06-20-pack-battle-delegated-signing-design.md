# Pack Battle · Sub-project #1 — Delegated-signing infrastructure (design)

Date: 2026-06-20
Status: approved-pending-review
Parent: `2026-06-20-pack-battle-orchestrated-design.md` (operator-orchestrated architecture)

## Goal

Let the BattleArena backend **sign & send Solana transactions on behalf of a user's Privy embedded
wallet** after a one-time user delegation, so the Pack Battle orchestration (sub-project #2) can pull /
transfer / buyback server-side with no per-action user signing. Plus the two devnet verifications that
de-risk the whole operator-orchestrated architecture.

## Researched Privy REST contract (the backend integration)
- **Sign & send:** `POST https://api.privy.io/v1/wallets/{wallet_id}/rpc`
  Body:
  ```json
  { "method": "signAndSendTransaction",
    "caip2": "solana:<cluster_genesis>",
    "params": { "transaction": "<base64 serialized tx>", "encoding": "base64" } }
  ```
  Headers: `Authorization: Basic base64(app_id:app_secret)`, `privy-app-id: <app_id>`,
  `privy-authorization-signature: <sig>`, `Content-Type: application/json`.
  Response: `{ "data": { "hash": "<sig>", "caip2": "..." } }`.
  - caip2 mainnet = `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`; **devnet caip2 to confirm at impl**
    (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`).
- **`privy-authorization-signature`:** ECDSA **P-256** signature (base64) over the canonical JSON
  payload `{ version: 1, method, url, body, headers }` where `headers` are only the Privy-specific
  ones (`privy-app-id`, optional `privy-idempotency-key`, `privy-request-expiry`). The exact
  canonicalization (field order / JSON serialization) is **pinned at implementation** by porting
  Privy's open-source signing utility (a known risk; the first task verifies it against a live call).
- Server-initiated signing works while the user is **offline** once delegation is granted.
- **Verified capability** (prior research): Privy supports server-side delegated signing for **Solana**
  embedded wallets via this REST path.

## Verified so far (this session)
- CC `generatePack` on devnet **keyless accepts a valid `altPlayerAddress`** (distinct from the payer)
  and returns a pull tx — confirmed (no charge, tx not submitted). Full delivery proof = the test pull below.

## Components

### Client (frontend) — delegation consent
- A one-time "Enable Pack Battle (delegate signing)" action calling
  `useDelegatedActions().delegateWallet({ address, chainType: 'solana' })` for the embedded Solana
  wallet — Privy shows its consent screen. Revocable.
- `useDelegationStatus(): { delegated: boolean }` derived from `user.linkedAccounts` (the embedded
  Solana account's `delegated` flag). Battle-join is gated on `delegated`.
- This sub-project ships only the consent + status hook (the full battle UI is sub-project #4); a tiny
  temporary "Enable + status" panel is enough to drive the verification.

### Backend — `backend/app/services/privy_signer.py`
- `class PrivySigner`:
  - `__init__(app_id, app_secret, auth_key_pem, cluster_caip2, base_url='https://api.privy.io', now_fn, timeout)`
  - `sign_and_send_solana(self, wallet_id: str, tx_base64: str) -> str` → POSTs the RPC; returns the
    tx hash; raises `PrivySignerError` on non-2xx (surfacing Privy's error).
  - `_authorization_signature(self, method, url, body_dict) -> str` → builds the canonical payload,
    P-256-signs with `auth_key_pem`, base64.
- `resolve_delegated_solana_wallet_id(user_claims_or_api) -> {wallet_id, address}`: the wallet **id**
  (not address) is required by the RPC. Resolve from the Privy user's `linked_accounts` (the embedded
  Solana wallet's `id`), via the identity-token claims if present, else `GET /v1/users/{did}` (Privy
  users API, same Basic auth). The existing `PrivyVerifier` already extracts the embedded **address**;
  extend it to also surface the wallet **id**.
- Config (`backend/.env`, server-only): `PRIVY_APP_ID` (exists), `PRIVY_APP_SECRET` (exists),
  **`PRIVY_AUTH_KEY`** (new — the P-256 authorization private key, PEM), **`PRIVY_SOLANA_CAIP2`**
  (devnet genesis caip2). Wired into `create_app` like the other config.

### Verification tasks (FIRST, devnet — gate everything downstream)
1. **Privy delegation e2e:** with a delegated embedded wallet, the backend builds a trivial Solana tx
   (a Memo-program instruction, fee-payer = the wallet) → `sign_and_send_solana` → asserts a returned
   hash + the tx confirms on devnet. Proves delegated Solana signing end-to-end. This also pins the
   authorization-signature canonicalization (iterate until Privy accepts the request).
2. **CC delivery:** one real pull — `generatePack(playerAddress=embedded, packType=pokemon_50,
   altPlayerAddress=<a backend-controlled wallet>)` → sign with the embedded (delegated) → submit →
   open → assert the NFT lands in the backend wallet, NOT the payer's. Proves `altPlayerAddress`
   delivery (costs ~$50 USDC, user-approved).

## User prerequisites (done in parallel by the user)
- In the **Privy dashboard**: create an **authorization key** and register it as a **key quorum** /
  owner for the app's wallets (so the backend may authorize server-side signing). Put its **private
  key** in `backend/.env` as `PRIVY_AUTH_KEY`; share the public key id if the dashboard needs it bound.
- Hold ≥ $50 USDC in the embedded wallet for the delivery test, and grant delegation once in the UI.

## Trust / security
- `PRIVY_APP_SECRET` + `PRIVY_AUTH_KEY` live ONLY in `backend/.env`; never shipped to the client.
- Delegation is user-granted and **revocable**; the consent screen makes the authority explicit. The
  backend uses the delegated capability only for Pack Battle actions.
- The signer never logs the tx bytes, keys, or signatures.

## Error handling / edge cases
- User not delegated → backend returns a typed error; the client prompts to delegate (no battle join).
- Privy RPC non-2xx → `PrivySignerError` with Privy's reason; orchestration treats it as a failed action.
- Wallet id unresolvable (no embedded Solana account) → typed error.
- `PRIVY_AUTH_KEY` unset → the signer is disabled (kill-switch), endpoints needing it return 503.

## Testing
- Unit (pytest, respx): `PrivySigner.sign_and_send_solana` builds the right URL/body/headers and parses
  the hash; `_authorization_signature` produces a stable base64 for a fixed payload+key (golden vector,
  fixed once the canonicalization is pinned in task 1); `PrivySignerError` on non-2xx.
- Manual devnet e2e: the two verification tasks above.

## No-goals (this sub-project)
- The orchestration engine / escrow (sub-project #2); the lobby/state/anti-cheat (#3); the full battle
  UI (#4). Only the delegation consent + the backend signer + the two verifications here.

## Next
Spec review → writing-plans for this sub-project (verification-first task order) → build once the user's
Privy authorization key is in place.
