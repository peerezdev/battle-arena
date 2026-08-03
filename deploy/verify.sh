#!/usr/bin/env bash
# Comprobación de extremo a extremo antes de abrir al público. Caza los fallos que en este
# proyecto no dan la cara hasta que ya hay dinero de por medio.
#
#   DOMAIN=battlearena.tld sudo /srv/battlearena/deploy/verify.sh
#
# Sale 1 si algo falla. Sin `set -e`: queremos ejecutar TODAS las comprobaciones.

ROOT=/srv/battlearena
DOMAIN="${DOMAIN:-}"
OK=0; BAD=0

pass() { printf '  \033[32mOK\033[0m   %s\n' "$1"; OK=$((OK+1)); }
fail() { printf '  \033[31mFALLA\033[0m %s\n' "$1"; BAD=$((BAD+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }
val() { grep -E "^$2=" "$1" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"'"'"' '; }

head_ "Secretos y permisos"
for f in "$ROOT/backend/.env" "$ROOT/.env"; do
	if [ -f "$f" ]; then
		[ "$(stat -c '%a' "$f")" = "600" ] && pass "$f en 600" || fail "$f debería ser chmod 600 (es $(stat -c '%a' "$f"))"
	else
		fail "falta $f"
	fi
done
KEY=/var/lib/battlearena/oracle_key.json
if [ -f "$KEY" ]; then
	pass "clave del oráculo presente"
	[ "$(stat -c '%U' "$KEY")" = "battlearena" ] || fail "$KEY debe pertenecer a battlearena (keys.py hace chmod en cada carga)"
else
	fail "falta $KEY — el oráculo generaría una nueva e invalidaría VITE_ORACLE_PUBKEY"
fi

head_ "Configuración peligrosa"
DEV=$(val "$ROOT/backend/.env" DEV_ENDPOINTS_ENABLED)
[ "${DEV:-false}" = "false" ] && pass "DEV_ENDPOINTS_ENABLED desactivado" \
	|| fail "DEV_ENDPOINTS_ENABLED=$DEV → /pack-battles/{id}/join-bot mueve USDC SIN autenticación"
CORS=$(val "$ROOT/backend/.env" CORS_ORIGINS)
case "$CORS" in *https://*) pass "CORS_ORIGINS con https";; *) fail "CORS_ORIGINS no apunta a https (es: $CORS)";; esac
OP=$(val "$ROOT/backend/.env" PRIVY_OPERATOR_ADDRESS)
[ -n "$OP" ] && pass "wallet del operador configurado" \
	|| fail "PRIVY_OPERATOR_ADDRESS vacío → las batallas se anulan al llenarse el lobby"

head_ "Frontend compilado"
if [ -f "$ROOT/dist/index.html" ]; then
	pass "dist/ existe"
	for v in VITE_BACKEND_URL VITE_ORACLE_URL; do
		u=$(val "$ROOT/.env.mainnet" "$v"); [ -n "$u" ] || u=$(val "$ROOT/.env" "$v")
		case "$u" in
			https://*) pass "$v = $u";;
			*localhost*|"") fail "$v apunta a '$u' — en producción debe ser https://tu-dominio";;
			*) fail "$v sospechoso: $u";;
		esac
	done
else
	fail "falta $ROOT/dist — ejecuta deploy.sh"
fi

head_ "Servicios"
for s in battlearena-oracle battlearena-backend caddy cloudflared; do
	systemctl is-active --quiet "$s" && pass "$s activo" || fail "$s no está activo (journalctl -u $s -n 50)"
done
# Un solo worker: dos procesos = doble settle de USDC real.
N=$(pgrep -fc "uvicorn app.main:app --host 127.0.0.1 --port 9190")
[ "${N:-0}" -le 1 ] && pass "backend con un único proceso" || fail "hay $N procesos de backend: riesgo de doble liquidación"

head_ "Salud local"
curl -fsS --max-time 5 127.0.0.1:9190/health >/dev/null 2>&1 && pass "backend /health" || fail "backend no responde en :9190"
curl -fsS --max-time 5 127.0.0.1:8787/health >/dev/null 2>&1 && pass "oráculo /health" || fail "oráculo no responde en :8787"

head_ "Coherencia del oráculo"
PUB=$(curl -fsS --max-time 5 127.0.0.1:8787/pubkey 2>/dev/null | jq -r '.oracle_pubkey' 2>/dev/null)
CFG=$(val "$ROOT/.env" VITE_ORACLE_PUBKEY)
if [ -n "$PUB" ] && [ -n "$CFG" ]; then
	[ "$PUB" = "$CFG" ] && pass "VITE_ORACLE_PUBKEY coincide con el oráculo" \
		|| fail "descuadre: oráculo=$PUB pero VITE_ORACLE_PUBKEY=$CFG → el frontend rechazará TODA atestación"
else
	fail "no se pudo comparar el pubkey (oráculo='$PUB', .env='$CFG')"
fi

head_ "Base de datos y backups"
DB="$ROOT/backend/battlearena.mainnet.db"
[ -f "$DB" ] && pass "DB de mainnet presente ($(du -h "$DB" | cut -f1))" || fail "no existe $DB"
[ -w "$ROOT/backend" ] && pass "directorio de la DB escribible" || fail "$ROOT/backend no escribible por el servicio"
crontab -l 2>/dev/null | grep -q backup.sh && pass "backup en cron" || fail "sin cron de backup — la DB es la contabilidad"
command -v rclone >/dev/null && rclone listremotes 2>/dev/null | grep -q . \
	&& pass "rclone con remoto configurado" || fail "rclone sin remoto: no hay copia offsite"

if [ -n "$DOMAIN" ]; then
	head_ "Público (a través del túnel)"
	curl -fsS --max-time 10 "https://$DOMAIN/health" >/dev/null 2>&1 && pass "https://$DOMAIN/health" || fail "el backend no llega por el túnel"
	curl -fsS --max-time 10 "https://$DOMAIN/pubkey" >/dev/null 2>&1 && pass "https://$DOMAIN/pubkey" || fail "el oráculo no llega por el túnel"
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/")
	[ "$code" = "200" ] && pass "la SPA responde 200" || fail "la SPA devuelve $code"
	# El truco del Accept: navegar a /leaderboard debe dar HTML, no el JSON del backend.
	body=$(curl -s --max-time 10 -H 'Accept: text/html' "https://$DOMAIN/leaderboard" | head -c 200)
	case "$body" in *"<!doctype"*|*"<!DOCTYPE"*|*"<html"*) pass "/leaderboard sirve la app (matcher de Accept)";;
		*) fail "/leaderboard devuelve algo que no es HTML: la colisión SPA/backend está mal";; esac
	# El vídeo del demo vive FUERA del repo (/srv/battlearena/media), así que ningún test del
	# build puede comprobar que existe: si falta, el botón "Watch demo" abre un modal en negro
	# y nadie se entera. Un HTML aquí significa que /media cayó en el catch-all de la SPA.
	tipo=$(curl -s -o /dev/null -w '%{content_type}' --max-time 15 "https://$DOMAIN/media/battleroyale-demo.mp4")
	case "$tipo" in video/*) pass "el vídeo del demo se sirve ($tipo)";;
		*) fail "el vídeo del demo no se sirve: devuelve '$tipo'";; esac
else
	head_ "Público"
	echo "  (omitido: pasa DOMAIN=tu-dominio para comprobarlo)"
fi

printf '\n\033[1m%s correctas, %s fallos\033[0m\n' "$OK" "$BAD"
[ "$BAD" -eq 0 ] || { echo "NO abras al público hasta que esté todo en verde."; exit 1; }
echo "Todo listo. Haz aun así la prueba manual: login, chat por wss, una carta del pool y una tirada pequeña."
