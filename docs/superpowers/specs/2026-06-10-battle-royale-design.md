# Battle Royale — Diseño

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Entregable de este ciclo:** idea para el material de pitch (spec). **Sin código
de producto** hasta tener la API key de devnet del Gacha.

## Propósito

Cuarto juego de BattleArena y el **máximo motor de volumen para CC**: un battle
royale de packs para 2-10 jugadores. Cada ronda todos abren un pack; cae el de
menor `insured_value`; el último en pie se lleva el bote de cartas eliminadas.
Al ser tiradas frescas cada ronda, una sola partida genera **muchas ventas de
pack** (hasta 54 con 10 jugadores). Reutiliza la infraestructura de Pack Battle.

## Decisiones de diseño (cerradas con el usuario)

1. **El creador define el duelo:** tier de pack (cualquier máquina de CC) + nº
   máximo de jugadores, **límite 10** (mínimo 2).
2. **Tiradas frescas cada ronda:** cada superviviente abre un pack nuevo del tier
   en cada ronda; el de menor `insured_value` queda eliminado.
3. **Premio "solo caen las del eliminado":** cada ronda tiras para competir; si
   sobrevives **recuperas tu carta**, si te eliminan **tu carta de esa ronda va
   al bote del ganador**. El ganador final se lleva **sus propias cartas
   conservadas + una carta de cada eliminado**.
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
   índice de asiento. Su carta queda retenida en el escrow (bote).
4. **Devolución:** las cartas de los supervivientes salen del escrow de vuelta a
   sus dueños (ya están a salvo, no vuelven a estar en juego salvo que tiren la
   ronda siguiente).
5. Se repite con los supervivientes hasta que queda **uno**.

## Settlement

- El **bote** (una carta por cada jugador eliminado) vive en el escrow PDA y se
  transfiere al **último en pie** por CPI con las seeds del PDA al cerrar la
  partida.
- Las cartas conservadas por cada superviviente se le devuelven en cuanto
  sobrevive su ronda (no esperan al final).
- **Timeout:** quien no completa su tirada en la ventana de la ronda queda
  **auto-eliminado**; si tiene carta en el escrow, queda en el bote. Si en una
  ronda nadie más cumple, el patrón `claim_timeout` cierra la partida a favor de
  los supervivientes.

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
- Recomendación de producto: ofrecer Battle Royale sobre todo en **tiers baratos**
  para que el coste acumulado sea razonable.

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
