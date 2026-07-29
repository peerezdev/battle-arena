# Despliegue — BattleArena mainnet

Servidor único con root, Debian 12 o Ubuntu 24.04, **en US East**. Cualquier VPS KVM sirve — la
guía no depende del proveedor.

**Requisitos reales:** 2 vCPU y **2 GB de RAM bastan en marcha** (dos uvicorn + Caddy + SQLite
rondan los 500 MB). Los 4 GB que se suelen recomendar son solo por el `npm run build` del
frontend (three.js + Vite). Con 2 GB, **añade 2 GB de swap** antes del primer deploy y el build
pasa igual, solo que más lento:

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

**Por qué US East y no Europa:** el backend habla mucho con servicios que están en EEUU (API de
gacha de Collector Crypt, Helius, RPC de Solana) y confirma transacciones con hasta 20 reintentos
de 1,5 s. Esa latencia pesa más en la experiencia que la del jugador al servidor.

> Hetzner subió los precios de sus localizaciones de EEUU el 15/06/2026 (CPX21 Ashburn: 37,49
> $/mes). Ya no es la opción barata en América; sigue siéndolo en Alemania/Finlandia si aceptas
> la latencia a las APIs.

```
Caddy :443 ──┬─ rutas del backend (Accept ≠ text/html) ──→ 127.0.0.1:9190  backend
             ├─ /ws  (WebSocket)                       ──→ 127.0.0.1:9190
             ├─ /attest /pubkey                        ──→ 127.0.0.1:8787  oráculo
             └─ resto                                  ──→ /srv/battlearena/dist  (SPA)
```

## Reglas que no se pueden romper

1. **Un solo proceso de uvicorn, sin `--workers`.** El backend guarda estado en memoria por
   proceso: rate-limits, el `asyncio.Lock` que serializa los buy-ins, el set de WebSockets y
   tareas de fondo. Dos workers = doble settle de USDC real.
2. **La DB es un fichero y no hay migraciones.** Disco persistente y backups offsite.
3. **`DEV_ENDPOINTS_ENABLED` debe quedar en `false`.** `/pack-battles/{id}/join-bot` mueve USDC
   sin autenticación.
4. **La clave del oráculo no se regenera nunca.** Si cambia, el frontend rechaza todas las
   atestaciones (compara contra `VITE_ORACLE_PUBKEY`, fijado en tiempo de build).

---

# Paso 0 — Servidor y DNS

Antes que nada, porque Caddy necesita que el dominio resuelva para sacar el certificado.

```bash
# 1. Crea el CPX21 en Ashburn con Debian 12 y tu clave SSH. Entra como root.
# 2. Apunta el DNS (Cloudflare, en gris / DNS-only de momento):
#      A     battlearena.tld    -> <IP del servidor>
#      AAAA  battlearena.tld    -> <IPv6 del servidor>
# 3. Comprueba desde tu máquina que resuelve ANTES de seguir:
dig +short battlearena.tld
```

Sistema base:

```bash
apt update && apt upgrade -y
apt install -y git curl ufw sqlite3 python3-venv rclone
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs

ufw allow 22,80,443/tcp && ufw --force enable
adduser --system --group --home /srv/battlearena battlearena
```

Los puertos 9190 y 8787 **no** se abren: solo escuchan en loopback.

Código y entornos virtuales:

```bash
git clone <tu-repo> /srv/battlearena
chown -R battlearena:battlearena /srv/battlearena

sudo -u battlearena python3 -m venv /srv/battlearena/backend/.venv
sudo -u battlearena /srv/battlearena/backend/.venv/bin/pip install -r /srv/battlearena/backend/requirements.txt

sudo -u battlearena python3 -m venv /srv/battlearena/oracle/.venv
sudo -u battlearena /srv/battlearena/oracle/.venv/bin/pip install -r /srv/battlearena/oracle/requirements.txt
```

**Comprobación:** `ls /srv/battlearena/{backend,oracle}/.venv/bin/uvicorn` devuelve las dos rutas.

---

# Paso 1 — Oráculo (`:8787`)

Firma atestaciones ed25519 del valor de cada carta. Va primero porque el frontend se compila
con su pubkey dentro.

### 1.1 Sube la clave (no la generes en el servidor)

`keys.py` autogenera la clave si no existe, y una clave nueva invalida el `VITE_ORACLE_PUBKEY`
de todos los builds. Sube la que ya usas.

```bash
# en el servidor
mkdir -p /var/lib/battlearena
# desde tu máquina
scp oracle/oracle_key.json root@battlearena.tld:/var/lib/battlearena/oracle_key.json
# de vuelta en el servidor
chown -R battlearena:battlearena /var/lib/battlearena
chmod 600 /var/lib/battlearena/oracle_key.json
```

Guarda además una copia **fuera del servidor** (gestor de contraseñas). Si la pierdes, no hay
forma de recuperarla.

> Va en `/var/lib` y no en `/etc` a propósito: `keys.py` hace `chmod 600` en cada carga y
> `ProtectSystem=strict` monta `/etc` en solo lectura → el servicio no arrancaría.

### 1.2 Arranca el servicio

```bash
cp /srv/battlearena/deploy/systemd/battlearena-oracle.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now battlearena-oracle
```

### 1.3 Comprobación

```bash
curl -s 127.0.0.1:8787/health     # {"status":"ok"}
curl -s 127.0.0.1:8787/pubkey     # {"oracle_pubkey":"..."}
```

**Apunta ese pubkey**: tiene que coincidir con el `VITE_ORACLE_PUBKEY` del paso 3. Si no
arranca: `journalctl -u battlearena-oracle -n 50`.

---

# Paso 2 — Backend (`:9190`)

### 2.1 Variables de entorno

`/srv/battlearena/backend/.env` (a mano, gitignored). Copia el de tu máquina y revisa:

```ini
CORS_ORIGINS=["https://battlearena.tld"]
DEV_ENDPOINTS_ENABLED=false
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<key de servidor>
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...          # solo aquí, jamás en el frontend
PRIVY_OPERATOR_WALLET_ID=...
PRIVY_OPERATOR_ADDRESS=...
FEE_WALLET_ADDRESS=...
```

```bash
chown battlearena:battlearena /srv/battlearena/backend/.env
chmod 600 /srv/battlearena/backend/.env
```

`backend/.env.mainnet` **no viene en el repo**: `.gitignore` excluye `.env.*`, así que hay que
crearlo en el servidor. Solo lleva overrides de red (RPC, gacha de CC, mint de USDC), sin
secretos — esos siguen en `.env`. Lo carga `APP_NETWORK=mainnet` por encima de `.env`.

> Si falta, el backend arranca con la configuración de **devnet** sin avisar: misma base, mismo
> gacha. Compruébalo antes del primer despliegue.

> Usa una key de Helius **distinta** de la del frontend: esta es server-side de verdad (no
> lleva prefijo `VITE_`, no viaja al navegador), así que puede tener más cupo.

### 2.2 Arranca el servicio

```bash
cp /srv/battlearena/deploy/systemd/battlearena-backend.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now battlearena-backend
```

La base de datos `battlearena.mainnet.db` se crea sola al arrancar (`init_db`).

### 2.3 Comprobación

```bash
curl -s 127.0.0.1:9190/health                  # {"status":"ok"}
ls -l /srv/battlearena/backend/battlearena.mainnet.db
journalctl -u battlearena-backend -n 30        # sin tracebacks
```

### 2.4 Antes de aceptar dinero real

- **Fondea el wallet del operador** (`PRIVY_OPERATOR_ADDRESS`) con SOL en mainnet: paga el gas y
  la renta de las cuentas de escrow. Sin fondos, las Pack Battle y las Royale se anulan al
  llenarse el lobby.
- **En el dashboard de Privy**, añade `https://battlearena.tld` a los dominios permitidos y deja
  activados los *identity tokens* (User management → Authentication → Advanced), que es lo que
  usa el chat.

---

# Paso 3 — Frontend (build estático)

No es un proceso: se compila y Caddy sirve el resultado.

### 3.1 Variables de entorno

Vite carga `.env` y encima `.env.mainnet` (por `--mode mainnet`). Ambos van en la raíz
`/srv/battlearena/`, a mano, gitignored.

En `.env.mainnet`, lo que cambia respecto a tu máquina:

```ini
VITE_BACKEND_URL=https://battlearena.tld     # NO localhost: mismo origen
VITE_ORACLE_URL=https://battlearena.tld      # /attest y /pubkey los proxya Caddy
```

En `.env`, `VITE_ORACLE_PUBKEY` **debe ser el pubkey que imprimió el paso 1.3**.

> ⚠️ Todo lo que empiece por `VITE_` acaba en el bundle del navegador. La key de Helius del
> frontend es pública de facto: restríngela por dominio en el panel de Helius.

### 3.2 Compila

```bash
sudo -u battlearena -H npm --prefix /srv/battlearena ci
cd /srv/battlearena && sudo -u battlearena -H npm run build -- --mode mainnet
```

### 3.3 Comprobación

```bash
ls /srv/battlearena/dist/index.html
grep -o 'battlearena.tld' /srv/battlearena/dist/assets/*.js | head -1   # el dominio quedó dentro
```

---

# Paso 4 — Caddy (une los tres)

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

cp /srv/battlearena/deploy/Caddyfile /etc/caddy/Caddyfile
# edita el dominio y el email de Let's Encrypt
caddy validate --config /etc/caddy/Caddyfile     # SIEMPRE antes de recargar
systemctl reload caddy
```

### Comprobación (desde tu máquina, no desde el servidor)

```bash
curl -s https://battlearena.tld/health                    # {"status":"ok"}   → backend
curl -s https://battlearena.tld/pubkey                    # {"oracle_pubkey"} → oráculo
curl -s -o /dev/null -w '%{http_code}\n' https://battlearena.tld/    # 200    → SPA
curl -s -H 'Accept: text/html' https://battlearena.tld/leaderboard | head -c 40   # HTML, no JSON
```

Ese último es el que valida el truco del `Accept`: navegar a `/leaderboard` debe servir la app,
y un `fetch` desde la app debe llegar al backend.

---

# Paso 5 — Backups y avisos

```bash
chmod +x /srv/battlearena/deploy/{deploy,backup}.sh
rclone config          # crea el remoto (Backblaze B2 ≈ 1 $/mes, 10 GB gratis)

crontab -e
#   0 * * * * RCLONE_REMOTE=b2:battlearena-backups /srv/battlearena/deploy/backup.sh >> /var/log/battlearena-backup.log 2>&1
```

Comprobación: ejecuta `RCLONE_REMOTE=b2:battlearena-backups /srv/battlearena/deploy/backup.sh`
a mano una vez y confirma que aparece el `.db.gz` en el bucket.

Monitorización externa contra `https://battlearena.tld/health` (healthchecks.io o UptimeRobot):
si el servidor se cae, te tienes que enterar tú antes que tus jugadores.

---

# Paso 6 — Prueba end-to-end antes de abrir

1. Entra con Privy desde el móvil (no solo desde tu portátil).
2. Abre el chat: tiene que conectar por `wss://` sin errores de contenido mixto en la consola.
3. Abre una carta del pool → el modal pide `/attest` al oráculo. Si sale error de atestación, el
   `VITE_ORACLE_PUBKEY` no cuadra con el paso 1.3.
4. Haz una tirada de gacha pequeña con dinero real y comprueba que el NFT llega a la wallet.
5. Solo entonces, abre las batallas.

---

# Día a día

```bash
sudo /srv/battlearena/deploy/deploy.sh          # desplegar master (backup → pull → build → restart → healthcheck)
journalctl -u battlearena-backend -f            # logs del backend
journalctl -u battlearena-oracle -f             # logs del oráculo
systemctl restart battlearena-backend           # reinicio manual
```

Al arrancar, el backend ejecuta `_resume_orphaned_battles`: termina o anula+reembolsa las
batallas que quedaron en `running`, y barre las `voided` con reconciliación pendiente. Un
reinicio no rompe la contabilidad, pero **evita reiniciar con batallas en vuelo** — mira
`/pack-battles` antes de desplegar.

# Si un día necesitas escalar

No añadas réplicas: el código asume un proceso. El orden correcto es (1) Postgres + Alembic,
(2) rate-limits y el `_buyin_lock` a Redis, (3) entonces sí, varias instancias o un PaaS.
