# Privy B1 (balance USDC) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Mostrar el balance USDC real de la embedded wallet de Privy en el top bar (Hub + GameLayout).

**Architecture:** Hook `useUsdcBalance` que toma la dirección de la embedded Solana wallet de Privy y lee el balance del stake mint por RPC; los dos pills de balance lo usan. Sin backend.

**Tech Stack:** React + @privy-io/react-auth + @solana/web3.js.

**Spec:** `docs/superpowers/specs/2026-06-10-privy-balance-b1-design.md`. **Verificación:** `npx tsc --noEmit && npx vitest run && npm run build` verdes.

---

### Task 1: Hook `useUsdcBalance` + wire en los dos pills

**Files:**
- Create: `src/wallet/useUsdcBalance.ts`
- Create: `src/wallet/useUsdcBalance.test.ts`
- Modify: `src/ui/layouts/GameLayout.tsx`
- Modify: `src/ui/screens/Hub/Hub.tsx`

- [ ] **Step 1: Test que falla — `src/wallet/useUsdcBalance.test.ts`** (helper puro):
```ts
import { describe, expect, it } from 'vitest'
import { sumUsdc } from './useUsdcBalance'

describe('sumUsdc', () => {
  it('suma amounts de las ATAs y divide por 1e6 (6 decimales)', () => {
    const accts = [
      { account: { data: { parsed: { info: { tokenAmount: { amount: '1500000' } } } } } },
      { account: { data: { parsed: { info: { tokenAmount: { amount: '500000' } } } } } },
    ]
    expect(sumUsdc(accts as any)).toBe(2) // 2.0 USDC
  })
  it('devuelve 0 sin ATAs', () => {
    expect(sumUsdc([] as any)).toBe(0)
  })
  it('ignora ATAs sin amount', () => {
    const accts = [{ account: { data: { parsed: { info: {} } } } }]
    expect(sumUsdc(accts as any)).toBe(0)
  })
})
```

- [ ] **Step 2:** `npx vitest run src/wallet/useUsdcBalance.test.ts` → FALLA (módulo no existe).

- [ ] **Step 3: Implementar `src/wallet/useUsdcBalance.ts`**

Exporta `sumUsdc(tokenAccounts): number` (puro) y el hook `useUsdcBalance(): { usdc: number | null; loading: boolean }`.
- **`sumUsdc`:** suma `account.data.parsed.info.tokenAmount.amount` (string → BigInt/Number) de cada ATA y divide por `1e6`. Robusto ante campos ausentes (→ 0).
- **Hook:** obtiene la dirección de la embedded Solana wallet de Privy. **Confirma el hook EXACTO en los tipos de `@privy-io/react-auth`** (p.ej. `useSolanaWallets()` → `wallets[0].address`, o filtrar `user.linkedAccounts` por `type === 'wallet'` y `chainType === 'solana'`). Si no hay usuario autenticado o no hay wallet, devuelve `{ usdc: null, loading: false }` (no rompe sin Privy/sin auth — recuerda que `usePrivy` tiene contexto por defecto con `ready:false`).
- Lee USDC vía `@solana/web3.js`: `new Connection(config.rpcUrl, 'confirmed').getParsedTokenAccountsByOwner(new PublicKey(address), { mint: new PublicKey(STAKE_MINT) })` donde `STAKE_MINT = import.meta.env.VITE_STAKE_MINT`. Si `VITE_STAKE_MINT` falta, devuelve `{ usdc: null, loading: false }`.
- `useEffect`: fetch al montar y `setInterval` cada 30 s; limpia el intervalo; guarda contra desmontaje (flag) para no setState tras unmount. Maneja errores de RPC → `usdc` se queda en el último valor o `null`, sin lanzar.
- Importa `config` de `../onchain/config`.

Esqueleto:
```ts
import { useEffect, useState } from 'react'
import { Connection, PublicKey } from '@solana/web3.js'
import { config } from '../onchain/config'

const STAKE_MINT = import.meta.env.VITE_STAKE_MINT as string | undefined

export function sumUsdc(tokenAccounts: { account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }[]): number {
  let micros = 0
  for (const a of tokenAccounts) {
    const amt = a.account?.data?.parsed?.info?.tokenAmount?.amount
    if (amt) micros += Number(amt)
  }
  return micros / 1_000_000
}

export function useUsdcBalance(): { usdc: number | null; loading: boolean } {
  // 1) dirección de la embedded Solana wallet de Privy (API real v2/v3)
  // 2) si no hay dirección o no hay STAKE_MINT → { usdc: null, loading: false }
  // 3) fetch RPC + sumUsdc, intervalo 30s, cleanup, sin setState tras unmount
}
```

- [ ] **Step 4:** `npx vitest run && npx tsc --noEmit` → verde (helper testeado).

- [ ] **Step 5: Wire en `GameLayout.tsx`** — sustituir el valor `$128.40` del pill por el balance: dentro del componente, `const { usdc } = useUsdcBalance()`; el span muestra `usdc != null ? formatUsd(usdc) : '—'` (importa `formatUsd` de `../theme`). Quita el comentario "EJEMPLO".

- [ ] **Step 6: Wire en `Hub.tsx`** — igual: `const { usdc } = useUsdcBalance()`; el pill muestra `usdc != null ? formatUsd(usdc) : '—'`. Quita el comentario "EJEMPLO".

- [ ] **Step 7: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → tsc limpio, 102+ tests verdes (incluye sumUsdc), build OK.

- [ ] **Step 8: Commit**
```bash
git add src/wallet/useUsdcBalance.ts src/wallet/useUsdcBalance.test.ts src/ui/layouts/GameLayout.tsx src/ui/screens/Hub/Hub.tsx
git commit -m "feat(wallet): balance USDC real de la embedded de Privy en el top bar (B1)"
```
