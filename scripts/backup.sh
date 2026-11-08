#!/usr/bin/env bash
# Backup de la base de datos de Turno con rotación (conserva los últimos 14).
# Uso: DATABASE_URL=postgresql://... ./scripts/backup.sh [directorio_destino]
set -euo pipefail

DEST="${1:-./backups}"
RETENER=14
mkdir -p "$DEST"

STAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVO="$DEST/turno_$STAMP.sql.gz"

: "${DATABASE_URL:?Debes definir DATABASE_URL}"

# La URL de Prisma trae parámetros (?schema=, ?pgbouncer=) que pg_dump rechaza.
# shellcheck source=scripts/lib-url.sh
source "$(dirname "$0")/lib-url.sh"
URL_PG=$(url_libpq "$DATABASE_URL")

echo "Creando backup en $ARCHIVO ..."
pg_dump "$URL_PG" | gzip > "$ARCHIVO"
echo "OK ($(du -h "$ARCHIVO" | cut -f1))"

# Rotación: elimina los backups más antiguos, conservando los $RETENER más recientes.
ls -1t "$DEST"/turno_*.sql.gz 2>/dev/null | tail -n +$((RETENER + 1)) | xargs -r rm -f
echo "Backups conservados: $(ls -1 "$DEST"/turno_*.sql.gz 2>/dev/null | wc -l)"
