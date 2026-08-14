# Comandos de chat y `/tip` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comandos escritos en el chat al estilo de Discord, con `/tip <usuario|wallet> <cantidad>` como primero, autocompletando destinatarios conectados y desconectados.

**Architecture:** El comando es un ATAJO al `TipModal` que ya existe, no un segundo camino: no reimplementa ni valida nada de la propina. Lo único nuevo en backend es un endpoint de búsqueda de usuarios, que es la pieza delicada.

**Tech Stack:** React + TypeScript + vitest; FastAPI + SQLAlchemy + pytest.

Spec: `docs/superpowers/specs/2026-08-14-comandos-chat-tip-design.md`.

## Global Constraints

- **La búsqueda va por PREFIJO y con RANGO, nunca con `LIKE`.** Medido con `EXPLAIN QUERY PLAN`: `lower(alias) LIKE 'an%'` hace `SCAN users`; `lower(alias) >= 'an' AND lower(alias) < 'ao'` hace `SEARCH users USING INDEX ux_users_alias_lower`. SQLite no aplica la optimización de `LIKE` a un índice de expresión.
- **El endpoint se declara `def`, NO `async def`.** Con la base síncrona, un `async def` que consulta bloquea el bucle de eventos y deja el proceso mudo, que es lo que pasó en producción. Hay 62 endpoints `async` y 28 que no esperan nada; arreglarlos va aparte, pero aquí no se añade el 63.
- **Requiere sesión** (`Depends(current_user)`) y throttle por wallet, como `_tip_throttle`.
- **Tope duro de 8 resultados**, se pida lo que se pida.
- El comando NO valida mínimo, saldo ni royale en juego: eso lo dice el modal, y duplicarlo son dos verdades que se desincronizan.
- Frontend desde la raíz: `npx vitest run <fichero>`, `npx tsc -b`. Línea base: **796 tests**.
- Backend desde `backend/`: `./.venv/bin/pytest`. Línea base: **737 tests**.
- Comentarios en español explicando POR QUÉ; textos de usuario en inglés y escritos por nosotros. Nada de guiones largos (—) en lo que ve el jugador.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `backend/app/services/users.py` (modificar) | `buscar_usuarios(session, q, limit)` |
| `backend/app/main.py` (modificar) | `GET /users/search` + su throttle |
| `src/onchain/userSearch.ts` (crear) | Cliente con espera y caché |
| `src/ui/screens/Hub/commands.ts` (crear) | Registro de comandos + parser |
| `src/ui/screens/Hub/MentionAutocomplete.tsx` (modificar) | Marca de conectado |
| `src/ui/screens/Hub/ChatDock.tsx` (modificar) | Integración |
| `src/ui/components/TipModal.tsx` (modificar) | `amountInicial` |

---

### Task 1: La búsqueda en la base

**Files:**
- Modify: `backend/app/services/users.py`
- Test: `backend/tests/test_user_search.py` (crear)

**Interfaces:**
- Produces: `buscar_usuarios(session, q: str, limit: int = 8) -> list[dict]` → `[{wallet, alias}]`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/tests/test_user_search.py`:

```python
import pytest
from app.db import make_engine, make_session_factory, init_db
from app.models import User
from app.services.users import buscar_usuarios


@pytest.fixture
def session():
    engine = make_engine("sqlite:///:memory:")
    init_db(engine)
    Session = make_session_factory(engine)
    with Session() as s:
        for wallet, alias in [("Wa1", "ana"), ("Wb2", "anabel"), ("Wc3", "Bea"),
                              ("Wd4", "juanana"), ("We5", None)]:
            s.add(User(wallet=wallet, alias=alias, elo=1200, games_played=0))
        s.commit()
        yield s


def test_busca_por_prefijo_sin_distinguir_mayusculas(session):
    out = [u["alias"] for u in buscar_usuarios(session, "AN")]
    assert sorted(out) == ["ana", "anabel"]


def test_el_prefijo_NO_encuentra_por_el_medio(session):
    """Es el precio aceptado de que la consulta use el índice.

    Buscar "contiene" obliga a recorrer la tabla entera en cada pulsación, y este backend corre en
    un proceso: es la forma del incidente que documenta src/ui/useAliases.ts.
    """
    assert [u["alias"] for u in buscar_usuarios(session, "ana")] == ["ana", "anabel"]
    assert "juanana" not in [u["alias"] for u in buscar_usuarios(session, "ana")]


def test_busca_tambien_por_principio_de_wallet(session):
    """Quien no tiene alias solo se puede encontrar por su wallet."""
    assert [u["wallet"] for u in buscar_usuarios(session, "We")] == ["We5"]


def test_sin_consulta_devuelve_a_todos_ordenados(session):
    out = buscar_usuarios(session, "")
    assert len(out) == 5


def test_el_tope_se_respeta_aunque_se_pida_mas(session):
    assert len(buscar_usuarios(session, "", limit=999)) <= 8
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `cd backend && ./.venv/bin/pytest tests/test_user_search.py -v`
Expected: FAIL con `ImportError: cannot import name 'buscar_usuarios'`

- [ ] **Step 3: Implementar la búsqueda**

En `backend/app/services/users.py`:

```python
# Tope duro de resultados. Un desplegable no puede enseñar miles, y el tope es también lo que
# mantiene barata la consulta pase lo que pase por el parámetro.
MAX_BUSQUEDA = 8


def _rango_prefijo(q: str) -> tuple[str, str]:
    """(desde, hasta) para buscar por prefijo con un RANGO, que es lo único que usa el índice.

    Medido con EXPLAIN QUERY PLAN: `lower(alias) LIKE 'an%'` hace SCAN de la tabla entera, porque
    SQLite no aplica la optimización de LIKE a un índice de expresión como ux_users_alias_lower.
    El rango sí: SEARCH users USING INDEX. Con 16 usuarios da igual; con 100.000, un escaneo por
    pulsación deja al backend (un proceso, consultas síncronas) sin atender nada más.
    """
    return q, q + "￿"


def buscar_usuarios(session: Session, q: str, limit: int = MAX_BUSQUEDA) -> list[dict]:
    """Jugadores cuyo alias o wallet EMPIEZA por `q`. Sin `q`, los primeros por alias.

    Devuelve [{wallet, alias}]; quién está conectado lo pone el endpoint, que es quien lo sabe.
    """
    limit = max(1, min(limit, MAX_BUSQUEDA))
    stmt = select(User)
    if q:
        desde, hasta = _rango_prefijo(q.lower())
        stmt = stmt.where(
            (func.lower(User.alias) >= desde) & (func.lower(User.alias) < hasta)
            | ((User.wallet >= q) & (User.wallet < q + "￿"))
        )
    stmt = stmt.order_by(func.lower(User.alias).is_(None), func.lower(User.alias), User.wallet)
    return [{"wallet": u.wallet, "alias": u.alias} for u in session.scalars(stmt.limit(limit))]
```

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `cd backend && ./.venv/bin/pytest tests/test_user_search.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Comprobar que de verdad usa el índice**

Esto NO es opcional: es la razón de todo el diseño, y si se cae no lo nota nadie.

```python
def test_la_consulta_usa_el_indice(session):
    """Si esto falla, la búsqueda recorre la tabla entera y hay que arreglarlo ANTES de subir."""
    from sqlalchemy import text
    plan = session.execute(text(
        "EXPLAIN QUERY PLAN SELECT wallet, alias FROM users "
        "WHERE lower(alias) >= 'an' AND lower(alias) < 'ao' LIMIT 8"
    )).all()
    assert any("USING INDEX ux_users_alias_lower" in str(r) for r in plan), plan
```

Run: `cd backend && ./.venv/bin/pytest tests/test_user_search.py -v`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/users.py backend/tests/test_user_search.py
git commit -m "feat(users): búsqueda por prefijo con rango, que es lo único que usa el índice"
```

---

### Task 2: El endpoint

**Files:**
- Modify: `backend/app/main.py` (junto a `GET /users/{wallet}`, sobre la línea 325)
- Test: `backend/tests/test_user_search_api.py` (crear)

**Interfaces:**
- Consumes: `buscar_usuarios` (Task 1); `_chat_mgr.online_users()`.
- Produces: `GET /users/search?q=&limit=` → `[{wallet, alias, online}]`.

**OJO con el orden de las rutas.** `GET /users/{wallet}` ya existe: si `/users/search` se declara
DESPUÉS, FastAPI casará "search" como si fuera una wallet y este endpoint no se alcanzará nunca.
Va **antes**.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/tests/test_user_search_api.py`, montando la app como `test_tip_api.py` (copiar sus
helpers `_build_client`, `_auth_headers`; cada test de API de este repo es autocontenido):

```python
def test_la_busqueda_exige_sesion(...):
    assert client.get("/users/search?q=an").status_code == 401


def test_devuelve_los_que_empiezan_por_la_consulta(...):
    ...
    r = client.get("/users/search?q=an", headers=_auth_headers(...))
    assert [u["alias"] for u in r.json()] == ["ana", "anabel"]


def test_marca_a_los_conectados(...):
    """`online` sale de la presencia del chat, no de la base."""
    ...


def test_el_tope_de_8_se_respeta_aunque_se_pida_mas(...):
    r = client.get("/users/search?limit=500", headers=...)
    assert len(r.json()) <= 8


def test_la_busqueda_tiene_freno(...):
    """Sin throttle, un bucle contra este endpoint deja el backend mudo."""
    for _ in range(30):
        ultima = client.get("/users/search?q=a", headers=...)
    assert ultima.status_code == 429


def test_search_no_lo_come_la_ruta_de_wallet(...):
    """/users/{wallet} está declarada antes en el fichero: si el orden se invierte, 'search' se
    interpreta como una wallet y este endpoint deja de existir sin que falle nada más."""
    r = client.get("/users/search?q=an", headers=...)
    assert isinstance(r.json(), list)
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `cd backend && ./.venv/bin/pytest tests/test_user_search_api.py -v`
Expected: FAIL (404: la ruta no existe)

- [ ] **Step 3: Añadir el throttle**

Junto a `_tip_throttle` en `main.py`, con sus propios contadores y por el mismo motivo que allí:

```python
    _search_hits: dict[str, list[float]] = {}

    def _search_throttle(wallet: str) -> None:
        """Freno de la búsqueda de usuarios.

        Contadores propios: compartirlos con el tip haría que buscar a quién dar propina te dejara
        sin poder dársela. El freno del cliente (espera + caché) es una convención del frontend;
        este es la red de debajo, y es la que protege de un bucle hecho a mano.
        """
        now = _time.time()
        hits = [t for t in _search_hits.get(wallet, []) if now - t < 60.0]
        if len(hits) >= 20:
            raise HTTPException(429, "too many searches")
        hits.append(now)
        _search_hits[wallet] = hits
```

- [ ] **Step 4: Añadir el endpoint ANTES de `GET /users/{wallet}`**

```python
    @app.get("/users/search")
    def users_search(q: str = "", limit: int = 8, wallet: str = Depends(current_user),
                     s: Session = Depends(db)):
        """Jugadores cuyo alias o wallet empieza por `q`, para el autocompletado de `/tip`.

        `def` y NO `async def`: con la base síncrona, un `async def` que consulta bloquea el bucle
        de eventos y deja el proceso sin atender nada, ni /health. Así FastAPI lo ejecuta en su
        pool de hilos. Ver el spec.

        Con sesión, a diferencia de `GET /users/{wallet}`: aquella devuelve UNA fila que ya
        conoces, esta ejecuta una búsqueda, y abierta es una consulta al alcance de cualquiera.
        """
        _search_throttle(wallet)
        conectados = {u["wallet"] for u in _chat_mgr.online_users()}
        encontrados = buscar_usuarios(s, q.strip(), limit)
        # Los conectados primero: son a quienes la propina llega con alguien delante.
        encontrados.sort(key=lambda u: u["wallet"] not in conectados)
        return [{**u, "online": u["wallet"] in conectados} for u in encontrados]
```

- [ ] **Step 5: Ejecutar los tests y la suite**

Run: `cd backend && ./.venv/bin/pytest -q`
Expected: 737 + los nuevos, todo verde

- [ ] **Step 6: Commit**

```bash
git add backend/app/main.py backend/tests/test_user_search_api.py
git commit -m "feat(users): GET /users/search con sesión, freno y tope de 8"
```

---

### Task 3: El parser de comandos

**Files:**
- Create: `src/ui/screens/Hub/commands.ts`
- Test: `src/ui/screens/Hub/commands.test.ts`

**Interfaces:**
- Produces: `parseComando(texto, cursor)`, `COMANDOS`, `comandosDisponibles()`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/ui/screens/Hub/commands.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseComando } from './commands'

describe('parseComando', () => {
  it('un texto normal no es un comando', () => {
    expect(parseComando('hola', 4)).toBeNull()
    expect(parseComando(' /tip', 5)).toBeNull()   // el / debe abrir el mensaje
  })

  it('reconoce el comando y sus argumentos', () => {
    expect(parseComando('/tip ana 5', 10)).toMatchObject({ nombre: 'tip', args: ['ana', '5'] })
  })

  it('dice EN QUÉ argumento está el cursor', () => {
    // Es lo que permite ofrecer usuarios en el primero y nada en el segundo.
    expect(parseComando('/tip an', 7)?.argActivo).toBe(0)
    expect(parseComando('/tip ana ', 9)?.argActivo).toBe(1)
    expect(parseComando('/tip ana 5', 10)?.argActivo).toBe(1)
  })

  it('el cursor manda, no el final del texto', () => {
    expect(parseComando('/tip ana 5', 7)?.argActivo).toBe(0)
  })

  it('solo el / recién escrito ya es un comando a medias', () => {
    expect(parseComando('/', 1)).toMatchObject({ nombre: '', args: [] })
  })

  it('aguanta espacios de más', () => {
    expect(parseComando('/tip   ana', 10)).toMatchObject({ nombre: 'tip', args: ['ana'] })
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npx vitest run src/ui/screens/Hub/commands.test.ts`
Expected: FAIL, no existe el módulo

- [ ] **Step 3: Escribir el registro y el parser**

Crear `src/ui/screens/Hub/commands.ts` con:

- El tipo `Comando { nombre, descripcion, args: {nombre, tipo: 'usuario' | 'texto'}[], disponible: () => boolean }`.
- `COMANDOS: Comando[]` con una sola entrada, `tip`, cuyo `disponible` es `() => TIPS_ENABLED`. Es un registro para que añadir `/help` mañana sea una entrada, no otra pantalla.
- `comandosDisponibles()` filtra por `disponible()`.
- `parseComando(texto, cursor)`: devuelve `null` si el texto no empieza por `/`; si empieza, parte por espacios y calcula `argActivo` **con el cursor**, no con el final.

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `npx vitest run src/ui/screens/Hub/commands.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/Hub/commands.ts src/ui/screens/Hub/commands.test.ts
git commit -m "feat(chat): registro de comandos y parser con argumento activo"
```

---

### Task 4: El cliente de búsqueda, con freno

**Files:**
- Create: `src/onchain/userSearch.ts`
- Test: `src/onchain/userSearch.test.ts`

**Interfaces:**
- Consumes: `GET /users/search` (Task 2); `config.backendUrl`.
- Produces: `useUserSearch(token, consulta, activo)` → `{ resultados, cargando }`.

- [ ] **Step 1: Escribir los tests que fallan**

Lo que hay que fijar, y el motivo de que este fichero exista:

```ts
it('NO pregunta en cada tecla: espera a que pare de escribir', async () => {
  // Es el freno. Sin él, esto es la misma ráfaga que tumbó producción.
  const f = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
  vi.stubGlobal('fetch', f)
  const { rerender } = renderHook(({ q }) => useUserSearch('tok', q, true),
                                  { initialProps: { q: 'a' } })
  rerender({ q: 'an' }); rerender({ q: 'ana' })
  expect(f).not.toHaveBeenCalled()          // todavía nada
  await act(() => vi.advanceTimersByTimeAsync(300))
  expect(f).toHaveBeenCalledTimes(1)        // una sola, con la última consulta
})

it('la misma consulta no se vuelve a pedir', async () => { /* caché */ })
it('inactivo no pide nada', async () => { /* con el argumento cerrado */ })
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npx vitest run src/onchain/userSearch.test.ts`
Expected: FAIL, no existe el módulo

- [ ] **Step 3: Escribir el hook**

`useUserSearch(token, consulta, activo)`: espera de **250 ms** con `setTimeout` (cancelado en la limpieza del efecto), caché en un `Map` de módulo por consulta, y no pide nada si `activo` es falso o no hay token. Cabecera `ngrok-skip-browser-warning`, como el resto de clientes.

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `npx vitest run src/onchain/userSearch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/onchain/userSearch.ts src/onchain/userSearch.test.ts
git commit -m "feat(users): cliente de búsqueda con espera de 250ms y caché"
```

---

### Task 5: El modal se puede abrir relleno

**Files:**
- Modify: `src/ui/components/TipModal.tsx` (props en la línea 25, bloque de `resetKey` sobre la 88)
- Test: `src/ui/components/TipModal.test.tsx`

**Interfaces:**
- Produces: `TipModal` acepta `amountInicial?: string`.

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
it('se abre con el importe puesto', () => {
  render(<TipModal open to={TO} source="chat" amountInicial="5" onClose={() => {}} />)
  expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe('5')
})

it('abrirlo dos veces con importes distintos rellena los dos', () => {
  // El reset del modal borra el importe al abrir; si `amountInicial` no entra en su clave, la
  // segunda vez se abriría vacío.
  const { rerender } = render(<TipModal open={false} to={TO} source="chat" amountInicial="5" onClose={() => {}} />)
  rerender(<TipModal open to={TO} source="chat" amountInicial="5" onClose={() => {}} />)
  expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe('5')
  rerender(<TipModal open={false} to={TO} source="chat" amountInicial="9" onClose={() => {}} />)
  rerender(<TipModal open to={TO} source="chat" amountInicial="9" onClose={() => {}} />)
  expect((screen.getByLabelText(/amount/i) as HTMLInputElement).value).toBe('9')
})
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npx vitest run src/ui/components/TipModal.test.tsx`
Expected: FAIL

- [ ] **Step 3: Implementar**

Añadir `amountInicial?: string` a `TipModalProps`, meterlo en `resetKey`
(`${open}:${to.wallet}:${amountInicial ?? ''}`) y usarlo en el reset: `setAmount(amountInicial ?? '')`.

**No tocar nada más de ese bloque.** El `gate.cancel()` y el `busy` que hay ahí existen por un
fallo real: sin ellos, una propina pendiente de delegación se pagaba al destinatario ANTERIOR.

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `npx vitest run src/ui/components/TipModal.test.tsx`
Expected: PASS (todos los que ya había, más los 2 nuevos)

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/TipModal.tsx src/ui/components/TipModal.test.tsx
git commit -m "feat(tip): el modal se puede abrir con el importe puesto"
```

---

### Task 6: `/tip` en el chat

**Files:**
- Modify: `src/ui/screens/Hub/ChatDock.tsx` (la lógica del autocompletado está en las líneas 222-267)
- Modify: `src/ui/screens/Hub/MentionAutocomplete.tsx` (marca de conectado)
- Test: `src/ui/screens/Hub/ChatDock.test.tsx`

**Interfaces:**
- Consumes: `parseComando`, `comandosDisponibles` (Task 3); `useUserSearch` (Task 4); `amountInicial` (Task 5).

- [ ] **Step 1: Escribir los tests que fallan**

En `ChatDock.test.tsx`, con el patrón que ya usa el bloque "ChatDock · menciones":

```tsx
it('escribir / abre la lista de comandos', ...)
it('con las propinas apagadas, /tip no aparece', ...)          // mockear featureFlags a false
it('en el primer argumento de /tip ofrece usuarios', ...)
it('un texto que empieza por / NUNCA se envía como mensaje', ...)
it('/tip ana 5 abre el modal con destinatario e importe', ...)  // asserta sobre tipModalCalls
it('/tip con un usuario que no existe lo dice y no abre el modal', ...)
it('un comando desconocido responde sin llamar al servidor', ...)
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npx vitest run src/ui/screens/Hub/ChatDock.test.tsx`
Expected: FAIL

- [ ] **Step 3: La marca de conectado en la lista**

`MentionAutocomplete` gana un campo opcional `online?: boolean` en sus candidatos y pinta un punto
verde cuando es cierto. Sin él, nada cambia: las menciones siguen igual.

- [ ] **Step 4: Integrar en el chat**

En `ChatDock.tsx`, junto a la lógica de menciones que ya existe (líneas 222-267):

- `const comando = canPost ? parseComando(draft, cursor) : null`.
- Si hay comando, la lista es de comandos (cuando `argActivo` es -1, o sea el nombre) o de
  usuarios (cuando `argActivo === 0` en `/tip`). Las menciones siguen funcionando cuando NO hay
  comando: son excluyentes, y el comando manda porque empieza en la primera posición.
- `handleSend` pasa a: si hay comando, **ejecutarlo y NO enviar**; si no, enviar como hasta ahora.
- Ejecutar `/tip`: resolver el usuario (de los resultados de búsqueda), validar que la cantidad es
  un número > 0, y abrir el `TipModal` con `amountInicial`. Los errores se responden en el chat con
  un mensaje local, sin llamar al backend.

- [ ] **Step 5: Ejecutar y comprobar que pasan**

Run: `npx vitest run src/ui/screens/Hub/ChatDock.test.tsx`
Expected: PASS

- [ ] **Step 6: Suite, compilador y lint**

Run: `npx vitest run && npx tsc -b && npx eslint src/ui/screens/Hub src/onchain/userSearch.ts`
Expected: verde (los 2 errores preexistentes de `ChatDock.tsx` por el bloque `{false && …}` de
Recent Drops siguen; no añadir ninguno nuevo)

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/Hub src/ui/components/TipModal.tsx
git commit -m "feat(chat): comando /tip con autocompletado de destinatario"
```

---

### Task 7: Documentación

**Files:**
- Modify: `backend/README.md`
- Modify: `docs/superpowers/specs/2026-08-14-comandos-chat-tip-design.md`

- [ ] **Step 1: Documentar el endpoint**

En la tabla de endpoints del README, `GET /users/search`: con sesión, búsqueda por PREFIJO (con
rango, que es lo único que usa el índice), tope de 8, con throttle. Y una nota de que se declara
`def` a propósito.

- [ ] **Step 2: Anotar la deuda de los 28 endpoints**

En la sección de riesgos del README: **28 endpoints son `async def` y no esperan nada** (entre
ellos `get_user`, el del incidente), así que bloquean el bucle de eventos al consultar la base.
Quitarles el `async` los mueve al pool de hilos de FastAPI. Pendiente, con su propio ciclo.

- [ ] **Step 3: Marcar el spec**

`Status: approved-pending-review` → `Status: implemented`.

- [ ] **Step 4: Última pasada**

Run: `cd backend && ./.venv/bin/pytest -q && cd .. && npx vitest run && npx tsc -b`
Expected: todo verde

- [ ] **Step 5: Commit**

```bash
git add backend/README.md docs/superpowers/specs/2026-08-14-comandos-chat-tip-design.md
git commit -m "docs(chat): endpoint de búsqueda y la deuda de los 28 async def"
```
