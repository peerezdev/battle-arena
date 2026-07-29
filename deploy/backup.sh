#!/usr/bin/env bash
# Backup de la SQLite de mainnet. Es la contabilidad de dinero real y no hay réplica ni
# migraciones: si se pierde, se pierde quién ganó qué.
#
# Cron (como root):  0 * * * *  /srv/battlearena/deploy/backup.sh >> /var/log/battlearena-backup.log 2>&1
#
# Usa `sqlite3 .backup`, NO cp: copiar el fichero con el backend escribiendo puede dar una
# copia corrupta (transacción a medias). .backup es consistente con la base viva.
set -euo pipefail

DB=/srv/battlearena/backend/battlearena.mainnet.db
LOCAL_DIR=/var/backups/battlearena
KEEP_DAYS=14
# Remoto de rclone (configúralo con `rclone config`, p.ej. Backblaze B2). Vacío = solo local.
RCLONE_REMOTE="${RCLONE_REMOTE:-b2:battlearena-backups}"
# Opcional: URL de healthchecks.io para que te avise si el backup DEJA de correr.
HEALTHCHECK_URL="${HEALTHCHECK_URL:-}"

# Primer deploy en un servidor nuevo: la DB aún no existe. No es un error.
if [ ! -f "$DB" ]; then
	echo "$(date -u +%FT%TZ) sin DB todavía ($DB) — nada que respaldar"
	exit 0
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$LOCAL_DIR/battlearena.mainnet.$STAMP.db"

mkdir -p "$LOCAL_DIR"
sqlite3 "$DB" ".backup '$OUT'"
# Verifica la copia antes de darla por buena: un backup que no abre no es un backup.
sqlite3 "$OUT" "PRAGMA integrity_check;" | grep -qx "ok"
gzip -f "$OUT"

if [ -n "$RCLONE_REMOTE" ]; then
	rclone copy "$OUT.gz" "$RCLONE_REMOTE/" --quiet
fi

# Retención local. El remoto se gestiona con lifecycle rules del bucket (o `rclone delete
# --min-age`), no aquí: si esta máquina se compromete, no quieres que borre el offsite.
find "$LOCAL_DIR" -name 'battlearena.mainnet.*.db.gz' -mtime +$KEEP_DAYS -delete

echo "$(date -u +%FT%TZ) backup ok: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
[ -n "$HEALTHCHECK_URL" ] && curl -fsS -m 10 "$HEALTHCHECK_URL" >/dev/null || true
