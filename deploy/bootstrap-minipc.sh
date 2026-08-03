#!/usr/bin/env bash
# Prepara un mini PC (Debian 12 / Ubuntu 24.04) para servir BattleArena mainnet detrás de
# Cloudflare Tunnel. Idempotente: puedes relanzarlo sin romper nada.
#
#   sudo REPO_URL=git@github.com:tu-usuario/battlearena.git ./bootstrap-minipc.sh
#
# NO arranca los servicios: faltan los .env y las claves, que son manuales por seguridad.
# Al terminar imprime exactamente lo que queda por hacer. Ver deploy/INSTALL-MINIPC.md.
set -euo pipefail

REPO_URL="${REPO_URL:-}"
BRANCH="${BRANCH:-master}"
ROOT=/srv/battlearena
USER=battlearena

[ "$(id -u)" -eq 0 ] || { echo "Ejecútalo como root (sudo)."; exit 1; }
command -v apt-get >/dev/null || { echo "Este script es para Debian/Ubuntu."; exit 1; }

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "Paquetes base"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
	git curl ca-certificates gnupg ufw sqlite3 python3-venv rclone jq acl

say "Node 22"
# Vite 8 exige ^20.19 || >=22.12, así que la 20.x que sirva nodesource se queda al filo:
# fijamos la 22, que es con la que se valida el build. El major se saca con sed y no con
# `cut -c2-3`, que leía "2." en un hipotético v2 y comparaba mal a partir de tres dígitos.
node_major() { node -v 2>/dev/null | sed 's/^v//; s/\..*//'; }
if ! command -v node >/dev/null || [ "$(node_major)" -lt 22 ]; then
	curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
	DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs
fi
node -v

say "Caddy"
if ! command -v caddy >/dev/null; then
	curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
		| gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
	echo "deb [signed-by=/usr/share/keyrings/caddy-stable-archive-keyring.gpg] https://dl.cloudsmith.io/public/caddy/stable/deb/debian any-version main" \
		> /etc/apt/sources.list.d/caddy-stable.list
	apt-get update -qq
	DEBIAN_FRONTEND=noninteractive apt-get install -y -qq caddy
fi

say "cloudflared"
if ! command -v cloudflared >/dev/null; then
	curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
		> /usr/share/keyrings/cloudflare-main.gpg
	echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
		> /etc/apt/sources.list.d/cloudflared.list
	apt-get update -qq
	DEBIAN_FRONTEND=noninteractive apt-get install -y -qq cloudflared
fi

say "Cortafuegos"
# Con túnel NO se abre ni el 80 ni el 443: la máquina no acepta nada de internet.
ufw allow 22/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -5

say "Usuario y directorios"
id -u "$USER" >/dev/null 2>&1 || adduser --system --group --home "$ROOT" "$USER"
mkdir -p /var/lib/battlearena /etc/cloudflared
chown "$USER:$USER" /var/lib/battlearena

say "Código"
if [ -d "$ROOT/.git" ]; then
	sudo -u "$USER" -H git -C "$ROOT" pull --ff-only || echo "  (pull omitido: revisa credenciales de git)"
else
	[ -n "$REPO_URL" ] || { echo "Falta REPO_URL=... en el entorno"; exit 1; }
	# El home del usuario ya existe: clona dentro sin borrarlo.
	# -b master explícito: `git clone` a secas trae la rama por defecto del remoto, que puede
	# ser cualquier otra —y si no lleva deploy/, este script muere en el cp del Caddyfile.
	# Además deploy.sh hace `pull --ff-only` sobre la rama que quede puesta, así que el
	# servidor seguiría esa rama para siempre.
	sudo -u "$USER" -H git clone -b "$BRANCH" "$REPO_URL" "$ROOT/.repo-tmp"
	shopt -s dotglob
	mv "$ROOT/.repo-tmp"/* "$ROOT"/
	shopt -u dotglob
	rmdir "$ROOT/.repo-tmp"
	chown -R "$USER:$USER" "$ROOT"
fi

say "Entornos virtuales de Python"
[ -x "$ROOT/backend/.venv/bin/python" ] || sudo -u "$USER" -H python3 -m venv "$ROOT/backend/.venv"
[ -x "$ROOT/oracle/.venv/bin/python" ] || sudo -u "$USER" -H python3 -m venv "$ROOT/oracle/.venv"
sudo -u "$USER" -H "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
sudo -u "$USER" -H "$ROOT/oracle/.venv/bin/pip" install -q -r "$ROOT/oracle/requirements.txt"

say "Swap (solo si hay menos de 4 GB de RAM)"
RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$RAM_MB" -lt 3800 ] && [ ! -f /swapfile ]; then
	fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
	grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
	echo "  swap de 2 GB añadido (RAM detectada: ${RAM_MB} MB)"
else
	echo "  no hace falta (RAM: ${RAM_MB} MB)"
fi

say "Caddy: configuración de túnel"
cp "$ROOT/deploy/Caddyfile.tunnel" /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
# `apt install caddy` deja el servicio arrancado con SU config por defecto: sin este recargado,
# Caddy sigue sirviendo /usr/share/caddy y la comprobación de esta fase engaña (responde 200,
# pero es la página de bienvenida, no la app).
systemctl reload-or-restart caddy

# Caddy corre como usuario `caddy` y `adduser --system --home` deja $ROOT en 750: sin esto no
# puede ni atravesar el directorio y toda la SPA responde 403. Se concede solo `x` (atravesar),
# no `r`: llega a dist/ —que ya es legible por todos— pero no puede listar $ROOT ni leer la
# SQLite, que es la contabilidad.
setfacl -m u:caddy:x "$ROOT"

say "Servicios systemd (instalados, aún NO arrancados)"
cp "$ROOT/deploy/systemd/"*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable battlearena-oracle battlearena-backend >/dev/null
chmod +x "$ROOT/deploy/"*.sh

cat <<'PENDIENTE'

════════════════════════════════════════════════════════════════════
 Base lista. Lo que queda es manual A PROPÓSITO (claves y secretos):

 1. Clave del oráculo  → /var/lib/battlearena/oracle_key.json
    Cópiala desde tu máquina actual. NO dejes que se autogenere:
    una clave nueva invalida el VITE_ORACLE_PUBKEY de todos los builds.

 2. Variables de entorno (chmod 600, dueño battlearena):
      /srv/battlearena/backend/.env      (secretos de Privy, RPC, fee wallet)
      /srv/battlearena/.env              (frontend: VITE_ORACLE_PUBKEY, etc.)
      /srv/battlearena/.env.mainnet      (VITE_BACKEND_URL / VITE_ORACLE_URL = https://tu-dominio)

 3. Túnel de Cloudflare:
      cloudflared tunnel login
      cloudflared tunnel create battlearena
      cloudflared tunnel route dns battlearena TU-DOMINIO
      cp deploy/cloudflared/config.yml.example /etc/cloudflared/config.yml   (y edítalo)
      cloudflared service install && systemctl enable --now cloudflared

 4. Arranca y compila:
      systemctl start battlearena-oracle battlearena-backend
      sudo /srv/battlearena/deploy/deploy.sh

 5. Comprueba TODO de una vez:
      DOMAIN=tu-dominio /srv/battlearena/deploy/verify.sh

 6. BIOS: activa "Restore on AC power loss" para que vuelva solo tras un corte.
════════════════════════════════════════════════════════════════════
PENDIENTE
