# Battle Royale creation allowlist (launch week)

**Fecha:** 2026-07-17
**Estado:** diseño aprobado, pendiente de plan de implementación

## Objetivo

Durante la primera semana de lanzamiento, restringir la **creación** de Battle Royale a
una allowlist de wallets (en la práctica, una sola: la cuenta del owner). El resto de la
funcionalidad —crear Pack Battle, unirse a cualquier royale, jugar— sigue abierta.

La restricción se levanta **de forma manual**: cuando termine la semana, se vacía la
allowlist (en `.env`) y se hace redeploy. Sin fechas, sin lógica de expiración.

## Contexto (estado actual)

- La creación de ambos modos pasa por un único endpoint `POST /pack-battles`
  ([backend/app/main.py:839](../../../backend/app/main.py#L839)), que distingue el modo por
  `body.mode` (`"pack"` | `"royale"`). Autenticado por `current_user` (identity token de
  Privy → wallet embebida Solana).
- **Nada autocrea royales.** `NextBattlePanel` solo navega a una batalla existente; la única
  vía de creación es un usuario llamando al endpoint. Por lo tanto, capar por wallet no rompe
  ningún flujo del sistema/operador.
- Frontend: la CTA "Create Battle Royale" está en
  [QuickMatch.tsx](../../../src/ui/screens/Hub/QuickMatch.tsx) (`cta`), disparada por
  `onCreate` desde [ModeHub.tsx:68](../../../src/ui/screens/Hub/ModeHub.tsx#L68). La wallet
  actual ya está disponible ahí vía `meWallet = useEmbeddedSolanaAddress()`.
- La identidad del backend (`current_user`) y la del frontend (`useEmbeddedSolanaAddress`)
  resuelven a la **misma** dirección base58, así que una sola allowlist sirve para ambos.
- **IMPORTANTE — la dirección del allowlist es la wallet EMBEBIDA de Privy (la "wallet del
  juego"), NO la wallet conectada/externa (ej. Phantom) con la que el usuario se loguea.**
  Backend: [privy.py:59-81](../../../backend/app/privy.py#L59-L81) selecciona la cuenta
  `chain_type == "solana"` con `wallet_client_type == "privy"` / `connector_type == "embedded"`.
  Frontend: [embedded.ts:47](../../../src/wallet/embedded.ts#L47) usa el mismo selector. La
  embebida es la que la app muestra como balance/dirección de depósito en el Profile.

## Principio de seguridad

- **El check del backend es la barrera real.** Ocultar el botón es solo UX; alguien podría
  llamar al endpoint igual.
- Ocultar el botón evita confundir a usuarios que no pueden crear.

## Diseño

### 1. Config backend — `backend/app/config.py`

Nuevo setting:

```python
# Launch week: restringe la creación de Battle Royale a estas wallets (base58, coma-separadas).
# Vacío = abierto a todos (comportamiento por defecto). env: ROYALE_CREATOR_ALLOWLIST
royale_creator_allowlist: str = ""
```

Helper para parsear a un `set` de direcciones (trim, descartar vacíos). Puede ser una
property del `Settings` o una función utilitaria; la decisión fina queda para el plan.

Valor de lanzamiento (en `backend/.env`, **no** commiteado) — **wallet embebida** del owner:
`ROYALE_CREATOR_ALLOWLIST=8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6`

### 2. Enforcement backend — `POST /pack-battles`, rama `mode == "royale"`

Al **inicio** de la rama royale, **antes** de `_require_available` y de crear el escrow (para
no reservar ni cobrar nada si se rechaza):

```python
allow = settings.royale_creator_allowlist_set  # set parseado
if allow and wallet not in allow:
    raise HTTPException(403, "La creación de Battle Royale está limitada durante el lanzamiento")
```

- Si la allowlist está vacía → no se aplica (back-compat).
- La rama `pack` y el endpoint `join` quedan **intactos**.
- Match exacto, case-sensitive (base58).

### 3. Config + helper frontend — `.env` + `src/onchain/config.ts`

- Nueva var pública `VITE_ROYALE_CREATOR_ALLOWLIST` (coma-separada). Se agrega a `config` como
  `royaleCreatorAllowlist: string[]` (parseada).
- Helper `canCreateRoyale(wallet: string | null | undefined): boolean`:
  - `true` si la allowlist está vacía (abierto), **o** si `wallet` está en la lista.
  - `false` si hay allowlist y `wallet` es `null`/no está (fail-closed).

Valor de lanzamiento (en `.env` raíz, **no** commiteado) — **misma wallet embebida**, debe
coincidir con la del backend:
`VITE_ROYALE_CREATOR_ALLOWLIST=8QDBKx8P3pxkRhiqyXFtYcPPf2CM1F5NiE5A8yjkgtm6`

### 4. Gating del botón — `ModeHub.tsx` / `QuickMatch.tsx`

- Cuando el modo es **royale**, solo se renderiza la CTA de crear si
  `canCreateRoyale(meWallet)`. Si no, el botón simplemente **no aparece** (sin texto de
  reemplazo, sin "opens soon").
- El modo **Pack Battle** no se toca.
- `meWallet` null/cargando → botón oculto (fail-closed).

### 5. Flujo de datos y errores

1. Usuario entra al modo Royale → `ModeHub` evalúa `canCreateRoyale(meWallet)` → muestra u
   oculta la CTA.
2. Si una wallet no permitida llega a llamar al endpoint igual → backend responde **403** →
   el flujo de creación (que ya maneja `busy`/error) muestra el mensaje.

## Testing

**Backend** (en `test_pack_lobby.py` o el set de tests de la API):
- Con allowlist seteado y wallet **no** listada → `POST /pack-battles` con `mode=royale`
  responde **403**, y **no** se crea escrow ni se reserva/cobra nada.
- Con wallet listada → creación OK.
- Crear **Pack Battle** sigue OK para cualquier wallet (allowlist no aplica a pack).
- Allowlist **vacío** → cualquier wallet puede crear royale (regresión back-compat).

**Frontend** (siguiendo el patrón de `ModeSections.test`):
- Unit de `canCreateRoyale` (vacío → true; wallet en lista → true; wallet fuera → false;
  null → false).
- `ModeHub`/`QuickMatch` oculta la CTA de royale para una wallet no permitida y la muestra
  para una permitida.

## A tener en cuenta

- **Dos listas en sync:** front (`.env`) y back (`.env`) deben coincidir. Trivial para una
  wallet durante una semana; documentado.
- **La dirección es un pubkey público** (base58), no un secreto; aun así el valor real vive en
  `.env` (gitignored), no en el código.

## Rollback

Vaciar `ROYALE_CREATOR_ALLOWLIST` y `VITE_ROYALE_CREATOR_ALLOWLIST` (o quitarlas) y redeploy →
vuelve al comportamiento abierto. Sin migración, sin cambios de datos.

## Fuera de alcance (YAGNI)

- Expiración automática por fecha.
- Gate sobre unirse a royales o sobre crear Pack Battle.
- Roles/admin persistidos en DB. La allowlist por env alcanza para una medida de una semana.
