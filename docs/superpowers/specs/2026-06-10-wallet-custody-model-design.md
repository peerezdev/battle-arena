# Modelo de wallet y custodia — Addendum

**Fecha:** 2026-06-10
**Estado:** Aprobado (conversación, 2026-06-10)
**Aplica a:** Gacha, Pack Battle, Battle Royale (juegos de tirada) y Mana Duel.
**Sustituye** la mención previa de "Privy exportable" en
`2026-06-10-gacha-integration-design.md`, `2026-06-10-pack-battle-design.md` y
`2026-06-10-battle-royale-design.md`. **Detalle on-chain pendiente** de validar
con la API key de devnet.

## Embedded wallets (no exportables)

Los tres juegos de tirada (Gacha, Pack Battle, Battle Royale) usan una **wallet
embebida cuya private key el usuario NO puede exportar**. Es el contenedor
transitorio mientras juega.

- **Por qué no exportable:** refuerza el modelo de custodia. Si el usuario no
  puede firmar transacciones arbitrarias ni exportar la clave, **no puede sacar
  el NFT del flujo de escrow** antes de que se resuelva la partida. Convierte el
  "plan B" de Pack Battle/Royale en el plan principal.
- **Fondeo:** depósitos **en Solana** o **cross-chain a Solana** (bridge desde
  otras cadenas). Mecánica del bridge **a detallar en implementación**.

## Disposición de las cartas tras la tirada / partida

Para cada carta que el usuario termina teniendo derecho a recibir:

- **Modo turbo:** **buyback automático** — la carta se vende a CC al instante
  (alineado con `TURBO_MODE_BUYBACK` de la API del Gacha). Sin intervención.
- **Sin turbo:** el usuario **elige por carta**:
  1. **Aceptar buyback** → se vende a CC por USDC.
  2. **Quedársela** → se transfiere fuera de la embedded a una **wallet de
     destino preconfigurada por el usuario** (su wallet propia / vault). Es
     necesario porque la embedded no exporta clave: las cartas conservadas deben
     salir hacia una dirección que el usuario controle.
- El usuario **preconfigura** esa wallet de destino antes de jugar.

## Mana Duel

- Se puede jugar con **wallet externa** (Reown/WalletConnect, el flujo on-chain
  actual) **o** con la **embedded wallet** — para permitir jugar con NFTs que se
  hayan sacado dentro de la embedded sin tener que moverlos primero.

## Pendiente de validar con la API key (sin cambios respecto a los specs)

- Entrega de la tirada al PDA de escrow (`altRecipient`).
- Transferibilidad de los NFTs del Gacha.
- Mecánica concreta del bridge cross-chain → Solana para el fondeo.
