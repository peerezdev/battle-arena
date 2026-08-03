#!/usr/bin/env bash
# Despliega la versión actual de master en el servidor. Ejecútalo COMO ROOT en la máquina:
#
#   sudo /srv/battlearena/deploy/deploy.sh
#
# Hace: backup de la DB → git pull → deps → build del frontend (mode mainnet) → swap
# atómico de dist/ → reinicio de servicios → healthcheck. Si el healthcheck falla, sale
# con código 1 (pero NO hace rollback automático: revísalo a mano, hay dinero en juego).
set -euo pipefail

ROOT=/srv/battlearena
USER=battlearena
# Sin valor por defecto: uno inventado (battlearena.tld) hacía que el healthcheck consultara un
# dominio ajeno y diera "Deploy OK" sin haber comprobado nada de esta instalación.
DOMAIN="${DOMAIN:?Falta DOMAIN=tu-dominio.tld en el entorno}"

# -H fija HOME al del usuario del servicio: sin él npm intenta escribir su caché en el
# home de root y falla.
run() { sudo -u "$USER" -H "$@"; }

echo "==> Backup de la DB antes de tocar nada"
"$ROOT/deploy/backup.sh"

echo "==> git pull"
run git -C "$ROOT" pull --ff-only

echo "==> Dependencias de Python"
run "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
run "$ROOT/oracle/.venv/bin/pip" install -q -r "$ROOT/oracle/requirements.txt"

echo "==> Dependencias de Node"
run npm --prefix "$ROOT" ci

echo "==> Build del frontend (mode mainnet)"
# A dist.new y luego swap: mientras compila, Caddy sigue sirviendo la versión anterior
# entera en vez de un dist/ a medio escribir.
run rm -rf "$ROOT/dist.new"
( cd "$ROOT" && run npm run build -- --mode mainnet --outDir dist.new --emptyOutDir )
run rm -rf "$ROOT/dist.old"
if [ -d "$ROOT/dist" ]; then
	run mv "$ROOT/dist" "$ROOT/dist.old"
fi
run mv "$ROOT/dist.new" "$ROOT/dist"

echo "==> Reiniciando servicios"
# El oráculo primero: si su clave cambiara, el frontend rechazaría las atestaciones.
systemctl restart battlearena-oracle
systemctl restart battlearena-backend
systemctl reload caddy

echo "==> Healthcheck"
sleep 3
ok=1
curl -fsS "https://$DOMAIN/health" >/dev/null || { echo "  FALLO: backend /health"; ok=0; }
curl -fsS "http://127.0.0.1:8787/health" >/dev/null || { echo "  FALLO: oráculo /health"; ok=0; }
curl -fsS "https://$DOMAIN/pubkey" >/dev/null || { echo "  FALLO: /pubkey vía Caddy"; ok=0; }

if [ "$ok" = 1 ]; then
	echo "==> Deploy OK"
	# Recordatorio: si /pubkey cambió, VITE_ORACLE_PUBKEY del .env del frontend ya no
	# cuadra y hay que rebuildear. Compáralo cuando toques el oráculo.
	echo "    oracle pubkey: $(curl -fsS "https://$DOMAIN/pubkey")"
else
	echo "==> Deploy CON ERRORES — revisa: journalctl -u battlearena-backend -n 100"
	exit 1
fi
