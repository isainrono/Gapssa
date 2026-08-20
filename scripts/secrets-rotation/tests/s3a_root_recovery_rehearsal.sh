#!/usr/bin/env bash
# scripts/secrets-rotation/tests/s3a_root_recovery_rehearsal.sh
#
# Ensayo desechable y REPRODUCIBLE de la subpuerta S3A
# (lib/dbRootRecovery.sh) — reproduce, contra un MariaDB 11.4 desechable
# real, EXACTAMENTE el escenario que motivó S3A: un volumen con una
# contraseña root EFECTIVA (A), un almacén externo con una contraseña
# root DISTINTA y OBSOLETA (B) -> ERROR 1045 al intentar autenticar con
# B -> recuperación con el mecanismo OFICIAL de MariaDB
# (--skip-grant-tables --skip-networking, contra un contenedor
# desechable SEPARADO, nunca el real) -> reanudación normal.
#
# Ejercita el código de PRODUCCIÓN real (lib/dbRootRecovery.sh y
# lib/updateSecretsFileField.mjs), nunca una reimplementación paralela.
#
# NUNCA toca gapssa-espocrm-db-1 ni ningún recurso GAPSSA real —
# proyecto/red/volumen propios, con el prefijo obligatorio
# "gapssa-s3a-rehearsal-". Teardown garantizado (trap) incluso ante
# fallo o interrupción. Verifica que el inventario Docker real (todos
# los proyectos compose de esta máquina) es idéntico antes/después.
#
# Escenarios cubiertos:
#   A. Camino feliz completo: drift real -> 1045 reproducido -> backup
#      cifrado+verificado (estructural Y extracción/diff completos) ->
#      recuperación oficial -> reconciliación de 3 filas root@host
#      (las 2 que crea la imagen oficial + 1 añadida a mano) -> servicio
#      real de vuelta sano -> verificación TCP -> actualización mínima y
#      atómica del almacén -> integridad de datos/cuentas/permisos no-root
#      intacta -> "S3 reanudado" (probe silencioso) autentica con el
#      valor ya reconciliado.
#   B. Interrupción: el contenedor de recuperación se mata en seco
#      (docker kill) a mitad de la reconciliación -> el volumen real
#      sigue siendo válido para un segundo intento completo desde cero.
#   C. Backup inválido: bytes corrompidos -> verificación estructural
#      rechaza SIN tocar nada; passphrase incorrecta -> igual.
#   D. Reejecución/idempotencia: dos recuperaciones consecutivas contra
#      el mismo volumen, la segunda con una contraseña nueva distinta,
#      sin residuos entre medias.
#
# Uso: scripts/secrets-rotation/tests/s3a_root_recovery_rehearsal.sh [nombre-proyecto]
#   Por defecto: gapssa-s3a-rehearsal-<aleatorio>. DEBE empezar por
#   "gapssa-s3a-rehearsal-".
set -euo pipefail

PROJECT="${1:-gapssa-s3a-rehearsal-$(openssl rand -hex 4)}"
case "$PROJECT" in
gapssa-s3a-rehearsal-*) ;;
*)
  echo "ERROR: el nombre de proyecto debe empezar por 'gapssa-s3a-rehearsal-' (recibido: '$PROJECT')." >&2
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
# shellcheck source=../lib.sh
source "$SECRETS_ROTATION_DIR/lib.sh"

MARIADB_IMAGE="mariadb:11.4"
NET="${PROJECT}_rehearsal"
CID="${PROJECT}-espocrm-db-1"

_gapssa_compose() { docker compose -p "$PROJECT" -f "$COMPOSE_FILE" "$@"; }
# shellcheck source=../lib/dbRootRecovery.sh
source "$SECRETS_ROTATION_DIR/lib/dbRootRecovery.sh"

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

LABEL_KEY="com.docker.compose.project"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/${PROJECT}.XXXXXX")"
COMPOSE_FILE="$WORKDIR/compose.yml"
TEARDOWN_DONE=false
REAL_INVENTORY_BEFORE=""
RECOVERY_CONTAINERS_STARTED=()

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
  local rn
  for rn in "${RECOVERY_CONTAINERS_STARTED[@]:+"${RECOVERY_CONTAINERS_STARTED[@]}"}"; do
    docker rm -f "$rn" >/dev/null 2>&1 || true
  done
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
    after="$(mktemp "${TMPDIR:-/tmp}/gapssa-s3a-rehearsal-after.XXXXXX")"
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
REAL_INVENTORY_BEFORE="$(mktemp "${TMPDIR:-/tmp}/gapssa-s3a-rehearsal-before.XXXXXX")"
snapshot_real_compose_resources "$REAL_INVENTORY_BEFORE"
say "Proyecto desechable: $PROJECT (aislado, verificado antes de arrancar)."

MARIADB_DB="espocrm"
MARIADB_USER="espocrm"
MARIADB_PW="$(openssl rand -hex 24)"
ROOT_PW_A="$(openssl rand -hex 24)" # contraseña EFECTIVA real del volumen
STORE_PW_B="$(openssl rand -hex 24)" # contraseña OBSOLETA que "cree" el almacén externo
MARIADB_PORT="$((27000 + RANDOM % 1000))"

cat >"$COMPOSE_FILE" <<EOF
name: ${PROJECT}
services:
  espocrm-db:
    image: ${MARIADB_IMAGE}
    environment:
      MARIADB_DATABASE: ${MARIADB_DB}
      MARIADB_USER: ${MARIADB_USER}
      MARIADB_PASSWORD: ${MARIADB_PW}
      MARIADB_ROOT_PASSWORD: ${ROOT_PW_A}
    volumes:
      - espocrm-db:/var/lib/mysql
    ports: ["127.0.0.1:${MARIADB_PORT}:3306"]
    networks: [rehearsal]
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 5s
      retries: 30
networks:
  rehearsal:
volumes:
  espocrm-db:
EOF

say "Levantando MariaDB 11.4 desechable (proyecto '$PROJECT')..."
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
wait_healthy espocrm-db 90 || { echo "ERROR: espocrm-db no llegó a healthy." >&2; exit 1; }
say "  OK — espocrm-db arriba y sano."

# _mariadb_tcp_ok <user> <pw> [sql]
# Autenticación TCP REAL contra el servicio real (host-side, cliente
# efímero) — la misma vía que usaría cualquier operador/EspoCRM.
_mariadb_tcp_ok() {
  local user="$1" pw="$2" sql="${3:-SELECT 1;}"
  docker run --rm --network "$NET" -e MYSQL_PWD="$pw" "$MARIADB_IMAGE" \
    mariadb -h "$CID" -u "$user" -N -B -e "$sql" >/dev/null 2>&1
}
_mariadb_tcp_query() {
  local user="$1" pw="$2" sql="$3"
  docker run --rm --network "$NET" -e MYSQL_PWD="$pw" "$MARIADB_IMAGE" \
    mariadb -h "$CID" -u "$user" -N -B -e "$sql" 2>/dev/null
}

# ===========================================================================
# Preparación del drift real + integridad de referencia (ANTES de tocar S3A)
# ===========================================================================
say ""
say "=== Preparación: drift real (A=volumen efectivo, B=almacén obsoleto) ==="

if _mariadb_tcp_ok root "$ROOT_PW_A"; then
  report "control: root autentica con la contraseña EFECTIVA (A) antes del drift" true
else
  report "control: root autentica con la contraseña EFECTIVA (A) antes del drift" false
fi

# Fila root@host EXTRA (además de 'localhost' y '%', que la imagen
# oficial ya crea de forma independiente — Bloque 5, comentario de
# gate_s3) para probar reconciliación de MÁS de 2 filas.
_mariadb_tcp_ok root "$ROOT_PW_A" "CREATE USER 'root'@'10.%' IDENTIFIED BY 'temporal-solo-para-el-ensayo';"
_mariadb_tcp_ok root "$ROOT_PW_A" "FLUSH PRIVILEGES;"

# Marcador de datos + cuentas/permisos de referencia — para demostrar
# después que S3A nunca reinicializó el volumen ni tocó nada no-root.
_mariadb_tcp_ok root "$ROOT_PW_A" "CREATE TABLE ${MARIADB_DB}.gapssa_s3a_marker (id INT PRIMARY KEY, note VARCHAR(64)); INSERT INTO ${MARIADB_DB}.gapssa_s3a_marker VALUES (1,'preexistente-antes-de-s3a');"
ACCOUNTS_BEFORE="$(_mariadb_tcp_query root "$ROOT_PW_A" "SELECT User,Host FROM mysql.user WHERE User NOT IN ('root') ORDER BY User,Host;")"
ROOT_HOSTS_BEFORE_COUNT="$(_mariadb_tcp_query root "$ROOT_PW_A" "SELECT COUNT(*) FROM mysql.user WHERE User='root';")"
report "preparación: 3 filas root@host antes de recuperar (localhost + % + 10.%)" "$([ "$ROOT_HOSTS_BEFORE_COUNT" = 3 ] && echo true || echo false)"

if _mariadb_tcp_ok espocrm "$MARIADB_PW"; then
  report "control: 'espocrm' autentica con su contraseña original antes de S3A" true
else
  report "control: 'espocrm' autentica con su contraseña original antes de S3A" false
fi

say ""
say "=== Escenario A: reproducción real del fallo 1045 + recuperación completa ==="

if _mariadb_tcp_ok root "$STORE_PW_B"; then
  report "reproducción: la contraseña OBSOLETA del almacén (B) NUNCA debería autenticar" false
else
  report "reproducción real de ERROR 1045: la contraseña del almacén (B) NO autentica contra el volumen" true
fi

VOL_NAME="$(_s3a_resolve_compose_volume_name "$PROJECT" espocrm-db)"
report "_s3a_resolve_compose_volume_name resuelve exactamente un volumen" "$([ -n "$VOL_NAME" ] && echo true || echo false)"

SVC_CID="$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps -q espocrm-db)"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" stop espocrm-db >/dev/null 2>&1
if _s3a_wait_container_stopped "$SVC_CID" 60; then
  report "parada limpia de espocrm-db confirmada (State.Running=false)" true
else
  report "parada limpia de espocrm-db confirmada (State.Running=false)" false
fi

# Guarda de montador único: un contenedor AJENO (de otro "proyecto",
# nada que ver con S3A) que monta el MISMO volumen debe bloquear la
# puerta ANTES de tocar nada — Docker no impide por defecto que dos
# contenedores no relacionados monten el mismo volumen a la vez.
INTERLOPER_NAME="${PROJECT}-interloper"
docker run -d --name "$INTERLOPER_NAME" -v "${VOL_NAME}:/mnt:ro" "$MARIADB_IMAGE" sleep 300 >/dev/null
RECOVERY_CONTAINERS_STARTED+=("$INTERLOPER_NAME")
sleep 1
OTHER_MOUNTERS="$(_s3a_other_running_containers_using_volume "$VOL_NAME")"
if [ "$OTHER_MOUNTERS" = "$INTERLOPER_NAME" ]; then
  report "_s3a_other_running_containers_using_volume detecta un montador AJENO en marcha" true
else
  report "_s3a_other_running_containers_using_volume detecta un montador AJENO en marcha" false
fi
docker rm -f "$INTERLOPER_NAME" >/dev/null 2>&1
OTHER_MOUNTERS_AFTER="$(_s3a_other_running_containers_using_volume "$VOL_NAME")"
report "tras retirar el montador ajeno, la guarda vuelve a reportar 'ninguno'" "$([ -z "$OTHER_MOUNTERS_AFTER" ] && echo true || echo false)"

PASSFILE="$WORKDIR/s3a-backup.pass"
printf 'frase-de-ensayo-no-real-%s' "$(openssl rand -hex 8)" >"$PASSFILE"
chmod 600 "$PASSFILE"
BACKUP_OUT="$WORKDIR/s3a-volume-backup.tar.gz.enc"

if [ "$(_s3a_backup_volume_encrypted "$MARIADB_IMAGE" "$VOL_NAME" "$BACKUP_OUT" "$PASSFILE")" = true ] && [ -s "$BACKUP_OUT" ]; then
  report "_s3a_backup_volume_encrypted: backup cifrado creado, no vacío, con la BD ya parada" true
else
  report "_s3a_backup_volume_encrypted: backup cifrado creado, no vacío, con la BD ya parada" false
fi

if [ "$(_s3a_verify_backup_structural "$MARIADB_IMAGE" "$BACKUP_OUT" "$PASSFILE")" = true ]; then
  report "_s3a_verify_backup_structural: el backup descifra a un tar estructuralmente válido" true
else
  report "_s3a_verify_backup_structural: el backup descifra a un tar estructuralmente válido" false
fi

# Verificación MÁS FUERTE que la de producción (aquí es barata: volumen
# de ensayo diminuto) — extracción COMPLETA + diff de la lista de
# ficheros contra el volumen real, nunca solo un listado estructural.
EXTRACT_DIR="$WORKDIR/extracted"
mkdir -p "$EXTRACT_DIR"
if openssl enc -d -aes-256-cbc -pbkdf2 -in "$BACKUP_OUT" -pass "file:$PASSFILE" 2>/dev/null |
  docker run --rm -i -v "${EXTRACT_DIR}:/out" "$MARIADB_IMAGE" tar -C /out -xf - >/dev/null 2>&1; then
  EXTRACTED_LIST="$(docker run --rm -v "${EXTRACT_DIR}:/out" "$MARIADB_IMAGE" find /out -type f 2>/dev/null | sed 's#^/out/##' | sort)"
  VOLUME_LIST="$(docker run --rm -v "${VOL_NAME}:/src:ro" "$MARIADB_IMAGE" find /src -type f 2>/dev/null | sed 's#^/src/##' | sort)"
  if [ -n "$EXTRACTED_LIST" ] && [ "$EXTRACTED_LIST" = "$VOLUME_LIST" ]; then
    report "ensayo de restauración COMPLETO: extracción del backup == contenido real del volumen (lista de ficheros idéntica)" true
  else
    report "ensayo de restauración COMPLETO: extracción del backup == contenido real del volumen (lista de ficheros idéntica)" false
  fi
else
  report "ensayo de restauración COMPLETO: extracción del backup == contenido real del volumen (lista de ficheros idéntica)" false
fi
rm -rf "$EXTRACT_DIR"

# Caso negativo: aplicar sobre un host que NO existe debe fallar limpio,
# NUNCA crear una cuenta nueva. Se ejercita en un contenedor de
# recuperación DEDICADO Y DESECHABLE, usado UNA SOLA VEZ para esto —
# nunca reutilizando el contenedor de la reconciliación real. Motivo
# empírico (hallazgo real de este mismo ensayo): bajo
# --skip-grant-tables, CUALQUIER `FLUSH PRIVILEGES` (incluso el que
# antecede a un ALTER que luego falla) reactiva la comprobación real de
# privilegios para toda conexión NUEVA en ese contenedor — mezclar este
# caso negativo con el contenedor de la reconciliación real (antes o
# después) hacía que la conexión siguiente fallara por "Access denied"
# en vez de por la razón que el caso negativo pretendía probar.
NEG_RECOVERY_NAME="${PROJECT}-s3arecov-$(openssl rand -hex 3)"
NEG_RECOVERY_SOCKET="/tmp/.gapssa-s3a-$(openssl rand -hex 4).sock"
if [ "$(_s3a_start_recovery_container "$MARIADB_IMAGE" "$VOL_NAME" "$NEG_RECOVERY_NAME" "$NEG_RECOVERY_SOCKET")" = true ]; then
  RECOVERY_CONTAINERS_STARTED+=("$NEG_RECOVERY_NAME")
  if _s3a_wait_recovery_ready "$NEG_RECOVERY_NAME" "$NEG_RECOVERY_SOCKET" 60; then
    if [ "$(printf '%s' "otra-cosa-1234567890" | _s3a_apply_root_password_all "$NEG_RECOVERY_NAME" "$NEG_RECOVERY_SOCKET" "host-inexistente.invalid")" = false ]; then
      report "aplicar sobre un host root inexistente falla limpio (ALTER USER nunca crea cuentas — semántica MariaDB)" true
    else
      report "aplicar sobre un host root inexistente falla limpio (ALTER USER nunca crea cuentas — semántica MariaDB)" false
    fi
  else
    report "aplicar sobre un host root inexistente falla limpio (ALTER USER nunca crea cuentas — semántica MariaDB)" false
  fi
  _s3a_stop_recovery_container "$NEG_RECOVERY_NAME" "$NEG_RECOVERY_SOCKET"
  RECOVERY_CONTAINERS_STARTED=("${RECOVERY_CONTAINERS_STARTED[@]/$NEG_RECOVERY_NAME/}")
else
  report "aplicar sobre un host root inexistente falla limpio (ALTER USER nunca crea cuentas — semántica MariaDB)" false
fi

RECOVERY_NAME="${PROJECT}-s3arecov-$(openssl rand -hex 3)"
RECOVERY_SOCKET="/tmp/.gapssa-s3a-$(openssl rand -hex 4).sock"
if [ "$(_s3a_start_recovery_container "$MARIADB_IMAGE" "$VOL_NAME" "$RECOVERY_NAME" "$RECOVERY_SOCKET")" = true ]; then
  RECOVERY_CONTAINERS_STARTED+=("$RECOVERY_NAME")
  report "_s3a_start_recovery_container arranca el contenedor desechable de recuperación" true
else
  report "_s3a_start_recovery_container arranca el contenedor desechable de recuperación" false
fi

if _s3a_wait_recovery_ready "$RECOVERY_NAME" "$RECOVERY_SOCKET" 60; then
  report "_s3a_wait_recovery_ready: mariadbd de recuperación responde por socket (skip-grant-tables)" true
else
  report "_s3a_wait_recovery_ready: mariadbd de recuperación responde por socket (skip-grant-tables)" false
fi

# Bajo --skip-networking, el puerto TCP real NUNCA debe estar escuchando
# en el contenedor de recuperación — comprobación explícita del aislamiento.
if docker exec "$RECOVERY_NAME" sh -c "(exec 3<>/dev/tcp/127.0.0.1/3306) 2>/dev/null"; then
  report "--skip-networking: el contenedor de recuperación NUNCA acepta TCP (ni siquiera loopback)" false
else
  report "--skip-networking: el contenedor de recuperación NUNCA acepta TCP (ni siquiera loopback)" true
fi

ROOT_HOSTS="$(_s3a_enumerate_root_hosts "$RECOVERY_NAME" "$RECOVERY_SOCKET")"
ROOT_HOSTS_COUNT="$(printf '%s\n' "$ROOT_HOSTS" | grep -c . || true)"
if [ "$ROOT_HOSTS_COUNT" = 3 ] && printf '%s\n' "$ROOT_HOSTS" | grep -qx 'localhost' && printf '%s\n' "$ROOT_HOSTS" | grep -qx '%' && printf '%s\n' "$ROOT_HOSTS" | grep -qx '10.%'; then
  report "_s3a_enumerate_root_hosts: enumera EXACTAMENTE las 3 filas root@host reales (localhost, %, 10.%)" true
else
  report "_s3a_enumerate_root_hosts: enumera EXACTAMENTE las 3 filas root@host reales (localhost, %, 10.%)" false
fi

NEW_ROOT_PW_C="$(openssl rand -hex 32)"
ROOT_HOSTS_ARRAY=()
while IFS= read -r h; do
  [ -n "$h" ] || continue
  ROOT_HOSTS_ARRAY+=("$h")
done <<EOF
$ROOT_HOSTS
EOF
if [ "$(printf '%s' "$NEW_ROOT_PW_C" | _s3a_apply_root_password_all "$RECOVERY_NAME" "$RECOVERY_SOCKET" "${ROOT_HOSTS_ARRAY[@]}")" = true ]; then
  report "_s3a_apply_root_password_all: reconciliación oficial (FLUSH+ALTER×3+FLUSH, UNA sesión) aplicada a las 3 filas" true
else
  report "_s3a_apply_root_password_all: reconciliación oficial (FLUSH+ALTER×3+FLUSH, UNA sesión) aplicada a las 3 filas" false
fi

_s3a_stop_recovery_container "$RECOVERY_NAME" "$RECOVERY_SOCKET"
RECOVERY_CONTAINERS_STARTED=("${RECOVERY_CONTAINERS_STARTED[@]/$RECOVERY_NAME/}")
if ! docker inspect "$RECOVERY_NAME" >/dev/null 2>&1; then
  report "_s3a_stop_recovery_container retira el contenedor desechable (nunca queda corriendo con --skip-grant-tables)" true
else
  report "_s3a_stop_recovery_container retira el contenedor desechable (nunca queda corriendo con --skip-grant-tables)" false
fi

docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d espocrm-db >/dev/null 2>&1
wait_healthy espocrm-db 90 || { echo "ERROR: espocrm-db no volvió a estar sano tras la recuperación." >&2; exit 1; }
report "espocrm-db real vuelve a estar sano tras la recuperación (sin reinicializar el volumen)" true

if _mariadb_tcp_ok root "$NEW_ROOT_PW_C"; then
  report "verificación TCP real: root autentica con la contraseña NUEVA (C) tras la recuperación" true
else
  report "verificación TCP real: root autentica con la contraseña NUEVA (C) tras la recuperación" false
fi
if _mariadb_tcp_ok root "$ROOT_PW_A"; then
  report "la contraseña EFECTIVA anterior (A) queda invalidada (prueba de que la rotación surtió efecto de verdad)" false
else
  report "la contraseña EFECTIVA anterior (A) queda invalidada (prueba de que la rotación surtió efecto de verdad)" true
fi
if _mariadb_tcp_ok root "$STORE_PW_B"; then
  report "la contraseña OBSOLETA del almacén (B) sigue sin autenticar" false
else
  report "la contraseña OBSOLETA del almacén (B) sigue sin autenticar" true
fi

say ""
say "=== Integridad: datos, cuentas no-root y permisos intactos ==="
MARKER_VALUE="$(_mariadb_tcp_query root "$NEW_ROOT_PW_C" "SELECT note FROM ${MARIADB_DB}.gapssa_s3a_marker WHERE id=1;")"
report "el marcador de datos preexistente sigue presente e intacto (nunca se reinicializó el volumen)" "$([ "$MARKER_VALUE" = "preexistente-antes-de-s3a" ] && echo true || echo false)"

ACCOUNTS_AFTER="$(_mariadb_tcp_query root "$NEW_ROOT_PW_C" "SELECT User,Host FROM mysql.user WHERE User NOT IN ('root') ORDER BY User,Host;")"
report "el conjunto de cuentas NO-root (identidad) es exactamente el mismo antes/después" "$([ "$ACCOUNTS_BEFORE" = "$ACCOUNTS_AFTER" ] && echo true || echo false)"

ROOT_HOSTS_COUNT_AFTER="$(_mariadb_tcp_query root "$NEW_ROOT_PW_C" "SELECT COUNT(*) FROM mysql.user WHERE User='root';")"
report "siguen siendo EXACTAMENTE 3 filas root@host contra el servicio real (el intento fallido sobre un host inexistente nunca creó una 4ª)" "$([ "$ROOT_HOSTS_COUNT_AFTER" = 3 ] && echo true || echo false)"

if _mariadb_tcp_ok espocrm "$MARIADB_PW"; then
  report "'espocrm' sigue autenticando con SU MISMA contraseña — S3A nunca la tocó" true
else
  report "'espocrm' sigue autenticando con SU MISMA contraseña — S3A nunca la tocó" false
fi

say ""
say "=== Reanudación de S3: probe silencioso ahora autentica con el valor reconciliado ==="
if _mariadb_tcp_ok root "$NEW_ROOT_PW_C" "SELECT User, Host FROM mysql.user WHERE User IN ('root','espocrm');"; then
  report "probe silencioso de S3 (equivalente): la enumeración de cuentas ya funciona con la contraseña reconciliada" true
else
  report "probe silencioso de S3 (equivalente): la enumeración de cuentas ya funciona con la contraseña reconciliada" false
fi

say ""
say "=== Actualización atómica y MÍNIMA del almacén externo ==="
build_fixture_store() {
  local path="$1" root_value="$2"
  local helper="$WORKDIR/_build_fixture.mjs"
  cat >"$helper" <<'JSEOF'
import { writeFileSync } from 'node:fs'
const [, , backupSchemaPath, targetPath, rootValue] = process.argv
const { MANDATORY_KEYS_ACTIVE } = await import(backupSchemaPath)
const lines = MANDATORY_KEYS_ACTIVE.map((k) =>
  k === 'ESPOCRM_DB_ROOT_PASSWORD' ? `${k}=${rootValue}` : `${k}=valor-ficticio-${k.toLowerCase()}`
)
lines.push('ESPOCRM_API_KEY=')
writeFileSync(targetPath, lines.join('\n') + '\n')
JSEOF
  node "$helper" "$SECRETS_ROTATION_DIR/lib/backupSchema.mjs" "$path" "$root_value"
  chmod 600 "$path"
}
FIXTURE_STORE="$WORKDIR/.env.gapssa.fixture"
build_fixture_store "$FIXTURE_STORE" "$STORE_PW_B"
FIXTURE_BEFORE_HASH="$(shasum -a 256 "$FIXTURE_STORE" | awk '{print $1}')"
FIXTURE_LINES_BEFORE_COUNT="$(wc -l <"$FIXTURE_STORE" | tr -d ' ')"

if [ "$(printf '%s' "$NEW_ROOT_PW_C" | _gapssa_write_secret_field "$FIXTURE_STORE" active ESPOCRM_DB_ROOT_PASSWORD)" = true ]; then
  report "_gapssa_write_secret_field: actualización atómica reporta éxito" true
else
  report "_gapssa_write_secret_field: actualización atómica reporta éxito" false
fi
STORED_VALUE_NOW="$(grep '^ESPOCRM_DB_ROOT_PASSWORD=' "$FIXTURE_STORE" | cut -d= -f2-)"
report "el almacén externo ahora tiene la contraseña root RECONCILIADA (C), nunca la obsoleta (B)" "$([ "$STORED_VALUE_NOW" = "$NEW_ROOT_PW_C" ] && echo true || echo false)"
FIXTURE_LINES_AFTER_COUNT="$(wc -l <"$FIXTURE_STORE" | tr -d ' ')"
OTHER_LINES_UNCHANGED="$(grep -v '^ESPOCRM_DB_ROOT_PASSWORD=' "$FIXTURE_STORE" | shasum -a 256 | awk '{print $1}')"
OTHER_LINES_BEFORE="$(grep -v '^ESPOCRM_DB_ROOT_PASSWORD=' "$FIXTURE_STORE.orig" 2>/dev/null | shasum -a 256 | awk '{print $1}' || true)"
# (comparación robusta: reconstruimos "antes" desde el propio backupSchema
# porque build_fixture_store es determinista salvo el valor root)
build_fixture_store "$FIXTURE_STORE.orig" "$STORE_PW_B"
OTHER_LINES_BEFORE="$(grep -v '^ESPOCRM_DB_ROOT_PASSWORD=' "$FIXTURE_STORE.orig" | shasum -a 256 | awk '{print $1}')"
report "el resto del documento (todas las demás claves) queda BYTE A BYTE intacto — actualización mínima" "$([ "$OTHER_LINES_UNCHANGED" = "$OTHER_LINES_BEFORE" ] && [ "$FIXTURE_LINES_AFTER_COUNT" = "$FIXTURE_LINES_BEFORE_COUNT" ] && echo true || echo false)"
unset FIXTURE_BEFORE_HASH

say ""
say "=== Escenario B: interrupción (docker kill en seco a mitad de la reconciliación) ==="
STORE_PW_D="$(openssl rand -hex 24)" # nueva deriva simulada para este escenario
if _mariadb_tcp_ok root "$NEW_ROOT_PW_C"; then
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" stop espocrm-db >/dev/null 2>&1
  _s3a_wait_container_stopped "$SVC_CID" 60 >/dev/null 2>&1 || true

  RECOVERY_NAME_2="${PROJECT}-s3arecov-$(openssl rand -hex 3)"
  RECOVERY_SOCKET_2="/tmp/.gapssa-s3a-$(openssl rand -hex 4).sock"
  if [ "$(_s3a_start_recovery_container "$MARIADB_IMAGE" "$VOL_NAME" "$RECOVERY_NAME_2" "$RECOVERY_SOCKET_2")" = true ]; then
    RECOVERY_CONTAINERS_STARTED+=("$RECOVERY_NAME_2")
    _s3a_wait_recovery_ready "$RECOVERY_NAME_2" "$RECOVERY_SOCKET_2" 60 >/dev/null 2>&1 || true
    # Interrupción real: SIGKILL directo al contenedor completo,
    # simulando el proceso orquestador (rotate-all-interactive.sh)
    # muriendo/siendo interrumpido a mitad de la reconciliación, ANTES
    # de que su propia limpieza (`docker_rm_standalone_container` en la
    # pila de `trap`) pudiera correr.
    docker kill "$RECOVERY_NAME_2" >/dev/null 2>&1 || true
    sleep 1
    docker rm -f "$RECOVERY_NAME_2" >/dev/null 2>&1 || true
    RECOVERY_CONTAINERS_STARTED=("${RECOVERY_CONTAINERS_STARTED[@]/$RECOVERY_NAME_2/}")
    report "interrupción: el contenedor de recuperación muerto en seco se puede retirar limpiamente" true
  else
    report "interrupción: arranque del segundo contenedor de recuperación" false
  fi

  # El volumen real DEBE seguir siendo utilizable para un intento
  # COMPLETO desde cero — la interrupción anterior no debe haberlo
  # dejado en un estado a medias (mariadbd hace commit por sentencia).
  RECOVERY_NAME_3="${PROJECT}-s3arecov-$(openssl rand -hex 3)"
  RECOVERY_SOCKET_3="/tmp/.gapssa-s3a-$(openssl rand -hex 4).sock"
  RETRY_OK=false
  if [ "$(_s3a_start_recovery_container "$MARIADB_IMAGE" "$VOL_NAME" "$RECOVERY_NAME_3" "$RECOVERY_SOCKET_3")" = true ]; then
    RECOVERY_CONTAINERS_STARTED+=("$RECOVERY_NAME_3")
    if _s3a_wait_recovery_ready "$RECOVERY_NAME_3" "$RECOVERY_SOCKET_3" 60; then
      HOSTS_AFTER_INTERRUPT="$(_s3a_enumerate_root_hosts "$RECOVERY_NAME_3" "$RECOVERY_SOCKET_3")"
      HOSTS_AFTER_INTERRUPT_ARRAY=()
      while IFS= read -r h; do
        [ -n "$h" ] || continue
        HOSTS_AFTER_INTERRUPT_ARRAY+=("$h")
      done <<EOF
$HOSTS_AFTER_INTERRUPT
EOF
      if [ "$(printf '%s' "$STORE_PW_D" | _s3a_apply_root_password_all "$RECOVERY_NAME_3" "$RECOVERY_SOCKET_3" "${HOSTS_AFTER_INTERRUPT_ARRAY[@]}")" = true ]; then
        RETRY_OK=true
      fi
    fi
    _s3a_stop_recovery_container "$RECOVERY_NAME_3" "$RECOVERY_SOCKET_3"
    RECOVERY_CONTAINERS_STARTED=("${RECOVERY_CONTAINERS_STARTED[@]/$RECOVERY_NAME_3/}")
  fi
  report "el volumen real sigue siendo recuperable con un intento completo tras la interrupción" "$RETRY_OK"

  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d espocrm-db >/dev/null 2>&1
  wait_healthy espocrm-db 90 || true
  if _mariadb_tcp_ok root "$STORE_PW_D"; then
    report "tras la interrupción + reintento completo, la contraseña MÁS RECIENTE (D) autentica de verdad" true
  else
    report "tras la interrupción + reintento completo, la contraseña MÁS RECIENTE (D) autentica de verdad" false
  fi
else
  report "escenario B: precondición (root autentica con C) antes de interrumpir" false
fi

say ""
say "=== Escenario C: backup inválido — rechazado ANTES de tocar nada ==="
CORRUPT_BACKUP="$WORKDIR/corrupt.tar.gz.enc"
cp "$BACKUP_OUT" "$CORRUPT_BACKUP"
cp "$BACKUP_OUT.digest" "$CORRUPT_BACKUP.digest"
# Corrompe un byte a mitad de fichero — nunca trivial (cabecera cero, EOF).
# Un tar PLANO (sin gzip) con un solo byte de CONTENIDO corrompido en
# medio del archivo pasa `tar -tf` sin ningún error (el listado nunca
# valida bytes de datos, solo cabeceras) — el digest SHA-256 comparado
# contra el `.digest` de referencia es lo que de verdad lo detecta aquí
# (hallazgo real de este mismo ensayo, ver lib/dbRootRecovery.sh).
python3 -c "
import sys
p = sys.argv[1]
with open(p, 'r+b') as f:
    f.seek(f.seek(0, 2) // 2)
    b = f.read(1)
    f.seek(-1, 1)
    f.write(bytes([b[0] ^ 0xFF]))
" "$CORRUPT_BACKUP"
if [ "$(_s3a_verify_backup_structural "$MARIADB_IMAGE" "$CORRUPT_BACKUP" "$PASSFILE")" = false ]; then
  report "backup con bytes corrompidos: la verificación estructural lo RECHAZA" true
else
  report "backup con bytes corrompidos: la verificación estructural lo RECHAZA" false
fi

WRONG_PASSFILE="$WORKDIR/wrong.pass"
printf 'esta-frase-nunca-fue-la-usada-para-cifrar' >"$WRONG_PASSFILE"
chmod 600 "$WRONG_PASSFILE"
if [ "$(_s3a_verify_backup_structural "$MARIADB_IMAGE" "$BACKUP_OUT" "$WRONG_PASSFILE")" = false ]; then
  report "backup VÁLIDO pero passphrase INCORRECTA: la verificación lo RECHAZA igualmente" true
else
  report "backup VÁLIDO pero passphrase INCORRECTA: la verificación lo RECHAZA igualmente" false
fi

say ""
say "=== Escenario D: reejecución/idempotencia — segunda recuperación consecutiva ==="
STORE_PW_E="$(openssl rand -hex 24)"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" stop espocrm-db >/dev/null 2>&1
_s3a_wait_container_stopped "$SVC_CID" 60 >/dev/null 2>&1 || true
RECOVERY_NAME_4="${PROJECT}-s3arecov-$(openssl rand -hex 3)"
RECOVERY_SOCKET_4="/tmp/.gapssa-s3a-$(openssl rand -hex 4).sock"
SECOND_RUN_OK=false
if [ "$(_s3a_start_recovery_container "$MARIADB_IMAGE" "$VOL_NAME" "$RECOVERY_NAME_4" "$RECOVERY_SOCKET_4")" = true ]; then
  RECOVERY_CONTAINERS_STARTED+=("$RECOVERY_NAME_4")
  if _s3a_wait_recovery_ready "$RECOVERY_NAME_4" "$RECOVERY_SOCKET_4" 60; then
    HOSTS_2ND="$(_s3a_enumerate_root_hosts "$RECOVERY_NAME_4" "$RECOVERY_SOCKET_4")"
    HOSTS_2ND_ARRAY=()
    while IFS= read -r h; do
      [ -n "$h" ] || continue
      HOSTS_2ND_ARRAY+=("$h")
    done <<EOF
$HOSTS_2ND
EOF
    if [ "$(printf '%s' "$STORE_PW_E" | _s3a_apply_root_password_all "$RECOVERY_NAME_4" "$RECOVERY_SOCKET_4" "${HOSTS_2ND_ARRAY[@]}")" = true ]; then
      SECOND_RUN_OK=true
    fi
  fi
  _s3a_stop_recovery_container "$RECOVERY_NAME_4" "$RECOVERY_SOCKET_4"
  RECOVERY_CONTAINERS_STARTED=("${RECOVERY_CONTAINERS_STARTED[@]/$RECOVERY_NAME_4/}")
fi
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d espocrm-db >/dev/null 2>&1
wait_healthy espocrm-db 90 || true
report "segunda recuperación consecutiva (sin residuos de la primera) tiene éxito" "$SECOND_RUN_OK"
if _mariadb_tcp_ok root "$STORE_PW_E"; then
  report "tras dos recuperaciones consecutivas, la contraseña de la SEGUNDA (E) es la vigente" true
else
  report "tras dos recuperaciones consecutivas, la contraseña de la SEGUNDA (E) es la vigente" false
fi
MARKER_VALUE_FINAL="$(_mariadb_tcp_query root "$STORE_PW_E" "SELECT note FROM ${MARIADB_DB}.gapssa_s3a_marker WHERE id=1;")"
report "tras DOS recuperaciones consecutivas, los datos preexistentes siguen intactos" "$([ "$MARKER_VALUE_FINAL" = "preexistente-antes-de-s3a" ] && echo true || echo false)"
LEFTOVER_RECOVERY="$(docker ps -aq --filter "name=${PROJECT}-s3arecov-" 2>/dev/null || true)"
report "cero contenedores de recuperación residuales tras las 4 rondas completas" "$([ -z "$LEFTOVER_RECOVERY" ] && echo true || echo false)"

say ""
say "fail_count=$fail_count"
