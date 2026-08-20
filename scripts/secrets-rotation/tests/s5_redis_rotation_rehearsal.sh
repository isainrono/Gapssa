#!/usr/bin/env bash
# scripts/secrets-rotation/tests/s5_redis_rotation_rehearsal.sh
#
# Ensayo desechable y REPRODUCIBLE, contra un Redis 8 REAL (nunca un
# mock), de las piezas nuevas/endurecidas de la puerta S5:
#   - lib/updateRedisSecrets.mjs (actualización atómica REDIS_PASSWORD +
#     REDIS_URL, URL parseada de verdad — ya cubierto exhaustivamente por
#     lib/updateRedisSecrets.test.mjs a nivel de unidad; aquí se
#     comprueba además que la REDIS_URL que produce autentica DE VERDAD
#     contra Redis real, no solo que el texto es correcto);
#   - lib/redisVerify.mjs (PING autenticado por TCP real);
#   - lib/redisDataBaseline.mjs + la comparación dbsize/TTL que gate_s5
#     usa para decidir "datos conservados" tras un force-recreate real.
#
# Reproduce, en el mismo orden que gate_s5 (rotate-all-interactive.sh),
# la secuencia real: capturar línea base -> escribir atómicamente ->
# force-recreate -> healthcheck -> PING nuevo -> PING anterior rechazado
# -> línea base después -> comparación. La máquina de estados que rodea
# esa secuencia en gate_s5 (rollback_required al fallar tras escribir,
# nunca 'failed') NO se reensaya aquí (ya cubierta por
# tests/run_scenarios.py::scenario_ctrl_c_mid_gate /
# scenario_resume_after_interrupt contra la MISMA máquina genérica
# S2-S5 -- lib/decideRecoveryPlan.mjs, lib/recoveryEvidence.sh -- que
# _s5_mark_rollback_required reutiliza sin cambios).
#
# NUNCA toca gapssa-espocrm-1/gapssa-apps-db-1/el Redis real del
# proyecto GAPSSA. NUNCA imprime una contraseña real. Teardown
# garantizado (trap) incluso ante fallo. Verifica que el inventario
# Docker del proyecto GAPSSA real es idéntico antes/después.
#
# Uso: scripts/secrets-rotation/tests/s5_redis_rotation_rehearsal.sh [nombre-proyecto]
#   El nombre de proyecto (por defecto: gapssa-s5-rehearsal-<aleatorio>)
#   DEBE empezar por "gapssa-s5-rehearsal-".
#
# Requiere: docker, docker compose, node, openssl.

set -euo pipefail

# --- 0. Nombre de proyecto — validado ANTES de cualquier otra acción ---
PROJECT="${1:-gapssa-s5-rehearsal-$(openssl rand -hex 4)}"
case "$PROJECT" in
gapssa-s5-rehearsal-*) ;;
*)
  echo "ERROR: el nombre de proyecto debe empezar por 'gapssa-s5-rehearsal-' (recibido: '$PROJECT')." >&2
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
REDIS_IMAGE="redis:8-alpine"

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
SECRETS_FILE="$WORKDIR/secrets.env"
SEED_SCRIPT=""
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
  rm -rf "$WORKDIR" 2>/dev/null || true
  [ -n "$SEED_SCRIPT" ] && rm -f "$SEED_SCRIPT" 2>/dev/null || true

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

# --- 2. verify-isolated ---
verify_isolated() {
  local existing
  existing="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}}' 2>/dev/null || true)"
  if [ -n "$existing" ]; then
    echo "ERROR: ya existen contenedores del proyecto '$PROJECT' — aborta (nunca reutiliza estado)." >&2
    exit 1
  fi
}
verify_isolated
REAL_INVENTORY_BEFORE="$(snapshot_real_inventory)"
say "Proyecto desechable: $PROJECT (aislado, verificado antes de arrancar)."

# --- 3. Credencial inicial ficticia + compose.yml mínimo (mismo servicio
#        real que compose.yml del repo: --requirepass, --appendonly yes,
#        volumen nombrado, healthcheck vía redis-cli). ---
INITIAL_PASSWORD="$(openssl rand -base64 24)"
HOST_PORT="$((22000 + RANDOM % 5000))"

cat >"$COMPOSE_FILE" <<EOF
name: ${PROJECT}
services:
  redis:
    image: ${REDIS_IMAGE}
    environment:
      REDIS_PASSWORD: \${REDIS_PASSWORD}
    command: >-
      redis-server
      --requirepass \${REDIS_PASSWORD}
      --appendonly yes
    volumes:
      - redis-data:/data
    ports:
      - "127.0.0.1:${HOST_PORT}:6379"
    healthcheck:
      test: ["CMD-SHELL", "redis-cli -a \$\$REDIS_PASSWORD ping | grep -q PONG"]
      interval: 2s
      timeout: 3s
      retries: 30
      start_period: 5s
volumes:
  redis-data:
EOF

# La REDIS_URL inicial debe llevar la contraseña YA percent-encoded —
# exactamente como la dejaría este mismo toolkit tras una rotación real
# — nunca cruda: INITIAL_PASSWORD (base64) puede contener "/" o "+", que
# en crudo dentro de una URL rompen la propia sintaxis de autoridad
# (esto es precisamente lo que lib/updateRedisSecrets.mjs rechaza cerrado
# más abajo si se le pasa una REDIS_URL preexistente mal formada — la
# primera versión de este ensayo tenía este mismo bug en su propia
# fixture y lo confirmó exactamente así).
INITIAL_REDIS_URL="$(INITIAL_PASSWORD="$INITIAL_PASSWORD" HOST_PORT="$HOST_PORT" node -e '
const u = new URL(`redis://:x@localhost:${process.env.HOST_PORT}`)
u.password = process.env.INITIAL_PASSWORD
process.stdout.write(u.toString())
')"
# lib/updateRedisSecrets.mjs valida el DOCUMENTO COMPLETO reconstruido
# contra el inventario/obligatorias del esquema "active" (mismo patrón
# que updateSecretsFileField.mjs) — nunca solo las dos líneas que toca.
# Un $SECRETS_FILE real siempre las tiene todas (nace de .env.example vía
# S1); esta fixture desechable las replica con valores ficticios NO
# REDIS_* (reutilizando el generador ya usado por
# tests/run_scenarios.py::write_active_env_file) para que el ensayo
# ejercite la validación real, no una versión debilitada de ella.
python3 - "$SECRETS_ROTATION_DIR" "$SECRETS_FILE" "$INITIAL_PASSWORD" "$INITIAL_REDIS_URL" "$HOST_PORT" <<'EOF'
import sys
sr_dir, out_path, redis_password, redis_url, host_port = sys.argv[1:6]
sys.path.insert(0, f"{sr_dir}/tests")
import run_scenarios as rs
active = dict(rs.FIXTURE_ENV)
active.pop("BOOKING_EMAIL_LOOKUP_HMAC_SECRET", None)
active.pop("BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET", None)
active["BOOKING_EMAIL_LOOKUP_HMAC_SECRETS"] = '{"v1":"Zml4dHVyZS1pbml0aWFsLWVtYWlsLWhtYWMtMDAwMDAwMDA="}'
active["BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION"] = "v1"
active["BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS"] = '{"v1":"Zml4dHVyZS1pbml0aWFsLWF0LWtleS0wMDAwMDAwMDAwMA=="}'
active["BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION"] = "v1"
active["REDIS_PASSWORD"] = redis_password
active["REDIS_URL"] = redis_url
active["REDIS_HOST_PORT"] = host_port
with open(out_path, "w") as f:
    for k, v in active.items():
        f.write(f"{k}={v}\n")
EOF
chmod 600 "$SECRETS_FILE"

compose() { REDIS_PASSWORD="$1" docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "${@:2}"; }

say "Levantando Redis 8 desechable (proyecto '$PROJECT', puerto 127.0.0.1:${HOST_PORT})..."
compose "$INITIAL_PASSWORD" up -d

wait_healthy() {
  local password="$1" waited=0 status=""
  local cid
  while [ "$waited" -lt 60 ]; do
    cid="$(compose "$password" ps -q redis 2>/dev/null || true)"
    if [ -n "$cid" ]; then
      status="$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || true)"
      [ "$status" = "healthy" ] && return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

if ! wait_healthy "$INITIAL_PASSWORD"; then
  echo "ERROR: redis no llegó a 'healthy' tras arrancar — aborta (teardown se ejecutará igualmente)." >&2
  exit 1
fi
say "  OK — redis healthy con la contraseña inicial."

# --- Helpers de ping/baseline reales (mismo protocolo stdin que usa
#      gate_s5: config JSON + contraseña cruda) ---
redis_ping() {
  local password="$1"
  printf '{"host":"127.0.0.1","port":%s}\n%s' "$HOST_PORT" "$password" | node "$SECRETS_ROTATION_DIR/lib/redisVerify.mjs" 2>/dev/null || true
}

redis_baseline() {
  local password="$1"
  printf '{"host":"127.0.0.1","port":%s}\n%s' "$HOST_PORT" "$password" | node "$SECRETS_ROTATION_DIR/lib/redisDataBaseline.mjs" 2>/dev/null || true
}

data_preserved() {
  BEFORE_JSON="$1" AFTER_JSON="$2" python3 -c "
import os, json
before = json.loads(os.environ['BEFORE_JSON'])
after = json.loads(os.environ['AFTER_JSON'])
ok = before['dbsize'] == after['dbsize']
if ok:
    before_ttl = {e['h']: e['ttl'] for e in before['sample']}
    after_ttl = {e['h']: e['ttl'] for e in after['sample']}
    for h in set(before_ttl) & set(after_ttl):
        b, a = before_ttl[h], after_ttl[h]
        if b == -1:
            if a != -1:
                ok = False
                break
        elif a == -2 or a > b:
            ok = False
            break
print('true' if ok else 'false')
" 2>/dev/null || printf false
}

atomic_rotate_pw() {
  # $1 = contraseña anterior (usada por gapssa_secrets_mktemp_secure_same_dir
  #      solo para el nombre del temporal, no como valor) -> imprime la
  # contraseña NUEVA a stdout (única función de este ensayo que maneja el
  # valor en claro, y solo dentro del propio proceso bash, nunca en argv).
  local new_pw pin_lines pin_tmp pin_dir pin_dev pin_ino pin_uid pin_mode
  new_pw="$(openssl rand -base64 24)"
  pin_lines="$(source "$SECRETS_ROTATION_DIR/lib.sh" 2>/dev/null; gapssa_secrets_mktemp_secure_same_dir "$SECRETS_FILE" redis)"
  { read -r pin_tmp; read -r pin_dir; read -r pin_dev pin_ino pin_uid pin_mode; } <<<"$pin_lines"
  if ! printf '%s' "$new_pw" | node "$SECRETS_ROTATION_DIR/lib/updateRedisSecrets.mjs" "$SECRETS_FILE" "$pin_tmp" "$pin_dev" "$pin_ino" "$pin_uid" "$pin_mode" active >/dev/null; then
    rm -f "$pin_tmp"
    printf ''
    return 1
  fi
  printf '%s' "$new_pw"
}

url_password_matches_file_password() {
  # Confirma, contra la REDIS_URL real escrita en el fichero, que
  # decodificar su componente password autentica de verdad contra Redis
  # con la MISMA contraseña que field=REDIS_PASSWORD — demuestra
  # interoperabilidad real, no solo corrección textual (ya cubierta por
  # lib/updateRedisSecrets.test.mjs).
  local pw url url_pw
  pw="$(grep '^REDIS_PASSWORD=' "$SECRETS_FILE" | cut -d= -f2-)"
  url="$(grep '^REDIS_URL=' "$SECRETS_FILE" | cut -d= -f2-)"
  url_pw="$(REDIS_URL="$url" node -e '
try {
  const u = new URL(process.env.REDIS_URL)
  process.stdout.write(decodeURIComponent(u.password))
} catch {
  process.stdout.write("")
}
')"
  [ "$pw" = "$url_pw" ]
}

say ""
say "=== Caso 1: camino feliz completo (baseline -> rotar -> recreate -> healthcheck -> PING nuevo -> PING anterior rechazado -> baseline después) ==="
# Semilla de datos reales con TTL, para que la comparación de línea base
# tenga algo genuino que conservar (nunca datos de negocio, solo claves
# de ensayo desechables). El fichero de semilla vive DENTRO de tests/
# (nunca en $WORKDIR bajo /tmp) a propósito: la resolución de módulos
# ESM de Node sube desde el directorio del propio fichero, y solo
# tests/ tiene, por encima, el node_modules real del repo (mismo motivo
# por el que lib/redisVerify.mjs/redisDataBaseline.mjs SÍ resuelven
# "redis" y un `node -e` inline con CWD distinto no lo garantiza).
SEED_SCRIPT="$SCRIPT_DIR/.tmp-s5-seed-$(openssl rand -hex 4).mjs"
cat >"$SEED_SCRIPT" <<'EOF'
import { createClient } from 'redis'
import readline from 'node:readline'
const rl = readline.createInterface({ input: process.stdin })
const lines = []
rl.on('line', (l) => lines.push(l))
rl.on('close', async () => {
  const config = JSON.parse(lines[0])
  const password = lines.slice(1).join('\n')
  const client = createClient({ socket: { host: config.host, port: config.port }, password })
  await client.connect()
  await client.set('ensayo:s5:clave-persistente', 'valor-ficticio-1')
  await client.set('ensayo:s5:clave-con-ttl', 'valor-ficticio-2', { EX: 3600 })
  await client.destroy()
})
EOF
printf '{"host":"127.0.0.1","port":%s}\n%s' "$HOST_PORT" "$INITIAL_PASSWORD" | node "$SEED_SCRIPT" || true
rm -f "$SEED_SCRIPT"
baseline_before="$(redis_baseline "$INITIAL_PASSWORD")"
report "Caso 1: línea base ANTES capturada (dbsize>=2)" "$(printf '%s' "$baseline_before" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("true" if d["dbsize"]>=2 else "false")' 2>/dev/null || echo false)"

new_pw="$(atomic_rotate_pw || true)"
report "Caso 1: escritura atómica de REDIS_PASSWORD/REDIS_URL -- exit 0" "$([ -n "$new_pw" ] && echo true || echo false)"
report "Caso 1: REDIS_URL del fichero decodifica a la MISMA REDIS_PASSWORD del fichero" "$(url_password_matches_file_password && echo true || echo false)"

if compose "$new_pw" up -d --force-recreate redis >/dev/null 2>&1; then
  report "Caso 1: force-recreate con la contraseña nueva -- exit 0" true
else
  report "Caso 1: force-recreate con la contraseña nueva -- exit 0" false
fi
if wait_healthy "$new_pw"; then
  report "Caso 1: healthcheck healthy tras force-recreate" true
else
  report "Caso 1: healthcheck healthy tras force-recreate" false
fi
ping_new="$(redis_ping "$new_pw")"
report "Caso 1: PING autenticado con la contraseña NUEVA" "$([ "$ping_new" = true ] && echo true || echo false)"
ping_old="$(redis_ping "$INITIAL_PASSWORD")"
report "Caso 1: PING con la contraseña ANTERIOR queda rechazado" "$([ "$ping_old" != true ] && echo true || echo false)"
baseline_after="$(redis_baseline "$new_pw")"
report "Caso 1: línea base DESPUÉS capturada" "$([ -n "$baseline_after" ] && echo true || echo false)"
report "Caso 1: dbsize+TTL conservados tras el force-recreate (volumen intacto)" "$([ "$(data_preserved "$baseline_before" "$baseline_after")" = true ] && echo true || echo false)"

say ""
say "=== Caso 2: healthcheck fallido (contraseña nueva NUNCA se aplica al contenedor -- simula un force-recreate que se queda con el valor viejo) ==="
# La contraseña nueva ya está escrita en el FICHERO (rotación previa),
# pero aquí se fuerza un PING con la contraseña nueva SIN recrear el
# contenedor -- Redis sigue exigiendo la contraseña actual real
# ($new_pw, ya aplicada por el Caso 1) -- se verifica el caso simétrico:
# una contraseña que NUNCA se aplicó realmente (generada aquí mismo, sin
# tocar el contenedor) debe ser rechazada por el PING real.
never_applied_pw="$(openssl rand -base64 24)"
ping_never_applied="$(redis_ping "$never_applied_pw")"
report "Caso 2: PING con una contraseña que nunca se aplicó al contenedor -- rechazado (false)" "$([ "$ping_never_applied" != true ] && echo true || echo false)"

say ""
say "=== Caso 3: reejecución -- dos rotaciones atómicas consecutivas nunca corrompen el fichero ni reutilizan valores ==="
prev_pw="$new_pw"
second_pw="$(atomic_rotate_pw || true)"
report "Caso 3: segunda escritura atómica consecutiva -- exit 0" "$([ -n "$second_pw" ] && echo true || echo false)"
report "Caso 3: la contraseña nueva difiere de la anterior (nunca reutilizada)" "$([ "$second_pw" != "$prev_pw" ] && echo true || echo false)"
report "Caso 3: REDIS_URL del fichero vuelve a decodificar a la contraseña vigente" "$(url_password_matches_file_password && echo true || echo false)"
compose "$second_pw" up -d --force-recreate redis >/dev/null 2>&1 || true
if wait_healthy "$second_pw"; then
  ping_second="$(redis_ping "$second_pw")"
  report "Caso 3: PING autenticado tras la segunda rotación real" "$([ "$ping_second" = true ] && echo true || echo false)"
  ping_prev="$(redis_ping "$prev_pw")"
  report "Caso 3: la contraseña de la PRIMERA rotación queda rechazada tras la segunda" "$([ "$ping_prev" != true ] && echo true || echo false)"
else
  report "Caso 3: PING autenticado tras la segunda rotación real" false
fi

say ""
say "Casos ejecutados. fail_count=$fail_count (el teardown se ejecuta a continuación vía trap)."
# El trap EXIT hace el resto: down -v, verify-clean, y el exit code final.
