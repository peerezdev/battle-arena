# Las wallets de escrow

Cada partida (Pack Battle o Royale) usa una wallet de escrow: recibe los buy-ins, es la
`altPlayerAddress` de las tiradas y reparte al final. Son wallets de servidor de Privy, y el
backend firma con ellas por `wallet_id`.

## Lo que hay que tener claro antes de tocar nada

**Una wallet de Privy es la misma en todas las cadenas.** Mismo par de claves, misma dirección en
devnet y en mainnet. Lo que cambia por red es lo que tiene **dentro**.

De ahí sale la separación en dos piezas:

| | Dónde vive | Qué guarda |
|---|---|---|
| **Identidad** | `escrow_inventory` — base **compartida** | dirección + `wallet_id` de Privy |
| **Estado** | `escrow_wallets` — base de **cada red** | libre / en uso / retenida, `battle_id`, `times_used` |

Por eso la misma wallet puede estar **ocupada en devnet y libre en mainnet** a la vez sin que sea
un error: describen cadenas distintas.

Antes de partirlo, el pool mezclaba las dos cosas en la base de cada red, con dos consecuencias:
mainnet arrancaba vacío y creaba wallets nuevas teniendo 79 ya hechas sin estrenar, y la única
lista de cuáles son escrows vivía en la base de **devnet** — una base de pruebas de la que
dependía producción.

## Cómo se pide una wallet

`escrow_pool.adquirir()`, por orden de preferencia:

1. Una **libre del pool de esta red** (`status = "free"`).
2. Una **del inventario compartido que esta red no haya estrenado** nunca.
3. Solo entonces, **una nueva en Privy** — que además se da de alta en el inventario, para que la
   red que la estrena no se la quede.

## Estados

- **`free`** — vacía y disponible.
- **`in_use`** — atada a una partida.
- **`retained`** — al terminar la partida se comprobó que **todavía tiene algo** (USDC o cartas) y
  no se devuelve al pool. Es una señal de que algo quedó sin repartir, no un estado normal. En
  devnet hay 15 así.

`liberar()` mira la cadena antes de marcar `free`: nunca se devuelve al pool por lo que diga la
base, sino por lo que tenga la wallet.

## Configuración

```
ESCROW_INVENTORY_URL=sqlite:////ruta/absoluta/escrow_inventory.db
```

**Vacío = apagado**, y todo se comporta como antes. Solo cuando se configura entra el paso 2.

**La ruta tiene que ser ABSOLUTA** — cuatro barras, `sqlite:////`. Es el mismo fallo que motivó
`scripts/_destino.py`: una ruta relativa de SQLite se resuelve contra el directorio de trabajo, así
que el backend y un script lanzado desde otro sitio escribirían en inventarios distintos sin dar
ningún error. Y aquí el daño es peor que en un script: **dos inventarios divergentes reparten la
misma wallet a dos partidas**.

## Cargar el inventario la primera vez

```bash
cd backend
PYTHONPATH=. .venv/bin/python3 scripts/seed_escrow_inventory.py --desde sqlite:///battlearena.db
PYTHONPATH=. .venv/bin/python3 scripts/seed_escrow_inventory.py --desde sqlite:///battlearena.db --go
```

Dry-run por defecto, idempotente, y **no habla con Privy: no crea ninguna wallet**. Copia solo la
identidad; el estado se queda en cada red.

Comprobado que las 79 de devnet están **completamente limpias en mainnet** (0 SOL, 0 cuentas de
token, 0 transacciones), así que estrenarlas ahí no arrastra nada.

Pendiente: dar de alta las **5 de mainnet anteriores al pool**.

## Lo que NO se comparte

Los **barridos de recuperación nunca se juntan**. `recover_escrow_usdc.py` y
`sweep_stranded_cards.py` van cada uno contra su red: base distinta, RPC distinto, y
`_destino.anunciar` diciendo en voz alta contra qué se va a escribir. Compartir la identidad de las
wallets no toca eso.

## Puntos del gacha varados

Las tiradas de batalla acumulan los puntos de CC en el escrow, no en el jugador, porque el escrow
es la `altPlayerAddress`. En devnet hay 3.069.133 puntos gastables repartidos en 57 escrows, y solo
6 llegan al mínimo de una tirada gratis. No hay forma de moverlos: el endpoint de transferencia
devuelve 401. El detalle está en [COLLECTOR-CRYPT-API.md](COLLECTOR-CRYPT-API.md).
