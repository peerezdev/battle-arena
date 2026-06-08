# Fase 1 (ciclo 4) — Frontend on-chain + wallet (WalletConnect / Reown AppKit)

**Fecha:** 2026-06-07
**Estado:** Diseño aprobado, listo para plan de implementación
**Alcance:** Cablear la app web (Vite/React ya pulida) a la cadena: conexión de wallet (Reown AppKit + adapter de Solana), un **SDK on-chain** que construye todas las transacciones del programa, y las pantallas de **colección, lobby y batalla on-chain** sobre devnet. Se mantiene el modo "Práctica (offline)" actual.

## Objetivo

Que un jugador conecte su wallet, vea su colección de NFTs de Collector Crypt con su valor del oráculo, cree/encuentre partidas en el lobby (con diferencia de ELO) y juegue una **batalla real en devnet** (initialize/join con atestación del oráculo → commit/reveal → resolve → settle), todo desde la UI ya construida.

## Decisiones aprobadas

1. **Wallet = Reown AppKit + `@reown/appkit-adapter-solana`** (el producto WalletConnect moderno: modal con QR/deep-link, soporta Solana). Env `VITE_REOWN_PROJECT_ID`.
2. **Red = devnet.** Program ID `89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk`. **Envío de tx desde el cliente** (el RPC de devnet acepta `sendTransaction`; en mainnet se migraría a broadcast server-side como en MarketAgg).
3. **Se mantiene el modo "Práctica (offline)"** (motor mock actual) junto al nuevo modo "On-chain (devnet)".
4. **Verificación dividida (honesta):** el **SDK** se testea por completo (unit, offline); el **flujo real wallet+devnet** lo verifica el humano con un checklist (no se puede automatizar la firma del navegador aquí).

## No-objetivos (este ciclo / futuro)

- Broadcast server-side de transacciones (solo para mainnet; en devnet se envía desde el cliente).
- Despliegue del programa a devnet (acción del humano; se documentan los comandos, no se ejecuta aquí).
- Indexer/listener on-chain continuo (el lobby se sincroniza por `POST /matches/{battle}/sync` bajo demanda).
- Validar de verdad los esqueletos (lector de cadena del backend, resolver CC real) — eso ocurre cuando el humano corra contra devnet.
- EVM / cross-chain (Battle Arena es solo Solana).

## Arquitectura

Sobre la app Vite existente (`src/`). Nuevos directorios:

```
src/
  onchain/
    idl/battle_arena.json     # copia commiteada del IDL (regenerada con anchor build)
    types.ts                  # tipos del programa derivados del IDL + constantes (PROGRAM_ID)
    pdas.ts                   # derivación de PDAs (battle, vault)
    attestation.ts            # ensambla la instrucción Ed25519 de la atestación
    instructions.ts           # builders: initializeBattle/joinBattle/commit/reveal/resolveRound/settle/claimTimeout
    oracleClient.ts           # cliente del oráculo (/attest, /pubkey)
    backendClient.ts          # cliente del backend (auth, lobby, sync, compare)
    config.ts                 # env (RPC, programId, oracleUrl, backendUrl)
  wallet/
    AppKitProvider.tsx        # provider Reown AppKit + adapter Solana
    useWallet.ts              # hook: publicKey, connect, signAndSendTransaction
  ui/screens/onchain/
    ConnectScreen.tsx         # conectar wallet
    CollectionScreen.tsx      # NFTs CC + valor del oráculo
    LobbyScreen.tsx           # lista de partidas abiertas + crear/unirse
    OnchainBattleScreen.tsx   # batalla real (reusa componentes de asignación/reveal)
  mode/                       # selector "Práctica (offline)" vs "On-chain (devnet)"
```

### SDK on-chain (lo testeable)

- **`pdas.ts`**: `battlePda(playerA, nonce)` con seeds `[b"battle", player_a, nonce_le]`; `vaultPda(battle)` con `[b"vault", battle]` — idénticas al contrato.
- **`attestation.ts`**: dado `{ message_hex, signature_hex, oracle_pubkey }` del oráculo, construye la **instrucción del programa nativo Ed25519** con índices auto-referenciales (`0xFFFF`) — el mismo layout que `oracle.rs` verifica por introspección. Se usa la lib `@solana/web3.js` (`Ed25519Program.createInstructionWithPublicKey` o ensamblado manual del layout).
- **`instructions.ts`**: builders que devuelven `TransactionInstruction[]` (o una `Transaction`/`VersionedTransaction` lista para firmar). `initialize_battle`/`join_battle` devuelven `[ed25519Ix, programIx]` con `ed25519_ix_index = 0`. Discriminadores y args Borsh vía el IDL (con `@coral-xyz/anchor` `BorshCoder` o `@anchor-lang/core` según compatibilidad — usar el que funcione con el IDL; reportar cuál).
- **`oracleClient.ts`** / **`backendClient.ts`**: `fetch` tipado a los endpoints ya construidos.

### Wallet (Reown AppKit)

- `AppKitProvider` inicializa AppKit con el adapter de Solana, red devnet, `projectId` de env. `useWallet()` expone `publicKey`, `isConnected`, `connect()`, y `signAndSendTransaction(tx)` (firma con la wallet conectada y envía vía la `Connection` de devnet).
- Botón de conexión (modal AppKit) en `ConnectScreen` y en la barra superior.

### Flujo de una batalla on-chain

1. **Conectar** wallet → autenticar contra el backend (nonce → firmar → token) para el lobby.
2. **Crear partida:** elegir carta (de la colección) y apuesta → oráculo `/attest(mint)` → construir `initialize_battle` (+ed25519 ix) → firmar/enviar → `POST /matches { battle_pubkey, min_elo?, max_elo? }`.
3. **Unirse:** en el lobby, elegir una partida `joinable` → `/attest(miMint)` → `join_battle` (+ed25519 ix) → enviar → `POST /matches/{battle}/sync`.
4. **Jugar:** por ronda, la UI de asignación produce la `Allocation`; se calcula `commit_hash` (mismo canónico), se firma/envía `commit`; tras ambos, `reveal`; cualquiera dispara `resolve_round`. Animación de reveal con los datos on-chain.
5. **Settle:** al decidirse, `settle` paga al ganador; `POST /matches/{battle}/sync` actualiza el ELO.

## Estrategia de test

- **SDK (Vitest, offline):**
  - `pdas`: las PDAs derivadas casan con direcciones esperadas (vector fijo) y con las seeds del contrato.
  - `attestation`: la ix Ed25519 construida tiene el layout correcto (num_sigs=1, índices `0xFFFF`, offsets), y su `message` casa con el **vector de equivalencia compartido** (`attestation_vectors.json`) — misma garantía cross-capa que oráculo/contrato.
  - `instructions`: cada builder produce el discriminador correcto (8 bytes = sha256(`global:<nombre>`)) y los args Borsh correctos según el IDL; `initialize/join` incluyen la ed25519 ix en índice 0.
  - `oracleClient`/`backendClient`: HTTP mockeado (msw o fetch mock) — sin red real.
- **React:** `tsc --noEmit` limpio y `npm run build` OK (la verificación visual/funcional del wallet la hace el humano).
- **Checklist de verificación humana (devnet):** desplegar el programa (`anchor deploy --provider.cluster devnet`), arrancar oráculo+backend, fondear la wallet con SOL de devnet, y recorrer conectar→colección→crear→unirse(con 2ª wallet)→jugar→settle, confirmando el ELO en el backend. Se documenta paso a paso en el README.

## Riesgos / notas

- **No verificable end-to-end por mí**: la firma de wallet y devnet requieren al humano. El SDK queda verde; el resto compila y queda con checklist.
- **IDL/coder de Anchor 1.0.2**: el cliente TS (`@coral-xyz/anchor` vs `@anchor-lang/core`) debe casar con el IDL generado; aislar el coder y reportar cuál funciona. Si el `BorshCoder` no encaja, ensamblar discriminador+args a mano (determinista y testeable).
- **Ed25519 ix desde el cliente**: el layout debe casar exactamente con la introspección del contrato (índices `0xFFFF`); anclado por el vector compartido y un test de layout.
- **Despliegue a devnet** pendiente del humano (SOL, claves) — se documenta, no se ejecuta.
- **Esqueletos** (lector de cadena del backend, resolver CC real) se validan cuando el humano corra contra devnet; hasta entonces el backend puede usar `mock` y el oráculo `mock`/`collectorcrypt`.
- **Mainnet**: migrar a broadcast server-side y atar la atestación a la batalla (nonce) antes de fondos reales (ya anotado en riesgos del contrato/oráculo).
