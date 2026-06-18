# Inventory card modal + buyback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a card in Profile → Inventory opens a modal with the NFT's info, and — for cards won via the gacha within CC's 72-hour window — an "Accept Buyback $X" action (with a confirm step) that sells the card back for USDC.

**Architecture:** Thin backend proxies for CC's buyback endpoints (keyless on devnet, field-whitelisted, like the existing gacha proxies); a frontend client for them; the inventory card enriched from DAS attributes; and an `InventoryCardModal` that shows the info and runs the buyback as generate → sign (embedded wallet) → submit, reusing the existing pack-purchase plumbing.

**Tech Stack:** FastAPI + httpx + respx/pytest (backend); React + TS + vitest, Privy (`useIdentityToken`, `useWallet().signTransactionBase64`, `useEmbeddedSolanaAddress`), react-router (frontend).

## Global Constraints

- **Keyless on devnet:** `GachaService._request` adds `x-api-key` only if a key is set. Do not require a key; do not change this.
- **Never forward raw upstream JSON:** every new service method returns a dict with an explicit field whitelist (mirror `generate_pack`/`submit_tx`).
- **Error mapping:** `GachaDisabled` → HTTP 503 `"gacha_disabled"`; `GachaUpstreamError` → HTTP 502 with `str(e)` (the surfaced CC reason) or `"gacha upstream no disponible"`.
- **Buyback scope:** only for cards with `source === 'embedded'`. Connected-wallet cards get the info modal but NO buyback button.
- **Explicit confirm before signing:** "Accept Buyback $X" → a confirm state → only then generate/sign/submit. No auto-sell on the first click.
- **Auth:** the authed buyback endpoint sets `playerAddress` = the caller's wallet from the identity token (`current_user`) — never from the request body. Identity token travels only as the `Authorization: Bearer` header.
- **Value display:** money shown via `formatUsd` from `src/ui/theme.ts`. Buyback `amount`/CC values are USDC base units (6 decimals) → divide by 1e6 before `formatUsd`.
- **Reuse tokens:** `COLORS`, `FONTS`, `formatUsd` from `src/ui/theme.ts`; no new fonts/aesthetic.
- **Embedded address** via `useEmbeddedSolanaAddress()`; **sign** via `useWallet().signTransactionBase64`; **token** via `useIdentityToken()`; **submit** via the existing `submitTx(token, signed)`.

---

## File Structure

- `backend/app/services/gacha.py` — add `buyback_available` + `buyback` methods.
- `backend/app/main.py` — add `GET /gacha/buyback/available` (public) + `POST /gacha/buyback` (authed) + `BuybackBody`.
- `backend/tests/test_gacha_api.py` — buyback endpoint tests.
- `src/onchain/gachaClient.ts` — `fetchBuybackAvailable`, `requestBuyback` + types.
- `src/onchain/gachaClient.test.ts` — tests for the two new client fns.
- `src/inventory/dasClient.ts` — enrich `InventoryCard` + `dasAssetToCard`.
- `src/inventory/dasClient.test.ts` — update existing + add extraction tests.
- `src/inventory/useCollectorCryptNfts.ts` — add `refresh()`.
- `src/ui/screens/Profile/InventoryCardModal.tsx` — NEW: info + buyback flow.
- `src/ui/screens/Profile/InventoryCardModal.test.ts` — NEW: pure helper test.
- `src/ui/screens/Profile/InventoryTab.tsx` — clickable tiles + modal wiring.

---

### Task 1: Backend buyback proxy (service + endpoints)

**Files:**
- Modify: `backend/app/services/gacha.py` (add two methods after `submit_tx`, ~line 121)
- Modify: `backend/app/main.py` (add `BuybackBody` near the other Body models ~line 48; add two endpoints after `gacha_submit` ~line 234)
- Test: `backend/tests/test_gacha_api.py`

**Interfaces:**
- Consumes: `GachaService._request`, `GachaDisabled`, `GachaUpstreamError`, `_gacha_or_503()`, `_gacha_throttle(wallet)`, `current_user` (all existing).
- Produces:
  - `GachaService.buyback_available(self, wallet: str, nft: str) -> dict` → `{"available": bool, "amount": int | None}`
  - `GachaService.buyback(self, player_address: str, nft_address: str) -> dict` → `{"serialized_transaction": str | None, "refund_amount": int | None, "memo": str | None}`
  - `GET /gacha/buyback/available?wallet=&nft=` (public) → the availability dict
  - `POST /gacha/buyback` (authed; body `{"nft_address": str}`) → the tx dict

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_gacha_api.py` (uses the existing `_client`, `_hdrs`, `BASE`, `WALLET_A` helpers):

```python
@respx.mock
def test_buyback_available_ok():
    respx.get(f"{BASE}/api/buyback/available").mock(
        return_value=Response(200, json={"available": True, "amount": 42500000}))
    c, _ = _client()
    r = c.get("/gacha/buyback/available", params={"wallet": WALLET_A, "nft": "NFT1"})
    assert r.status_code == 200
    assert r.json() == {"available": True, "amount": 42500000}


@respx.mock
def test_buyback_available_false():
    respx.get(f"{BASE}/api/buyback/available").mock(
        return_value=Response(200, json={"available": False}))
    c, _ = _client()
    r = c.get("/gacha/buyback/available", params={"wallet": WALLET_A, "nft": "NFT1"})
    assert r.status_code == 200
    assert r.json() == {"available": False, "amount": None}


def test_buyback_available_requiere_params():
    c, _ = _client()
    assert c.get("/gacha/buyback/available", params={"wallet": WALLET_A}).status_code == 422


def test_buyback_requiere_auth():
    c, _ = _client()
    assert c.post("/gacha/buyback", json={"nft_address": "NFT1"}).status_code == 401


@respx.mock
def test_buyback_fija_player_y_whitelista():
    route = respx.post(f"{BASE}/api/buyback").mock(return_value=Response(200, json={
        "success": True,
        "serializedTransaction": "BASE64TX",
        "refundAmount": 42500000,
        "memo": "memo-xyz",
        "secret": "should-not-leak",
    }))
    c, priv = _client()
    r = c.post("/gacha/buyback", json={"nft_address": "NFT1"}, headers=_hdrs(priv, WALLET_A))
    assert r.status_code == 200
    assert r.json() == {"serialized_transaction": "BASE64TX", "refund_amount": 42500000, "memo": "memo-xyz"}
    sent = json.loads(route.calls.last.request.content)
    assert sent == {"playerAddress": WALLET_A, "nftAddress": "NFT1"}


@respx.mock
def test_buyback_upstream_error_502():
    respx.post(f"{BASE}/api/buyback").mock(
        return_value=Response(400, json={"error": "outside 72-hour window"}))
    c, priv = _client()
    r = c.post("/gacha/buyback", json={"nft_address": "NFT1"}, headers=_hdrs(priv, WALLET_A))
    assert r.status_code == 502
    assert "72-hour" in r.json()["detail"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_gacha_api.py -k buyback -q`
Expected: FAIL (404/405 for the routes; methods/endpoints don't exist yet).

- [ ] **Step 3: Add the service methods**

In `backend/app/services/gacha.py`, after `submit_tx` (after line 120):

```python
    async def buyback_available(self, wallet: str, nft: str) -> dict:
        raw = await self._request("GET", "/api/buyback/available",
                                  params={"wallet": wallet, "nft": nft})
        available = bool(raw.get("available")) if isinstance(raw, dict) else False
        amount = raw.get("amount") if (isinstance(raw, dict) and available) else None
        return {"available": available, "amount": amount}

    async def buyback(self, player_address: str, nft_address: str) -> dict:
        raw = await self._request("POST", "/api/buyback",
                                  json={"playerAddress": player_address, "nftAddress": nft_address})
        return {
            "serialized_transaction": raw.get("serializedTransaction"),
            "refund_amount": raw.get("refundAmount"),
            "memo": raw.get("memo"),
        }
```

- [ ] **Step 4: Add the endpoints**

In `backend/app/main.py`, add the body model near the other Body models (after `OpenPackBody`, ~line 50):

```python
class BuybackBody(BaseModel):
    nft_address: str
```

Then, after the `gacha_submit` endpoint (after ~line 234), add:

```python
    @app.get("/gacha/buyback/available")
    async def gacha_buyback_available(wallet: str, nft: str):
        svc = _gacha_or_503()
        try:
            return await svc.buyback_available(wallet=wallet, nft=nft)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")

    @app.post("/gacha/buyback")
    async def gacha_buyback(body: BuybackBody, wallet: str = Depends(current_user)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        try:
            return await svc.buyback(player_address=wallet, nft_address=body.nft_address)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_gacha_api.py -k buyback -q`
Expected: PASS (6 tests).

- [ ] **Step 6: Run the full backend suite (no regressions)**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/gacha.py backend/app/main.py backend/tests/test_gacha_api.py
git commit -m "feat(gacha): proxy buyback (available + claim) keyless, whitelisted, authed claim"
```

---

### Task 2: Frontend gacha client — buyback functions

**Files:**
- Modify: `src/onchain/gachaClient.ts` (add types + two functions after `submitTx`, ~line 106)
- Test: `src/onchain/gachaClient.test.ts`

**Interfaces:**
- Consumes: `gachaFetch`, `authHeaders`, `config.backendUrl` (existing, internal to the file).
- Produces:
  - `interface BuybackAvailable { available: boolean; amount: number | null }`
  - `interface BuybackResponse { serialized_transaction: string; refund_amount: number | null; memo: string | null }`
  - `fetchBuybackAvailable(wallet: string, nft: string): Promise<BuybackAvailable>`
  - `requestBuyback(token: string, nftAddress: string): Promise<BuybackResponse>`

- [ ] **Step 1: Write failing tests**

Append to `src/onchain/gachaClient.test.ts`:

```ts
import { fetchBuybackAvailable, requestBuyback } from './gachaClient'
import { config } from './config'

describe('fetchBuybackAvailable', () => {
  it('hace GET con wallet+nft y devuelve el JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ available: true, amount: 42500000 }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchBuybackAvailable('WALLET', 'NFT1')
    expect(out).toEqual({ available: true, amount: 42500000 })
    const url = fetchMock.mock.calls[0][0] as string
    expect(url.startsWith(`${config.backendUrl}/gacha/buyback/available?`)).toBe(true)
    expect(url).toContain('wallet=WALLET')
    expect(url).toContain('nft=NFT1')
    vi.unstubAllGlobals()
  })
})

describe('requestBuyback', () => {
  it('hace POST con Bearer y body {nft_address}', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ serialized_transaction: 'TX', refund_amount: 42500000, memo: 'm' }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await requestBuyback('TOKEN', 'NFT1')
    expect(out).toEqual({ serialized_transaction: 'TX', refund_amount: 42500000, memo: 'm' })
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOKEN')
    expect(JSON.parse(init.body)).toEqual({ nft_address: 'NFT1' })
    vi.unstubAllGlobals()
  })

  it('propaga el detail del backend en error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({ detail: 'outside 72-hour window' }) }))
    await expect(requestBuyback('TOKEN', 'NFT1')).rejects.toThrow('72-hour')
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/onchain/gachaClient.test.ts`
Expected: FAIL ("fetchBuybackAvailable is not a function" / import error).

- [ ] **Step 3: Implement the client functions**

In `src/onchain/gachaClient.ts`, after `submitTx` (~line 106):

```ts
export interface BuybackAvailable {
  available: boolean
  amount: number | null // USDC base units (6 decimals)
}

export interface BuybackResponse {
  serialized_transaction: string
  refund_amount: number | null
  memo: string | null
}

export function fetchBuybackAvailable(wallet: string, nft: string): Promise<BuybackAvailable> {
  const p = new URLSearchParams({ wallet, nft })
  return gachaFetch<BuybackAvailable>(`/gacha/buyback/available?${p.toString()}`)
}

export function requestBuyback(token: string, nftAddress: string): Promise<BuybackResponse> {
  return gachaFetch<BuybackResponse>('/gacha/buyback', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ nft_address: nftAddress }),
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/onchain/gachaClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/onchain/gachaClient.ts src/onchain/gachaClient.test.ts
git commit -m "feat(gacha-client): fetchBuybackAvailable + requestBuyback"
```

---

### Task 3: Enrich inventory cards from DAS attributes

**Files:**
- Modify: `src/inventory/dasClient.ts` (`InventoryCard` interface ~line 15; `dasAssetToCard` ~line 30)
- Test: `src/inventory/dasClient.test.ts` (update the two existing `dasAssetToCard` assertions; add extraction tests)

**Interfaces:**
- Produces (extended): `InventoryCard` gains `rarity: string | null; grade: string | null; gradingCompany: string | null; gradingId: string | null; year: string | null; authenticated: boolean | null`. `OwnedCard` (in `useCollectorCryptNfts.ts`) inherits these automatically (it `extends InventoryCard`).

- [ ] **Step 1: Update the existing tests + add new ones**

In `src/inventory/dasClient.test.ts`, the two existing `dasAssetToCard` tests use exact `toEqual` — update them to the enriched shape and add extraction cases. Replace the whole `describe('dasAssetToCard', …)` block with:

```ts
describe('dasAssetToCard', () => {
  it('extrae campos base + grading/rarity/year/authenticated', () => {
    const card = dasAssetToCard({
      id: 'mint1',
      content: {
        metadata: {
          name: '2020 Charizard',
          attributes: [
            { trait_type: 'Insured Value', value: '1200' },
            { trait_type: 'Rarity', value: 'Epic' },
            { trait_type: 'Grading Company', value: 'PSA' },
            { trait_type: 'The Grade', value: '10' },
            { trait_type: 'Grading ID', value: '12345678' },
            { trait_type: 'Year', value: '2020' },
            { trait_type: 'Authenticated', value: 'true' },
          ],
        },
        links: { image: 'http://img/x.png' },
      },
    } as any)
    expect(card).toEqual({
      mint: 'mint1', name: '2020 Charizard', image: 'http://img/x.png', insuredValue: 1200,
      rarity: 'epic', grade: 'PSA 10', gradingCompany: 'PSA', gradingId: '12345678',
      year: '2020', authenticated: true,
    })
  })

  it('usa fallbacks/null cuando faltan campos; year desde el nombre', () => {
    const card = dasAssetToCard({
      id: 'mint2',
      content: { metadata: { name: '1999 Pikachu' } },
    } as any)
    expect(card).toEqual({
      mint: 'mint2', name: '1999 Pikachu', image: null, insuredValue: null,
      rarity: null, grade: null, gradingCompany: null, gradingId: null,
      year: '1999', authenticated: null,
    })
  })

  it('id-only asset → todo null y name Unnamed', () => {
    const card = dasAssetToCard({ id: 'mint3' } as any)
    expect(card.name).toBe('Unnamed')
    expect(card.grade).toBeNull()
    expect(card.year).toBeNull()
    expect(card.authenticated).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/inventory/dasClient.test.ts`
Expected: FAIL (the returned object lacks the new fields).

- [ ] **Step 3: Extend the interface + extraction**

In `src/inventory/dasClient.ts`, replace the `InventoryCard` interface (lines 15-20) and `dasAssetToCard` (lines 29-42) with:

```ts
export interface InventoryCard {
  mint: string
  name: string
  image: string | null
  insuredValue: number | null
  rarity: string | null
  grade: string | null
  gradingCompany: string | null
  gradingId: string | null
  year: string | null
  authenticated: boolean | null
}

/** trait_type -> string value (coerced), for whichever attributes exist. */
function attrMap(attrs: Array<{ trait_type?: string; value?: unknown }>): Record<string, string> {
  const m: Record<string, string> = {}
  for (const t of attrs) {
    if (t.trait_type != null && t.value != null && t.value !== '') m[t.trait_type] = String(t.value)
  }
  return m
}

/** Map a DAS asset to a display card, with safe fallbacks. */
export function dasAssetToCard(a: DasAsset): InventoryCard {
  const md = a.content?.metadata
  const attrs = md?.attributes ?? []
  const m = attrMap(attrs)
  const name = md?.name ?? 'Unnamed'

  const insuredAttr = attrs.find((t) => /insured/i.test(t.trait_type ?? ''))
  const rawInsured = insuredAttr?.value
  const insuredValue = rawInsured == null || rawInsured === '' ? NaN : Number(rawInsured)

  const company = (m['Grading Company'] ?? '').trim()
  const gradeLabel = (m['The Grade'] ?? m['GradeNum'] ?? '').trim()
  const grade = `${company} ${gradeLabel}`.trim() || null

  let year: string | null = m['Year'] ?? null
  if (!year) {
    const match = /^\s*(\d{4})\b/.exec(name)
    if (match) year = match[1]
  }

  const authRaw = m['Authenticated']
  const authenticated = authRaw == null ? null : authRaw.trim().toLowerCase() === 'true'

  return {
    mint: a.id,
    name,
    image: a.content?.links?.image ?? null,
    insuredValue: Number.isFinite(insuredValue) ? insuredValue : null,
    rarity: m['Rarity'] != null ? m['Rarity'].toLowerCase() : null,
    grade,
    gradingCompany: company || null,
    gradingId: m['Grading ID'] ?? null,
    year,
    authenticated,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/inventory/dasClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/inventory/dasClient.ts src/inventory/dasClient.test.ts
git commit -m "feat(inventory): enrich cards with rarity/grade/grading/year from DAS"
```

---

### Task 4: InventoryCardModal (info + buyback flow)

**Files:**
- Create: `src/ui/screens/Profile/InventoryCardModal.tsx`
- Create: `src/ui/screens/Profile/InventoryCardModal.test.ts`

**Interfaces:**
- Consumes: `OwnedCard` (from `../../../inventory/useCollectorCryptNfts`); `fetchBuybackAvailable`, `requestBuyback`, `submitTx` (from `../../../onchain/gachaClient`); `useIdentityToken` (`@privy-io/react-auth`); `useWallet` (`../../../wallet/useWallet`); `useEmbeddedSolanaAddress` (`../../../wallet/embedded`); `COLORS`, `FONTS`, `formatUsd` (`../../theme`).
- Produces:
  - `export function buybackUsd(amountBaseUnits: number): number` — `amountBaseUnits / 1e6` (pure, exported for test).
  - `export function InventoryCardModal(props: { card: OwnedCard; onClose: () => void; onSold: () => void }): JSX.Element`

- [ ] **Step 1: Write the failing test (pure helper)**

Create `src/ui/screens/Profile/InventoryCardModal.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buybackUsd } from './InventoryCardModal'

describe('buybackUsd', () => {
  it('convierte base units (6 dec) a dólares', () => {
    expect(buybackUsd(42500000)).toBe(42.5)
    expect(buybackUsd(90000)).toBe(0.09)
    expect(buybackUsd(0)).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/screens/Profile/InventoryCardModal.test.ts`
Expected: FAIL (module/`buybackUsd` not found).

- [ ] **Step 3: Implement the modal**

Create `src/ui/screens/Profile/InventoryCardModal.tsx`. Mirror the visual language of the gacha "Card Details" view in `src/ui/screens/gacha/GachaVault.tsx` (`function CardDetailsView`, ~line 714): a centered dark panel over a dimmed backdrop, image at top, an insured-value box, grading/year rows, and a Token ID row with copy + a devnet explorer link. Use only `COLORS`/`FONTS`/`formatUsd`.

```tsx
import { useEffect, useRef, useState } from 'react'
import { useIdentityToken } from '@privy-io/react-auth'
import { COLORS, FONTS, formatUsd } from '../../theme'
import type { OwnedCard } from '../../../inventory/useCollectorCryptNfts'
import { useWallet } from '../../../wallet/useWallet'
import { useEmbeddedSolanaAddress } from '../../../wallet/embedded'
import { fetchBuybackAvailable, requestBuyback, submitTx } from '../../../onchain/gachaClient'

/** USDC base units (6 decimals) → dollars. */
export function buybackUsd(amountBaseUnits: number): number {
  return amountBaseUnits / 1e6
}

type BuybackState =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'available'; amount: number }
  | { kind: 'confirming'; amount: number }
  | { kind: 'selling'; amount: number }
  | { kind: 'sold'; amount: number }
  | { kind: 'error'; amount: number; message: string }

function abbreviate(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 6)}…${mint.slice(-6)}` : mint
}

export function InventoryCardModal({ card, onClose, onSold }: {
  card: OwnedCard
  onClose: () => void
  onSold: () => void
}) {
  const { identityToken } = useIdentityToken()
  const { signTransactionBase64 } = useWallet()
  const embeddedAddress = useEmbeddedSolanaAddress()
  const [bb, setBb] = useState<BuybackState>({ kind: 'checking' })
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  // Buyback is only meaningful for embedded-won cards.
  const eligibleWallet = card.source === 'embedded' ? embeddedAddress : null

  useEffect(() => {
    if (!eligibleWallet) { setBb({ kind: 'none' }); return }
    let cancelled = false
    setBb({ kind: 'checking' })
    fetchBuybackAvailable(eligibleWallet, card.mint)
      .then((r) => {
        if (cancelled) return
        setBb(r.available && r.amount != null ? { kind: 'available', amount: r.amount } : { kind: 'none' })
      })
      .catch(() => { if (!cancelled) setBb({ kind: 'none' }) })
    return () => { cancelled = true }
  }, [eligibleWallet, card.mint])

  async function confirmSell(amount: number) {
    if (!identityToken) { setBb({ kind: 'error', amount, message: 'Sign in to sell back.' }); return }
    setBb({ kind: 'selling', amount })
    try {
      const res = await requestBuyback(identityToken, card.mint)
      const signed = await signTransactionBase64(res.serialized_transaction)
      await submitTx(identityToken, signed)
      setBb({ kind: 'sold', amount })
      onSold()
    } catch (e) {
      setBb({ kind: 'error', amount, message: e instanceof Error ? e.message : 'Buyback failed' })
    }
  }

  function copyMint() {
    if (!navigator.clipboard) return
    void navigator.clipboard.writeText(card.mint).then(() => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1800)
    })
  }

  const explorerUrl = `https://explorer.solana.com/address/${card.mint}?cluster=devnet`
  const label = { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.12em', color: COLORS.muted } as const
  const value = { fontSize: 13, color: COLORS.text, fontWeight: 600 } as const

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, 100%)', maxHeight: '90vh', overflowY: 'auto',
          background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 18,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 15, color: COLORS.text }}>Card details</span>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 8, width: 28, height: 28, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ height: 240, background: '#0c1019', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, overflow: 'hidden' }}>
          {card.image ? <img src={card.image} alt={card.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 44 }}>🃏</span>}
        </div>

        <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 17, color: COLORS.text, marginBottom: 4 }}>{card.name}</div>
        {card.rarity && <div style={{ ...label, marginBottom: 12, textTransform: 'uppercase' }}>{card.rarity}</div>}

        {card.insuredValue != null && (
          <div style={{ background: '#0c1019', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
            <div style={label}>INSURED VALUE</div>
            <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: COLORS.green }}>{formatUsd(card.insuredValue)}</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {card.grade && (<div><div style={label}>GRADE</div><div style={value}>{card.grade}</div></div>)}
          {card.year && (<div><div style={label}>YEAR</div><div style={value}>{card.year}</div></div>)}
          {card.gradingId && (<div><div style={label}>GRADING ID</div><div style={value}>{card.gradingId}</div></div>)}
          {card.authenticated != null && (<div><div style={label}>AUTHENTICATED</div><div style={value}>{card.authenticated ? 'Yes' : 'No'}</div></div>)}
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={label}>TOKEN ID</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.text }}>{abbreviate(card.mint)}</span>
            <button onClick={copyMint} style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</button>
            <a href={explorerUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: COLORS.violet }}>View token ↗</a>
          </div>
        </div>

        {/* ── Buyback ──────────────────────────────────────────────────────── */}
        {bb.kind === 'checking' && <div style={{ ...label, color: COLORS.muted }}>Checking buyback…</div>}
        {bb.kind === 'available' && (
          <button onClick={() => setBb({ kind: 'confirming', amount: bb.amount })}
            style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', cursor: 'pointer', background: COLORS.green, color: '#03110a', fontFamily: FONTS.display, fontWeight: 800, fontSize: 14 }}>
            Accept Buyback {formatUsd(buybackUsd(bb.amount))}
          </button>
        )}
        {bb.kind === 'confirming' && (
          <div>
            <div style={{ fontSize: 13, color: COLORS.text, marginBottom: 10, lineHeight: 1.4 }}>
              Sell <b>{card.name}</b> for <b>{formatUsd(buybackUsd(bb.amount))}</b>? You return the card and get USDC. This can't be undone.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => confirmSell(bb.amount)}
                style={{ flex: 1, padding: '11px', borderRadius: 10, border: 'none', cursor: 'pointer', background: COLORS.green, color: '#03110a', fontFamily: FONTS.display, fontWeight: 800 }}>Confirm</button>
              <button onClick={() => setBb({ kind: 'available', amount: bb.amount })}
                style={{ flex: 1, padding: '11px', borderRadius: 10, border: `1px solid ${COLORS.border}`, cursor: 'pointer', background: 'transparent', color: COLORS.text, fontWeight: 700 }}>Cancel</button>
            </div>
          </div>
        )}
        {bb.kind === 'selling' && <div style={{ ...label, color: COLORS.muted }}>Selling back…</div>}
        {bb.kind === 'sold' && <div style={{ fontSize: 13, color: COLORS.green, fontWeight: 700 }}>Sold — {formatUsd(buybackUsd(bb.amount))} credited.</div>}
        {bb.kind === 'error' && (
          <div>
            <div style={{ fontSize: 12, color: COLORS.red, marginBottom: 8 }}>{bb.message}</div>
            <button onClick={() => setBb({ kind: 'available', amount: bb.amount })}
              style={{ width: '100%', padding: '10px', borderRadius: 10, border: `1px solid ${COLORS.border}`, cursor: 'pointer', background: 'transparent', color: COLORS.text, fontWeight: 700 }}>Back</button>
          </div>
        )}
      </div>
    </div>
  )
}
```

Note: if `COLORS.red` does not exist in `src/ui/theme.ts`, use the project's existing red token name (check the file); per project notes it is `#ff5c72` exposed as `COLORS.red`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ui/screens/Profile/InventoryCardModal.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/Profile/InventoryCardModal.tsx src/ui/screens/Profile/InventoryCardModal.test.ts
git commit -m "feat(inventory): card detail modal with buyback (confirm → sign → submit)"
```

---

### Task 5: Wire the modal + inventory refresh

**Files:**
- Modify: `src/inventory/useCollectorCryptNfts.ts` (add `refresh`)
- Modify: `src/ui/screens/Profile/InventoryTab.tsx` (clickable tiles + modal)

**Interfaces:**
- Consumes: `InventoryCardModal` (Task 4), `OwnedCard`.
- Produces: `useCollectorCryptNfts()` now returns `{ cards, loading, refresh: () => void }`.

- [ ] **Step 1: Add `refresh()` to the hook**

In `src/inventory/useCollectorCryptNfts.ts`: add a refresh nonce. Change the return type and body:

```ts
export function useCollectorCryptNfts(): { cards: OwnedCard[]; loading: boolean; refresh: () => void } {
  const wallets = useLinkedSolanaWallets()
  const [cards, setCards] = useState<OwnedCard[]>([])
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)
  // Stable dependency key so the effect doesn't loop on array identity.
  const key = wallets.map((w) => `${w.source}:${w.address}`).join(',')
```

Add `nonce` to the effect dependency array (replace `}, [key])` with `}, [key, nonce])`), and change the return statement to:

```ts
  return { cards, loading, refresh: () => setNonce((n) => n + 1) }
```

- [ ] **Step 2: Wire clickable tiles + modal in InventoryTab**

Replace `src/ui/screens/Profile/InventoryTab.tsx` with:

```tsx
import { useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { useCollectorCryptNfts, type OwnedCard } from '../../../inventory/useCollectorCryptNfts'
import { InventoryCardModal } from './InventoryCardModal'

function CardTile({ card, onClick }: { card: OwnedCard; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
      style={{ width: 150, background: '#161b24', border: `1px solid ${COLORS.border}`, borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}
    >
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

function Section({ title, cards, onSelect }: { title: string; cards: OwnedCard[]; onSelect: (c: OwnedCard) => void }) {
  if (cards.length === 0) return null
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.14em', color: COLORS.muted, marginBottom: 10 }}>
        {title} · {cards.length}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {cards.map((c) => (
          <CardTile key={`${c.source}-${c.mint}`} card={c} onClick={() => onSelect(c)} />
        ))}
      </div>
    </div>
  )
}

export function InventoryTab() {
  const { cards, loading, refresh } = useCollectorCryptNfts()
  const [selected, setSelected] = useState<OwnedCard | null>(null)
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
      <Section title="EMBEDDED WALLET" cards={embedded} onSelect={setSelected} />
      <Section title="CONNECTED WALLET" cards={connected} onSelect={setSelected} />
      {selected && (
        <InventoryCardModal
          card={selected}
          onClose={() => setSelected(null)}
          onSold={() => { refresh(); setSelected(null) }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Typecheck + full frontend suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all suites green.

- [ ] **Step 4: Build (catches router/import issues tsc --noEmit misses)**

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/inventory/useCollectorCryptNfts.ts src/ui/screens/Profile/InventoryTab.tsx
git commit -m "feat(inventory): clickable tiles open detail/buyback modal; refresh after sell"
```

---

## Self-Review

**1. Spec coverage:**
- Backend `GET /gacha/buyback/available` + `POST /gacha/buyback` + submit reuse → Task 1. ✓
- gachaClient `fetchBuybackAvailable` / `requestBuyback` → Task 2. ✓
- Enrich `dasAssetToCard` (rarity/grade/gradingCompany/gradingId/year/authenticated) → Task 3. ✓
- Modal with NFT info + Token ID + explorer + buyback (embedded-only) + confirm step + sign/submit + error surfacing → Task 4. ✓
- Clickable tiles + modal wiring + inventory refresh → Task 5. ✓
- Error handling (availability failure → no button; requestBuyback/submit failure → inline error) → Task 4 (`.catch` → none; try/catch → error state). ✓
- Not-authenticated → no sell (token guard) → Task 4 (`confirmSell` token guard; buyback only when `eligibleWallet`). ✓
- Testing (pytest endpoints; vitest client + dasClient + buybackUsd) → Tasks 1-4. ✓

**2. Placeholder scan:** No TBD/TODO; all code blocks complete. The one conditional note (Task 4 Step 3 `COLORS.red`) gives the exact fallback value.

**3. Type consistency:** `buyback_available`/`buyback` field names match the client (`available`/`amount`; `serialized_transaction`/`refund_amount`/`memo`). `InventoryCard` extra fields (rarity/grade/gradingCompany/gradingId/year/authenticated) are produced in Task 3 and consumed by the modal in Task 4. `useCollectorCryptNfts` return gains `refresh` in Task 5, consumed in the same task. `submitTx`/`requestBuyback`/`fetchBuybackAvailable` signatures consistent across tasks.

## No-goals (carried from spec)
- No buyback for connected-wallet cards; no sell-all; no buyback-history view; availability checked lazily per modal (not per tile).
