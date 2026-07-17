# Battle Royale Creation Allowlist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict who can *create* a Battle Royale to an env-configured wallet allowlist during launch week, enforced in the backend and reflected by hiding the create button in the frontend.

**Architecture:** A single `POST /pack-battles` endpoint creates both modes. We add an allowlist (a set of Privy embedded Solana addresses) injected into `create_app`; the royale branch returns 403 for wallets not in a non-empty allowlist, *before* any funds/escrow side effects. The frontend mirrors the allowlist via a public `VITE_` var and hides the "Create Battle Royale" CTA for non-allowed wallets. Empty allowlist = open (current behavior).

**Tech Stack:** Backend FastAPI + pydantic-settings + pytest/TestClient. Frontend React + Vite + Vitest + @testing-library/react.

## Global Constraints

- The allowlist address is the Privy **embedded** Solana wallet (`wallet_client_type == "privy"` / `connector_type == "embedded"`, `chain_type == "solana"`), **not** the connected/external wallet. Owner's launch value: `8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6`.
- **Empty allowlist = open to everyone** (back-compat) — in backend and frontend.
- Backend 403 is the real security boundary; the hidden button is cosmetic only.
- Only **royale creation** is gated. Pack Battle creation and all joins are untouched.
- Match is **exact, case-sensitive** (base58).
- Real wallet values live in `.env` (gitignored). Committed `.env.example` files carry an empty documented entry.
- Backend 403 message: `"La creación de Battle Royale está limitada durante el lanzamiento"`.

---

### Task 1: Backend gate — allowlist enforced in `POST /pack-battles` (royale branch)

**Files:**
- Modify: `backend/app/config.py` (add setting + parsed-set property)
- Modify: `backend/app/main.py:176-195` (add `create_app` param), `:196` area (normalize once), `:845` (enforce in royale branch), `:1404-1418` (wire in `build_default_app`)
- Test: `backend/tests/test_pack_lobby_api.py` (modify two app-builder helpers; add tests)

**Interfaces:**
- Produces: `create_app(..., royale_creator_allowlist: set[str] | None = None)` — new keyword param, default `None` (treated as empty = open).
- Produces: `Settings.royale_creator_allowlist: str = ""` and property `Settings.royale_creator_allowlist_set -> set[str]`.

- [ ] **Step 1: Add the config setting + parsed property**

In `backend/app/config.py`, add these lines inside `class Settings` (right after `withdraw_fee_pct: float = 0.01` at line 57):

```python
    # Launch week: restringe la CREACIÓN de Battle Royale a estas wallets (Privy embedded
    # Solana, base58, coma-separadas). Vacío = abierto a todos (comportamiento por defecto).
    # env: ROYALE_CREATOR_ALLOWLIST
    royale_creator_allowlist: str = ""

    @property
    def royale_creator_allowlist_set(self) -> set[str]:
        return {w.strip() for w in self.royale_creator_allowlist.split(",") if w.strip()}
```

- [ ] **Step 2: Write the failing parsing unit test**

Append to `backend/tests/test_pack_lobby_api.py`:

```python
def test_royale_creator_allowlist_parses_csv():
    from app.config import Settings
    s = Settings(royale_creator_allowlist="  A1 , B2 ,, C3 ")
    assert s.royale_creator_allowlist_set == {"A1", "B2", "C3"}
    assert Settings(royale_creator_allowlist="").royale_creator_allowlist_set == set()
```

- [ ] **Step 3: Run it — expect PASS (property already added in Step 1)**

Run: `cd backend && .venv/bin/pytest tests/test_pack_lobby_api.py::test_royale_creator_allowlist_parses_csv -v`
Expected: PASS. (This step validates the config change in isolation before touching the endpoint.)

- [ ] **Step 4: Add the `create_app` param and normalize it**

In `backend/app/main.py`, add the param to the `create_app` signature (after `winner_announce_mult: float = 4.0` at line 194, before the closing `) -> FastAPI:`):

```python
               winner_announce_mult: float = 4.0,
               royale_creator_allowlist: set[str] | None = None) -> FastAPI:
```

Then, just after `app = FastAPI(title="Battle Arena — Backend")` (line 196), add:

```python
    # Wallets allowed to CREATE Battle Royale (empty = open to all). Captured by the
    # /pack-battles handler below. See docs/.../2026-07-17-royale-create-allowlist-design.md.
    _royale_allow: set[str] = set(royale_creator_allowlist or ())
```

- [ ] **Step 5: Enforce the gate at the top of the royale branch**

In `backend/app/main.py`, in `create_pack_battle`, insert the check as the FIRST statement inside `if mode == "royale":` (line 845), before `buyin = royale_buyin(...)`:

```python
        if mode == "royale":
            if _royale_allow and wallet not in _royale_allow:
                raise HTTPException(403, "La creación de Battle Royale está limitada durante el lanzamiento")
            # For royale, the funds check is against the buy-in, not just the pack price.
            buyin = royale_buyin(body.max_players, price)
```

(Only the two new lines are added; the existing `buyin = ...` line and everything after it stay unchanged.)

- [ ] **Step 6: Wire the setting through `build_default_app`**

In `backend/app/main.py`, in the `create_app(...)` call inside `build_default_app` (ends at line 1418), add the argument after `winner_announce_mult=s.winner_announce_mult`:

```python
                      winner_announce_mult=s.winner_announce_mult,
                      royale_creator_allowlist=s.royale_creator_allowlist_set)
```

- [ ] **Step 7: Make the two test app-builders accept an allowlist**

In `backend/tests/test_pack_lobby_api.py`:

Change `_build_client`'s signature (line 86) to add the kwarg, and pass it into `create_app`:

```python
def _build_client(signer=None, dev_endpoints_enabled=False, withdraw_fee_pct=0.0, fee_wallet_address="",
                  royale_creator_allowlist=None):
```

and add this line inside its `create_app(...)` call (after `fee_wallet_address=fee_wallet_address,` at line 110):

```python
        fee_wallet_address=fee_wallet_address,
        royale_creator_allowlist=royale_creator_allowlist,
```

Change `_make_royale_app`'s signature (line 353) similarly:

```python
def _make_royale_app(escrow_created_list=None, escrow_address="So1anaESCROWXXXXXXXXXXXXXXXXXXXXXXXXXXX1",
                     royale_creator_allowlist=None):
```

and add this line inside its `create_app(...)` call (after `escrow_seed_lamports=10_000_000,` at line 386):

```python
        escrow_seed_lamports=10_000_000,
        royale_creator_allowlist=royale_creator_allowlist,
```

- [ ] **Step 8: Write the failing gate tests**

Append to `backend/tests/test_pack_lobby_api.py`:

```python
def test_royale_create_blocked_for_non_allowlisted_wallet(monkeypatch):
    """With an allowlist set, a wallet not on it gets 403 on royale create and NOTHING is charged/created."""
    async def _high_balance(*args, **kwargs):
        return 200_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    async def _fake_collect_buyin(*args, **kwargs):
        return "fake-sig"

    escrow_created = []
    # allowlist holds WALLET_B only; WALLET_A (below) is NOT allowed.
    c, priv = _make_royale_app(escrow_created_list=escrow_created, royale_creator_allowlist={WALLET_B})

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    monkeypatch.setattr("app.main.collect_buyin", _fake_collect_buyin)

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 5, "mode": "royale"}, headers=hdrs)
    assert r.status_code == 403, r.text
    assert escrow_created == [], "no escrow must be created when creation is blocked"


def test_royale_create_allowed_for_allowlisted_wallet(monkeypatch):
    """A wallet ON the allowlist can still create a royale."""
    async def _high_balance(*args, **kwargs):
        return 200_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    async def _fake_collect_buyin(*args, **kwargs):
        return "fake-sig"

    async def _fake_blockhash(rpc_url: str) -> str:
        return "FakeBH444444444444444444444444444444444444444"

    c, priv = _make_royale_app(royale_creator_allowlist={WALLET_A})

    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())
    monkeypatch.setattr("app.main.collect_buyin", _fake_collect_buyin)
    monkeypatch.setattr("app.main.fetch_latest_blockhash", _fake_blockhash)

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 5, "mode": "royale"}, headers=hdrs)
    assert r.status_code == 200, r.text


def test_pack_create_unaffected_by_royale_allowlist(client_priv, monkeypatch):
    """The royale allowlist does NOT gate Pack Battle creation."""
    async def _high_balance(*args, **kwargs):
        return 100_000_000

    async def _machines():
        return [{"code": "pokemon_50", "price": 50, "available": True}]

    # allowlist holds WALLET_B; WALLET_A creates a PACK battle → must still succeed.
    c, priv = _build_client(royale_creator_allowlist={WALLET_B})
    monkeypatch.setattr("app.main.usdc_balance_base_units", _high_balance)
    monkeypatch.setattr("app.services.gacha.GachaService.machines", lambda self: _machines())

    hdrs = _auth_headers(priv, WALLET_A, WALLET_ID_A)
    r = c.post("/pack-battles", json={"machine_code": "pokemon_50", "max_players": 2}, headers=hdrs)
    assert r.status_code == 200, r.text
```

(Back-compat "empty allowlist → royale open" is already covered by the existing `test_royale_create_returns_200_with_buyin_and_escrow`, which builds the app with no allowlist.)

- [ ] **Step 9: Run the backend suite**

Run: `cd backend && .venv/bin/pytest tests/test_pack_lobby_api.py -q`
Expected: PASS, including the three new gate tests and the existing royale/pack tests (no regressions).

- [ ] **Step 10: Commit**

```bash
git add backend/app/config.py backend/app/main.py backend/tests/test_pack_lobby_api.py
git commit -m "feat(royale): gate Battle Royale creation behind a wallet allowlist (backend)"
```

---

### Task 2: Frontend gate — hide the "Create Battle Royale" CTA for non-allowed wallets

**Files:**
- Modify: `src/onchain/config.ts` (parse `VITE_ROYALE_CREATOR_ALLOWLIST`; export `isRoyaleCreator` + `canCreateRoyale`)
- Modify: `src/ui/screens/Hub/QuickMatch.tsx` (add `canCreate` prop; conditionally render the CTA)
- Modify: `src/ui/screens/Hub/ModeHub.tsx:66-70` (pass `canCreate` for royale)
- Test: `src/onchain/config.test.ts` (new), `src/ui/screens/Hub/QuickMatch.test.tsx` (new)

**Interfaces:**
- Consumes: nothing from Task 1 (mirrors the same allowlist via a separate `VITE_` var).
- Produces: `isRoyaleCreator(wallet: string | null | undefined, allowlist: string[]): boolean` and `canCreateRoyale(wallet: string | null | undefined): boolean`, plus `config.royaleCreatorAllowlist: string[]`.
- Produces: `QuickMatch` prop `canCreate?: boolean` (default `true`).

- [ ] **Step 1: Add the parsed allowlist and helpers to `config.ts`**

In `src/onchain/config.ts`, add a property inside the `config` object (after `dasRpcUrl,` at line 65, before the closing `}`):

```typescript
  /**
   * Launch-week gate: wallets allowed to CREATE Battle Royale lobbies (Privy embedded
   * Solana addresses, comma-separated). Empty = open to everyone. Must mirror the backend
   * ROYALE_CREATOR_ALLOWLIST. env: VITE_ROYALE_CREATOR_ALLOWLIST
   */
  royaleCreatorAllowlist: ((import.meta.env.VITE_ROYALE_CREATOR_ALLOWLIST as string | undefined) ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
```

Then, after the closing `}` of the `config` export (after line 66), append:

```typescript

/** Pure: may this wallet create a Battle Royale, given the allowlist? Empty allowlist = open. */
export function isRoyaleCreator(wallet: string | null | undefined, allowlist: string[]): boolean {
  if (allowlist.length === 0) return true
  return !!wallet && allowlist.includes(wallet)
}

/** Bound to the configured allowlist. False while the wallet is still loading (fail-closed). */
export function canCreateRoyale(wallet: string | null | undefined): boolean {
  return isRoyaleCreator(wallet, config.royaleCreatorAllowlist)
}
```

- [ ] **Step 2: Write the failing helper unit test**

Create `src/onchain/config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { isRoyaleCreator } from './config'

describe('isRoyaleCreator', () => {
  it('is open to everyone (incl. null) when the allowlist is empty', () => {
    expect(isRoyaleCreator('AnyWallet', [])).toBe(true)
    expect(isRoyaleCreator(null, [])).toBe(true)
  })

  it('allows a wallet that is on the allowlist', () => {
    expect(isRoyaleCreator('WalletA', ['WalletA', 'WalletB'])).toBe(true)
  })

  it('rejects a wallet not on a non-empty allowlist', () => {
    expect(isRoyaleCreator('WalletC', ['WalletA'])).toBe(false)
  })

  it('rejects null/undefined when the allowlist is non-empty (fail-closed)', () => {
    expect(isRoyaleCreator(null, ['WalletA'])).toBe(false)
    expect(isRoyaleCreator(undefined, ['WalletA'])).toBe(false)
  })
})
```

- [ ] **Step 3: Run it to verify it passes**

Run: `npx vitest run src/onchain/config.test.ts`
Expected: PASS (the helper was added in Step 1).

- [ ] **Step 4: Add the `canCreate` prop to `QuickMatch`**

In `src/ui/screens/Hub/QuickMatch.tsx`, extend `Props` (lines 19-24):

```typescript
interface Props {
  mode?: QuickMode
  onCreate: () => void
  /** When omitted, the free-demo link is hidden (e.g. Battle Royale has no demo). */
  onPlayDemo?: () => void
  /** When false, the create CTA is hidden (e.g. Battle Royale creation gated during launch). */
  canCreate?: boolean
}
```

Update the destructure (lines 26-30):

```typescript
export function QuickMatch({
  mode = 'pack',
  onCreate,
  onPlayDemo,
  canCreate = true,
}: Props) {
```

Wrap the create `<button>` (lines 88-114) in the `canCreate` guard — change the opening from `<button` to `{canCreate && (\n<button` and close it after the button's `</button>`:

```typescript
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
          {canCreate && (
            <button
              onClick={onCreate}
              style={{
                position: 'relative',
                overflow: 'hidden',
                background: GRADIENT,
                color: '#06120c',
                border: 'none',
                borderRadius: 12,
                padding: '14px 28px',
                fontFamily: FONTS.display,
                fontWeight: 800,
                fontSize: 14.5,
                cursor: 'pointer',
              }}
            >
              <span style={{ position: 'relative', zIndex: 1 }}>{copy.cta}</span>
              <span
                aria-hidden
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent)',
                  animation: reducedMotion ? 'none' : 'ba-sweep 3.4s infinite',
                }}
              />
            </button>
          )}
          {onPlayDemo && (
```

(The `onPlayDemo` block and the rest are unchanged.)

- [ ] **Step 5: Write the failing render test**

Create `src/ui/screens/Hub/QuickMatch.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuickMatch } from './QuickMatch'

describe('QuickMatch royale create gate', () => {
  it('shows the create CTA by default', () => {
    render(<QuickMatch mode="royale" onCreate={() => {}} />)
    expect(screen.queryByRole('button')).not.toBeNull()
  })

  it('hides the create CTA when canCreate is false', () => {
    render(<QuickMatch mode="royale" onCreate={() => {}} canCreate={false} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
```

- [ ] **Step 6: Run the render test**

Run: `npx vitest run src/ui/screens/Hub/QuickMatch.test.tsx`
Expected: PASS.

- [ ] **Step 7: Wire `ModeHub` to pass `canCreate` for royale**

In `src/ui/screens/Hub/ModeHub.tsx`, add the import near the other `onchain` imports (after line 12):

```typescript
import { canCreateRoyale } from '../../../onchain/config'
```

Update the `<QuickMatch>` usage (lines 66-70):

```typescript
      <QuickMatch
        mode={mode}
        onCreate={() => setCreateOpen(true)}
        onPlayDemo={mode === 'pack' ? () => setDemoOpen(true) : undefined}
        canCreate={mode === 'royale' ? canCreateRoyale(meWallet) : true}
      />
```

- [ ] **Step 8: Typecheck + run the Hub tests**

Run: `npx tsc -b --noEmit && npx vitest run src/onchain/config.test.ts src/ui/screens/Hub/QuickMatch.test.tsx`
Expected: no TS errors; all tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/onchain/config.ts src/onchain/config.test.ts src/ui/screens/Hub/QuickMatch.tsx src/ui/screens/Hub/QuickMatch.test.tsx src/ui/screens/Hub/ModeHub.tsx
git commit -m "feat(royale): hide Create Battle Royale CTA for non-allowlisted wallets"
```

---

### Task 3: Activate via env + end-to-end verification

**Files:**
- Modify: `.env` (root, gitignored), `.env.example` (root, committed)
- Modify: `backend/.env` (gitignored), `backend/.env.example` (committed)

**Interfaces:**
- Consumes: `Settings.royale_creator_allowlist` (Task 1), `config.royaleCreatorAllowlist` (Task 2).

- [ ] **Step 1: Set the real value in the gitignored env files**

Append to `backend/.env`:

```
ROYALE_CREATOR_ALLOWLIST=8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6
```

Append to the root `.env`:

```
VITE_ROYALE_CREATOR_ALLOWLIST=8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6
```

- [ ] **Step 2: Document the vars in the committed example files**

Append to `backend/.env.example`:

```
# Launch week: solo estas wallets (Privy embedded Solana, coma-separadas) pueden CREAR Battle
# Royale. Vacío = abierto a todos. Debe coincidir con VITE_ROYALE_CREATOR_ALLOWLIST del frontend.
ROYALE_CREATOR_ALLOWLIST=
```

Append to the root `.env.example`:

```
# Launch week: wallets (Privy embedded Solana, coma-separadas) que pueden CREAR Battle Royale.
# Vacío = abierto a todos. Debe coincidir con ROYALE_CREATOR_ALLOWLIST del backend.
VITE_ROYALE_CREATOR_ALLOWLIST=
```

- [ ] **Step 3: Restart both services so the new env is loaded**

Restart the backend (port 9090) and the Vite dev server (5173) — env changes are read at process start (backend) and at Vite server start (frontend).

- [ ] **Step 4: Verify the backend 403 (source of truth)**

The three backend tests from Task 1 already prove the gate. As a live smoke check that the env value is actually loaded, confirm the setting parses at runtime:

Run: `cd backend && .venv/bin/python -c "from app.config import get_settings; print(get_settings().royale_creator_allowlist_set)"`
Expected: `{'8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6'}`

- [ ] **Step 5: Verify the frontend button visibility**

Log into http://localhost:5173 with the owner account (embedded wallet `8QDBKx8P…jkgtm6`), open the Battle Royale mode page (`/play/royale`) → the "Create Battle Royale" button IS visible. (Optional negative check: temporarily set `VITE_ROYALE_CREATOR_ALLOWLIST` to a different address, restart Vite, reload → the button is gone; then restore.)

- [ ] **Step 6: Commit the example files**

```bash
git add .env.example backend/.env.example
git commit -m "chore(royale): document ROYALE_CREATOR_ALLOWLIST env vars"
```

(The gitignored `.env` / `backend/.env` carry the real value and are not committed.)

---

## Self-Review

**Spec coverage:**
- Backend config setting + parsed set → Task 1 Step 1. ✓
- 403 enforcement before side effects, royale branch only → Task 1 Step 5 (+ test Step 8 asserts no escrow). ✓
- Pack + join untouched → Task 1 Step 8 `test_pack_create_unaffected_by_royale_allowlist`. ✓
- Empty allowlist = open (back-compat) → existing royale test + helper unit tests. ✓
- Frontend `VITE_` var + `canCreateRoyale` helper → Task 2 Steps 1-3. ✓
- Hide CTA in ModeHub/QuickMatch, no replacement text, fail-closed on null wallet → Task 2 Steps 4-7. ✓
- Two lists in sync via env, real value in gitignored `.env`, documented example → Task 3. ✓
- Manual reopen / rollback = empty both env vars + restart → covered by the "empty = open" behavior (no code path needed). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `royale_creator_allowlist` (str) vs `royale_creator_allowlist_set` (set) vs `create_app(royale_creator_allowlist: set[str] | None)` — the factory passes the parsed `set`; tests pass a `set` literal; consistent. Frontend `royaleCreatorAllowlist: string[]`, `isRoyaleCreator(wallet, allowlist)`, `canCreateRoyale(wallet)`, `QuickMatch canCreate?: boolean` — names match across Task 2 steps. ✓

## Notes / risks

- Fail-closed timing: while Privy is still resolving `meWallet` (null), `canCreateRoyale(null)` returns false with a non-empty allowlist, so the owner sees no button for a brief moment during load, then it appears. Acceptable.
- Frontend and backend allowlists are two separate env vars that must be kept in sync; trivial for one wallet during one week.
