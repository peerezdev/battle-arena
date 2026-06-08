# Battle Arena — Modo on-chain (devnet)

Guía para correr y verificar el modo **On-chain (devnet)** del frontend: conectar wallet (Reown AppKit / WalletConnect), ver la colección con valores del oráculo, crear/unirse a partidas en el lobby y jugar una batalla real (commit-reveal + settlement) contra el programa Anchor en devnet.

El modo **Práctica (offline)** (motor mock de la Fase 0) sigue disponible sin wallet, para jugar y validar diversión.

> **Estado:** el SDK on-chain está testeado (PDAs, instrucción Ed25519 anclada al vector compartido, builders, clientes). La capa React compila y queda lista, pero el **flujo real wallet+devnet lo verificas tú** con el checklist de abajo — no se puede automatizar la firma del navegador. De paso, este recorrido valida los esqueletos pendientes (lector de cadena del backend, resolver real de Collector Crypt).

## Arquitectura del frontend on-chain

```
src/onchain/   SDK puro (testeado): pdas, attestation (Ed25519), instructions, oracle/backend clients, config, types
src/wallet/    Reown AppKit (Solana devnet) + hook useWallet (publicKey, connect, signAndSendTransaction, signMessage)
src/ui/screens/onchain/   ConnectScreen, CollectionScreen, LobbyScreen, OnchainBattleScreen
src/mode/ModeSelect.tsx    Práctica (offline) | On-chain (devnet)
```

Las transacciones se firman/envían **desde el cliente** (el RPC de devnet acepta `sendTransaction`). En mainnet se migraría a broadcast server-side (como en MarketAgg) y se ataría la atestación a la batalla por nonce.

## Variables de entorno (`.env`)

```
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_PROGRAM_ID=89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk
VITE_ORACLE_URL=http://localhost:8787
VITE_BACKEND_URL=http://localhost:8080
VITE_REOWN_PROJECT_ID=<tu project id de Reown/WalletConnect Cloud>
VITE_STAKE_MINT=<mint SPL de la apuesta; en devnet, un USDC de test que controles>
VITE_TREASURY=<token account SPL del treasury para el rake>
```

## Arrancar los servicios

```bash
# Oráculo (firma atestaciones de valor)
cd oracle && source .venv/bin/activate && PRICING_SOURCE=collectorcrypt uvicorn app.main:app --port 8787

# Backend (ELO + lobby)
cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8080

# Frontend
npm run dev   # http://localhost:5173
```

## Checklist de verificación en devnet (lo haces tú)

1. **Toolchain + fondos:**
   ```bash
   export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
   solana config set --url devnet
   solana airdrop 2          # SOL de devnet para desplegar/firmar
   ```
2. **Desplegar el programa a devnet:**
   ```bash
   cd onchain && anchor build && anchor deploy --provider.cluster devnet
   # confirma que el program id desplegado == VITE_PROGRAM_ID (89qGDjX…ksCdk).
   # si difiere, anchor keys sync + redeploy, y actualiza VITE_PROGRAM_ID.
   ```
3. **Oráculo:** `GET http://localhost:8787/pubkey` → anota el `oracle_pubkey`. Es el que se pasa como `oracle` al crear la batalla (el contrato verifica la firma contra él).
4. **Mint de apuesta de test:** crea un mint SPL en devnet (o usa un USDC de test que controles), mintea saldo a tus dos wallets de prueba, y pon su dirección en `VITE_STAKE_MINT`. Crea el token account del treasury y ponlo en `VITE_TREASURY`.
5. **NFTs:** ten al menos una carta de Collector Crypt (o un mint de test) en cada wallet cuyo `mint` el oráculo pueda valorar (con `insuredValue`). Si el oráculo corre en `mock`, cualquier mint devuelve valor; en `collectorcrypt`, debe ser un NFT real con `insuredValue`.
6. **Jugar (2 wallets):**
   - Wallet A: `npm run dev` → **On-chain (devnet)** → conectar Phantom → autenticar → Colección: pega el mint y "Valorar" → Lobby → **Crear** (apuesta + límites de ELO opcionales) → firma `initialize_battle`.
   - Wallet B: conectar → Lobby → la partida aparece con tu **diferencia de ELO** y `joinable` → **Unirse** → firma `join_battle`.
   - Ambos: por ronda, repartir energía → **Commit** (firma) → **Reveal** (firma) → **Resolver** (cualquiera). Al decidirse, **Settle** paga al ganador.
   - Confirma el ELO actualizado: `GET http://localhost:8080/elo/compare?a=<A>&b=<B>`.

## Qué queda por validar contra datos reales (al correr lo anterior)

- **Lector de cadena del backend** (`SolanaChainSource`): hoy esqueletado; al correr devnet, implementar/validar la decodificación de la cuenta `Battle` para que `sync` derive el resultado real (o, mientras tanto, mantener el backend en `CHAIN_SOURCE=mock` sembrando estados).
- **Resolver real de Collector Crypt** (oráculo): validar el mapeo de campos contra una respuesta real de la API con un mint real.
- **API exacta de Reown AppKit** y el flujo de firma: confirmar conexión, `signMessage` (auth) y `signAndSendTransaction` con Phantom real.

## Antes de mainnet (recordatorio)

- Broadcast de transacciones server-side (el RPC público de mainnet da 403 en `sendTransaction`).
- Atar la atestación del oráculo a la batalla (nonce) para evitar reuso dentro de la ventana de frescura.
- Auditoría del contrato + verificación legal (ya anotado en los riesgos del programa y el oráculo).
