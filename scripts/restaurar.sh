#!/usr/bin/env bash
# Restaura un backup de Turno en una base de datos.
#
# Uso:
#   ./scripts/restaurar.sh backups/turno_20261107_030000.sql.gz "postgresql://..."
#
# Un backup que nunca se ha restaurado no es un backup: es un archivo. Este
# script es la otra mitad de backup.sh, y `verificar-backup.sh` lo usa para
# ensayar la restauración sin tocar la base de producción.
set -euo pipefail

ARCHIVO="${1:?Uso: restaurar.sh <archivo.sql.gz> <DATABASE_URL_destino>}"
DESTINO="${2:?Falta la URL de la base de datos de destino}"

if [ ! -f "$ARCHIVO" ]; then
  echo "❌ No existe el archivo: $ARCHIVO" >&2
  exit 1
fi

# Red de seguridad: restaurar sobre la base de producción borra lo que haya.
# Si la URL no parece de pruebas, se exige confirmación explícita.
if [[ "$DESTINO" != *"test"* && "$DESTINO" != *"restore"* && "$DESTINO" != *"localhost"* ]]; then
  if [ "${CONFIRMO_SOBRESCRIBIR:-}" != "si" ]; then
    echo "⚠️  El destino no parece una base de pruebas:"
    echo "    $DESTINO"
    echo "    Restaurar SOBRESCRIBE los datos actuales."
    echo "    Si es lo que quieres: CONFIRMO_SOBRESCRIBIR=si $0 $*"
    exit 1
  fi
fi

# shellcheck source=scripts/lib-url.sh
source "$(dirname "$0")/lib-url.sh"
DESTINO_PG=$(url_libpq "$DESTINO")

echo "Restaurando $ARCHIVO ..."
# --single-transaction: o entra todo o no entra nada, sin dejar la base a medias.
# -o /dev/null descarta la salida de las consultas del dump (los setval de las
# secuencias), que no aportan nada y tapan los errores de verdad.
gunzip -c "$ARCHIVO" | psql "$DESTINO_PG" --quiet -o /dev/null --single-transaction -v ON_ERROR_STOP=1
echo "✅ Restaurado"
