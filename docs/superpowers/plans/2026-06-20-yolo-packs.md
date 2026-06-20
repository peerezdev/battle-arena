# YOLO packs (bulk open + Turbo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player open N packs (1–10) of a machine at once ("YOLO"), optionally Turbo (auto-sell Commons), with a one-by-one staged reveal supporting Skip pack / Skip all and a final summary.

**Architecture:** Backend adds a `generateYoloPacks` proxy (stores one `GachaPack` per memo) and tags `open_pack` results auto-sold when Turbo buys back a Common; the existing submit/open endpoints are reused per pack. The frontend adds YOLO controls to the machine panel and a sequential generate→sign→submit→open orchestration that drives a staged reveal then a summary.

**Tech Stack:** FastAPI + httpx + pytest/respx (backend); React + TS + vitest, framer-motion, Privy (frontend).

## Global Constraints

- **Keyless on devnet** + **field-whitelisted** responses (build each result from explicit keys; no raw upstream passthrough).
- `count` is validated **1–10** server-side (`Field(ge=1, le=10)`); the UI clamps with `clampCount`.
- Turbo is fixed at generation; `open_pack` detects auto-sale via `raw.get("code") == "TURBO_MODE_BUYBACK"` and surfaces `auto_sold` + `buyback_amount` (USDC base units, 6 decimals). Backward-compatible for single packs (`auto_sold:false`, `buyback_amount:null`).
- Error mapping: `GachaDisabled` → 503 `"gacha_disabled"`; `GachaUpstreamError` → 502 with the reason.
- `playerAddress` is always the caller's wallet from `current_user` — never the body.
- Partial failure is safe (unsubmitted packs aren't charged): stop on first sign/submit failure, open only what was submitted.
- Money via `formatUsd`; reuse `COLORS`/`FONTS` tokens; sign via `useWallet().signTransactionBase64`; token via `useIdentityToken()`.
- Every task ends `tsc`/`build`/suite green; desktop single-pack flow unchanged.

---

## File Structure
- `backend/app/services/gacha.py` — `generate_yolo_packs`; `open_pack` auto-sold tagging.
- `backend/app/main.py` — `YoloBody` + `POST /gacha/yolo`.
- `backend/tests/test_gacha_api.py` — yolo + auto-sold tests.
- `src/onchain/gachaClient.ts` — `generateYoloPacks`, `YoloTx`/`YoloPacksResponse`, `OpenPackResult` fields, `yoloTotalCost`/`clampCount`.
- `src/onchain/gachaClient.test.ts` — client + helper tests.
- `src/ui/screens/gacha/MachineDetailPanel.tsx` — YOLO controls.
- `src/ui/screens/gacha/GachaVault.tsx` — phases, orchestration, progress/summary/reveal overlays.

---

### Task 1: Backend — `generate_yolo_packs` + auto-sold + endpoint

**Files:**
- Modify: `backend/app/services/gacha.py` (add `generate_yolo_packs` after `generate_pack` ~line 114; edit `open_pack` return ~line 169-182)
- Modify: `backend/app/main.py` (add `YoloBody` after `OpenPackBody` ~line 49; add endpoint after `gacha_open`)
- Test: `backend/tests/test_gacha_api.py`

**Interfaces:**
- Produces:
  - `GachaService.generate_yolo_packs(self, player_address, pack_type, count, turbo) -> {"yolo_id": str|None, "count": int|None, "transactions": [{"memo": str, "transaction": str}]}`
  - `open_pack` result dict gains `"auto_sold": bool` + `"buyback_amount": int|None`
  - `POST /gacha/yolo` (authed; body `{pack_type, count, turbo}`) → the whitelisted yolo dict

- [ ] **Step 1: Write failing tests**

Append to `backend/tests/test_gacha_api.py`:

```python
@respx.mock
def test_yolo_generates_and_stores_memos():
    route = respx.post(f"{BASE}/api/generateYoloPacks").mock(return_value=Response(200, json={
        "yoloId": "y-1", "count": 2, "extra": "drop-me",
        "transactions": [
            {"memo": "ym-1", "transaction": "TX1", "junk": 1},
            {"memo": "ym-2", "transaction": "TX2"},
        ],
    }))
    c, priv = _client(api_key="")
    r = c.post("/gacha/yolo", json={"pack_type": "pokemon_50", "count": 2, "turbo": True},
               headers=_hdrs(priv, WALLET_A))
    assert r.status_code == 200
    assert r.json() == {"yolo_id": "y-1", "count": 2,
                        "transactions": [{"memo": "ym-1", "transaction": "TX1"},
                                         {"memo": "ym-2", "transaction": "TX2"}]}
    sent = json.loads(route.calls.last.request.content)
    assert sent == {"playerAddress": WALLET_A, "packType": "pokemon_50", "count": 2, "turbo": True}


def test_yolo_count_bounds():
    c, priv = _client()
    assert c.post("/gacha/yolo", json={"pack_type": "pokemon_50", "count": 0},
                  headers=_hdrs(priv, WALLET_A)).status_code == 422
    assert c.post("/gacha/yolo", json={"pack_type": "pokemon_50", "count": 11},
                  headers=_hdrs(priv, WALLET_A)).status_code == 422


def test_yolo_requires_auth():
    c, _ = _client()
    assert c.post("/gacha/yolo", json={"pack_type": "pokemon_50", "count": 2}).status_code == 401


@respx.mock
def test_yolo_open_pack_owns_memo():
    respx.post(f"{BASE}/api/generateYoloPacks").mock(return_value=Response(200, json={
        "yoloId": "y-2", "count": 1, "transactions": [{"memo": "ym-own", "transaction": "TX"}]}))
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "nft_address": "MINT", "rarity": "Common", "code": "TURBO_MODE_BUYBACK",
        "buybackAmount": 42500000, "nftWon": {"content": {"metadata": {"name": "C"}}}}))
    c, priv = _client(api_key="")
    c.post("/gacha/yolo", json={"pack_type": "pokemon_50", "count": 1, "turbo": True},
           headers=_hdrs(priv, WALLET_A))
    r = c.post("/gacha/open-pack", json={"memo": "ym-own"}, headers=_hdrs(priv, WALLET_A))
    assert r.status_code == 200
    body = r.json()
    assert body["auto_sold"] is True
    assert body["buyback_amount"] == 42500000


@respx.mock
def test_open_pack_not_auto_sold_by_default():
    respx.post(f"{BASE}/api/generatePack").mock(return_value=Response(200, json={"memo": "m-x", "transaction": "T"}))
    respx.post(f"{BASE}/api/openPack").mock(return_value=Response(200, json={
        "nft_address": "MINT", "rarity": "Rare", "nftWon": {"content": {"metadata": {"name": "R"}}}}))
    c, priv = _client(api_key="")
    c.post("/gacha/generate-pack", json={"pack_type": "pokemon_50"}, headers=_hdrs(priv, WALLET_A))
    r = c.post("/gacha/open-pack", json={"memo": "m-x"}, headers=_hdrs(priv, WALLET_A))
    assert r.json()["auto_sold"] is False
    assert r.json()["buyback_amount"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_gacha_api.py -k "yolo or auto_sold" -q`
Expected: FAIL (route 404 / missing keys).

- [ ] **Step 3: Add `generate_yolo_packs` + tag auto-sold in `open_pack`**

In `backend/app/services/gacha.py`, add after `generate_pack` (after line 114):

```python
    async def generate_yolo_packs(self, player_address: str, pack_type: str,
                                  count: int, turbo: bool) -> dict:
        raw = await self._request("POST", "/api/generateYoloPacks", json={
            "playerAddress": player_address, "packType": pack_type,
            "count": count, "turbo": turbo,
        })
        txs = raw.get("transactions") if isinstance(raw, dict) else None
        out = []
        for t in txs or []:
            if isinstance(t, dict) and t.get("memo") and t.get("transaction"):
                out.append({"memo": t["memo"], "transaction": t["transaction"]})
        return {"yolo_id": raw.get("yoloId") if isinstance(raw, dict) else None,
                "count": raw.get("count") if isinstance(raw, dict) else None,
                "transactions": out}
```

In `open_pack`, just before the final `return {` (after the `authenticated = …` line ~167), add:

```python
        auto_sold = raw.get("code") == "TURBO_MODE_BUYBACK"
        buyback_amount = raw.get("buybackAmount") if auto_sold else None
```

and add these two keys to the returned dict (alongside `insured_value`):

```python
            "auto_sold": auto_sold,
            "buyback_amount": buyback_amount,
```

- [ ] **Step 4: Add `YoloBody` + the endpoint**

In `backend/app/main.py`, add after `OpenPackBody` (after line 49):

```python
class YoloBody(BaseModel):
    pack_type: str = Field(min_length=1, max_length=32, pattern=r"^[a-z0-9_]+$")
    count: int = Field(ge=1, le=10)
    turbo: bool = False
```

Add the endpoint after the `gacha_open` endpoint (mirror its memo-store pattern):

```python
    @app.post("/gacha/yolo")
    async def gacha_yolo(body: YoloBody,
                         wallet: str = Depends(current_user),
                         s: Session = Depends(db)):
        svc = _gacha_or_503()
        _gacha_throttle(wallet)
        try:
            out = await svc.generate_yolo_packs(player_address=wallet, pack_type=body.pack_type,
                                                count=body.count, turbo=body.turbo)
        except GachaDisabled:
            raise HTTPException(503, "gacha_disabled")
        except GachaUpstreamError as e:
            raise HTTPException(502, str(e) or "gacha upstream no disponible")
        if not out.get("transactions"):
            raise HTTPException(502, "gacha upstream no disponible")
        for tx in out["transactions"]:
            memo = tx["memo"]
            existing = s.get(GachaPack, memo)
            if existing is not None:
                if existing.wallet != wallet:
                    raise HTTPException(502, "gacha upstream no disponible")
            else:
                s.add(GachaPack(memo=memo, wallet=wallet, pack_type=body.pack_type))
        s.commit()
        return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_gacha_api.py -k "yolo or auto_sold or open_pack" -q`
Expected: PASS.

- [ ] **Step 6: Full backend suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/gacha.py backend/app/main.py backend/tests/test_gacha_api.py
git commit -m "feat(gacha): generateYoloPacks proxy + open_pack auto-sold tagging (Turbo)"
```

---

### Task 2: Frontend client — `generateYoloPacks` + helpers

**Files:**
- Modify: `src/onchain/gachaClient.ts` (`OpenPackResult` ~line 32-47; add types + fns near `openPack`/end)
- Test: `src/onchain/gachaClient.test.ts`

**Interfaces:**
- Produces:
  - `interface YoloTx { memo: string; transaction: string }`
  - `interface YoloPacksResponse { yolo_id: string | null; count: number; transactions: YoloTx[] }`
  - `generateYoloPacks(token: string, packType: string, count: number, turbo: boolean): Promise<YoloPacksResponse>`
  - `OpenPackResult` (non-pending) gains `auto_sold: boolean; buyback_amount: number | null`
  - `yoloTotalCost(price: number, count: number): number`; `clampCount(n: number): number`

- [ ] **Step 1: Write failing tests**

Append to `src/onchain/gachaClient.test.ts`:

```ts
import { generateYoloPacks, yoloTotalCost, clampCount } from './gachaClient'
import { config } from './config'

describe('yoloTotalCost / clampCount', () => {
  it('coste total = precio * count', () => {
    expect(yoloTotalCost(50, 3)).toBe(150)
    expect(yoloTotalCost(1000, 10)).toBe(10000)
  })
  it('clampCount fija a [1,10] y entero', () => {
    expect(clampCount(0)).toBe(1)
    expect(clampCount(11)).toBe(10)
    expect(clampCount(3.7)).toBe(3)
  })
})

describe('generateYoloPacks', () => {
  it('POST /gacha/yolo con Bearer + body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({
      yolo_id: 'y', count: 2, transactions: [{ memo: 'a', transaction: 'TX' }] }) })
    vi.stubGlobal('fetch', fetchMock)
    const out = await generateYoloPacks('TOKEN', 'pokemon_50', 2, true)
    expect(out.transactions[0]).toEqual({ memo: 'a', transaction: 'TX' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${config.backendUrl}/gacha/yolo`)
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer TOKEN')
    expect(JSON.parse(init.body)).toEqual({ pack_type: 'pokemon_50', count: 2, turbo: true })
    vi.unstubAllGlobals()
  })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `npx vitest run src/onchain/gachaClient.test.ts`
Expected: FAIL (imports undefined).

- [ ] **Step 3: Implement**

In `src/onchain/gachaClient.ts`, add `auto_sold` + `buyback_amount` to the non-pending `OpenPackResult` member (the object with `nft_address`):

```ts
      grading_company: string | null
      grading_id: string | null
      authenticated: boolean | null
      auto_sold: boolean
      buyback_amount: number | null
    }
```

Add near `openPack` (and the pure helpers at the end of the file):

```ts
export interface YoloTx { memo: string; transaction: string }
export interface YoloPacksResponse { yolo_id: string | null; count: number; transactions: YoloTx[] }

export function generateYoloPacks(token: string, packType: string, count: number, turbo: boolean): Promise<YoloPacksResponse> {
  return gachaFetch<YoloPacksResponse>('/gacha/yolo', {
    method: 'POST', headers: authHeaders(token),
    body: JSON.stringify({ pack_type: packType, count, turbo }),
  })
}

export function yoloTotalCost(price: number, count: number): number {
  return price * count
}

export function clampCount(n: number): number {
  return Math.max(1, Math.min(10, Math.floor(n)))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/onchain/gachaClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (The `OpenPackResult` widening: any object literal of that type now needs the 2 new fields — the only producer is the backend, decoded as `OpenPackResult`, so no frontend literal breaks. The `gachaClient.test.ts` `pollOpenPack` test builds an `OpenPackResult` literal — UPDATE that literal to include `auto_sold: false, buyback_amount: null`.)

- [ ] **Step 6: Commit**

```bash
git add src/onchain/gachaClient.ts src/onchain/gachaClient.test.ts
git commit -m "feat(gacha-client): generateYoloPacks + yoloTotalCost/clampCount + auto-sold fields"
```

---

### Task 3: MachineDetailPanel — YOLO controls

**Files:**
- Modify: `src/ui/screens/gacha/MachineDetailPanel.tsx` (`Props` ~line 6-13; add a YOLO section after the OPEN NOW button ~line 231)

**Interfaces:**
- Consumes: `yoloTotalCost`, `clampCount` (Task 2); `formatUsd`.
- Produces: `MachineDetailPanel` accepts an optional `onYolo?: (count: number, turbo: boolean) => void`.

- [ ] **Step 1: Add the prop + imports**

In `src/ui/screens/gacha/MachineDetailPanel.tsx`, extend the import from gachaClient and add `useState`:

```tsx
import { useState } from 'react'
import type { GachaMachine } from '../../../onchain/gachaClient'
import { yoloTotalCost, clampCount } from '../../../onchain/gachaClient'
```

Add to `Props`:

```tsx
  /** Open `count` packs at once (YOLO); optional turbo (auto-sell Commons). */
  onYolo?: (count: number, turbo: boolean) => void
```

Destructure it: `export function MachineDetailPanel({ machine, onOpen, authed, usdc, onYolo }: Props) {`.

- [ ] **Step 2: Add the YOLO section**

Inside the component body (after `const reduced = useReducedMotion()`), add state:

```tsx
  const [yoloCount, setYoloCount] = useState(1)
  const [turbo, setTurbo] = useState(false)
  const yoloTotal = yoloTotalCost(machine.price ?? 0, yoloCount)
  const yoloBlocked = !authed || machine.available === false || (usdc != null && usdc < yoloTotal)
```

Render this block immediately AFTER the OPEN NOW `motion.button` (after line ~231), only when `onYolo` is provided:

```tsx
      {onYolo && (
        <div style={{ borderTop: `1px solid ${COLORS.border}`, paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '.1em', color: COLORS.muted, textTransform: 'uppercase' }}>YOLO · open multiple</div>

          {/* Stepper + presets */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setYoloCount((n) => clampCount(n - 1))} aria-label="Less"
                style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.panel2, color: COLORS.text, cursor: 'pointer', fontSize: 18 }}>−</button>
              <span style={{ minWidth: 28, textAlign: 'center', fontFamily: FONTS.display, fontWeight: 800, fontSize: 18, color: COLORS.text }}>{yoloCount}</span>
              <button onClick={() => setYoloCount((n) => clampCount(n + 1))} aria-label="More"
                style={{ width: 32, height: 32, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: COLORS.panel2, color: COLORS.text, cursor: 'pointer', fontSize: 18 }}>+</button>
            </div>
            {[3, 5, 10].map((p) => (
              <button key={p} onClick={() => setYoloCount(p)}
                style={{ padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${yoloCount === p ? COLORS.green : COLORS.border}`,
                  background: yoloCount === p ? COLORS.panel2 : 'transparent',
                  color: yoloCount === p ? COLORS.green : COLORS.muted, fontFamily: FONTS.mono, fontSize: 12 }}>x{p}</button>
            ))}
          </div>

          {/* Turbo toggle — only if the machine supports it */}
          {machine.turboMode && (
            <button onClick={() => setTurbo((t) => !t)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
                border: `1px solid ${turbo ? COLORS.green : COLORS.border}`, background: turbo ? COLORS.panel2 : 'transparent', color: COLORS.text }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>⚡ Turbo — auto-sell Commons</span>
              <span style={{ fontFamily: FONTS.mono, fontSize: 12, color: turbo ? COLORS.green : COLORS.muted }}>{turbo ? 'ON' : 'OFF'}</span>
            </button>
          )}

          {/* Open ×N */}
          <motion.button
            onClick={() => onYolo(yoloCount, machine.turboMode ? turbo : false)}
            disabled={yoloBlocked}
            whileTap={reduced || yoloBlocked ? undefined : { scale: 0.97 }}
            style={{ width: '100%', borderRadius: 12, padding: '13px 18px', fontSize: 14, fontWeight: 800, fontFamily: FONTS.display, cursor: yoloBlocked ? 'not-allowed' : 'pointer',
              border: yoloBlocked ? `1px solid ${COLORS.border}` : 'none', background: yoloBlocked ? COLORS.panel2 : GRADIENT, color: yoloBlocked ? COLORS.muted : '#06120c' }}>
            {!authed ? 'Log in to open'
              : machine.available === false ? 'Currently unavailable'
              : (usdc != null && usdc < yoloTotal) ? `Insufficient USDC · ${formatUsd(usdc ?? 0)}`
              : `Open ×${yoloCount} · ${formatUsd(yoloTotal)}`}
          </motion.button>
        </div>
      )}
```

(`GRADIENT`, `formatUsd`, `motion`, `COLORS`, `FONTS` are already imported in this file.)

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean / exit 0. (No caller passes `onYolo` yet — optional, so the panel still compiles and the single-pack callsite is unaffected.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/gacha/MachineDetailPanel.tsx
git commit -m "feat(gacha): YOLO controls in machine panel (stepper + presets + turbo + cost)"
```

---

### Task 4: GachaVault — YOLO orchestration + progress/summary

**Files:**
- Modify: `src/ui/screens/gacha/GachaVault.tsx` (`Phase` ~line 46-50; `RevealOverlay` prop type ~line 462; main `<AnimatePresence>` ~line 432-449; add `handleYolo`; pass `onYolo`; add `YoloProgressOverlay` + `YoloSummaryOverlay`)

**Interfaces:**
- Consumes: `generateYoloPacks`, `YoloPacksResponse`, `OpenPackResult`, `submitTx`, `openPack`, `pollOpenPack` (existing/Task 2); `recordDrop` (existing).
- Produces: `Phase` gains `yolo` + `yolo-summary` variants; `handleYolo(count, turbo)`.

- [ ] **Step 1: Phase variants + import**

Add `generateYoloPacks` + `type YoloPacksResponse` to the existing `'../../../onchain/gachaClient'` import. Define a result alias near `Phase` and extend `Phase`:

```tsx
type YoloResult = Extract<OpenPackResult, { pending: false }>

type Phase =
  | { kind: 'machines' }
  | { kind: 'opening'; step: 'firmando' | 'enviando' | 'abriendo' }
  | { kind: 'result'; result: YoloResult }
  | { kind: 'pending'; memo: string }
  | { kind: 'yolo'; step: 'firmando' | 'enviando' | 'abriendo'; done: number; total: number }
  | { kind: 'yolo-summary'; results: YoloResult[] }
```

- [ ] **Step 2: `handleYolo`**

Add after `retryOpen`:

```tsx
  async function handleYolo(count: number, turbo: boolean) {
    if (!selected || !identityToken) return
    const total = (selected.price ?? 0) * count
    if (usdc != null && usdc < total) {
      setOpenError(`Insufficient USDC — ${count} packs cost $${total}. Deposit and try again.`)
      return
    }
    setOpenError(null)
    let resp: YoloPacksResponse
    try {
      setPhase({ kind: 'yolo', step: 'firmando', done: 0, total: count })
      resp = await generateYoloPacks(identityToken, selected.code, count, turbo)
    } catch (e) {
      setOpenError(`Couldn't start YOLO: ${e instanceof Error ? e.message : String(e)}.`)
      setPhase({ kind: 'machines' })
      return
    }
    const txs = resp.transactions
    const submitted: string[] = []
    for (let i = 0; i < txs.length; i++) {
      try {
        setPhase({ kind: 'yolo', step: 'firmando', done: i, total: txs.length })
        const signed = await signTransactionBase64(txs[i].transaction)
        setPhase({ kind: 'yolo', step: 'enviando', done: i, total: txs.length })
        await submitTx(identityToken, signed)
        submitted.push(txs[i].memo)
      } catch {
        break
      }
    }
    if (submitted.length === 0) {
      setOpenError('No packs were opened.')
      setPhase({ kind: 'machines' })
      return
    }
    const results: YoloResult[] = []
    for (let i = 0; i < submitted.length; i++) {
      setPhase({ kind: 'yolo', step: 'abriendo', done: i, total: submitted.length })
      try {
        const r = await pollOpenPack(() => openPack(identityToken, submitted[i]))
        if (!r.pending) { results.push(r); recordDrop(r) }
      } catch { /* skip */ }
    }
    if (results.length === 0) { setPhase({ kind: 'pending', memo: submitted[0] }); return }
    setPhase({ kind: 'yolo-summary', results })
  }
```

- [ ] **Step 3: Wire the panel + render the new overlays**

Pass `onYolo` to the panel (both wide and narrow branches render `<MachineDetailPanel .../>` — add the prop to each):

```tsx
              onYolo={(c, t) => void handleYolo(c, t)}
```

Narrow `RevealOverlay`'s `phase` prop type to the kinds it handles (line ~462):

```tsx
  phase: Extract<Phase, { kind: 'opening' | 'pending' | 'result' }>
```

Replace the main reveal `<AnimatePresence>` block (the `{phase.kind !== 'machines' && <RevealOverlay .../>}`) with explicit per-phase renders:

```tsx
      <AnimatePresence>
        {(phase.kind === 'opening' || phase.kind === 'pending' || phase.kind === 'result') && (
          <RevealOverlay
            phase={phase}
            reduced={reduced}
            buybackPct={selected?.instantBuyback ?? null}
            onRetry={(memo) => void retryOpen(memo)}
            onClose={() => setPhase({ kind: 'machines' })}
          />
        )}
        {phase.kind === 'yolo' && <YoloProgressOverlay phase={phase} reduced={reduced} />}
        {phase.kind === 'yolo-summary' && (
          <YoloSummaryOverlay results={phase.results} onClose={() => setPhase({ kind: 'machines' })} />
        )}
      </AnimatePresence>
```

- [ ] **Step 4: Add `YoloProgressOverlay` + `YoloSummaryOverlay`**

Add these components at the bottom of the file:

```tsx
const YOLO_STEP_LABEL: Record<'firmando' | 'enviando' | 'abriendo', string> = {
  firmando: 'Sign each pack in your wallet…',
  enviando: 'Sending to Solana…',
  abriendo: 'Opening packs…',
}

function YoloProgressOverlay({ phase, reduced }: { phase: Extract<Phase, { kind: 'yolo' }>; reduced: boolean }) {
  return (
    <motion.div key="yolo-progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,14,20,0.88)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: '44px 32px', textAlign: 'center', maxWidth: 360, width: '100%', boxShadow: SHADOW.panel }}>
        <motion.div animate={reduced ? undefined : { opacity: [1, 0.35, 1] }} transition={{ repeat: Infinity, duration: 1.4 }} style={{ fontSize: 52, marginBottom: 20 }}>🎰</motion.div>
        <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.text, fontFamily: FONTS.body, marginBottom: 8 }}>{YOLO_STEP_LABEL[phase.step]}</div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted }}>{phase.step} · {Math.min(phase.done + 1, phase.total)}/{phase.total}</div>
      </div>
    </motion.div>
  )
}

function YoloSummaryOverlay({ results, onClose }: { results: YoloResult[]; onClose: () => void }) {
  const totalValue = results.reduce((s, r) => s + (r.insured_value ?? 0), 0)
  const sold = results.filter((r) => r.auto_sold)
  const soldUsd = sold.reduce((s, r) => s + (r.buyback_amount ?? 0), 0) / 1e6
  return (
    <motion.div key="yolo-summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,14,20,0.9)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 18, padding: 22, maxWidth: 760, width: '100%', maxHeight: '90vh', overflowY: 'auto', boxShadow: SHADOW.panel }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <span style={{ fontFamily: FONTS.display, fontWeight: 900, fontSize: 20, color: COLORS.text }}>You opened {results.length} packs</span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 8, width: 30, height: 30, cursor: 'pointer' }}>✕</button>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 16 }}>
          <div><div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>TOTAL VALUE</div><div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: COLORS.green }}>{formatUsd(totalValue)}</div></div>
          {sold.length > 0 && (<div><div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>AUTO-SOLD</div><div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: COLORS.text }}>{sold.length} · {formatUsd(soldUsd)}</div></div>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
          {results.map((r, i) => {
            const accent = RARITY_COLOR[r.rarity] ?? COLORS.muted
            return (
              <div key={r.nft_address ?? i} style={{ background: COLORS.panel2, border: `1px solid ${accent}55`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ aspectRatio: '3/4', background: '#0c1019', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 8 }}>
                  {r.image ? <img src={r.image} alt={r.name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 32 }}>🃏</span>}
                </div>
                <div style={{ padding: '8px 9px 10px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name ?? '—'}</div>
                  {r.auto_sold
                    ? <div style={{ fontFamily: FONTS.mono, fontSize: 10, color: COLORS.muted }}>Auto-sold {formatUsd((r.buyback_amount ?? 0) / 1e6)}</div>
                    : r.insured_value != null && <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.green, fontWeight: 700 }}>{formatUsd(r.insured_value)}</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean / exit 0. (`Phase` is exhaustively handled; the single-pack flow is untouched.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/gacha/GachaVault.tsx
git commit -m "feat(gacha): YOLO orchestration (generate→sign→submit→open) + progress + summary"
```

---

### Task 5: Staged one-by-one reveal with Skip pack / Skip all

**Files:**
- Modify: `src/ui/screens/gacha/GachaVault.tsx` (`RevealResult` ~line 604 add `skipToCard`; `Phase` add `yolo-reveal`; `handleYolo` route to reveal; main `<AnimatePresence>`; add `YoloRevealOverlay`)

**Interfaces:**
- Consumes: `RevealResult` (existing), `YoloResult`, `formatUsd`.
- Produces: `Phase` gains `yolo-reveal`; `RevealResult` gains optional `skipToCard?: number`.

- [ ] **Step 1: Make `RevealResult` skippable**

In `RevealResult`, add an optional prop and an effect that jumps to the card stage when it changes. Change the signature to include `skipToCard?: number` and add, right after the existing auto-advance `useEffect`:

```tsx
  useEffect(() => {
    if (skipToCard) setI(steps.length - 1)
  }, [skipToCard, steps.length])
```

(Default `undefined` → `if (undefined)` is false → no effect on the single-pack path.)

- [ ] **Step 2: Add the `yolo-reveal` phase + route to it**

Add to `Phase`:

```tsx
  | { kind: 'yolo-reveal'; results: YoloResult[]; index: number }
```

In `handleYolo`, change the final line from `setPhase({ kind: 'yolo-summary', results })` to:

```tsx
    setPhase({ kind: 'yolo-reveal', results, index: 0 })
```

- [ ] **Step 3: Render `YoloRevealOverlay`**

In the main `<AnimatePresence>`, add (before the `yolo-summary` line):

```tsx
        {phase.kind === 'yolo-reveal' && (
          <YoloRevealOverlay
            results={phase.results}
            index={phase.index}
            reduced={reduced}
            buybackPct={selected?.instantBuyback ?? null}
            onAdvance={() => setPhase((p) =>
              p.kind === 'yolo-reveal'
                ? (p.index + 1 < p.results.length
                    ? { kind: 'yolo-reveal', results: p.results, index: p.index + 1 }
                    : { kind: 'yolo-summary', results: p.results })
                : p)}
            onSkipAll={() => setPhase((p) => p.kind === 'yolo-reveal' ? { kind: 'yolo-summary', results: p.results } : p)}
          />
        )}
```

(`setPhase` here uses the functional updater form — `useState`'s setter already supports it.)

- [ ] **Step 4: Add `YoloRevealOverlay`**

Add at the bottom of the file:

```tsx
function YoloRevealOverlay({ results, index, reduced, buybackPct, onAdvance, onSkipAll }: {
  results: YoloResult[]
  index: number
  reduced: boolean
  buybackPct: number | null
  onAdvance: () => void
  onSkipAll: () => void
}) {
  const [skip, setSkip] = useState(0)
  const result = results[index]
  return (
    <motion.div key="yolo-reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(11,14,20,0.9)', zIndex: 200, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 14 }}>
      <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.muted, letterSpacing: '.1em' }}>PACK {index + 1} / {results.length}</div>
      {result.auto_sold && (
        <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.green }}>⚡ Auto-sold {formatUsd((result.buyback_amount ?? 0) / 1e6)}</div>
      )}
      <RevealResult key={index} result={result} reduced={reduced} buybackPct={buybackPct} skipToCard={skip} onClose={onAdvance} />
      <div style={{ display: 'flex', gap: 10 }}>
        <button onClick={() => setSkip((s) => s + 1)}
          style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.text, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Skip pack ⏭</button>
        <button onClick={onSkipAll}
          style={{ padding: '9px 16px', borderRadius: 10, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.muted, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Skip all ⏭⏭</button>
      </div>
    </motion.div>
  )
}
```

(The card stage's own "Close" inside `CardDetailsView` calls `onClose` = `onAdvance` → next pack / summary. "Skip pack" jumps the current animation to the card; "Skip all" → summary.)

- [ ] **Step 5: Typecheck + full suite + build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc clean; suites green; build exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/gacha/GachaVault.tsx
git commit -m "feat(gacha): YOLO staged reveal one-by-one with Skip pack / Skip all"
```

---

## Self-Review

**1. Spec coverage:**
- `generate_yolo_packs` proxy + whitelist → Task 1. ✓
- `open_pack` auto_sold/buyback_amount on `TURBO_MODE_BUYBACK` → Task 1. ✓
- `POST /gacha/yolo` authed, count 1–10, store N memos, playerAddress=caller → Task 1. ✓
- Client `generateYoloPacks` + `YoloTx/YoloPacksResponse` + `OpenPackResult` fields + `yoloTotalCost`/`clampCount` → Task 2. ✓
- Panel YOLO controls (stepper + presets x3/x5/x10 + turbo gated on `turboMode` + total + gated button) → Task 3. ✓
- Orchestration (generate→sign/submit each→open each, progress, partial-failure stop) → Task 4. ✓
- Summary grid + total value + turbo auto-sold stats → Task 4. ✓
- Staged one-by-one reveal + Skip pack / Skip all + auto-sold badge + counter → Task 5. ✓
- Reuse submit/open; recordDrop per opened pack → Task 4. ✓

**2. Placeholder scan:** No TBD/TODO; complete code in every step.

**3. Type consistency:** Backend keys (`yolo_id`/`count`/`transactions`/`memo`/`transaction`; `auto_sold`/`buyback_amount`) match `YoloPacksResponse`/`YoloTx` and the `OpenPackResult` widening (Task 2), consumed by `handleYolo`/overlays (Tasks 4–5). `YoloResult = Extract<OpenPackResult,{pending:false}>` used consistently. `clampCount`/`yoloTotalCost` defined in Task 2, used in Task 3. `RevealResult.skipToCard?: number` added in Task 5 is backward-compatible. `RARITY_COLOR` (existing in GachaVault) reused in the summary grid.

## No-goals (carried from spec)
- count > 10; `altPlayerAddress`; resuming abandoned packs; YOLO history; parallel signing.
