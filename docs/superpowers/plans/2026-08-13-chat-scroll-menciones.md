# Chat: scroll al final y menciones a conectados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el chat se abra por los mensajes más recientes y siga el ritmo sin arrastrar a quien lee, y que se pueda mencionar con `@` a los jugadores conectados.

**Architecture:** Dos partes independientes. La 1 (scroll) es solo frontend y se entrega sola. La 2 (menciones) se apoya en la presencia: el backend empieza a guardar QUIÉN está conectado, la lista viaja por el aviso `presence` que ya existe, y el autocompletado se resuelve en memoria — **ni una petición HTTP nueva**.

**Tech Stack:** React + TypeScript + vitest (frontend); FastAPI + SQLAlchemy + pytest (backend).

Spec: `docs/superpowers/specs/2026-08-13-chat-scroll-menciones-design.md`.

## Global Constraints

- **Ninguna petición HTTP por tecleo.** `src/ui/useAliases.ts` documenta que una ráfaga contra `/users/{wallet}` tumbó producción: el backend corre en UN proceso y consulta la base de forma síncrona. El autocompletado se resuelve con la lista de presencia que ya está en memoria.
- El servidor **no se fía** de las menciones que manda el cliente: solo acepta wallets conectadas en ese instante, y como mucho 5 por mensaje.
- Frontend desde la raíz: `npx vitest run <fichero>`, `npx tsc -b`. Línea base: **753 tests**.
- Backend desde `backend/`: `./.venv/bin/pytest`. Línea base: **679 tests**.
- Los comentarios del repo van en español y explican POR QUÉ. Los textos que ve el jugador, en inglés y escritos por nosotros.
- Nada de guiones largos (—) en textos que vea el usuario.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `src/ui/screens/Hub/useStickToBottom.ts` (crear) | La lógica de "seguir al fondo", sin React DOM |
| `src/ui/screens/Hub/ChatDock.tsx` (modificar) | Contenedor con ref, botón de nuevos, autocompletado, pintado |
| `src/ui/screens/Hub/MentionAutocomplete.tsx` (crear) | La lista de sugerencias y su teclado |
| `src/ui/screens/Hub/mentions.ts` (crear) | Parsear `@` del borrador y resolver etiquetas a wallets |
| `src/hooks/useChat.ts` (modificar) | Expone `onlineUsers`; `send` acepta menciones |
| `backend/app/chat.py` (modificar) | `ConnectionManager` con wallets; `mentions` en guardar y leer |
| `backend/app/main.py` (modificar) | Identificar el socket, validar menciones, aviso de presencia |
| `backend/app/models.py`, `backend/app/db.py` (modificar) | Columna `mentions` |

---

### Task 1: El hook que sigue al fondo

**Files:**
- Create: `src/ui/screens/Hub/useStickToBottom.ts`
- Test: `src/ui/screens/Hub/useStickToBottom.test.ts`

**Interfaces:**
- Produces: `estaAlFondo(el: {scrollHeight, scrollTop, clientHeight}, margen?: number): boolean` y el hook `useStickToBottom(ref, totalMensajes)` → `{ pegadoAlFondo, nuevosSinVer, bajarDelTodo, alHacerScroll }`.

La parte con lógica se saca a una función pura para poder probarla sin DOM. El hook es el pegamento.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/ui/screens/Hub/useStickToBottom.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { estaAlFondo, MARGEN_FONDO } from './useStickToBottom'

const el = (scrollHeight: number, scrollTop: number, clientHeight: number) =>
  ({ scrollHeight, scrollTop, clientHeight })

describe('estaAlFondo', () => {
  it('el fondo exacto cuenta como fondo', () => {
    expect(estaAlFondo(el(1000, 800, 200))).toBe(true)
  })

  it('tolera el margen, porque el fondo exacto es inalcanzable en la práctica', () => {
    // Un píxel de inercia del ratón o del rebote táctil bastaba para salir del modo seguir
    // y que el chat dejara de moverse sin que el jugador hubiera hecho nada.
    expect(estaAlFondo(el(1000, 800 - MARGEN_FONDO, 200))).toBe(true)
    expect(estaAlFondo(el(1000, 800 - MARGEN_FONDO - 1, 200))).toBe(false)
  })

  it('leyendo historial NO está al fondo', () => {
    expect(estaAlFondo(el(1000, 0, 200))).toBe(false)
  })

  it('una lista que no llega a llenar el alto está al fondo', () => {
    // Sin esto, un chat con dos mensajes nunca entraría en modo seguir.
    expect(estaAlFondo(el(150, 0, 200))).toBe(true)
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run src/ui/screens/Hub/useStickToBottom.test.ts`
Expected: FAIL, no existe el módulo

- [ ] **Step 3: Escribir el hook**

Crear `src/ui/screens/Hub/useStickToBottom.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'react'

/** Cuánto puede alejarse del fondo y seguir contando como "está abajo".
 *
 *  No es el fondo exacto a propósito: con el fondo exacto, un píxel de inercia del ratón o del
 *  rebote táctil de iOS ya saca del modo seguir, y el chat deja de moverse sin que el jugador
 *  haya hecho nada. 40px es aproximadamente una línea de mensaje. */
export const MARGEN_FONDO = 40

interface Medidas { scrollHeight: number; scrollTop: number; clientHeight: number }

export function estaAlFondo(el: Medidas, margen: number = MARGEN_FONDO): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= margen
}

/**
 * Mantiene el chat pegado al final, sin arrastrar a quien ha subido a leer.
 *
 * Al entrar coloca abajo del todo (el chat no tenía NADA de esto: por eso se abría por los
 * mensajes más viejos). Con cada mensaje nuevo baja solo si el jugador estaba abajo; si había
 * subido, no se mueve nada y se cuentan los que no ha visto.
 */
export function useStickToBottom(
  ref: React.RefObject<HTMLElement | null>,
  totalMensajes: number,
) {
  const [pegadoAlFondo, setPegadoAlFondo] = useState(true)
  const [nuevosSinVer, setNuevosSinVer] = useState(0)
  const vistos = useRef(totalMensajes)

  const bajarDelTodo = useCallback((suave = true) => {
    const el = ref.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: suave ? 'smooth' : 'auto' })
    vistos.current = totalMensajes
    setNuevosSinVer(0)
    setPegadoAlFondo(true)
  }, [ref, totalMensajes])

  const alHacerScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const abajo = estaAlFondo(el)
    setPegadoAlFondo(abajo)
    if (abajo) {
      vistos.current = totalMensajes
      setNuevosSinVer(0)
    }
  }, [ref, totalMensajes])

  useEffect(() => {
    if (totalMensajes === 0) return
    if (pegadoAlFondo) {
      // Sin animación la primera vez: al entrar hay que APARECER abajo, no ver un barrido por
      // todo el historial.
      bajarDelTodo(vistos.current !== 0)
    } else {
      setNuevosSinVer(Math.max(0, totalMensajes - vistos.current))
    }
    // `pegadoAlFondo` NO va en las dependencias: este efecto reacciona a mensajes nuevos, y
    // meterlo haría que el chat bajara solo por volver a tocar fondo con el ratón.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalMensajes])

  return { pegadoAlFondo, nuevosSinVer, bajarDelTodo, alHacerScroll }
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasa**

Run: `npx vitest run src/ui/screens/Hub/useStickToBottom.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/Hub/useStickToBottom.ts src/ui/screens/Hub/useStickToBottom.test.ts
git commit -m "feat(chat): hook para seguir al fondo sin arrastrar a quien lee"
```

---

### Task 2: El chat se abre por lo último

**Files:**
- Modify: `src/ui/screens/Hub/ChatDock.tsx` (el contenedor de mensajes está en la línea 599)
- Test: `src/ui/screens/Hub/ChatDock.test.tsx`

**Interfaces:**
- Consumes: `useStickToBottom` (Task 1).

- [ ] **Step 1: Escribir el test que falla**

En `src/ui/screens/Hub/ChatDock.test.tsx`, junto a los demás. jsdom no hace layout, así que las medidas se simulan definiendo las propiedades sobre el nodo:

```tsx
it('al entrar se coloca en el último mensaje, no en el primero', () => {
  const scrollTo = vi.fn()
  // jsdom no calcula layout: scrollHeight/clientHeight son 0 y scrollTo no existe.
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, writable: true })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { value: 200, configurable: true })

  chatState.messages = [
    { user: 'A', wallet: 'W1', text: 'viejo', ts: 1 },
    { user: 'B', wallet: 'W2', text: 'nuevo', ts: 2 },
  ]
  render(<ChatDock />)

  expect(scrollTo).toHaveBeenCalled()
  const arg = scrollTo.mock.calls[0][0]
  expect(arg.top).toBe(1000)          // al final, no al principio
})
```

- [ ] **Step 2: Ejecutar y comprobar que falla**

Run: `npx vitest run src/ui/screens/Hub/ChatDock.test.tsx -t "último mensaje"`
Expected: FAIL, `scrollTo` no se llama nunca

- [ ] **Step 3: Conectar el hook al contenedor**

En `ChatDock.tsx`:

```tsx
import { useStickToBottom } from './useStickToBottom'
```

Dentro del componente, junto a los demás estados:

```tsx
  const listaRef = useRef<HTMLDivElement>(null)
  const { pegadoAlFondo, nuevosSinVer, bajarDelTodo, alHacerScroll } =
    useStickToBottom(listaRef, messages.length)
```

Y en el contenedor de mensajes (línea 599, el que tiene `overflowY: 'auto'` dentro de la región de chat), añadir `ref={listaRef}` y `onScroll={alHacerScroll}`. El `<div>` pasa a envolverse en uno con `position: 'relative'` para poder colgar el botón.

- [ ] **Step 4: Añadir el botón de mensajes nuevos**

Justo después del contenedor de mensajes, dentro del envoltorio relativo:

```tsx
  {!pegadoAlFondo && nuevosSinVer > 0 && (
    <button
      onClick={() => bajarDelTodo()}
      style={{
        position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)',
        background: COLORS.panel2, border: `1px solid ${COLORS.border}`, borderRadius: 999,
        padding: '5px 12px', color: COLORS.text, fontFamily: FONTS.mono, fontSize: 10.5,
        cursor: 'pointer', boxShadow: SHADOW.soft, whiteSpace: 'nowrap',
      }}
    >
      {nuevosSinVer} new {nuevosSinVer === 1 ? 'message' : 'messages'} ↓
    </button>
  )}
```

- [ ] **Step 5: Ejecutar y comprobar que pasa**

Run: `npx vitest run src/ui/screens/Hub/ChatDock.test.tsx`
Expected: PASS

- [ ] **Step 6: Añadir el test del caso que de verdad importa**

```tsx
it('si el jugador ha subido a leer, un mensaje nuevo NO le mueve', () => {
  const scrollTo = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { value: scrollTo, writable: true })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { value: 1000, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { value: 200, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', { value: 0, writable: true, configurable: true })

  chatState.messages = [{ user: 'A', wallet: 'W1', text: 'uno', ts: 1 }]
  const { rerender } = render(<ChatDock />)
  fireEvent.scroll(screen.getByTestId('chat-messages'))   // arriba del todo
  scrollTo.mockClear()

  chatState.messages = [...chatState.messages, { user: 'B', wallet: 'W2', text: 'dos', ts: 2 }]
  rerender(<ChatDock />)

  expect(scrollTo).not.toHaveBeenCalled()                 // no se le arrastra
  expect(screen.getByText(/1 new message/i)).toBeTruthy()  // pero se le avisa
})
```

Añade `data-testid="chat-messages"` al contenedor para poder dispararle el scroll.

- [ ] **Step 7: Ejecutar la suite y el compilador**

Run: `npx vitest run && npx tsc -b`
Expected: todo verde

- [ ] **Step 8: Commit**

```bash
git add src/ui/screens/Hub/ChatDock.tsx src/ui/screens/Hub/ChatDock.test.tsx
git commit -m "fix(chat): abrir por el último mensaje y avisar de los nuevos sin arrastrar"
```

---

### Task 3: El backend sabe QUIÉN está conectado

**Files:**
- Modify: `backend/app/chat.py` (`ConnectionManager`, líneas 94-113)
- Modify: `backend/app/main.py` (el handler `ws_chat`, sobre la línea 2035)
- Test: `backend/tests/test_chat.py`

**Interfaces:**
- Produces: `ConnectionManager.identify(ws, wallet, name)`, `online_users() -> list[dict]`, y `online_count()` contando wallets.

- [ ] **Step 1: Escribir los tests que fallan**

En `backend/tests/test_chat.py`:

```python
def test_online_users_no_repite_a_quien_tiene_dos_pestanas():
    """Dos pestañas son dos sockets pero UN jugador.

    `online_count` contaba sockets, así que quien abría dos pestañas inflaba el contador y
    aparecería dos veces en el autocompletado de menciones.
    """
    from app.chat import ConnectionManager
    m = ConnectionManager()
    a1, a2, b = object(), object(), object()
    for ws in (a1, a2, b):
        m._active[ws] = None            # simula conexión sin pasar por el accept
    m.identify(a1, "WalletA", "Ana")
    m.identify(a2, "WalletA", "Ana")
    m.identify(b, "WalletB", "Bea")

    assert m.online_count() == 2
    assert sorted(u["wallet"] for u in m.online_users()) == ["WalletA", "WalletB"]


def test_online_users_no_incluye_a_los_anonimos():
    """Sin sesión no hay a quién avisar, así que no se puede mencionar.

    Siguen contando en `online`: están mirando, aunque no puedan hablar.
    """
    from app.chat import ConnectionManager
    m = ConnectionManager()
    con, sin = object(), object()
    m._active[con] = None
    m._active[sin] = None
    m.identify(con, "WalletA", "Ana")

    assert m.online_count() == 2
    assert [u["wallet"] for u in m.online_users()] == ["WalletA"]
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `cd backend && ./.venv/bin/pytest tests/test_chat.py -k "online_users" -v`
Expected: FAIL, `ConnectionManager` no tiene `identify`

- [ ] **Step 3: Cambiar el ConnectionManager**

En `backend/app/chat.py`, sustituir la clase:

```python
class ConnectionManager:
    def __init__(self):
        # socket → {"wallet", "name"} o None si es anónimo. Antes era un set de sockets: no se
        # guardaba QUIÉN había detrás, y sin eso no se puede ofrecer a quién mencionar.
        self._active: dict[WebSocket, Optional[dict]] = {}

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._active[ws] = None

    def identify(self, ws: WebSocket, wallet: str, name: str) -> None:
        """Ata el socket a su jugador. Se llama tras resolver el alias, no al aceptar."""
        if ws in self._active:
            self._active[ws] = {"wallet": wallet, "name": name}

    def disconnect(self, ws: WebSocket) -> None:
        self._active.pop(ws, None)

    def online_count(self) -> int:
        # Wallets DISTINTAS más los anónimos sueltos: dos pestañas del mismo jugador son uno.
        wallets = {u["wallet"] for u in self._active.values() if u}
        anonimos = sum(1 for u in self._active.values() if not u)
        return len(wallets) + anonimos

    def online_users(self) -> list[dict]:
        """Quién se puede mencionar. Sin duplicados y ordenado, para que la lista no baile."""
        por_wallet = {u["wallet"]: u for u in self._active.values() if u}
        return sorted(por_wallet.values(), key=lambda u: u["name"].lower())

    async def broadcast(self, msg: dict) -> None:
        for ws in list(self._active):
            try:
                await ws.send_json(msg)
            except Exception:
                self._active.pop(ws, None)
```

Añade `Optional` al import de `typing` si no está.

- [ ] **Step 4: Identificar el socket y mandar la lista**

En `backend/app/main.py`, dentro de `ws_chat`, justo después de calcular `display_name` (sobre la línea 2049) y ANTES del primer aviso de presencia:

```python
            if wallet:
                _chat_mgr.identify(ws, wallet, display_name)
```

Y como los tres avisos de presencia (líneas 2054, 2075 y 2078) son idénticos, extraerlos a un helper junto al handler para no repetir la lista en tres sitios:

```python
    def _presence() -> dict:
        return {"type": "presence", "online": _chat_mgr.online_count(),
                "users": _chat_mgr.online_users()}
```

y sustituir los tres por `await _chat_mgr.broadcast(_presence())`.

- [ ] **Step 5: Ejecutar los tests**

Run: `cd backend && ./.venv/bin/pytest tests/test_chat.py -v`
Expected: PASS

- [ ] **Step 6: La suite completa**

Run: `cd backend && ./.venv/bin/pytest -q`
Expected: 679 + 2 en verde

- [ ] **Step 7: Commit**

```bash
git add backend/app/chat.py backend/app/main.py backend/tests/test_chat.py
git commit -m "feat(chat): la presencia dice quién está conectado, no solo cuántos"
```

---

### Task 4: Las menciones se guardan y se validan en el servidor

**Files:**
- Modify: `backend/app/models.py` (`ChatMessage`), `backend/app/db.py` (`_ENSURE_COLUMNS`, línea 21)
- Modify: `backend/app/chat.py` (`save_chat_message` línea 18, `recent_chat_messages` línea 40)
- Modify: `backend/app/main.py` (recepción del mensaje, sobre la línea 2056)
- Test: `backend/tests/test_chat_store.py`, `backend/tests/test_chat.py`

**Interfaces:**
- Consumes: `online_users()` (Task 3).
- Produces: `save_chat_message(..., mentions=[{"wallet","label"}])`; el frame `message` lleva `mentions`.

- [ ] **Step 1: Escribir los tests que fallan**

En `backend/tests/test_chat_store.py`:

```python
def test_las_menciones_sobreviven_al_historial(Session):
    """Se guardan aparte del texto, con la etiqueta que se escribió.

    Si solo se guardara `@juan` dentro del texto, el día que Juan cambie de alias el mensaje
    mentiría, y volver a enlazarlo exigiría resolver nombre → wallet, que es justo la búsqueda
    que este diseño evita.
    """
    from app.chat import save_chat_message, recent_chat_messages
    s = Session()
    save_chat_message(s, "Ana", "hola @juan", 1000, wallet="WalletA",
                      mentions=[{"wallet": "WalletJ", "label": "juan"}])
    s.commit()
    out = recent_chat_messages(s)
    assert out[-1]["mentions"] == [{"wallet": "WalletJ", "label": "juan"}]


def test_un_mensaje_sin_menciones_no_lleva_el_campo(Session):
    """Los mensajes ya guardados no tienen la columna: el cliente no puede recibir `null`."""
    from app.chat import save_chat_message, recent_chat_messages
    s = Session()
    save_chat_message(s, "Ana", "hola", 1000, wallet="WalletA")
    s.commit()
    assert "mentions" not in recent_chat_messages(s)[-1]
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `cd backend && ./.venv/bin/pytest tests/test_chat_store.py -k menciones -v`
Expected: FAIL, `save_chat_message` no acepta `mentions`

- [ ] **Step 3: La columna**

En `backend/app/models.py`, en `ChatMessage`, junto a los demás campos opcionales:

```python
    # JSON: [{"wallet", "label"}]. Aparte del texto a propósito: ver save_chat_message.
    mentions: Mapped[Optional[str]] = mapped_column(String, nullable=True)
```

En `backend/app/db.py`, en `_ENSURE_COLUMNS` (línea 21), junto a la entrada de `chat_messages`:

```python
    ("chat_messages", "mentions", "VARCHAR"),
```

- [ ] **Step 4: Guardar y leer**

En `save_chat_message`, añadir el parámetro `mentions: Optional[list] = None` y pasarlo a la fila como `json.dumps(mentions) if mentions else None`.

En `recent_chat_messages`, junto al bloque de `wallet` (línea 51), añadir:

```python
        if r.mentions:
            try:
                m["mentions"] = json.loads(r.mentions)
            except (ValueError, TypeError):
                pass
```

- [ ] **Step 5: Ejecutar los tests del almacén**

Run: `cd backend && ./.venv/bin/pytest tests/test_chat_store.py -v`
Expected: PASS

- [ ] **Step 6: Escribir el test de la validación**

En `backend/tests/test_chat.py`:

```python
def test_solo_se_aceptan_menciones_de_conectados_y_como_mucho_cinco():
    """El cliente manda las menciones, así que el servidor no se fía.

    Sin este filtro, cualquiera podría mandar a mano un mensaje mencionando a TODA la base de
    usuarios, o a gente desconectada que nunca se enteraría.
    """
    from app.main import _menciones_validas

    conectados = [{"wallet": f"W{i}", "name": f"n{i}"} for i in range(8)]
    crudas = ([{"wallet": "DESCONECTADA", "label": "x"}]
              + [{"wallet": f"W{i}", "label": f"n{i}"} for i in range(8)])

    out = _menciones_validas(crudas, conectados)

    assert len(out) == 5                                   # recortado
    assert all(m["wallet"] != "DESCONECTADA" for m in out)  # filtrado
```

- [ ] **Step 7: Implementar la validación**

En `backend/app/main.py`, a nivel de módulo (fuera de `create_app`, para poder probarla sin montar la app):

```python
MAX_MENCIONES = 5


def _menciones_validas(crudas, conectados) -> list[dict]:
    """Menciones que el servidor acepta de un mensaje de chat.

    Se filtra contra QUIÉN ESTÁ CONECTADO en este instante y se recorta: el cliente manda esta
    lista, así que sin filtro cualquiera podría mencionar a media base de usuarios a mano, o a
    gente desconectada que no se enteraría. Lo descartado se tira en silencio y el mensaje se
    envía igual: una mención mal puesta no es motivo para tragarse lo que el jugador escribió.
    """
    permitidas = {u["wallet"] for u in conectados}
    out = []
    for m in crudas or []:
        if not isinstance(m, dict):
            continue
        w, label = m.get("wallet"), m.get("label")
        if w in permitidas and isinstance(label, str) and label:
            out.append({"wallet": w, "label": label[:40]})
        if len(out) >= MAX_MENCIONES:
            break
    return out
```

Y en el handler del mensaje (sobre la línea 2056), antes de construir `msg`:

```python
                menciones = _menciones_validas(data.get("mentions"), _chat_mgr.online_users())
```

Añadirlas a `msg` solo si las hay (para no mandar `mentions: []` a todos los mensajes) y pasarlas a `save_chat_message(..., mentions=menciones or None)`.

- [ ] **Step 8: Ejecutar los tests y la suite**

Run: `cd backend && ./.venv/bin/pytest -q`
Expected: todo verde

- [ ] **Step 9: Commit**

```bash
git add backend/app/models.py backend/app/db.py backend/app/chat.py backend/app/main.py backend/tests
git commit -m "feat(chat): menciones guardadas aparte del texto y validadas contra los conectados"
```

---

### Task 5: El frontend conoce a los conectados y manda menciones

**Files:**
- Modify: `src/hooks/useChat.ts`
- Create: `src/ui/screens/Hub/mentions.ts`
- Test: `src/ui/screens/Hub/mentions.test.ts`

**Interfaces:**
- Consumes: el aviso `presence` con `users` (Task 3); el campo `mentions` del frame `message` (Task 4).
- Produces: `useChat()` devuelve además `onlineUsers: OnlineUser[]`, y `send(text, mentions?)`; `mentions.ts` exporta `buscarMencion(texto, cursor)` y `resolverMenciones(texto, conectados)`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/ui/screens/Hub/mentions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buscarMencion, resolverMenciones } from './mentions'

const conectados = [
  { wallet: 'WalletA', name: 'ana' },
  { wallet: 'WalletB', name: 'Bea' },
  { wallet: 'WalletC', name: '8QDB…gtm6' },
]

describe('buscarMencion', () => {
  it('encuentra la mención que se está escribiendo', () => {
    expect(buscarMencion('hola @an', 8)).toEqual({ desde: 5, consulta: 'an' })
  })

  it('no se activa a mitad de una palabra, como en un correo', () => {
    expect(buscarMencion('escribe a mauro@correo.com', 26)).toBeNull()
  })

  it('se cierra al escribir un espacio', () => {
    expect(buscarMencion('hola @ana y ', 12)).toBeNull()
  })
})

describe('resolverMenciones', () => {
  it('convierte las etiquetas escritas en wallets', () => {
    expect(resolverMenciones('hola @ana y @Bea', conectados)).toEqual([
      { wallet: 'WalletA', label: 'ana' },
      { wallet: 'WalletB', label: 'Bea' },
    ])
  })

  it('ignora a quien no esté conectado', () => {
    expect(resolverMenciones('hola @nadie', conectados)).toEqual([])
  })

  it('no repite si se menciona dos veces al mismo', () => {
    expect(resolverMenciones('@ana @ana', conectados)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npx vitest run src/ui/screens/Hub/mentions.test.ts`
Expected: FAIL, no existe el módulo

- [ ] **Step 3: Escribir el módulo**

Crear `src/ui/screens/Hub/mentions.ts`:

```ts
/** Un jugador conectado, tal y como lo manda el backend en el aviso de presencia. */
export interface OnlineUser { wallet: string; name: string }
export interface Mention { wallet: string; label: string }

/** El `@` solo abre mención al principio o tras un espacio: si no, "mauro@correo.com" abriría
 *  la lista a mitad de escribir un correo. */
const INICIO_MENCION = /(?:^|\s)@([^\s@]*)$/

export function buscarMencion(texto: string, cursor: number): { desde: number; consulta: string } | null {
  const antes = texto.slice(0, cursor)
  const m = INICIO_MENCION.exec(antes)
  if (!m) return null
  return { desde: antes.length - m[1].length - 1, consulta: m[1] }
}

/** Etiquetas escritas → wallets, con la lista de presencia que ya está en memoria.
 *  Sin peticiones: es la razón de que las menciones sean solo a conectados. */
export function resolverMenciones(texto: string, conectados: OnlineUser[]): Mention[] {
  const out: Mention[] = []
  const vistas = new Set<string>()
  for (const u of conectados) {
    const re = new RegExp(`(?:^|\\s)@${u.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`)
    if (re.test(texto) && !vistas.has(u.wallet)) {
      vistas.add(u.wallet)
      out.push({ wallet: u.wallet, label: u.name })
    }
  }
  return out
}
```

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `npx vitest run src/ui/screens/Hub/mentions.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Conectar el hook**

En `src/hooks/useChat.ts`:
- Añadir `mentions?: Mention[]` a `ChatLine` y leerlo en `linea()`.
- Añadir estado `const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])`, y en la rama `msg.type === 'presence'` guardar también `setOnlineUsers((msg.users as OnlineUser[]) ?? [])`.
- `send` pasa a aceptar menciones: `enviar({ text, mentions })`.
- Devolverlos en el objeto del hook y en su tipo de retorno.

- [ ] **Step 6: Ejecutar la suite y el compilador**

Run: `npx vitest run && npx tsc -b`
Expected: verde

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useChat.ts src/ui/screens/Hub/mentions.ts src/ui/screens/Hub/mentions.test.ts
git commit -m "feat(chat): el cliente conoce a los conectados y resuelve menciones en memoria"
```

---

### Task 6: El autocompletado del `@`

**Files:**
- Create: `src/ui/screens/Hub/MentionAutocomplete.tsx`
- Test: `src/ui/screens/Hub/MentionAutocomplete.test.tsx`
- Modify: `src/ui/screens/Hub/ChatDock.tsx` (el input está en la línea 733)

**Interfaces:**
- Consumes: `buscarMencion` (Task 5), `onlineUsers` (Task 5).
- Produces: `<MentionAutocomplete candidatos onElegir onCerrar />`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/ui/screens/Hub/MentionAutocomplete.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MentionAutocomplete } from './MentionAutocomplete'

const candidatos = [
  { wallet: 'WalletA', name: 'ana' },
  { wallet: 'WalletB', name: 'Bea' },
]

describe('MentionAutocomplete', () => {
  it('enseña a los candidatos', () => {
    render(<MentionAutocomplete candidatos={candidatos} onElegir={vi.fn()} onCerrar={vi.fn()} />)
    expect(screen.getByText('ana')).toBeTruthy()
    expect(screen.getByText('Bea')).toBeTruthy()
  })

  it('Enter elige el resaltado y las flechas lo mueven', () => {
    const onElegir = vi.fn()
    render(<MentionAutocomplete candidatos={candidatos} onElegir={onElegir} onCerrar={vi.fn()} />)
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(onElegir).toHaveBeenCalledWith(candidatos[1])
  })

  it('Escape cierra sin elegir a nadie', () => {
    const onElegir = vi.fn(); const onCerrar = vi.fn()
    render(<MentionAutocomplete candidatos={candidatos} onElegir={onElegir} onCerrar={onCerrar} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onCerrar).toHaveBeenCalled()
    expect(onElegir).not.toHaveBeenCalled()
  })

  it('pulsar con el ratón también elige', () => {
    const onElegir = vi.fn()
    render(<MentionAutocomplete candidatos={candidatos} onElegir={onElegir} onCerrar={vi.fn()} />)
    fireEvent.click(screen.getByText('Bea'))
    expect(onElegir).toHaveBeenCalledWith(candidatos[1])
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npx vitest run src/ui/screens/Hub/MentionAutocomplete.test.tsx`
Expected: FAIL, no existe el componente

- [ ] **Step 3: Escribir el componente**

Crear `src/ui/screens/Hub/MentionAutocomplete.tsx`. Requisitos, todos con test arriba:
- Lista los candidatos con su nombre; el resaltado empieza en el primero.
- Escucha el teclado en `window` (`ArrowUp`/`ArrowDown`/`Enter`/`Escape`) desde un `useEffect`, y **hace `preventDefault`** en esas cuatro: si no, Enter enviaría el mensaje a medio escribir y las flechas moverían el cursor del input.
- Pulsar con el ratón elige.
- Se posiciona sobre el campo de texto (`position: absolute`, `bottom: 100%`), con el estilo de panel del chat (`COLORS.panel2`, `COLORS.border`).
- Cada fila enseña el nombre y, debajo y en gris, la wallet abreviada, para distinguir a dos jugadores con nombres parecidos.

- [ ] **Step 4: Ejecutar y comprobar que pasan**

Run: `npx vitest run src/ui/screens/Hub/MentionAutocomplete.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Conectarlo al campo del chat**

En `ChatDock.tsx`, alrededor del `<input>` (línea 733), envolver en un contenedor `position: relative` y:

```tsx
  const [cursor, setCursor] = useState(0)
  const mencion = canPost ? buscarMencion(draft, cursor) : null
  const candidatos = mencion
    ? onlineUsers.filter((u) =>
        u.name.toLowerCase().includes(mencion.consulta.toLowerCase()) ||
        u.wallet.toLowerCase().startsWith(mencion.consulta.toLowerCase()))
      .slice(0, 6)
    : []
```

Al elegir, se sustituye el trozo `@consulta` por `@nombre ` y se devuelve el foco al input. `onChange` y `onKeyUp`/`onSelect` del input actualizan `cursor` con `e.currentTarget.selectionStart ?? 0`.

Y `handleSend` pasa a resolver: `send(draft, resolverMenciones(draft, onlineUsers))`.

- [ ] **Step 6: Suite y compilador**

Run: `npx vitest run && npx tsc -b`
Expected: verde

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/Hub/MentionAutocomplete.tsx src/ui/screens/Hub/MentionAutocomplete.test.tsx src/ui/screens/Hub/ChatDock.tsx
git commit -m "feat(chat): autocompletar menciones con @ entre los conectados"
```

---

### Task 7: Las menciones se ven, enlazan y avisan

**Files:**
- Modify: `src/ui/screens/Hub/ChatDock.tsx` (el pintado del texto de cada mensaje)
- Create: `src/ui/screens/Hub/MessageText.tsx`
- Test: `src/ui/screens/Hub/MessageText.test.tsx`

**Interfaces:**
- Consumes: `ChatLine.mentions` (Task 5); `useEmbeddedSolanaAddress` de `src/wallet/embedded.ts`.
- Produces: `<MessageText text mentions />`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `src/ui/screens/Hub/MessageText.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children?: React.ReactNode }) => <a href={to}>{children}</a>,
}))

import { MessageText } from './MessageText'

describe('MessageText', () => {
  it('la mención enlaza al perfil de quien se mencionó', () => {
    render(<MessageText text="hola @ana, mira" mentions={[{ wallet: 'WalletA', label: 'ana' }]} />)
    const enlace = screen.getByRole('link', { name: '@ana' })
    expect(enlace.getAttribute('href')).toBe('/profile/WalletA')
  })

  it('un mensaje sin menciones se pinta plano', () => {
    // Los mensajes anteriores a esta funcionalidad no tienen el campo.
    render(<MessageText text="hola @ana" />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText(/hola @ana/)).toBeTruthy()
  })

  it('solo enlaza la etiqueta mencionada, no cualquier arroba', () => {
    render(<MessageText text="@ana y @otro" mentions={[{ wallet: 'WalletA', label: 'ana' }]} />)
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Ejecutar y comprobar que fallan**

Run: `npx vitest run src/ui/screens/Hub/MessageText.test.tsx`
Expected: FAIL, no existe el componente

- [ ] **Step 3: Escribir el componente**

`MessageText` parte el texto buscando cada `@label` de `mentions` y devuelve los trozos, con las menciones como `<Link to={'/profile/' + wallet}>` resaltadas (color `COLORS.green` y fondo tenue). Sin `mentions`, devuelve el texto tal cual. Las etiquetas se escapan antes de meterlas en la expresión regular.

- [ ] **Step 4: Usarlo en el chat y destacar el mensaje propio**

En `ChatDock.tsx`, donde hoy se pinta `{msg.text}` en el mensaje de usuario, usar `<MessageText text={msg.text} mentions={msg.mentions} />`.

Y si el mensaje te menciona (`msg.mentions?.some((m) => m.wallet === ownWallet)`), el contenedor del mensaje lleva un fondo tenue y un borde izquierdo en verde.

- [ ] **Step 5: El aviso**

En `ChatDock.tsx`, un efecto que mire el último mensaje: si te menciona, no lo has visto todavía (el chat está colapsado o no estás pegado al fondo) y no es tuyo, `showToast` con la acción "View" que abre el chat y baja del todo.

- [ ] **Step 6: Suite, compilador y lint**

Run: `npx vitest run && npx tsc -b && npx eslint src/ui/screens/Hub`
Expected: verde (los 4 errores preexistentes de `ChatDock.tsx` siguen; no añadir ninguno nuevo)

- [ ] **Step 7: Commit**

```bash
git add src/ui/screens/Hub
git commit -m "feat(chat): las menciones se resaltan, enlazan y avisan a quien nombran"
```

---

### Task 8: Documentación

**Files:**
- Modify: `backend/README.md`
- Modify: `docs/superpowers/specs/2026-08-13-chat-scroll-menciones-design.md`

- [ ] **Step 1: Documentar el protocolo**

En `backend/README.md`, donde se describa el WebSocket del chat, añadir que el aviso `presence` lleva `users` (`[{wallet, name}]`, sin anónimos ni duplicados) y que el frame de mensaje admite y devuelve `mentions` (`[{wallet, label}]`, validadas contra los conectados y como mucho 5).

- [ ] **Step 2: Marcar el spec**

Cambiar `Status: approved-pending-review` por `Status: implemented`.

- [ ] **Step 3: Última pasada**

Run: `cd backend && ./.venv/bin/pytest -q && cd .. && npx vitest run && npx tsc -b`
Expected: todo verde

- [ ] **Step 4: Commit**

```bash
git add backend/README.md docs/superpowers/specs/2026-08-13-chat-scroll-menciones-design.md
git commit -m "docs(chat): protocolo de presencia y menciones"
```
