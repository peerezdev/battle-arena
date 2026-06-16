# Hub (lobby) — Diseño

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Alcance:** Nueva pantalla **Hub** (lobby de la app) a la que se entra desde la
landing con "Launch App". Dirección visual Crypto Platform (la ya implementada).
Mockup de referencia: `.superpowers/brainstorm/18398-1781618040/content/hub-v2.html`.

## Propósito

Una pantalla "casa" tipo lobby que reúne en un solo sitio: navegación entre
juegos, batallas en vivo, actividad/drops y chat. Es el shell de la app tras
entrar. Sirve de escaparate (pitch) y de hub de juego.

## Cambios en la landing (parte de este ciclo)

- **Quitar** el botón "Connect wallet" del hero y de la nav.
- **Renombrar** "Play demo" → **"Launch App"**, que navega al **Hub**.
- Las tarjetas de juego de la landing siguen llevando a sus flujos (o al Hub);
  el CTA principal es Launch App → Hub.

## Real vs presentacional (decisión clave)

El Hub se construye **ahora como shell presentacional con navegación real**.
Lo que depende de backend/clave-del-Gacha que aún no existe se monta como
**UI con datos de ejemplo (mock), claramente no funcional**, sin simular saldos
ni acciones reales:

| Elemento | Estado en v1 |
|---|---|
| Layout, rail, dock, responsive | **Real** |
| Navegación a modos (rail + tira de modos) | **Real** → lanza los flujos existentes |
| "Create battle" | **Real** → flujo on-chain de crear desafío existente |
| "Find match" / Quick Match | **Real (acotado)** → abre la lista de batallas filtrada por el stake elegido. **No hay matchmaking automático** (modelo de desafíos); si no hay ninguna, sugiere "Create battle" |
| Live battles list | **Mock** en v1 (datos de ejemplo); se cableará al lobby del backend cuando el flujo on-chain esté logueado (fuera de este ciclo) |
| Live Drops feed | **Mock** (pulls de ejemplo) — real requiere clave del Gacha + feed |
| Chat / Friends | **Presentacional** (mensajes de ejemplo, input deshabilitado o local) — real requiere backend de tiempo real |
| Balance + Deposit | **Presentacional** — real requiere embedded wallet + depósitos cross-chain (spec de wallet) |

Nada presentacional debe afirmar ser real (p.ej. el botón Deposit abre un modal
"coming soon" o no hace nada visible; el balance se muestra como ejemplo o
"—" si no hay wallet). Esto se documenta en el código.

## Layout (del mockup aprobado)

Tres zonas en escritorio (`grid: 92px | 1fr | 340px`):

1. **Rail izquierdo (nav):** logo; items icono+label: Lobby (activo), Pack,
   Royale, Gacha, Mana, Ranks; abajo ajustes + cuenta. El item activo lleva
   acento gradiente. Cada item de juego navega a su flujo.
2. **Centro:**
   - **Top bar:** título "Lobby · N players online", a la derecha balance pill +
     **Deposit** + sonido.
   - **Quick Match hero:** panel con borde-gradiente; kicker "Quick match",
     titular, descripción; **selector de stake** ($10/$50/$125/$250);
     **Find match** (→ lista filtrada por stake) + **Create battle** (→ crear
     desafío); a la derecha 3 stats (live battles, biggest pull today, packs 24h
     — mock).
   - **Tira de modos:** 4 filas compactas (icono + nombre + subtítulo) — Pack
     Battle, Battle Royale, Gacha, Mana Duel — cada una navega a su flujo.
   - **Live battles:** cabecera + contador + sort; segmented control
     (All / Ready to join / Mine / Recent); filas de batalla (modo + tag LIVE,
     nombre, jugadores verde/violeta, cartas, POT/ENTRY/STAKE, Watch/Join).
3. **Dock derecho:** **Live Drops** (feed vertical compacto arriba) + **Chat**
   (tabs Chat/Friends, contador online, mensajes, input).

## Responsive

- **< 1100px:** el dock derecho (chat/drops) se colapsa a un **botón flotante**
  que abre un drawer; el centro ocupa el ancho.
- **< 760px (móvil):** el rail izquierdo pasa a **barra de navegación inferior**
  (iconos); el hero y la tira de modos se apilan; las filas de batalla se
  compactan. Chat/drops en drawer.

## Routing / integración

- `App.tsx`: la landing "Launch App" entra al **Hub** (nuevo estado de entrada).
  El Hub reemplaza al actual destino directo de "Play demo".
- Desde el Hub:
  - Mana Duel → flujo offline existente (`appMode 'offline'`).
  - Battle Royale → demo existente (`appMode 'royale'`).
  - Pack Battle / Gacha → flujo on-chain existente (`appMode 'onchain'`), que
    pedirá conectar wallet si hace falta.
  - "Create battle" / "Find match" → flujo on-chain (lobby) con el stake/contexto.
- El Hub es accesible **sin wallet** (presentacional); las acciones on-chain
  disparan el connect cuando toca.

## Componentes (archivos)

```
src/ui/screens/Hub/Hub.tsx            (nuevo — orquesta el layout + callbacks)
src/ui/screens/Hub/LeftRail.tsx       (nuevo — nav de modos)
src/ui/screens/Hub/QuickMatch.tsx     (nuevo — hero + stake + CTAs)
src/ui/screens/Hub/LiveBattles.tsx    (nuevo — lista + filtros, datos mock)
src/ui/screens/Hub/ChatDock.tsx       (nuevo — drops + chat, presentacional)
src/ui/screens/Hub/hubMockData.ts     (nuevo — datos de ejemplo claramente mock)
src/ui/screens/Landing.tsx            (modificar — quitar Connect, Play demo→Launch App)
src/App.tsx                           (modificar — routing landing→Hub→flujos)
```
Cada componente recibe callbacks de navegación del `Hub`, que a su vez los
recibe de `App`. Sin lógica de negocio nueva; el motor no se toca.

## No-goals (YAGNI)

- Chat en tiempo real, feed real de drops, balance/depósitos reales,
  matchmaking automático, leaderboard real (la pestaña Ranks puede ser un
  placeholder) — todo backend, fuera de este ciclo.
- No introducir framework de routing (seguimos con estado en `App.tsx`).

## Verificación

- `tsc` + `build` + `vitest` (102 tests de motor, intactos) verdes.
- Visual por preview: landing "Launch App" → Hub; navegar a cada modo;
  responsive (drawer de chat < 1100, nav inferior < 760).

## Riesgos

- **Tentación de aparentar funcionalidad** (balance/chat/drops) — mitigado
  marcando todo lo mock y con acciones "coming soon".
- **Superficie grande** — mitigado descomponiendo en componentes pequeños por
  zona.
- El cableado real (battles del backend, chat, balance) llegará cuando exista el
  backend correspondiente; el shell queda listo para enchufarlo.
