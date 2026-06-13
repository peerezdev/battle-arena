# Pack Battle — Diseño

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Entregable de este ciclo:** spec + mockups estáticos para el pitch a Collector Crypt. **Sin código de producto** hasta conseguir la API key de devnet del Gacha.

## Propósito

Tercer juego de BattleArena sobre NFTs gradeados de Collector Crypt, pensado
para **maximizar volumen para CC** y servir de argumento para que nos den una
API key del Gacha. Dos jugadores abren cada uno un pack del Gacha; **gana quien
saque la carta de mayor `insured_value` y se queda las dos cartas**. La apuesta
son las propias cartas de la tirada — no hay stake de USDC aparte.

Complementa los juegos existentes: el Blotto (asignación de maná, skill-based) y
la apertura de packs sueltos (Gacha, ya implementada).

## Tesis de pitch (por qué CC nos da la key)

Cada duelo genera, como efecto directo de jugar:
1. **2 ventas de pack** (el coste del tier elegido ×2 va a CC).
2. **Buyback potencial**: el ganador puede revender por el buyback de CC las
   cartas que gane → más volumen.
3. **Protagonismo del VRF de CC**: la aleatoriedad verificable de CC es el
   árbitro del juego; no inventamos azar propio.

Tres ganchos de ingresos para CC en un solo juego, y un settlement trustless que
encaja con la narrativa de la plataforma.

## Decisiones de diseño (cerradas con el usuario)

1. **La apuesta son las cartas, no USDC.** Winner-takes-both por `insured_value`.
2. **El NFT nunca toca la wallet del jugador.** La tirada se entrega **directa
   al PDA de escrow de la batalla** vía el parámetro `altRecipient`/
   `altPlayerAddress` de la API del Gacha. Custodia del premio = programa Anchor,
   en todo momento. Esta es **la suposición load-bearing** a validar con la key.
3. **Fondeo no custodial (Opción B).** Cada jugador usa una **wallet embebida
   (tipo Privy)** que fonda con USDC; las tiradas se firman desde ahí. Nunca
   custodiamos fondos de usuario. Es además el stack del `gacha-starter` oficial
   de CC (señal positiva en el pitch).
4. **Sin ELO.** Pack Battle es azar; el ELO no aporta. El lobby del Blotto
   conserva su ELO; Pack Battle filtra solo por tier de pack.
5. **Mismo tier dentro de un duelo.** El creador elige el tier; quien se une
   abre ese mismo tier (mismo precio, mismas odds) → comparación justa. Todos los
   packs de CC quedan disponibles en el lobby, cada duelo con el suyo.
6. **Compromiso ciego.** Firmar/pagar la tirada *es* el compromiso, antes de ver
   el VRF. El reveal se bloquea hasta que **ambas cartas están en el escrow** →
   nadie ve el valor del rival antes de comprometerse.

## Por qué es a prueba de trampas

- **No te puedes llevar el NFT:** nunca lo tienes; va al escrow PDA por
  `altRecipient`.
- **No hay selección adversa** ("solo deposito si saqué buena carta"): pagas la
  tirada *antes* de conocer el resultado del VRF; la aleatoriedad es el candado
  de compromiso.
- **No hay pull-shopping** (abrir varios y presentar el mejor): se ata
  **exactamente un `memo` por jugador y por batalla**; el oráculo solo atesta la
  carta de ese `memo`.
- **No hay manipulación de valor:** `insured_value` lo fija CC, no el jugador
  (mismo principio anti-manipulación del oráculo actual).
- **No hay fuga de información:** reveal bloqueado hasta ambas-en-escrow; aunque
  las tiradas no sean simultáneas, ninguna se revela antes.

## Loop de juego

1. **Crear** — A elige tier de pack (cualquier máquina de CC). Se publica el
   duelo en el lobby de Pack Battle.
2. **Unirse** — B acepta abrir ese mismo tier. (Si nadie se une, A no ha tirado
   aún: su USDC sigue en su wallet, no hay nada que reembolsar.)
3. **Compromiso ciego** — cada jugador firma y paga su tirada desde su wallet
   embebida; el NFT se entrega directo al PDA de escrow de la batalla
   (`altRecipient` = PDA). El VRF decide la carta tras firmar.
4. **Reveal simultáneo** — cuando ambas cartas están en el escrow, se revelan
   cara a cara (rareza + `insured_value`), con la estética del clash actual.
5. **Settlement trustless** — el oráculo atesta el valor de cada carta (ligado a
   la batalla, formato de 81 bytes ya existente). El programa Anchor compara y
   **transfiere ambas cartas al de mayor `insured_value`** (CPI con seeds del
   PDA). Desempate: tier de rareza del roll → grade → empate real = cada uno
   recupera su carta.
6. **Timeout** — si un jugador no completa su tirada en la ventana, quien tenga
   carta en el escrow la recupera; el duelo se cierra.

## Arquitectura (cómo encaja con lo existente)

Reutiliza la infraestructura ya construida; añade un modo nuevo, no un proyecto
nuevo.

- **Programa Anchor** (`onchain/programs/battle_arena/`): nuevo modo/cuenta
  `PackBattle` con instrucciones análogas a las actuales
  (`initialize`/`join`/`settle`/`timeout`) pero el activo en escrow es un **NFT
  (SPL token, supply 1)** en una token account propiedad del PDA, no USDC. La
  verificación ed25519 del oráculo y el formato `attestation_msg` (81 bytes:
  mint‖value‖grade‖ts‖battle) se reutilizan **sin cambios**.
- **Oráculo** (`oracle/`): reutiliza `/attest` (atestación de `insured_value`
  ligada a la batalla). Cuando llegue la key, añadirá una verificación de que el
  `mint` proviene del `memo` del Gacha de esa batalla/wallet (vía `openPack`).
- **Backend** (`backend/`): extiende el módulo `gacha` ya creado para soportar
  `altRecipient` en `generate-pack` y un registro batalla↔memo↔mint. Lobby de
  Pack Battle (sin ELO).
- **Frontend** (`src/`): nueva pantalla de Pack Battle reutilizando el cliente
  del Gacha (`gachaClient.ts`) y el lenguaje visual del reveal/clash
  (`BattleBoard`). Integración de wallet embebida (Privy) como modo de wallet
  adicional al Reown actual.

## Suposiciones a validar con la API key de devnet (lo que pedimos a CC)

1. **`altRecipient`/`altPlayerAddress` puede entregar la carta a un PDA** (token
   account propiedad del programa). Es lo que sostiene todo el diseño.
2. **Los NFTs del Gacha son transferibles libremente** (no congelados, sin
   transfer-hooks de Token-2022 que bloqueen la CPI del escrow).
3. **Fallback si (1) falla:** con la wallet embebida (Opción B) podemos encadenar
   "abrir pack → transferir la carta al escrow" firmado en la sesión, sin que el
   jugador pueda interponer una tx para quedarse el NFT. Documentar este plan B.

## Mockups a producir (entregable de este ciclo)

HTML estáticos, estética actual de la app (COLORS/FONTS, dark-neon, Orbitron +
JetBrains Mono):

1. **Lobby de Pack Battle** — lista de duelos abiertos con imagen del pack, tier,
   coste, y botón unirse. Sin ELO.
2. **Compromiso ciego / esperando rival** — pantalla tras pagar la tirada:
   "tu carta está en el escrow, esperando a que el rival abra la suya".
3. **Reveal cara a cara** — las dos cartas reveladas con rareza + `insured_value`,
   ganador resaltado, "se lleva ambas cartas".
4. **Diapositiva de flujo de dinero (pitch)** — diagrama: 2 packs vendidos →
   CC; cartas → escrow → ganador; buyback opcional → CC. Pensada para el deck.

Opcional (si el usuario lo quiere): **one-pager en inglés** para mandar por el
Discord de CC junto a la petición de key.

## No-goals (YAGNI)

- Código de producto (programa, backend, frontend) — se hará en un ciclo
  posterior, una vez validadas las suposiciones con la key.
- Stake de USDC aparte (descartado: la apuesta son las cartas).
- Tiers mezclados dentro de un duelo (descartado: sería pay-to-win).
- Matchmaking automático / ELO en Pack Battle.
- Verificación VRF in-app, multi-pack (yolo), gifts.

## Riesgos abiertos

- **`altRecipient`→PDA no soportado** → plan B con wallet embebida (ver arriba);
  si tampoco, el modelo winner-takes-cards no es trustless y habría que
  replantear (p.ej. valor congelado + buyback automático en vez de transferir la
  carta física).
- **NFTs no transferibles** → mismo replanteo.
- **Dependencia de la API key**: todo el código queda bloqueado hasta tenerla;
  por eso este ciclo entrega solo spec + mockups para conseguirla.
- **Encaje regulatorio**: winner-takes-cards sobre azar es "gambling-adjacent";
  para el pitch es aceptable, pero a tener en cuenta antes de mainnet.
