#!/usr/bin/env bash
# Ejecutado automáticamente por la imagen oficial de Postgres SOLO la
# primera vez que se inicializa el volumen de datos: los scripts .sh en
# /docker-entrypoint-initdb.d/ se ejecutan igual que los .sql, mecanismo
# documentado de la imagen oficial "postgres" de Docker Hub. Si el volumen
# ya tiene datos (p. ej. el `apps-db-data` ya en uso en este entorno), este
# script NO se vuelve a ejecutar — Postgres solo inicializa un volumen
# vacío. Para volver a ejecutarlo hace falta un volumen nuevo (ver
# infra/postgres/README.md, "Verificación aislada").
#
# POSTGRES_DB ya crea la primera base de datos (Payload CMS) antes de que
# esto se ejecute. Este script crea las dos restantes, con sus nombres
# tomados de variables de entorno (POSTGRES_AUTH_DB, POSTGRES_BOOKING_DB) en
# vez de hardcodeados, para mantener la separación lógica exigida en
# Fase 1 (docs/contratos-portal-v1.md): autenticación/sesiones de la web
# (gapssa_auth) y el futuro BookingRequestRecord/PendingGuestIdentity
# (gapssa_booking) — Fase 4. No crea tablas: eso corresponde a las
# migraciones de cada aplicación (Payload gestiona las suyas; auth/booking
# no tienen ORM decidido todavía).
set -euo pipefail

validate_identifier() {
  local value="$1"
  local var_name="$2"

  # Identificador de Postgres sin comillas: letra o guion bajo inicial,
  # luego letras/dígitos/guion bajo. Rechaza cualquier otro carácter —
  # incluidas comillas, espacios o ';' — antes de interpolarlo en SQL.
  if [[ ! "$value" =~ ^[A-Za-z_][A-Za-z0-9_]{0,62}$ ]]; then
    echo "ERROR: $var_name=\"$value\" no es un identificador de base de datos válido." >&2
    exit 1
  fi
}

create_database_if_missing() {
  local db_name="$1"
  local exists

  exists="$(psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --tuples-only --no-align -c "SELECT 1 FROM pg_database WHERE datname = '$db_name'")"

  if [[ "$exists" != "1" ]]; then
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
      -c "CREATE DATABASE \"$db_name\""
    echo "Base de datos \"$db_name\" creada."
  else
    echo "Base de datos \"$db_name\" ya existía; no se toca."
  fi
}

: "${POSTGRES_AUTH_DB:?POSTGRES_AUTH_DB no está definida}"
: "${POSTGRES_BOOKING_DB:?POSTGRES_BOOKING_DB no está definida}"

validate_identifier "$POSTGRES_AUTH_DB" "POSTGRES_AUTH_DB"
validate_identifier "$POSTGRES_BOOKING_DB" "POSTGRES_BOOKING_DB"

create_database_if_missing "$POSTGRES_AUTH_DB"
create_database_if_missing "$POSTGRES_BOOKING_DB"
