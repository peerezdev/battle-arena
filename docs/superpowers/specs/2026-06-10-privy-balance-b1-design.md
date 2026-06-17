# Privy Fase B1 — Balance USDC de la embedded wallet

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Alcance:** Mostrar el balance **USDC** real de la embedded wallet de Privy en el
top bar (Hub + GameLayout), sustituyendo el balance de ejemplo. Solo USDC (SOL
no). Sin cambios de backend. Es la parte de bajo riesgo de la Fase B (no usa el
App Secret).

## Diseño

- **Dirección de la wallet:** la **embedded Solana wallet de Privy** del usuario
  autenticado (vía los hooks de Privy — el implementador confirma el hook exacto:
  `useSolanaWallets()` o `user.linkedAccounts`). Si no hay usuario/wallet, no hay
  balance.
- **Lectura USDC:** hook `useUsdcBalance()` que, dada la dirección, lee el balance
  del **stake mint** (`VITE_STAKE_MINT`, USDC devnet) por RPC
  (`getParsedTokenAccountsByOwner(owner, { mint })`, suma de todas las ATAs, 6
  decimales → USD). Usa `config.rpcUrl` (devnet) de `src/onchain/config.ts`.
  Refresca al montar y cada ~30 s. Devuelve `{ usdc: number | null, loading }`.
- **Helper puro testeable:** `sumUsdc(tokenAccounts): number` (suma `amount` de las
  ATAs y divide por 1e6) — unit test.
- **UI:** el pill de balance del **Hub topbar** y del **GameLayout** muestra
  `formatUsd(usdc)` cuando hay valor; `—` mientras carga o si no hay wallet/auth.
  Se elimina el "$128.40 EJEMPLO".

## Componentes (archivos)

```
src/wallet/useUsdcBalance.ts        (nuevo — dirección Privy + lectura USDC por RPC + helper sumUsdc)
src/wallet/useUsdcBalance.test.ts   (nuevo — test de sumUsdc)
src/ui/layouts/GameLayout.tsx       (modificar — pill usa useUsdcBalance)
src/ui/screens/Hub/Hub.tsx          (modificar — pill usa useUsdcBalance)
```

## Verificación

- `tsc` + `vitest` (102 + el nuevo de sumUsdc) + `build` verdes.
- Manual (requiere login Privy + una ATA de USDC devnet con saldo en la embedded):
  el pill muestra el USDC real; sin wallet/sin saldo muestra `—` / `$0`.

## No-goals (YAGNI)

- SOL (descartado), depósitos, refresco en tiempo real por websocket.
- Backend / App Secret (eso es B3).
- Reemplazar Reown (eso es B2).

## Riesgos

- Confirmar el hook de Privy para la dirección de la embedded Solana wallet
  (el implementador lo verifica en los tipos/docs de Privy).
- `VITE_STAKE_MINT` debe estar configurado (ya está en `.env`); si falta, el hook
  devuelve `null` sin romper.
