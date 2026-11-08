#!/usr/bin/env bash
# Ensayo de restauración: comprueba que el backup sirve DE VERDAD.
#
# Uso:
#   DATABASE_URL=postgresql://... ./scripts/verificar-backup.sh [archivo.sql.gz]
#
# Sin argumento usa el backup más reciente de ./backups. Si no hay ninguno, lo
# crea primero.
#
# Qué hace:
#   1. Crea una base temporal (turno_restore_<fecha>).
#   2. Restaura el backup en ella.
#   3. Cuenta las filas de las tablas que importan y comprueba que el esquema
#      está completo (todas las migraciones aplicadas).
#   4. Borra la base temporal.
#
# Esto es lo que convierte "tengo backups" en "puedo recuperarme". Conviene
# ejecutarlo al menos una vez al mes (o en un cron, junto al propio backup).
set -euo pipefail

: "${DATABASE_URL:?Debes definir DATABASE_URL (la base de ORIGEN)}"

DIR_BACKUPS="${DIR_BACKUPS:-./backups}"
ARCHIVO="${1:-}"

if [ -z "$ARCHIVO" ]; then
  ARCHIVO=$(ls -1t "$DIR_BACKUPS"/turno_*.sql.gz 2>/dev/null | head -1 || true)
  if [ -z "$ARCHIVO" ]; then
    echo "No hay backups en $DIR_BACKUPS: creando uno ahora..."
    "$(dirname "$0")/backup.sh" "$DIR_BACKUPS"
    ARCHIVO=$(ls -1t "$DIR_BACKUPS"/turno_*.sql.gz | head -1)
  fi
fi

echo "=== Ensayo de restauración ==="
echo "Backup:  $ARCHIVO ($(du -h "$ARCHIVO" | cut -f1))"

# shellcheck source=scripts/lib-url.sh
source "$(dirname "$0")/lib-url.sh"

# La URL de la base temporal se construye cambiando SOLO el nombre de la base,
# y pasando por url_libpq para quitar los parámetros propios de Prisma.
BASE_TMP="turno_restore_$(date +%Y%m%d%H%M%S)"
URL_TMP=$(url_libpq "$(url_con_base "$DATABASE_URL" "$BASE_TMP")")
# `postgres` es la base de mantenimiento: desde ahí se crean y borran otras.
URL_ADMIN=$(url_libpq "$(url_con_base "$DATABASE_URL" postgres)")

limpiar() {
  echo "Eliminando la base temporal $BASE_TMP ..."
  psql "$URL_ADMIN" --quiet -c "DROP DATABASE IF EXISTS \"$BASE_TMP\";" >/dev/null 2>&1 || true
}
# Se borra incluso si el ensayo falla a mitad: no se dejan bases colgando.
trap limpiar EXIT

echo "Creando base temporal $BASE_TMP ..."
psql "$URL_ADMIN" --quiet -c "CREATE DATABASE \"$BASE_TMP\";"

echo "Restaurando..."
gunzip -c "$ARCHIVO" | psql "$URL_TMP" --quiet -o /dev/null --single-transaction -v ON_ERROR_STOP=1

echo ""
echo "--- Comprobaciones sobre la base restaurada ---"

# 1. Tablas imprescindibles. Si falta una, el backup no sirve para arrancar.
TABLAS=(usuarios negocios servicios reservaciones disponibilidades resenas
        webhook_eventos lista_espera bonos_cliente paquetes codigos_recuperacion)
fallos=0
for t in "${TABLAS[@]}"; do
  n=$(psql "$URL_TMP" -tAc "SELECT count(*) FROM \"$t\";" 2>/dev/null || echo "ERROR")
  if [ "$n" = "ERROR" ]; then
    echo "  ❌ falta la tabla $t"
    fallos=$((fallos + 1))
  else
    printf '  ✅ %-22s %s filas\n' "$t" "$n"
  fi
done

# 2. Migraciones: el historial de Prisma tiene que estar y sin fallos.
pendientes=$(psql "$URL_TMP" -tAc \
  "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL;" 2>/dev/null || echo "ERROR")
aplicadas=$(psql "$URL_TMP" -tAc "SELECT count(*) FROM _prisma_migrations;" 2>/dev/null || echo "0")
if [ "$pendientes" = "ERROR" ]; then
  echo "  ❌ no hay historial de migraciones (_prisma_migrations)"
  fallos=$((fallos + 1))
else
  echo "  ✅ migraciones aplicadas: $aplicadas (sin terminar: $pendientes)"
  [ "$pendientes" != "0" ] && fallos=$((fallos + 1))
fi

# 3. El índice que impide la doble reserva: es lógica de negocio en el esquema.
idx=$(psql "$URL_TMP" -tAc \
  "SELECT count(*) FROM pg_indexes WHERE indexname = 'reservaciones_slot_confirmado_unico';" 2>/dev/null || echo 0)
if [ "$idx" = "1" ]; then
  echo "  ✅ índice anti doble reserva presente"
else
  echo "  ❌ falta el índice reservaciones_slot_confirmado_unico"
  fallos=$((fallos + 1))
fi

echo ""
if [ "$fallos" -eq 0 ]; then
  echo "✅ ENSAYO CORRECTO: el backup se restaura y la base queda completa."
else
  echo "❌ ENSAYO FALLIDO: $fallos problema(s). Revisa el backup antes de confiar en él."
  exit 1
fi
