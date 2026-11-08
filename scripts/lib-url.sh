#!/usr/bin/env bash
# Convierte una DATABASE_URL de Prisma en una que entiendan pg_dump y psql.
#
# Prisma añade parámetros que son SUYOS, no de PostgreSQL: `schema`,
# `pgbouncer`, `connection_limit`, `pool_timeout`... y pg_dump aborta con
# "parámetro de URI no válido: schema". Es decir: el script de backup fallaba
# con la misma URL con la que funciona la aplicación. Lo detectó el ensayo de
# restauración (verificar-backup.sh).
#
# Uso:
#   source "$(dirname "$0")/lib-url.sh"
#   URL=$(url_libpq "$DATABASE_URL")

# Parámetros que solo entiende Prisma y que hay que quitar.
_PRISMA_ONLY="schema pgbouncer connection_limit pool_timeout statement_cache_size socket_timeout"

url_libpq() {
  local url="$1"
  local base="${url%%\?*}"
  local query=""
  case "$url" in
    *\?*) query="${url#*\?}" ;;
  esac
  [ -z "$query" ] && { printf '%s' "$base"; return; }

  # Se recorre la query partiendo por "&" con expansión de parámetros, sin tocar
  # IFS: cambiar IFS a "&" rompería el split por espacios de la lista de
  # parámetros a descartar (y eso hacía que no se descartara ninguno).
  local conservados="" resto="$query" par clave
  while [ -n "$resto" ]; do
    case "$resto" in
      *\&*) par="${resto%%&*}"; resto="${resto#*&}" ;;
      *)    par="$resto";       resto="" ;;
    esac
    [ -z "$par" ] && continue
    clave="${par%%=*}"
    case " $_PRISMA_ONLY " in
      *" $clave "*) continue ;;
    esac
    if [ -z "$conservados" ]; then conservados="$par"; else conservados="$conservados&$par"; fi
  done

  if [ -n "$conservados" ]; then
    printf '%s?%s' "$base" "$conservados"
  else
    printf '%s' "$base"
  fi
}

# Nombre de la base de datos dentro de la URL (para crear la temporal del ensayo).
url_base_datos() {
  local sin_query="${1%%\?*}"
  printf '%s' "${sin_query##*/}"
}

# Sustituye el nombre de la base conservando el resto de la URL.
url_con_base() {
  local url="$1" nueva="$2"
  local sin_query="${url%%\?*}"
  local query=""
  case "$url" in
    *\?*) query="?${url#*\?}" ;;
  esac
  printf '%s/%s%s' "${sin_query%/*}" "$nueva" "$query"
}
