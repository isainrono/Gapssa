#!/usr/bin/env bash
# scripts/secrets-rotation/tests/s4_acl_canonical_rehearsal.sh
#
# Ensayo desechable y REPRODUCIBLE, contra una instancia EspoCRM 10.0.3 +
# MariaDB REAL (nunca un mock de curl), de
# lib/aclRest.sh::_s4_fetch_portal_acl_canonical — la función que gate_s4
# (rotate-all-interactive.sh) usa para decidir si la ACL de
# 'portal-gapssa-api' cambió de verdad entre el "antes" y el "después" de
# rotar su API Key. Mismo patrón que tests/espo_acl_rehearsal.sh (S9):
# proyecto/red/volúmenes/puerto propios, identidades puramente FICTICIAS
# vía REST, teardown garantizado, verify-isolated antes y verify-clean
# después contra el inventario Docker del proyecto GAPSSA real.
#
# NUNCA toca gapssa-espocrm-1 ni ningún recurso GAPSSA real. NUNCA
# modifica ACL real. NUNCA imprime credenciales.
#
# Uso: scripts/secrets-rotation/tests/s4_acl_canonical_rehearsal.sh [nombre-proyecto]
#   El nombre de proyecto (por defecto: gapssa-s4-acl-rehearsal-<aleatorio>)
#   DEBE empezar por "gapssa-s4-acl-rehearsal-".
#
# Requiere: docker, docker compose, curl, python3, openssl.

set -euo pipefail

# --- 0. Nombre de proyecto — validado ANTES de cualquier otra acción ---
PROJECT="${1:-gapssa-s4-acl-rehearsal-$(openssl rand -hex 4)}"
case "$PROJECT" in
gapssa-s4-acl-rehearsal-*) ;;
*)
  echo "ERROR: el nombre de proyecto debe empezar por 'gapssa-s4-acl-rehearsal-' (recibido: '$PROJECT')." >&2
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
ESPOCRM_IMAGE="espocrm/espocrm:10.0.3-apache-trixie"
MARIADB_IMAGE="mariadb:11.4"

# capture_cmd es un passthrough aquí (sin concepto de --dry-run) — lo
# exige lib/aclRest.sh, compartido con gate_s4/gate_s9.
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
  say "Resultados: fail_count=$fail_count"
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
HTTP_PORT="$((21000 + RANDOM % 5000))"

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

# --- 4. Config curl admin — credencial nunca en argv/JSON, siempre vía -K ---
{
  echo "silent"
  echo "show-error"
  echo "user = \"${ADMIN_USER}:${ADMIN_PASSWORD}\""
  echo "fail"
} >"$CURL_CFG"
chmod 600 "$CURL_CFG"

# --- 5. Helpers de fixture (creación/borrado/relación de identidades FICTICIAS) ---
rest_create_role() {
  local payload
  payload="$(NAME="$1" python3 -c 'import os, json; print(json.dumps({"name": os.environ["NAME"], "data": {}, "fieldData": {}}))')"
  curl -K "$CURL_CFG" -sS -X POST -H "Content-Type: application/json" --data "$payload" \
    "http://localhost:${HTTP_PORT}/api/v1/Role" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'
}

rest_create_team() {
  local payload
  payload="$(NAME="$1" python3 -c 'import os, json; print(json.dumps({"name": os.environ["NAME"], "rolesIds": []}))')"
  curl -K "$CURL_CFG" -sS -X POST -H "Content-Type: application/json" --data "$payload" \
    "http://localhost:${HTTP_PORT}/api/v1/Team" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'
}

rest_create_user() {
  # $1=userName $2=rolesIds-csv $3=teamsIds-csv -> imprime el id nuevo
  local payload
  payload="$(USERNAME="$1" ROLES="$2" TEAMS="$3" python3 -c '
import os, json
roles = [r for r in os.environ["ROLES"].split(",") if r]
teams = [t for t in os.environ["TEAMS"].split(",") if t]
print(json.dumps({"userName": os.environ["USERNAME"], "type": "api", "isActive": True, "rolesIds": roles, "teamsIds": teams, "lastName": "Fixture"}))
')"
  curl -K "$CURL_CFG" -sS -X POST -H "Content-Type: application/json" --data "$payload" \
    "http://localhost:${HTTP_PORT}/api/v1/User" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])'
}

rest_relate() {
  # $1=User id $2=link ("teams"|"roles") $3=id a relacionar -- esto SÍ debe
  # propagar su fallo (parte del "antes"/"después" real que el caso está
  # ejercitando, no limpieza best-effort).
  curl -K "$CURL_CFG" -sS -X POST -H "Content-Type: application/json" --data "{\"id\":\"$3\"}" \
    "http://localhost:${HTTP_PORT}/api/v1/User/$1/$2" >/dev/null
}

rest_unrelate() {
  # $1=User id $2=link ("teams"|"roles") $3=id a desrelacionar -- limpieza
  # best-effort tras las aserciones del caso (mismo criterio que
  # rest_delete): un 404/fallo aquí nunca debe abortar el ensayo bajo
  # `set -e`, el teardown del proyecto desechable completo se encarga del
  # resto igualmente.
  curl -K "$CURL_CFG" -sS -X DELETE "http://localhost:${HTTP_PORT}/api/v1/User/$1/$2/$3" >/dev/null 2>&1 || true
}

rest_delete() {
  local entity="$1" id="$2"
  [ -z "$id" ] && return 0
  curl -K "$CURL_CFG" -sS -X DELETE "http://localhost:${HTTP_PORT}/api/v1/${entity}/${id}" >/dev/null 2>&1 || true
}

FX_USER="" FX_ROLE_A="" FX_ROLE_B="" FX_TEAM_A="" FX_TEAM_B=""
cleanup_case_fixtures() {
  rest_delete User "$FX_USER"
  rest_delete Team "$FX_TEAM_A"
  rest_delete Team "$FX_TEAM_B"
  rest_delete Role "$FX_ROLE_A"
  rest_delete Role "$FX_ROLE_B"
  FX_USER="" FX_ROLE_A="" FX_ROLE_B="" FX_TEAM_A="" FX_TEAM_B=""
}

# --- 6. Casos reales de _s4_fetch_portal_acl_canonical ---

say ""
say "=== Caso 1: sin cambio real -> ambas capturas coinciden ==="
FX_ROLE_A="$(rest_create_role "s4-rehearsal-role-a-$(openssl rand -hex 3)")"
FX_TEAM_A="$(rest_create_team "s4-rehearsal-team-a-$(openssl rand -hex 3)")"
FX_USER="$(rest_create_user "s4-rehearsal-user-$(openssl rand -hex 3)" "$FX_ROLE_A" "$FX_TEAM_A")"
before="$(_s4_fetch_portal_acl_canonical "$CURL_CFG" "$HTTP_PORT" "$FX_USER")"
after="$(_s4_fetch_portal_acl_canonical "$CURL_CFG" "$HTTP_PORT" "$FX_USER")"
report "Caso 1: ambas lecturas tienen éxito" "$([ -n "$before" ] && [ -n "$after" ] && echo true || echo false)"
report "Caso 1: canónicamente idénticas (sin cambio real)" "$([ "$before" = "$after" ] && echo true || echo false)"
cleanup_case_fixtures

say ""
say "=== Caso 2: deriva REAL de equipo (relate un segundo equipo entre capturas) ==="
FX_ROLE_A="$(rest_create_role "s4-rehearsal-role-a-$(openssl rand -hex 3)")"
FX_TEAM_A="$(rest_create_team "s4-rehearsal-team-a-$(openssl rand -hex 3)")"
FX_TEAM_B="$(rest_create_team "s4-rehearsal-team-b-$(openssl rand -hex 3)")"
FX_USER="$(rest_create_user "s4-rehearsal-user-$(openssl rand -hex 3)" "$FX_ROLE_A" "$FX_TEAM_A")"
before="$(_s4_fetch_portal_acl_canonical "$CURL_CFG" "$HTTP_PORT" "$FX_USER")"
rest_relate "$FX_USER" teams "$FX_TEAM_B"
after="$(_s4_fetch_portal_acl_canonical "$CURL_CFG" "$HTTP_PORT" "$FX_USER")"
report "Caso 2: ambas lecturas tienen éxito" "$([ -n "$before" ] && [ -n "$after" ] && echo true || echo false)"
report "Caso 2: la comparación canónica SÍ detecta la deriva real de equipo" "$([ "$before" != "$after" ] && echo true || echo false)"
rest_unrelate "$FX_USER" teams "$FX_TEAM_B"
cleanup_case_fixtures

say ""
say "=== Caso 3: deriva REAL de rol (relate un segundo rol entre capturas) ==="
FX_ROLE_A="$(rest_create_role "s4-rehearsal-role-a-$(openssl rand -hex 3)")"
FX_ROLE_B="$(rest_create_role "s4-rehearsal-role-b-$(openssl rand -hex 3)")"
FX_USER="$(rest_create_user "s4-rehearsal-user-$(openssl rand -hex 3)" "$FX_ROLE_A" "")"
before="$(_s4_fetch_portal_acl_canonical "$CURL_CFG" "$HTTP_PORT" "$FX_USER")"
rest_relate "$FX_USER" roles "$FX_ROLE_B"
after="$(_s4_fetch_portal_acl_canonical "$CURL_CFG" "$HTTP_PORT" "$FX_USER")"
report "Caso 3: ambas lecturas tienen éxito" "$([ -n "$before" ] && [ -n "$after" ] && echo true || echo false)"
report "Caso 3: la comparación canónica SÍ detecta la deriva real de rol" "$([ "$before" != "$after" ] && echo true || echo false)"
rest_unrelate "$FX_USER" roles "$FX_ROLE_B"
cleanup_case_fixtures

say ""
say "=== Caso 4: usuario inexistente -> falla cerrado (exit != 0, nunca stdout con datos) ==="
set +e
out="$(_s4_fetch_portal_acl_canonical "$CURL_CFG" "$HTTP_PORT" "no-existe-este-id-$(openssl rand -hex 8)")"
rc=$?
set -e
report "Caso 4: exit code no-cero" "$([ "$rc" -ne 0 ] && echo true || echo false)"
report "Caso 4: sin stdout (nunca datos junto a un fallo)" "$([ -z "$out" ] && echo true || echo false)"

say ""
say "Casos ejecutados. fail_count=$fail_count (el teardown se ejecuta a continuación vía trap)."
# El trap EXIT hace el resto: down -v, verify-clean, y el exit code final.
