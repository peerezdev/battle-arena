# Privy Fase B3 — Identidad on-chain del backend vía identity token

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Alcance:** Migrar la auth de los endpoints on-chain del backend de la firma de
wallet (`current_wallet`) al **identity token de Privy** (que lleva los
`linked_accounts`), del que se extrae la **embedded Solana wallet** como
identidad. Sin App Secret (no se necesita con identity token).

## Decisiones (cerradas con el usuario)

1. **Identity token** (no API de servidor): el frontend manda el identity token
   de Privy; el backend lo verifica por JWKS y lee la wallet del propio token. Sin
   App Secret, sin rate limit, sin llamada de red.
2. **Identidad = embedded Solana wallet** (`chain_type: solana`,
   `connector_type: embedded`) — coherente con B1 (balance) y B2.
3. **Credencial = solo el identity token** (bearer), por simplicidad (es un JWT
   firmado verificable con exp + usuario + cuentas).

## Backend

- **`PrivyVerifier` (extender, `backend/app/privy.py`):** además de `verify()`
  (access token), añadir `embedded_solana_wallet(token) -> str`:
  verifica el identity token (mismo JWKS ES256, `aud` = app_id) y parsea el claim
  `linked_accounts` (Privy lo entrega como **string JSON** — el implementador
  confirma el nombre/formato exacto contra un token real / docs), busca la cuenta
  `type == 'wallet'` && `chain_type == 'solana'` && `connector_type == 'embedded'`,
  y devuelve su `address`. Si no hay token / inválido / sin embedded Solana →
  `PrivyAuthError`.
- **`current_user` (en `backend/app/main.py`):** dependency que lee
  `Authorization: Bearer <identity-token>`, llama a `privy.embedded_solana_wallet`,
  y devuelve la **dirección** (string base58). Errores → 401; sin privy
  configurado → 503.
- **Reemplazar `Depends(current_wallet)` por `Depends(current_user)`** en:
  `/users/me/alias`, `/matches` (POST), `/matches/{battle}/sync`,
  `/gacha/generate-pack`, `/gacha/submit-tx`, `/gacha/open-pack`. El downstream
  (ELO/matches keyed por dirección, binding memo↔wallet) **no cambia**: sigue
  recibiendo una dirección de wallet.
- **Deprecar** `/auth/nonce` + `/auth/verify` (firma de wallet): se eliminan (ya
  no se usan para identidad). `AuthService` y el dependency `current_wallet`
  quedan sin uso → eliminar lo que quede huérfano.
- **Tests** (`backend/tests/`): identity token auto-firmado (ES256 + key
  inyectada vía `key_resolver`) con `linked_accounts` que incluye una embedded
  Solana → `embedded_solana_wallet` devuelve esa address; rechaza si no hay
  embedded Solana, si el token está expirado/manipulado, y `current_user`
  responde 401/503 correctamente. Actualizar/eliminar los tests que dependían de
  `/auth/nonce`/`/auth/verify`/firma.

## Frontend

- **`AppPrivyProvider`:** activar **identity tokens** (config de Privy — el
  implementador confirma el flag/que estén habilitados; pueden requerir
  activarse en el dashboard también).
- **Obtener el identity token:** vía Privy (`getIdentityToken()` /
  `useIdentityToken()` — confirmar el hook exacto).
- **`backendClient` / OnchainFlow:** el `authToken` pasa a ser el **identity
  token**; se manda como `Authorization: Bearer <identity-token>` en las llamadas
  on-chain (matches/sync/elo/gacha). Quitar `getNonce`/`verify` del client.
- **`ConnectScreen`:** eliminar el flujo `nonce → build message → signMessage →
  verify → token`. Nuevo comportamiento: si el usuario está autenticado en Privy,
  obtener el identity token y `onAuthenticated(idToken)`; si no, disparar el login
  de Privy (`connect()` de `useWallet`/`usePrivy().login()`) y al autenticarse,
  obtener el token. La pantalla se simplifica a "asegura sesión Privy → token".

## Verificación

- Backend `cd backend && .venv/bin/python -m pytest -q` verde (tests nuevos +
  actualizados). Frontend `tsc` + `vitest` + `build` verdes.
- Manual (login Privy + dashboard con identity tokens activados): crear/join de
  match y gacha autentican con el identity token; la identidad = embedded Solana
  wallet; ELO/historial keyed por esa dirección.

## No-goals (YAGNI)

- Firma server-side del escrow (necesita App Secret / session signers) — fase
  aparte.
- Vincular/usar wallet externa como identidad (se usa la embedded).
- Migrar datos existentes de usuarios keyed por wallets viejas (devnet/tests; no
  hay datos de producción).

## Riesgos

- **Formato del claim `linked_accounts`** en el identity token (string JSON vs
  objeto; nombres de campos `chain_type`/`connector_type`): confirmar contra un
  token real de Privy; el parser debe ser defensivo.
- **Activación de identity tokens** puede requerir setting en el dashboard de
  Privy (manual, como allowed origins).
- Romper la auth on-chain actual: se hace de golpe (backend + frontend) en esta
  fase; verificar build/tests y dejar el flujo coherente.
- `aud` del identity token: confirmar que es el App ID (como el access token).
