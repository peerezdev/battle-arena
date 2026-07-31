# BattleArena — Comandos de consola

Todo lo que se puede hacer desde la terminal, agrupado por lo que quieres conseguir.

Para **levantar los servicios**, ver [STARTUP.md](STARTUP.md); aquí no se repite.

---

## Lo que hay que saber antes

**Los scripts del backend se lanzan desde `backend/` y necesitan `PYTHONPATH=.`** — sin eso fallan
con `ModuleNotFoundError: No module named 'app'`. Dos formas, según el script (cada uno la indica en
su cabecera):

```bash
cd backend
PYTHONPATH=. .venv/bin/python3 scripts/machines.py list     # la mayoría
.venv/bin/python3 -m scripts.distribute_bot_usdc            # los de bots
```

**Devnet o mainnet.** Por defecto todo va contra devnet. Anteponiendo `APP_NETWORK=mainnet` se
trabaja contra mainnet: cambia la base (`battlearena.mainnet.db`), el RPC y la API de gacha.

```bash
APP_NETWORK=mainnet PYTHONPATH=. .venv/bin/python3 scripts/machines.py list
```

**Lo que mueve dinero no se ejecuta sin pedirlo.** Todos los scripts que tocan fondos son *dry-run*
por defecto: enseñan lo que harían y no hacen nada. Ojo, **el flag no es el mismo en todos** —
herencia de haberse escrito en momentos distintos:

| Flag | Scripts |
|---|---|
| `--go` | `sweep_stranded_cards`, `recover_escrow_usdc`, `escrow_pool_sync`, `rescue_and_buyback` |
| `--execute` | `distribute_bot_usdc`, `buyback_bot_nfts` |

**Ports en local:** devnet frontend `5173` → backend `9090`; mainnet frontend `5273` → backend
`9190`; oráculo `8787`.

---

## Día a día

Desde la raíz del repo:

```bash
npm run dev            # frontend en :5173 (devnet)
BACKEND_PORT=9190 npm run dev -- --port 5273   # frontend contra el backend de mainnet
npm test               # suite de frontend (vitest)
npm run test:watch     # en modo watch
npx tsc -b             # typecheck REAL del proyecto
npm run lint           # eslint
npm run build          # tsc -b + vite build
```

> **`npx tsc --noEmit` no comprueba nada aquí.** El `tsconfig.json` de la raíz es solo un fichero de
> referencias (`{"files": [], "references": [...]}`). El typecheck de verdad es **`npx tsc -b`**.

Backend:

```bash
cd backend
PYTHONPATH=. .venv/bin/python3 -m pytest -q          # suite completa
PYTHONPATH=. .venv/bin/python3 -m pytest tests/test_settle.py -q
```

---

## Catálogo de gacha

Encender y apagar máquinas **sin reiniciar nada**: el backend lee las apagadas en cada petición y el
frontend repregunta el catálogo cada pocos segundos, así que el cambio se ve solo.

```bash
cd backend
PYTHONPATH=. .venv/bin/python3 scripts/machines.py list
PYTHONPATH=. .venv/bin/python3 scripts/machines.py hide sweet_99 --reason "miniatura rota"
PYTHONPATH=. .venv/bin/python3 scripts/machines.py show sweet_99
```

`list` marca cada máquina como `ok`, `cerrada` (la cerró Collector Crypt) o `APAGADA` (la apagaste
tú). Apagar una la retira del catálogo **y** impide empezar partidas nuevas con ella, en pack battle
y en royale. No toca el histórico: lo ya jugado conserva su nombre y su imagen.

---

## Referidos

Los códigos son curados: se crean solo por CLI, no hay endpoint de admin.

```bash
cd backend
PYTHONPATH=. .venv/bin/python3 scripts/referrals.py add IBAI \
    --name "Ibai" --boost 0.10 --rake-share 0.25 --owner <WALLET>
PYTHONPATH=. .venv/bin/python3 scripts/referrals.py list
```

`--rake-share 0.25` es el 25 % del rake que generan sus referidos, en USDC real. `list` muestra por
código cuántos referidos tiene, cuánto lleva sin cobrar y cuánto ha ganado en total.

---

## Escrows y dinero atascado

Los tres se usan juntos y **en este orden** cuando algo se queda a medias.

### 1. Cartas que no llegaron a su ganador

```bash
cd backend
PYTHONPATH=. .venv/bin/python3 scripts/sweep_stranded_cards.py            # dry-run
PYTHONPATH=. .venv/bin/python3 scripts/sweep_stranded_cards.py --go
PYTHONPATH=. .venv/bin/python3 scripts/sweep_stranded_cards.py --battle <id>   # una sola batalla
```

Recorre las batallas cerradas con ganador, mira on-chain dónde está cada carta y la entrega. El gas
lo pone el operador. Idempotente: se puede repetir.

### 2. USDC que no llegó a nadie

```bash
PYTHONPATH=. .venv/bin/python3 scripts/recover_escrow_usdc.py             # dry-run
PYTHONPATH=. .venv/bin/python3 scripts/recover_escrow_usdc.py --go
```

Al ganador si la partida se liquidó; el buy-in de vuelta a cada jugador si se anuló. **No reparte
cuando el saldo no cuadra** con el buy-in de todos los apuntados: eso significa que alguien ya cobró
y no consta quién, así que lo aparta en vez de adivinar.

### 3. Pool de wallets de escrow

```bash
PYTHONPATH=. .venv/bin/python3 scripts/escrow_pool_sync.py               # dry-run / auditoría
PYTHONPATH=. .venv/bin/python3 scripts/escrow_pool_sync.py --go
```

Clasifica cada wallet como libre, en uso o retenida (con el motivo). Repetirlo es seguro y sirve de
auditoría: reevalúa las retenidas, así que una que se vacíe pasa a libre sola. **Conviene correrlo
después de 1 y 2**, que es cuando las wallets quedan vacías de verdad.

---

## Bots de prueba (solo devnet)

```bash
cd backend
.venv/bin/python3 -m scripts.distribute_bot_usdc            # dry-run
.venv/bin/python3 -m scripts.distribute_bot_usdc --execute  # rellena USDC hasta el objetivo
.venv/bin/python3 -m scripts.buyback_bot_nfts               # dry-run
.venv/bin/python3 -m scripts.buyback_bot_nfts --execute     # vende sus cartas a CC
```

El primero rellena los 10 bots hasta un objetivo de USDC desde el operador; si no puede confirmar el
saldo de un bot **lo salta** en vez de tratarlo como cero, para que un RPC inestable no provoque un
pago de más. El segundo les vende las cartas de vuelta a Collector Crypt.

---

## Chat y demos

```bash
cd backend
PYTHONPATH=. .venv/bin/python3 scripts/demo_chat_events.py --event hit
PYTHONPATH=. .venv/bin/python3 scripts/demo_chat_events.py --event winner --persist
```

Dispara anuncios de ejemplo para iterar el render sin esperar a eventos reales. **Requiere el
backend con `DEV_ENDPOINTS_ENABLED=true`**, que nunca debe estar activo en producción.

Para probar los reveals hay además una página en el frontend: **`/demo`**, fuera de la navegación.

---

## Diagnóstico puntual

Scripts de un solo uso, nacidos de investigaciones concretas. No forman parte de ningún flujo; se
dejan porque documentan cómo se comprobó algo.

| Script | Para qué |
|---|---|
| `verify_pack_pull.py` | Ciclo de una tirada de pack battle en devnet (fase 1) |
| `verify_pack_battle.py` | Ciclo completo de pack battle de 1 jugador en devnet (fase 2) |
| `verify_turbo_pull.py` | Comprobar el auto-buyback de CC en modo turbo |
| `verify_pnft_transfer.py` | Traspaso de un pNFT escrow→ganador |
| `verify_privy_sign.py` | Que el backend firma y envía una transacción Memo |
| `cc_mainnet_pull.py` | Una tirada REAL de gacha en mainnet (`--machine`, `--yes`) |
| `cc_core_transfer.py` | Mover un Metaplex Core de CC entre wallets en mainnet (`--to`, `--back`, `--yes`) |
| `rescue_and_buyback.py` | Rescate puntual con `BATTLE_ID` fijo dentro del fichero — **no es un barrido general**, para eso está `sweep_stranded_cards.py` |

---

## Despliegue

Ver [deploy/README.md](../deploy/README.md). El repo trae `deploy/deploy.sh` y `deploy/backup.sh`.
