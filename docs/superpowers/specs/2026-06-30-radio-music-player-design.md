# Diseño: Radio / reproductor de música

**Fecha:** 2026-06-30
**Estado:** Aprobado (pendiente de plan de implementación)

## Objetivo

Agregar una "radio" a la app: una lista de canciones que se reproducen
consecutivamente (loop infinito) y que el usuario puede controlar y elegir
manualmente. El reproductor es global y la música no se corta al navegar entre
pantallas.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Fuente de audio | URLs externas / CDN desde el arranque. Lista editable de tracks. |
| UI | Mini-player compacto en el topbar + panel desplegable con la playlist para elegir tema. |
| Persistencia de reproducción | El player vive en el `AppShell`, por encima de las rutas → no se reinicia al navegar. |
| Arranque | Intento de autoplay al cargar → fallback: arranca en el primer gesto del usuario. |
| Relación con el mute SFX | La radio tiene volumen/play **propio**, independiente del `MuteButton` existente (que solo silencia los SFX del juego). |
| Orden | Secuencial + loop infinito, con un toggle de **shuffle** (orden aleatorio). |
| Gestión de estado/audio | Store singleton pub-sub dueño de un único `new Audio()` + hook `useRadio()` (patrón de `dropsStore.ts`). Sin dependencias nuevas. |

### Alternativas de arquitectura consideradas

- **A) Store singleton pub-sub + `new Audio()` + `useRadio()`** — *elegida*. Sigue
  el patrón existente de `src/ui/drops/dropsStore.ts`. Cero dependencias nuevas.
- **B) React Context + `<audio>` renderizado** — descartada. El proyecto evita
  Context (solo lo usa auth); más boilerplate y re-renders más amplios.
- **C) Librería (Howler.js / react-h5-audio-player)** — descartada. Overkill para
  reproducción secuencial; el proyecto hoy tiene cero dependencias de audio.

## Arquitectura

Cuatro piezas nuevas:

| Archivo | Rol |
|---|---|
| `src/ui/radio/tracks.ts` | Lista de canciones: `Track[]` con `{ id, title, artist, url }`. URLs externas. Editable sin tocar lógica. |
| `src/ui/radio/radioStore.ts` | **Singleton pub-sub.** Dueño de un único `new Audio()`. Mantiene el estado y expone acciones. Persiste a localStorage. |
| `src/ui/radio/useRadio.ts` | Hook con `useSyncExternalStore` que devuelve estado + acciones a los componentes. |
| `src/ui/components/RadioPlayer.tsx` | Mini-player del topbar + panel desplegable con la playlist. Usa `useRadio()`, estilado con `theme.ts` + Framer Motion. |

**Punto de montaje:** una única instancia de `<RadioPlayer/>` en el topbar de
`src/ui/layouts/AppShell.tsx` (zona derecha / spacer). Como `AppShell` envuelve
todas las rutas, la reproducción persiste a través de la navegación.

### Tipos

```ts
type Track = {
  id: string;
  title: string;
  artist: string;
  url: string; // URL externa / CDN
};
```

### Estado del store

```ts
type RadioState = {
  tracks: Track[];      // de tracks.ts
  index: number;        // índice del track actual
  isPlaying: boolean;
  volume: number;       // 0..1, independiente del mute SFX
  shuffle: boolean;
  currentTime: number;  // para la barra de progreso
  duration: number;
};
```

Acciones expuestas por el store:

```ts
play(): void
pause(): void
toggle(): void
next(): void          // respeta shuffle + loop
prev(): void          // respeta shuffle + loop
select(index: number): void
setVolume(v: number): void
toggleShuffle(): void
```

### Persistencia (localStorage)

Siguiendo el patrón de `src/ui/sound.ts` (claves `battlearena.*`):

- `battlearena.radio.index` — último track.
- `battlearena.radio.volume` — volumen.
- `battlearena.radio.shuffle` — flag de shuffle.

(No se persiste `isPlaying` para reanudar automáticamente; el arranque se rige
por la política de autoplay descrita abajo.)

### Flujo de datos

```
tracks.ts ─► radioStore (dueño del Audio) ─► useRadio() ─► RadioPlayer (mini + panel)
                  ▲                                              │
                  └──────── acciones (play/next/select) ◄────────┘
```

- El evento `'ended'` del audio dispara `next()` (respetando shuffle/loop).
- `'timeupdate'` / `'loadedmetadata'` actualizan `currentTime` / `duration`.
- El usuario elige tema desde el panel → `select(i)` (carga la URL y reproduce).

### Comportamiento de orden

- **Secuencial:** `next()` avanza `index + 1`; al pasar el último vuelve a `0`
  (loop infinito). `prev()` análogo hacia atrás.
- **Shuffle on:** `next()` y `prev()` eligen un índice aleatorio distinto del
  actual (sin pila de historial, para mantenerlo simple). Mantiene el loop
  (nunca se "termina"). El toggle se persiste.

## Autoplay (punto delicado)

Restricción del navegador: Chrome/Safari/Firefox bloquean el autoplay **con
sonido** hasta que el usuario interactúe con la página. No se puede forzar.

Comportamiento:

1. Al inicializar, el store intenta `audio.play()`.
2. Si la promesa **rechaza** (bloqueo), registra un listener `once` global
   (`pointerdown` / `keydown` / `touchstart`) que arranca la música en el primer
   gesto del usuario y se autodestruye.
3. Si el usuario pausó manualmente antes del primer gesto, **no** se re-arma el
   autoplay.

Resultado práctico: para casi todos los usuarios la música arranca a los pocos
segundos de entrar, en cuanto tocan/clickean algo.

## Manejo de errores

Estilo defensivo como `src/ui/sound.ts` (nunca rompe la UI):

- Error de red / carga de un track (`'error'` del audio) → `console.warn` +
  saltar al siguiente track.
- Lista de tracks vacía → el `RadioPlayer` no se renderiza.
- Toda interacción con la Web Audio / `Audio` envuelta en try/catch.

## Responsive

- **Desktop / tablet (≥760px):** controles compactos en el topbar
  (prev / play-pause / next + título + caret) y panel dropdown con la playlist,
  volumen y toggle de shuffle.
- **Mobile (<760px):** botón play + título truncado; el panel se abre como hoja
  (bottom sheet). Cuidar no chocar con el bottom-nav (60px de alto).

Estilado con los tokens de `src/ui/theme.ts` (`COLORS`, `FONTS`, `SHADOW`) y
animaciones con Framer Motion, consistente con el resto de la UI.

## Testing (Vitest + Testing Library)

- `radioStore.test.ts`:
  - `next` / `prev` con wrap-around (loop).
  - `shuffle`: elige índice distinto del actual.
  - `select(i)` cambia el track.
  - persistencia de `volume` / `index` / `shuffle` en localStorage.
  - evento `'ended'` → `next()`.
  - evento `'error'` → salta al siguiente.
  - Mock de `Audio`.
- `useRadio.test.ts`: el hook refleja cambios del store (suscripción).
- `RadioPlayer.test.tsx`:
  - renderiza los controles.
  - click en next / play-pause llama a la acción correcta del store.
  - el panel lista los tracks.
  - elegir un track del panel lo reproduce.

## Fuera de alcance (YAGNI)

- Subida de archivos / gestión de playlist por el usuario.
- Visualizador de audio (requeriría CORS en el CDN + `AnalyserNode`).
- Integración con servicios de streaming (Spotify/SoundCloud/YouTube).
- Sincronización de reproducción entre usuarios.
