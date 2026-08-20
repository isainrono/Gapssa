#!/usr/bin/env bash
# Ejecución REAL, obligatoria (Bloque 3 §7), de las 4 sondas permanentes
# de negocio de S6/S7 contra Postgres/Redis EXCLUSIVAMENTE DESECHABLES
# (scripts/secrets-rotation/tests/disposable-infra.sh) — nunca
# compose.yml, nunca contenedores/redes/volúmenes reales de GAPSSA, nunca
# ~/.gapssa-secrets ni .env reales. Demuestra que la reubicación de los 4
# heredocs a scripts/secrets-rotation/probes/ resuelve sus imports
# relativos a apps/web/src/... de verdad en tiempo de ejecución (no solo
# en teoría), desde dos cwd distintos, con teardown y verify-clean
# garantizados incluso si algo falla a mitad.
#
# Uso: ./probes_real_execution.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SR_DIR/../.." && pwd)"
DISPOSABLE="$SCRIPT_DIR/disposable-infra.sh"

command -v docker >/dev/null 2>&1 || {
  echo "ERROR: docker no está disponible — esta prueba necesita infraestructura DESECHABLE real (nunca contenedores de GAPSSA)." >&2
  exit 1
}
docker info >/dev/null 2>&1 || {
  echo "ERROR: el demonio docker no responde." >&2
  exit 1
}
[ -x "$REPO_ROOT/node_modules/.bin/tsx" ] || command -v node >/dev/null 2>&1 || {
  echo "ERROR: node no está disponible." >&2
  exit 1
}

PASS=0
FAIL=0
ok() {
  echo "ok   - $1"
  PASS=$((PASS + 1))
}
fail() {
  echo "FAIL - $1"
  FAIL=$((FAIL + 1))
}

unset NODE_ENV

PROJECT=""
DB_NAME=""
ADMIN_PG_URL=""
SECRETS_TMP=""

cleanup() {
  local rc=$?
  if [ -n "$DB_NAME" ] && [ -n "$ADMIN_PG_URL" ]; then
    node --import tsx "$SCRIPT_DIR/probesRealExecutionDb.mts" drop "$ADMIN_PG_URL" "$DB_NAME" >/dev/null 2>&1 || true
  fi
  if [ -n "$PROJECT" ]; then
    bash "$DISPOSABLE" down "$PROJECT" >/dev/null 2>&1 || true
    if bash "$DISPOSABLE" verify-clean "$PROJECT" >&2; then
      ok "teardown: cero residuos del proyecto desechable; recursos reales de docker compose idénticos antes/después"
    else
      fail "teardown: verify-clean detectó residuos o cambios en recursos reales"
    fi
  fi
  [ -n "$SECRETS_TMP" ] && rm -rf "$SECRETS_TMP"
  echo ""
  echo "PASS=$PASS FAIL=$FAIL"
  if [ "$FAIL" -eq 0 ] && [ "$rc" -eq 0 ]; then
    exit 0
  fi
  exit 1
}
trap cleanup EXIT

# --- 1. Infraestructura desechable ---
PROJECT="$(bash "$DISPOSABLE" new-project-name)"
bash "$DISPOSABLE" verify-isolated "$PROJECT" >&2
bash "$DISPOSABLE" up "$PROJECT" >&2

SECRETS_TMP="$(mktemp -d)"
ENV_FILE="$SECRETS_TMP/disposable.env"
bash "$DISPOSABLE" env "$PROJECT" "$ENV_FILE" >&2
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a
ADMIN_PG_URL="$GAPSSA_ROTATION_V3_PG_URL"
REDIS_URL_DISPOSABLE="$GAPSSA_ROTATION_V3_REDIS_URL"

# --- 2. Base de datos de booking efímera, migrada de verdad ---
CREATE_JSON="$(node --import tsx "$SCRIPT_DIR/probesRealExecutionDb.mts" create "$ADMIN_PG_URL")"
DB_NAME="$(printf '%s' "$CREATE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['databaseName'])")"
BOOKING_DB_URL="$(printf '%s' "$CREATE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['testDatabaseUrl'])")"
ok "base de datos de booking efímera creada y migrada: $DB_NAME"

# --- 3. $SECRETS_FILE sintético — mismo shape que
#        apps/web/tests/integration/rotation/setEnv.ts ya usa para la
#        suite de vitest equivalente, nunca inventado desde cero. ---
rand_b64() { openssl rand -base64 "$1" | tr -d '\n'; }
three_versions_json() {
  python3 -c "
import json, base64, os
print(json.dumps({v: base64.b64encode(os.urandom(32)).decode() for v in ('v1', 'v2', 'v3')}))
"
}

SECRETS_FILE="$SECRETS_TMP/secrets.env"
ARTIFACT_DIR="$SECRETS_TMP/artifact-tmp"
mkdir -p "$ARTIFACT_DIR"
chmod 700 "$ARTIFACT_DIR"

PAYLOAD_SECRET_VAL="$(rand_b64 32)"
OTP_HMAC_SECRET_VAL="$(rand_b64 32)"
AUTH_RATE_LIMIT_HMAC_SECRET_VAL="$(rand_b64 32)"
BOOKING_INTERNAL_API_SECRET_VAL="$(rand_b64 32)"
OLD_INTERNAL_API_SECRET_VAL="$(rand_b64 32)"

{
  echo "COMPOSE_PROJECT_NAME=gapssa-rotation-v3-real"
  echo "POSTGRES_DB=gapssa_rot_real"
  echo "POSTGRES_USER=gapssa_rot_real"
  echo "DATABASE_URL_CMS=postgresql://x:x@127.0.0.1:1/x"
  echo "DATABASE_URL_AUTH=postgresql://x:x@127.0.0.1:1/x"
  echo "DATABASE_URL_BOOKING=$BOOKING_DB_URL"
  echo "REDIS_KEY_PREFIX=gapssa:rotation-v3-real:"
  echo "REDIS_URL=$REDIS_URL_DISPOSABLE"
  echo "PAYLOAD_SECRET=$PAYLOAD_SECRET_VAL"
  echo "NEXT_PUBLIC_SITE_URL=http://localhost:3000"
  echo "SITE_NOINDEX=true"
  echo "NEXT_PUBLIC_UMAMI_WEBSITE_ID="
  echo "NEXT_PUBLIC_UMAMI_SRC="
  echo "OTP_HMAC_SECRET=$OTP_HMAC_SECRET_VAL"
  echo "AUTH_RATE_LIMIT_HMAC_SECRET=$AUTH_RATE_LIMIT_HMAC_SECRET_VAL"
  echo "TRUSTED_PROXY_HOP_COUNT=0"
  echo "SMTP_HOST="
  echo "SMTP_PORT=587"
  echo "SMTP_SECURE=false"
  echo "SMTP_USER="
  echo "SMTP_PASSWORD="
  echo "SMTP_FROM_EMAIL=rotation-v3-real@example.test"
  echo "BOOKING_FIELD_ENCRYPTION_KEYS=$(three_versions_json)"
  echo "BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION=v3"
  echo "BOOKING_EMAIL_LOOKUP_HMAC_SECRETS=$(three_versions_json)"
  echo "BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION=v3"
  echo "BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS=$(three_versions_json)"
  echo "BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION=v3"
  echo "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS=$(three_versions_json)"
  echo "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION=v3"
  echo "BOOKING_INTERNAL_API_SECRET=$BOOKING_INTERNAL_API_SECRET_VAL"
  echo "ESPO_BOOKING_ADAPTER=simulated"
} >"$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"

OLD_INTERNAL_API_FILE="$SECRETS_TMP/old-internal-api.env"
printf 'OLD_INTERNAL_API_SECRET=%s\n' "$OLD_INTERNAL_API_SECRET_VAL" >"$OLD_INTERNAL_API_FILE"
chmod 600 "$OLD_INTERNAL_API_FILE"

ARTIFACT_PATH="$ARTIFACT_DIR/s6-otp-probe.json"

# --- 4. Ejecuta las 4 sondas reales, cada una desde DOS cwd distintos
#        (raíz del repo y $SECRETS_TMP), demostrando que la resolución de
#        rutas es independiente del directorio de trabajo (todas las
#        rutas que se pasan son absolutas, resueltas desde $SCRIPT_DIR) —
#        y que ninguna contiene un secreto en su línea de argumentos. ---
SECRET_VALUES=(
  "$PAYLOAD_SECRET_VAL" "$OTP_HMAC_SECRET_VAL" "$AUTH_RATE_LIMIT_HMAC_SECRET_VAL"
  "$BOOKING_INTERNAL_API_SECRET_VAL" "$OLD_INTERNAL_API_SECRET_VAL"
)

assert_no_secret_in_argv() {
  local label="$1"
  shift
  local argv_joined="$*"
  local v
  for v in "${SECRET_VALUES[@]}"; do
    if [ -n "$v" ] && [[ "$argv_joined" == *"$v"* ]]; then
      fail "$label: un valor secreto apareció en argv"
      return 1
    fi
  done
  ok "$label: ningún argumento de proceso contiene un valor secreto"
  return 0
}

run_probe() {
  # run_probe <label> <schema> <cwd> <probe.mts> [args...]
  local label="$1" schema="$2" run_cwd="$3" probe="$4"
  shift 4
  local -a probe_args=("$@")
  assert_no_secret_in_argv "$label (argv)" "$REPO_ROOT" "$SECRETS_FILE" "$SR_DIR/probes/$probe" "${probe_args[@]:+"${probe_args[@]}"}"

  local out err rc=0
  err="$(mktemp)"
  if out="$(cd "$run_cwd" && node "$SR_DIR/lib/run-tsx.mjs" "$REPO_ROOT" "$SECRETS_FILE" "$SR_DIR/probes/$probe" "${probe_args[@]:+"${probe_args[@]}"}" 2>"$err" | node "$SR_DIR/lib/validateProbeJson.mjs" "$schema")"; then
    ok "$label (cwd=$run_cwd): ejecuta con éxito, salida JSON validada por schema \"$schema\""
  else
    rc=1
    fail "$label (cwd=$run_cwd): fallo en ejecución o validación — stderr: $(cat "$err")"
  fi

  local v
  for v in "${SECRET_VALUES[@]}"; do
    if [ -n "$v" ] && grep -qF -- "$v" "$err" 2>/dev/null; then
      fail "$label (cwd=$run_cwd): un valor secreto apareció en stderr"
      rc=1
    fi
  done
  if ! grep -qF -- "$PAYLOAD_SECRET_VAL" "$err" 2>/dev/null &&
     ! grep -qF -- "$OTP_HMAC_SECRET_VAL" "$err" 2>/dev/null; then
    ok "$label (cwd=$run_cwd): stderr sin valores sensibles"
  fi
  rm -f "$err"
  return $rc
}

# S6-pre — escribe el artefacto real (OTP real contra Redis desechable,
# JWT real firmado con PAYLOAD_SECRET real) desde la raíz del repo.
run_probe "s6PreRotationProbe" "s6-pre" "$REPO_ROOT" "s6PreRotationProbe.mts" "$ARTIFACT_PATH" "$ARTIFACT_DIR" || true

if [ -f "$ARTIFACT_PATH" ]; then
  mode="$(stat -f '%Lp' "$ARTIFACT_PATH" 2>/dev/null || stat -c '%a' "$ARTIFACT_PATH" 2>/dev/null || echo '?')"
  if [ "$mode" = "600" ]; then
    ok "artefacto de S6 quedó en disco con modo 600"
  else
    fail "artefacto de S6 con modo inesperado: $mode"
  fi
  case "$ARTIFACT_PATH" in
  "$REPO_ROOT/apps/web"*) fail "el artefacto de S6 apareció dentro de apps/web" ;;
  *) ok "el artefacto de S6 quedó fuera del workspace, dentro del directorio externo esperado" ;;
  esac
  content="$(cat "$ARTIFACT_PATH")"
  if printf '%s' "$content" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d.get('schemaVersion') == 1
assert set(d.keys()) == {'schemaVersion', 'subjectRef', 'code', 'payloadJwt'}
" 2>/dev/null; then
    ok "artefacto de S6: esquema versionado y conjunto de claves exactos"
  else
    fail "artefacto de S6: esquema/claves inesperados"
  fi
else
  fail "s6PreRotationProbe no creó el artefacto esperado"
fi

# S6-post — desde un cwd DISTINTO ($SECRETS_TMP) — consume el artefacto
# real recién escrito, verificación dinámica real contra Redis
# desechable.
run_probe "s6PostRotationVerification" "s6-post" "$SECRETS_TMP" "s6PostRotationVerification.mts" "$ARTIFACT_PATH" "$ARTIFACT_DIR" || true

# S7-migrate — recifrado/reindexado/auditoría reales contra la base de
# booking efímera migrada (0 filas — solo demuestra ejecución real, no
# una rotación real de datos). Sin argumentos.
run_probe "s7MigrateAndAudit" "s7-migrate" "$REPO_ROOT" "s7MigrateAndAudit.mts" || true
run_probe "s7MigrateAndAudit (cwd distinto)" "s7-migrate" "$SECRETS_TMP" "s7MigrateAndAudit.mts" || true

# S7-internal-check — verificación real de isValidInternalApiSecret.
run_probe "s7InternalApiAuthCheck" "s7-internal-check" "$REPO_ROOT" "s7InternalApiAuthCheck.mts" "$OLD_INTERNAL_API_FILE" || true
run_probe "s7InternalApiAuthCheck (cwd distinto)" "s7-internal-check" "$SECRETS_TMP" "s7InternalApiAuthCheck.mts" "$OLD_INTERNAL_API_FILE" || true

# --- 5. Confirma que ningún artefacto/temporal apareció en apps/web
#        durante toda esta ejecución. ---
orphans="$(find "$REPO_ROOT/apps/web" -maxdepth 1 -name '.gapssa-s*' 2>/dev/null || true)"
if [ -z "$orphans" ]; then
  ok "ningún artefacto/temporal apareció en apps/web durante la ejecución real"
else
  fail "aparecieron artefactos en apps/web: $orphans"
fi

