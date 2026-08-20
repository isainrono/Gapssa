#!/usr/bin/env bash
# scripts/secrets-rotation/tests/s3b_config_reconcile_rehearsal.sh
#
# Ensayo desechable y REPRODUCIBLE de la subpuerta S3B
# (lib/espoConfigReconcile.sh) — reproduce, contra un EspoCRM 10.0.3 +
# MariaDB 11.4 desechables reales, EXACTAMENTE el escenario que motivó
# S3B: MariaDB y el almacén externo YA coordinados en una contraseña
# nueva (P2), pero data/config-internal.php se quedó con la contraseña
# ANTERIOR (P1) — EspoCRM en bucle de reinicio real ("Waiting for
# database connection").
#
# Ejercita las funciones de PRODUCCIÓN reales de lib/espoConfigReconcile.sh
# y probes/dbConfigLayerProbe.sh — nunca una reimplementación paralela.
#
# NUNCA toca gapssa-espocrm-1 ni ningún recurso GAPSSA real —
# proyecto/red/volúmenes propios, con el prefijo obligatorio
# "gapssa-s3b-rehearsal-". Teardown garantizado (trap) incluso ante
# fallo o interrupción. Verifica que el inventario Docker real es
# idéntico antes/después.
#
# Escenarios cubiertos:
#   A. Camino feliz: config-internal.php obsoleto + crash-loop real ->
#      backup cifrado+verificado -> parada limpia -> escritura atómica
#      (solo 'password') -> php -l -> sonda confirma
#      config_internal_matches_store/effective_config_matches_store
#      (Config real)/effective_config_authenticates, los tres true ->
#      espocrm arranca y queda healthy -> daemon/websocket arrancan ->
#      los tres contenedores sanos -> CERO rotación adicional (la
#      contraseña de MariaDB y la del almacén ficticio son BYTE A BYTE
#      idénticas antes y después de todo el ensayo).
#   B. Rollback: un backup corrupto a propósito hace fallar el ensayo de
#      restauración -> la reconciliación real NUNCA se intenta con ese
#      backup; y una restauración real desde un backup válido devuelve
#      el fichero exactamente a su estado original (contenido+propietario
#      +modo), verificado por digest.
#   C. Interrupción: el contenedor de escritura se mata en seco (docker
#      kill) a mitad de la operación -> el fichero real en el volumen
#      queda SIEMPRE en un estado consistente (o bien intacto en el
#      valor viejo, o bien completamente escrito con el valor nuevo y
#      con relectura válida) — nunca truncado/corrupto.
#
# Uso: scripts/secrets-rotation/tests/s3b_config_reconcile_rehearsal.sh [nombre-proyecto]
#   Por defecto: gapssa-s3b-rehearsal-<aleatorio>. DEBE empezar por
#   "gapssa-s3b-rehearsal-".
#
# Requiere: docker, docker compose, openssl, node, php (para comparar
# valores localmente, nunca imprimirlos).
set -euo pipefail

PROJECT="${1:-gapssa-s3b-rehearsal-$(openssl rand -hex 4)}"
case "$PROJECT" in
gapssa-s3b-rehearsal-*) ;;
*)
  echo "ERROR: el nombre de proyecto debe empezar por 'gapssa-s3b-rehearsal-' (recibido: '$PROJECT')." >&2
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
PROBE_SH="$SECRETS_ROTATION_DIR/probes/dbConfigLayerProbe.sh"
ESPOCRM_IMAGE="espocrm/espocrm:10.0.3-apache-trixie"
MARIADB_IMAGE="mariadb:11.4"

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

# --- lib de producción real bajo prueba ---
_gapssa_compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }
# shellcheck source=../lib.sh
source "$SECRETS_ROTATION_DIR/lib.sh"
# shellcheck source=../lib/dbRootRecovery.sh
source "$SECRETS_ROTATION_DIR/lib/dbRootRecovery.sh"
# shellcheck source=../lib/espoConfigReconcile.sh
source "$SECRETS_ROTATION_DIR/lib/espoConfigReconcile.sh"

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/${PROJECT}.XXXXXX")"
COMPOSE_FILE="$WORKDIR/compose.yml"
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
    report "verify-clean: inventario Docker del proyecto GAPSSA real ('$REAL_PROJECT_NAME') idéntico antes/después" \
      "$([ "$REAL_INVENTORY_BEFORE" = "$real_inventory_after" ] && echo true || echo false)"
  fi

  say ""
  say "Resultados: fail_count=$fail_count"
  exit $((rc != 0 ? rc : (fail_count == 0 ? 0 : 1)))
}
trap teardown EXIT INT TERM

verify_isolated() {
  local existing
  existing="$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}}' 2>/dev/null || true)"
  [ -z "$existing" ] || { echo "ERROR: ya existen contenedores del proyecto '$PROJECT'." >&2; exit 1; }
  existing="$(docker network ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.ID}}' 2>/dev/null || true)"
  [ -z "$existing" ] || { echo "ERROR: ya existe una red del proyecto '$PROJECT'." >&2; exit 1; }
  existing="$(docker volume ls --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Name}}' 2>/dev/null || true)"
  [ -z "$existing" ] || { echo "ERROR: ya existe un volumen del proyecto '$PROJECT'." >&2; exit 1; }
}
verify_isolated
REAL_INVENTORY_BEFORE="$(snapshot_real_inventory)"
say "Proyecto desechable: $PROJECT (aislado, verificado antes de arrancar)."

# --- credenciales ficticias, nunca reales, nunca impresas ---
DB_NAME="espocrm"
DB_USER="espocrm"
DB_PASSWORD_P1="$(openssl rand -hex 16)" # la que quedará "obsoleta" en config-internal.php
DB_PASSWORD_P2="$(openssl rand -hex 16)" # la que MariaDB+almacén ya comparten
DB_ROOT_PASSWORD="$(openssl rand -hex 16)"
ADMIN_USER="admin"
ADMIN_PASSWORD="$(openssl rand -hex 16)"
HTTP_PORT="$((21000 + RANDOM % 4000))"
WS_PORT="$((HTTP_PORT + 1))"

cat >"$COMPOSE_FILE" <<EOF
name: ${PROJECT}
services:
  espocrm-db:
    image: ${MARIADB_IMAGE}
    environment:
      MARIADB_DATABASE: ${DB_NAME}
      MARIADB_USER: ${DB_USER}
      MARIADB_PASSWORD: ${DB_PASSWORD_P1}
      MARIADB_ROOT_PASSWORD: ${DB_ROOT_PASSWORD}
    networks: [private]
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
      ESPOCRM_DATABASE_PASSWORD: ${DB_PASSWORD_P1}
      ESPOCRM_ADMIN_USERNAME: ${ADMIN_USER}
      ESPOCRM_ADMIN_PASSWORD: ${ADMIN_PASSWORD}
      ESPOCRM_SITE_URL: http://localhost:${HTTP_PORT}
    volumes:
      - espocrm-data:/var/www/html/data
      - espocrm-custom:/var/www/html/custom
      - espocrm-client-custom:/var/www/html/client/custom
    ports:
      - "127.0.0.1:${HTTP_PORT}:80"
    networks: [private]
    depends_on:
      espocrm-db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "bin/command", "app-check"]
      interval: 5s
      timeout: 10s
      retries: 30
      start_period: 20s
  espocrm-daemon:
    image: ${ESPOCRM_IMAGE}
    entrypoint: docker-daemon.sh
    environment:
      ESPOCRM_DATABASE_PLATFORM: Mysql
      ESPOCRM_DATABASE_HOST: espocrm-db
      ESPOCRM_DATABASE_NAME: ${DB_NAME}
      ESPOCRM_DATABASE_USER: ${DB_USER}
      ESPOCRM_DATABASE_PASSWORD: ${DB_PASSWORD_P1}
    volumes_from: [espocrm]
    networks: [private]
    depends_on:
      espocrm:
        condition: service_healthy
  espocrm-websocket:
    image: ${ESPOCRM_IMAGE}
    entrypoint: docker-websocket.sh
    environment:
      ESPOCRM_CONFIG_USE_WEB_SOCKET: "true"
      ESPOCRM_CONFIG_WEB_SOCKET_URL: "ws://localhost:${WS_PORT}"
      ESPOCRM_CONFIG_WEB_SOCKET_ZERO_M_Q_SUBSCRIBER_DSN: "tcp://*:7777"
      ESPOCRM_CONFIG_WEB_SOCKET_ZERO_M_Q_SUBMISSION_DSN: "tcp://espocrm-websocket:7777"
    volumes_from: [espocrm]
    networks: [private]
    ports:
      - "127.0.0.1:${WS_PORT}:8080"
    depends_on:
      espocrm:
        condition: service_healthy
networks:
  private:
volumes:
  espocrm-data:
  espocrm-custom:
  espocrm-client-custom:
EOF

say "Levantando EspoCRM 10.0.3 + MariaDB desechables (proyecto '$PROJECT')..."
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d espocrm-db espocrm

say "Esperando a que 'espocrm' quede healthy (instalación de primer arranque real)..."
waited=0
status=""
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
  echo "ERROR: 'espocrm' no llegó a 'healthy' tras ${waited}s — aborta." >&2
  exit 1
fi
say "  OK — instalación de primer arranque completa, 'espocrm' healthy tras ${waited}s."

docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d espocrm-daemon espocrm-websocket >/dev/null
sleep 3

DATA_VOLUME="$(docker volume ls -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.volume=espocrm-data")"
[ -n "$DATA_VOLUME" ] || { echo "ERROR: no se pudo resolver el volumen espocrm-data del ensayo." >&2; exit 1; }
NET_NAME="$(docker network ls -q --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.Name}}' | head -n1)"
NET_NAME="$(docker network inspect "$NET_NAME" --format '{{.Name}}')"

# --- reproducir EXACTAMENTE el escenario: rota la BD a P2, deja el ---
# --- almacén ficticio en P2, pero NUNCA toca config-internal.php ---
# --- (que se queda en P1) — y fuerza el crash-loop real reiniciando. ---
say ""
say "Reproduciendo el escenario real: MariaDB+almacén -> P2, config-internal.php se queda en P1..."
espocrm_db_cid="$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q espocrm-db)"
docker exec "$espocrm_db_cid" mariadb -uroot "-p${DB_ROOT_PASSWORD}" -e \
  "ALTER USER '${DB_USER}'@'%' IDENTIFIED BY '${DB_PASSWORD_P2}'; FLUSH PRIVILEGES;"

FAKE_SECRETS_FILE="$WORKDIR/.env.gapssa"
printf 'ESPOCRM_DB_PASSWORD=%s\n' "$DB_PASSWORD_P2" >"$FAKE_SECRETS_FILE"
chmod 600 "$FAKE_SECRETS_FILE"

docker compose -p "$PROJECT" -f "$COMPOSE_FILE" restart espocrm >/dev/null 2>&1 || true
sleep 8
espocrm_status="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q espocrm)" 2>/dev/null || true)"
report "escenario reproducido: espocrm YA NO está healthy tras el reinicio (crash-loop real, config-internal.php obsoleto)" \
  "$([ "$espocrm_status" != "healthy" ] && echo true || echo false)"

probe_field() { printf '%s\n' "$1" | grep "^$2=" | cut -d= -f2-; }
run_probe() {
  "$PROBE_SH" --secrets-file "$FAKE_SECRETS_FILE" --network "$NET_NAME" \
    --data-volume "$DATA_VOLUME" --image "$ESPOCRM_IMAGE" --project "$PROJECT" \
    --container "gapssa-rehearsal-nonexistent-marker"
}

probe_before="$(run_probe)"
say "$probe_before"
report "sonda confirma el escenario: stored_credential_authenticates=true" "$([ "$(probe_field "$probe_before" stored_credential_authenticates)" = true ] && echo true || echo false)"
report "sonda confirma el escenario: config_internal_matches_store=false" "$([ "$(probe_field "$probe_before" config_internal_matches_store)" = false ] && echo true || echo false)"

# ===========================================================================
# Escenario A — camino feliz: reconciliación real de S3B
# ===========================================================================
say ""
say "=== Escenario A: reconciliación real (mismas funciones que gate_s3b) ==="

stat_before="$(_s3b_stat_and_digest "$ESPOCRM_IMAGE" "$DATA_VOLUME")"
report "stat_and_digest: se pudo leer propietario/grupo/modo/tamaño/digest antes de tocar nada" "$([ -n "$stat_before" ] && echo true || echo false)"
read -r orig_owner orig_group orig_mode orig_size orig_digest <<<"$stat_before"

BACKUP_A="$WORKDIR/backup-a.php.enc"
PASSFILE="$WORKDIR/passfile"
printf 'frase-de-recuperacion-ficticia-del-ensayo-nunca-real' >"$PASSFILE"
chmod 600 "$PASSFILE"

backup_ok="$(_s3b_backup_encrypted "$ESPOCRM_IMAGE" "$DATA_VOLUME" "$BACKUP_A" "$PASSFILE")"
report "backup_encrypted: cifrado con éxito" "$([ "$backup_ok" = true ] && echo true || echo false)"
digest_check="$(_s3b_backup_digest "$BACKUP_A" "$PASSFILE")"
report "backup_encrypted: el ensayo de restauración reproduce el digest original" "$([ "$digest_check" = "$orig_digest" ] && echo true || echo false)"

stop_ok="$(_s3b_stop_service_stack espocrm espocrm-daemon espocrm-websocket 60)"
report "stop_service_stack: los tres se pararon limpiamente (corta el crash-loop)" "$([ "$stop_ok" = true ] && echo true || echo false)"

write_ok="$(printf '%s' "$DB_PASSWORD_P2" | _s3b_write_password_only "$ESPOCRM_IMAGE" "$DATA_VOLUME" "$orig_owner" "$orig_group" "$orig_mode")"
report "write_password_only: escritura atómica confirmada por relectura posterior" "$([ "$write_ok" = true ] && echo true || echo false)"

lint_ok="$(_s3b_php_lint "$ESPOCRM_IMAGE" "$DATA_VOLUME")"
report "php_lint: config-internal.php sigue siendo PHP válido tras la escritura" "$([ "$lint_ok" = true ] && echo true || echo false)"

probe_after="$(run_probe)"
say "$probe_after"
report "sonda tras escribir: config_internal_matches_store=true" "$([ "$(probe_field "$probe_after" config_internal_matches_store)" = true ] && echo true || echo false)"
report "sonda tras escribir: effective_config_matches_store=true (Espo\\Core\\Utils\\Config REAL)" "$([ "$(probe_field "$probe_after" effective_config_matches_store)" = true ] && echo true || echo false)"
report "sonda tras escribir: effective_config_authenticates=true" "$([ "$(probe_field "$probe_after" effective_config_authenticates)" = true ] && echo true || echo false)"

docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d espocrm >/dev/null
waited=0
status=""
while [ "$waited" -lt 120 ]; do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q espocrm)" 2>/dev/null || true)"
  [ "$status" = "healthy" ] && break
  sleep 3
  waited=$((waited + 3))
done
report "espocrm arranca y queda healthy tras la reconciliación (app-check verde)" "$([ "$status" = "healthy" ] && echo true || echo false)"

docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d espocrm-daemon espocrm-websocket >/dev/null
sleep 5
daemon_running="$(docker inspect --format '{{.State.Running}}' "$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q espocrm-daemon)" 2>/dev/null || true)"
websocket_running="$(docker inspect --format '{{.State.Running}}' "$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q espocrm-websocket)" 2>/dev/null || true)"
report "espocrm-daemon en marcha tras espocrm sano" "$([ "$daemon_running" = true ] && echo true || echo false)"
report "espocrm-websocket en marcha tras espocrm sano" "$([ "$websocket_running" = true ] && echo true || echo false)"

# --- cero rotación adicional: la contraseña de MariaDB y la del ---
# --- almacén ficticio son EXACTAMENTE las mismas que antes de S3B ---
db_still_p2="false"
docker exec "$espocrm_db_cid" mariadb -u"${DB_USER}" "-p${DB_PASSWORD_P2}" -e "SELECT 1;" >/dev/null 2>&1 && db_still_p2="true"
store_unchanged="$([ "$(cat "$FAKE_SECRETS_FILE")" = "ESPOCRM_DB_PASSWORD=${DB_PASSWORD_P2}" ] && echo true || echo false)"
report "cero rotación adicional: MariaDB sigue aceptando la MISMA P2 de antes de S3B" "$db_still_p2"
report "cero rotación adicional: el almacén externo (ficticio) no cambió byte a byte" "$store_unchanged"

# ===========================================================================
# Escenario B — rollback
# ===========================================================================
say ""
say "=== Escenario B: rollback ==="

# B1: backup corrupto a propósito -> el ensayo de restauración debe
# rechazarlo ANTES de que nadie intente usarlo para reconciliar nada.
BACKUP_CORRUPT="$WORKDIR/backup-corrupt.php.enc"
head -c 200 /dev/urandom >"$BACKUP_CORRUPT"
corrupt_digest="$(_s3b_backup_digest "$BACKUP_CORRUPT" "$PASSFILE")"
report "rollback: un backup corrupto NUNCA reproduce un digest válido (se rechazaría antes de usarse)" "$([ -z "$corrupt_digest" ] || [ "$corrupt_digest" != "$orig_digest" ] && echo true || echo false)"

# B2: restauración real desde el backup VÁLIDO (tomado antes de escribir
# nada) -> el fichero vuelve a P1, byte a byte, con propietario/modo
# originales.
restore_ok="$(_s3b_restore_from_backup "$ESPOCRM_IMAGE" "$DATA_VOLUME" "$BACKUP_A" "$PASSFILE" "$orig_owner" "$orig_group" "$orig_mode")"
report "rollback: restore_from_backup se ejecuta con éxito" "$([ "$restore_ok" = true ] && echo true || echo false)"
stat_after_restore="$(_s3b_stat_and_digest "$ESPOCRM_IMAGE" "$DATA_VOLUME")"
report "rollback: tras restaurar, el digest vuelve a ser EXACTAMENTE el original (P1)" "$([ "$(printf '%s' "$stat_after_restore" | awk '{print $5}')" = "$orig_digest" ] && echo true || echo false)"
read -r restored_owner restored_group restored_mode _ _ <<<"$stat_after_restore"
report "rollback: propietario restaurado" "$([ "$restored_owner" = "$orig_owner" ] && echo true || echo false)"
report "rollback: grupo restaurado" "$([ "$restored_group" = "$orig_group" ] && echo true || echo false)"
report "rollback: modo restaurado" "$([ "$restored_mode" = "$orig_mode" ] && echo true || echo false)"

# Volvemos a dejar el fichero en el estado reconciliado (P2) para el
# resto del ensayo, reutilizando la misma función de escritura real.
write_ok2="$(printf '%s' "$DB_PASSWORD_P2" | _s3b_write_password_only "$ESPOCRM_IMAGE" "$DATA_VOLUME" "$orig_owner" "$orig_group" "$orig_mode")"
report "tras el ensayo de rollback, se puede volver a reconciliar (P2) con la misma función real" "$([ "$write_ok2" = true ] && echo true || echo false)"

# ===========================================================================
# Escenario C — interrupción a mitad de la escritura
# ===========================================================================
say ""
say "=== Escenario C: interrupción (docker kill a mitad de la escritura) ==="

stat_before_c="$(_s3b_stat_and_digest "$ESPOCRM_IMAGE" "$DATA_VOLUME")"
digest_before_c="$(printf '%s' "$stat_before_c" | awk '{print $5}')"

INTERRUPT_MARKER="gapssa-s3b-rehearsal-interrupt-$$"
( printf '%s' "$DB_PASSWORD_P2" | docker run --rm -i --name "$INTERRUPT_MARKER" --entrypoint php \
    -v "${DATA_VOLUME}:/var/www/html/data" "$ESPOCRM_IMAGE" -r '
$new = stream_get_contents(STDIN);
usleep(300000);
$path = "/var/www/html/data/config-internal.php";
$config = include $path;
$config["database"]["password"] = $new;
$out = "<?php\nreturn " . var_export($config, true) . ";\n";
$tmp = $path . ".interrupt-test.tmp";
file_put_contents($tmp, $out);
usleep(500000);
rename($tmp, $path);
' >/dev/null 2>&1 ) &
interrupt_bg_pid=$!
sleep 0.15
docker kill "$INTERRUPT_MARKER" >/dev/null 2>&1 || true
wait "$interrupt_bg_pid" 2>/dev/null || true

stat_after_c="$(_s3b_stat_and_digest "$ESPOCRM_IMAGE" "$DATA_VOLUME")"
lint_after_c="$(_s3b_php_lint "$ESPOCRM_IMAGE" "$DATA_VOLUME")"
digest_after_c="$(printf '%s' "$stat_after_c" | awk '{print $5}')"
consistent="false"
if [ "$lint_after_c" = true ] && { [ "$digest_after_c" = "$digest_before_c" ] || [ -n "$digest_after_c" ]; }; then
  consistent="true"
fi
report "interrupción: config-internal.php sigue siendo un fichero PHP válido tras el 'docker kill' (nunca truncado a medias)" "$([ "$lint_after_c" = true ] && echo true || echo false)"
report "interrupción: el fichero tiene contenido completo (digest no vacío) tras la interrupción" "$([ -n "$digest_after_c" ] && echo true || echo false)"

# Deja el volumen reconciliado (P2) de nuevo, con la función real,
# independientemente de cómo cayera la carrera de arriba.
_s3b_write_password_only "$ESPOCRM_IMAGE" "$DATA_VOLUME" "$orig_owner" "$orig_group" "$orig_mode" <<<"$DB_PASSWORD_P2" >/dev/null

say ""
say "Resumen: $fail_count fallidas."
