# Auth + Wallet con Privy — Diseño

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Alcance:** Integrar Privy como capa única de **autenticación (email + wallet)**,
**embedded wallet no-exportable** (fuente del balance) y **conexión de wallets
externas EVM/Solana**, reemplazando Reown AppKit. Más login/registro UI, balance
desde la embedded, verificación de token en el backend, y quitar la pestaña
Friends.

## Por qué Privy (resumen de la deliberación)

Frente a DIY (custodial, hay que auditar) y Dynamic, se elige **Privy** por:
encaje con Collector Crypt (su `gacha-starter` usa Privy), respaldo de Stripe
(fiat/depósitos futuros), embedded wallets seguras (TEE + sharding) **que
podemos dejar no-exportables** por política, y firma desde servidor (session
signers) para el escrow del gacha. Privy resuelve la custodia de claves que el
DIY nos obligaría a construir y auditar.

## Credenciales

- **App ID (público):** `cmp14gng0022w0cl7l4cnmc8g` → frontend `VITE_PRIVY_APP_ID`.
- **App Secret (servidor):** **NO se commitea**, va en `backend/.env` (gitignored).
  **Debe rotarse** porque se expuso en el chat; usar el secret nuevo.

## Componentes

### Frontend
- **`PrivyProvider`** envolviendo la app (necesita estar donde haya auth: landing
  con login y hub con balance). Login methods: **email (OTP)** + **wallets
  externas EVM y Solana**. Embedded wallet **Solana**, creación automática al
  registrarse, **export deshabilitado** (política `DENY` / quórum). Tema del modal
  de Privy ajustado a nuestros colores (Crypto Platform); UI headless con sus
  hooks queda como mejora futura si se quiere pixel-perfect.
- **Login / Sign up**: dos botones (en landing + hub topbar), cada uno con
  opciones **email** o **wallet**; "wallet" abre la selección **EVM o Solana**
  (una). Ambos disparan el flujo de Privy (Sign up = primera vez → crea cuenta +
  embedded wallet + alias). Privy unifica login/registro internamente.
- **Sesión**: hooks de Privy (`usePrivy`, `useWallets`, `useSolanaWallets`) dan
  el usuario, su token de acceso y la embedded wallet.
- **Balance**: el top bar/hub lee el balance (SOL/USDC) **de la dirección de la
  embedded wallet** por RPC (`getParsedTokenAccountsByOwner`, patrón MarketAgg).
- **Reemplazo de Reown**: se elimina `AppKitProvider` y el hook `useWallet`
  basado en Reown; el `OnchainFlow` pasa a usar los hooks de Privy para
  firmar/enviar.

### Backend (FastAPI)
- **Verificación de token Privy**: cada request autenticado trae el **access
  token de Privy** (JWT ES256). El backend lo verifica con la **clave pública /
  JWKS de Privy** (audience = App ID) usando PyJWT. De ahí se obtiene el
  identificador de usuario de Privy (DID) y su **dirección de embedded wallet
  Solana**.
- **Identidad**: el usuario de la app = usuario de Privy; su dirección de embedded
  wallet es la identidad Solana usada para ELO/matches. Esto **sustituye** el
  flujo propio `/auth/nonce` + `/auth/verify` (firma) para identidad. La
  **atestación on-chain del oráculo sigue aparte** (no cambia).
- El **App Secret** se usa server-side solo si necesitamos las APIs de servidor
  de Privy (session signers / firma para el escrow) — Fase B / gacha.

### Limpieza
- **Quitar la pestaña Friends** del `ChatDock` (solo queda Chat + Drops).

## Fases (un spec, implementación por tramos)

- **Fase A — Identidad:** `@privy-io/react-auth` + `PrivyProvider` + botones
  Log in / Sign up (email + wallet, elección EVM/Solana) + verificación de token
  Privy en FastAPI + quitar Friends. Reown sigue temporalmente para el OnchainFlow
  hasta la Fase B.
- **Fase B — Wallet/embedded:** balance de la embedded en hub/topbar +
  **reemplazar Reown** en el OnchainFlow por los hooks de Privy + dejar lista la
  **firma desde servidor** (session signer) para el escrow del gacha.

## Bundle / dev

`@privy-io/react-auth` es pesado pero comparable o más ligero que el Reown +
WalletConnect que quitamos. Mitigación: mantener el hero de la landing ligero y
cargar el SDK lazy donde se pueda; el `PrivyProvider` envuelve el shell de app.
Verificar el tamaño de chunks tras integrar.

## Seguridad

- App Secret **solo server-side**, gitignored, **rotado** (se expuso en chat).
- Embedded wallet **no-exportable** por política Privy (`DENY` export / quórum).
- Verificación de token siempre en el backend (no confiar en el cliente).
- Privy gestiona la custodia de claves (TEE/sharding, SOC2) — elimina el riesgo
  de custodia propia del DIY.

## Verificación

- `tsc` + `vitest` (motor, intacto) + `build` verdes.
- Manual (requiere App ID en `.env` y, para Fase B server-signing, el App Secret
  rotado): landing → Sign up con email (OTP) → cuenta + embedded wallet creada;
  Log in con wallet → elegir Solana → conecta y autentica; balance de la embedded
  visible en el hub; Friends ya no aparece.

## No-goals (YAGNI)

- UI de login headless pixel-perfect (usamos el modal tematizado de Privy ahora).
- Vincular múltiples wallets / gestión avanzada de cuenta (más adelante).
- Depósitos fiat/cross-chain reales (Stripe/Bridge) — futuro; Privy lo habilita.
- Tocar el motor o la atestación del oráculo.

## Riesgos

- **App Secret expuesto** → rotar antes de implementar Fase B.
- **Verificación de JWT Privy en Python**: confirmar el endpoint JWKS / clave de
  verificación y `aud`=App ID (detalle en el plan).
- **Reemplazo de Reown** toca el OnchainFlow (ConnectScreen, firma) → Fase B,
  con verificación de que el flujo on-chain sigue funcionando.
- **Bundle/dev**: medir chunks; lazy-load donde se pueda.
