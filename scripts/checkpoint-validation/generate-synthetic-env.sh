#!/bin/bash
# Genera un `.env` completamente sintético para validar en aislamiento un
# manifiesto de `docs/manifests/checkpoint-v1/` (o cualquier copia temporal
# del monorepo), SIN tocar nunca el `.env` real.
#
# Motivo de existir: docs/incidente-lectura-env-validacion-manifiestos-2026-08-19.md
# — una validación aislada anterior copió `.env` real por inercia. Este
# script sustituye ese procedimiento de forma estructural: es imposible que
# lea `.env` real, porque nunca abre esa ruta, solo `.env.example` (una
# plantilla, siempre versionable) para conocer qué claves existen, y genera
# un valor ficticio y cerrado para cada una — nunca copia ni deriva nada del
# contenido real.
#
# Compatible con /bin/bash 3.2 (macOS de sistema) a propósito, mismo
# criterio que scripts/secrets-rotation/ — sin arrays asociativos, sin
# mapfile/readarray, sin ${var,,}/${var^^}, sin globstar.
#
# Uso:
#   scripts/checkpoint-validation/generate-synthetic-env.sh <directorio-destino>
#
# Escribe <directorio-destino>/.env, en modo 600 desde su creación (nunca
# create+chmod en dos pasos). No imprime ningún valor generado — solo la
# ruta del fichero resultante y un recuento de claves.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_TEMPLATE="$REPO_ROOT/.env.example"
REAL_ENV="$REPO_ROOT/.env"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

if [ "$#" -ne 1 ]; then
  fail "uso: generate-synthetic-env.sh <directorio-destino>"
fi

TARGET_DIR="$1"
[ -d "$TARGET_DIR" ] || fail "el directorio destino no existe: $TARGET_DIR"

# Guarda estructural #1: la plantilla de origen tiene que ser exactamente
# .env.example dentro de este repositorio — nunca un .env real ni ningún
# otro .env* no autorizado, ni siquiera si alguien cambia SOURCE_TEMPLATE
# arriba por error.
SOURCE_BASENAME="$(basename -- "$SOURCE_TEMPLATE")"
case "$SOURCE_BASENAME" in
  *.example) : ;;
  *) fail "la plantilla de origen debe terminar en .example, no: $SOURCE_BASENAME" ;;
esac

# Guarda estructural #2: comprobación de identidad real (inode), no solo de
# nombre — si por cualquier motivo .env.example y .env resolvieran al mismo
# fichero (symlink, bind mount, error de configuración), abortar.
if [ -e "$REAL_ENV" ]; then
  real_env_id="$(stat -f '%d:%i' "$REAL_ENV" 2>/dev/null || stat -c '%d:%i' "$REAL_ENV" 2>/dev/null || echo "")"
  source_id="$(stat -f '%d:%i' "$SOURCE_TEMPLATE" 2>/dev/null || stat -c '%d:%i' "$SOURCE_TEMPLATE" 2>/dev/null || echo "")"
  if [ -n "$real_env_id" ] && [ "$real_env_id" = "$source_id" ]; then
    fail ".env.example resuelve al mismo fichero que .env real — abortando, nunca se lee .env real"
  fi
fi

[ -f "$SOURCE_TEMPLATE" ] || fail "no existe la plantilla: $SOURCE_TEMPLATE"

# Guarda estructural #3: nunca se acepta ni se produce ninguna ruta que
# coincida con el patrón .env* salvo la propia plantilla .env.example de
# origen y el .env sintético de destino (ambos ya fijados arriba, nunca
# parametrizables desde fuera de este script).
TARGET_ENV="$TARGET_DIR/.env"
case "$(basename -- "$TARGET_ENV")" in
  .env) : ;;
  *) fail "ruta de destino inesperada" ;;
esac

# Valor ficticio y cerrado (siempre el mismo, determinista) por clave.
# Ninguno de estos valores procede de un secreto real: son constantes fijas
# de este script, pensadas solo para que typecheck/test/build/seed puedan
# arrancar contra infraestructura efímera local.
synthetic_value_for_key() {
  case "$1" in
    COMPOSE_PROJECT_NAME) echo "gapssa-synthetic" ;;
    ESPOCRM_IMAGE) echo "espocrm/espocrm:10.0.3-apache-trixie" ;;
    ESPOCRM_HTTP_PORT) echo "18081" ;;
    ESPOCRM_WEBSOCKET_PORT) echo "18083" ;;
    ESPOCRM_SITE_URL) echo "http://localhost:18081" ;;
    ESPOCRM_ADMIN_USERNAME) echo "synthetic-admin" ;;
    ESPOCRM_ADMIN_PASSWORD) echo "synthetic-fake-password-not-real-0001" ;;
    ESPOCRM_DB_IMAGE) echo "mariadb:11.4" ;;
    ESPOCRM_DB_NAME) echo "espocrm_synthetic" ;;
    ESPOCRM_DB_USER) echo "espocrm_synthetic" ;;
    ESPOCRM_DB_PASSWORD) echo "synthetic-fake-password-not-real-0002" ;;
    ESPOCRM_DB_ROOT_PASSWORD) echo "synthetic-fake-password-not-real-0003" ;;
    POSTGRES_IMAGE) echo "postgres:18-alpine" ;;
    POSTGRES_HOST_PORT) echo "0" ;;
    POSTGRES_DB) echo "gapssa_cms" ;;
    POSTGRES_USER) echo "gapssa_apps" ;;
    POSTGRES_PASSWORD) echo "synthetic-fake-password-not-real-0004" ;;
    POSTGRES_AUTH_DB) echo "gapssa_auth" ;;
    POSTGRES_BOOKING_DB) echo "gapssa_booking" ;;
    DATABASE_URL_CMS) echo "__SET_BY_CALLER__" ;;
    DATABASE_URL_AUTH) echo "__SET_BY_CALLER__" ;;
    DATABASE_URL_BOOKING) echo "__SET_BY_CALLER__" ;;
    REDIS_IMAGE) echo "redis:8-alpine" ;;
    REDIS_HOST_PORT) echo "0" ;;
    REDIS_PASSWORD) echo "synthetic-fake-password-not-real-0005" ;;
    REDIS_KEY_PREFIX) echo "gapssa:synthetic:" ;;
    REDIS_URL) echo "redis://:synthetic-fake-password-not-real-0005@localhost:0" ;;
    PAYLOAD_SECRET) echo "synthetic-payload-secret-fake-0006-min32c" ;;
    NEXT_PUBLIC_SITE_URL) echo "__SET_BY_CALLER__" ;;
    SITE_NOINDEX) echo "true" ;;
    NEXT_PUBLIC_UMAMI_WEBSITE_ID) echo "" ;;
    NEXT_PUBLIC_UMAMI_SRC) echo "" ;;
    OTP_HMAC_SECRET) echo "synthetic-otp-hmac-secret-fake-0007-min32c" ;;
    AUTH_RATE_LIMIT_HMAC_SECRET) echo "synthetic-rate-limit-hmac-fake-0008-min32c" ;;
    TRUSTED_PROXY_HOP_COUNT) echo "1" ;;
    OTP_TTL_MINUTES) echo "10" ;;
    OTP_MAX_ATTEMPTS) echo "5" ;;
    OTP_LOCKOUT_MINUTES) echo "15" ;;
    OTP_REQUEST_MAX_PER_SUBJECT_PER_HOUR) echo "5" ;;
    OTP_REQUEST_MAX_PER_IP_PER_HOUR) echo "20" ;;
    AUTH_SESSION_ABSOLUTE_TTL_DAYS) echo "30" ;;
    AUTH_PASSWORD_RESET_SESSION_MINUTES) echo "10" ;;
    AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT_PER_HOUR) echo "10" ;;
    AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR) echo "30" ;;
    AUTH_LOGIN_LOCKOUT_MINUTES) echo "15" ;;
    ARGON2_MEMORY_COST_KIB) echo "19456" ;;
    ARGON2_TIME_COST) echo "2" ;;
    ARGON2_PARALLELISM) echo "1" ;;
    SMTP_HOST) echo "" ;;
    SMTP_PORT) echo "587" ;;
    SMTP_SECURE) echo "false" ;;
    SMTP_USER) echo "" ;;
    SMTP_PASSWORD) echo "" ;;
    SMTP_FROM_EMAIL) echo "reservas@gapssa.es" ;;
    BOOKING_FIELD_ENCRYPTION_KEYS) echo '{"v1":"c3ludGhldGljLWZha2Uta2V5LTAwMDktMzJieXRlcyE="}' ;;
    BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION) echo "v1" ;;
    BOOKING_EMAIL_LOOKUP_HMAC_SECRETS) echo '{"v1":"c3ludGhldGljLWZha2Uta2V5LTAwMTAtMzJieXRlcyE="}' ;;
    BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION) echo "v1" ;;
    BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS) echo '{"v1":"c3ludGhldGljLWZha2Uta2V5LTAwMTEtMzJieXRlcyE="}' ;;
    BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION) echo "v1" ;;
    BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS) echo '{"v1":"c3ludGhldGljLWZha2Uta2V5LTAwMTItMzJieXRlcyE="}' ;;
    BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION) echo "v1" ;;
    BOOKING_INTERNAL_API_SECRET) echo "synthetic-internal-api-secret-fake-0013-min32c" ;;
    BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES) echo "30" ;;
    BOOKING_BUSINESS_DAYS) echo "1,2,3,4,5,6" ;;
    BOOKING_OPEN_TIME) echo "09:00" ;;
    BOOKING_CLOSE_TIME) echo "21:00" ;;
    BOOKING_SLOT_GRANULARITY_MINUTES) echo "15" ;;
    BOOKING_MAX_SLOTS_PER_QUERY) echo "40" ;;
    BOOKING_REQUEST_MAX_PER_IP_PER_HOUR) echo "20" ;;
    BOOKING_VERIFY_MAX_PER_IP_PER_HOUR) echo "30" ;;
    BOOKING_AVAILABILITY_MAX_PER_IP_PER_HOUR) echo "120" ;;
    ESPO_BOOKING_ADAPTER) echo "simulated" ;;
    ESPOCRM_API_BASE_URL) echo "http://localhost:18081" ;;
    ESPOCRM_API_KEY) echo "synthetic-espocrm-api-key-fake-0014" ;;
    ESPOCRM_API_TIMEOUT_MS) echo "8000" ;;
    ESPOCRM_API_MAX_RETRIES) echo "2" ;;
    ESPOCRM_API_RETRY_BASE_DELAY_MS) echo "200" ;;
    ESPOCRM_API_MAX_RESPONSE_BYTES) echo "2000000" ;;
    ESPOCRM_PROFESSIONAL_USER_IDS) echo "" ;;
    *) echo "synthetic-generic-value" ;;
  esac
}

# Crea el fichero vacío en modo 600 ANTES de escribir contenido — nunca
# create-por-defecto-y-luego-chmod (misma guarda de scripts/secrets-rotation/lib.sh).
umask 077
: > "$TARGET_ENV"
chmod 600 "$TARGET_ENV"

count=0
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*)
      printf '%s\n' "$line" >> "$TARGET_ENV"
      continue
      ;;
  esac
  key="${line%%=*}"
  case "$key" in
    *[!A-Za-z0-9_]*|'')
      # línea que no tiene forma de CLAVE=... (comentario indentado, etc.)
      printf '%s\n' "$line" >> "$TARGET_ENV"
      continue
      ;;
  esac
  value="$(synthetic_value_for_key "$key")"
  printf '%s=%s\n' "$key" "$value" >> "$TARGET_ENV"
  count=$((count + 1))
done < "$SOURCE_TEMPLATE"

chmod 600 "$TARGET_ENV"

echo "generate-synthetic-env: $count claves sintéticas escritas en $TARGET_ENV (modo 600)"
echo "generate-synthetic-env: DATABASE_URL_CMS/AUTH/BOOKING y NEXT_PUBLIC_SITE_URL quedan con el marcador __SET_BY_CALLER__ — el caller debe sustituirlos por la infraestructura efímera real de esa validación."
