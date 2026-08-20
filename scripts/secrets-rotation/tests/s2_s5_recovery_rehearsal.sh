#!/usr/bin/env bash
# scripts/secrets-rotation/tests/s2_s5_recovery_rehearsal.sh — Bloque 5
#
# Ensayo desechable y REPRODUCIBLE de la recuperación real de S2-S5.
# Levanta PostgreSQL 18 + MariaDB 11.4 + Redis 8 + EspoCRM 10.0.3
# completamente aislados y desechables (proyecto/red/volúmenes/puertos
# propios), con credenciales puramente FICTICIAS, y ejercita — con
# operaciones REALES contra esos servidores — los helpers de
# lib/dbRecovery.sh, lib/espoRecovery.sh, lib/redisVerify.mjs y
# lib/decideRecoveryPlan.mjs: el mismo código de producción que usa
# rotate-all-interactive.sh, nunca una reimplementación paralela.
#
# NUNCA toca gapssa-espocrm-1/gapssa-apps-db-1/gapssa-espocrm-db-1/
# gapssa-redis-1 ni ningún recurso GAPSSA real. NUNCA modifica ACL.
# NUNCA imprime credenciales. Teardown garantizado (trap) incluso ante
# fallo. Verifica que el inventario Docker real es idéntico antes/después
# (mismo mecanismo que scripts/secrets-rotation/tests/disposable-infra.sh:
# normalize_docker_inspect.py, nunca campos inestables como "Status"/
# "RunningFor").
#
# Alcance deliberado (no exhaustivo — ver informe de cierre del Bloque 5
# para la justificación completa): cubre los caminos de recuperación más
# representativos de cada puerta, no las 24 combinaciones completas
# listadas en el encargo — esas se prueban de forma exhaustiva a nivel de
# ALGORITMO en lib/decideRecoveryPlan.test.mjs (32 aserciones) y a nivel
# de MECÁNICA DE ESTADOS/interrupción en tests/run_scenarios.py; este
# ensayo demuestra que los helpers de aplicación/verificación reales
# (SQL, REST, TCP) funcionan de verdad contra motores reales.
#
# Uso: scripts/secrets-rotation/tests/s2_s5_recovery_rehearsal.sh [nombre-proyecto]
#   Por defecto: gapssa-recovery-rehearsal-<aleatorio>. DEBE empezar por
#   "gapssa-recovery-rehearsal-".

set -euo pipefail

PROJECT="${1:-gapssa-recovery-rehearsal-$(openssl rand -hex 4)}"
case "$PROJECT" in
gapssa-recovery-rehearsal-*) ;;
*)
  echo "ERROR: el nombre de proyecto debe empezar por 'gapssa-recovery-rehearsal-' (recibido: '$PROJECT')." >&2
  exit 1
  ;;
esac
case "$PROJECT" in
gapssa-espocrm* | gapssa)
  echo "ERROR: nombre de proyecto no permitido — coincide con el proyecto GAPSSA real." >&2
  exit 1
  ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_ROTATION_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$SECRETS_ROTATION_DIR/../.." && pwd)"
# shellcheck source=../lib.sh
source "$SECRETS_ROTATION_DIR/lib.sh"

POSTGRES_IMAGE="postgres:18-alpine"
MARIADB_IMAGE="mariadb:11.4"
REDIS_IMAGE="redis:8-alpine"
ESPOCRM_IMAGE="espocrm/espocrm:10.0.3-apache-trixie"

capture_cmd() { "$@"; }
_gapssa_compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }
# shellcheck source=../lib/dbRecovery.sh
source "$SECRETS_ROTATION_DIR/lib/dbRecovery.sh"
# shellcheck source=../lib/aclRest.sh
source "$SECRETS_ROTATION_DIR/lib/aclRest.sh"
# shellcheck source=../lib/espoRecovery.sh
source "$SECRETS_ROTATION_DIR/lib/espoRecovery.sh"
# shellcheck source=../lib/recoveryEvidence.sh
source "$SECRETS_ROTATION_DIR/lib/recoveryEvidence.sh"

say() { printf '%s\n' "$*"; }
fail_count=0
report() {
  local desc="$1" ok="$2"
  if [ "$ok" = true ]; then
    say "ok   - $desc"
  else
    say "FAIL - $desc"
    fail_count=$((fail_count + 1))
  fi
}

REAL_PROJECT_NAME="gapssa"
LABEL_KEY="com.docker.compose.project"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/${PROJECT}.XXXXXX")"
COMPOSE_FILE="$WORKDIR/compose.yml"
TEARDOWN_DONE=false
REAL_INVENTORY_BEFORE=""

# _build_fake_full_secrets_file <path> (Revisión 2, punto 10) — escribe
# un $SECRETS_FILE PLANO sintético pero COMPLETO (todas las claves
# obligatorias de la versión de esquema "active", con valores ficticios,
# más ESPOCRM_API_KEY vacía) — imprescindible desde esta revisión porque
# _espo_regenerate_api_key_and_write ahora reutiliza el patrón atómico
# del Bloque 2 (lib/updateSecretsFileField.mjs), que valida el DOCUMENTO
# COMPLETO contra el inventario/obligatorias reales tras cada
# sustitución — nunca solo la línea tocada — así que un fichero de
# prueba casi vacío ya no basta (bug real detectado durante esta misma
# revisión: la primera versión de este ensayo seguía creando el fixture
# con `: >archivo`, y la escritura fallaba con "clave obligatoria
# ausente").
_build_fake_full_secrets_file() {
  local path="$1"
  local helper="$WORKDIR/_build_fixture.mjs"
  cat >"$helper" <<'EOF'
import { writeFileSync } from 'node:fs'
const [, , backupSchemaPath, targetPath] = process.argv
const { MANDATORY_KEYS_ACTIVE } = await import(backupSchemaPath)
const lines = MANDATORY_KEYS_ACTIVE.map((k) => `${k}=valor-ficticio-${k.toLowerCase()}`)
lines.push('ESPOCRM_API_KEY=')
writeFileSync(targetPath, lines.join('\n') + '\n')
EOF
  node "$helper" "$SECRETS_ROTATION_DIR/lib/backupSchema.mjs" "$path"
  chmod 600 "$path"
}

snapshot_real_compose_resources() {
  local out="$1"
  local ids=""
  ids="$(docker ps -aq --filter "label=${LABEL_KEY}" 2>/dev/null || true)
$(docker network ls -q --filter "label=${LABEL_KEY}" 2>/dev/null || true)
$(docker volume ls -q --filter "label=${LABEL_KEY}" 2>/dev/null || true)"
  ids="$(printf '%s\n' "$ids" | grep -v '^$' | sort -u || true)"
  if [ -z "$ids" ]; then
    : >"$out"
    return 0
  fi
  # shellcheck disable=SC2086
  docker inspect $ids 2>/dev/null | python3 "$SCRIPT_DIR/normalize_docker_inspect.py" >"$out"
}

teardown() {
  local rc=$?
  [ "$TEARDOWN_DONE" = true ] && return "$rc"
  TEARDOWN_DONE=true
  say ""
  say "--- Teardown ($PROJECT) ---"
  if [ -f "$COMPOSE_FILE" ]; then
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  rm -rf "$WORKDIR" 2>/dev/null || true

  local leftover
  leftover="$(docker ps -a --filter "label=${LABEL_KEY}=${PROJECT}" --format '{{.ID}}' 2>/dev/null || true)"
  if [ -n "$leftover" ]; then
    say "AVISO: quedaron contenedores del proyecto '$PROJECT' tras el teardown — forzando eliminación."
    # shellcheck disable=SC2086
    docker rm -f $leftover >/dev/null 2>&1 || true
  fi

  if [ -n "$REAL_INVENTORY_BEFORE" ]; then
    local after
    after="$(mktemp "${TMPDIR:-/tmp}/gapssa-recovery-rehearsal-after.XXXXXX")"
    snapshot_real_compose_resources "$after"
    if diff -u "$REAL_INVENTORY_BEFORE" "$after" >&2; then
      report "verify-clean: inventario Docker real (todos los proyectos compose) idéntico antes/después" true
    else
      report "verify-clean: inventario Docker real (todos los proyectos compose) idéntico antes/después" false
    fi
    rm -f "$REAL_INVENTORY_BEFORE" "$after"
  fi

  say ""
  say "fail_count=$fail_count"
  exit $((rc != 0 ? rc : (fail_count == 0 ? 0 : 1)))
}
trap teardown EXIT INT TERM

verify_isolated() {
  local existing
  existing="$(docker ps -a --filter "label=${LABEL_KEY}=${PROJECT}" --format '{{.ID}}' 2>/dev/null || true)"
  [ -z "$existing" ] || { echo "ERROR: ya existen contenedores del proyecto '$PROJECT' — aborta." >&2; exit 1; }
  existing="$(docker network ls --filter "label=${LABEL_KEY}=${PROJECT}" --format '{{.ID}}' 2>/dev/null || true)"
  [ -z "$existing" ] || { echo "ERROR: ya existe una red del proyecto '$PROJECT' — aborta." >&2; exit 1; }
  existing="$(docker volume ls --filter "label=${LABEL_KEY}=${PROJECT}" --format '{{.Name}}' 2>/dev/null || true)"
  [ -z "$existing" ] || { echo "ERROR: ya existe un volumen del proyecto '$PROJECT' — aborta." >&2; exit 1; }
}
verify_isolated
REAL_INVENTORY_BEFORE="$(mktemp "${TMPDIR:-/tmp}/gapssa-recovery-rehearsal-before.XXXXXX")"
snapshot_real_compose_resources "$REAL_INVENTORY_BEFORE"
say "Proyecto desechable: $PROJECT (aislado, verificado antes de arrancar)."

PG_USER="gapssa_apps"
PG_DB="gapssa_cms"
PG_PW_ORIG="$(openssl rand -hex 24)"
MARIADB_DB="espocrm"
MARIADB_USER="espocrm"
MARIADB_PW_ORIG="$(openssl rand -hex 24)"
MARIADB_ROOT_PW_ORIG="$(openssl rand -hex 24)"
REDIS_PW_ORIG="$(openssl rand -hex 24)"
ESPOCRM_ADMIN_USER="admin"
ESPOCRM_ADMIN_PW_ORIG="$(openssl rand -hex 24)"
PG_PORT="$((21000 + RANDOM % 3000))"
MARIADB_PORT="$((24000 + RANDOM % 1000))"
REDIS_PORT="$((25000 + RANDOM % 1000))"
ESPOCRM_PORT="$((26000 + RANDOM % 1000))"

cat >"$COMPOSE_FILE" <<EOF
name: ${PROJECT}
services:
  apps-db:
    image: ${POSTGRES_IMAGE}
    environment:
      POSTGRES_USER: ${PG_USER}
      POSTGRES_PASSWORD: ${PG_PW_ORIG}
      POSTGRES_DB: ${PG_DB}
    ports: ["127.0.0.1:${PG_PORT}:5432"]
    networks: [rehearsal]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${PG_USER} -d ${PG_DB}"]
      interval: 5s
      timeout: 5s
      retries: 30
  espocrm-db:
    image: ${MARIADB_IMAGE}
    environment:
      MARIADB_DATABASE: ${MARIADB_DB}
      MARIADB_USER: ${MARIADB_USER}
      MARIADB_PASSWORD: ${MARIADB_PW_ORIG}
      MARIADB_ROOT_PASSWORD: ${MARIADB_ROOT_PW_ORIG}
    ports: ["127.0.0.1:${MARIADB_PORT}:3306"]
    networks: [rehearsal]
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 30
  redis:
    image: ${REDIS_IMAGE}
    # Forma LISTA, nunca cadena: 'command:' como cadena lo re-tokeniza
    # docker compose con reglas tipo shlex ANTES de pasarlo al contenedor
    # — una contraseña con comillas/';'/backslash sin balancear rompía
    # ese tokenizado (bug real detectado y corregido durante las
    # pruebas del Bloque 5). En forma lista cada elemento se sustituye
    # ('\${REDIS_RUNTIME_PW}') y se pasa literal, sin reinterpretación.
    # NUNCA uses comillas invertidas (backtick) en un comentario dentro
    # de ESTE heredoc (sin comillas, <<EOF): bash las trata como
    # sustitución de comandos aunque estén dentro de un '#' — otro bug
    # real, pre-existente, detectado y corregido durante la Revisión 2
    # (producía "command not found"/"unbound variable" ruidosos en
    # stderr en cada ejecución, sin llegar a romper el YAML resultante
    # porque el resultado vacío de esas sustituciones fallidas caía
    # dentro de un comentario).
    command: ["redis-server", "--requirepass", "\${REDIS_RUNTIME_PW}", "--appendonly", "yes"]
    ports: ["127.0.0.1:${REDIS_PORT}:6379"]
    volumes: ["redis-data:/data"]
    networks: [rehearsal]
  espocrm:
    image: ${ESPOCRM_IMAGE}
    environment:
      ESPOCRM_DATABASE_PLATFORM: Mysql
      ESPOCRM_DATABASE_HOST: espocrm-db
      ESPOCRM_DATABASE_NAME: ${MARIADB_DB}
      ESPOCRM_DATABASE_USER: ${MARIADB_USER}
      ESPOCRM_DATABASE_PASSWORD: ${MARIADB_PW_ORIG}
      ESPOCRM_ADMIN_USERNAME: ${ESPOCRM_ADMIN_USER}
      ESPOCRM_ADMIN_PASSWORD: ${ESPOCRM_ADMIN_PW_ORIG}
      ESPOCRM_SITE_URL: http://localhost:${ESPOCRM_PORT}
    ports: ["127.0.0.1:${ESPOCRM_PORT}:80"]
    networks: [rehearsal]
    depends_on:
      espocrm-db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "bin/command", "app-check"]
      interval: 10s
      timeout: 10s
      retries: 30
      start_period: 30s
networks:
  rehearsal:
volumes:
  redis-data:
EOF

say "Levantando PostgreSQL 18 + MariaDB 11.4 + Redis 8 + EspoCRM 10.0.3 desechables (proyecto '$PROJECT')..."
export REDIS_RUNTIME_PW="$REDIS_PW_ORIG"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d

wait_healthy() {
  local service="$1" timeout_s="$2" waited=0 cid status
  while [ "$waited" -lt "$timeout_s" ]; do
    cid="$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q "$service" 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || true)"
      [ "$status" = "healthy" ] && return 0
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

say "Esperando a apps-db/espocrm-db..."
wait_healthy apps-db 90 || { echo "ERROR: apps-db no llegó a healthy." >&2; exit 1; }
wait_healthy espocrm-db 90 || { echo "ERROR: espocrm-db no llegó a healthy." >&2; exit 1; }
say "Esperando a espocrm (depende de espocrm-db)..."
wait_healthy espocrm 240 || { echo "ERROR: espocrm no llegó a healthy." >&2; exit 1; }
say "  OK — los cuatro servicios están arriba."

# ============================================================
# S2 — PostgreSQL
# ============================================================
say ""
say "=== S2: aplicar vía socket administrativo + verificar por TCP real ==="
NEW_PG_PW="pg-adversarial-\$(){};'\"\\pw"
if [ "$(printf '%s' "$NEW_PG_PW" | _pg_apply_password_via_socket apps-db "$PG_USER" "$PG_DB")" = true ]; then
  report "S2: aplicación vía socket (contraseña adversarial) reporta éxito" true
else
  report "S2: aplicación vía socket (contraseña adversarial) reporta éxito" false
fi
if docker run --rm --network "${PROJECT}_rehearsal" -e PGPASSWORD="$NEW_PG_PW" "$POSTGRES_IMAGE" \
  psql -h "${PROJECT}-apps-db-1" -U "$PG_USER" -d "$PG_DB" -c "SELECT 1;" >/dev/null 2>&1; then
  report "S2: la contraseña nueva autentica por TCP real" true
else
  report "S2: la contraseña nueva autentica por TCP real" false
fi
if docker run --rm --network "${PROJECT}_rehearsal" -e PGPASSWORD="$PG_PW_ORIG" "$POSTGRES_IMAGE" \
  psql -h "${PROJECT}-apps-db-1" -U "$PG_USER" -d "$PG_DB" -c "SELECT 1;" >/dev/null 2>&1; then
  report "S2: la contraseña descartada queda rechazada" false
else
  report "S2: la contraseña descartada queda rechazada" true
fi

# --- S2 aplicación fallida (Revisión 2, punto 10) — un rol con comilla
#     simple dispara el guard de identificador ANTES de tocar red; la
#     función debe reportar "false" de forma determinista, sin dejar
#     evidencia de éxito espurio, y sin tocar la contraseña real del rol
#     legítimo. ---
if [ "$(printf '%s' "otro-valor" | _pg_apply_password_via_socket apps-db "rol'adversarial" "$PG_DB")" = false ]; then
  report "S2: aplicación fallida — rol con comilla simple rechazado sin tocar el servidor" true
else
  report "S2: aplicación fallida — rol con comilla simple rechazado sin tocar el servidor" false
fi
if docker run --rm --network "${PROJECT}_rehearsal" -e PGPASSWORD="$NEW_PG_PW" "$POSTGRES_IMAGE" \
  psql -h "${PROJECT}-apps-db-1" -U "$PG_USER" -d "$PG_DB" -c "SELECT 1;" >/dev/null 2>&1; then
  report "S2: tras la aplicación fallida, la contraseña legítima sigue intacta" true
else
  report "S2: tras la aplicación fallida, la contraseña legítima sigue intacta" false
fi
# Evidencia + decisión REAL de extremo a extremo (mismos constructores
# que _recovery_evidence_s2, nunca una reimplementación paralela del
# ALGORITMO de decisión — ver recoveryEvidence.sh) para "aplicación
# fallida": restoredValueWorks=false, applyAttempted=true,
# applySucceeded=false -> server_coordination_required.
S2_FAIL_EVIDENCE="$(_recovery_component_reversible postgres_password false true false false)"
S2_FAIL_ENVELOPE="$(_recovery_evidence_envelope S2 "$S2_FAIL_EVIDENCE")"
S2_FAIL_STATE="$(_recovery_decide "$S2_FAIL_ENVELOPE" "$SECRETS_ROTATION_DIR")"
if [ "$S2_FAIL_STATE" = "server_coordination_required" ]; then
  report "S2: aplicación fallida -> decideRecoveryPlan.mjs real da server_coordination_required" true
else
  report "S2: aplicación fallida -> decideRecoveryPlan.mjs real da server_coordination_required" false
fi

# ============================================================
# S3 — MariaDB (root + espocrm, reconciliación real)
# ============================================================
say ""
say "=== S3: reconciliación real root + espocrm (idempotente por usuario) ==="
NEW_ESPOCRM_PW="mdb-adversarial-\$(){};'\"\\pw"
if [ "$(printf '%s\0%s' "$MARIADB_ROOT_PW_ORIG" "$NEW_ESPOCRM_PW" | _mariadb_apply_password_via_auth espocrm-db espocrm '%' root)" = true ]; then
  report "S3: reconciliación de 'espocrm' vía auth root reporta éxito" true
else
  report "S3: reconciliación de 'espocrm' vía auth root reporta éxito" false
fi
if docker run --rm --network "${PROJECT}_rehearsal" -e MYSQL_PWD="$NEW_ESPOCRM_PW" "$MARIADB_IMAGE" \
  mariadb -h "${PROJECT}-espocrm-db-1" -u espocrm -e "SELECT 1;" >/dev/null 2>&1; then
  report "S3: 'espocrm' autentica con la contraseña nueva por TCP real" true
else
  report "S3: 'espocrm' autentica con la contraseña nueva por TCP real" false
fi
if docker run --rm --network "${PROJECT}_rehearsal" -e MYSQL_PWD="$MARIADB_PW_ORIG" "$MARIADB_IMAGE" \
  mariadb -h "${PROJECT}-espocrm-db-1" -u espocrm -e "SELECT 1;" >/dev/null 2>&1; then
  report "S3: la contraseña descartada de 'espocrm' queda rechazada" false
else
  report "S3: la contraseña descartada de 'espocrm' queda rechazada" true
fi
# Autenticación con credencial de auth INCORRECTA -> debe fallar sin tocar nada
if [ "$(printf '%s\0%s' "credencial-root-incorrecta" "otra-cosa" | _mariadb_apply_password_via_auth espocrm-db root '%' root)" = false ]; then
  report "S3: auth root incorrecta -> aplicación reporta false (nunca aplica a ciegas)" true
else
  report "S3: auth root incorrecta -> aplicación reporta false (nunca aplica a ciegas)" false
fi

# Revierte 'espocrm' a su contraseña ORIGINAL (misma función, dirección
# inversa — demuestra idempotencia real) — imprescindible: el propio
# contenedor EspoCRM sigue usando la contraseña ORIGINAL para su conexión
# a MariaDB (ESPOCRM_DATABASE_PASSWORD no se reinicia en este ensayo), así
# que S4 necesita que 'espocrm' vuelva a coincidir con ella antes de
# poder ejercitar bin/command / la API REST.
if [ "$(printf '%s\0%s' "$MARIADB_ROOT_PW_ORIG" "$MARIADB_PW_ORIG" | _mariadb_apply_password_via_auth espocrm-db espocrm '%' root)" = true ]; then
  report "S3: revertir 'espocrm' a su valor original (idempotencia, misma función en sentido inverso)" true
else
  report "S3: revertir 'espocrm' a su valor original (idempotencia, misma función en sentido inverso)" false
fi

# --- S3: root anterior TODAVÍA válido (nada que reconciliar) — el
#     valor ORIGINAL debe seguir autenticando por TCP real, dado que
#     esta sección nunca lo rotó realmente (Revisión 2, punto 10).
#     `mariadb_capture`/`pg_capture` viven en rotate-all-interactive.sh,
#     no en ningún lib/*.sh — este ensayo nunca lo fuente (evitaría el
#     harness interactivo), así que la verificación TCP real usa el
#     mismo `docker run` directo que el resto de este script. ---
if docker run --rm --network "${PROJECT}_rehearsal" -e MYSQL_PWD="$MARIADB_ROOT_PW_ORIG" "$MARIADB_IMAGE" \
  mariadb -h "${PROJECT}-espocrm-db-1" -u root -e "SELECT 1;" >/dev/null 2>&1; then
  report "S3: root anterior sigue válido (restoredValueWorks=true, nada que aplicar)" true
else
  report "S3: root anterior sigue válido (restoredValueWorks=true, nada que aplicar)" false
fi

# --- S3: ninguna credencial root conocida autentica -> jamás un falso
#     éxito, la función de aplicación reporta 'false' de forma
#     determinista con CUALQUIER contraseña de autenticación
#     incorrecta (ya cubierto arriba); aquí se comprueba el veredicto
#     agregado REAL, de extremo a extremo, para ese caso. ---
S3_NONE_VALID_ROOT="$(_recovery_component_reversible mariadb_root false true false false)"
S3_NONE_VALID_ESPOCRM="$(_recovery_component_reversible mariadb_espocrm false true false false)"
S3_NONE_VALID_APP="$(_recovery_component_reversible espocrm_app_availability false false false false)"
S3_NONE_VALID_ENVELOPE="$(_recovery_evidence_envelope S3 "$S3_NONE_VALID_ROOT" "$S3_NONE_VALID_ESPOCRM" "$S3_NONE_VALID_APP")"
S3_NONE_VALID_STATE="$(_recovery_decide "$S3_NONE_VALID_ENVELOPE" "$SECRETS_ROTATION_DIR")"
if [ "$S3_NONE_VALID_STATE" = "server_coordination_required" ]; then
  report "S3: ninguna credencial root válida -> decideRecoveryPlan.mjs real da server_coordination_required (nunca un falso éxito)" true
else
  report "S3: ninguna credencial root válida -> decideRecoveryPlan.mjs real da server_coordination_required (nunca un falso éxito)" false
fi

# --- S3 (Revisión 2, punto 7): credenciales de BD YA coordinadas pero
#     la APLICACIÓN (espocrm) no responde — nunca "disponibilidad
#     recuperada" solo por autenticación de MariaDB. Se detiene el
#     contenedor espocrm (real, desechable) para que bin/command
#     app-check falle de verdad, y se comprueba que decideRecoveryPlan
#     real cierra la puerta en server_coordination_required pese a que
#     ambas credenciales MariaDB siguen autenticando. ---
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" stop espocrm >/dev/null 2>&1
S3_APP_DOWN_ROOT="$(_recovery_component_reversible mariadb_root true false false false)"
S3_APP_DOWN_ESPOCRM="$(_recovery_component_reversible mariadb_espocrm true false false false)"
if _gapssa_compose exec -T espocrm bin/command app-check >/dev/null 2>&1; then
  report "S3: app-check con espocrm detenido falla de verdad (precondición del caso)" false
  S3_APP_DOWN_VERIFIED=true
else
  report "S3: app-check con espocrm detenido falla de verdad (precondición del caso)" true
  S3_APP_DOWN_VERIFIED=false
fi
S3_APP_DOWN_APP="$(_recovery_component_reversible espocrm_app_availability false true false "$S3_APP_DOWN_VERIFIED")"
S3_APP_DOWN_ENVELOPE="$(_recovery_evidence_envelope S3 "$S3_APP_DOWN_ROOT" "$S3_APP_DOWN_ESPOCRM" "$S3_APP_DOWN_APP")"
S3_APP_DOWN_STATE="$(_recovery_decide "$S3_APP_DOWN_ENVELOPE" "$SECRETS_ROTATION_DIR")"
if [ "$S3_APP_DOWN_STATE" = "server_coordination_required" ]; then
  report "S3: credenciales de BD coordinadas pero app-check falla -> server_coordination_required (nunca recovery_required solo por MariaDB)" true
else
  report "S3: credenciales de BD coordinadas pero app-check falla -> server_coordination_required (nunca recovery_required solo por MariaDB)" false
fi
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" start espocrm >/dev/null 2>&1
wait_healthy espocrm 120 || true

# ============================================================
# S4 — EspoCRM (admin reversible, API Key irreversible)
# ============================================================
say ""
say "=== S4: admin password (reversible) + API Key (irreversible, forward recovery) ==="
CURL_CFG="$WORKDIR/curl-admin.cfg"
{
  echo "silent"
  echo "show-error"
  echo "user = \"${ESPOCRM_ADMIN_USER}:$(gapssa_secrets_curl_cfg_escape "${ESPOCRM_ADMIN_PW_ORIG}")\""
  echo "fail"
} >"$CURL_CFG"
chmod 600 "$CURL_CFG"

NEW_ADMIN_PW="admin-adversarial-\$(){};'\"\\pw"
if [ "$(printf '%s' "$NEW_ADMIN_PW" | _espo_set_admin_password espocrm "$ESPOCRM_ADMIN_USER")" = true ]; then
  report "S4: set-password (admin, contraseña adversarial) reporta éxito" true
else
  report "S4: set-password (admin, contraseña adversarial) reporta éxito" false
fi
CURL_NEWADMIN_CFG="$WORKDIR/curl-admin-new.cfg"
{
  echo "silent"
  echo "show-error"
  echo "user = \"${ESPOCRM_ADMIN_USER}:$(gapssa_secrets_curl_cfg_escape "${NEW_ADMIN_PW}")\""
  echo "fail"
} >"$CURL_NEWADMIN_CFG"
chmod 600 "$CURL_NEWADMIN_CFG"
if [ "$(_espo_verify_credential_json "$CURL_NEWADMIN_CFG" "$ESPOCRM_PORT")" = true ]; then
  report "S4: login con la contraseña de admin nueva funciona" true
else
  report "S4: login con la contraseña de admin nueva funciona" false
fi
if [ "$(_espo_verify_credential_json "$CURL_CFG" "$ESPOCRM_PORT")" = true ]; then
  report "S4: login con la contraseña de admin ANTIGUA queda rechazado" false
else
  report "S4: login con la contraseña de admin ANTIGUA queda rechazado" true
fi

# Crea el User de referencia (portal-gapssa-api) para poder ejercitar la
# recuperación hacia delante de la API Key.
USER_RESP="$(curl -K "$CURL_NEWADMIN_CFG" -sS -X POST -H "Content-Type: application/json" \
  --data '{"userName":"portal-gapssa-api","type":"api","isActive":true,"lastName":"Fixture","authMethod":"ApiKey"}' \
  "http://localhost:${ESPOCRM_PORT}/api/v1/User")"
PORTAL_USER_ID="$(printf '%s' "$USER_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)"
if [ -n "$PORTAL_USER_ID" ]; then
  report "S4: usuario ficticio 'portal-gapssa-api' creado" true
else
  report "S4: usuario ficticio 'portal-gapssa-api' creado" false
fi

if [ -n "$PORTAL_USER_ID" ]; then
  _build_fake_full_secrets_file "$WORKDIR/fake-secrets-file"
  if [ "$(_espo_regenerate_api_key_and_write "$CURL_NEWADMIN_CFG" "$ESPOCRM_PORT" "$PORTAL_USER_ID" "$WORKDIR/fake-secrets-file" active)" = true ] && grep -q '^ESPOCRM_API_KEY=' "$WORKDIR/fake-secrets-file" 2>/dev/null; then
    report "S4: recuperación hacia delante — nueva API Key generada y escrita en el archivo (campo único)" true
  else
    report "S4: recuperación hacia delante — nueva API Key generada y escrita en el archivo (campo único)" false
  fi
  NEW_API_KEY="$(grep '^ESPOCRM_API_KEY=' "$WORKDIR/fake-secrets-file" 2>/dev/null | tail -n1 | cut -d= -f2-)"
  CURL_NEWKEY_CFG="$WORKDIR/curl-newkey.cfg"
  {
    echo "silent"
    echo "show-error"
    echo "header = \"X-Api-Key: $(gapssa_secrets_curl_cfg_escape "${NEW_API_KEY}")\""
    echo "fail"
  } >"$CURL_NEWKEY_CFG"
  chmod 600 "$CURL_NEWKEY_CFG"
  if [ "$(_espo_verify_credential_json "$CURL_NEWKEY_CFG" "$ESPOCRM_PORT")" = true ]; then
    report "S4: la API Key nueva (recuperada hacia delante) autentica de verdad" true
  else
    report "S4: la API Key nueva (recuperada hacia delante) autentica de verdad" false
  fi
  # El archivo NUNCA debe terminar sin ESPOCRM_API_KEY o con uno vacío.
  if [ -n "$NEW_API_KEY" ]; then
    report "S4: el archivo nunca termina con una API Key vacía/ausente" true
  else
    report "S4: el archivo nunca termina con una API Key vacía/ausente" false
  fi

  # --- S4: API Key ANTIGUA (la recién generada arriba) todavía válida
  #     (Revisión 2, punto 10) — evidencia + decisión REAL: componente
  #     irreversible con restoredValueWorks=true -> 'coordinated', puerta
  #     -> recovery_required (nunca forward_recovery_required cuando la
  #     restaurada sigue viva). ---
  S4_ADMIN_OK="$(_recovery_component_reversible espocrm_admin_password true false false false)"
  S4_KEY_STILL_VALID="$(_recovery_component_irreversible espocrm_api_key true false false)"
  S4_STILL_VALID_ENVELOPE="$(_recovery_evidence_envelope S4 "$S4_ADMIN_OK" "$S4_KEY_STILL_VALID")"
  S4_STILL_VALID_STATE="$(_recovery_decide "$S4_STILL_VALID_ENVELOPE" "$SECRETS_ROTATION_DIR")"
  if [ "$(_espo_verify_credential_json "$CURL_NEWKEY_CFG" "$ESPOCRM_PORT")" = true ] && [ "$S4_STILL_VALID_STATE" = "recovery_required" ]; then
    report "S4: API Key antigua aún válida -> recovery_required (nunca se regenera innecesariamente)" true
  else
    report "S4: API Key antigua aún válida -> recovery_required (nunca se regenera innecesariamente)" false
  fi

  # --- S4 (Revisión 2, punto 5): portal-gapssa-api AUSENTE — nunca se
  #     interpreta como "nada que reconciliar" (key_restored_works=true).
  #     Comprueba tanto ausencia total como presencia con type != 'api'
  #     (ambos deben fallar cerrado igual). ---
  ABSENT_ID="$(_espo_find_user_id_by_username "$CURL_NEWADMIN_CFG" "$ESPOCRM_PORT" "portal-gapssa-api-inexistente" "api")"
  if [ -z "$ABSENT_ID" ]; then
    report "S4: portal-gapssa-api AUSENTE -> _espo_find_user_id_by_username devuelve vacío (nunca falso positivo)" true
  else
    report "S4: portal-gapssa-api AUSENTE -> _espo_find_user_id_by_username devuelve vacío (nunca falso positivo)" false
  fi
  WRONGTYPE_RESP="$(curl -K "$CURL_NEWADMIN_CFG" -sS -X POST -H "Content-Type: application/json" \
    --data '{"userName":"portal-gapssa-api-wrongtype","type":"regular","isActive":true,"lastName":"Fixture","password":"Fixture-Pass-000!"}' \
    "http://localhost:${ESPOCRM_PORT}/api/v1/User")"
  WRONGTYPE_ID_CREATED="$(printf '%s' "$WRONGTYPE_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("id",""))' 2>/dev/null || true)"
  if [ -n "$WRONGTYPE_ID_CREATED" ]; then
    WRONGTYPE_LOOKUP="$(_espo_find_user_id_by_username "$CURL_NEWADMIN_CFG" "$ESPOCRM_PORT" "portal-gapssa-api-wrongtype" "api")"
    if [ -z "$WRONGTYPE_LOOKUP" ]; then
      report "S4: portal-gapssa-api-wrongtype (type=regular) NUNCA cuenta como encontrado para type=api" true
    else
      report "S4: portal-gapssa-api-wrongtype (type=regular) NUNCA cuenta como encontrado para type=api" false
    fi
  else
    report "S4: fixture portal-gapssa-api-wrongtype creado para la prueba de type incorrecto" false
  fi
  # Evidencia + decisión REAL para "portal-gapssa-api ausente": admin
  # coordinado, API key con forwardRecoveryAttempted=true (se intentó
  # localizar el User) y forwardRecovered=false (nunca se encontró) ->
  # server_coordination_required, JAMÁS "recovery_required" ni
  # key_restored_works=true.
  S4_ABSENT_ADMIN="$(_recovery_component_reversible espocrm_admin_password true false false false)"
  S4_ABSENT_KEY="$(_recovery_component_irreversible espocrm_api_key false true false)"
  S4_ABSENT_ENVELOPE="$(_recovery_evidence_envelope S4 "$S4_ABSENT_ADMIN" "$S4_ABSENT_KEY")"
  S4_ABSENT_STATE="$(_recovery_decide "$S4_ABSENT_ENVELOPE" "$SECRETS_ROTATION_DIR")"
  if [ "$S4_ABSENT_STATE" = "server_coordination_required" ]; then
    report "S4: portal-gapssa-api ausente -> decideRecoveryPlan.mjs real da server_coordination_required (nunca finge disponibilidad)" true
  else
    report "S4: portal-gapssa-api ausente -> decideRecoveryPlan.mjs real da server_coordination_required (nunca finge disponibilidad)" false
  fi

  # --- S4: respuesta corrupta / actualización atómica interrumpida
  #     (Revisión 2, punto 10) — apunta la llamada a un puerto que no
  #     escucha nada, de forma que curl falle y updateSecretsFileField.mjs
  #     reciba stdin vacío/no-JSON — la función debe reportar 'false' SIN
  #     tocar el archivo de secretos ficticio ni un solo byte. ---
  cp "$WORKDIR/fake-secrets-file" "$WORKDIR/fake-secrets-file.before-corrupt"
  BOGUS_PORT=1
  if [ "$(_espo_regenerate_api_key_and_write "$CURL_NEWADMIN_CFG" "$BOGUS_PORT" "$PORTAL_USER_ID" "$WORKDIR/fake-secrets-file" active)" = false ]; then
    report "S4: respuesta corrupta (curl sin servidor real) -> reporta false" true
  else
    report "S4: respuesta corrupta (curl sin servidor real) -> reporta false" false
  fi
  if cmp -s "$WORKDIR/fake-secrets-file.before-corrupt" "$WORKDIR/fake-secrets-file"; then
    report "S4: tras la respuesta corrupta, el archivo de secretos queda BYTE A BYTE intacto" true
  else
    report "S4: tras la respuesta corrupta, el archivo de secretos queda BYTE A BYTE intacto" false
  fi
fi

# ============================================================
# S5 — Redis (recreación + verificación TCP real + datos intactos)
# ============================================================
say ""
say "=== S5: recreación con --force-recreate + PING TCP real + datos intactos ==="
docker exec "${PROJECT}-redis-1" redis-cli -a "$REDIS_PW_ORIG" SET rehearsal-key valor-antes-de-recrear >/dev/null 2>&1 || true

NEW_REDIS_PW="redis-adversarial-\$(){};'\"\\pw"
export REDIS_RUNTIME_PW="$NEW_REDIS_PW"
if _gapssa_compose up -d --force-recreate redis >/dev/null 2>&1; then
  report "S5: force-recreate con la contraseña nueva reporta éxito" true
else
  report "S5: force-recreate con la contraseña nueva reporta éxito" false
fi
sleep 2

CHECK_NEW="$(printf '{"host":"127.0.0.1","port":%s}\n%s' "$REDIS_PORT" "$NEW_REDIS_PW" | node "$SECRETS_ROTATION_DIR/lib/redisVerify.mjs" 2>/dev/null || true)"
if [ "$CHECK_NEW" = true ]; then
  report "S5: PING autenticado por TCP real con la contraseña nueva" true
else
  report "S5: PING autenticado por TCP real con la contraseña nueva" false
fi
CHECK_OLD="$(printf '{"host":"127.0.0.1","port":%s}\n%s' "$REDIS_PORT" "$REDIS_PW_ORIG" | node "$SECRETS_ROTATION_DIR/lib/redisVerify.mjs" 2>/dev/null || true)"
if [ "$CHECK_OLD" = true ]; then
  report "S5: la contraseña descartada queda rechazada" false
else
  report "S5: la contraseña descartada queda rechazada" true
fi
PERSISTED="$(docker exec -e REDISCLI_AUTH="$NEW_REDIS_PW" "${PROJECT}-redis-1" redis-cli GET rehearsal-key 2>/dev/null | tail -1 || true)"
if [ "$PERSISTED" = "valor-antes-de-recrear" ]; then
  report "S5: los datos (volumen) sobreviven a la recreación" true
else
  report "S5: los datos (volumen) sobreviven a la recreación" false
fi

# --- S5: estado correcto si la coordinación falla (Revisión 2, punto 8)
#     — un puerto sin nada escuchando garantiza que redisVerify.mjs
#     siempre reporte 'false', sin importar la contraseña: evidencia +
#     decisión REAL para "recreación intentada pero nunca verificada" ->
#     server_coordination_required, jamás recovery_required. ---
UNREACHABLE_PORT=1
CHECK_UNREACHABLE="$(printf '{"host":"127.0.0.1","port":%s}\n%s' "$UNREACHABLE_PORT" "$NEW_REDIS_PW" | node "$SECRETS_ROTATION_DIR/lib/redisVerify.mjs" 2>/dev/null || true)"
if [ "$CHECK_UNREACHABLE" = false ]; then
  report "S5: host:puerto inalcanzable -> redisVerify.mjs reporta false (nunca un falso positivo)" true
else
  report "S5: host:puerto inalcanzable -> redisVerify.mjs reporta false (nunca un falso positivo)" false
fi
S5_FAIL_EVIDENCE="$(_recovery_component_reversible redis_password false true true false)"
S5_FAIL_ENVELOPE="$(_recovery_evidence_envelope S5 "$S5_FAIL_EVIDENCE")"
S5_FAIL_STATE="$(_recovery_decide "$S5_FAIL_ENVELOPE" "$SECRETS_ROTATION_DIR")"
if [ "$S5_FAIL_STATE" = "server_coordination_required" ]; then
  report "S5: coordinación fallida (recreado pero nunca verificado) -> decideRecoveryPlan.mjs real da server_coordination_required" true
else
  report "S5: coordinación fallida (recreado pero nunca verificado) -> decideRecoveryPlan.mjs real da server_coordination_required" false
fi

# ============================================================
# Interrupción por SIGINT durante el temporal de MariaDB (Revisión 2,
# punto 10) — única clase de temporal de Bloque 5 que sigue existiendo
# (Postgres ya no usa ninguno; la respuesta de API Key se procesa en
# streaming, sin fichero) tras esta revisión. Lanza un subproceso real
# que crea el mismo tipo de temporal que
# _mariadb_apply_password_via_auth (mismo prefijo, misma pila de
# limpieza de lib.sh), lo interrumpe con SIGINT real a mitad de su vida,
# y comprueba que el trap EXIT/INT lo borra igualmente.
# ============================================================
say ""
say "=== SIGINT durante el temporal de opciones MariaDB ==="
SIGINT_MARKER_DIR="$(mktemp -d "${TMPDIR:-/tmp}/gapssa-recovery-rehearsal-sigint.XXXXXX")"
(
  set -euo pipefail
  # shellcheck source=../lib.sh
  source "$SECRETS_ROTATION_DIR/lib.sh"
  tmp="$(gapssa_secrets_mktemp_secure gapssa-mariadb-recover-optfile)"
  gapssa_cleanup_push shred_plain "$tmp"
  printf '%s' "$tmp" >"$SIGINT_MARKER_DIR/path"
  trap 'gapssa_cleanup_dispatch; exit 130' INT
  sleep 30
) &
SIGINT_TEST_PID=$!
SIGINT_TMP_PATH=""
for _ in $(seq 1 20); do
  [ -s "$SIGINT_MARKER_DIR/path" ] && { SIGINT_TMP_PATH="$(cat "$SIGINT_MARKER_DIR/path")"; break; }
  sleep 0.2
done
if [ -n "$SIGINT_TMP_PATH" ] && [ -f "$SIGINT_TMP_PATH" ]; then
  report "SIGINT/temporal MariaDB: el temporal existe justo antes de interrumpir (precondición)" true
else
  report "SIGINT/temporal MariaDB: el temporal existe justo antes de interrumpir (precondición)" false
fi
kill -INT "$SIGINT_TEST_PID" 2>/dev/null || true
wait "$SIGINT_TEST_PID" 2>/dev/null || true
if [ -n "$SIGINT_TMP_PATH" ] && [ ! -e "$SIGINT_TMP_PATH" ]; then
  report "SIGINT/temporal MariaDB: el trap INT lo borra (nunca queda huérfano tras una interrupción real)" true
else
  report "SIGINT/temporal MariaDB: el trap INT lo borra (nunca queda huérfano tras una interrupción real)" false
fi
rm -rf "$SIGINT_MARKER_DIR"

# ============================================================
# Watcher final (Revisión 2, punto 9) — confirma que, tras TODOS los
# escenarios anteriores, no queda ningún fichero sensible temporal ni
# ninguna ruta fija — ni en el host, ni dentro de los contenedores
# desechables.
# ============================================================
say ""
say "=== Watcher: sin temporales huérfanos ni rutas fijas tras todos los escenarios ==="
HOST_TMP_DIR="${GAPSSA_SECRETS_TMPDIR:-${TMPDIR:-/tmp}}"
LEFTOVER_HOST_TMP="$(find "$HOST_TMP_DIR" -maxdepth 1 \( -name 'gapssa-pg-*' -o -name 'gapssa-pgpass*' -o -name 'gapssa-mariadb-*' -o -name 'gapssa-recover-*' -o -name 'gapssa-curl-*' -o -name 'gapssa-apikey-*' \) 2>/dev/null || true)"
if [ -z "$LEFTOVER_HOST_TMP" ]; then
  report "Watcher: ningún temporal sensible huérfano en el host" true
else
  report "Watcher: ningún temporal sensible huérfano en el host" false
  say "$LEFTOVER_HOST_TMP"
fi
FIXED_PATHS_FOUND=false
if _gapssa_compose exec -T apps-db sh -c "[ -e /tmp/.gapssa-pg-recover-pw ]" >/dev/null 2>&1; then
  FIXED_PATHS_FOUND=true
fi
if _gapssa_compose exec -T espocrm-db sh -c "[ -e /tmp/.gapssa-mariadb-recover-pw ] || ls /tmp/.gapssa-mariadb-recover-optfile.* >/dev/null 2>&1" >/dev/null 2>&1; then
  FIXED_PATHS_FOUND=true
fi
if [ "$FIXED_PATHS_FOUND" = false ]; then
  report "Watcher: ninguna ruta fija/huérfana dentro de los contenedores desechables" true
else
  report "Watcher: ninguna ruta fija/huérfana dentro de los contenedores desechables" false
fi

say ""
say "Casos ejecutados. fail_count=$fail_count (el teardown se ejecuta a continuación vía trap)."
