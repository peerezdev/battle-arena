# Rediseño web — Dirección "Crypto Platform" (C)

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Alcance:** Landing nueva + identidad visual unificada en todas las pantallas.
Sirve tanto de escaparate para el pitch a Collector Crypt como de producto
jugable. Textos **en inglés**.

## Dirección visual

Estética de **dapp de Solana** moderna y pulida: base oscura sobria, gradiente
Solana (violeta→verde) como acento, tipografía crispada, **aire** y **sombras
suaves en lugar de glows neón duros**. Mantiene la slab gradeada y la idea de
"el valor importa".

## Sistema de diseño (tokens)

Se centraliza en `src/ui/theme.ts`; al usar la mayoría de pantallas los tokens
`COLORS`/`FONTS`, actualizarlos **propaga el restyle automáticamente**.

### Color
```
bg        #0b0e14   (antes #0a0e1a)
panel     #161b24   (antes #121a30)
panel2    #1b212c   (nuevo — superficies elevadas)
border    #ffffff14 (blanco 8% — bordes sutiles)
text      #e9edf5
muted     #9aa3b2
you/green #14F195   (jugador A / "tú")        (antes #34e29b)
opp/violet#9945FF   (jugador B / rival)        (antes rojo #ff5c72)
danger    #ff5c72   (rojo — SOLO peligro/derrota/eliminación)
gradient  linear-gradient(90deg,#9945FF,#14F195)   (Solana — acento de marca)
```
- **Mapping de jugador (1v1):** tú = verde, rival = **violeta**. El rojo deja de
  ser "rival" y queda reservado a peligro/derrota/eliminación (p.ej. el jugador
  eliminado en Battle Royale).

### Rareza (Gacha / Pack Battle / Royale)
```
common    #9aa3b2 (muted)
uncommon  #14F195 (green)
rare      #5ad1ff (azul)
epic      #f0b54a (oro — evita chocar con el violeta del rival)
```

### Tipografía
```
display/headings  'Sora'           (sustituye a Orbitron; titulares y números grandes)
mono/labels       'JetBrains Mono' (labels, valores, certs)
body              'Inter'          (texto corrido en landing/UI)
```
- **Se elimina Orbitron.** En `FONTS` se renombra `orbitron` → `display` (valor
  Sora) y se migran todas las referencias `FONTS.orbitron` → `FONTS.display`.
- Cargar Sora e Inter (y mantener JetBrains Mono) en `index.html`; quitar la
  carga de Orbitron.

### Superficie y profundidad
- Paneles: `panel` + `1px solid border` + **sombra suave** (`0 8px 24px
  #00000055`) en lugar de glow neón. Glows de acento solo sutiles
  (`0 0 16px <accent>33`) para el ganador/estado activo.
- Radios: paneles 14–18px, controles 10–12px, cajas internas 8–11px.

## Componentes

- **Botón primario:** fondo gradiente Solana, texto oscuro, peso Sora 800.
- **Botón fantasma:** transparente + `1px solid border`, texto claro.
- **Panel/tarjeta:** `panel` + borde sutil + sombra suave.
- **Slab gradeada:** carta con borde-inset de acento (verde = tú, violeta =
  rival), grade/cert en mono, valor en Sora con gradiente o color de acento.
- **Chips/badges:** mono, pill, borde sutil (estados "Non-custodial",
  "PSA 9", etc.).
- **Texto gradiente:** utilidad para titulares y valores destacados.

## Landing (nueva pantalla de entrada)

Estructura aprobada (ver mockup `landing-en.html`):
- **Nav:** logo BattleArena + "Connect wallet".
- **Hero:** badge "Built on Solana"; titular paraguas *"Graded cards, made
  playable."*; subtítulo que cubre los cuatro juegos ("skill and luck decide");
  CTAs **"Play demo"** y **"Connect wallet"**; chips *Non-custodial · No seed
  phrase · Deposit from any chain*; visual de duelo (dos slabs enfrentadas,
  verde vs violeta).
- **Games:** rejilla de 4 en igualdad, orden **Pack Battle → Battle Royale →
  Gacha → Mana Duel** (el maná no encabeza). Cada una: icono, nombre, una línea,
  etiqueta.
- **Trust band:** Trustless settlement · Anti-manipulation · Provably fair (VRF).
- **Routing:** la landing es la **primera pantalla**. "Play demo" entra al flujo
  de práctica/selección de juego; "Connect wallet" entra al flujo on-chain. La
  `ModeSelect` actual se reabsorbe/restyle como destino de "Play demo".

## Aplicación por pantalla

1. **`theme.ts` + `index.html`** (fuente del restyle global): nuevos tokens,
   fuentes, mapping de jugador, helpers de gradiente/sombra. Propaga a casi todo.
2. **Landing** (`src/ui/screens/Landing.tsx`, nuevo): la estructura de arriba,
   responsive (1 col en móvil), en inglés.
3. **Mode/Game select:** restyle a los tokens; alcanzable desde "Play demo".
4. **Mana Duel** (`BattleBoard`, `SetupScreen`, `ResultScreen`, `VsIntro`,
   `EnergyAllocator`, sigils): tú=verde / rival=violeta vía `player.a`/`player.b`;
   números en Sora; paneles y sombras suaves. Textos en inglés.
5. **Gacha** (`GachaScreen`): tokens + colores de rareza nuevos.
6. **Battle Royale** (`RoyaleSetupScreen`/`RoyaleBoard`/`RoyaleResultScreen`):
   tokens + rareza; **rojo para jugadores eliminados**. Textos en inglés.
7. **On-chain** (`ConnectScreen`/`CollectionScreen`/`LobbyScreen`/
   `OnchainBattleScreen`): tokens. Textos en inglés.

## Internacionalización

- Todos los textos de UI **en inglés** (la app está hoy en español). Esta pasada
  traduce las cadenas visibles. No se introduce framework de i18n (YAGNI); se
  reescriben las cadenas directamente. Nombres de frentes: Opening / Clash /
  Finisher.

## Enfoque de implementación (incremental, verificando build en cada paso)

- **Fase 1:** `theme.ts` + fuentes (restyle global automático). Verificar
  `tsc`/`build`/tests.
- **Fase 2:** Landing nueva + routing de entrada.
- **Fase 3:** Pulido y traducción por pantalla (Mana Duel → Gacha → Royale →
  on-chain → mode select).
- El motor (`src/engine`, `src/royale`) **no se toca**: es solo capa visual y de
  texto.

## No-goals (YAGNI)

- Framework de i18n / multi-idioma (solo inglés ahora).
- Rediseñar pantallas de juegos aún no implementados (Pack Battle on-chain,
  Royale on-chain) — esas nacerán ya con el sistema.
- Animaciones nuevas más allá de adaptar las existentes a sombras/acentos.

## Riesgos

- **Cambio de identidad** verde/rojo → verde/violeta: aprobado; el rojo se
  reutiliza para peligro. Revisar que ningún sitio mezcle ambos significados.
- **Migración Orbitron→Sora:** find/replace de `FONTS.orbitron`; verificar que no
  quede ninguna referencia colgada.
- **Superficie amplia:** se mitiga centralizando en `theme.ts` y yendo pantalla
  por pantalla con verificación de build.
- Sin tests de snapshot visual: el restyle no rompe tests (son de motor); la
  verificación visual es manual vía preview.
