# Gacha pool card details modal + CollectorCrypt link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each card in a gacha machine's pool clickable to open a read-only Card Details modal (CC-style: thumbnails + large image, insured value, grading), and point "View Card"/"View on CollectorCrypt" links at the real CC asset page.

**Architecture:** Enrich the backend `get_nfts` proxy (CC already returns the data) with grading/images fields; widen the `MachineCard` type; build a `CardDetailsModal`; make `CardPoolGrid` tiles clickable; add a `ccAssetUrl(mint)` helper and use it in the new modal plus the existing reveal and inventory views.

**Tech Stack:** FastAPI + httpx + respx/pytest (backend); React + TS + vitest (frontend).

## Global Constraints

- **Keyless on devnet** + **field-whitelisted responses**: `get_nfts` must keep building each card from explicit keys, never returning raw upstream JSON.
- **CC asset URL format (exact):** `https://collectorcrypt.com/assets/solana/<nft_address>`. The mint changes per card.
- **Pool modal is read-only** — no buyback controls (pool cards aren't owned).
- **Link-only change** to the reveal `CardDetailsView` and `InventoryCardModal`: swap their outbound link to `ccAssetUrl(...)`; do NOT refactor their internals.
- **No** CC "Vault"/"Contract" collapsibles.
- Reuse `COLORS`/`FONTS`/`formatUsd` from `src/ui/theme.ts`; render links only when the mint is non-null; omit grading rows whose value is null.

---

## File Structure

- `backend/app/services/gacha.py` — extract `_extract_images` static; enrich `get_nfts`.
- `backend/tests/test_gacha_api.py` — enriched-cards test.
- `src/onchain/gachaClient.ts` — widen `MachineCard`; add `ccAssetUrl`.
- `src/onchain/gachaClient.test.ts` — `ccAssetUrl` test.
- `src/ui/screens/gacha/CardDetailsModal.tsx` — NEW modal.
- `src/ui/screens/gacha/CardPoolGrid.tsx` — clickable tiles + modal.
- `src/ui/screens/gacha/GachaVault.tsx` — reveal link → CC.
- `src/ui/screens/Profile/InventoryCardModal.tsx` — inventory link → CC.

---

### Task 1: Backend — enrich `get_nfts`

**Files:**
- Modify: `backend/app/services/gacha.py` (`get_nfts` ~lines 196-216; `open_pack` images block ~lines 151-158; add a `_extract_images` static)
- Test: `backend/tests/test_gacha_api.py`

**Interfaces:**
- Produces: each `/gacha/machines/{code}/cards` item gains `images: list[str]`, `grading_company`, `grading_id`, `the_grade`, `generic_grade`, `authenticated: bool|None`, `year` (plus the existing `nft_address/name/image/rarity/insured_value/grade`).

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_gacha_api.py` (uses existing `_client`, `BASE`):

```python
@respx.mock
def test_machine_cards_enriched():
    respx.get(f"{BASE}/api/getNfts").mock(return_value=Response(200, json={"nfts": [{
        "nft_address": "MINT1", "name": "1999 Charizard", "image": "img-front",
        "rarity": "epic", "insured_value": 5000,
        "content": {"files": [
            {"cc_cdn": "img-front"}, {"cdn_uri": "img-back"},
        ]},
        "attributes": [
            {"trait_type": "Year", "value": "1999"},
            {"trait_type": "Grading Company", "value": "PSA"},
            {"trait_type": "Grading ID", "value": "44272228"},
            {"trait_type": "The Grade", "value": "MINT 9"},
            {"trait_type": "GradeNum", "value": 9},
            {"trait_type": "Authenticated", "value": "true"},
        ],
    }]}))
    c, _ = _client(api_key="")
    r = c.get("/gacha/machines/pokemon_50/cards?limit=10")
    assert r.status_code == 200
    card = r.json()[0]
    assert card["images"] == ["img-front", "img-back"]
    assert card["grading_company"] == "PSA"
    assert card["grading_id"] == "44272228"
    assert card["the_grade"] == "MINT 9"
    assert card["generic_grade"] == "9"
    assert card["authenticated"] is True
    assert card["year"] == "1999"
    assert card["grade"] == "PSA MINT 9"  # existing composed field unchanged
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_gacha_api.py::test_machine_cards_enriched -q`
Expected: FAIL with `KeyError`/missing keys (`images`, `grading_company`, …).

- [ ] **Step 3: Extract the `_extract_images` static**

In `backend/app/services/gacha.py`, add this static method (place it next to `_extract_grade`/`_extract_year`):

```python
    @staticmethod
    def _extract_images(content: dict, fallback: Optional[str]) -> list:
        images: list = []
        for f in (content.get("files") or []):
            if isinstance(f, dict):
                u = f.get("cc_cdn") or f.get("cdn_uri") or f.get("uri")
                if u and u not in images:
                    images.append(u)
        if not images and fallback:
            images = [fallback]
        return images
```

Then refactor the `open_pack` images block (currently ~lines 151-158) to use it. Replace:

```python
        # images: prefer content.files (cc_cdn > cdn_uri > uri); fallback to the single image
        images: list = []
        for f in content.get("files") or []:
            if isinstance(f, dict):
                u = f.get("cc_cdn") or f.get("cdn_uri") or f.get("uri")
                if u and u not in images:
                    images.append(u)
        if not images and nft_won.get("image"):
            images = [nft_won["image"]]
```

with:

```python
        # images: prefer content.files (cc_cdn > cdn_uri > uri); fallback to the single image
        images = self._extract_images(content, nft_won.get("image"))
```

- [ ] **Step 4: Enrich `get_nfts`**

Replace the loop body in `get_nfts` (the `for n in items:` block, ~lines 210-215) with:

```python
        out = []
        for n in items:
            if not isinstance(n, dict):
                continue
            attributes = n.get("attributes") or []
            a = {t.get("trait_type"): t.get("value") for t in attributes if isinstance(t, dict)}
            authed = a.get("Authenticated")
            gradenum = a.get("GradeNum")
            card = {k: n.get(k) for k in _NFT_FIELDS}
            card["grade"] = self._extract_grade(attributes)
            card["images"] = self._extract_images(n.get("content") or {}, n.get("image"))
            card["grading_company"] = a.get("Grading Company")
            card["grading_id"] = a.get("Grading ID")
            card["the_grade"] = a.get("The Grade")
            card["generic_grade"] = str(gradenum) if gradenum is not None else None
            card["authenticated"] = (str(authed).strip().lower() == "true") if authed is not None else None
            card["year"] = self._extract_year(attributes, n.get("name"))
            out.append(card)
        return out
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_gacha_api.py -k "machine_cards or open_pack" -q`
Expected: PASS (new enriched test + existing `test_machine_cards_ok` + `open_pack` tests all green — the `open_pack` refactor must not regress).

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/gacha.py backend/tests/test_gacha_api.py
git commit -m "feat(gacha): enrich get_nfts with images + grading details (shared _extract_images)"
```

---

### Task 2: Frontend client — widen `MachineCard` + `ccAssetUrl`

**Files:**
- Modify: `src/onchain/gachaClient.ts` (`MachineCard` interface ~lines 72-79; add `ccAssetUrl` near the bottom)
- Test: `src/onchain/gachaClient.test.ts`

**Interfaces:**
- Produces: widened `MachineCard`; `export function ccAssetUrl(mint: string): string`.

- [ ] **Step 1: Write the failing test**

Append to `src/onchain/gachaClient.test.ts`:

```ts
import { ccAssetUrl } from './gachaClient'

describe('ccAssetUrl', () => {
  it('apunta a la página del asset en CollectorCrypt', () => {
    expect(ccAssetUrl('7mNc3Hr1Aqr16u8Y5VKQDinLHbBumUxV6T6kxFRz2xGH'))
      .toBe('https://collectorcrypt.com/assets/solana/7mNc3Hr1Aqr16u8Y5VKQDinLHbBumUxV6T6kxFRz2xGH')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/onchain/gachaClient.test.ts`
Expected: FAIL (`ccAssetUrl is not a function`).

- [ ] **Step 3: Widen `MachineCard` + add `ccAssetUrl`**

In `src/onchain/gachaClient.ts`, replace the `MachineCard` interface (lines 72-79) with:

```ts
export interface MachineCard {
  nft_address: string | null
  name: string | null
  image: string | null
  rarity: string | null
  insured_value: number | null
  grade: string | null
  images: string[]
  grading_company: string | null
  grading_id: string | null
  the_grade: string | null
  generic_grade: string | null
  authenticated: boolean | null
  year: string | null
}
```

Add at the end of the file:

```ts
/** Public CollectorCrypt asset page for a Solana NFT mint. */
export function ccAssetUrl(mint: string): string {
  return `https://collectorcrypt.com/assets/solana/${mint}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/onchain/gachaClient.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (CardPoolGrid only reads `nft_address/name/image/rarity/insured_value/grade`, so the widening is additive and non-breaking.)

- [ ] **Step 6: Commit**

```bash
git add src/onchain/gachaClient.ts src/onchain/gachaClient.test.ts
git commit -m "feat(gacha-client): widen MachineCard with grading/images; add ccAssetUrl"
```

---

### Task 3: `CardDetailsModal` + clickable pool tiles

**Files:**
- Create: `src/ui/screens/gacha/CardDetailsModal.tsx`
- Modify: `src/ui/screens/gacha/CardPoolGrid.tsx`

**Interfaces:**
- Consumes: `MachineCard`, `ccAssetUrl` (Task 2); `COLORS`, `FONTS`, `formatUsd`.
- Produces: `export function CardDetailsModal(props: { card: MachineCard; onClose: () => void }): JSX.Element`.

- [ ] **Step 1: Create the modal**

Create `src/ui/screens/gacha/CardDetailsModal.tsx`. Mirror the CC card modal; reuse theme tokens.

```tsx
import { useEffect, useRef, useState } from 'react'
import { COLORS, FONTS, formatUsd } from '../../theme'
import { ccAssetUrl, type MachineCard } from '../../../onchain/gachaClient'

function abbreviate(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 6)}…${mint.slice(-6)}` : mint
}

export function CardDetailsModal({ card, onClose }: { card: MachineCard; onClose: () => void }) {
  const gallery = card.images.length > 0 ? card.images : card.image ? [card.image] : []
  const [active, setActive] = useState(0)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

  const mint = card.nft_address
  const big = gallery[active] ?? null

  function copyMint() {
    if (!mint || !navigator.clipboard) return
    void navigator.clipboard.writeText(mint).then(() => {
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1800)
    })
  }

  const label = { fontFamily: FONTS.mono, fontSize: 10, letterSpacing: '0.12em', color: COLORS.muted } as const
  const value = { fontSize: 13, color: COLORS.text, fontWeight: 600 } as const
  const gradingRows: Array<[string, string]> = []
  if (card.grading_company) gradingRows.push(['Grading Company', card.grading_company])
  if (card.grading_id) gradingRows.push(['Grading ID', card.grading_id])
  if (card.the_grade) gradingRows.push(['Grade', card.the_grade])
  if (card.generic_grade) gradingRows.push(['Generic Grade', card.generic_grade])
  if (card.authenticated != null) gradingRows.push(['Authenticated', card.authenticated ? 'Yes' : 'No'])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.66)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(880px, 100%)', maxHeight: '90vh', overflowY: 'auto',
          background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 16, padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 16, color: COLORS.text }}>Card Details</span>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'transparent', border: `1px solid ${COLORS.border}`, color: COLORS.muted, borderRadius: 8, width: 30, height: 30, cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
          {/* Left — gallery */}
          <div style={{ display: 'flex', gap: 12 }}>
            {gallery.length > 1 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {gallery.map((src, i) => (
                  <button key={src + i} onClick={() => setActive(i)}
                    style={{ width: 56, height: 76, borderRadius: 8, overflow: 'hidden', cursor: 'pointer', padding: 0,
                      background: COLORS.panel2, border: `2px solid ${i === active ? COLORS.green : COLORS.border}` }}>
                    <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  </button>
                ))}
              </div>
            )}
            <div style={{ flex: 1, aspectRatio: '3/4', background: COLORS.panel2, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', padding: 12 }}>
              {big ? <img src={big} alt={card.name ?? ''} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 48 }}>🃏</span>}
            </div>
          </div>

          {/* Right — info */}
          <div>
            <div style={{ fontFamily: FONTS.mono, fontSize: 11, color: COLORS.green, marginBottom: 8 }}>◎ Guaranteed Authenticity</div>
            <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 22, color: COLORS.text, lineHeight: 1.2, marginBottom: 16 }}>{card.name ?? 'Card'}</div>

            <div style={{ background: COLORS.violet, borderRadius: 12, padding: 16, marginBottom: 18 }}>
              <div style={{ ...label, color: '#ffffffcc' }}>INSURED VALUE</div>
              <div style={{ fontFamily: FONTS.display, fontWeight: 900, fontSize: 26, color: '#fff', marginBottom: mint ? 6 : 0 }}>
                {card.insured_value != null ? formatUsd(card.insured_value) : '—'}
              </div>
              {mint && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: FONTS.mono, fontSize: 11, color: '#ffffffcc' }}>Token ID: {abbreviate(mint)}</span>
                  <button onClick={copyMint} style={{ background: '#ffffff22', border: 'none', color: '#fff', borderRadius: 6, padding: '2px 8px', fontSize: 11, cursor: 'pointer' }}>{copied ? 'Copied' : 'Copy'}</button>
                  <a href={ccAssetUrl(mint)} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', background: '#ffffff', color: COLORS.violet, borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>View Card ↗</a>
                </div>
              )}
            </div>

            {gradingRows.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: FONTS.display, fontWeight: 700, fontSize: 14, color: COLORS.text, marginBottom: 10 }}>Grading</div>
                {gradingRows.map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${COLORS.border}` }}>
                    <span style={label}>{k}</span>
                    <span style={value}>{v}</span>
                  </div>
                ))}
              </div>
            )}

            {mint && (
              <a href={ccAssetUrl(mint)} target="_blank" rel="noreferrer"
                style={{ display: 'block', textAlign: 'center', border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: '11px', color: COLORS.text, fontWeight: 700, textDecoration: 'none', fontSize: 13 }}>
                View on CollectorCrypt ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Make pool tiles clickable + render the modal**

In `src/ui/screens/gacha/CardPoolGrid.tsx`:

1. Update the imports at the top:
```tsx
import { useState } from 'react'
import { motion } from 'framer-motion'
import { COLORS, FONTS, RARITY, SHADOW, formatUsd } from '../../theme'
import { useReducedMotion } from '../../useReducedMotion'
import type { MachineCard } from '../../../onchain/gachaClient'
import { CardDetailsModal } from './CardDetailsModal'
```

2. At the top of the `CardPoolGrid` component body (right after `const reduced = useReducedMotion()`), add:
```tsx
  const [selected, setSelected] = useState<MachineCard | null>(null)
```

3. On the card `motion.div` (the tile, the element with `key={card.nft_address ?? i}`), add click + keyboard handlers and a pointer cursor. Change its opening props to:
```tsx
              <motion.div
                key={card.nft_address ?? i}
                variants={itemVariants}
                onClick={() => setSelected(card)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(card) } }}
                whileHover={reduced ? undefined : { y: -4, boxShadow: SHADOW.glow(accent) }}
                style={{
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  transition: 'box-shadow 0.18s',
                }}
              >
```
(Only `cursor` changes from `'default'` to `'pointer'`, plus the three new handlers — leave the rest of the tile markup unchanged.)

4. Render the modal at the end of the outer `<div>` returned by `CardPoolGrid` (just before its closing `</div>`):
```tsx
      {selected && <CardDetailsModal card={selected} onClose={() => setSelected(null)} />}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: tsc clean; build exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/gacha/CardDetailsModal.tsx src/ui/screens/gacha/CardPoolGrid.tsx
git commit -m "feat(gacha): clickable pool cards open a CC-style Card Details modal"
```

---

### Task 4: Use the CC link in the reveal + inventory views

**Files:**
- Modify: `src/ui/screens/gacha/GachaVault.tsx` (reveal `CardDetailsView`: `explorerUrl` ~line 750; anchor text ~line 1034)
- Modify: `src/ui/screens/Profile/InventoryCardModal.tsx` (`explorerUrl` ~line 80; anchor ~line 131)

**Interfaces:**
- Consumes: `ccAssetUrl` (Task 2).

- [ ] **Step 1: Reveal view → CC link**

In `src/ui/screens/gacha/GachaVault.tsx`:

1. Ensure `ccAssetUrl` is imported from `'../../../onchain/gachaClient'` (it already imports `generatePack, submitTx, openPack, ...` from there — add `ccAssetUrl` to that import list).
2. Replace line ~750:
```tsx
  const explorerUrl = `https://explorer.solana.com/address/${result.nft_address}?cluster=devnet`
```
with:
```tsx
  const explorerUrl = ccAssetUrl(result.nft_address)
```
3. Replace the anchor label (line ~1034) `View token &#8599;` with `View on CollectorCrypt &#8599;`.

- [ ] **Step 2: Inventory modal → CC link**

In `src/ui/screens/Profile/InventoryCardModal.tsx`:

1. Add `import { ccAssetUrl } from '../../../onchain/gachaClient'` (alongside the existing `fetchBuybackAvailable, requestBuyback, submitTx` import from that module — add `ccAssetUrl` to it).
2. Replace line ~80:
```tsx
  const explorerUrl = `https://explorer.solana.com/address/${card.mint}?cluster=devnet`
```
with:
```tsx
  const explorerUrl = ccAssetUrl(card.mint)
```
3. Replace the anchor text (line ~131) `View token ↗` with `View on CollectorCrypt ↗`.

- [ ] **Step 3: Typecheck + tests + build**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: tsc clean; all vitest suites green; build exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/gacha/GachaVault.tsx src/ui/screens/Profile/InventoryCardModal.tsx
git commit -m "feat(gacha): reveal + inventory 'View' links point to CollectorCrypt asset page"
```

---

## Self-Review

**1. Spec coverage:**
- Backend enrichment (images/grading_company/grading_id/the_grade/generic_grade/authenticated/year) → Task 1. ✓
- `MachineCard` widening + `ccAssetUrl` → Task 2. ✓
- `CardDetailsModal` (gallery, title, insured-value box + Token ID + View Card, grading rows, View on CollectorCrypt) → Task 3. ✓
- Pool tiles clickable + modal wiring → Task 3. ✓
- CC link in reveal + inventory → Task 4. ✓
- Error/edge: links only when mint non-null (modal `{mint && …}`, reveal/inventory mints always present); image fallback; grading rows omitted when null → Task 3. ✓
- Read-only (no buyback) → Task 3 (modal has none). ✓
- No Vault/Contract → not built. ✓

**2. Placeholder scan:** No TBD/TODO; all code blocks complete.

**3. Type consistency:** Backend keys (`images/grading_company/grading_id/the_grade/generic_grade/authenticated/year`) match the widened `MachineCard` (Task 2) and the modal's reads (Task 3). `ccAssetUrl(mint: string)` defined in Task 2, consumed in Tasks 3 & 4. `generic_grade` is a string both sides (backend coerces `str(GradeNum)`).

## No-goals (carried from spec)
- Buyback on pool cards; CC Vault/Contract collapsibles; refactoring reveal/inventory modal internals (link-only); pre-loading details on the grid.
