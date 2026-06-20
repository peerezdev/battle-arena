# Pack Battle #1 — Delegated-signing infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the backend sign & send Solana transactions on behalf of a user's delegated Privy embedded wallet (so later Pack Battle orchestration runs server-side), plus the two devnet verifications that de-risk the operator-orchestrated architecture.

**Architecture:** A client one-time delegation consent (`useDelegatedActions`), a backend `PrivySigner` that calls Privy's wallet RPC with a P-256 `privy-authorization-signature`, and a wallet-id resolver extending the existing `PrivyVerifier`. Tasks 1–3 are buildable + unit-tested now; Task 4 is a manual devnet runbook gated on the user's Privy authorization key + a paid test pull.

**Tech Stack:** FastAPI + httpx + `cryptography` (P-256) + pytest/respx (backend); React + Privy `@privy-io/react-auth@3.31` + vitest (frontend).

## Global Constraints

- `PRIVY_APP_SECRET` + `PRIVY_AUTH_KEY` live ONLY in `backend/.env`; never shipped to the client.
- Privy RPC: `POST https://api.privy.io/v1/wallets/{wallet_id}/rpc`, body `{method:"signAndSendTransaction", caip2:"solana:<cluster>", params:{transaction:<base64>, encoding:"base64"}}`, headers `Authorization: Basic base64(app_id:app_secret)`, `privy-app-id`, `privy-authorization-signature`, `Content-Type: application/json`.
- `privy-authorization-signature` = base64(DER ECDSA-P256-SHA256 over canonical JSON `{version:1, method, url, body, headers:{"privy-app-id":app_id}}`, keys sorted, separators `(",",":")`). **This canonicalization is confirmed/corrected against the live API in Task 4.**
- The signer never logs tx bytes, keys, or signatures.
- `PRIVY_AUTH_KEY` unset ⇒ signer disabled (kill-switch); dependent endpoints 503.

---

## File Structure
- `src/wallet/useDelegation.ts` — client delegation consent + status hook.
- `src/ui/screens/Profile/DelegationPanel.tsx` — a temporary enable/status panel (real UI is sub-project #4).
- `backend/app/services/privy_signer.py` — `PrivySigner` + `authorization_signature` + `PrivySignerError`.
- `backend/app/privy.py` — extend `PrivyVerifier` to resolve the embedded Solana wallet **id**.
- `backend/app/main.py` — wire `PrivySigner` config.
- `backend/tests/test_privy_signer.py`, `backend/tests/test_privy.py` — unit tests.

---

### Task 1: Client delegation consent + status hook

**Files:**
- Create: `src/wallet/useDelegation.ts`
- Create: `src/ui/screens/Profile/DelegationPanel.tsx`
- Test: `src/wallet/useDelegation.test.ts`

**Interfaces:**
- Produces: `useDelegation(): { delegated: boolean; enable: () => Promise<void> }`; pure helper `isSolanaDelegated(linkedAccounts): boolean`.

- [ ] **Step 1: Write the failing test (pure helper)**

`src/wallet/useDelegation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isSolanaDelegated } from './useDelegation'

describe('isSolanaDelegated', () => {
  it('true sólo si hay una embedded Solana con delegated', () => {
    expect(isSolanaDelegated([{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', delegated: true, address: 'A' }])).toBe(true)
    expect(isSolanaDelegated([{ type: 'wallet', chainType: 'solana', walletClientType: 'privy', delegated: false, address: 'A' }])).toBe(false)
    expect(isSolanaDelegated([{ type: 'wallet', chainType: 'ethereum', walletClientType: 'privy', delegated: true, address: 'B' }])).toBe(false)
    expect(isSolanaDelegated([])).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/wallet/useDelegation.test.ts`
Expected: FAIL (module/`isSolanaDelegated` missing).

- [ ] **Step 3: Implement the hook + helper**

`src/wallet/useDelegation.ts`:
```ts
import { usePrivy } from '@privy-io/react-auth'
import { useDelegatedActions } from '@privy-io/react-auth'

interface AccountLike {
  type?: string; chainType?: string; walletClientType?: string; connectorType?: string
  delegated?: boolean; address?: string
}

/** True iff the user has an embedded Solana wallet delegated to the app. */
export function isSolanaDelegated(accounts: AccountLike[]): boolean {
  return accounts.some(
    (a) => a.type === 'wallet' && a.chainType === 'solana' &&
      (a.walletClientType === 'privy' || a.connectorType === 'embedded') && a.delegated === true,
  )
}

export function useDelegation(): { delegated: boolean; enable: () => Promise<void> } {
  const { user } = usePrivy()
  const { delegateWallet } = useDelegatedActions()
  const accounts = (user?.linkedAccounts ?? []) as unknown as AccountLike[]
  const delegated = isSolanaDelegated(accounts)
  const embedded = accounts.find(
    (a) => a.type === 'wallet' && a.chainType === 'solana' &&
      (a.walletClientType === 'privy' || a.connectorType === 'embedded') && a.address,
  )
  async function enable() {
    if (!embedded?.address) return
    await delegateWallet({ address: embedded.address, chainType: 'solana' })
  }
  return { delegated, enable }
}
```

- [ ] **Step 4: Temporary enable/status panel**

`src/ui/screens/Profile/DelegationPanel.tsx`:
```tsx
import { COLORS, FONTS } from '../../theme'
import { useDelegation } from '../../../wallet/useDelegation'

export function DelegationPanel() {
  const { delegated, enable } = useDelegation()
  return (
    <div style={{ background: COLORS.panel, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 16, marginTop: 16 }}>
      <div style={{ fontFamily: FONTS.display, fontWeight: 800, fontSize: 14, color: COLORS.text, marginBottom: 6 }}>Pack Battle signing</div>
      <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 10, lineHeight: 1.5 }}>
        Delegate signing so battles run without pop-ups. You can revoke anytime in Privy.
      </div>
      {delegated
        ? <div style={{ fontFamily: FONTS.mono, fontSize: 12, color: COLORS.green }}>✓ Delegated</div>
        : <button onClick={() => void enable()} style={{ background: COLORS.green, color: '#03110a', border: 'none', borderRadius: 10, padding: '10px 16px', fontWeight: 800, fontFamily: FONTS.display, cursor: 'pointer' }}>Enable</button>}
    </div>
  )
}
```
Render it once for testing: in `src/ui/screens/Profile/OverviewTab.tsx`, import `DelegationPanel` and render `<DelegationPanel />` at the end of its returned content.

- [ ] **Step 5: Run test + tsc + build**

Run: `npx vitest run src/wallet/useDelegation.test.ts && npx tsc --noEmit && npm run build`
Expected: test PASS; tsc clean; build exit 0. (If `useDelegatedActions`/`delegateWallet` isn't exported by `@privy-io/react-auth@3.31`, import it from the documented path and adjust — confirm via `node -e "console.log(Object.keys(require('@privy-io/react-auth')))"` and use the exact export name.)

- [ ] **Step 6: Commit**

```bash
git add src/wallet/useDelegation.ts src/wallet/useDelegation.test.ts src/ui/screens/Profile/DelegationPanel.tsx src/ui/screens/Profile/OverviewTab.tsx
git commit -m "feat(packbattle): client delegation consent + status hook"
```

---

### Task 2: Backend `PrivySigner` (authorization signature + RPC)

**Files:**
- Create: `backend/app/services/privy_signer.py`
- Modify: `backend/app/main.py` (config wiring in `create_app`)
- Test: `backend/tests/test_privy_signer.py`

**Interfaces:**
- Produces:
  - `authorization_signature(method: str, url: str, body: dict, app_id: str, auth_key_pem: str) -> str`
  - `class PrivySigner(app_id, app_secret, auth_key_pem, cluster_caip2, base_url='https://api.privy.io', timeout=15.0)` with `enabled: bool` and `async sign_and_send_solana(wallet_id: str, tx_base64: str) -> str`
  - `class PrivySignerError(Exception)`

- [ ] **Step 1: Write failing tests**

`backend/tests/test_privy_signer.py`:
```python
import base64, json
import pytest, respx
from httpx import Response
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization, hashes
from app.services.privy_signer import PrivySigner, PrivySignerError, authorization_signature

def _p256_pem():
    key = ec.generate_private_key(ec.SECP256R1())
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption()).decode(), key.public_key()

def test_authorization_signature_is_verifiable_p256():
    pem, pub = _p256_pem()
    body = {"method": "signAndSendTransaction", "caip2": "solana:dev", "params": {"transaction": "AA", "encoding": "base64"}}
    sig = authorization_signature("POST", "https://api.privy.io/v1/wallets/w1/rpc", body, "app123", pem)
    # canonical payload must match what we signed
    payload = {"version": 1, "method": "POST", "url": "https://api.privy.io/v1/wallets/w1/rpc",
               "body": body, "headers": {"privy-app-id": "app123"}}
    msg = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    pub.verify(base64.b64decode(sig), msg, ec.ECDSA(hashes.SHA256()))  # raises if invalid

@respx.mock
@pytest.mark.asyncio
async def test_sign_and_send_builds_request_and_returns_hash():
    pem, _ = _p256_pem()
    route = respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(
        return_value=Response(200, json={"data": {"hash": "SIG123", "caip2": "solana:dev"}}))
    s = PrivySigner(app_id="app123", app_secret="sek", auth_key_pem=pem, cluster_caip2="solana:dev")
    out = await s.sign_and_send_solana("w1", "BASE64TX")
    assert out == "SIG123"
    req = route.calls.last.request
    assert req.headers["privy-app-id"] == "app123"
    assert req.headers["authorization"].startswith("Basic ")
    assert "privy-authorization-signature" in req.headers
    sent = json.loads(req.content)
    assert sent["method"] == "signAndSendTransaction"
    assert sent["caip2"] == "solana:dev"
    assert sent["params"] == {"transaction": "BASE64TX", "encoding": "base64"}

@respx.mock
@pytest.mark.asyncio
async def test_sign_and_send_raises_on_error():
    pem, _ = _p256_pem()
    respx.post("https://api.privy.io/v1/wallets/w1/rpc").mock(return_value=Response(400, json={"error": "bad"}))
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem=pem, cluster_caip2="solana:dev")
    with pytest.raises(PrivySignerError):
        await s.sign_and_send_solana("w1", "TX")

def test_disabled_without_auth_key():
    s = PrivySigner(app_id="a", app_secret="s", auth_key_pem="", cluster_caip2="solana:dev")
    assert s.enabled is False
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_privy_signer.py -q`
Expected: FAIL (module missing). If `cryptography` import fails, `cd backend && .venv/bin/pip install cryptography` first (PyJWT usually already pulls it).

- [ ] **Step 3: Implement `privy_signer.py`**

```python
"""Server-side signing of Solana txs for delegated Privy embedded wallets.

PRIVY_AUTH_KEY (P-256 PEM) lives only in backend/.env. Never log tx bytes/keys/signatures.
"""
from __future__ import annotations
import base64, json
from typing import Any, Callable, Optional
import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec


class PrivySignerError(Exception):
    pass


def authorization_signature(method: str, url: str, body: dict, app_id: str, auth_key_pem: str) -> str:
    payload = {"version": 1, "method": method, "url": url, "body": body,
               "headers": {"privy-app-id": app_id}}
    msg = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    key = serialization.load_pem_private_key(auth_key_pem.encode(), password=None)
    der = key.sign(msg, ec.ECDSA(hashes.SHA256()))
    return base64.b64encode(der).decode()


class PrivySigner:
    def __init__(self, app_id: str, app_secret: str, auth_key_pem: str, cluster_caip2: str,
                 base_url: str = "https://api.privy.io", timeout: float = 15.0):
        self._app_id = app_id
        self._app_secret = app_secret
        self._auth_key = auth_key_pem
        self._caip2 = cluster_caip2
        self._base = base_url.rstrip("/")
        self._timeout = timeout

    @property
    def enabled(self) -> bool:
        return bool(self._auth_key and self._app_id and self._app_secret)

    async def sign_and_send_solana(self, wallet_id: str, tx_base64: str) -> str:
        if not self.enabled:
            raise PrivySignerError("privy signer disabled (PRIVY_AUTH_KEY unset)")
        url = f"{self._base}/v1/wallets/{wallet_id}/rpc"
        body = {"method": "signAndSendTransaction", "caip2": self._caip2,
                "params": {"transaction": tx_base64, "encoding": "base64"}}
        basic = base64.b64encode(f"{self._app_id}:{self._app_secret}".encode()).decode()
        headers = {
            "Authorization": f"Basic {basic}",
            "privy-app-id": self._app_id,
            "privy-authorization-signature": authorization_signature("POST", url, body, self._app_id, self._auth_key),
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            try:
                resp = await client.post(url, json=body, headers=headers)
                resp.raise_for_status()
                data = resp.json()
            except httpx.HTTPStatusError as e:
                reason = None
                try:
                    j = e.response.json()
                    reason = j.get("error") or j.get("message")
                except Exception:
                    reason = None
                raise PrivySignerError(str(reason)[:160] if reason else "privy rpc error")
            except (httpx.HTTPError, ValueError):
                raise PrivySignerError("privy rpc unavailable")
        h = (data or {}).get("data", {}).get("hash")
        if not h:
            raise PrivySignerError("privy rpc: no hash in response")
        return h
```

- [ ] **Step 4: Wire config in `create_app`**

In `backend/app/main.py`, mirror how `gacha`/`privy` are constructed and injected. Add a `privy_signer: PrivySigner | None = None` parameter to `create_app` and (where the app reads env to build services) construct it from `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `PRIVY_AUTH_KEY`, `PRIVY_SOLANA_CAIP2`. (Read the existing env-wiring block and follow it exactly; no endpoint is added in this sub-project — the signer is consumed by sub-project #2.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest tests/test_privy_signer.py -q`
Expected: PASS (4 tests).

- [ ] **Step 6: Full backend suite**

Run: `cd backend && .venv/bin/pytest -q`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add backend/app/services/privy_signer.py backend/app/main.py backend/tests/test_privy_signer.py
git commit -m "feat(packbattle): PrivySigner — P-256 authorization sig + Solana wallet RPC"
```

---

### Task 3: Resolve the delegated embedded Solana wallet **id**

**Files:**
- Modify: `backend/app/privy.py` (the `PrivyVerifier`)
- Test: `backend/tests/test_privy.py`

**Interfaces:**
- Consumes: the Privy identity-token claims (already parsed by `PrivyVerifier`).
- Produces: `PrivyVerifier.embedded_solana_wallet_id(token: str) -> str` returning the embedded Solana wallet's `id` (the value Privy's wallet RPC needs), or raising the existing auth error if absent.

- [ ] **Step 1: Write the failing test**

Read `backend/tests/test_privy.py` + `backend/app/privy.py` first to mirror how `embedded_solana_wallet` (address) is currently extracted and tested. Add a test that a token whose linked Solana embedded account carries an `id` field returns that id via `embedded_solana_wallet_id`, using the same ES256 fixture helper the existing tests use (`make_es256` / the claims builder). (Exact claim shape: the embedded account object has `id`, `chain_type: "solana"`, `wallet_client_type: "privy"`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_privy.py -k wallet_id -q`
Expected: FAIL (method missing).

- [ ] **Step 3: Implement `embedded_solana_wallet_id`**

In `backend/app/privy.py`, add a method mirroring `embedded_solana_wallet` but returning the matched account's `id` (the wallet id) instead of its address. Reuse the same matcher (`chain_type == "solana"` and `wallet_client_type == "privy"`). If the claims don't carry the wallet `id` (older token shape), raise the existing `PrivyAuthError` so the caller can fall back to the Privy users API in sub-project #2.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_privy.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/privy.py backend/tests/test_privy.py
git commit -m "feat(packbattle): resolve delegated embedded Solana wallet id from Privy token"
```

---

### Task 4 (MANUAL — devnet, gated on the user's Privy authorization key + ~$50): live verifications

> NOT subagent-executable. Run together with the user once `PRIVY_AUTH_KEY` is set in `backend/.env`, the Privy authorization key is registered as a key quorum in the dashboard, the user has delegated (Task 1 panel), and the embedded wallet holds ≥ $50 USDC. This task PINS the real `privy-authorization-signature` canonicalization and proves CC delivery.

- [ ] **Step 1: Privy delegation e2e (pins canonicalization).** Write a one-off script `backend/scripts/verify_privy_sign.py` that: builds a trivial Solana transaction (a single SPL Memo-program instruction, fee payer = the delegated embedded wallet, a fresh blockhash from the devnet RPC), base64-serializes it, and calls `PrivySigner.sign_and_send_solana(wallet_id, tx_base64)` against the LIVE Privy API. Run it. If Privy returns `400 invalid signature`, iterate `authorization_signature`'s canonicalization (field order, whether `body` is the parsed object vs a string, header set) against Privy's published signing utility until Privy returns a `hash`. Confirm the memo tx lands on devnet (explorer). Capture the exact accepted canonicalization + a golden `(payload, key, signature)` vector; back-port it into `test_privy_signer.py::test_authorization_signature_is_verifiable_p256` as a fixed assertion so regressions are caught.

- [ ] **Step 2: CC `altPlayerAddress` delivery (proves custody).** With the delegated wallet, call `generatePack(playerAddress=embedded, packType="pokemon_50", altPlayerAddress=<a fresh backend-controlled wallet>)`, sign+submit via `PrivySigner`, then `openPack` and confirm via DAS/explorer that the NFT is owned by the backend wallet and NOT the embedded wallet. Record the result in `docs/ONCHAIN.md` (a new "Pack Battle delivery test" note).

- [ ] **Step 3: Decision gate.** If both pass → sub-project #1 is verified; proceed to sub-project #2 (escrow + orchestration). If delivery fails (NFT not redirected) or Privy signing can't be made to work → STOP and reopen the architecture decision (per the parent spec).

---

## Self-Review

**1. Spec coverage:** client delegation consent + status → Task 1; `PrivySigner` (auth sig + RPC) + config → Task 2; wallet-id resolution → Task 3; the two devnet verifications → Task 4. ✓
**2. Placeholder scan:** Tasks 1–3 have complete code/commands. Task 4 is intentionally a manual runbook (external API + paid pull); its "iterate canonicalization" step is the de-risk, not a placeholder. Task 2 Step 4 + Task 3 say "read the existing wiring and mirror it" because the exact env-block/claims lines must be read live — acceptable (no inventable value).
**3. Type consistency:** `authorization_signature(method,url,body,app_id,auth_key_pem)`, `PrivySigner.sign_and_send_solana(wallet_id, tx_base64) -> str`, `PrivySignerError`, `isSolanaDelegated`, `useDelegation`, `embedded_solana_wallet_id` consistent across tasks and the spec.

## No-goals (carried from spec)
- Orchestration/escrow (#2), lobby/state (#3), full battle UI (#4). Only delegation + signer + verifications here.
