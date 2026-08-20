#!/usr/bin/env bash
# scripts/secrets-rotation/tests/espo_acl_rehearsal.sh — Bloque 4
#
# Ensayo desechable y REPRODUCIBLE de la verificación real de ACL de S9.
# Levanta una instancia EspoCRM 10.0.3 + MariaDB completamente aislada y
# desechable (proyecto/red/volúmenes/puertos propios), crea identidades y
# roles puramente FICTICIOS vía REST, y ejercita — con peticiones REST
# REALES contra esa instancia — los mismos casos que
# scripts/secrets-rotation/lib/verifyEspoAclSnapshot.test.mjs ya cubre a
# nivel de algoritmo, pero aquí contra un motor EspoCRM real (nunca un
# mock de curl). Usa las MISMAS funciones de introspección REST que
# gate_s9 (scripts/secrets-rotation/lib/aclRest.sh) — no una reimplementación
# paralela — así que esto prueba el código de producción real.
#
# NUNCA toca gapssa-espocrm-1 ni ningún recurso GAPSSA real. NUNCA
# modifica ACL real. NUNCA imprime credenciales. Teardown garantizado
# (trap) incluso ante fallo. Verifica que el inventario Docker del
# proyecto GAPSSA real es idéntico antes/después.
#
# Uso: scripts/secrets-rotation/tests/espo_acl_rehearsal.sh [nombre-proyecto]
#   El nombre de proyecto (por defecto: gapssa-acl-rehearsal-<aleatorio>)
#   DEBE empezar por "gapssa-acl-rehearsal-" — el script aborta si no, y
#   rechaza explícitamente cualquier nombre que coincida con el proyecto
#   real ("gapssa" / cualquiera que empiece por "gapssa-espocrm").
#
# Requiere: docker, docker compose, curl, python3, node, openssl.

set -euo pipefail

# --- 0. Nombre de proyecto — validado ANTES de cualquier otra acción ---
PROJECT="${1:-gapssa-acl-rehearsal-$(openssl rand -hex 4)}"
case "$PROJECT" in
gapssa-acl-rehearsal-*) ;;
*)
  echo "ERROR: el nombre de proyecto debe empezar por 'gapssa-acl-rehearsal-' (recibido: '$PROJECT')." >&2
  exit 1
  ;;
esac
case "$PROJECT" in
gapssa-espocrm* | gapssa)
  echo "ERROR: nombre de proyecto no permitido — coincide con el proyecto GAPSSA real." >&2
  exit 1
  ;;
esac

REAL_PROJECT_NAME="gapssa"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECRETS_ROTATION_DIR="$(dirname "$SCRIPT_DIR")"
VERIFY_HELPER="$SECRETS_ROTATION_DIR/lib/verifyEspoAclSnapshot.mjs"
ESPOCRM_IMAGE="espocrm/espocrm:10.0.3-apache-trixie"
MARIADB_IMAGE="mariadb:11.4"

# capture_cmd es un passthrough aquí (sin concepto de --dry-run) — lo
# exige lib/aclRest.sh, compartido con gate_s9.
capture_cmd() { "$@"; }
# shellcheck source=../lib/aclRest.sh
source "$SECRETS_ROTATION_DIR/lib/aclRest.sh"

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

# --- 1. Trap de teardown — registrado ANTES de levantar nada ---
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/${PROJECT}.XXXXXX")"
COMPOSE_FILE="$WORKDIR/compose.yml"
CURL_CFG="$WORKDIR/curl.cfg"
TEARDOWN_DONE=false
REAL_INVENTORY_BEFORE=""

snapshot_real_inventory() {
  {
    docker compose -p "$REAL_PROJECT_NAME" ps -a --format '{{.Names}}|{{.Image}}|{{.State}}' 2>/dev/null | sort
    printf -- '---networks---\n'
    docker network ls --filter "label=com.docker.compose.project=$REAL_PROJECT_NAME" --format '{{.Name}}' 2>/dev/null | sort
    printf -- '---volumes---\n'
    docker volume ls --filter "label=com.docker.compose.project=$REAL_PROJECT_NAME" --format '{{.Name}}' 2>/dev/null | sort
  }
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
  rm -f "$CURL_CFG" 2>/dev/null || true
  rm -rf "$WORKDIR" 2>/dev/null || true

  local leftover
  leftover="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}}' 2>/dev/null || true)"
  if [ -n "$leftover" ]; then
    say "AVISO: quedaron contenedores del proyecto '$PROJECT' tras el teardown — forzando eliminación."
    # shellcheck disable=SC2086
    docker rm -f $leftover >/dev/null 2>&1 || true
  fi

  if [ -n "$REAL_INVENTORY_BEFORE" ]; then
    local real_inventory_after
    real_inventory_after="$(snapshot_real_inventory)"
    if [ "$REAL_INVENTORY_BEFORE" = "$real_inventory_after" ]; then
      report "verify-clean: inventario Docker del proyecto GAPSSA real ('$REAL_PROJECT_NAME') idéntico antes/después" true
    else
      report "verify-clean: inventario Docker del proyecto GAPSSA real ('$REAL_PROJECT_NAME') idéntico antes/después" false
    fi
  fi

  say ""
  say "Resultados: $((fail_count == 0)) — fail_count=$fail_count"
  exit $((rc != 0 ? rc : (fail_count == 0 ? 0 : 1)))
}
trap teardown EXIT INT TERM

# --- 2. verify-isolated — nada debe preexistir con este nombre de proyecto ---
verify_isolated() {
  local existing
  existing="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}}' 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    echo "ERROR: ya existen contenedores del proyecto '$PROJECT' — aborta (nunca reutiliza estado)." >&2
    exit 1
  fi
  existing="$(docker network ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}}' 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    echo "ERROR: ya existe una red del proyecto '$PROJECT' — aborta." >&2
    exit 1
  fi
  existing="$(docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}' 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    echo "ERROR: ya existe un volumen del proyecto '$PROJECT' — aborta." >&2
    exit 1
  fi
}
verify_isolated
REAL_INVENTORY_BEFORE="$(snapshot_real_inventory)"
say "Proyecto desechable: $PROJECT (aislado, verificado antes de arrancar)."

# --- 3. Credenciales ficticias, nunca reales, nunca impresas ---
DB_NAME="espocrm"
DB_USER="espocrm"
DB_PASSWORD="$(openssl rand -hex 12)"
DB_ROOT_PASSWORD="$(openssl rand -hex 12)"
ADMIN_USER="admin"
ADMIN_PASSWORD="$(openssl rand -hex 12)"
HTTP_PORT="$((20000 + RANDOM % 5000))"

cat >"$COMPOSE_FILE" <<EOF
name: ${PROJECT}
services:
  espocrm-db:
    image: ${MARIADB_IMAGE}
    environment:
      MARIADB_DATABASE: ${DB_NAME}
      MARIADB_USER: ${DB_USER}
      MARIADB_PASSWORD: ${DB_PASSWORD}
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
    networks: [rehearsal]
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 30
      start_period: 10s
  espocrm:
    image: ${ESPOCRM_IMAGE}
    environment:
      ESPOCRM_DATABASE_PLATFORM: Mysql
      ESPOCRM_DATABASE_HOST: espocrm-db
      ESPOCRM_DATABASE_NAME: ${DB_NAME}
      ESPOCRM_DATABASE_USER: ${DB_USER}
      ESPOCRM_DATABASE_PASSWORD: ${DB_PASSWORD}
      ESPOCRM_ADMIN_USERNAME: ${ADMIN_USER}
      ESPOCRM_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      ESPOCRM_SITE_URL: http://localhost:${HTTP_PORT}
    ports:
      - "127.0.0.1:${HTTP_PORT}:80"
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
EOF

say "Levantando EspoCRM 10.0.3 + MariaDB desechables (proyecto '$PROJECT', puerto 127.0.0.1:${HTTP_PORT})..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d

say "Esperando a que 'espocrm' esté healthy (bin/command app-check)..."
waited=0
espocrm_cid=""
while [ "$waited" -lt 240 ]; do
  espocrm_cid="$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q espocrm 2>/dev/null || true)"
  if [ -n "$espocrm_cid" ]; then
    status="$(docker inspect --format '{{.State.Health.Status}}' "$espocrm_cid" 2>/dev/null || true)"
    [ "$status" = "healthy" ] && break
  fi
  sleep 3
  waited=$((waited + 3))
done
if [ "${status:-}" != "healthy" ]; then
  echo "ERROR: 'espocrm' no llegó a 'healthy' tras ${waited}s — aborta (teardown se ejecutará igualmente)." >&2
  exit 1
fi
say "  OK — 'espocrm' healthy tras ${waited}s."

# --- 4. Verificación runtime de imagen — mismo mecanismo que gate_s9 ---
runtime_verified="$(_s9_verify_runtime_image "$espocrm_cid" "$ESPOCRM_IMAGE")"
report "Evidencia runtime (docker inspect): el contenedor ejecuta exactamente $ESPOCRM_IMAGE" "$([ "$runtime_verified" = true ] && echo true || echo false)"

# --- 4b. Campos Meeting FICTICIOS necesarios para ejercitar ACL de campo real ---
# Una instancia EspoCRM 10.0.3 recién instalada no trae los campos custom
# de Gapssa (cBookingRequestId/cMotivoResolucionReserva vienen de
# extensions/espocrm/custom/, cExcluirGoogleCalendarSync de la extensión
# GCS empaquetada) — instalar aquí la extensión GCS real y el árbol
# custom real añadiría acoplamiento y tiempo innecesarios a un ensayo que
# solo necesita que esos TRES campos EXISTAN en el motor para poder
# probar el ACL de campo real sobre ellos. Se define aquí una metadata
# mínima y puramente FICTICIA (mismos nombres de campo, tipos triviales)
# — nunca los ficheros reales de la extensión, nunca datos de negocio.
CUSTOM_DIR="$WORKDIR/custom-fixture"
mkdir -p "$CUSTOM_DIR/Espo/Custom/Resources/metadata/entityDefs"
cat >"$CUSTOM_DIR/Espo/Custom/Resources/metadata/entityDefs/Meeting.json" <<'EOF'
{
    "fields": {
        "cBookingRequestId": { "type": "varchar", "maxLength": 36, "isCustom": true },
        "cMotivoResolucionReserva": { "type": "varchar", "maxLength": 32, "isCustom": true },
        "cExcluirGoogleCalendarSync": { "type": "bool", "default": false, "isCustom": true }
    }
}
EOF
say "Instalando metadata FICTICIA de los 3 campos custom de Meeting auditados (para poder ejercitar su ACL real)..."
docker cp "$CUSTOM_DIR/Espo" "${espocrm_cid}:/var/www/html/custom/"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" exec -T espocrm bin/command rebuild
say "  OK — metadata ficticia instalada y motor reconstruido."

# --- 5. Config curl admin — credencial nunca en argv/JSON, siempre vía -K ---
{
  echo "silent"
  echo "show-error"
  echo "user = \"${ADMIN_USER}:${ADMIN_PASSWORD}\""
  echo "fail"
} >"$CURL_CFG"
chmod 600 "$CURL_CFG"

# --- 6. Helpers de fixture (creación/borrado de identidades FICTICIAS) ---
rest_create_role() {
  # $1=name $2=data-json $3=fieldData-json -> imprime el id nuevo
  local payload
  payload="$(NAME="$1" DATA="$2" FIELDDATA="$3" python3 -c '
import os, json
print(json.dumps({"name": os.environ["NAME"], "data": json.loads(os.environ["DATA"]), "fieldData": json.loads(os.environ["FIELDDATA"])}))
')"
  curl -K "$CURL_CFG" -sS -X POST -H "Content-Type: application/json" --data "$payload" \
    "http://localhost:${HTTP_PORT}/api/v1/Role" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'
}

rest_create_user() {
  # $1=userName $2=type $3=rolesIds-csv $4=teamsIds-csv -> imprime el id nuevo
  local payload
  payload="$(USERNAME="$1" UTYPE="$2" ROLES="$3" TEAMS="$4" python3 -c '
import os, json
roles = [r for r in os.environ["ROLES"].split(",") if r]
teams = [t for t in os.environ["TEAMS"].split(",") if t]
body = {"userName": os.environ["USERNAME"], "type": os.environ["UTYPE"], "isActive": True, "rolesIds": roles, "teamsIds": teams, "lastName": "Fixture"}
print(json.dumps(body))
')"
  curl -K "$CURL_CFG" -sS -X POST -H "Content-Type: application/json" --data "$payload" \
    "http://localhost:${HTTP_PORT}/api/v1/User" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'
}

rest_create_team() {
  # $1=name $2=rolesIds-csv -> imprime el id nuevo
  local payload
  payload="$(NAME="$1" ROLES="$2" python3 -c '
import os, json
roles = [r for r in os.environ["ROLES"].split(",") if r]
print(json.dumps({"name": os.environ["NAME"], "rolesIds": roles}))
')"
  curl -K "$CURL_CFG" -sS -X POST -H "Content-Type: application/json" --data "$payload" \
    "http://localhost:${HTTP_PORT}/api/v1/Team" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'
}

rest_delete() {
  local entity="$1" id="$2"
  [ -z "$id" ] && return 0
  curl -K "$CURL_CFG" -sS -X DELETE "http://localhost:${HTTP_PORT}/api/v1/${entity}/${id}" >/dev/null 2>&1 || true
}

run_acl_check() {
  local snapshot result
  snapshot="$(_s9_build_acl_snapshot_json "$CURL_CFG" "$HTTP_PORT" "$runtime_verified")"
  if _s9_json_has_error "$snapshot"; then
    printf 'ERROR'
    return
  fi
  result="$(printf '%s' "$snapshot" | node "$VERIFY_HELPER" 2>/dev/null)" || result=""
  [ -z "$result" ] && printf 'ERROR' && return
  printf '%s' "$result"
}

# Matriz correcta (§2 del informe) — usada como línea base en varios casos.
PORTAL_GOOD_DATA='{"Meeting":{"create":"yes","delete":"no"}}'
PORTAL_GOOD_FIELDS='{"Meeting":{"name":{"read":"no","edit":"yes"},"cBookingRequestId":{"read":"yes","edit":"yes"},"cMotivoResolucionReserva":{"read":"yes","edit":"yes"},"cExcluirGoogleCalendarSync":{"read":"yes","edit":"no"}}}'
PROF_GOOD_FIELDS='{"Meeting":{"cBookingRequestId":{"read":"no","edit":"no"},"cMotivoResolucionReserva":{"read":"no","edit":"no"},"cExcluirGoogleCalendarSync":{"read":"no","edit":"no"}}}'
EMPTY_DATA='{}'

# Estado de fixtures creadas en el caso actual (para poder borrarlas todas
# entre casos, incluso si un caso concreto falla a mitad).
FX_PORTAL_ROLE="" FX_PROF_ROLE="" FX_PORTAL_USER="" FX_PROF_USER="" FX_TEAM="" FX_EXTRA_ROLE=""

cleanup_case_fixtures() {
  rest_delete User "$FX_PORTAL_USER"
  rest_delete User "$FX_PROF_USER"
  rest_delete Team "$FX_TEAM"
  rest_delete Role "$FX_PORTAL_ROLE"
  rest_delete Role "$FX_PROF_ROLE"
  rest_delete Role "$FX_EXTRA_ROLE"
  FX_PORTAL_ROLE="" FX_PROF_ROLE="" FX_PORTAL_USER="" FX_PROF_USER="" FX_TEAM="" FX_EXTRA_ROLE=""
}

extract_field() {
  printf '%s' "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2', ''))" 2>/dev/null || true
}

# --- 7. Escenarios REST reales ---

say ""
say "=== Caso 1: configuración correcta ==="
FX_PORTAL_ROLE="$(rest_create_role "Portal GAPSSA API" "$PORTAL_GOOD_DATA" "$PORTAL_GOOD_FIELDS")"
FX_PROF_ROLE="$(rest_create_role "Profesional Gapssa" "$EMPTY_DATA" "$PROF_GOOD_FIELDS")"
FX_PORTAL_USER="$(rest_create_user "portal-gapssa-api" "api" "$FX_PORTAL_ROLE" "")"
FX_PROF_USER="$(rest_create_user "profesional-ficticio-1" "regular" "$FX_PROF_ROLE" "")"
result="$(run_acl_check)"
report "Caso 1 (correcto): aclClosed=true" "$([ "$(extract_field "$result" aclClosed)" = "True" ] && echo true || echo false)"
cleanup_case_fixtures

say ""
say "=== Caso 2: Portal con edit=yes incorrecto en cExcluirGoogleCalendarSync ==="
BAD_PORTAL_FIELDS='{"Meeting":{"name":{"read":"no","edit":"yes"},"cBookingRequestId":{"read":"yes","edit":"yes"},"cMotivoResolucionReserva":{"read":"yes","edit":"yes"},"cExcluirGoogleCalendarSync":{"read":"yes","edit":"yes"}}}'
FX_PORTAL_ROLE="$(rest_create_role "Portal GAPSSA API" "$PORTAL_GOOD_DATA" "$BAD_PORTAL_FIELDS")"
FX_PROF_ROLE="$(rest_create_role "Profesional Gapssa" "$EMPTY_DATA" "$PROF_GOOD_FIELDS")"
FX_PORTAL_USER="$(rest_create_user "portal-gapssa-api" "api" "$FX_PORTAL_ROLE" "")"
FX_PROF_USER="$(rest_create_user "profesional-ficticio-1" "regular" "$FX_PROF_ROLE" "")"
result="$(run_acl_check)"
report "Caso 2 (Portal edit=yes incorrecto): aclClosed=false" "$([ "$(extract_field "$result" aclClosed)" = "False" ] && echo true || echo false)"
report "Caso 2: portalExcludeGcsEdit refleja el valor real (yes)" "$([ "$(extract_field "$result" portalExcludeGcsEdit)" = "yes" ] && echo true || echo false)"
cleanup_case_fixtures

say ""
say "=== Caso 3: Profesional con read=yes incorrecto en cExcluirGoogleCalendarSync ==="
BAD_PROF_FIELDS='{"Meeting":{"cBookingRequestId":{"read":"no","edit":"no"},"cMotivoResolucionReserva":{"read":"no","edit":"no"},"cExcluirGoogleCalendarSync":{"read":"yes","edit":"no"}}}'
FX_PORTAL_ROLE="$(rest_create_role "Portal GAPSSA API" "$PORTAL_GOOD_DATA" "$PORTAL_GOOD_FIELDS")"
FX_PROF_ROLE="$(rest_create_role "Profesional Gapssa" "$EMPTY_DATA" "$BAD_PROF_FIELDS")"
FX_PORTAL_USER="$(rest_create_user "portal-gapssa-api" "api" "$FX_PORTAL_ROLE" "")"
FX_PROF_USER="$(rest_create_user "profesional-ficticio-1" "regular" "$FX_PROF_ROLE" "")"
result="$(run_acl_check)"
report "Caso 3 (Profesional read=yes incorrecto): aclClosed=false" "$([ "$(extract_field "$result" aclClosed)" = "False" ] && echo true || echo false)"
cleanup_case_fixtures

say ""
say "=== Caso 4: rol de equipo heredado permisivo para Portal ==="
FX_PORTAL_ROLE="$(rest_create_role "Portal GAPSSA API" "$PORTAL_GOOD_DATA" "$PORTAL_GOOD_FIELDS")"
FX_PROF_ROLE="$(rest_create_role "Profesional Gapssa" "$EMPTY_DATA" "$PROF_GOOD_FIELDS")"
FX_EXTRA_ROLE="$(rest_create_role "Rol Equipo Ficticio Permisivo" "$EMPTY_DATA" '{"Meeting":{"cExcluirGoogleCalendarSync":{"read":"yes","edit":"yes"}}}')"
FX_TEAM="$(rest_create_team "Equipo Ficticio Rehearsal" "$FX_EXTRA_ROLE")"
FX_PORTAL_USER="$(rest_create_user "portal-gapssa-api" "api" "$FX_PORTAL_ROLE" "$FX_TEAM")"
FX_PROF_USER="$(rest_create_user "profesional-ficticio-1" "regular" "$FX_PROF_ROLE" "")"
result="$(run_acl_check)"
report "Caso 4 (rol de equipo heredado permisivo, Portal): unexpectedPermissiveInheritedRole=true" "$([ "$(extract_field "$result" unexpectedPermissiveInheritedRole)" = "True" ] && echo true || echo false)"
report "Caso 4: aclClosed=false" "$([ "$(extract_field "$result" aclClosed)" = "False" ] && echo true || echo false)"
cleanup_case_fixtures

say ""
say "=== Caso 5: usuario API ausente ==="
FX_PORTAL_ROLE="$(rest_create_role "Portal GAPSSA API" "$PORTAL_GOOD_DATA" "$PORTAL_GOOD_FIELDS")"
FX_PROF_ROLE="$(rest_create_role "Profesional Gapssa" "$EMPTY_DATA" "$PROF_GOOD_FIELDS")"
FX_PROF_USER="$(rest_create_user "profesional-ficticio-1" "regular" "$FX_PROF_ROLE" "")"
# portal-gapssa-api NUNCA se crea en este caso.
result="$(run_acl_check)"
report "Caso 5 (usuario API ausente): portalUserPresent=false" "$([ "$(extract_field "$result" portalUserPresent)" = "False" ] && echo true || echo false)"
report "Caso 5: aclClosed=false (nunca 'true' por vacuidad)" "$([ "$(extract_field "$result" aclClosed)" = "False" ] && echo true || echo false)"
cleanup_case_fixtures

say ""
say "=== Caso 6: profesional hereda rol permisivo por equipo ==="
FX_PORTAL_ROLE="$(rest_create_role "Portal GAPSSA API" "$PORTAL_GOOD_DATA" "$PORTAL_GOOD_FIELDS")"
FX_PROF_ROLE="$(rest_create_role "Profesional Gapssa" "$EMPTY_DATA" "$PROF_GOOD_FIELDS")"
FX_EXTRA_ROLE="$(rest_create_role "Rol Equipo Profesional Permisivo" "$EMPTY_DATA" '{"Meeting":{"cMotivoResolucionReserva":{"read":"yes","edit":"no"}}}')"
FX_TEAM="$(rest_create_team "Equipo Profesional Ficticio" "$FX_EXTRA_ROLE")"
FX_PORTAL_USER="$(rest_create_user "portal-gapssa-api" "api" "$FX_PORTAL_ROLE" "")"
FX_PROF_USER="$(rest_create_user "profesional-ficticio-1" "regular" "$FX_PROF_ROLE" "$FX_TEAM")"
result="$(run_acl_check)"
report "Caso 6 (profesional hereda rol permisivo por equipo): unexpectedProfessionalPermissiveRole=true" "$([ "$(extract_field "$result" unexpectedProfessionalPermissiveRole)" = "True" ] && echo true || echo false)"
report "Caso 6: aclClosed=false" "$([ "$(extract_field "$result" aclClosed)" = "False" ] && echo true || echo false)"
cleanup_case_fixtures

say ""
say "=== Caso 7: profesional recibe rol directo permisivo adicional ==="
FX_PORTAL_ROLE="$(rest_create_role "Portal GAPSSA API" "$PORTAL_GOOD_DATA" "$PORTAL_GOOD_FIELDS")"
FX_PROF_ROLE="$(rest_create_role "Profesional Gapssa" "$EMPTY_DATA" "$PROF_GOOD_FIELDS")"
FX_EXTRA_ROLE="$(rest_create_role "Rol Directo Profesional Permisivo" "$EMPTY_DATA" '{"Meeting":{"cBookingRequestId":{"read":"yes","edit":"no"}}}')"
FX_PORTAL_USER="$(rest_create_user "portal-gapssa-api" "api" "$FX_PORTAL_ROLE" "")"
FX_PROF_USER="$(rest_create_user "profesional-ficticio-1" "regular" "${FX_PROF_ROLE},${FX_EXTRA_ROLE}" "")"
result="$(run_acl_check)"
report "Caso 7 (profesional + rol directo permisivo adicional): unexpectedProfessionalPermissiveRole=true" "$([ "$(extract_field "$result" unexpectedProfessionalPermissiveRole)" = "True" ] && echo true || echo false)"
report "Caso 7: aclClosed=false" "$([ "$(extract_field "$result" aclClosed)" = "False" ] && echo true || echo false)"
cleanup_case_fixtures

say ""
say "Casos ejecutados. fail_count=$fail_count (el teardown se ejecuta a continuación vía trap)."
# El trap EXIT hace el resto: down -v, verify-clean, y el exit code final.
