#!/bin/sh
# dbConfigLayerProbe.sh — closed, non-sensitive diagnostic probe wrapper.
#
# Determines which EspoCRM config layer is actually feeding the database
# credential the running app uses, and whether it authenticates — without
# ever touching the real running containers, without writing to the real
# data volume, and without ever printing a secret value.
#
# Hardened after independent review (Bloque de endurecimiento — ver
# historial de esta sesión):
#   1. SECRETS_FILE apunta al FICHERO exacto (~/.gapssa-secrets/.env.gapssa
#      por defecto, nunca al directorio), exige fichero regular sin
#      symlinks, propietario = usuario actual, modo 600, fuera del
#      workspace del repositorio — nunca se imprime la ruta completa en un
#      error.
#   2. Retirado por completo el patrón
#      `grep '^KEY=' | tail -n1 | cut -d= -f2-` (no detectaba duplicados
#      ni entradas corruptas). Sustituido por
#      lib/extractLiveEnvValueFromStdin.mjs, con sus propias pruebas.
#   3. Antes de CUALQUIER `docker run`, se valida que la red y el volumen
#      ya existen y llevan las etiquetas de compose del proyecto/recurso
#      lógico esperados — así ni un typo en el nombre puede acabar
#      creando implícitamente una red/volumen nuevo y vacío, y nunca se
#      confunde `espocrm-data` (config/data) con `espocrm-db` (datos de
#      MariaDB, terreno de S3A). También se compara la imagen LOCAL
#      contra el `.Image` (ID) del contenedor real en ejecución — nunca
#      se lee `.Config.Env`.
#   4. El contrato de salida es EXACTAMENTE 9 líneas "key=value": stderr
#      de cada paso se captura aparte en un temporal 600 con identidad
#      fijada (dev/inode/uid/modo verificados justo antes de usarlo), y
#      cualquier stderr no vacío, código de salida distinto de 0, número
#      de líneas incorrecto, clave desconocida, clave duplicada o valor
#      fuera del conjunto permitido aborta con un mensaje saneado — nunca
#      se imprime la salida cruda del paso que falló.
#
# Design (sin cambios de fondo):
#   - La contraseña del almacén se lee del fichero externo a una variable
#     de shell y se pasa SOLO por stdin — nunca por argv/env.
#   - Nunca `docker exec`s sobre los contenedores reales. Corre un
#     contenedor desechable de la MISMA imagen, en la MISMA red, con el
#     volumen real `espocrm-data` montado SOLO LECTURA (`:ro`, forzado por
#     el motor Docker), y lo destruye al terminar (`--rm`).
#   - Solo ejecuta SELECT 1 / conexión TCP / `php -l` / `stat`. Ninguna
#     escritura, ningún DDL/DML, ninguna limpieza de caché, ninguna puerta
#     de rotación tocada.
#
# Usage (run OUTSIDE Claude Code, by a human, on the Docker host):
#   scripts/secrets-rotation/probes/dbConfigLayerProbe.sh \
#     --secrets-file ~/.gapssa-secrets/.env.gapssa \
#     --network gapssa_private \
#     --data-volume gapssa_espocrm-data \
#     --image espocrm/espocrm:10.0.3-apache-trixie \
#     --project gapssa \
#     --container gapssa-espocrm-1
#
# Todos los flags son opcionales; los valores por defecto coinciden con
# los reales observados en esta sesión de diagnóstico.

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
LIB_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/../lib" && pwd)"
PROBE_PHP="${SCRIPT_DIR}/dbConfigLayerProbe.php"
EXTRACTOR_MJS="${LIB_DIR}/extractLiveEnvValueFromStdin.mjs"
# repo root: probes/ -> secrets-rotation/ -> scripts/ -> root (3 niveles)
WORKSPACE_ROOT="$(CDPATH= cd -- "${SCRIPT_DIR}/../../.." && pwd)"

SECRETS_FILE="${HOME}/.gapssa-secrets/.env.gapssa"
NETWORK="gapssa_private"
DATA_VOLUME="gapssa_espocrm-data"
IMAGE="espocrm/espocrm:10.0.3-apache-trixie"
COMPOSE_PROJECT="gapssa"
CONTAINER="gapssa-espocrm-1"

while [ $# -gt 0 ]; do
  case "$1" in
  --secrets-file) SECRETS_FILE="$2"; shift 2 ;;
  --network) NETWORK="$2"; shift 2 ;;
  --data-volume) DATA_VOLUME="$2"; shift 2 ;;
  --image) IMAGE="$2"; shift 2 ;;
  --project) COMPOSE_PROJECT="$2"; shift 2 ;;
  --container) CONTAINER="$2"; shift 2 ;;
  *) echo "ERROR: argumento desconocido '$1'." >&2; exit 1 ;;
  esac
done

TMP_FILES=""
cleanup() {
  unset STORED_PW 2>/dev/null || true
  for f in $TMP_FILES; do
    [ -n "$f" ] && rm -f "$f" 2>/dev/null || true
  done
}
trap cleanup EXIT INT TERM

abort() {
  echo "ERROR: $1" >&2
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  abort "se necesita 'node' en PATH para el extractor del almacén externo."
fi
if [ ! -f "$EXTRACTOR_MJS" ]; then
  abort "no se encuentra el extractor junto a lib/ ($EXTRACTOR_MJS)."
fi
if [ ! -f "$PROBE_PHP" ]; then
  abort "no se encuentra el probe PHP junto a este script."
fi

# --- pinned temp helpers (identidad fijada, nunca solo "confiar" en la ---
#     ruta devuelta por mktemp — comprobada de nuevo justo antes de usar
#     el contenido). `_new_pinned_tmp` se invoca SIEMPRE vía
#     `x="$(_new_pinned_tmp)"`, es decir dentro de una subshell — por eso
#     NO toca TMP_FILES internamente (se perdería al salir la subshell):
#     cada llamador añade la ruta devuelta a TMP_FILES justo después.
_pin_of() {
  stat -f '%d %i %u %Lp' "$1" 2>/dev/null || stat -c '%d %i %u %a' "$1" 2>/dev/null
}

_new_pinned_tmp() {
  t="$(mktemp)" || return 1
  chmod 600 "$t"
  pin="$(_pin_of "$t")" || { rm -f "$t"; return 1; }
  printf '%s\n%s\n' "$t" "$pin"
}

# --- 1. validar SECRETS_FILE: fichero exacto, sin symlinks, propietario  --
#        actual, modo 600, fuera del workspace. Nunca se imprime la ruta
#        completa en un error (podría revelar estructura de $HOME).
if [ -z "$SECRETS_FILE" ]; then
  abort "ruta de almacén externo vacía."
fi
if [ -d "$SECRETS_FILE" ]; then
  abort "la ruta de almacén externo apunta a un DIRECTORIO — se espera el fichero exacto (p.ej. <dir>/.env.gapssa), no su directorio contenedor."
fi
if [ -L "$SECRETS_FILE" ]; then
  abort "la ruta de almacén externo es un symlink — no permitido."
fi
if [ ! -e "$SECRETS_FILE" ]; then
  abort "el almacén externo no existe."
fi
if [ ! -f "$SECRETS_FILE" ]; then
  abort "la ruta de almacén externo no es un fichero regular."
fi

SF_DIR="$(dirname -- "$SECRETS_FILE")"
SF_BASE="$(basename -- "$SECRETS_FILE")"
SF_CANON_DIR="$(CDPATH= cd -- "$SF_DIR" 2>/dev/null && pwd -P)" || abort "no se pudo resolver el directorio del almacén externo."
SF_RESOLVED="${SF_CANON_DIR}/${SF_BASE}"

case "$SF_RESOLVED" in
"$WORKSPACE_ROOT"/* | "$WORKSPACE_ROOT")
  abort "el almacén externo está dentro del workspace del repositorio — no permitido (un secreto real nunca debe vivir donde un agente pueda leerlo/editarlo)."
  ;;
esac

SF_STAT="$(stat -f '%u %Lp' "$SF_RESOLVED" 2>/dev/null || stat -c '%u %a' "$SF_RESOLVED" 2>/dev/null)" || abort "no se pudo comprobar propietario/modo del almacén externo."
SF_OWNER="${SF_STAT%% *}"
SF_MODE="${SF_STAT##* }"
MY_UID="$(id -u)"
if [ "$SF_OWNER" != "$MY_UID" ]; then
  abort "el almacén externo no pertenece al usuario actual."
fi
if [ "$SF_MODE" != "600" ]; then
  abort "el almacén externo no tiene modo 600 (tiene: ${SF_MODE})."
fi

# --- 2/3. extraer ESPOCRM_DB_PASSWORD con el extractor dedicado ----------
#          (nunca grep|tail|cut — no detectaba duplicados ni corrupción).
#          stderr del extractor también va a un temporal 600 con
#          identidad fijada, nunca a una ruta predecible de /tmp.
extract_pin_info="$(_new_pinned_tmp)" || abort "no se pudo crear el temporal seguro para stderr (extractor)."
extract_err_tmp="$(printf '%s\n' "$extract_pin_info" | sed -n '1p')"
extract_err_pin="$(printf '%s\n' "$extract_pin_info" | sed -n '2p')"
TMP_FILES="$TMP_FILES $extract_err_tmp"

set +e
STORED_PW="$(node "$EXTRACTOR_MJS" ESPOCRM_DB_PASSWORD <"$SF_RESOLVED" 2>"$extract_err_tmp")"
EXTRACT_RC=$?
set -e

[ "$(_pin_of "$extract_err_tmp")" = "$extract_err_pin" ] || abort "el temporal de stderr (extractor) cambió de identidad durante la ejecución — abortando."
EXTRACT_ERR="$(cat "$extract_err_tmp" 2>/dev/null || true)"

if [ "$EXTRACT_RC" -ne 0 ]; then
  case "$EXTRACT_RC" in
  2) abort "el almacén externo tiene formato inválido (duplicado, línea corrupta, valor vacío o byte no permitido). Detalle: ${EXTRACT_ERR}" ;;
  3) abort "ESPOCRM_DB_PASSWORD no está presente en el almacén externo." ;;
  *) abort "no se pudo extraer ESPOCRM_DB_PASSWORD del almacén externo (código ${EXTRACT_RC}). Detalle: ${EXTRACT_ERR}" ;;
  esac
fi
if [ -z "$STORED_PW" ]; then
  abort "ESPOCRM_DB_PASSWORD quedó vacío tras la extracción."
fi

# --- 4. preflight: red/volumen deben EXISTIR YA con las etiquetas de -----
#        compose esperadas — nunca se crea nada implícitamente por un
#        typo, y nunca se confunde espocrm-data con espocrm-db.
if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  abort "la red '$NETWORK' no existe — abortando (no se creará ninguna implícitamente; revisa --network)."
fi
NET_PROJECT="$(docker network inspect "$NETWORK" --format '{{index .Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
NET_KEY="$(docker network inspect "$NETWORK" --format '{{index .Labels "com.docker.compose.network"}}' 2>/dev/null || true)"
if [ "$NET_PROJECT" != "$COMPOSE_PROJECT" ] || [ "$NET_KEY" != "private" ]; then
  abort "la red '$NETWORK' no lleva las etiquetas de compose esperadas (project=${COMPOSE_PROJECT}, network=private) — puede no ser la red real del proyecto."
fi

if ! docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1; then
  abort "el volumen '$DATA_VOLUME' no existe — abortando (no se creará ninguno implícitamente; revisa --data-volume)."
fi
VOL_PROJECT="$(docker volume inspect "$DATA_VOLUME" --format '{{index .Labels "com.docker.compose.project"}}' 2>/dev/null || true)"
VOL_KEY="$(docker volume inspect "$DATA_VOLUME" --format '{{index .Labels "com.docker.compose.volume"}}' 2>/dev/null || true)"
if [ "$VOL_PROJECT" != "$COMPOSE_PROJECT" ] || [ "$VOL_KEY" != "espocrm-data" ]; then
  abort "el volumen '$DATA_VOLUME' no lleva las etiquetas de compose esperadas (project=${COMPOSE_PROJECT}, volume=espocrm-data) — si esto apunta a 'espocrm-db' (datos de MariaDB, terreno de S3A) es el volumen EQUIVOCADO para esta sonda."
fi

LOCAL_IMAGE_ID="$(docker image inspect "$IMAGE" --format '{{.Id}}' 2>/dev/null || true)"
if [ -z "$LOCAL_IMAGE_ID" ]; then
  abort "la imagen local '$IMAGE' no existe localmente — haz 'docker pull' explícito primero; esta sonda nunca descarga nada implícitamente."
fi
if docker inspect "$CONTAINER" >/dev/null 2>&1; then
  RUNNING_IMAGE_ID="$(docker inspect "$CONTAINER" --format '{{.Image}}' 2>/dev/null || true)"
  if [ -n "$RUNNING_IMAGE_ID" ] && [ "$RUNNING_IMAGE_ID" != "$LOCAL_IMAGE_ID" ]; then
    abort "la imagen local no coincide con la imagen (.Image, nunca .Config.Env) del contenedor real '$CONTAINER' — la sonda no sería representativa del sistema real."
  fi
fi

# --- capa estructural: existencia/propietario/modo/sintaxis --------------
struct_pin_info="$(_new_pinned_tmp)" || abort "no se pudo crear el temporal seguro para stderr (estructural)."
struct_err_tmp="$(printf '%s\n' "$struct_pin_info" | sed -n '1p')"
struct_err_pin="$(printf '%s\n' "$struct_pin_info" | sed -n '2p')"
TMP_FILES="$TMP_FILES $struct_err_tmp"

set +e
STRUCT_OUT="$(docker run --rm --entrypoint sh \
  -v "${DATA_VOLUME}:/var/www/html/data:ro" \
  "$IMAGE" -c '
    ok_syntax=true
    ok_owner=true
    for f in \
      "application/Espo/Resources/defaults/systemConfig.php:root:root:644" \
      "data/config.php:www-data:www-data:664" \
      "data/config-internal.php:www-data:www-data:664" \
      "data/config-override.php:www-data:www-data:664" \
      "data/config-internal-override.php:www-data:www-data:664" \
      "data/state.php:www-data:www-data:664"
    do
      path="${f%%:*}"
      rest="${f#*:}"
      exp_owner="${rest%%:*}"
      rest="${rest#*:}"
      exp_group="${rest%%:*}"
      exp_mode="${rest#*:}"
      p="/var/www/html/$path"
      [ -e "$p" ] || continue
      if ! php -l "$p" >/dev/null 2>&1; then
        ok_syntax=false
      fi
      owner="$(stat -c %U "$p" 2>/dev/null || echo "?")"
      group="$(stat -c %G "$p" 2>/dev/null || echo "?")"
      mode="$(stat -c %a "$p" 2>/dev/null || echo "?")"
      if [ "$owner" != "$exp_owner" ] || [ "$group" != "$exp_group" ] || [ "$mode" != "$exp_mode" ]; then
        ok_owner=false
      fi
    done
    echo "php_syntax_ok=$ok_syntax"
    echo "ownership_mode_ok=$ok_owner"
  ' 2>"$struct_err_tmp")"
struct_rc=$?
set -e

[ "$(_pin_of "$struct_err_tmp")" = "$struct_err_pin" ] || abort "el temporal de stderr (estructural) cambió de identidad durante la ejecución — abortando."
if [ -s "$struct_err_tmp" ]; then
  abort "la comprobación estructural produjo salida de error inesperada — abortando (contrato de 9 líneas exactas violado)."
fi
if [ "$struct_rc" -ne 0 ]; then
  abort "la comprobación estructural terminó con código de salida ${struct_rc}."
fi

validate_struct_block() {
  b="$1"
  n="$(printf '%s\n' "$b" | grep -c '^')" || return 1
  [ "$n" -eq 2 ] || return 1
  printf '%s\n' "$b" | grep -Eq '^php_syntax_ok=(true|false)$' || return 1
  printf '%s\n' "$b" | grep -Eq '^ownership_mode_ok=(true|false)$' || return 1
  [ "$(printf '%s\n' "$b" | grep -c '^php_syntax_ok=')" -eq 1 ] || return 1
  [ "$(printf '%s\n' "$b" | grep -c '^ownership_mode_ok=')" -eq 1 ] || return 1
  return 0
}
validate_struct_block "$STRUCT_OUT" || abort "la comprobación estructural no cumplió el contrato de salida esperado (2 líneas exactas, claves/valores permitidos, sin duplicados)."

# --- capa semántica: config efectiva + autenticación ----------------------
probe_pin_info="$(_new_pinned_tmp)" || abort "no se pudo crear el temporal seguro para stderr (probe PHP)."
probe_err_tmp="$(printf '%s\n' "$probe_pin_info" | sed -n '1p')"
probe_err_pin="$(printf '%s\n' "$probe_pin_info" | sed -n '2p')"
TMP_FILES="$TMP_FILES $probe_err_tmp"

set +e
PROBE_OUT="$(printf '%s' "$STORED_PW" | docker run --rm -i --entrypoint php \
  --network "$NETWORK" \
  -v "${DATA_VOLUME}:/var/www/html/data:ro" \
  -v "${PROBE_PHP}:/probe.php:ro" \
  "$IMAGE" /probe.php --base=/var/www/html 2>"$probe_err_tmp")"
probe_rc=$?
set -e

unset STORED_PW

[ "$(_pin_of "$probe_err_tmp")" = "$probe_err_pin" ] || abort "el temporal de stderr (probe PHP) cambió de identidad durante la ejecución — abortando."
if [ -s "$probe_err_tmp" ]; then
  abort "el probe PHP produjo salida de error inesperada — abortando (contrato de 9 líneas exactas violado)."
fi
if [ "$probe_rc" -ne 0 ]; then
  abort "el probe PHP terminó con código de salida ${probe_rc}."
fi

validate_probe_block() {
  b="$1"
  n="$(printf '%s\n' "$b" | grep -c '^')" || return 1
  [ "$n" -eq 7 ] || return 1
  for k in stored_credential_authenticates config_internal_matches_store \
    effective_config_matches_store effective_config_authenticates \
    later_override_detected network_resolution_ok; do
    printf '%s\n' "$b" | grep -Eq "^${k}=(true|false)\$" || return 1
    [ "$(printf '%s\n' "$b" | grep -c "^${k}=")" -eq 1 ] || return 1
  done
  printf '%s\n' "$b" | grep -Eq '^database_error_category=(auth|network|schema|other)$' || return 1
  [ "$(printf '%s\n' "$b" | grep -c '^database_error_category=')" -eq 1 ] || return 1
  return 0
}
validate_probe_block "$PROBE_OUT" || abort "el probe PHP no cumplió el contrato de salida esperado (7 líneas exactas, claves/valores permitidos, sin duplicados)."

# --- combinar en orden canónico, EXACTAMENTE 9 líneas ---------------------
extract_val() { printf '%s\n' "$1" | grep "^$2=" | cut -d= -f2-; }

printf 'php_syntax_ok=%s\n' "$(extract_val "$STRUCT_OUT" php_syntax_ok)"
printf 'ownership_mode_ok=%s\n' "$(extract_val "$STRUCT_OUT" ownership_mode_ok)"
printf 'stored_credential_authenticates=%s\n' "$(extract_val "$PROBE_OUT" stored_credential_authenticates)"
printf 'config_internal_matches_store=%s\n' "$(extract_val "$PROBE_OUT" config_internal_matches_store)"
printf 'effective_config_matches_store=%s\n' "$(extract_val "$PROBE_OUT" effective_config_matches_store)"
printf 'effective_config_authenticates=%s\n' "$(extract_val "$PROBE_OUT" effective_config_authenticates)"
printf 'later_override_detected=%s\n' "$(extract_val "$PROBE_OUT" later_override_detected)"
printf 'network_resolution_ok=%s\n' "$(extract_val "$PROBE_OUT" network_resolution_ok)"
printf 'database_error_category=%s\n' "$(extract_val "$PROBE_OUT" database_error_category)"
