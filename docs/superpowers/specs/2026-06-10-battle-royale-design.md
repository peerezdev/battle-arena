# Battle Royale — Diseño

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Entregable de este ciclo:** idea para el material de pitch (spec). **Sin código
de producto** hasta tener la API key de devnet del Gacha.

## Propósito

Cuarto juego de BattleArena y el **máximo motor de volumen para CC**: un battle
royale de packs para 2-10 jugadores. Cada ronda todos abren un pack y **todas las
cartas se acumulan en un bote**; cae el de menor `insured_value`; el último en pie
se lleva **el bote entero** (todas las cartas tiradas en la partida). Al ser
tiradas frescas cada ronda, una sola partida genera **muchas ventas de pack**
(hasta 54 con 10 jugadores). Reutiliza la infraestructura de Pack Battle.

## Decisiones de diseño (cerradas con el usuario)

1. **El creador define el duelo:** tier de pack (cualquier máquina de CC) + nº
   máximo de jugadores, **límite 10** (mínimo 2).
2. **Tiradas frescas cada ronda:** cada superviviente abre un pack nuevo del tier
   en cada ronda; el de menor `insured_value` queda eliminado.
3. **Premio "bote total acumulado":** **todas** las cartas tiradas (de todos los
   jugadores, en todas las rondas) se quedan en el escrow y forman un único bote.
   El **último en pie se lleva el bote entero**. Si te eliminan, pierdes todo lo
   que hayas tirado.
4. **Solo modo Directo (por valor).** El Blotto no escala a N jugadores; un
   bracket de duelos queda fuera de alcance (posible variante futura).
5. **Sin ELO, sin stake de USDC aparte.** La apuesta es la carta de la ronda;
   el coste es el del pack.

## Mecánica de ronda

1. **Compromiso ciego:** todos los supervivientes abren su pack; cada carta se
   entrega **directa al escrow PDA** de la partida (vía `altRecipient`), nunca a
   la wallet del jugador. Firmar/pagar = comprometerse, antes de ver el VRF.
2. **Reveal:** cuando **todas** las cartas de la ronda están en el escrow, se
   revelan a la vez (rareza + `insured_value`). Nadie ve valores ajenos antes de
   comprometerse.
3. **Eliminación:** el oráculo atesta el valor de cada carta (formato de 81 bytes
   ya existente). Cae el de **menor `insured_value`**. Desempate determinista
   (sin azar que controlemos nosotros): rareza más baja → grade más bajo →
   índice de asiento.
4. **Acumulación:** **todas** las cartas de la ronda (la del eliminado y las de
   los supervivientes) permanecen en el escrow PDA y se suman al bote. Nadie
   recupera nada hasta el final.
5. Se repite con los supervivientes hasta que queda **uno**.

## Settlement

- El **bote** (todas las cartas tiradas en la partida) vive en el escrow PDA y se
  transfiere íntegro al **último en pie** por CPI con las seeds del PDA al cerrar
  la partida. Nadie más recupera nada.
- **Timeout:** quien no completa su tirada en la ventana de la ronda queda
  **auto-eliminado**; sus cartas ya tiradas se quedan en el bote. Si el timeout
  deja a **un solo** jugador activo, ese se lleva el bote (último en pie por
  abandono). Caso borde a concretar en implementación: si **todos** los
  supervivientes de una ronda hacen timeout a la vez, se devuelve a cada uno solo
  su última tirada de esa ronda y el bote previo va al de mayor valor de la ronda
  anterior.

## Arranque y llenado

- El creador fija el máximo (2-10). La partida **arranca cuando se llena**, o el
  creador puede **lanzarla con los que haya (≥2)** tras una ventana de espera, o
  cancelarla si no llega el mínimo (en ese caso nadie ha tirado aún → nada que
  reembolsar).

## Por qué es a prueba de trampas

Hereda las garantías de Pack Battle (ver
`2026-06-10-pack-battle-design.md`):

- **No te llevas la carta:** va al escrow PDA por `altRecipient`; nunca la tienes.
- **Sin selección adversa:** pagas la tirada antes de conocer el VRF.
- **Sin pull-shopping:** un `memo` por jugador y por ronda; el oráculo solo atesta
  esa carta.
- **Sin manipulación de valor:** `insured_value` lo fija CC.
- **Sin fuga de información:** reveal bloqueado hasta que todas las cartas de la
  ronda están en el escrow.

## Arquitectura (reutiliza Pack Battle)

- **Programa Anchor:** cuenta `BattleRoyale` con lista de hasta 10 participantes y
  un escrow PDA que acumula las cartas eliminadas. Instrucciones de ronda
  (abrir/atestar/eliminar) sobre el mismo patrón de comparación por valor del
  modo Directo de Pack Battle, iteradas. La verificación ed25519 del oráculo y
  `attestation_msg` (81 bytes) se reutilizan sin cambios.
- **Oráculo / backend / frontend:** reutilizan el cliente del Gacha, la wallet
  embebida (Privy) y el lenguaje visual del reveal. La UI nueva es la **rejilla
  de N jugadores** y la animación de eliminación por ronda.

## Suposiciones a validar con la API key (igual que Pack Battle)

1. La tirada puede entregarse a un **PDA de escrow** (`altRecipient`).
2. Los NFTs del Gacha son **transferibles libremente**.

## Economía (para tenerla presente)

- Coste por jugador y ronda = precio del tier; un jugador paga tantas tiradas como
  rondas sobreviva. El ganador de una partida de 10 paga ~9 tiradas.
- Volumen para CC por partida llena de 10: **54 tiradas** (10+9+…+2). Es el juego
  que más volumen genera del catálogo.
- **Bote = las 54 cartas** (todas las tiradas) → premio enorme para el ganador y
  pérdida total para el resto: alta varianza, muy "battle royale", pero duro.
- Recomendación de producto: ofrecer Battle Royale sobre todo en **tiers baratos**
  para que el coste acumulado y la pérdida potencial sean razonables.

## No-goals (YAGNI)

- Bracket de duelos de maná para N jugadores (variante futura).
- Modo por equipos, espectadores apostando, re-entry.
- Código de producto (se hará tras validar las suposiciones con la key).

## Riesgos abiertos

- **Coste acumulado alto** en tiers caros / muchas rondas → mitigar con tiers
  baratos y/o cap de jugadores por defecto.
- **Azar puro** ("gambling-adjacent"), como el modo Directo de Pack Battle → a
  tener en cuenta antes de mainnet.
- Mismas dependencias de la API key (`altRecipient`→PDA, transferibilidad) que
  Pack Battle.
