# Frontend on-chain + wallet — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cablear la app Vite/React a la cadena: wallet (Reown AppKit + adapter Solana), un SDK on-chain que construye todas las transacciones del programa, y pantallas de colección/lobby/batalla en devnet, conservando el modo práctica offline.

**Architecture:** Un **SDK on-chain puro** en `src/onchain/` (PDAs, ensamblado de la instrucción Ed25519 de la atestación, builders de instrucciones vía el IDL, clientes oráculo/backend) — totalmente testeable con Vitest, sin wallet ni red. Encima, una capa React con Reown AppKit para conectar la wallet y firmar/enviar, y pantallas que orquestan el flujo. El motor offline de Fase 0 se conserva como modo "Práctica".

**Tech Stack:** Vite + React + TS (existente), `@reown/appkit` + `@reown/appkit-adapter-solana`, `@solana/web3.js`, `@coral-xyz/anchor` (coder/Borsh; fallback a encoding manual), Vitest.

**Datos clave:** Program ID `89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk`; IDL en `onchain/target/idl/battle_arena.json` (instrucciones: claim_timeout, commit, initialize_battle, join_battle, resolve_round, reveal, settle). Vector de equivalencia compartido en `onchain/programs/battle_arena/tests/fixtures/attestation_vectors.json`.

**Acceptance por tipo de tarea:** SDK (Tasks 2–5) = tests Vitest verdes. React (Tasks 6–9) = `npx tsc --noEmit` limpio + `npm run build` OK (el flujo real wallet/devnet lo verifica el humano con el checklist de Task 10). Los 51 tests existentes del motor siguen verdes en todo momento.

---

## File Structure

```
src/
  onchain/
    idl/battle_arena.json     # copia del IDL
    config.ts                 # env: rpc, programId, oracleUrl, backendUrl
    types.ts                  # tipos + PROGRAM_ID + ED25519_PROGRAM_ID + Phase
    pdas.ts                   # battlePda, vaultPda
    attestation.ts            # buildEd25519Ix(message_hex, signature_hex, oracle_pubkey)
    discriminators.ts         # lee discriminadores del IDL
    instructions.ts           # builders de instrucciones del programa
    oracleClient.ts           # /attest, /pubkey
    backendClient.ts          # auth, /matches*, /elo/compare
  wallet/
    AppKitProvider.tsx        # provider Reown AppKit (Solana, devnet)
    useWallet.ts              # publicKey, connect, signAndSendTransaction
  ui/screens/onchain/
    ConnectScreen.tsx, CollectionScreen.tsx, LobbyScreen.tsx, OnchainBattleScreen.tsx
  mode/ModeSelect.tsx         # Práctica (offline) | On-chain (devnet)
  onchain/*.test.ts           # tests del SDK (colocados)
```

**Comandos base** (desde la raíz del repo): `npm run test`, `npx tsc --noEmit`, `npm run build`.

---

## Task 1: Deps + config + copiar IDL

**Files:** `package.json` (deps), `src/onchain/idl/battle_arena.json`, `src/onchain/config.ts`, `src/onchain/types.ts`, `.env.example` (raíz)

- [ ] **Step 1: instalar dependencias**

Run:
```bash
cd /Users/mauro/Desarrollos/BattleArena
npm install @reown/appkit @reown/appkit-adapter-solana @solana/web3.js @coral-xyz/anchor
```
Si alguna versión no resuelve con la toolchain actual, instala la compatible más cercana y repórtalo.

- [ ] **Step 2: copiar el IDL (regenerar si hace falta)**

Run:
```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
cd /Users/mauro/Desarrollos/BattleArena/onchain && anchor build >/dev/null 2>&1 || true
mkdir -p /Users/mauro/Desarrollos/BattleArena/src/onchain/idl
cp /Users/mauro/Desarrollos/BattleArena/onchain/target/idl/battle_arena.json \
   /Users/mauro/Desarrollos/BattleArena/src/onchain/idl/battle_arena.json
```
Verifica que el JSON copiado tiene `address` = `89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk` y la lista de `instructions`.

- [ ] **Step 3: config.ts**

Create `src/onchain/config.ts`:
```ts
export const config = {
  rpcUrl: import.meta.env.VITE_SOLANA_RPC ?? 'https://api.devnet.solana.com',
  programId: import.meta.env.VITE_PROGRAM_ID ?? '89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk',
  oracleUrl: import.meta.env.VITE_ORACLE_URL ?? 'http://localhost:8787',
  backendUrl: import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8080',
  reownProjectId: import.meta.env.VITE_REOWN_PROJECT_ID ?? '',
}
```

- [ ] **Step 4: types.ts**

Create `src/onchain/types.ts`:
```ts
import { PublicKey } from '@solana/web3.js'
import { config } from './config'

export const PROGRAM_ID = new PublicKey(config.programId)
// Programa nativo Ed25519
export const ED25519_PROGRAM_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111')

export type Phase = 'Created' | 'Committing' | 'Revealing' | 'RoundResolved' | 'Settled' | 'Closed'

export interface Allocation { apertura: number; choque: number; remate: number }
export interface MatchConfig {
  roundsToWin: number; baseEnergy: number; maxEdge: number; valueRatioCap: number
  maxRounds: number; rakeBps: number; edgeEnabled: boolean
}
export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  roundsToWin: 2, baseEnergy: 10, maxEdge: 4, valueRatioCap: 4, maxRounds: 5, rakeBps: 0, edgeEnabled: true,
}
```

Add to root `.env.example`:
```
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_PROGRAM_ID=89qGDjXGcV9zi3968DtRLNzBn5KXhYmSGJkjKntksCdk
VITE_ORACLE_URL=http://localhost:8787
VITE_BACKEND_URL=http://localhost:8080
VITE_REOWN_PROJECT_ID=
```

- [ ] **Step 5: verificar compila + commit**

Run: `npx tsc --noEmit && npm run build`
Expected: OK.
```bash
git add package.json package-lock.json src/onchain/idl/battle_arena.json src/onchain/config.ts src/onchain/types.ts .env.example
git commit -m "chore(frontend): deps wallet/anchor + IDL + config on-chain"
```

---

## Task 2: `pdas.ts` (TDD)

**Files:** `src/onchain/pdas.ts`, `src/onchain/pdas.test.ts`

- [ ] **Step 1: test que falla**

Create `src/onchain/pdas.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { battlePda, vaultPda } from './pdas'
import { PROGRAM_ID } from './types'

describe('pdas', () => {
  const playerA = new PublicKey('11111111111111111111111111111111')

  it('battlePda usa seeds [battle, player_a, nonce_le] y casa con findProgramAddress', () => {
    const nonce = 1n
    const [pda] = battlePda(playerA, nonce)
    const nonceBuf = Buffer.alloc(8); nonceBuf.writeBigUInt64LE(nonce)
    const [expected] = PublicKey.findProgramAddressSync(
      [Buffer.from('battle'), playerA.toBuffer(), nonceBuf], PROGRAM_ID,
    )
    expect(pda.equals(expected)).toBe(true)
  })

  it('vaultPda usa seeds [vault, battle]', () => {
    const [battle] = battlePda(playerA, 1n)
    const [vault] = vaultPda(battle)
    const [expected] = PublicKey.findProgramAddressSync([Buffer.from('vault'), battle.toBuffer()], PROGRAM_ID)
    expect(vault.equals(expected)).toBe(true)
  })
})
```

- [ ] **Step 2: verificar que falla** → `npm run test -- pdas` (ImportError/fail).

- [ ] **Step 3: implementar**

Create `src/onchain/pdas.ts`:
```ts
import { PublicKey } from '@solana/web3.js'
import { PROGRAM_ID } from './types'

export function battlePda(playerA: PublicKey, nonce: bigint): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8)
  nonceBuf.writeBigUInt64LE(nonce)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('battle'), playerA.toBuffer(), nonceBuf], PROGRAM_ID,
  )
}

export function vaultPda(battle: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('vault'), battle.toBuffer()], PROGRAM_ID)
}
```

- [ ] **Step 4: verificar que pasa** → `npm run test -- pdas` (2 passed).

- [ ] **Step 5: commit**
```bash
git add src/onchain/pdas.ts src/onchain/pdas.test.ts
git commit -m "feat(onchain-sdk): derivación de PDAs (battle, vault)"
```

---

## Task 3: `attestation.ts` — instrucción Ed25519 (TDD con vector compartido)

**Files:** `src/onchain/attestation.ts`, `src/onchain/attestation.test.ts`

> Construye la instrucción del programa nativo Ed25519 con índices auto-referenciales (`0xFFFF`), layout idéntico al que `oracle.rs` verifica. El `message`/`signature`/`pubkey` vienen del oráculo (hex/base58).

- [ ] **Step 1: test que falla**

Create `src/onchain/attestation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Keypair } from '@solana/web3.js'
import nacl from 'tweetnacl'
import { buildEd25519Ix } from './attestation'
import { ED25519_PROGRAM_ID } from './types'

describe('buildEd25519Ix', () => {
  it('layout: programId ed25519, num_sigs=1, índices 0xFFFF, message embebido', () => {
    const kp = Keypair.generate()
    const message = Buffer.from('hola-atestacion')
    const sig = nacl.sign.detached(message, kp.secretKey)
    const ix = buildEd25519Ix(
      message.toString('hex'),
      Buffer.from(sig).toString('hex'),
      kp.publicKey.toBase58(),
    )
    expect(ix.programId.equals(ED25519_PROGRAM_ID)).toBe(true)
    const d = ix.data
    expect(d[0]).toBe(1) // num signatures
    // header u16 LE: pubkey_offset@6, pubkey_ix_index@8, msg_offset@10, msg_size@12, msg_ix_index@14, sig_ix_index@4
    const u16 = (o: number) => d.readUInt16LE(o)
    expect(u16(4)).toBe(0xffff)  // signature_instruction_index
    expect(u16(8)).toBe(0xffff)  // public_key_instruction_index
    expect(u16(14)).toBe(0xffff) // message_instruction_index
    const pkOff = u16(6), msgOff = u16(10), msgSize = u16(12)
    expect(d.subarray(pkOff, pkOff + 32).equals(Buffer.from(kp.publicKey.toBytes()))).toBe(true)
    expect(d.subarray(msgOff, msgOff + msgSize).equals(message)).toBe(true)
    expect(msgSize).toBe(message.length)
  })
})
```
(Si `tweetnacl` no está, instálalo como devDep: `npm i -D tweetnacl`. O usa `Ed25519Program.createInstructionWithPrivateKey` de web3.js para generar un vector de referencia y comparar el layout.)

- [ ] **Step 2: verificar que falla** → `npm run test -- attestation`.

- [ ] **Step 3: implementar**

Create `src/onchain/attestation.ts`:
```ts
import { PublicKey, TransactionInstruction } from '@solana/web3.js'
import bs58 from 'bs58'
import { ED25519_PROGRAM_ID } from './types'

const U16_MAX = 0xffff
const SIGNATURE_LEN = 64
const PUBKEY_LEN = 32

/** Instrucción del programa nativo Ed25519 para UNA firma, índices auto-referenciales (0xFFFF). */
export function buildEd25519Ix(messageHex: string, signatureHex: string, oraclePubkeyB58: string): TransactionInstruction {
  const message = Buffer.from(messageHex, 'hex')
  const signature = Buffer.from(signatureHex, 'hex')
  const pubkey = Buffer.from(bs58.decode(oraclePubkeyB58))

  const headerLen = 16
  const pubkeyOffset = headerLen
  const sigOffset = pubkeyOffset + PUBKEY_LEN
  const msgOffset = sigOffset + SIGNATURE_LEN

  const data = Buffer.alloc(msgOffset + message.length)
  data.writeUInt8(1, 0)              // num signatures
  data.writeUInt8(0, 1)              // padding
  data.writeUInt16LE(sigOffset, 2)   // signature_offset
  data.writeUInt16LE(U16_MAX, 4)     // signature_instruction_index
  data.writeUInt16LE(pubkeyOffset, 6)// public_key_offset
  data.writeUInt16LE(U16_MAX, 8)     // public_key_instruction_index
  data.writeUInt16LE(msgOffset, 10)  // message_data_offset
  data.writeUInt16LE(message.length, 12) // message_data_size
  data.writeUInt16LE(U16_MAX, 14)    // message_instruction_index

  pubkey.copy(data, pubkeyOffset)
  signature.copy(data, sigOffset)
  message.copy(data, msgOffset)

  return new TransactionInstruction({ programId: ED25519_PROGRAM_ID, keys: [], data })
}
```
(`bs58` viene con `@solana/web3.js`/anchor; si no resuelve el import, usa `import bs58 from 'bs58'` tras `npm i bs58`.)

- [ ] **Step 4: añadir test del vector compartido**

Append to `attestation.test.ts`: lee `../../onchain/programs/battle_arena/tests/fixtures/attestation_vectors.json` (vía `import vectors from '...json'` o `fs`), y verifica que para el primer vector, el `message` embebido en la ix construida (con una firma cualquiera) es exactamente `bytes(message_hex)`:
```ts
import vectors from '../../onchain/programs/battle_arena/tests/fixtures/attestation_vectors.json'
it('el message embebido casa con el vector de equivalencia compartido', () => {
  const v = (vectors as any[])[0]
  const ix = buildEd25519Ix(v.message_hex, '00'.repeat(64), '11111111111111111111111111111111')
  const d = ix.data
  const msgOff = d.readUInt16LE(10), msgSize = d.readUInt16LE(12)
  expect(d.subarray(msgOff, msgOff + msgSize).toString('hex')).toBe(v.message_hex)
})
```
(Habilita `resolveJsonModule` en tsconfig si no estaba.)

- [ ] **Step 5: verificar que pasa** → `npm run test -- attestation` (2 passed).

- [ ] **Step 6: commit**
```bash
git add src/onchain/attestation.ts src/onchain/attestation.test.ts package.json package-lock.json
git commit -m "feat(onchain-sdk): instrucción Ed25519 de atestación (índices 0xFFFF) + vector compartido"
```

---

## Task 4: `discriminators.ts` + `instructions.ts` (builders, TDD)

**Files:** `src/onchain/discriminators.ts`, `src/onchain/instructions.ts`, `src/onchain/instructions.test.ts`

> Lee los discriminadores del IDL (el IDL de Anchor 1.0.2 los incluye por instrucción) y construye `TransactionInstruction`s. Para los args, usa el coder de `@coral-xyz/anchor` si carga el IDL; si no, codifica Borsh a mano (números/pubkeys). REPORTA cuál se usó.

- [ ] **Step 1: discriminators.ts**

Create `src/onchain/discriminators.ts`:
```ts
import idl from './idl/battle_arena.json'

type IdlIx = { name: string; discriminator: number[] }

export function discriminator(name: string): Buffer {
  const ix = (idl as any).instructions.find((i: IdlIx) => i.name === name)
  if (!ix || !ix.discriminator) throw new Error(`sin discriminador para ${name}`)
  return Buffer.from(ix.discriminator)
}
```
(Si el IDL NO trae `discriminator`, calcula `sha256("global:" + name).slice(0,8)` con `js-sha256`; instala y úsalo, reportándolo.)

- [ ] **Step 2: test que falla**

Create `src/onchain/instructions.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { discriminator } from './discriminators'
import { buildCommitIx, buildResolveRoundIx } from './instructions'

describe('discriminators', () => {
  it('cada instrucción del IDL tiene discriminador de 8 bytes', () => {
    for (const n of ['initialize_battle', 'join_battle', 'commit', 'reveal', 'resolve_round', 'settle', 'claim_timeout']) {
      expect(discriminator(n).length).toBe(8)
    }
  })
})

describe('instructions (sencillas, sin args complejos)', () => {
  const battle = new PublicKey('11111111111111111111111111111111')
  const player = new PublicKey('11111111111111111111111111111111')

  it('commit: discriminador + 32 bytes de hash', () => {
    const hash = new Uint8Array(32).fill(7)
    const ix = buildCommitIx({ battle, player, commit: hash })
    expect(ix.programId.toBase58()).toMatch(/.+/)
    expect(ix.data.subarray(0, 8).equals(discriminator('commit'))).toBe(true)
    expect(ix.data.length).toBe(8 + 32)
    expect(ix.data.subarray(8).equals(Buffer.from(hash))).toBe(true)
  })

  it('resolve_round: solo discriminador (sin args)', () => {
    const ix = buildResolveRoundIx({ battle })
    expect(ix.data.equals(discriminator('resolve_round'))).toBe(true)
  })
})
```

- [ ] **Step 3: verificar que falla** → `npm run test -- instructions`.

- [ ] **Step 4: implementar `instructions.ts`**

Create `src/onchain/instructions.ts` con builders. Empieza por los simples (commit, resolve_round) que el test cubre, y añade el resto con sus cuentas según el IDL (initialize_battle, join_battle —que devuelven `[ed25519Ix, programIx]`—, reveal, settle, claim_timeout). Para args complejos (MatchConfig, Allocation, salt:string, value/grade/ts) usa el coder de anchor o Borsh manual. Estructura mínima para pasar el test:
```ts
import { PublicKey, TransactionInstruction, SYSVAR_INSTRUCTIONS_PUBKEY } from '@solana/web3.js'
import { PROGRAM_ID } from './types'
import { discriminator } from './discriminators'

export function buildCommitIx(a: { battle: PublicKey; player: PublicKey; commit: Uint8Array }): TransactionInstruction {
  const data = Buffer.concat([discriminator('commit'), Buffer.from(a.commit)])
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: a.player, isSigner: true, isWritable: false },
      { pubkey: a.battle, isSigner: false, isWritable: true },
    ],
    data,
  })
}

export function buildResolveRoundIx(a: { battle: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: a.battle, isSigner: false, isWritable: true }],
    data: discriminator('resolve_round'),
  })
}
```
Luego añade `buildInitializeBattleIxs`, `buildJoinBattleIxs` (devuelven `[buildEd25519Ix(...), programIx]` con `ed25519_ix_index=0` en los args), `buildRevealIx`, `buildSettleIx`, `buildClaimTimeoutIx`, con las cuentas exactas del `#[derive(Accounts)]` de cada instrucción (ver `onchain/programs/battle_arena/src/instructions/*.rs`). Codifica los args según el IDL. Añade tests adicionales para el discriminador+longitud de `reveal` (string salt) y para que initialize/join devuelvan 2 instrucciones con la ed25519 primero. Si el coder de anchor encaja con el IDL, úsalo para los args complejos (más robusto); si no, Borsh manual.

- [ ] **Step 5: verificar que pasa** → `npm run test -- instructions`. Toda la suite: `npm run test` (los 51 del motor + los nuevos del SDK verdes).

- [ ] **Step 6: commit**
```bash
git add src/onchain/discriminators.ts src/onchain/instructions.ts src/onchain/instructions.test.ts
git commit -m "feat(onchain-sdk): builders de instrucciones del programa (vía IDL)"
```

---

## Task 5: `oracleClient.ts` + `backendClient.ts` (TDD, HTTP mockeado)

**Files:** `src/onchain/oracleClient.ts`, `src/onchain/backendClient.ts`, `src/onchain/clients.test.ts`

- [ ] **Step 1: test que falla**

Create `src/onchain/clients.test.ts` mockeando `fetch` (vi.stubGlobal) para:
- `attest(mint)` → llama `${oracleUrl}/attest?mint=` y devuelve `{ value_usd, grade, message_hex, signature_hex, oracle_pubkey, ts }`.
- backend: `getOpenMatches(viewer)` → `GET /matches/open?viewer=`; `registerMatch(token, body)` → `POST /matches` con `Authorization: Bearer`; `syncMatch(battle)` → `POST /matches/{battle}/sync`; `compareElo(a,b)`; auth `getNonce`/`verify`.
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { attest } from './oracleClient'
import { getOpenMatches, registerMatch } from './backendClient'

beforeEach(() => vi.restoreAllMocks())

it('attest llama al endpoint del oráculo', async () => {
  const json = { mint: 'M', value_usd: 1200, grade: 9, grading_company: 'PSA', ts: 1, message_hex: 'aa', signature_hex: 'bb', oracle_pubkey: 'O' }
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => json })
  vi.stubGlobal('fetch', fetchMock)
  const r = await attest('M')
  expect(r.value_usd).toBe(1200)
  expect(fetchMock.mock.calls[0][0]).toContain('/attest?mint=M')
})

it('registerMatch manda Bearer y battle_pubkey', async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ battle_pubkey: 'B', status: 'open' }) })
  vi.stubGlobal('fetch', fetchMock)
  await registerMatch('TOK', { battle_pubkey: 'B', min_elo: null, max_elo: null })
  const opts = fetchMock.mock.calls[0][1]
  expect(opts.headers.Authorization).toBe('Bearer TOK')
})
```

- [ ] **Step 2-4: implementar y pasar.** Create both clients with typed `fetch` wrappers against `config.oracleUrl`/`config.backendUrl`. Throw on `!resp.ok`. Run `npm run test -- clients`.

- [ ] **Step 5: commit**
```bash
git add src/onchain/oracleClient.ts src/onchain/backendClient.ts src/onchain/clients.test.ts
git commit -m "feat(onchain-sdk): clientes de oráculo y backend (HTTP)"
```

---

## Task 6: Wallet — `AppKitProvider` + `useWallet` (build/typecheck)

**Files:** `src/wallet/AppKitProvider.tsx`, `src/wallet/useWallet.ts`

> No es testeable sin navegador/wallet; criterio = `tsc --noEmit` + `npm run build` OK. Sigue la API de la versión instalada de `@reown/appkit` + `@reown/appkit-adapter-solana`.

- [ ] **Step 1: AppKitProvider**

Create `src/wallet/AppKitProvider.tsx`: inicializa AppKit con `SolanaAdapter`, red **devnet** (`solanaDevnet` de `@reown/appkit/networks`), `projectId = config.reownProjectId`, metadata básica. Exporta `<AppKitProvider>` que envuelve a los hijos. Sigue el patrón oficial de AppKit para React/Vite (createAppKit fuera del componente; el provider puede ser un fragmento que asegura la inicialización).

- [ ] **Step 2: useWallet**

Create `src/wallet/useWallet.ts`: hook que usa `useAppKitAccount()` (address/isConnected), `useAppKitProvider('solana')` para obtener el provider de firma, y expone `{ publicKey: PublicKey | null, isConnected, connect(), signAndSendTransaction(tx) }`. `signAndSendTransaction` arma una `Transaction`/`VersionedTransaction`, la firma+envía con el provider de AppKit y una `Connection(config.rpcUrl)`, devuelve la firma. Adapta los nombres exactos a la API instalada.

- [ ] **Step 3: verificar** → `npx tsc --noEmit && npm run build` (OK).

- [ ] **Step 4: commit**
```bash
git add src/wallet/
git commit -m "feat(wallet): Reown AppKit (Solana devnet) + hook useWallet"
```

---

## Task 7: Modo + Conexión + Colección (build/typecheck)

**Files:** `src/mode/ModeSelect.tsx`, `src/ui/screens/onchain/ConnectScreen.tsx`, `src/ui/screens/onchain/CollectionScreen.tsx`, `src/App.tsx` (integrar modo)

- [ ] **Step 1: ModeSelect** — pantalla inicial: "Práctica (offline)" (lleva al flujo actual de Fase 0) | "On-chain (devnet)" (lleva a ConnectScreen). Envuelve la app on-chain en `<AppKitProvider>`.
- [ ] **Step 2: ConnectScreen** — botón de conexión (modal AppKit); cuando `isConnected`, autentica contra el backend (nonce→firmar mensaje→verify→guarda token) y pasa a CollectionScreen.
- [ ] **Step 3: CollectionScreen** — lista los NFTs de la wallet conectada con su valor del oráculo. Para el MVP: obtener los mints de la wallet (DAS/`getTokenAccountsByOwner` vía `Connection`, o un endpoint del backend) y, por cada uno, `attest(mint)` para mostrar valor/grade; manejar cartas sin `insuredValue` (no jugables) con un aviso. (Si el listado de NFTs real es complejo, mostrar un input de mint manual + su atestación como mínimo viable, y dejar el listado automático como TODO documentado.)
- [ ] **Step 4: integrar en App.tsx** sin romper el flujo offline existente. Verificar `tsc --noEmit` + `npm run build` + los 51 tests del motor siguen verdes.
- [ ] **Step 5: commit** `feat(ui): modo práctica/on-chain + conexión de wallet + colección con valores del oráculo`

---

## Task 8: Lobby (build/typecheck)

**Files:** `src/ui/screens/onchain/LobbyScreen.tsx`

- [ ] **Step 1: LobbyScreen** — `getOpenMatches(viewer)` del backend, render con apuesta, ELO del creador, tu `elo_diff`/`gap_label` y `joinable`. Botón **Crear**: elegir carta+apuesta → `attest(mint)` → `buildInitializeBattleIxs(...)` → `signAndSendTransaction` → `registerMatch(token,{battle_pubkey,min_elo,max_elo})`. Botón **Unirse** (solo si `joinable`): `attest(miMint)` → `buildJoinBattleIxs(...)` → enviar → `syncMatch(battle)` → ir a la batalla.
- [ ] **Step 2: verificar** `tsc --noEmit` + `npm run build`. Tests del motor verdes.
- [ ] **Step 3: commit** `feat(ui): lobby on-chain (crear/unirse, diferencia de ELO, joinable)`

---

## Task 9: Batalla on-chain (build/typecheck)

**Files:** `src/ui/screens/onchain/OnchainBattleScreen.tsx`

- [ ] **Step 1: OnchainBattleScreen** — reusa los componentes de asignación (tokens) y reveal ya pulidos, pero dirige la cadena: por ronda, `commit_hash(allocation, salt)` (mismo canónico que el motor; reusar `hashAllocation` del engine) → `buildCommitIx` → enviar; tras ambos commits, `buildRevealIx(allocation, salt)` → enviar; `buildResolveRoundIx` → enviar (cualquiera). Leer el estado de la cuenta `Battle` (vía `Connection.getAccountInfo` + decodificar con el coder/IDL, o un helper) para conocer fase/reveals/ganador y animar. Al decidirse, `buildSettleIx` con las cuentas de tokens → enviar → `syncMatch`. Manejar errores de tx mostrando el mensaje.
- [ ] **Step 2: verificar** `tsc --noEmit` + `npm run build`. Tests del motor verdes.
- [ ] **Step 3: commit** `feat(ui): batalla on-chain (commit/reveal/resolve/settle reales)`

---

## Task 10: README + checklist de verificación humana (devnet)

**Files:** `README.md` (sección on-chain) o `docs/ONCHAIN.md`

- [ ] **Step 1: documentar** cómo correr el modo on-chain: env (`VITE_*`), arrancar oráculo (`uvicorn` en :8787) y backend (:8080), y el **checklist de verificación en devnet**:
  1. `export PATH=...` y `cd onchain && anchor deploy --provider.cluster devnet` (necesita SOL de devnet: `solana airdrop 2 --url devnet`).
  2. Registrar el `oracle_pubkey` (de `GET /pubkey`) como el oráculo esperado (se pasa en `initialize_battle`).
  3. `npm run dev`, conectar Phantom (devnet), ver colección, crear partida.
  4. Con una 2ª wallet, unirse a la partida `joinable`.
  5. Jugar commit/reveal/resolve por rondas; settle; confirmar el ELO actualizado en el backend (`GET /elo/compare`).
- [ ] **Step 2: documentar** explícitamente lo que queda pendiente de validar contra datos reales (lector de cadena del backend, resolver CC real) y la migración a broadcast server-side + binding por-batalla para mainnet.
- [ ] **Step 3: commit** `docs(onchain): guía de modo on-chain + checklist de verificación en devnet`

---

## Self-Review (completado por el autor del plan)

- **Cobertura del spec:** deps+IDL+config (1), PDAs (2), atestación Ed25519 (3), discriminadores+builders (4), clientes oráculo/backend (5), wallet AppKit (6), modo+conexión+colección (7), lobby (8), batalla on-chain (9), README+checklist (10). SDK testeable (2–5); React build-verificado (6–9); verificación humana documentada (10). Modo práctica offline conservado (7). ✔️
- **Placeholders:** los criterios "build/typecheck" en Tasks 6–9 son intencionales (no se puede testear wallet/devnet sin humano), no TODOs; el único TODO explícito y documentado es el listado automático de NFTs en Colección si resulta complejo (con fallback de mint manual). El SDK no tiene placeholders.
- **Consistencia:** `PROGRAM_ID`/`ED25519_PROGRAM_ID` en types.ts; `battlePda`/`vaultPda` con las seeds del contrato; `buildEd25519Ix` con índices 0xFFFF anclado al vector compartido; builders leen discriminadores del IDL; `Allocation`/`MatchConfig` coherentes con el contrato y el motor. La ix Ed25519 va en índice 0 de las tx de initialize/join (`ed25519_ix_index=0`). ✔️
- **Riesgo conocido:** la API exacta de `@reown/appkit` y la compatibilidad del coder de Anchor 1.0.2 con el IDL pueden requerir ajustes; aislados en wallet/ y instructions.ts, con fallback (Borsh manual) documentado. El flujo end-to-end real lo valida el humano.
