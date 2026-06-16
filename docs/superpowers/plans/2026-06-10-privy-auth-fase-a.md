# Privy Auth — Fase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Integrar Privy para identidad (login/registro con email o wallet), con verificación del token en el backend, y quitar la pestaña Friends. (Balance de la embedded + reemplazo de Reown = Fase B.)

**Architecture:** Frontend monta `PrivyProvider` (config: email + wallet, embedded Solana al registrarse, tema Crypto Platform) leyendo `VITE_PRIVY_APP_ID`; botones Log in / Sign up usan los hooks de Privy. Backend FastAPI verifica el access token de Privy (JWT ES256) vía su JWKS. El motor y la atestación del oráculo no se tocan.

**Tech Stack:** React + Vite + `@privy-io/react-auth`; FastAPI + `pyjwt[crypto]` + httpx.

**Spec:** `docs/superpowers/specs/2026-06-10-privy-auth-design.md`.

**Credenciales:** App ID público `cmp14gng0022w0cl7l4cnmc8g` → `VITE_PRIVY_APP_ID` (frontend `.env`). El App Secret NO se usa en Fase A (es de Fase B / server-signing) y debe rotarse.

**IMPORTANTE para el implementador del frontend Privy:** la API exacta v2 de `@privy-io/react-auth` (props de `PrivyProvider`, hooks `usePrivy`/`useSolanaWallets`, config de `loginMethods`/`embeddedWallets`/`solana`) **debes confirmarla en los docs de Privy** (WebFetch a `https://docs.privy.io/llms.txt` y/o la guía de React) — no inventes nombres de props/hooks. Aquí se especifica la intención y la estructura; ajusta los nombres exactos a la API real y deja el build en verde.

**Verificación (frontend es presentacional/integración; login real necesita configurar la app en el dashboard de Privy — manual):** cada tarea debe dejar `npx tsc --noEmit` + `npx vitest run` (102 tests motor) + `npm run build` verdes; backend `cd backend && .venv/bin/python -m pytest -q` verde.

---

### Task 1: Frontend — instalar Privy + AppPrivyProvider + env

**Files:**
- Modify: `package.json` (vía npm install)
- Create: `src/wallet/AppPrivyProvider.tsx`
- Modify: `src/main.tsx`
- Modify: `.env.example` (documentar la var; crear si no existe)

- [ ] **Step 1: Instalar Privy + peers de Solana**
```bash
npm install @privy-io/react-auth@latest @solana/kit @solana-program/memo @solana-program/system @solana-program/token
```
(Confirma en los docs si los peers de Solana son necesarios para tu versión; instala los que pida.)

- [ ] **Step 2: Crear `src/wallet/AppPrivyProvider.tsx`**

Componente que envuelve a `children` en el `PrivyProvider` de Privy. **Consulta los docs de Privy para la forma EXACTA de las props/config.** Intención:
- `appId = import.meta.env.VITE_PRIVY_APP_ID` (si falta, renderiza `children` sin Privy y avisa en consola, para que dev/landing no peten sin la var).
- `loginMethods`: email + wallet (externas EVM y Solana).
- Embedded wallets: crear **wallet Solana** automáticamente para usuarios sin wallet (`createOnLogin: 'users-without-wallets'` o equivalente v2).
- `appearance`: tema oscuro con acentos del proyecto (violeta `#9945FF` / verde `#14F195`), fuente acorde.
- Solana cluster: devnet (usar `import.meta.env.VITE_SOLANA_RPC` que ya existe en `src/onchain/config.ts`).

Estructura:
```tsx
import type { ReactNode } from 'react'
import { PrivyProvider } from '@privy-io/react-auth'

const APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined

export function AppPrivyProvider({ children }: { children: ReactNode }) {
  if (!APP_ID) {
    if (import.meta.env.DEV) console.warn('VITE_PRIVY_APP_ID no configurado: auth deshabilitada')
    return <>{children}</>
  }
  return (
    <PrivyProvider appId={APP_ID} config={{ /* loginMethods, embeddedWallets, appearance, solana — según docs v2 */ }}>
      {children}
    </PrivyProvider>
  )
}
```

- [ ] **Step 3: Envolver la app en `src/main.tsx`**
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AppPrivyProvider } from './wallet/AppPrivyProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppPrivyProvider>
      <App />
    </AppPrivyProvider>
  </StrictMode>,
)
```

- [ ] **Step 4: Documentar la var** en `.env.example` (crear si no existe):
```
VITE_PRIVY_APP_ID=cmp14gng0022w0cl7l4cnmc8g
```
Y crear `.env` local con la misma línea (verifica que `.env` está gitignored; NO commitear `.env`).

- [ ] **Step 5: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → verde. (Sin App ID en entorno de test, el provider hace fallback a children; debe compilar y construir.)

- [ ] **Step 6: Commit**
```bash
git add package.json package-lock.json src/wallet/AppPrivyProvider.tsx src/main.tsx .env.example
git commit -m "feat(auth): integra PrivyProvider (email+wallet, embedded Solana) en el árbol de la app"
```

---

### Task 2: Frontend — botones Log in / Sign up

**Files:**
- Create: `src/ui/components/AuthButtons.tsx`
- Modify: `src/ui/screens/Landing.tsx`
- Modify: `src/ui/screens/Hub/Hub.tsx`

- [ ] **Step 1: Crear `src/ui/components/AuthButtons.tsx`**

Usa `usePrivy()` (confirma nombres en docs). Comportamiento:
- Si `!authenticated`: muestra dos botones **Log in** y **Sign up** (ambos llaman `login()` de Privy — Privy unifica login/registro; Sign up = primera vez). El modal de Privy ofrece email o wallet (y la elección EVM/Solana). Estilo con los tokens (`COLORS`/`GRADIENT`/`FONTS`): Sign up = botón gradiente; Log in = ghost.
- Si `authenticated`: muestra un chip de cuenta (email o dirección abreviada del usuario) + botón **Log out** (`logout()`).
- Prop opcional `variant?: 'nav' | 'compact'` para ajustar tamaño en landing vs topbar del hub.
- Si Privy no está listo (`ready === false`) o no hay App ID, no rompas: renderiza los botones deshabilitados o nada.

```tsx
import { usePrivy } from '@privy-io/react-auth'
import { COLORS, GRADIENT, FONTS } from '../theme'

export function AuthButtons({ variant = 'nav' }: { variant?: 'nav' | 'compact' }) {
  const { ready, authenticated, user, login, logout } = usePrivy()
  // render según ready/authenticated; estilos con tokens
}
```

- [ ] **Step 2: Landing** — añade `<AuthButtons variant="nav" />` en la nav (donde antes iba "Connect wallet", que ya no existe) y, opcionalmente, junto al CTA "Launch App" del hero. No quites "Launch App".

- [ ] **Step 3: Hub topbar** — en `Hub.tsx`, añade `<AuthButtons variant="compact" />` en la barra superior (junto al balance/Deposit). 

- [ ] **Step 4: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → verde.

- [ ] **Step 5: Commit**
```bash
git add src/ui/components/AuthButtons.tsx src/ui/screens/Landing.tsx src/ui/screens/Hub/Hub.tsx
git commit -m "feat(auth): botones Log in / Sign up (email o wallet) en landing y hub"
```

---

### Task 3: Frontend — quitar la pestaña Friends

**Files:**
- Modify: `src/ui/screens/Hub/ChatDock.tsx`

- [ ] **Step 1:** En `ChatDock.tsx` (≈línea 128) el switcher de tabs mapea `['Chat', 'Friends']`. Déjalo solo en `Chat` (quita 'Friends'); si al quedar una sola pestaña el switcher sobra visualmente, sustitúyelo por un encabezado simple "Chat". No toques la lista de mensajes ni el input.

- [ ] **Step 2: Verificar** `npx tsc --noEmit && npx vitest run && npm run build` → verde; `grep -n "Friends" src/ui/screens/Hub/ChatDock.tsx` → vacío.

- [ ] **Step 3: Commit**
```bash
git add src/ui/screens/Hub/ChatDock.tsx
git commit -m "feat(hub): quita la pestaña Friends del dock"
```

---

### Task 4: Backend — verificación del token de Privy

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/config.py`
- Create: `backend/app/privy.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_privy.py`

- [ ] **Step 1: Dependencia**
Añade a `backend/requirements.txt`:
```
pyjwt[crypto]==2.9.0
```
Run: `cd backend && .venv/bin/pip install "pyjwt[crypto]==2.9.0"`

- [ ] **Step 2: Config** — en `backend/app/config.py`, dentro de `Settings`:
```python
    privy_app_id: str = ""
    privy_jwks_url: str = "https://auth.privy.io/api/v1/apps/{app_id}/jwks.json"
```

- [ ] **Step 3: Test que falla** `backend/tests/test_privy.py`:
```python
import time
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from app.privy import PrivyVerifier, PrivyAuthError


def _es256_keypair():
    key = ec.generate_private_key(ec.SECP256R1())
    return key


def _make_token(priv, app_id, sub="did:privy:abc", extra=None, exp_delta=3600):
    headers = {"kid": "test-kid", "alg": "ES256"}
    now = int(time.time())
    payload = {"aud": app_id, "iss": "privy.io", "sub": sub,
               "iat": now, "exp": now + exp_delta}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, priv, algorithm="ES256", headers=headers)


def test_verifies_valid_token_and_returns_sub():
    priv = _es256_keypair()
    app_id = "app123"
    token = _make_token(priv, app_id)
    # Inyectamos la clave pública (sin red) vía resolver de claves por kid.
    v = PrivyVerifier(app_id=app_id, key_resolver=lambda kid: priv.public_key())
    claims = v.verify(token)
    assert claims["sub"] == "did:privy:abc"


def test_rejects_wrong_audience():
    priv = _es256_keypair()
    token = _make_token(priv, "other-app")
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: priv.public_key())
    with pytest.raises(PrivyAuthError):
        v.verify(token)


def test_rejects_expired():
    priv = _es256_keypair()
    token = _make_token(priv, "app123", exp_delta=-10)
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: priv.public_key())
    with pytest.raises(PrivyAuthError):
        v.verify(token)


def test_rejects_tampered_signature():
    priv = _es256_keypair()
    other = ec.generate_private_key(ec.SECP256R1())
    token = _make_token(priv, "app123")
    v = PrivyVerifier(app_id="app123", key_resolver=lambda kid: other.public_key())
    with pytest.raises(PrivyAuthError):
        v.verify(token)
```

- [ ] **Step 4: Verificar que falla** `cd backend && .venv/bin/python -m pytest tests/test_privy.py -q` → FAIL (módulo no existe).

- [ ] **Step 5: Implementar `backend/app/privy.py`**
```python
"""Verificación del access token de Privy (JWT ES256) vía su JWKS.

La clave pública se resuelve por `kid` desde el JWKS de Privy
(https://auth.privy.io/api/v1/apps/<app_id>/jwks.json), con un resolver
inyectable para tests (sin red).
"""
from __future__ import annotations

from typing import Any, Callable, Optional

import httpx
import jwt
from jwt.algorithms import ECAlgorithm


class PrivyAuthError(Exception):
    pass


# Resolver: kid -> clave pública (objeto cryptography). Inyectable en tests.
KeyResolver = Callable[[str], Any]


class PrivyVerifier:
    def __init__(self, app_id: str, jwks_url: Optional[str] = None,
                 key_resolver: Optional[KeyResolver] = None):
        self._app_id = app_id
        self._jwks_url = jwks_url
        self._resolver = key_resolver or self._jwks_resolver
        self._jwks_cache: dict[str, Any] = {}

    def _jwks_resolver(self, kid: str) -> Any:
        if not self._jwks_url:
            raise PrivyAuthError("sin jwks_url ni key_resolver")
        if kid not in self._jwks_cache:
            try:
                resp = httpx.get(self._jwks_url, timeout=10.0)
                resp.raise_for_status()
                for jwk in resp.json().get("keys", []):
                    if jwk.get("kid"):
                        self._jwks_cache[jwk["kid"]] = ECAlgorithm.from_jwk(jwk)
            except (httpx.HTTPError, ValueError, KeyError) as e:
                raise PrivyAuthError(f"no se pudo cargar JWKS: {type(e).__name__}")
        key = self._jwks_cache.get(kid)
        if key is None:
            raise PrivyAuthError("kid desconocido")
        return key

    def verify(self, token: str) -> dict:
        try:
            header = jwt.get_unverified_header(token)
            kid = header.get("kid", "")
            public_key = self._resolver(kid)
            claims = jwt.decode(
                token, public_key, algorithms=["ES256"],
                audience=self._app_id, issuer="privy.io",
            )
            return claims
        except PrivyAuthError:
            raise
        except jwt.PyJWTError as e:
            raise PrivyAuthError(f"token inválido: {type(e).__name__}")
```

- [ ] **Step 6: Endpoint en `backend/app/main.py`** — un dependency/endpoint que acepta `Authorization: Bearer <privy token>`, lo verifica y devuelve el sub. Añade a `create_app` un parámetro opcional `privy: PrivyVerifier | None = None` y:
```python
    @app.get("/auth/privy/me")
    async def privy_me(authorization: Optional[str] = Header(None)):
        if privy is None:
            raise HTTPException(503, "privy no configurado")
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(401, "falta token")
        try:
            claims = privy.verify(authorization[len("Bearer "):])
        except PrivyAuthError:
            raise HTTPException(401, "token Privy inválido")
        return {"sub": claims.get("sub")}
```
Import `from .privy import PrivyVerifier, PrivyAuthError`. En `build_default_app()`: `privy = PrivyVerifier(app_id=s.privy_app_id, jwks_url=s.privy_jwks_url.format(app_id=s.privy_app_id)) if s.privy_app_id else None` y pásalo a `create_app(..., privy=privy)`.

- [ ] **Step 7: Verificar** `cd backend && .venv/bin/python -m pytest -q` → todo verde (los previos + 4 nuevos).

- [ ] **Step 8: Commit**
```bash
git add backend/requirements.txt backend/app/config.py backend/app/privy.py backend/app/main.py backend/tests/test_privy.py
git commit -m "feat(backend): verificación del access token de Privy (ES256/JWKS) + /auth/privy/me"
```

---

### Task 5: Verificación final

- [ ] **Step 1:** `npx tsc --noEmit && npx vitest run && npm run build` y `cd backend && .venv/bin/python -m pytest -q` → todo verde.
- [ ] **Step 2:** `grep -rn "Friends" src/ui/screens/Hub` → vacío. `grep -rn "VITE_PRIVY_APP_ID" src` → usado en AppPrivyProvider.
- [ ] **Step 3: Nota de verificación manual** (gateada por configurar la app en el dashboard de Privy: habilitar login methods email+wallet, embedded Solana, y añadir el dominio del preview a allowed origins): landing → Sign up con email (OTP) → se crea cuenta + embedded wallet; Log in con wallet → elegir Solana → conecta; el token de Privy verifica contra `/auth/privy/me`. Dejar anotado para el usuario.
