# Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the topbar Log out button with a Profile button + dropdown that routes to a `/profile` page (Overview / Inventory / Settings), where the user sets a unique username shown instead of their wallet across the app.

**Architecture:** Backend reuses the existing `User.alias` plumbing — add uniqueness/validation and make the chat resolve the alias at connect. Frontend adds a `/profile` route under `GameLayout`, a Profile dropdown in `AuthButtons`, and an on-chain Inventory that scans both linked Solana wallets via a thin DAS client (mirroring MarketAgg) filtered to the Collector Crypt collection.

**Tech Stack:** FastAPI + SQLAlchemy + pytest (backend); React + Vite + TS + react-router-dom v7 + vitest (frontend); Privy (`usePrivy`, `useIdentityToken`, `linkedAccounts`); Solana DAS JSON-RPC (`getAssetsByOwner`).

**Test conventions:** Backend = full TDD with pytest (`backend/.venv/bin/python -m pytest`). Frontend = TDD on **pure helpers** with vitest (`npm test`), matching the codebase (e.g. `sumUsdc`); hooks/components are implemented without render tests, consistent with the existing repo.

---

## Task 1: Backend — unique username (validation + 409)

**Files:**
- Modify: `backend/app/main.py` (the `AliasBody` model + `me_alias` endpoint)
- Modify: `backend/app/services/users.py` (`set_alias` + new `AliasTakenError`)
- Modify: `backend/app/models.py` (case-insensitive unique index)
- Test: `backend/tests/test_api.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_api.py` (use existing helpers `make_es256`, `make_id_token`, `solana_embedded`, and the app factory pattern already used in that file; if `test_api.py` has its own app factory, reuse it — otherwise mirror `test_chat.py::_chat_app`). New test:

```python
def test_alias_must_be_unique_case_insensitive():
    app, priv = _api_app()  # reuse the file's app factory (PrivyVerifier injected)
    client = TestClient(app)
    wa = "WalletAAAA1111111111111111111111111111111111"
    wb = "WalletBBBB2222222222222222222222222222222222"
    tok_a = make_id_token(priv, APP_ID, [solana_embedded(wa)])
    tok_b = make_id_token(priv, APP_ID, [solana_embedded(wb)])

    r1 = client.post("/users/me/alias", json={"alias": "Neo"},
                     headers={"Authorization": f"Bearer {tok_a}"})
    assert r1.status_code == 200

    # Same name, different case, different wallet → taken
    r2 = client.post("/users/me/alias", json={"alias": "neo"},
                     headers={"Authorization": f"Bearer {tok_b}"})
    assert r2.status_code == 409
    assert r2.json()["detail"] == "username_taken"


def test_alias_rejects_bad_charset_and_length():
    app, priv = _api_app()
    client = TestClient(app)
    wa = "WalletAAAA1111111111111111111111111111111111"
    tok = make_id_token(priv, APP_ID, [solana_embedded(wa)])
    for bad in ["ab", "a" * 21, "has space", "emoji😀", "dash-no"]:
        r = client.post("/users/me/alias", json={"alias": bad},
                        headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 422, bad


def test_alias_same_wallet_can_keep_its_name():
    app, priv = _api_app()
    client = TestClient(app)
    wa = "WalletAAAA1111111111111111111111111111111111"
    tok = make_id_token(priv, APP_ID, [solana_embedded(wa)])
    h = {"Authorization": f"Bearer {tok}"}
    assert client.post("/users/me/alias", json={"alias": "Trinity"}, headers=h).status_code == 200
    # Re-saving the same name as the same wallet must NOT 409
    assert client.post("/users/me/alias", json={"alias": "Trinity"}, headers=h).status_code == 200
```

If `test_api.py` lacks `_api_app()`/`APP_ID`, add them at the top of the file mirroring `test_chat.py::_chat_app` (same in-memory engine + `PrivyVerifier(key_resolver=...)`), and `from tests.conftest import make_es256, make_id_token, solana_embedded`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_api.py -k "alias" -v`
Expected: FAIL (uniqueness not enforced → `r2` is 200; charset test → 200 not 422).

- [ ] **Step 3: Tighten the request model**

In `backend/app/main.py`, change `AliasBody`:

```python
class AliasBody(BaseModel):
    alias: str = Field(min_length=3, max_length=20, pattern=r"^[A-Za-z0-9_]+$")
```

- [ ] **Step 4: Add uniqueness in the service**

In `backend/app/services/users.py`, add the error class and the check:

```python
from sqlalchemy import select, desc, func


class AliasTakenError(Exception):
    """Otro usuario ya tiene ese username (case-insensitive)."""


def set_alias(session: Session, wallet: str, alias: str) -> None:
    user = session.get(User, wallet)
    if user is None:
        raise ValueError("usuario no existe")
    clash = session.scalar(
        select(User).where(func.lower(User.alias) == alias.lower(), User.wallet != wallet)
    )
    if clash is not None:
        raise AliasTakenError(alias)
    user.alias = alias
```

- [ ] **Step 5: Map the error to 409 in the endpoint**

In `backend/app/main.py`, update the import and the endpoint:

```python
from .services.users import (
    get_or_create_user, read_user_view, set_alias, leaderboard, history, AliasTakenError,
)
```

```python
    @app.post("/users/me/alias")
    async def me_alias(body: AliasBody, wallet: str = Depends(current_user), s: Session = Depends(db)):
        get_or_create_user(s, wallet, elo_start)
        try:
            set_alias(s, wallet, body.alias)
        except AliasTakenError:
            raise HTTPException(409, "username_taken")
        s.commit()
        return {"wallet": wallet, "alias": body.alias}
```

- [ ] **Step 6: Add the defense-in-depth unique index**

In `backend/app/models.py`, import and declare on `User`:

```python
from sqlalchemy import String, Integer, Boolean, DateTime, Index, func
```

Add inside the `User` class (after the columns):

```python
    __table_args__ = (
        Index("ux_users_alias_lower", func.lower(alias), unique=True),
    )
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_api.py -k "alias" -v`
Expected: PASS (3 tests).

- [ ] **Step 8: Run the full backend suite (no regressions)**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add backend/app/main.py backend/app/services/users.py backend/app/models.py backend/tests/test_api.py
git commit -m "feat(users): username único (409 username_taken) + validación 3-20/[A-Za-z0-9_]"
```

---

## Task 2: Backend — chat broadcasts the username

**Files:**
- Modify: `backend/app/main.py` (`ws_chat`)
- Test: `backend/tests/test_chat.py`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_chat.py`:

```python
def test_ws_chat_shows_alias_when_set():
    """Si el wallet tiene alias, el chat emite el alias como `user`, no el wallet abreviado."""
    app, priv = _chat_app()
    token = make_id_token(priv, APP_ID, [solana_embedded(WALLET)])
    client = TestClient(app)
    # set alias for this wallet via the authed endpoint
    assert client.post("/users/me/alias", json={"alias": "Morpheus"},
                       headers={"Authorization": f"Bearer {token}"}).status_code == 200

    with client.websocket_connect(f"/ws/chat?token={token}") as ws:
        ws.receive_json()  # history
        ws.receive_json()  # presence(1)
        ws.send_json({"text": "hi"})
        msg = ws.receive_json()
        assert msg["type"] == "message"
        assert msg["user"] == "Morpheus"


def test_ws_chat_falls_back_to_abbreviated_wallet():
    """Sin alias, el chat emite el wallet abreviado."""
    app, priv = _chat_app()
    token = make_id_token(priv, APP_ID, [solana_embedded(WALLET)])
    client = TestClient(app)
    with client.websocket_connect(f"/ws/chat?token={token}") as ws:
        ws.receive_json()  # history
        ws.receive_json()  # presence(1)
        ws.send_json({"text": "hi"})
        msg = ws.receive_json()
        assert msg["user"] == abbreviate(WALLET)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_chat.py -k "alias or abbreviated" -v`
Expected: `test_ws_chat_shows_alias_when_set` FAILS (msg["user"] == abbreviate(WALLET), not "Morpheus"); the fallback test passes.

- [ ] **Step 3: Resolve the display name at connect**

In `backend/app/main.py`, inside `ws_chat`, after the `wallet` is resolved and before the receive loop, compute a display name and use it when broadcasting. Replace the message-build line:

```python
        await _chat_mgr.connect(ws)
        # Nombre a mostrar: alias del usuario si lo tiene, si no el wallet abreviado.
        display_name = abbreviate(wallet) if wallet else None
        if wallet:
            s = session_factory()
            try:
                alias = read_user_view(s, wallet, elo_start).get("alias")
                if alias:
                    display_name = alias
            finally:
                s.close()
```

Then change the broadcast message to use `display_name`:

```python
                msg = {"user": display_name, "text": text, "ts": int(_time.time())}
```

(`read_user_view`, `abbreviate`, and `session_factory` are all already in scope in `create_app`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/python -m pytest tests/test_chat.py -v`
Expected: all chat tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py backend/tests/test_chat.py
git commit -m "feat(chat): muestra el username (alias) en lugar del wallet abreviado"
```

---

## Task 3: Frontend — config (CC collection mint + DAS RPC)

**Files:**
- Modify: `src/onchain/config.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add config fields**

In `src/onchain/config.ts`, inside the exported `config` object, add:

```ts
  /**
   * Collector Crypt verified collection mint (DAS `grouping` group_value). Used to
   * filter the on-chain inventory to CC cards only. Defaults to the known mainnet
   * collection; override with the devnet collection when available.
   */
  ccCollectionMint:
    import.meta.env.VITE_CC_COLLECTION_MINT ?? 'CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf',
  /**
   * DAS-capable RPC (e.g. Helius) for reading NFTs via getAssetsByOwner. Falls back
   * to the regular Solana RPC (public devnet does not support DAS → empty inventory).
   */
  dasRpcUrl:
    (import.meta.env.VITE_DAS_RPC as string | undefined) ??
    (import.meta.env.VITE_SOLANA_RPC as string | undefined) ??
    'https://api.devnet.solana.com',
```

- [ ] **Step 2: Document in .env.example**

Append to `.env.example`:

```
# Collector Crypt collection mint (DAS grouping) used to filter the Inventory tab.
# Default is the mainnet collection; set the devnet collection mint when available.
VITE_CC_COLLECTION_MINT=CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf
# DAS-capable RPC (Helius) for reading NFTs. Falls back to VITE_SOLANA_RPC.
VITE_DAS_RPC=
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/onchain/config.ts .env.example
git commit -m "chore(config): VITE_CC_COLLECTION_MINT y VITE_DAS_RPC para el inventario"
```

---

## Task 4: Frontend — DAS client + pure helpers

**Files:**
- Create: `src/inventory/dasClient.ts`
- Test: `src/inventory/dasClient.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/inventory/dasClient.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filterCollectorCryptAssets, dasAssetToCard, getAssetsByOwner } from './dasClient'

const CC = 'CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf'

beforeEach(() => vi.restoreAllMocks())

describe('filterCollectorCryptAssets', () => {
  it('mantiene solo los assets con grouping de la colección CC', () => {
    const assets = [
      { id: 'a', grouping: [{ group_key: 'collection', group_value: CC }] },
      { id: 'b', grouping: [{ group_key: 'collection', group_value: 'Other' }] },
      { id: 'c' },
    ]
    const out = filterCollectorCryptAssets(assets as any, CC)
    expect(out.map((a) => a.id)).toEqual(['a'])
  })
})

describe('dasAssetToCard', () => {
  it('extrae mint, name, image e insuredValue de attributes', () => {
    const card = dasAssetToCard({
      id: 'mint1',
      content: {
        metadata: { name: 'Charizard', attributes: [{ trait_type: 'Insured Value', value: '1200' }] },
        links: { image: 'http://img/x.png' },
      },
    } as any)
    expect(card).toEqual({ mint: 'mint1', name: 'Charizard', image: 'http://img/x.png', insuredValue: 1200 })
  })

  it('usa fallbacks cuando faltan campos', () => {
    const card = dasAssetToCard({ id: 'mint2' } as any)
    expect(card).toEqual({ mint: 'mint2', name: 'Unnamed', image: null, insuredValue: null })
  })
})

describe('getAssetsByOwner', () => {
  it('hace POST JSON-RPC y devuelve result.items', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { items: [{ id: 'a' }] } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    const items = await getAssetsByOwner('https://rpc', 'OWNER')
    expect(items).toEqual([{ id: 'a' }])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.method).toBe('getAssetsByOwner')
    expect(body.params.ownerAddress).toBe('OWNER')
  })

  it('devuelve [] si la RPC no soporta DAS (error)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ error: { message: 'Method not found' } }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await getAssetsByOwner('https://rpc', 'OWNER')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/inventory/dasClient.test.ts`
Expected: FAIL ("does not provide an export named ...").

- [ ] **Step 3: Implement the client**

Create `src/inventory/dasClient.ts`:

```ts
export interface DasGrouping {
  group_key: string
  group_value: string
}

export interface DasAsset {
  id: string
  grouping?: DasGrouping[]
  content?: {
    metadata?: { name?: string; attributes?: Array<{ trait_type?: string; value?: unknown }> }
    links?: { image?: string }
  }
}

export interface InventoryCard {
  mint: string
  name: string
  image: string | null
  insuredValue: number | null
}

/** Keep only assets that belong to the given Collector Crypt collection (DAS grouping). */
export function filterCollectorCryptAssets(assets: DasAsset[], collectionMint: string): DasAsset[] {
  return assets.filter((a) =>
    (a.grouping ?? []).some((g) => g.group_key === 'collection' && g.group_value === collectionMint),
  )
}

/** Map a DAS asset to a display card, with safe fallbacks. */
export function dasAssetToCard(a: DasAsset): InventoryCard {
  const md = a.content?.metadata
  const attrs = md?.attributes ?? []
  const insuredAttr = attrs.find((t) => /insured/i.test(t.trait_type ?? ''))
  const insuredValue = insuredAttr != null ? Number(insuredAttr.value) : NaN
  return {
    mint: a.id,
    name: md?.name ?? 'Unnamed',
    image: a.content?.links?.image ?? null,
    insuredValue: Number.isFinite(insuredValue) ? insuredValue : null,
  }
}

/**
 * Fetch all assets owned by `owner` via the DAS getAssetsByOwner JSON-RPC method.
 * Returns [] when the RPC doesn't support DAS or on any error (caller shows empty-state).
 */
export async function getAssetsByOwner(rpcUrl: string, owner: string): Promise<DasAsset[]> {
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'inv',
        method: 'getAssetsByOwner',
        params: { ownerAddress: owner, page: 1, limit: 1000 },
      }),
    })
    if (!resp.ok) return []
    const json = (await resp.json()) as { result?: { items?: DasAsset[] }; error?: unknown }
    if (json.error || !json.result?.items) return []
    return json.result.items
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/inventory/dasClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inventory/dasClient.ts src/inventory/dasClient.test.ts
git commit -m "feat(inventory): DAS client (getAssetsByOwner) + filtro de colección CC"
```

---

## Task 5: Frontend — linked Solana wallets helper

**Files:**
- Modify: `src/wallet/embedded.ts`
- Test: `src/wallet/embedded.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/wallet/embedded.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { pickLinkedSolanaWallets } from './embedded'

describe('pickLinkedSolanaWallets', () => {
  it('clasifica embedded (privy) y connected (Phantom), ignora no-solana, dedup', () => {
    const accounts = [
      { type: 'email', address: 'a@b.c' },
      { type: 'wallet', chainType: 'ethereum', walletClientType: 'metamask', address: '0xabc' },
      { type: 'wallet', chainType: 'solana', walletClientType: 'Phantom', address: 'PHAN' },
      { type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: 'EMB' },
      { type: 'wallet', chainType: 'solana', walletClientType: 'privy', address: 'EMB' }, // dup
    ]
    expect(pickLinkedSolanaWallets(accounts as any)).toEqual([
      { address: 'PHAN', source: 'connected' },
      { address: 'EMB', source: 'embedded' },
    ])
  })

  it('devuelve [] sin cuentas', () => {
    expect(pickLinkedSolanaWallets([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/wallet/embedded.test.ts`
Expected: FAIL (no export `pickLinkedSolanaWallets`).

- [ ] **Step 3: Implement the helper + hook**

In `src/wallet/embedded.ts`, add (keep the existing `useEmbeddedSolanaAddress`):

```ts
export interface LinkedSolanaWallet {
  address: string
  source: 'embedded' | 'connected'
}

/** Pure: classify all linked Solana wallets as embedded (Privy) or connected (external). */
export function pickLinkedSolanaWallets(accounts: WalletAccountLike[]): LinkedSolanaWallet[] {
  const out: LinkedSolanaWallet[] = []
  const seen = new Set<string>()
  for (const a of accounts) {
    if (a.type !== 'wallet' || a.chainType !== 'solana' || !a.address) continue
    if (seen.has(a.address)) continue
    seen.add(a.address)
    const isEmbedded = a.walletClientType === 'privy' || a.connectorType === 'embedded'
    out.push({ address: a.address, source: isEmbedded ? 'embedded' : 'connected' })
  }
  return out
}

/** All linked Solana wallets (embedded + connected) for the current user. */
export function useLinkedSolanaWallets(): LinkedSolanaWallet[] {
  const { user } = usePrivy()
  const accounts = (user?.linkedAccounts ?? []) as unknown as WalletAccountLike[]
  return pickLinkedSolanaWallets(accounts)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/wallet/embedded.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wallet/embedded.ts src/wallet/embedded.test.ts
git commit -m "feat(wallet): pickLinkedSolanaWallets + useLinkedSolanaWallets (embedded + connected)"
```

---

## Task 6: Frontend — username validation + stats helpers

**Files:**
- Create: `src/profile/username.ts`
- Create: `src/profile/stats.ts`
- Test: `src/profile/profileHelpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/profile/profileHelpers.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { validateUsername } from './username'
import { countResults } from './stats'

describe('validateUsername', () => {
  it('acepta 3-20 chars alfanuméricos y _', () => {
    expect(validateUsername('Neo_99')).toBeNull()
  })
  it('rechaza demasiado corto/largo y caracteres inválidos', () => {
    expect(validateUsername('ab')).toMatch(/3/)
    expect(validateUsername('a'.repeat(21))).toMatch(/20/)
    expect(validateUsername('has space')).toMatch(/letters|caracteres|invalid/i)
    expect(validateUsername('dash-no')).toMatch(/letters|caracteres|invalid/i)
  })
})

describe('countResults', () => {
  it('cuenta wins/losses/draws', () => {
    const rows = [{ result: 'win' }, { result: 'win' }, { result: 'loss' }, { result: 'draw' }]
    expect(countResults(rows)).toEqual({ wins: 2, losses: 1, draws: 1 })
  })
  it('vacío → ceros', () => {
    expect(countResults([])).toEqual({ wins: 0, losses: 0, draws: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/profile/profileHelpers.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the helpers**

Create `src/profile/username.ts`:

```ts
/** Returns an error message if the username is invalid, or null if valid. */
export function validateUsername(name: string): string | null {
  if (name.length < 3) return 'Username must be at least 3 characters.'
  if (name.length > 20) return 'Username must be at most 20 characters.'
  if (!/^[A-Za-z0-9_]+$/.test(name)) return 'Only letters, numbers and underscore are allowed.'
  return null
}
```

Create `src/profile/stats.ts`:

```ts
export interface HistoryRow {
  result: string
}

export function countResults(rows: HistoryRow[]): { wins: number; losses: number; draws: number } {
  let wins = 0,
    losses = 0,
    draws = 0
  for (const r of rows) {
    if (r.result === 'win') wins++
    else if (r.result === 'loss') losses++
    else if (r.result === 'draw') draws++
  }
  return { wins, losses, draws }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/profile/profileHelpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/profile/username.ts src/profile/stats.ts src/profile/profileHelpers.test.ts
git commit -m "feat(profile): helpers validateUsername + countResults"
```

---

## Task 7: Frontend — data hooks (useProfile, useCollectorCryptNfts)

**Files:**
- Create: `src/hooks/useProfile.ts`
- Create: `src/inventory/useCollectorCryptNfts.ts`

(No unit tests — these are thin hooks over already-tested helpers, consistent with the repo's `useUsdcBalance`. Verified via typecheck + manual use in the page.)

- [ ] **Step 1: Implement useProfile**

Create `src/hooks/useProfile.ts`:

```ts
import { useCallback, useEffect, useState } from 'react'
import { useEmbeddedSolanaAddress } from '../wallet/embedded'
import { config } from '../onchain/config'

export interface ProfileData {
  username: string | null
  elo: number | null
  gamesPlayed: number | null
}

export function useProfile(): ProfileData & { loading: boolean; refresh: () => void } {
  const address = useEmbeddedSolanaAddress()
  const [data, setData] = useState<ProfileData>({ username: null, elo: null, gamesPlayed: null })
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!address) {
      setData({ username: null, elo: null, gamesPlayed: null })
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`${config.backendUrl}/users/${encodeURIComponent(address)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => {
        if (cancelled || !u) return
        setData({ username: u.alias ?? null, elo: u.elo ?? null, gamesPlayed: u.games_played ?? null })
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [address, nonce])

  return { ...data, loading, refresh }
}
```

- [ ] **Step 2: Implement useCollectorCryptNfts**

Create `src/inventory/useCollectorCryptNfts.ts`:

```ts
import { useEffect, useState } from 'react'
import { useLinkedSolanaWallets } from '../wallet/embedded'
import { config } from '../onchain/config'
import { getAssetsByOwner, filterCollectorCryptAssets, dasAssetToCard, type InventoryCard } from './dasClient'

export interface OwnedCard extends InventoryCard {
  source: 'embedded' | 'connected'
}

export function useCollectorCryptNfts(): { cards: OwnedCard[]; loading: boolean } {
  const wallets = useLinkedSolanaWallets()
  const [cards, setCards] = useState<OwnedCard[]>([])
  const [loading, setLoading] = useState(false)
  // Stable dependency key so the effect doesn't loop on array identity.
  const key = wallets.map((w) => `${w.source}:${w.address}`).join(',')

  useEffect(() => {
    if (wallets.length === 0) {
      setCards([])
      return
    }
    let cancelled = false
    setLoading(true)
    Promise.all(
      wallets.map(async (w) => {
        const assets = await getAssetsByOwner(config.dasRpcUrl, w.address)
        return filterCollectorCryptAssets(assets, config.ccCollectionMint).map((a) => ({
          ...dasAssetToCard(a),
          source: w.source,
        }))
      }),
    )
      .then((groups) => {
        if (!cancelled) setCards(groups.flat())
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { cards, loading }
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add src/hooks/useProfile.ts src/inventory/useCollectorCryptNfts.ts
git commit -m "feat(profile): hooks useProfile y useCollectorCryptNfts"
```

---

## Task 8: Frontend — Profile button + dropdown in AuthButtons

**Files:**
- Modify: `src/ui/components/AuthButtons.tsx`

- [ ] **Step 1: Implement the dropdown**

Rewrite the authenticated branch of `src/ui/components/AuthButtons.tsx`. Add imports at the top:

```ts
import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useProfile } from '../../hooks/useProfile'
```

Inside `AuthButtons`, after `const isCompact = ...`, add:

```ts
  const navigate = useNavigate()
  const { username } = useProfile()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
```

Replace the authenticated `return (...)` block (the account chip + Log out button) with a Profile button that toggles a dropdown:

```tsx
  const emailAddr = user?.email?.address
  const walletAddr = user?.wallet?.address
  const displayName = username ?? emailAddr ?? (walletAddr ? abbrevAddr(walletAddr) : 'Account')

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title={emailAddr ?? walletAddr ?? undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: '#11161f',
          border: `1px solid ${COLORS.border}`,
          borderRadius: '10px',
          padding: isCompact ? '6px 12px' : '8px 14px',
          fontSize: isCompact ? '11px' : '13px',
          fontFamily: FONTS.mono,
          color: COLORS.text,
          maxWidth: isCompact ? '160px' : '220px',
          cursor: 'pointer',
        }}
      >
        <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: COLORS.green, flexShrink: 0 }} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
        <span style={{ marginLeft: 2, color: COLORS.muted, fontSize: 10 }}>▾</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            minWidth: 160,
            background: '#11161f',
            border: `1px solid ${COLORS.border}`,
            borderRadius: 10,
            padding: 6,
            zIndex: 50,
            boxShadow: '0 8px 24px #00000066',
          }}
        >
          <button
            onClick={() => {
              setOpen(false)
              navigate('/profile')
            }}
            style={menuItemStyle}
          >
            View profile
          </button>
          <button
            onClick={() => {
              setOpen(false)
              void logout()
            }}
            style={{ ...menuItemStyle, color: COLORS.muted }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  )
```

Add this style constant just above the `AuthButtons` function:

```ts
const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  background: 'transparent',
  border: 'none',
  color: '#e9edf5',
  borderRadius: 7,
  padding: '9px 11px',
  fontSize: 13,
  fontFamily: 'Inter, system-ui, sans-serif',
  cursor: 'pointer',
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify build + existing tests still pass**

Run: `npm test -- src/onchain` then `npx tsc --noEmit`
Expected: green (no AuthButtons render test exists; we rely on typecheck).

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/AuthButtons.tsx
git commit -m "feat(auth): botón Profile con dropdown (View profile / Log out) en lugar de Log out"
```

---

## Task 9: Frontend — /profile route + ProfilePage shell

**Files:**
- Modify: `src/App.tsx`
- Create: `src/ui/screens/Profile/ProfilePage.tsx`

- [ ] **Step 1: Add the route**

In `src/App.tsx`, import the page and add the route inside the existing `<Route element={<GameLayout />}>` group:

```tsx
import { ProfilePage } from './ui/screens/Profile/ProfilePage'
```

```tsx
        <Route element={<GameLayout />}>
          <Route path="/play/mana" element={<ManaDuelFlow />} />
          <Route path="/play/royale" element={<RoyaleFlow />} />
          <Route path="/play/arena" element={<OnchainFlow />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
```

- [ ] **Step 2: Create the page shell with tabs**

Create `src/ui/screens/Profile/ProfilePage.tsx`:

```tsx
import { useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { OverviewTab } from './OverviewTab'
import { InventoryTab } from './InventoryTab'
import { SettingsTab } from './SettingsTab'

type Tab = 'overview' | 'inventory' | 'settings'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'inventory', label: 'Inventory' },
  { key: 'settings', label: 'Settings' },
]

export function ProfilePage() {
  const [tab, setTab] = useState<Tab>('overview')
  return (
    <div style={{ maxWidth: 880, width: '100%', margin: '0 auto', padding: '28px 22px' }}>
      <h1 style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 26, margin: '0 0 18px' }}>Profile</h1>

      <div style={{ display: 'flex', gap: 6, borderBottom: `1px solid ${COLORS.border}`, marginBottom: 22 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: tab === t.key ? `2px solid ${COLORS.green}` : '2px solid transparent',
              color: tab === t.key ? COLORS.text : COLORS.muted,
              fontFamily: FONTS.body,
              fontWeight: 700,
              fontSize: 14,
              padding: '10px 14px',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'inventory' && <InventoryTab />}
      {tab === 'settings' && <SettingsTab />}
    </div>
  )
}
```

- [ ] **Step 3: Create compilable stubs for the three tabs**

So this task compiles on its own (Tasks 10–12 replace each stub with the real component). Create:

`src/ui/screens/Profile/OverviewTab.tsx`:

```tsx
export function OverviewTab() {
  return null
}
```

`src/ui/screens/Profile/InventoryTab.tsx`:

```tsx
export function InventoryTab() {
  return null
}
```

`src/ui/screens/Profile/SettingsTab.tsx`:

```tsx
export function SettingsTab() {
  return null
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/ui/screens/Profile/ProfilePage.tsx src/ui/screens/Profile/OverviewTab.tsx src/ui/screens/Profile/InventoryTab.tsx src/ui/screens/Profile/SettingsTab.tsx
git commit -m "feat(profile): ruta /profile + shell con pestañas (stubs)"
```

> Tasks 10–12 each **overwrite** their stub (use Write, not Edit) with the real component and commit. Adjust their `git add`/commit accordingly; the "(or defer to Task 12)" notes there become a normal per-task commit.

---

## Task 10: Frontend — Overview tab

**Files:**
- Create: `src/ui/screens/Profile/OverviewTab.tsx`

- [ ] **Step 1: Implement**

Create `src/ui/screens/Profile/OverviewTab.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { COLORS, FONTS } from '../../theme'
import { useProfile } from '../../../hooks/useProfile'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { config } from '../../../onchain/config'
import { countResults } from '../../../profile/stats'

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: '#161b24', border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: '16px 18px', flex: 1 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.14em', color: COLORS.muted }}>{label}</div>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 24, color: COLORS.text, marginTop: 6 }}>{value}</div>
    </div>
  )
}

export function OverviewTab() {
  const { username, elo, gamesPlayed } = useProfile()
  const address = useEmbeddedSolanaAddress()
  const [wl, setWl] = useState({ wins: 0, losses: 0, draws: 0 })

  useEffect(() => {
    if (!address) return
    let cancelled = false
    fetch(`${config.backendUrl}/users/${encodeURIComponent(address)}/history`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => {
        if (!cancelled && Array.isArray(rows)) setWl(countResults(rows))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [address])

  return (
    <div>
      <div style={{ fontFamily: FONTS.body, fontSize: 15, color: COLORS.text, marginBottom: 16 }}>
        {username ? <strong>{username}</strong> : <span style={{ color: COLORS.muted }}>No username yet — set one in Settings.</span>}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <StatCard label="ELO" value={elo ?? '—'} />
        <StatCard label="GAMES" value={gamesPlayed ?? 0} />
        <StatCard label="WINS" value={wl.wins} />
        <StatCard label="LOSSES" value={wl.losses} />
        <StatCard label="DRAWS" value={wl.draws} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit (or defer to Task 12)**

```bash
git add src/ui/screens/Profile/OverviewTab.tsx
git commit -m "feat(profile): pestaña Overview (ELO, partidas, win/loss/draw)"
```

---

## Task 11: Frontend — Inventory tab

**Files:**
- Create: `src/ui/screens/Profile/InventoryTab.tsx`

- [ ] **Step 1: Implement**

Create `src/ui/screens/Profile/InventoryTab.tsx`:

```tsx
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useCollectorCryptNfts, type OwnedCard } from '../../../inventory/useCollectorCryptNfts'

function CardTile({ card }: { card: OwnedCard }) {
  return (
    <div style={{ width: 150, background: '#161b24', border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ height: 190, background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {card.image ? (
          <img src={card.image} alt={card.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
        ) : (
          <span style={{ fontSize: 34 }}>🃏</span>
        )}
      </div>
      <div style={{ padding: '9px 10px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {card.name}
        </div>
        {card.insuredValue != null && (
          <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 12, color: COLORS.green, marginTop: 3 }}>
            {formatUsd(card.insuredValue)}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, cards }: { title: string; cards: OwnedCard[] }) {
  if (cards.length === 0) return null
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.14em', color: COLORS.muted, marginBottom: 10 }}>
        {title} · {cards.length}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {cards.map((c) => (
          <CardTile key={`${c.source}-${c.mint}`} card={c} />
        ))}
      </div>
    </div>
  )
}

export function InventoryTab() {
  const { cards, loading } = useCollectorCryptNfts()
  const embedded = cards.filter((c) => c.source === 'embedded')
  const connected = cards.filter((c) => c.source === 'connected')

  if (loading) {
    return <div style={{ color: COLORS.muted, fontFamily: FONTS.body, fontSize: 14 }}>Loading your cards…</div>
  }
  if (cards.length === 0) {
    return (
      <div style={{ color: COLORS.muted, fontFamily: FONTS.body, fontSize: 14, lineHeight: 1.5 }}>
        No Collector Crypt cards found in your wallets yet.
        <br />
        Open packs in the Gacha, or connect a wallet that holds CC cards.
      </div>
    )
  }
  return (
    <div>
      <Section title="EMBEDDED WALLET" cards={embedded} />
      <Section title="CONNECTED WALLET" cards={connected} />
    </div>
  )
}
```

- [ ] **Step 2: Commit (or defer to Task 12)**

```bash
git add src/ui/screens/Profile/InventoryTab.tsx
git commit -m "feat(profile): pestaña Inventory (NFTs CC de embedded + connected vía DAS)"
```

---

## Task 12: Frontend — Settings tab (username editor) + final verify

**Files:**
- Create: `src/ui/screens/Profile/SettingsTab.tsx`

- [ ] **Step 1: Implement**

Create `src/ui/screens/Profile/SettingsTab.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, GRADIENT } from '../../theme'
import { useProfile } from '../../../hooks/useProfile'
import { validateUsername } from '../../../profile/username'
import { config } from '../../../onchain/config'

export function SettingsTab() {
  const { username, refresh } = useProfile()
  const { identityToken } = useIdentityToken()
  const [value, setValue] = useState('')
  const [status, setStatus] = useState<{ kind: 'idle' | 'ok' | 'error'; msg?: string }>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (username) setValue(username)
  }, [username])

  async function save() {
    const err = validateUsername(value)
    if (err) {
      setStatus({ kind: 'error', msg: err })
      return
    }
    if (!identityToken) {
      setStatus({ kind: 'error', msg: 'Log in to set a username.' })
      return
    }
    setSaving(true)
    setStatus({ kind: 'idle' })
    try {
      const resp = await fetch(`${config.backendUrl}/users/me/alias`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${identityToken}` },
        body: JSON.stringify({ alias: value }),
      })
      if (resp.status === 409) {
        setStatus({ kind: 'error', msg: 'That username is already taken.' })
      } else if (!resp.ok) {
        setStatus({ kind: 'error', msg: 'Could not save. Try again.' })
      } else {
        setStatus({ kind: 'ok', msg: 'Saved ✓' })
        refresh()
      }
    } catch {
      setStatus({ kind: 'error', msg: 'Network error.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 420 }}>
      <label style={{ display: 'block', fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.14em', color: COLORS.muted, marginBottom: 8 }}>
        USERNAME
      </label>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="3–20 chars, letters/numbers/_"
        style={{
          width: '100%',
          background: '#0a0e16',
          border: `1px solid ${COLORS.border}`,
          borderRadius: 10,
          padding: '11px 13px',
          color: COLORS.text,
          fontSize: 14,
          fontFamily: FONTS.body,
          outline: 'none',
        }}
      />
      <div style={{ fontSize: 12, marginTop: 8, minHeight: 16, color: status.kind === 'error' ? COLORS.red : COLORS.green }}>
        {status.msg ?? ''}
      </div>
      <button
        onClick={save}
        disabled={saving}
        style={{
          marginTop: 12,
          background: GRADIENT,
          border: 'none',
          borderRadius: 10,
          padding: '11px 22px',
          color: '#06120c',
          fontWeight: 800,
          fontSize: 13,
          fontFamily: FONTS.display,
          cursor: saving ? 'not-allowed' : 'pointer',
          opacity: saving ? 0.6 : 1,
        }}
      >
        {saving ? 'Saving…' : 'Save username'}
      </button>
    </div>
  )
}
```

(Confirm `COLORS.red` exists in `src/ui/theme`. The spec lists red #ff5c72. If the token is named differently, use the actual export.)

- [ ] **Step 2: Typecheck the whole app**

Run: `npx tsc --noEmit`
Expected: no errors (all tab imports in `ProfilePage` now resolve).

- [ ] **Step 3: Run the full frontend suite**

Run: `npm test`
Expected: all green (existing + new helper tests).

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/Profile/SettingsTab.tsx src/App.tsx src/ui/screens/Profile/ProfilePage.tsx src/ui/screens/Profile/OverviewTab.tsx src/ui/screens/Profile/InventoryTab.tsx
git commit -m "feat(profile): pestaña Settings (editor de username con 409) + cablea la página"
```

---

## Final verification

- [ ] Backend: `cd backend && .venv/bin/python -m pytest -q` → all green.
- [ ] Frontend: `npm test` → all green; `npx tsc --noEmit` → clean.
- [ ] Manual smoke (localhost): log in → topbar shows Profile button → dropdown → View profile → set username in Settings → reconnect chat → messages show the username; Overview shows ELO/games; Inventory shows empty-state (until devnet CC collection mint is configured).
```
