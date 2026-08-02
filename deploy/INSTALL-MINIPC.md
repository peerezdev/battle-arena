# Instalación en mini PC — BattleArena mainnet

Documento pensado para seguirlo **con Claude Code en el propio mini PC**. Instala el stack de
mainnet detrás de un Cloudflare Tunnel, sin abrir puertos.

```bash
# En el mini PC, con Debian 12 o Ubuntu 24.04 recién instalado:
sudo apt update && sudo apt install -y git
git clone <URL-DEL-REPO> ~/battlearena-deploy
cd ~/battlearena-deploy
claude
```

Y dile: **«Sigue `deploy/INSTALL-MINIPC.md` para instalar esto. Ve fase por fase y párate en cada
comprobación.»**

---

## Para el agente: reglas que no se pueden romper

1. **Nunca generes la clave del oráculo en esta máquina.** `oracle/app/keys.py` la autogenera si
   no existe; una clave nueva invalida el `VITE_ORACLE_PUBKEY` con el que se compiló el frontend
   y el juego rechaza **todas** las atestaciones. La clave se copia desde la máquina del usuario.
2. **Un solo proceso de uvicorn por servicio, jamás `--workers`.** El backend guarda estado en
   memoria (rate-limits, el `asyncio.Lock` que serializa los buy-ins, el set de WebSockets del
   chat, tareas de fondo). Dos procesos = doble liquidación de USDC real.
3. **`DEV_ENDPOINTS_ENABLED` se queda en `false`.** `/pack-battles/{id}/join-bot` mueve USDC sin
   autenticación.
4. **No inventes valores de `.env`.** Si falta un secreto, **para y pídeselo al usuario**. Un
   valor inventado aquí se traduce en dinero mal enviado, no en un test rojo.
5. **No reinicies el backend con batallas en vuelo.** Comprueba antes
   `sqlite3 backend/battlearena.mainnet.db "select id,status from pack_battles where status='running'"`.
6. **No commitees nada de lo que crees aquí.** Los `.env`, la clave del oráculo y las
   credenciales del túnel están en `.gitignore` por una razón.

## Lo que hay que tener a mano antes de empezar

Pídeselo al usuario de golpe al principio, no de uno en uno:

- [ ] URL del repositorio (con acceso de lectura desde esta máquina)
- [ ] Dominio a usar (p. ej. `battlearena.tld`) y **cuenta de Cloudflare** con ese dominio dado de alta
- [ ] Fichero `oracle_key.json` de la máquina actual
- [ ] Contenido de `backend/.env` (secretos de Privy, RPC de Helius de servidor, wallet del operador, fee wallet)
- [ ] Contenido de `.env` y `.env.mainnet` del frontend
- [ ] Cuenta de Backblaze B2 (o similar) para los backups
- [ ] Confirmación de que el **wallet del operador está fondeado con SOL en mainnet**

---

## Fase 1 — Base del sistema

```bash
sudo REPO_URL=<URL-DEL-REPO> ~/battlearena-deploy/deploy/bootstrap-minipc.sh
```

Instala paquetes, Node 20, Caddy, `cloudflared`, crea el usuario `battlearena`, clona el repo en
`/srv/battlearena`, monta los dos venvs de Python, añade swap si hace falta, deja el Caddyfile de
túnel en su sitio e instala las units de systemd **sin arrancarlas**. Es idempotente.

**Comprobación:** termina imprimiendo un bloque «lo que queda por hacer» y `caddy validate` pasa
sin errores.

## Fase 2 — Clave del oráculo

Desde la **máquina del usuario**, no desde aquí:

```bash
scp oracle/oracle_key.json usuario@mini-pc:/tmp/oracle_key.json
```

Y en el mini PC:

```bash
sudo mv /tmp/oracle_key.json /var/lib/battlearena/oracle_key.json
sudo chown battlearena:battlearena /var/lib/battlearena/oracle_key.json
sudo chmod 600 /var/lib/battlearena/oracle_key.json
```

Va en `/var/lib` y no en `/etc` a propósito: `keys.py` hace `chmod` en cada carga y
`ProtectSystem=strict` monta `/etc` en solo lectura → el servicio no arrancaría.

**Comprobación:** el usuario debe tener una copia de esta clave **fuera de esta máquina** (gestor
de contraseñas). Pregúntaselo explícitamente antes de seguir.

## Fase 3 — Variables de entorno

Tres ficheros, todos a mano, todos `chmod 600` y de `battlearena`:

**`/srv/battlearena/backend/.env`** — copia del actual, revisando:

```ini
CORS_ORIGINS=["https://battlearena.tld"]
DEV_ENDPOINTS_ENABLED=false
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=<key de SERVIDOR>
PRIVY_APP_ID=...
PRIVY_APP_SECRET=...
PRIVY_OPERATOR_WALLET_ID=...
PRIVY_OPERATOR_ADDRESS=...
FEE_WALLET_ADDRESS=...
```

**`/srv/battlearena/.env`** — el del frontend. `VITE_ORACLE_PUBKEY` tiene que ser el de la clave
de la fase 2.

**`/srv/battlearena/.env.mainnet`** — lo que cambia respecto al de desarrollo:

```ini
VITE_BACKEND_URL=https://battlearena.tld
VITE_ORACLE_URL=https://battlearena.tld
```

> Todo lo que empieza por `VITE_` acaba en el bundle del navegador. La key de Helius del frontend
> es pública de facto: que el usuario la restrinja por dominio, y que use otra distinta (sin
> `VITE_`) en el backend.

```bash
sudo chown battlearena:battlearena /srv/battlearena/{.env,.env.mainnet,backend/.env}
sudo chmod 600 /srv/battlearena/{.env,.env.mainnet,backend/.env}
```

## Fase 4 — Túnel de Cloudflare

`cloudflared tunnel login` abre una URL. Si la máquina va sin escritorio, **cópiasela al usuario
para que la abra en su navegador** y autorice el dominio.

```bash
sudo cloudflared tunnel login
sudo cloudflared tunnel create battlearena          # imprime el UUID
sudo cloudflared tunnel route dns battlearena battlearena.tld   # crea el CNAME solo

sudo cp /srv/battlearena/deploy/cloudflared/config.yml.example /etc/cloudflared/config.yml
# edita config.yml: sustituye TUNNEL_ID_AQUI (dos veces) y el hostname
sudo mv /root/.cloudflared/<UUID>.json /etc/cloudflared/
sudo chmod 600 /etc/cloudflared/<UUID>.json

sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

**Comprobación:** `systemctl status cloudflared` en verde y `cloudflared tunnel info battlearena`
muestra una conexión activa.

En el panel de Cloudflare, deja el registro **en modo proxy (nube naranja)** — con túnel es
obligatorio, no opcional.

## Fase 5 — Arrancar y compilar

```bash
sudo systemctl start battlearena-oracle battlearena-backend
sudo /srv/battlearena/deploy/deploy.sh
```

`deploy.sh` hace backup, `git pull`, dependencias, build del frontend en `dist.new` con swap
atómico, reinicia servicios y pasa un healthcheck.

**Comprobación:** imprime `Deploy OK` y el pubkey del oráculo. Ese pubkey debe coincidir con el
`VITE_ORACLE_PUBKEY` de la fase 3 — si no, el frontend rechazará todas las atestaciones.

## Fase 6 — Verificación completa

```bash
DOMAIN=battlearena.tld sudo /srv/battlearena/deploy/verify.sh
```

Comprueba permisos de secretos, `DEV_ENDPOINTS_ENABLED`, CORS, wallet del operador, que solo hay
un proceso de backend, salud local de ambos servicios, que el pubkey del oráculo cuadra con el
compilado, la DB, el cron de backup, el remoto de rclone y, por el túnel, que `/health`,
`/pubkey`, la SPA y el matcher de `Accept` en `/leaderboard` funcionan.

**No sigas hasta que salga todo en verde.**

## Fase 7 — Backups y avisos

```bash
sudo rclone config                     # crea el remoto B2
sudo crontab -e
#   0 * * * * RCLONE_REMOTE=b2:battlearena-backups /srv/battlearena/deploy/backup.sh >> /var/log/battlearena-backup.log 2>&1
```

Lánzalo una vez a mano y confirma con el usuario que el `.db.gz` aparece en el bucket.

Añade monitorización externa (healthchecks.io o UptimeRobot) contra `https://battlearena.tld/health`.
En una máquina en casa esto no es opcional: es la única forma de enterarte de una caída si no
estás delante.

## Fase 8 — Resistencia física

- **BIOS: "Restore on AC power loss" = On.** Sin esto, tras un corte de luz el servicio no vuelve
  hasta que alguien pulse el botón. Recuérdaselo al usuario: hay que reiniciar y entrar a la BIOS.
- **UPS pequeño.** Aunque solo dé 10 minutos, evita el corte sucio con la SQLite escribiendo.
- Si el usuario quiere cifrado de disco, avísale del conflicto: con LUKS la máquina se queda
  esperando la contraseña tras un corte y no vuelve sola. Es una decisión suya, no un descuido.

## Fase 9 — Prueba manual antes de abrir

En este orden, y con el usuario delante:

1. Login con Privy **desde el móvil**, no solo desde el portátil.
2. Chat abierto: debe conectar por `wss://` sin errores de contenido mixto en la consola.
3. Abrir una carta del pool → pide `/attest` al oráculo. Si falla, el pubkey no cuadra.
4. Una tirada de gacha pequeña con dinero real: comprobar que el NFT llega a la wallet.
5. Solo entonces, abrir las batallas.

En el dashboard de Privy tiene que estar `https://battlearena.tld` en dominios permitidos y los
*identity tokens* activados (User management → Authentication → Advanced), que es lo que usa el chat.

---

## Fallos típicos y qué significan

| Síntoma | Causa |
|---|---|
| El frontend rechaza toda atestación | `VITE_ORACLE_PUBKEY` no coincide con `/pubkey`. Rebuild tras corregirlo (no basta reiniciar) |
| `/leaderboard` devuelve JSON al recargar | El matcher `not header Accept *text/html*` del Caddyfile no está bien |
| El oráculo devuelve 429 en cuanto hay gente | Falta `--proxy-headers`: todas las peticiones parecen venir de la misma IP |
| El servicio del oráculo no arranca | La clave está en `/etc`; con `ProtectSystem=strict` el `chmod` de `keys.py` falla |
| Las batallas se anulan al llenarse el lobby | Wallet del operador sin SOL |
| El chat se cae al minuto y medio | Revisa `connectTimeout` en `/etc/cloudflared/config.yml` |
| `npm run build` muere sin mensaje | Sin RAM. `bootstrap-minipc.sh` añade swap solo si detecta menos de 4 GB |

## Día a día

```bash
sudo /srv/battlearena/deploy/deploy.sh    # desplegar la última versión
journalctl -u battlearena-backend -f      # logs del backend
journalctl -u cloudflared -f              # logs del túnel
DOMAIN=battlearena.tld sudo /srv/battlearena/deploy/verify.sh   # tras cualquier cambio gordo
```

Al arrancar, el backend ejecuta `_resume_orphaned_battles`: termina o anula y reembolsa las
batallas que quedaron en `running`. Un reinicio no rompe la contabilidad, pero **mira antes si hay
batallas en vuelo**.
