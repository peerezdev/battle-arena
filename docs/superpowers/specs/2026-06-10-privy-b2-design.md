# Privy Fase B2 — Reemplazar Reown por Privy en la capa de wallet

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Alcance:** Reimplementar `useWallet` sobre la wallet de Privy (misma interfaz),
eliminar `AppKitProvider` y las dependencias de Reown. La auth on-chain del
backend (firma de wallet) **sigue igual** en B2 (firmando ahora con la wallet de
Privy); migrarla a token Privy es B3.

## Estado actual

`src/wallet/useWallet.ts` (Reown/AppKit) expone `WalletApi`: `publicKey`,
`isConnected`, `connect`, `signMessage`, `signAndSendTransaction(ixs)`,
`signTransactionBase64(txB64)`. Lo consumen 5 pantallas on-chain + el gacha.
`OnchainFlow` envuelve su contenido en `<AppKitProvider>` (lazy). `config.ts`
tiene `reownProjectId` (`VITE_REOWN_PROJECT_ID`). Privy ya envuelve la app
(`main.tsx` → `AppPrivyProvider`).

## Diseño

- **`useWallet` reescrito sobre Privy**, **manteniendo `WalletApi` idéntica** para
  no tocar a los consumidores:
  - `publicKey`: de la embedded Solana wallet de Privy (`useWallets()` de
    `@privy-io/react-auth/solana`, `wallets[0].address`).
  - `isConnected`: `authenticated && wallets.length > 0`.
  - `connect`: abre el login de Privy (`usePrivy().login()`).
  - `signMessage`, `signAndSendTransaction(ixs)`, `signTransactionBase64(txB64)`:
    se implementan con los métodos de la **wallet Solana de Privy** (el
    implementador confirma los nombres exactos en los tipos:
    `signMessage`/`signTransaction`/`signAndSendTransaction`). Para
    `signAndSendTransaction`: construir `Transaction` (feePayer + blockhash vía
    `Connection(config.rpcUrl)`), firmar+enviar con la wallet de Privy, confirmar.
    Para `signTransactionBase64`: deserializar, firmar (sin enviar), re-serializar.
- **Eliminar** `src/wallet/AppKitProvider.tsx`; `OnchainFlow` deja de envolver en
  `AppKitProvider` (Privy ya está app-wide). Mantener el `Suspense` para las
  pantallas lazy.
- **Quitar dependencias** `@reown/appkit` y `@reown/appkit-adapter-solana` de
  `package.json`, y `reownProjectId`/`VITE_REOWN_PROJECT_ID` de `config.ts`.

## Componentes (archivos)

```
src/wallet/useWallet.ts           (reescribir — Privy-backed, misma WalletApi)
src/ui/flows/OnchainFlow.tsx      (modificar — quita AppKitProvider, mantiene Suspense)
src/wallet/AppKitProvider.tsx     (eliminar)
src/onchain/config.ts             (modificar — quita reownProjectId / VITE_REOWN_PROJECT_ID)
package.json                      (modificar — quita @reown/*)
```

## Verificación

- `tsc` + `vitest` (105 tests) + `build` verdes; sin imports a `@reown/*`.
- Manual (login Privy + dashboard configurado): el flujo on-chain (connect →
  collection → lobby → battle) y el gacha firman con la wallet de Privy.

## No-goals (YAGNI)

- Migrar la auth del backend a token Privy (eso es B3 — sigue la firma de wallet).
- Balance (B1, hecho).

## Riesgos

- **API de firma de la wallet Solana de Privy**: confirmar nombres/forma exactos
  en los tipos instalados; mapear con cuidado `signAndSendTransaction`/
  `signTransactionBase64` (firmar vs firmar-y-enviar).
- Quitar deps de Reown: verificar que nada más las importa (solo
  `useWallet`/`AppKitProvider`); build verde tras quitarlas.
- La `WalletApi` debe quedar **idéntica** para que las 5 pantallas + gacha no
  cambien.
