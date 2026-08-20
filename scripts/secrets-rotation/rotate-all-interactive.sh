#!/usr/bin/env bash
# rotate-all-interactive.sh — asistente único e interactivo para ejecutar la
# rotación global de secretos (puertas S1-S9). VERSIÓN 2 — la v1 de este
# script fue revisada y RECHAZADA antes de cualquier ejecución (ver
# docs/runbook-rotacion-secretos-externa.md §"Historial de revisión" y
# scripts/secrets-rotation/README.md para el detalle completo de por qué).
# Esta versión corrige cada bloqueo de esa revisión — ver el resumen al
# final de este comentario.
#
# LÉELO ANTES DE EJECUTARLO. Ver también:
#   docs/plan-rotacion-secretos-gapssa-2026-08-13.md   (qué se rota y por qué)
#   docs/runbook-rotacion-secretos-externa.md          (pasos manuales originales)
#
# Este script NUNCA debe ejecutarse desde Claude Code ni desde ninguna
# terminal integrada de un editor con un agente activo. Ábrelo y ejecútalo
# solo desde Terminal.app (u otra terminal local normal), con Claude Code
# completamente cerrado, y solo después de exportar TÚ MISMO:
#
#   export ROTACION_GAPSSA_FUERA_DEL_HARNESS=SI
#   ./scripts/secrets-rotation/rotate-all-interactive.sh [--dry-run] [--only Sx]
#
# Qué corrige la v2 frente a la v1 (resumen — detalle en el informe de
# entrega de la sesión que la escribió):
#   1. Guardia de harness real: variable de entorno explícita + detección
#      heurística de variables/ancestros de proceso de agente/editor + TTY,
#      todo en lib.sh, con pruebas positivas y negativas.
#   2. Ningún secreto vuelve a aparecer en un argumento de proceso ni en
#      una variable de entorno pasada por `-e`/`--env` a un comando visible
#      en `ps`: SQL vía stdin, contraseñas vía `--env-file` de `docker run`
#      apuntando a un fichero temporal 600 fuera del workspace (borrado por
#      `trap`), autenticación HTTP vía fichero de configuración de `curl`
#      (`-K`), nunca `-u`/`-a`/`-c "... PASSWORD ..."`.
#   3. S4 (EspoCRM admin + API Key) queda completamente automatizado: la
#      contraseña de `admin` se cambia con `bin/command set-password`
#      (lee la contraseña por stdin, nunca por argumento) y la API Key se
#      regenera con la propia API REST de EspoCRM
#      (`POST /api/v1/UserSecurity/apiKey/generate`, verificado contra el
#      código fuente real de la imagen `espocrm/espocrm:10.0.3-apache-trixie`
#      — nunca inventado). Cero edición manual de `.env.gapssa`.
#   4/5. PostgreSQL y MariaDB: enumera cuentas/hosts reales antes de tocar
#      nada, aplica y verifica por TCP real contra una conexión NO
#      privilegiada (nunca confía en el socket local `trust`), y Redis
#      automatiza `REDIS_URL` con percent-encoding correcto — cero edición
#      manual.
#   6. Auditoría real (no una afirmación) del impacto de PAYLOAD_SECRET/
#      OTP_HMAC_SECRET/AUTH_RATE_LIMIT_HMAC_SECRET, citando archivo y línea
#      del código real.
#   7. S7 (booking): guarda contra producción, comprueba con una consulta
#      real cuántas filas siguen dependiendo de cada versión ANTES de
#      sustituir/retirar nada, y retira las versiones comprometidas dentro
#      de la misma puerta en cuanto el conteo real llega a cero — nunca
#      "más adelante si quieres".
#   8. S8 exige inventario explícito con evidencia, no un "no aplica" sin
#      más.
#   9. S9 rechaza ejecutarse si falta cualquier puerta anterior — sin
#      opción de "continuar de todas formas" — y verifica automáticamente
#      todo lo que solo puede comprobarse con el sistema completo arriba.
#   10. `.env` nunca queda en el workspace: se pone en cuarentena en el
#      propio almacén externo.
#   11. Máquina de estados cerrada (pending/prepared/applying/verifying/
#      done/rollback_required/failed) con `trap` en SIGINT/SIGTERM.
#   12. Backup cifrado (`openssl enc`) del archivo externo antes de cada
#      puerta que lo modifica.
#   13. Arnés de pruebas con `docker`/`curl`/`psql`/`mariadb`/`redis-cli`
#      falsos — ver scripts/secrets-rotation/tests/.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

# Bloque 5 — helpers de recuperación/reconciliación por servidor tras una
# restauración (S2-S5). `_gapssa_compose` es el mismo patrón dinámico que
# `capture_cmd` (Bloque 4): cualquier función de estos ficheros que
# necesite invocar `docker compose` lo hace a través de esta única
# definición, nunca hardcodeando `--env-file`/`-p`/`-f` por su cuenta —
# así el ensayo desechable puede reutilizar EXACTAMENTE las mismas
# funciones redefiniendo solo esto.
_gapssa_compose() { docker compose --env-file "$SECRETS_FILE" "$@"; }

# _gapssa_wait_healthy <service> [timeout_seconds]
# Espera a que el healthcheck de compose.yml para <service> reporte
# 'healthy' antes de que las puertas principales (S2/S3/S5) intenten
# CUALQUIER operación real contra él. `docker compose up -d` retorna en
# cuanto el contenedor se CREA, no cuando el servicio de dentro ya
# acepta conexiones — contra un volumen de datos recién creado
# (primer arranque real, initdb/carga de AOF) esto es una condición de
# carrera real, no hipotética: detectada empíricamente por el ensayo
# integral desechable (Bloque 6) contra infraestructura real de
# primer arranque. Sondea cada 1s. Nunca asume "healthy" por ausencia
# de sonda ni por timeout agotado — fail closed (return 1 en ambos
# casos); el llamador decide cómo informar el fallo.
_gapssa_wait_healthy() {
  local service="$1" timeout="${2:-90}"
  local cid waited=0 status
  cid="$(_gapssa_compose ps -q "$service" 2>/dev/null)"
  [ -n "$cid" ] || return 1
  while [ "$waited" -lt "$timeout" ]; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$cid" 2>/dev/null || true)"
    [ "$status" = healthy ] && return 0
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}
# shellcheck source=lib/dbRecovery.sh
source "$SCRIPT_DIR/lib/dbRecovery.sh"
# shellcheck source=lib/espoRecovery.sh
source "$SCRIPT_DIR/lib/espoRecovery.sh"
# shellcheck source=lib/recoveryEvidence.sh
source "$SCRIPT_DIR/lib/recoveryEvidence.sh"

DRY_RUN=false
ONLY_GATE=""

usage() {
  cat <<'EOF'
Uso: rotate-all-interactive.sh [--dry-run] [--only Sx] [-h|--help]

  --dry-run     Muestra qué haría cada puerta sin escribir ni ejecutar nada
                real.
  --only Sx     Ejecuta solo la puerta indicada (S1..S9).
  -h, --help    Muestra esta ayuda.

Antes de ejecutar, exporta en tu propia terminal:
  export ROTACION_GAPSSA_FUERA_DEL_HARNESS=SI

Ver docs/runbook-rotacion-secretos-externa.md.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
  --dry-run)
    DRY_RUN=true
    shift
    ;;
  --only)
    ONLY_GATE="$(printf '%s' "${2:-}" | tr '[:upper:]' '[:lower:]')"
    shift 2
    ;;
  -h | --help)
    usage
    exit 0
    ;;
  *)
    echo "Argumento desconocido: $1" >&2
    usage >&2
    exit 1
    ;;
  esac
done

SECRETS_DIR="${GAPSSA_SECRETS_DIR:-$HOME/.gapssa-secrets}"
SECRETS_FILE="$SECRETS_DIR/.env.gapssa"
STATUS_FILE="$SECRETS_DIR/.rotation-status"
BACKUP_DIR="$SECRETS_DIR/backups"
QUARANTINE_DIR="$SECRETS_DIR/env-quarantine"
ENV_REPO="$REPO_ROOT/.env"
# Bloque 6 (corrección de colisiones) — identidad ÚNICA de esta sesión,
# generada UNA SOLA VEZ aquí (nunca en gate_s9, nunca recalculada): todo
# informe final que esta sesión llegue a producir incluye SIEMPRE este
# run_id en su nombre, además del timestamp — nunca "solo la fecha"
# (`rotation-report-$(date ...).txt`, formato anterior a este bloque,
# vulnerable a colisión de nombre entre dos sesiones en el mismo
# segundo). REPORT_FILE se rellena de verdad más tarde, dentro de
# gate_s9, únicamente tras reservarlo atómicamente — nunca aquí.
RUN_ID="$(_gapssa_secrets_random_suffix_hex 8)"
readonly RUN_ID
REPORT_FILE=""

gapssa_secrets_abort_if_inside_workspace "$SECRETS_DIR"
export GAPSSA_SECRETS_TMPDIR="$SECRETS_DIR/tmp"

command -v node >/dev/null 2>&1 || {
  echo "ERROR: 'node' no está disponible en PATH — hace falta para el ensayo de backup (digest en streaming) y para la restauración real (parser/validación/fsync)." >&2
  exit 1
}

# Nombre de la etiqueta de versión de esquema que se antepone (como
# primera línea, en claro, DENTRO del propio contenido que se cifra —
# nunca en un fichero ni metadato aparte sin cifrar) a todo backup nuevo
# — ver lib/backupSchema.mjs, que es la única otra copia de este nombre
# en todo el código; ambos deben coincidir EXACTAMENTE. $SECRETS_FILE en
# sí NUNCA lleva esta línea — solo existe dentro de un backup cifrado, y
# se retira antes de escribir el resultado de una restauración real (ver
# lib/writeRestorePayload.mjs). La VERSIÓN en sí nunca es un valor fijo
# global — backup_secrets_file() la recibe como argumento explícito en
# cada llamada (ver current_secrets_schema_version()), nunca la infiere
# de qué claves "parezcan estar presentes".
GAPSSA_BACKUP_SCHEMA_KEY="__GAPSSA_BACKUP_SCHEMA_VERSION__"

# ---------------------------------------------------------------------------
# utilidades de interfaz
# ---------------------------------------------------------------------------

divider() { printf '%s\n' "------------------------------------------------------------"; }
say() { printf '%s\n' "$*"; }

ask_yes_no() {
  local reply
  while true; do
    read -r -p "$1 [si/no/salir]: " reply
    case "$reply" in
    si | SI | Si | s | S) return 0 ;;
    no | NO | No | n | N) return 1 ;;
    salir | SALIR | Salir)
      say "Saliendo por decisión tuya. Vuelve a ejecutar este script cuando quieras — retoma desde donde falta."
      exit 0
      ;;
    *) say "Responde 'si', 'no' o 'salir'." ;;
    esac
  done
}

pause_for_enter() {
  read -r -p "$1 Pulsa Enter cuando lo hayas hecho... " _ || true
}

# Ejecuta $@ (o solo lo imprime en --dry-run). Nunca acepta un secreto como
# argumento — todo secreto entra por stdin o por --env-file.
run_cmd() {
  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] $*"
    return 0
  fi
  "$@"
}

# Como run_cmd, pero alimenta $1 por stdin al comando (resto de argumentos)
# — para SQL/JSON con un valor sensible embebido: nunca aparece en `ps`.
run_cmd_stdin() {
  local input="$1"
  shift
  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] (entrada por stdin, oculta) $*"
    return 0
  fi
  printf '%s' "$input" | "$@"
}

# Ejecuta $@ y devuelve su stdout (para conteos/IDs, nunca para un valor
# secreto en sí — un secreto nunca se hace pasar por una variable de bash
# más de lo estrictamente necesario para escribirlo en el archivo externo).
capture_cmd() {
  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] $*" >&2
    printf ''
    return 0
  fi
  "$@"
}

capture_cmd_stdin() {
  local input="$1"
  shift
  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] (entrada por stdin, oculta) $*" >&2
    printf ''
    return 0
  fi
  printf '%s' "$input" | "$@"
}

# Corrección "dry-run fresco S1->S9" — En --dry-run, NUNCA se lee el
# contenido de $SECRETS_FILE, exista o no físicamente (un almacén externo
# real preexistente en esta máquina nunca se adopta como sustituto
# silencioso): se sirve un valor sintético cerrado, derivado únicamente de
# .env.example (nunca de .env real), cargado una única vez en memoria del
# proceso — ver _gapssa_dry_load_synthetic_env más abajo.
field_from_secrets_file() {
  if [ "$DRY_RUN" = true ]; then
    _gapssa_dry_load_synthetic_env
    local varname="GAPSSA_DRY_FIELD_$1"
    printf '%s' "${!varname:-}"
    return 0
  fi
  grep "^$1=" "$SECRETS_FILE" 2>/dev/null | tail -n1 | cut -d= -f2-
}

# Carga perezosa (una sola vez por proceso) del entorno sintético de
# dry-run — reutiliza scripts/checkpoint-validation/generate-synthetic-env.sh
# (ya auditado y con su propio guard-test: nunca abre .env real, solo
# .env.example) en vez de duplicar esa lógica aquí. El fichero resultante
# vive en un directorio desechable FUERA de $SECRETS_DIR (nunca crea
# ~/.gapssa-secrets), se carga en variables de proceso indirectas (Bash
# 3.2 — nunca un array asociativo, sintaxis de Bash 4+ prohibida por
# tests/static_bash32_compat_guard.sh) y se tritura + borra de inmediato,
# nunca queda en disco más que el instante de esta carga.
GAPSSA_DRY_SYNTH_LOADED=false
_gapssa_dry_load_synthetic_env() {
  [ "$GAPSSA_DRY_SYNTH_LOADED" = true ] && return 0
  local synth_dir
  synth_dir="$(mktemp -d "${TMPDIR:-/tmp}/gapssa-dryrun-synth.XXXXXX")"
  chmod 700 "$synth_dir"
  if ! bash "$REPO_ROOT/scripts/checkpoint-validation/generate-synthetic-env.sh" "$synth_dir" >/dev/null 2>&1; then
    rm -rf "$synth_dir"
    say "ERROR: [dry-run] no se pudo generar el entorno sintético desde .env.example — abortando (nunca se recurre a .env real como sustituto)."
    exit 1
  fi
  local line k v
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    k="${line%%=*}"
    case "$k" in *[!A-Za-z0-9_]* | '') continue ;; esac
    v="${line#*=}"
    printf -v "GAPSSA_DRY_FIELD_${k}" '%s' "$v"
  done <"$synth_dir/.env"
  gapssa_secrets_shred "$synth_dir/.env"
  rm -rf "$synth_dir"
  GAPSSA_DRY_SYNTH_LOADED=true
}

compose_network_name() {
  local key="$1" proj
  proj="$(field_from_secrets_file COMPOSE_PROJECT_NAME)"
  proj="${proj:-gapssa}"
  printf '%s_%s' "$proj" "$key"
}

# ---------------------------------------------------------------------------
# máquina de estados + trap de interrupción
# ---------------------------------------------------------------------------

CURRENT_GATE=""

# Punto de choque único de dry-run para TODA la máquina de estados: si
# --dry-run está activo, ninguna puerta (S1..S9) escribe jamás en
# .rotation-status — ni al entrar (`applying`), ni a mitad
# (`verifying`), ni al salir (`done`/`blocked`/`failed`/etc.). Antes de
# esta corrección cada gate_sN llamaba a state_set()/enter_gate()/
# leave_gate_*() sin que ninguna comprobara $DRY_RUN, así que --dry-run
# SÍ modificaba el almacén externo (bug real, detectado en revisión).
# Arreglar aquí, en el único punto por el que pasan todas las
# transiciones, corrige las 9 puertas de una vez sin tocar cada una.
# Estado virtual de dry-run (corrección "dry-run fresco S1->S9") — en
# memoria del proceso ÚNICAMENTE, nunca en disco, Bash 3.2 compatible
# (variables indirectas, nunca un array asociativo de Bash 4+). Vive y
# muere con ESTE proceso:
# para el recorrido continuo S1->S9 (sin --only, el caso que reporta el
# defecto) todas las puertas corren en el mismo proceso, así que la puerta
# N ve el estado virtual que dejó la N-1. Con --only, cada invocación es
# un proceso nuevo sin memoria de las anteriores — igual que ya ocurría
# con el estado REAL en modo no-dry-run antes de esta corrección (una
# puerta aislada siempre exige que la anterior haya dejado evidencia
# recuperable), así que el comportamiento es consistente, nunca peor.
_gapssa_dry_vstate_set() {
  printf -v "GAPSSA_DRY_VSTATE_$1" '%s' "$2"
}
_gapssa_dry_vstate_get() {
  local varname="GAPSSA_DRY_VSTATE_$1"
  printf '%s' "${!varname:-pending}"
}

state_set() {
  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] estado quedaría: $1=$2 (no se escribe nada real)"
    _gapssa_dry_vstate_set "$1" "$2"
    return 0
  fi
  gapssa_secrets_state_set "$STATUS_FILE" "$1" "$2"
}
state_get() {
  if [ "$DRY_RUN" = true ]; then
    _gapssa_dry_vstate_get "$1"
    return 0
  fi
  gapssa_secrets_state_get "$STATUS_FILE" "$1"
}
gate_is_done() { [ "$(state_get "$1")" = "done" ]; }

# Versión de esquema (lib/backupSchema.mjs) que describe la forma REAL
# del contenido de $SECRETS_FILE en este instante — nunca se asume
# "active" a ciegas, y NUNCA se infiere de qué puerta ya terminó en esta
# sesión (gate_s7() nunca migra singular->plural: solo activa una v3
# nueva SOBRE mapas de booking-email/access-token que YA son plurales —
# ver su implementación — así que la forma del archivo es una propiedad
# FIJA desde que S1 lo crea, no algo que cambie cuando S7 se marca
# "done"; un detector basado en el estado de S7 puede quedar
# desincronizado del contenido real y bloquear TODAS las puertas con
# backup indefinidamente — hallazgo real del ensayo integral, Bloque 6).
# Delega en lib/detectSecretsSchemaVersion.mjs, que inspecciona el
# contenido REAL del archivo. Cada backup se etiqueta con el resultado
# de ESTA función en el momento exacto de crearlo, nunca con un valor
# fijo ni cacheado.
current_secrets_schema_version() {
  if [ "$DRY_RUN" = true ]; then
    # Nunca se abre $SECRETS_FILE real (aunque exista físicamente en esta
    # máquina) para detectar su esquema durante dry-run — un S1 fresco
    # (el único que --dry-run simula) siempre produce esquema "active"
    # (.env.example ya nace en forma plural/versionada), así que ese es
    # el único valor consistente con el resto del estado virtual.
    printf 'active'
    return 0
  fi
  [ -f "$SECRETS_FILE" ] || return 0
  node "$SCRIPT_DIR/lib/detectSecretsSchemaVersion.mjs" "$SECRETS_FILE"
}

on_interrupt() {
  say ""
  if [ -n "$CURRENT_GATE" ]; then
    local st
    st="$(state_get "$CURRENT_GATE" 2>/dev/null || printf 'pending')"
    case "$st" in
    applying | verifying)
      state_set "$CURRENT_GATE" rollback_required 2>/dev/null || true
      say "Interrumpido durante la puerta $CURRENT_GATE (estaba en '$st') — queda marcada 'rollback_required'."
      say "Vuelve a ejecutar este script: te avisará de esa puerta antes de continuar y podrás restaurar el backup si hace falta."
      ;;
    esac
  fi
  exit 130
}
trap on_interrupt INT TERM
# Libera el bloqueo de concurrencia (Bloque 6, B6-7) pase lo que pase --
# fin normal, `exit` explícito en cualquier puerta, o el `exit 130` de
# on_interrupt. No-op si nunca se llegó a adquirir (p. ej. otra sesión ya
# lo tenía y este proceso aborta antes).
trap gapssa_secrets_lock_release EXIT

# ---------------------------------------------------------------------------
# Frase de recuperación de backups — vive SOLO en esta variable bash del
# proceso en curso, nunca en disco, nunca en argv, nunca exportada a un
# hijo. Descifrar/cifrar un backup pasa la frase a `openssl` vía un
# fichero temporal 600 fuera del workspace generado EN EL MOMENTO y
# shreddeado inmediatamente después de cada uso — nunca `-pass pass:...`
# (visible en `ps`).
# ---------------------------------------------------------------------------
BACKUP_PASSPHRASE=""

ensure_backup_passphrase_known() {
  # Nunca tiene un valor de retorno legítimo por stdout (solo fija la
  # variable global $BACKUP_PASSPHRASE) — TODO su diálogo va a stderr a
  # propósito: se invoca también desde dentro de funciones cuyo stdout SÍ
  # se captura vía "$(...)" (recover_old_secret_value), y ese diálogo
  # nunca debe mezclarse con el valor real devuelto por esa función.
  [ -n "$BACKUP_PASSPHRASE" ] && return 0
  divider >&2
  say "Ningún backup puede cifrarse/descifrarse sin una frase de recuperación." >&2
  say "Esta frase NUNCA se guarda en ningún fichero — vive solo en la memoria de" >&2
  say "este proceso mientras dura esta ejecución." >&2
  if ask_yes_no "¿Generar una frase aleatoria segura ahora (recomendado)?" >&2; then
    BACKUP_PASSPHRASE="$(openssl rand -base64 24)"
    say "" >&2
    say "Tu frase de recuperación de ESTA sesión (se muestra UNA SOLA VEZ, nunca se" >&2
    say "volverá a mostrar ni se guarda en ningún sitio):" >&2
    say "" >&2
    say "  $BACKUP_PASSPHRASE" >&2
    say "" >&2
    say "Apúntala TÚ AHORA, fuera de este equipo (gestor de contraseñas) — sin ella," >&2
    say "los backups cifrados de esta sesión quedan irrecuperables por diseño." >&2
    pause_for_enter "Cuando la hayas apuntado," >&2
  else
    local p1 p2
    while true; do
      read -r -s -p "Introduce tu frase de recuperación (mínimo 20 caracteres): " p1 >&2
      echo >&2
      read -r -s -p "Repítela para confirmar: " p2 >&2
      echo >&2
      if [ "$p1" != "$p2" ]; then
        say "No coinciden — inténtalo de nuevo." >&2
        continue
      fi
      if [ "${#p1}" -lt 20 ]; then
        say "Demasiado corta (mínimo 20 caracteres) — inténtalo de nuevo." >&2
        continue
      fi
      BACKUP_PASSPHRASE="$p1"
      break
    done
    unset p1 p2
  fi
}

# Fichero temporal 600 (fuera del workspace) con la frase actual — el
# llamador DEBE hacer gapssa_secrets_shred sobre él justo después de la
# única llamada a openssl que lo usa.
_backup_passfile() {
  local f
  f="$(gapssa_secrets_mktemp_secure gapssa-backup-pass)"
  printf '%s' "$BACKUP_PASSPHRASE" >"$f"
  printf '%s' "$f"
}

_backup_dir_has_enough_free_space() {
  local avail_kb
  avail_kb="$(df -Pk "$SECRETS_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
  [ -n "$avail_kb" ] && [ "$avail_kb" -ge 5120 ]
}

# Cifra $SECRETS_FILE antes de que la puerta $1 toque nada real, con la
# versión de esquema EXPLÍCITA $2 (una de lib/backupSchema.mjs::
# KNOWN_SCHEMA_VERSIONS — nunca opcional, nunca inferida por qué claves
# "parezcan estar presentes": el llamador SIEMPRE debe pasarla, típicamente
# vía current_secrets_schema_version()). Nunca continúa sin backup: si
# falla CUALQUIER paso (versión ausente/desconocida, validación de
# contenido, espacio, cifrado, ensayo de restauración), la puerta ABORTA
# (return 1) — nunca "sigo sin backup", y nunca se conserva un backup
# cuyo contenido no coincida con la versión que se le va a grabar como
# etiqueta.
backup_secrets_file() {
  local gate="$1" schema_version="$2"
  if [ "$DRY_RUN" = true ]; then
    # Precondición VIRTUAL (¿ya hay un S1 simulado del que "habría" algo
    # que respaldar?), nunca `-f "$SECRETS_FILE"` real — un almacén
    # externo real preexistente en esta máquina nunca decide qué imprime
    # una sesión de dry-run.
    if [ "$(state_get S1)" = done ]; then
      say "[dry-run] se crearía un backup cifrado (esquema '${schema_version:-active}') de $SECRETS_FILE antes de la puerta $gate"
    fi
    return 0
  fi
  [ -f "$SECRETS_FILE" ] || return 0
  if [ -z "$schema_version" ]; then
    say "ERROR: backup_secrets_file requiere una versión de esquema explícita (uso interno incorrecto) — puerta $gate ABORTADA."
    return 1
  fi

  # Validar el contenido REAL de $SECRETS_FILE contra la versión de
  # esquema declarada ANTES de cifrar nada — un backup nunca se crea (ni
  # mucho menos se conserva) si su contenido no encaja con la etiqueta
  # que se le va a poner: eso es exactamente lo que evita que un archivo
  # todavía legacy-pre-s7 termine marcado "active" (o al revés).
  if ! node "$SCRIPT_DIR/lib/validateSecretsFileForBackup.mjs" "$SECRETS_FILE" "$schema_version" 2>/dev/null; then
    say "ERROR: el contenido de $SECRETS_FILE no es válido para la versión de esquema '$schema_version' (inventario cerrado + claves obligatorias) — puerta $gate ABORTADA sin crear backup."
    return 1
  fi

  ensure_backup_passphrase_known

  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"

  if ! _backup_dir_has_enough_free_space; then
    say "ERROR: espacio libre insuficiente junto a $BACKUP_DIR — puerta $gate abortada antes de tocar nada real."
    return 1
  fi

  local passfile
  local out out_dir out_dev out_ino out_uid out_mode
  # Bloque 6 (corrección de colisiones): reserva ATÓMICA del nombre —
  # nunca "comprobar existencia y escribir después" en dos pasos
  # separados (ver gapssa_secrets_reserve_with_retry en lib.sh). El
  # patrón de nombre generado (`${gate}-<ts>-<suffix>.env.gapssa.enc`)
  # es el MISMO que recover_old_secret_value() espera con su glob
  # `${gate}-*.env.gapssa.enc` — no cambia, solo cambia CÓMO se reserva.
  _backup_reserve_candidate() {
    printf '%s-%s-%s.env.gapssa.enc' "$gate" "$(date -u +%Y%m%dT%H%M%SZ)" "$(_gapssa_secrets_random_suffix_hex 4)"
  }
  local reserve_lines reserve_rc
  reserve_lines="$(gapssa_secrets_reserve_with_retry "$BACKUP_DIR" _backup_reserve_candidate 8)"
  reserve_rc=$?
  unset -f _backup_reserve_candidate
  if [ "$reserve_rc" != 0 ]; then
    say "ERROR: no se pudo reservar atómicamente un nombre de backup para la puerta $gate (colisiones repetidas o fallo real) — puerta ABORTADA. Ningún backup preexistente fue tocado ni adoptado."
    return 1
  fi
  { read -r out; read -r out_dir; read -r out_dev out_ino out_uid out_mode; } <<<"$reserve_lines"
  unset reserve_lines

  # Limpieza del artefacto reservado por ESTA sesión únicamente — nunca
  # borra nada cuya identidad (dir/dev/ino/propietario/modo) ya no
  # coincida con lo que ella misma acaba de reservar (mismo criterio que
  # gapssa_secrets_shred_pinned, aplicado aquí a un fichero binario en
  # vez de a un secreto en claro).
  _backup_reserved_cleanup() {
    if gapssa_secrets_verify_pinned_tmp "$out" "$out_dir" "$out_dev" "$out_ino" "$out_uid" "$out_mode"; then
      rm -f -- "$out"
    else
      say "AVISO: '$out' cambió de identidad tras reservarlo — limpieza automática omitida por seguridad (posible symlink/sustitución)."
    fi
  }

  # Construye SIEMPRE el mismo flujo de texto plano — etiqueta de versión
  # de esquema YA VALIDADA (primera línea) + contenido REAL de
  # $SECRETS_FILE — para cifrarlo y, por separado, para calcular su
  # digest de referencia; que ambos usos compartan esta única función es
  # lo que garantiza que el ensayo de más abajo compara exactamente lo
  # mismo que se cifró, nunca dos construcciones que podrían divergir.
  _backup_plaintext_stream() {
    printf '%s=%s\n' "$GAPSSA_BACKUP_SCHEMA_KEY" "$schema_version"
    cat "$SECRETS_FILE"
  }

  # NOTA sobre PIPESTATUS: solo refleja fielmente cada etapa de una
  # tubería cuando esa tubería se ejecuta como comando de primer nivel —
  # SI el resultado se captura envolviéndola en `$(...)` (sustitución de
  # comando), PIPESTATUS en el proceso padre deja de tener una entrada
  # por etapa (queda con un único valor, el de la sustitución completa).
  # Además, una vez leída una tubería recién ejecutada, CUALQUIER otro
  # comando simple posterior (incluida una simple asignación en su
  # propia línea) ya vuelve a pisar PIPESTATUS — por eso aquí siempre se
  # hace una única línea que copia el array completo a una variable
  # propia (`snap=("${PIPESTATUS[@]}")`) INMEDIATAMENTE después de cada
  # tubería, antes de tocar nada más, y solo se lee de esa copia después.
  # Reverifica la identidad reservada justo antes de escribir — cierra
  # la ventana (mínima, pero real) entre la reserva de arriba y este
  # punto. Nunca escribe en $out si algo cambió (posible symlink /
  # sustitución) entre medias.
  if ! gapssa_secrets_verify_pinned_tmp "$out" "$out_dir" "$out_dev" "$out_ino" "$out_uid" "$out_mode"; then
    unset -f _backup_plaintext_stream _backup_reserved_cleanup
    say "ERROR: '$out' cambió de identidad entre su reserva y la escritura — puerta $gate ABORTADA, nunca se escribe sobre él."
    return 1
  fi

  passfile="$(_backup_passfile)"
  gapssa_cleanup_push shred_plain "$passfile"
  # Bloque 6 (auditoría de temporales) — `openssl enc -out "$out"` crea
  # el fichero él mismo (nunca vía `gapssa_secrets_mktemp_secure`/`mktemp`,
  # que ya da 600 al margen del umask): sin acotar el umask ambiente del
  # operador ANTES de esta llamada, el backup cifrado podía existir, aunque
  # fuera solo durante la escritura, con el modo por defecto de ese umask
  # (p.ej. 644 con el 022 habitual) — el `chmod 600` de más abajo llegaba
  # DESPUÉS de escribir, no antes (bug real, detectado y corregido durante
  # esta revisión). Mismo patrón `restore_umask` ya aceptado en el flujo
  # de restauración (más abajo en este mismo fichero).
  local out_umask_saved
  out_umask_saved="$(umask)"
  umask 077
  gapssa_cleanup_push restore_umask "$out_umask_saved"
  local enc_ok=true enc_pipestatus
  _backup_plaintext_stream | openssl enc -aes-256-cbc -pbkdf2 -salt -out "$out" -pass "file:$passfile" 2>/dev/null
  enc_pipestatus=("${PIPESTATUS[@]}")
  umask "$out_umask_saved"
  gapssa_cleanup_pop_matching restore_umask "$out_umask_saved"
  gapssa_secrets_shred "$passfile"
  gapssa_cleanup_pop_matching shred_plain "$passfile"
  if [ "${enc_pipestatus[0]}" != 0 ] || [ "${enc_pipestatus[1]}" != 0 ]; then
    enc_ok=false
  fi
  if [ "$enc_ok" != true ]; then
    _backup_reserved_cleanup
    unset -f _backup_plaintext_stream _backup_reserved_cleanup
    say "ERROR: no se pudo cifrar el backup de la puerta $gate — puerta ABORTADA antes de tocar nada real."
    return 1
  fi
  chmod 600 "$out"

  # Ensayo de restauración EN STREAMING — nunca se decodifica a un
  # fichero de contenido en claro (ni siquiera temporal): se compara el
  # digest SHA-256 del flujo que se acaba de cifrar con el digest del
  # propio backup descifrado de proceso a proceso (openssl -> node, por
  # una tubería real). El digest en sí (dos ficheros temporales 600, de
  # vida efímera) se trata con la misma disciplina que un secreto: nunca
  # se imprime, se shreddea en cuanto se lee, se hace `unset` de la
  # variable. Se comprueba el código de salida de CADA etapa por
  # separado — aunque el archivo ya tiene `set -o pipefail` (línea 66,
  # parte de `set -euo pipefail`), pipefail por sí solo NO basta: reporta
  # el código de la ÚLTIMA etapa en fallar, así que si openssl fallara
  # pero la etapa siguiente aun así terminara con éxito (p.ej. leyendo
  # una entrada vacía/truncada sin error), pipefail ocultaría el fallo
  # real de openssl. Por eso cada tubería de digest se ejecuta como
  # comando de primer nivel (nunca dentro de `$(...)`), con su salida a
  # un fichero temporal, para poder capturar el array PIPESTATUS
  # completo justo después.
  local orig_digest_file
  orig_digest_file="$(gapssa_secrets_mktemp_secure gapssa-backup-origdigest)"
  gapssa_cleanup_push shred_plain "$orig_digest_file"
  local orig_pipestatus
  _backup_plaintext_stream | node "$SCRIPT_DIR/lib/digestStream.mjs" >"$orig_digest_file"
  orig_pipestatus=("${PIPESTATUS[@]}")
  unset -f _backup_plaintext_stream
  if [ "${orig_pipestatus[0]}" != 0 ] || [ "${orig_pipestatus[1]}" != 0 ]; then
    gapssa_secrets_shred "$orig_digest_file"
    gapssa_cleanup_pop_matching shred_plain "$orig_digest_file"
    _backup_reserved_cleanup
    unset -f _backup_reserved_cleanup
    say "ERROR: no se pudo calcular el digest de referencia del archivo externo — puerta $gate ABORTADA."
    return 1
  fi
  local orig_digest
  orig_digest="$(cat "$orig_digest_file")"
  gapssa_secrets_shred "$orig_digest_file"
  gapssa_cleanup_pop_matching shred_plain "$orig_digest_file"

  passfile="$(_backup_passfile)"
  gapssa_cleanup_push shred_plain "$passfile"
  local dec_digest_file
  dec_digest_file="$(gapssa_secrets_mktemp_secure gapssa-backup-decdigest)"
  gapssa_cleanup_push shred_plain "$dec_digest_file"
  local dec_pipestatus
  openssl enc -d -aes-256-cbc -pbkdf2 -in "$out" -pass "file:$passfile" 2>/dev/null | node "$SCRIPT_DIR/lib/digestStream.mjs" >"$dec_digest_file"
  dec_pipestatus=("${PIPESTATUS[@]}")
  gapssa_secrets_shred "$passfile"
  gapssa_cleanup_pop_matching shred_plain "$passfile"
  local dec_digest
  dec_digest="$(cat "$dec_digest_file" 2>/dev/null || true)"
  gapssa_secrets_shred "$dec_digest_file"
  gapssa_cleanup_pop_matching shred_plain "$dec_digest_file"

  if [ "${dec_pipestatus[0]}" != 0 ] || [ "${dec_pipestatus[1]}" != 0 ] || [ -z "$dec_digest" ] || [ "$dec_digest" != "$orig_digest" ]; then
    unset orig_digest dec_digest
    _backup_reserved_cleanup
    unset -f _backup_reserved_cleanup
    say "ERROR: el ensayo de restauración del backup de la puerta $gate falló — backup descartado, puerta ABORTADA."
    return 1
  fi
  unset orig_digest dec_digest
  unset -f _backup_reserved_cleanup

  say "Backup cifrado y verificado (ensayo de restauración en streaming, sin texto plano en disco) de esta puerta: $out"
  return 0
}

# Extrae UNA variable del backup cifrado más reciente de $gate, en
# streaming (openssl descifra hacia stdout, nunca a un fichero) — nunca
# se crea un .env.gapssa descifrado completo en disco. El valor solo vive
# en la variable bash devuelta al llamador, que debe hacer `unset`
# inmediatamente después de usarlo. Vacío + return 1 si no hay backup o la
# frase no descifra — el llamador NUNCA debe inventar un valor en ese caso.
recover_old_secret_value() {
  local gate="$1" var_name="$2"
  local latest
  latest="$(ls -t "$BACKUP_DIR/${gate}-"*.env.gapssa.enc 2>/dev/null | head -n1 || true)"
  if [ -z "$latest" ]; then
    say "No hay ningún backup de la puerta $gate en $BACKUP_DIR — no se puede demostrar el valor anterior de $var_name." >&2
    return 1
  fi
  ensure_backup_passphrase_known
  local passfile
  passfile="$(_backup_passfile)"
  # lib/recoverOldSecretValue.mjs coordina descifrado + parseo en UN SOLO
  # proceso Node (openssl corre como hijo suyo) — el valor NUNCA toca un
  # fichero regular, ni siquiera temporal: viaja únicamente por el stdout
  # de ese proceso hacia esta sustitución de comando. No hace falta
  # PIPESTATUS aquí porque no hay ninguna tubería de bash de por medio —
  # `$?` tras la asignación ya es el código de salida real de ese único
  # proceso (openssl falló -> exit 4; parseo/esquema inválido -> exit 2;
  # variable ausente -> exit 3).
  local value rc=0
  value="$(node "$SCRIPT_DIR/lib/recoverOldSecretValue.mjs" "$latest" "$passfile" "$var_name" 2>/dev/null)" || rc=$?
  gapssa_secrets_shred "$passfile"
  if [ "$rc" != 0 ]; then
    unset value
    say "No se pudo recuperar $var_name del backup de $gate (frase incorrecta, backup corrupto, formato de esquema no reconocido o variable ausente) — no se puede demostrar el valor anterior." >&2
    return 1
  fi
  # Bloque 6: un valor VACÍO recuperado con éxito (nunca "frase
  # incorrecta"/"backup corrupto"/etc.) es distinto de un fallo de
  # recuperación — ESPOCRM_API_KEY, en concreto, empieza legítimamente
  # vacío hasta la primerísima vez que S4 lo genera (instalación nueva,
  # sin API Key configurada antes). Tratar ese "vacío genuino" como si
  # fuera un fallo de descifrado bloqueaba S9 PERMANENTEMENTE en ese
  # caso real — hallazgo del ensayo integral, Bloque 6. Cada llamador
  # decide qué significa "vacío" para SU secreto (ver el de S4 más
  # abajo); los demás (contraseñas de infraestructura) nunca están
  # vacíos en la práctica, así que este cambio no les afecta.
  printf '%s' "$value"
  unset value
  return 0
}

restore_secrets_file_from_latest_backup() {
  local gate="$1"
  local latest
  latest="$(ls -t "$BACKUP_DIR/${gate}-"*.env.gapssa.enc 2>/dev/null | head -n1 || true)"
  if [ -z "$latest" ]; then
    say "No hay ningún backup de la puerta $gate en $BACKUP_DIR."
    return 1
  fi
  say "Backup más reciente de $gate: $latest"
  if ! ask_yes_no "¿Restaurar $SECRETS_FILE desde ese backup Y reaplicar la credencial ANTERIOR al servidor real? (recupera disponibilidad ahora mismo si el servidor queda coordinado — NUNCA cuenta como rotación completa)"; then
    return 1
  fi
  ensure_backup_passphrase_known
  backup_secrets_file "pre-restore-${gate}" "$(current_secrets_schema_version)" || {
    say "ERROR: no se pudo tomar backup del estado actual antes de restaurar — restauración cancelada por seguridad."
    return 1
  }

  local target_dir
  target_dir="$(dirname "$SECRETS_FILE")"
  gapssa_secrets_abort_if_inside_workspace "$target_dir"

  # --- 1. Huérfanos de una restauración anterior interrumpida — NUNCA se
  #        adoptan automáticamente. Enumeración vía Node
  #        (lib/scanOrphanRestoreTmp.mjs, readdir+lstat — nunca
  #        `for f in $glob`, que rompe con espacios/caracteres
  #        especiales en el nombre) y retirada vía Node
  #        (lib/removeOrphanTmp.mjs), que revalida tipo+device+inode
  #        justo antes de actuar y ABORTA sin tocar nada si la identidad
  #        ya no coincide con la fijada en el escaneo — un huérfano
  #        symlink se retira con unlink del propio enlace solamente
  #        (nunca se sigue, nunca se sobrescribe su destino); un huérfano
  #        fichero regular exige una decisión explícita del operador.
  #        El protocolo campo-a-campo NUL-delimitado y su validación
  #        viven en lib.sh::gapssa_secrets_parse_orphan_stream (un único
  #        sitio, reutilizado y con pruebas propias en lib.test.sh). ---
  if ! gapssa_secrets_parse_orphan_stream < <(node "$SCRIPT_DIR/lib/scanOrphanRestoreTmp.mjs" "$target_dir" "$(basename "$SECRETS_FILE")" 2>/dev/null); then
    say "ERROR: no se pudo interpretar con seguridad la lista de huérfanos (flujo truncado, número de campos incorrecto, o campo con formato inválido) — restauración cancelada, ningún fichero tocado."
    return 1
  fi

  local orphan_count="${#GAPSSA_ORPHAN_TYPES[@]}"
  if [ "$orphan_count" -gt 0 ]; then
    local orphan_display=() oi
    for ((oi = 0; oi < orphan_count; oi++)); do
      orphan_display+=("${GAPSSA_ORPHAN_PATHS[$oi]} (${GAPSSA_ORPHAN_TYPES[$oi]})")
    done
    say "Se han encontrado ${orphan_count} fichero(s) temporal(es) huérfano(s) de una restauración anterior interrumpida (rutas, nunca contenido):"
    printf '  %s\n' "${orphan_display[@]}"
    if ! ask_yes_no "¿Retirarlos ahora (symlinks: solo el enlace; ficheros regulares: sobrescritura+borrado) antes de continuar? ('no' cancela esta restauración)"; then
      say "Restauración cancelada — resuelve manualmente los huérfanos primero."
      return 1
    fi
    local remove_failed=false remove_output
    for ((oi = 0; oi < orphan_count; oi++)); do
      if [ "${GAPSSA_ORPHAN_TYPES[$oi]}" != "symlink" ] && [ "${GAPSSA_ORPHAN_TYPES[$oi]}" != "regular" ]; then
        say "AVISO: '${GAPSSA_ORPHAN_PATHS[$oi]}' no es fichero regular ni symlink — se deja intacto, revísalo a mano."
        continue
      fi
      if ! remove_output="$(node "$SCRIPT_DIR/lib/removeOrphanTmp.mjs" "${GAPSSA_ORPHAN_PATHS[$oi]}" "${GAPSSA_ORPHAN_TYPES[$oi]}" "${GAPSSA_ORPHAN_DEVS[$oi]}" "${GAPSSA_ORPHAN_INOS[$oi]}" 2>&1)"; then
        remove_failed=true
        say "$remove_output"
      fi
    done
    if [ "$remove_failed" = true ]; then
      say "ERROR: no se pudieron retirar todos los huérfanos con seguridad (identidad cambiada respecto al escaneo — evidencia arriba) — restauración cancelada."
      return 1
    fi
  fi

  # --- 2. umask restrictivo durante toda la restauración; se registra en
  #        la pila de limpieza global (para el caso de interrupción) Y se
  #        restaura explícitamente en cada camino de salida de esta
  #        función (la pila es la red de seguridad para una interrupción
  #        asíncrona, nunca el mecanismo principal en el camino normal). ---
  local old_umask
  old_umask="$(umask)"
  umask 077
  gapssa_cleanup_push restore_umask "$old_umask"
  _restore_umask_now() {
    umask "$old_umask"
    gapssa_cleanup_pop_matching restore_umask "$old_umask"
  }

  # --- 3. Temporal "fijado" en el mismo directorio/filesystem que
  #        $SECRETS_FILE (imprescindible para que el mv posterior sea
  #        atómico). ---
  local pin_lines
  if ! pin_lines="$(gapssa_secrets_mktemp_secure_same_dir "$SECRETS_FILE" restore)"; then
    _restore_umask_now
    unset -f _restore_umask_now
    say "ERROR: no se pudo crear el fichero temporal de restauración."
    return 1
  fi
  local restore_tmp restore_tmp_dir restore_tmp_dev restore_tmp_ino restore_tmp_uid restore_tmp_mode
  {
    read -r restore_tmp
    read -r restore_tmp_dir
    read -r restore_tmp_dev restore_tmp_ino restore_tmp_uid restore_tmp_mode
  } <<<"$pin_lines"

  if ! gapssa_secrets_verify_pinned_tmp "$restore_tmp" "$restore_tmp_dir" "$restore_tmp_dev" "$restore_tmp_ino" "$restore_tmp_uid" "$restore_tmp_mode"; then
    _restore_umask_now
    unset -f _restore_umask_now
    say "ERROR: el temporal recién creado no pasó su propia verificación de identidad — restauración cancelada."
    return 1
  fi

  # --- 4. Limpieza del temporal registrada INMEDIATAMENTE tras fijarlo
  #        (misma lógica de pila+restauración explícita que el umask). ---
  gapssa_cleanup_push shred_pinned_tmp "$restore_tmp" "$restore_tmp_dir" "$restore_tmp_dev" "$restore_tmp_ino" "$restore_tmp_uid" "$restore_tmp_mode"
  _restore_abort_tmp() {
    gapssa_secrets_shred_pinned "$restore_tmp" "$restore_tmp_dir" "$restore_tmp_dev" "$restore_tmp_ino" "$restore_tmp_uid" "$restore_tmp_mode" 2>/dev/null || true
    gapssa_cleanup_pop_matching shred_pinned_tmp "$restore_tmp" "$restore_tmp_dir" "$restore_tmp_dev" "$restore_tmp_ino" "$restore_tmp_uid" "$restore_tmp_mode"
  }

  # --- 5. Descifrar + validar (parser cerrado por versión de esquema,
  #        lib/backupSchema.mjs) + despojar de la etiqueta de esquema +
  #        escribir + fsync + REVALIDAR + RENAME atómico al destino final
  #        + fsync del directorio — TODO en un único helper Node
  #        (lib/writeRestorePayload.mjs), en un único proceso: abre el
  #        temporal con O_NOFOLLOW, revalida sobre el fd YA ABIERTO
  #        (fstat), y es el propio Node quien ejecuta el rename — bash
  #        NUNCA hace un `mv` por separado después, para no añadir una
  #        segunda invocación de proceso (y por tanto una segunda ventana
  #        de tiempo) entre "el contenido ya se validó" y "el fichero ya
  #        está en su sitio". Límite residual documentado dentro del
  #        propio writeRestorePayload.mjs: la reverificación justo antes
  #        del rename usa lstat sobre la ruta, no elimina la ventana por
  #        completo (POSIX no ofrece un rename basado en descriptor
  #        portable a macOS), solo la reduce al mínimo dentro de un único
  #        proceso — el directorio 700 propiedad del operador limita ese
  #        residuo a un atacante que YA ejecuta código como ese mismo
  #        usuario. ---
  local passfile
  passfile="$(_backup_passfile)"
  gapssa_cleanup_push shred_plain "$passfile"
  local write_output_file write_pipestatus
  write_output_file="$(gapssa_secrets_mktemp_secure gapssa-restore-schemaver)"
  gapssa_cleanup_push shred_plain "$write_output_file"
  openssl enc -d -aes-256-cbc -pbkdf2 -in "$latest" -pass "file:$passfile" 2>/dev/null \
    | node "$SCRIPT_DIR/lib/writeRestorePayload.mjs" "$restore_tmp" "$SECRETS_FILE" "$restore_tmp_dev" "$restore_tmp_ino" "$restore_tmp_uid" "$restore_tmp_mode" 2>/dev/null >"$write_output_file"
  write_pipestatus=("${PIPESTATUS[@]}")
  gapssa_secrets_shred "$passfile"
  gapssa_cleanup_pop_matching shred_plain "$passfile"
  local schema_version openssl_rc write_node_rc
  schema_version="$(cat "$write_output_file" 2>/dev/null || true)"
  gapssa_secrets_shred "$write_output_file"
  gapssa_cleanup_pop_matching shred_plain "$write_output_file"
  openssl_rc="${write_pipestatus[0]}"
  write_node_rc="${write_pipestatus[1]}"

  # write_node_rc == 13 es el ÚNICO caso en el que el rename ya se
  # ejecutó (ver lib/writeRestorePayload.mjs) — todos los demás códigos
  # de fallo (2/3/4/10/11/12, o que openssl mismo fallara) garantizan que
  # $SECRETS_FILE nunca se tocó y que el temporal sigue en su sitio (o
  # nunca llegó a existir con contenido), así que la limpieza normal del
  # temporal sigue siendo correcta para todos ellos.
  if [ "$openssl_rc" = 0 ] && [ "$write_node_rc" = 13 ]; then
    unset schema_version
    gapssa_cleanup_pop_matching shred_pinned_tmp "$restore_tmp" "$restore_tmp_dir" "$restore_tmp_dev" "$restore_tmp_ino" "$restore_tmp_uid" "$restore_tmp_mode"
    unset -f _restore_abort_tmp
    _restore_umask_now
    unset -f _restore_umask_now
    say "AVISO GRAVE: el rename se ejecutó pero no se pudo confirmar que el destino corresponde al contenido escrito — revisa $SECRETS_FILE manualmente antes de continuar. No se afirma ningún estado de recuperación."
    return 1
  fi
  if [ "$openssl_rc" != 0 ] || [ "$write_node_rc" != 0 ]; then
    unset schema_version
    _restore_abort_tmp
    _restore_umask_now
    unset -f _restore_abort_tmp _restore_umask_now
    say "ERROR: no se pudo descifrar/validar/escribir/renombrar el backup (frase incorrecta, backup corrupto, formato de esquema no reconocido, inventario/obligatorias no válidos para esa versión, el temporal cambió de identidad, o el propio rename falló) — restauración cancelada, el archivo externo actual no se tocó."
    return 1
  fi
  unset schema_version

  # --- 6. Rename ya confirmado por writeRestorePayload.mjs — retira la
  #        entrada de limpieza del temporal (ya no existe con esa ruta)
  #        para que un trap posterior nunca intente tocar $SECRETS_FILE
  #        creyendo que sigue siendo el temporal. El fsync del directorio
  #        contenedor también lo hizo ya ese mismo proceso (mejor
  #        esfuerzo, documentado ahí). ---
  gapssa_cleanup_pop_matching shred_pinned_tmp "$restore_tmp" "$restore_tmp_dir" "$restore_tmp_dev" "$restore_tmp_ino" "$restore_tmp_uid" "$restore_tmp_mode"
  unset -f _restore_abort_tmp

  # --- 7. Confirmación final + restaurar umask. ---
  local final_mode
  final_mode="$(gapssa_secrets_check_file_mode "$SECRETS_FILE")"
  _restore_umask_now
  unset -f _restore_umask_now

  say "restore_atomic=true temporary_cleanup=true"
  if [ "$final_mode" != true ]; then
    say "AVISO: el archivo restaurado no quedó en modo 600 — revísalo manualmente."
  fi

  # --- 8. Coordinación con el/los SERVIDOR(es) real(es) (Bloque 5) — el
  #        estado final de la puerta depende ÚNICAMENTE de evidencia
  #        VERIFICADA por componente (lib/decideRecoveryPlan.mjs); nunca
  #        se asume ni se afirma "disponibilidad recuperada" sin más, y
  #        un sub-secreto IRREVERSIBLE (la API Key de S4) nunca se
  #        restaura a un valor antiguo — solo recuperación hacia
  #        delante. ---
  local reconciled_state
  reconciled_state="$(reconcile_server_after_restore "$gate")"
  say "server_reconciliation_state=${reconciled_state}"

  case "$reconciled_state" in
  recovery_required)
    state_set "$gate" recovery_required
    say "Puerta $gate: ARCHIVO y SERVIDOR coordinados con la credencial ANTERIOR (comprometida) — disponibilidad recuperada, pero esto NO es una rotación completa."
    say "Vuelve a ejecutar esta puerta para generar un secreto NUEVO antes de poder llegar a S9."
    ;;
  forward_recovery_required)
    state_set "$gate" forward_recovery_required
    say "Puerta $gate: al menos un sub-secreto IRREVERSIBLE ya no podía revertirse — se generó un valor NUEVO, se aplicó al servidor y se escribió en $SECRETS_FILE (recuperación hacia delante). Disponibilidad recuperada con un valor NUEVO, pero esto TAMPOCO es una rotación completa — S9 seguirá rechazando esta puerta hasta que la repitas."
    ;;
  *)
    state_set "$gate" server_coordination_required
    say "Puerta $gate: el ARCHIVO externo ya quedó restaurado correctamente, pero al menos un sub-secreto sigue sin coordinar con el SERVIDOR real (ver detalle arriba) — la disponibilidad NO está confirmada."
    ;;
  esac
  return 0
}

# --- Bloque 5: evidencia de reconciliación real por puerta ---
#
# Cada función de abajo intenta reconciliar el/los sub-secreto(s) de su
# puerta con el SERVIDOR real, y devuelve SIEMPRE evidencia genuina (nunca
# "coordinado" sin haberlo verificado con una conexión nueva) en la forma
# exacta que exige lib/decideRecoveryPlan.mjs. Ninguna asume que aplicar
# tuvo éxito solo porque el comando no falló — cada aplicación se
# re-verifica con una conexión fresca antes de marcarse `verifiedAfterApply`.

_recovery_evidence_s2() {
  local pg_user pg_db pw
  pg_user="$(field_from_secrets_file POSTGRES_USER)"
  pg_db="$(field_from_secrets_file POSTGRES_DB)"
  pw="$(field_from_secrets_file POSTGRES_PASSWORD)"

  local restored_works=false attempted=false succeeded=false verified=false
  if pg_capture "SELECT 1;" "$pg_user" "$pw" >/dev/null 2>&1; then
    restored_works=true
  else
    attempted=true
    local apply_ok
    apply_ok="$(printf '%s' "$pw" | _pg_apply_password_via_socket apps-db "$pg_user" "$pg_db")"
    [ "$apply_ok" = true ] && succeeded=true
    if [ "$succeeded" = true ] && pg_capture "SELECT 1;" "$pg_user" "$pw" >/dev/null 2>&1; then
      verified=true
    fi
  fi
  unset pw

  local c1
  c1="$(_recovery_component_reversible postgres_password "$restored_works" "$attempted" "$succeeded" "$verified")"
  _recovery_evidence_envelope S2 "$c1"
}

_recovery_evidence_s3() {
  local db_pw root_pw
  db_pw="$(field_from_secrets_file ESPOCRM_DB_PASSWORD)"
  root_pw="$(field_from_secrets_file ESPOCRM_DB_ROOT_PASSWORD)"

  local root_restored_works=false espocrm_restored_works=false
  mariadb_capture "SELECT 1;" root "$root_pw" >/dev/null 2>&1 && root_restored_works=true
  mariadb_capture "SELECT 1;" espocrm "$db_pw" >/dev/null 2>&1 && espocrm_restored_works=true

  local auth_root_pw=""
  if [ "$root_restored_works" = true ]; then
    auth_root_pw="$root_pw"
  else
    say "Para reconciliar MariaDB tras la restauración hace falta la contraseña ROOT ACTUAL (la que tiene el servidor AHORA MISMO) — no se mostrará, no se guarda, se olvida en cuanto termine este paso." >&2
    read -r -s -p "Contraseña ROOT actual de MariaDB (Enter para omitir la reconciliación automática): " auth_root_pw
    echo >&2
    if [ -n "$auth_root_pw" ] && ! mariadb_capture "SELECT 1;" root "$auth_root_pw" >/dev/null 2>&1; then
      say "  AVISO: esa contraseña no autentica como root ahora mismo — se omite la reconciliación automática de MariaDB." >&2
      auth_root_pw=""
    fi
  fi

  local root_apply_attempted=false root_apply_succeeded=false root_verified=false
  local espocrm_apply_attempted=false espocrm_apply_succeeded=false espocrm_verified=false

  if [ -n "$auth_root_pw" ]; then
    local hosts_raw
    hosts_raw="$(mariadb_capture "SELECT User, Host FROM mysql.user WHERE User IN ('root','espocrm');" root "$auth_root_pw" 2>/dev/null || true)"

    if [ "$root_restored_works" != true ]; then
      root_apply_attempted=true
      local all_root_ok=true user host
      while IFS=$'\t' read -r user host; do
        [ "$user" = "root" ] || continue
        [ -n "$host" ] || continue
        local ok
        ok="$(printf '%s\0%s' "$auth_root_pw" "$root_pw" | _mariadb_apply_password_via_auth espocrm-db root "$host" root)"
        [ "$ok" = true ] || all_root_ok=false
      done <<<"$hosts_raw"
      if [ "$all_root_ok" = true ]; then
        root_apply_succeeded=true
        if mariadb_capture "SELECT 1;" root "$root_pw" >/dev/null 2>&1; then
          root_verified=true
          auth_root_pw="$root_pw"
        fi
      fi
    fi

    if [ "$espocrm_restored_works" != true ]; then
      espocrm_apply_attempted=true
      local all_espocrm_ok=true user2 host2
      while IFS=$'\t' read -r user2 host2; do
        [ "$user2" = "espocrm" ] || continue
        [ -n "$host2" ] || continue
        local ok2
        ok2="$(printf '%s\0%s' "$auth_root_pw" "$db_pw" | _mariadb_apply_password_via_auth espocrm-db espocrm "$host2" root)"
        [ "$ok2" = true ] || all_espocrm_ok=false
      done <<<"$hosts_raw"
      if [ "$all_espocrm_ok" = true ]; then
        espocrm_apply_succeeded=true
        mariadb_capture "SELECT 1;" espocrm "$db_pw" >/dev/null 2>&1 && espocrm_verified=true
      fi
    fi
  fi
  unset root_pw auth_root_pw

  # --- disponibilidad de APLICACIÓN (Revisión 2, punto 7) — NUNCA se
  #     declara "disponibilidad recuperada" solo porque MariaDB acepte
  #     las credenciales: además hay que recrear/reiniciar de forma
  #     controlada los consumidores desechables (espocrm, espocrm-
  #     daemon, espocrm-websocket) y ejecutar un app-check REAL —
  #     bin/command app-check comprueba, entre otras cosas, la propia
  #     conexión de EspoCRM a su base de datos, así que su éxito ES la
  #     evidencia de "aplicación disponible", distinta y posterior a
  #     "credencial de BD coordinada". Se registra como componente
  #     OBLIGATORIO: si no se verifica la aplicación, el componente
  #     queda server_mismatch y decideRecoveryPlan.mjs cierra la puerta
  #     en server_coordination_required — nunca en recovery_required,
  #     por muy bien que hayan ido las credenciales de MariaDB solas. Si
  #     las credenciales de BD ni siquiera quedaron coordinadas, ni se
  #     intenta (attempted=false): recrear los contenedores sería
  #     trabajo desperdiciado con un resultado ya conocido.
  local db_coordinated=false
  if { [ "$root_restored_works" = true ] || [ "$root_verified" = true ]; } &&
    { [ "$espocrm_restored_works" = true ] || [ "$espocrm_verified" = true ]; }; then
    db_coordinated=true
  fi

  local app_restored_works=false app_attempted=false app_succeeded=false app_verified=false
  if [ "$db_coordinated" = true ]; then
    if _gapssa_compose exec -T espocrm bin/command app-check >/dev/null 2>&1; then
      app_restored_works=true
    else
      app_attempted=true
      # Bloque 6 — mismo hallazgo real que en gate_s3(): el entrypoint de
      # la imagen NO resincroniza data/config-internal.php desde
      # ESPOCRM_DATABASE_PASSWORD contra una instancia YA instalada — solo
      # en el primer arranque. Sin este paso, el --force-recreate de abajo
      # deja EspoCRM en un bucle infinito de "Waiting for database
      # connection" con la contraseña VIEJA, y app_verified nunca llegaría
      # a true pese a que la credencial de MariaDB sí quedó coordinada.
      if [ "$(printf '%s' "$db_pw" | _espo_sync_config_password espocrm)" != false ] &&
        _gapssa_compose up -d --force-recreate espocrm espocrm-daemon espocrm-websocket >/dev/null 2>&1; then
        app_succeeded=true
        local attempt
        for attempt in $(seq 1 12); do
          if _gapssa_compose exec -T espocrm bin/command app-check >/dev/null 2>&1; then
            app_verified=true
            break
          fi
          sleep 5
        done
      fi
    fi
  fi
  unset db_pw

  local c1 c2 c3
  c1="$(_recovery_component_reversible mariadb_root "$root_restored_works" "$root_apply_attempted" "$root_apply_succeeded" "$root_verified")"
  c2="$(_recovery_component_reversible mariadb_espocrm "$espocrm_restored_works" "$espocrm_apply_attempted" "$espocrm_apply_succeeded" "$espocrm_verified")"
  c3="$(_recovery_component_reversible espocrm_app_availability "$app_restored_works" "$app_attempted" "$app_succeeded" "$app_verified")"
  _recovery_evidence_envelope S3 "$c1" "$c2" "$c3"
}

_recovery_evidence_s4() {
  local admin_user espocrm_port admin_pw api_key
  admin_user="$(field_from_secrets_file ESPOCRM_ADMIN_USERNAME)"; admin_user="${admin_user:-admin}"
  espocrm_port="$(field_from_secrets_file ESPOCRM_HTTP_PORT)"; espocrm_port="${espocrm_port:-8081}"
  admin_pw="$(field_from_secrets_file ESPOCRM_ADMIN_PASSWORD)"
  api_key="$(field_from_secrets_file ESPOCRM_API_KEY)"

  # --- admin password: reversible, `bin/command set-password` es
  #     siempre seguro de reaplicar sin condiciones (no exige la
  #     contraseña anterior) ---
  local admin_restored_works=false admin_attempted=false admin_succeeded=false admin_verified=false
  local curl_check_cfg
  curl_check_cfg="$(gapssa_secrets_mktemp_secure gapssa-recover-curl-admin-check)"
  gapssa_cleanup_push shred_plain "$curl_check_cfg"
  write_curl_config "$curl_check_cfg" "user = \"${admin_user}:$(gapssa_secrets_curl_cfg_escape "${admin_pw}")\"" "fail"
  if [ "$(_espo_verify_credential_json "$curl_check_cfg" "$espocrm_port")" = true ]; then
    admin_restored_works=true
  else
    admin_attempted=true
    local set_ok
    set_ok="$(printf '%s' "$admin_pw" | _espo_set_admin_password espocrm "$admin_user")"
    [ "$set_ok" = true ] && admin_succeeded=true
    if [ "$admin_succeeded" = true ] && [ "$(_espo_verify_credential_json "$curl_check_cfg" "$espocrm_port")" = true ]; then
      admin_verified=true
    fi
  fi
  gapssa_secrets_shred "$curl_check_cfg"
  gapssa_cleanup_pop_matching shred_plain "$curl_check_cfg"
  unset admin_pw

  # --- API key: IRREVERSIBLE — nunca se reaplica un valor antiguo;
  #     solo recuperación hacia delante, y solo con un admin ya
  #     coordinado (nunca se genera una API Key nueva con una
  #     credencial de admin sin confirmar) ---
  local key_restored_works=false key_attempted=false key_recovered=false
  if [ -n "$api_key" ]; then
    local curl_key_cfg
    curl_key_cfg="$(gapssa_secrets_mktemp_secure gapssa-recover-curl-apikey-check)"
    gapssa_cleanup_push shred_plain "$curl_key_cfg"
    write_curl_config "$curl_key_cfg" "header = \"X-Api-Key: $(gapssa_secrets_curl_cfg_escape "${api_key}")\"" "fail"
    [ "$(_espo_verify_credential_json "$curl_key_cfg" "$espocrm_port")" = true ] && key_restored_works=true
    gapssa_secrets_shred "$curl_key_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_key_cfg"
  fi
  unset api_key

  local admin_now_ok=false
  [ "$admin_restored_works" = true ] && admin_now_ok=true
  [ "$admin_verified" = true ] && admin_now_ok=true

  if [ "$key_restored_works" != true ] && [ "$admin_now_ok" = true ]; then
    key_attempted=true
    local curl_admin_now_cfg new_admin_pw
    new_admin_pw="$(field_from_secrets_file ESPOCRM_ADMIN_PASSWORD)"
    curl_admin_now_cfg="$(gapssa_secrets_mktemp_secure gapssa-recover-curl-admin-now)"
    gapssa_cleanup_push shred_plain "$curl_admin_now_cfg"
    write_curl_config "$curl_admin_now_cfg" "user = \"${admin_user}:$(gapssa_secrets_curl_cfg_escape "${new_admin_pw}")\"" "fail"
    unset new_admin_pw
    # REVISIÓN 2 (punto 5): exige type=api EXACTO — un User ausente,
    # eliminado, ambiguo (más de una coincidencia) o presente pero de
    # otro `type` NUNCA cuenta como "encontrado". El inventario de esta
    # V1 EXIGE ese usuario: su ausencia nunca se interpreta como "no hay
    # nada que reconciliar" (key_restored_works=true) — queda
    # key_recovered=false, forzando server_coordination_required.
    local user_id
    user_id="$(_espo_find_user_id_by_username "$curl_admin_now_cfg" "$espocrm_port" "portal-gapssa-api" "api")"
    if [ -n "$user_id" ]; then
      local regen_ok
      regen_ok="$(_espo_regenerate_api_key_and_write "$curl_admin_now_cfg" "$espocrm_port" "$user_id" "$SECRETS_FILE" "$(current_secrets_schema_version)")"
      if [ "$regen_ok" = true ]; then
        local new_key curl_newkey_cfg
        new_key="$(field_from_secrets_file ESPOCRM_API_KEY)"
        curl_newkey_cfg="$(gapssa_secrets_mktemp_secure gapssa-recover-curl-apikey-new)"
        gapssa_cleanup_push shred_plain "$curl_newkey_cfg"
        write_curl_config "$curl_newkey_cfg" "header = \"X-Api-Key: $(gapssa_secrets_curl_cfg_escape "${new_key}")\"" "fail"
        unset new_key
        [ "$(_espo_verify_credential_json "$curl_newkey_cfg" "$espocrm_port")" = true ] && key_recovered=true
        gapssa_secrets_shred "$curl_newkey_cfg"
        gapssa_cleanup_pop_matching shred_plain "$curl_newkey_cfg"
      fi
    else
      say "AVISO: no se encontró un User 'portal-gapssa-api' único de type=api en esta instancia — el inventario de esta V1 lo exige, así que la recuperación de ESPOCRM_API_KEY NUNCA se da por coordinada sin él (server_coordination_required, no 'nada que reconciliar')." >&2
    fi
    gapssa_secrets_shred "$curl_admin_now_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_now_cfg"
  fi

  local c1 c2
  c1="$(_recovery_component_reversible espocrm_admin_password "$admin_restored_works" "$admin_attempted" "$admin_succeeded" "$admin_verified")"
  c2="$(_recovery_component_irreversible espocrm_api_key "$key_restored_works" "$key_attempted" "$key_recovered")"
  _recovery_evidence_envelope S4 "$c1" "$c2"
}

_recovery_evidence_s5() {
  local pw redis_port
  pw="$(field_from_secrets_file REDIS_PASSWORD)"
  redis_port="$(field_from_secrets_file REDIS_HOST_PORT)"
  redis_port="${redis_port:-6380}"

  local restored_works=false attempted=false succeeded=false verified=false
  # REVISIÓN 2 (punto 1) — el contrato cerrado se aplica ANTES de
  # cualquier intento de autenticación real: un valor de $SECRETS_FILE
  # que no lo cumpliera (p.ej. corrupción del archivo) nunca debe
  # dispararse contra Redis a ciegas. El protocolo de
  # lib/redisVerify.mjs (primera línea = config JSON, TODO lo que sigue
  # tras el primer '\n' = contraseña completa hasta EOF) ya es
  # inequívoco frente a bytes internos arbitrarios en la contraseña —
  # nunca depende de que la contraseña cupla una sola línea — pero
  # ahora, además, ningún valor que llegue aquí puede contener un LF/CR
  # (el contrato general los rechaza), así que la ambigüedad que ese
  # diseño ya evitaba por construcción queda, adicionalmente, descartada
  # por contrato.
  if ! gapssa_secrets_validate_value "$pw"; then
    unset pw
    local c1_invalid
    c1_invalid="$(_recovery_component_reversible redis_password false false false false)"
    _recovery_evidence_envelope S5 "$c1_invalid"
    return
  fi
  local check
  check="$(printf '{"host":"127.0.0.1","port":%s}\n%s' "$redis_port" "$pw" | node "$SCRIPT_DIR/lib/redisVerify.mjs" 2>/dev/null || true)"
  if [ "$check" = true ]; then
    restored_works=true
  else
    attempted=true
    if _gapssa_compose up -d --force-recreate redis >/dev/null 2>&1; then
      succeeded=true
      sleep 2
      check="$(printf '{"host":"127.0.0.1","port":%s}\n%s' "$redis_port" "$pw" | node "$SCRIPT_DIR/lib/redisVerify.mjs" 2>/dev/null || true)"
      [ "$check" = true ] && verified=true
    fi
  fi
  unset pw

  local c1
  c1="$(_recovery_component_reversible redis_password "$restored_works" "$attempted" "$succeeded" "$verified")"
  _recovery_evidence_envelope S5 "$c1"
}

# Dispatcher por puerta (Bloque 5): reconcilia la credencial YA
# restaurada en $SECRETS_FILE con el/los SERVIDOR(es) real(es),
# recogiendo evidencia genuina y delegando la decisión final a
# lib/decideRecoveryPlan.mjs — imprime por stdout EXACTAMENTE uno de
# 'recovery_required' | 'forward_recovery_required' |
# 'server_coordination_required' (nunca 'done', nunca un booleano).
reconcile_server_after_restore() {
  local gate="$1" evidence_json=""
  case "$gate" in
  S2) evidence_json="$(_recovery_evidence_s2)" ;;
  S3) evidence_json="$(_recovery_evidence_s3)" ;;
  S4) evidence_json="$(_recovery_evidence_s4)" ;;
  S5) evidence_json="$(_recovery_evidence_s5)" ;;
  *)
    printf 'server_coordination_required'
    return
    ;;
  esac
  # Detalle por componente a STDERR (Revisión 2, punto 7) — nunca a
  # stdout, que el llamador captura como el ÚNICO valor de retorno de
  # esta función (el estado agregado de la puerta); distingue
  # "credencial coordinada" de "aplicación disponible" componente a
  # componente, sin secretos.
  _recovery_print_component_statuses "$evidence_json" "$SCRIPT_DIR" >&2
  _recovery_decide "$evidence_json" "$SCRIPT_DIR"
}

enter_gate() {
  local gate="$1"
  CURRENT_GATE="$gate"
  state_set "$gate" applying
  if ! backup_secrets_file "$gate" "$(current_secrets_schema_version)"; then
    state_set "$gate" failed
    CURRENT_GATE=""
    return 1
  fi
  return 0
}

leave_gate_done() {
  state_set "$1" done
  CURRENT_GATE=""
}

leave_gate_blocked() {
  local gate="$1" reason="${2:-}"
  state_set "$gate" blocked
  [ -n "$reason" ] && say "Puerta $gate: BLOQUEADA — $reason"
  CURRENT_GATE=""
}

leave_gate_failed() {
  local gate="$1" reason="${2:-}"
  state_set "$gate" failed
  [ -n "$reason" ] && say "Puerta $gate: $reason"
  CURRENT_GATE=""
}

confirm_gate() {
  local code="$1"
  local st
  st="$(state_get "$code")"
  case "$st" in
  recovery_required)
    say "AVISO: la puerta $code quedó en 'recovery_required' — se restauró la credencial ANTERIOR (comprometida) para recuperar disponibilidad. Volver a ejecutarla generará un secreto NUEVO."
    ;;
  server_coordination_required)
    say "AVISO: la puerta $code quedó en 'server_coordination_required' — el ARCHIVO externo ya se restauró correctamente, pero al menos un sub-secreto no quedó reaplicado (o no se pudo verificar) en el SERVIDOR real. La disponibilidad NO está confirmada — revisa el detalle que dejó la restauración antes de continuar."
    ;;
  forward_recovery_required)
    say "AVISO: la puerta $code quedó en 'forward_recovery_required' — al menos un sub-secreto IRREVERSIBLE (p.ej. una API Key ya invalidada) se recuperó generando un valor NUEVO, nunca restaurando el antiguo. Disponibilidad recuperada con ese valor nuevo, pero esto NO es una rotación completa. Volver a ejecutarla generará secretos nuevos para el resto de sub-secretos."
    ;;
  rollback_required)
    say "AVISO: la puerta $code quedó en 'rollback_required' tras una interrupción anterior."
    if ask_yes_no "¿Intentar restaurar el backup más reciente de $code antes de continuar?"; then
      restore_secrets_file_from_latest_backup "$code" || true
      say "Puerta $code queda en 'recovery_required', 'forward_recovery_required' o 'server_coordination_required' según lo que se pudo verificar (o sin cambios si la restauración no se completó) — no se continúa automáticamente, vuelve a lanzarla cuando quieras generar un secreto nuevo."
      return 1
    fi
    ;;
  blocked)
    say "AVISO: la puerta $code quedó 'blocked' en un intento anterior — revisa el motivo arriba antes de repetirla."
    ;;
  done)
    if ! ask_yes_no "La puerta $code ya está marcada 'done'. ¿Repetirla de todos modos?"; then
      say "Puerta $code omitida."
      return 1
    fi
    ;;
  esac
  if ! ask_yes_no "¿Ejecutar la puerta $code ahora?"; then
    say "Puerta $code omitida por decisión tuya. Puedes volver a lanzar este script más tarde."
    return 1
  fi
  return 0
}

require_secrets_file() {
  if [ "$DRY_RUN" = true ]; then
    # Precondición VIRTUAL, nunca física — comprobar `-f "$SECRETS_FILE"`
    # aquí adoptaría en silencio un almacén externo real preexistente en
    # esta máquina como si esta sesión de dry-run lo hubiera producido
    # (causa exacta del defecto original: S2 exigía el artefacto físico
    # de S1 incluso en --dry-run, y S1 en --dry-run nunca lo crea).
    if [ "$(state_get S1)" != done ]; then
      say "ERROR: [dry-run] $SECRETS_FILE no existe (ni siquiera de forma simulada) todavía. Ejecuta primero la puerta S1."
      return 1
    fi
    return 0
  fi
  if [ ! -f "$SECRETS_FILE" ]; then
    say "ERROR: no existe $SECRETS_FILE todavía. Ejecuta primero la puerta S1."
    return 1
  fi
}

# ---------------------------------------------------------------------------
# helpers de red/DB — nunca pasan un secreto como argumento de proceso
# ---------------------------------------------------------------------------


# REVISIÓN 2 (Bloque 5, punto 9) — `PGPASSWORD`/`MYSQL_PWD` vía
# `docker run --env-file` quedaban en `.Config.Env` del contenedor
# EFÍMERO de verificación, visible con un `docker inspect` concurrente
# mientras ese contenedor vive — sustituido por un fichero de
# credenciales (`.pgpass` / opciones de cliente MariaDB) creado en el
# HOST con modo 600 y montado de SOLO LECTURA (`-v ...:...:ro`) dentro
# del contenedor efímero — nunca copiado, nunca en el entorno ni en argv
# del proceso `psql`/`mariadb`. El fichero del host se registra
# INMEDIATAMENTE en la pila de limpieza global y se destruye
# (sobrescritura + borrado) justo después de la invocación.
pg_capture() {
  local sql="$1" role="$2" pass="$3"
  local net img pgpassfile out rc=0
  net="$(compose_network_name apps-private)"
  img="$(field_from_secrets_file POSTGRES_IMAGE)"
  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] psql -tA -U $role -h apps-db -d postgres (red=$net) <<SQL (oculto) SQL" >&2
    printf ''
    return 0
  fi
  pgpassfile="$(gapssa_secrets_mktemp_secure gapssa-pgpass)"
  gapssa_cleanup_push shred_plain "$pgpassfile"
  printf '*:*:*:%s:%s\n' "$(gapssa_secrets_pgpass_escape "$role")" "$(gapssa_secrets_pgpass_escape "$pass")" >"$pgpassfile"
  chmod 600 "$pgpassfile"
  out="$(printf '%s' "$sql" | docker run --rm -i --network "$net" \
    -v "${pgpassfile}:/tmp/.gapssa-verify.pgpass:ro" -e "PGPASSFILE=/tmp/.gapssa-verify.pgpass" "$img" \
    psql -v ON_ERROR_STOP=1 -tA -U "$role" -h apps-db -d postgres)" || rc=$?
  gapssa_secrets_shred "$pgpassfile"
  gapssa_cleanup_pop_matching shred_plain "$pgpassfile"
  printf '%s' "$out"
  return $rc
}

mariadb_capture() {
  local sql="$1" user="$2" pass="$3"
  local net img optfile out rc=0
  net="$(compose_network_name private)"
  img="$(field_from_secrets_file ESPOCRM_DB_IMAGE)"
  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] mariadb -N -B -h espocrm-db -u $user (red=$net) <<SQL (oculto) SQL" >&2
    printf ''
    return 0
  fi
  optfile="$(gapssa_secrets_mktemp_secure gapssa-mariadb-verify-optfile)"
  gapssa_cleanup_push shred_plain "$optfile"
  {
    printf '[client]\n'
    printf 'user="%s"\n' "$(gapssa_secrets_mariadb_cfg_escape "$user")"
    printf 'password="%s"\n' "$(gapssa_secrets_mariadb_cfg_escape "$pass")"
  } >"$optfile"
  chmod 600 "$optfile"
  out="$(printf '%s' "$sql" | docker run --rm -i --network "$net" \
    -v "${optfile}:/tmp/.gapssa-verify.cnf:ro" "$img" \
    mariadb "--defaults-extra-file=/tmp/.gapssa-verify.cnf" -N -B -h espocrm-db)" || rc=$?
  gapssa_secrets_shred "$optfile"
  gapssa_cleanup_pop_matching shred_plain "$optfile"
  printf '%s' "$out"
  return $rc
}

# Fichero de configuración de curl (-K) para Basic Auth o cabecera
# X-Api-Key — nunca en argv. $1 = ruta destino (mktemp_secure ya aplicado
# por el llamador), resto = líneas de configuración curl.
write_curl_config() {
  local file="$1"
  shift
  {
    printf 'silent\n'
    printf 'show-error\n'
    local line
    for line in "$@"; do
      printf '%s\n' "$line"
    done
  } >"$file"
  chmod 600 "$file"
}

# ---------------------------------------------------------------------------
# S1 — almacén externo + copia inicial del .env
# ---------------------------------------------------------------------------
gate_s1() {
  divider
  say "Puerta S1 — Crear el almacén externo de secretos"
  say "Crea $SECRETS_DIR (modo 700) y copia tu .env actual ahí dentro como punto de partida. No se imprime ningún valor en esta terminal."
  confirm_gate "S1" || return 0
  enter_gate "S1" || return 1

  if ! bash "$SCRIPT_DIR/01-init-external-store.sh" "$SECRETS_DIR" $([ "$DRY_RUN" = true ] && printf -- '--dry-run'); then
    leave_gate_failed "S1" "01-init-external-store.sh falló."
    return 1
  fi

  if [ "$DRY_RUN" = true ]; then
    # Solo EXISTENCIA (nunca contenido) de $ENV_REPO -- una comprobación
    # `-f` no abre ni lee el archivo, así que informar de esto no viola
    # "nunca leer .env real".
    if [ -f "$ENV_REPO" ]; then
      say "[dry-run] would_copy_env=true (existe $ENV_REPO — no se abre, no se copia, no se lee su contenido)"
    else
      say "[dry-run] would_copy_env=false (no existe $ENV_REPO todavía — sin esta comprobación es solo informativa, S1 real fallaría aquí)"
    fi
    leave_gate_done "S1"
    return 0
  fi

  if [ ! -f "$ENV_REPO" ]; then
    leave_gate_failed "S1" "no se encontró $ENV_REPO — nada que copiar."
    return 1
  fi

  if [ -f "$SECRETS_FILE" ]; then
    say "Ya existe $SECRETS_FILE."
    if ! ask_yes_no "¿Sobrescribirlo con una copia nueva de $ENV_REPO?"; then
      say "Se conserva el archivo externo existente tal cual estaba."
      leave_gate_done "S1"
      return 0
    fi
  fi

  # Bloque 6 (auditoría de temporales) — `cp` crea el destino (si no
  # existía ya) con el modo por defecto sujeto al umask AMBIENTE del
  # operador, no con 600 — sin acotar el umask antes de esta copia, la
  # primerísima copia de $SECRETS_FILE (con TODOS los secretos) podía
  # existir, aunque fuera solo durante el propio `cp`, en un modo más
  # permisivo que 600 (bug real, detectado y corregido durante esta
  # revisión). Mismo patrón `umask 077` ya aceptado en otros puntos de
  # este fichero.
  local s1_umask_saved
  s1_umask_saved="$(umask)"
  umask 077
  cp "$ENV_REPO" "$SECRETS_FILE"
  umask "$s1_umask_saved"
  chmod 600 "$SECRETS_FILE"
  say "Copiado. Ningún valor se ha mostrado en esta terminal ni se mostrará."
  leave_gate_done "S1"
}

# ---------------------------------------------------------------------------
# S2 — PostgreSQL
# ---------------------------------------------------------------------------
gate_s2() {
  divider
  say "Puerta S2 — PostgreSQL (POSTGRES_PASSWORD, DATABASE_URL_*)"
  say "Genera una contraseña nueva, sincroniza las tres cadenas de conexión, la aplica por TCP real (nunca el socket local del contenedor) y verifica con una conexión nueva."
  confirm_gate "S2" || return 0
  require_secrets_file || return 1
  enter_gate "S2" || return 1

  local pg_user pg_db
  pg_user="$(field_from_secrets_file POSTGRES_USER)"
  pg_db="$(field_from_secrets_file POSTGRES_DB)"

  local old_pw
  old_pw="$(field_from_secrets_file POSTGRES_PASSWORD)"

  if ! bash "$SCRIPT_DIR/02-generate-secret.sh" "$SECRETS_FILE" --set-line POSTGRES_PASSWORD --format hex --bytes 32 $([ "$DRY_RUN" = true ] && printf -- '--dry-run'); then
    leave_gate_failed "S2" "no se pudo generar POSTGRES_PASSWORD."
    unset old_pw
    return 1
  fi

  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] no se sincronizan las DATABASE_URL_* ni se aplica/verifica nada real."
    leave_gate_done "S2"
    unset old_pw
    return 0
  fi

  say "Sincronizando DATABASE_URL_AUTH / DATABASE_URL_BOOKING / DATABASE_URL_CMS con la contraseña nueva (formato hex, seguro en una URL sin percent-encoding)..."
  python3 - "$SECRETS_FILE" <<'PYEOF'
import sys, re, os
target = sys.argv[1]
with open(target, "r", encoding="utf-8") as f:
    lines = f.readlines()
pw = None
for line in lines:
    if line.startswith("POSTGRES_PASSWORD="):
        pw = line.rstrip("\n").split("=", 1)[1]
        break
if not pw:
    print("ERROR: POSTGRES_PASSWORD no encontrado.", file=sys.stderr)
    sys.exit(1)
prefixes = ("DATABASE_URL_AUTH=", "DATABASE_URL_BOOKING=", "DATABASE_URL_CMS=")
out = []
for line in lines:
    matched = next((p for p in prefixes if line.startswith(p)), None)
    if matched:
        rest = line[len(matched):]
        rest = re.sub(r"^(postgresql://[^:]+:)[^@]+(@)", rf"\g<1>{pw}\g<2>", rest)
        line = matched + rest
    out.append(line)
fd = os.open(target, os.O_WRONLY | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.writelines(out)
pw = None
print("dsn_sync_ok=true")
PYEOF

  say "Levantando apps-db (si no estaba arriba)..."
  if ! run_cmd docker compose --env-file "$SECRETS_FILE" up -d apps-db; then
    leave_gate_failed "S2" "no se pudo levantar apps-db."
    unset old_pw
    return 1
  fi

  say "Esperando a que apps-db confirme salud (pg_isready, healthcheck de compose.yml)..."
  if ! _gapssa_wait_healthy apps-db; then
    leave_gate_failed "S2" "apps-db no confirmó salud (healthcheck) tras arrancar — revisa 'docker compose logs apps-db'."
    unset old_pw
    return 1
  fi

  local new_pw
  new_pw="$(field_from_secrets_file POSTGRES_PASSWORD)"

  say "Aplicando ALTER ROLE por la vía administrativa local (socket Unix, 'trust' — verificado contra pg_hba.conf de la imagen; nunca depende de conocer la contraseña anterior), con quoting seguro vía format()/psql (Bloque 5)..."
  if [ "$(printf '%s' "$new_pw" | _pg_apply_password_via_socket apps-db "$pg_user" "$pg_db")" != true ]; then
    leave_gate_failed "S2" "no se pudo aplicar la contraseña nueva vía el socket administrativo — revisa 'docker compose logs apps-db'."
    unset old_pw new_pw
    return 1
  fi

  state_set "S2" verifying

  say "Verificando: la contraseña NUEVA debe autenticar por TCP..."
  if ! pg_capture "SELECT 1;" "$pg_user" "$new_pw" >/dev/null; then
    leave_gate_failed "S2" "la contraseña nueva no autentica — ver mensaje de arriba."
    unset old_pw new_pw
    return 1
  fi
  say "  OK — contraseña nueva acepta conexión TCP real."

  say "Verificando: la contraseña ANTERIOR debe quedar rechazada..."
  if pg_capture "SELECT 1;" "$pg_user" "$old_pw" >/dev/null 2>&1; then
    leave_gate_failed "S2" "la contraseña ANTERIOR todavía autentica — el ALTER ROLE no surtió efecto."
    unset old_pw new_pw
    return 1
  fi
  say "  OK — contraseña anterior ya rechazada."

  unset old_pw new_pw
  leave_gate_done "S2"
  say "Puerta S2 completada. apps/web tomará esta contraseña cuando arranques con el archivo externo (paso final, S9)."
}

# ---------------------------------------------------------------------------
# S3 — MariaDB / EspoCRM
# ---------------------------------------------------------------------------
gate_s3() {
  divider
  say "Puerta S3 — MariaDB de EspoCRM (ESPOCRM_DB_PASSWORD, ESPOCRM_DB_ROOT_PASSWORD)"
  say "Enumera primero qué cuentas/hosts existen de verdad, rota ambas contraseñas por TCP real, y verifica con una conexión NO privilegiada."
  confirm_gate "S3" || return 0
  require_secrets_file || return 1
  enter_gate "S3" || return 1

  if ! run_cmd docker compose --env-file "$SECRETS_FILE" up -d espocrm-db; then
    leave_gate_failed "S3" "no se pudo levantar espocrm-db."
    return 1
  fi

  # Corrección "dry-run fresco S1->S9": el healthcheck real
  # (`_gapssa_wait_healthy`, vía `docker compose ps`/`docker inspect`
  # reales) y el prompt de la contraseña ROOT actual vivían ANTES de esta
  # comprobación — en dry-run, `docker compose up -d` de arriba nunca
  # arrancó nada real (ver `run_cmd`), así que el healthcheck fallaba de
  # verdad contra un contenedor inexistente y bloqueaba la puerta, y el
  # prompt pedía una credencial real sin necesidad. Ambos deben quedar
  # DESPUÉS del corte de dry-run, nunca antes.
  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] no se comprueba salud real de espocrm-db, no se pide la contraseña ROOT actual, no se enumeran cuentas ni se aplica/verifica nada real."
    leave_gate_done "S3"
    return 0
  fi

  say "Esperando a que espocrm-db confirme salud (healthcheck de compose.yml)..."
  if ! _gapssa_wait_healthy espocrm-db; then
    leave_gate_failed "S3" "espocrm-db no confirmó salud (healthcheck) tras arrancar — revisa 'docker compose logs espocrm-db'."
    return 1
  fi

  say ""
  say "Para poder rotar hace falta la contraseña ROOT ACTUAL de MariaDB (la que"
  say "tenía antes de esta rotación) — no se mostrará, no se guarda, se olvida"
  say "en cuanto termine este paso."
  local old_root_pw
  read -r -s -p "Contraseña ROOT actual de MariaDB: " old_root_pw
  echo

  say "Enumerando cuentas/hosts reales de 'root' y 'espocrm' (nunca asumidos)..."
  local accounts
  if ! accounts="$(mariadb_capture "SELECT User, Host FROM mysql.user WHERE User IN ('root','espocrm');" root "$old_root_pw")"; then
    leave_gate_failed "S3" "no se pudo autenticar como root con la contraseña proporcionada — revisa que sea la correcta."
    unset old_root_pw
    return 1
  fi
  if [ -z "$accounts" ]; then
    leave_gate_failed "S3" "la consulta de cuentas no devolvió ninguna fila — ¿usuarios 'root'/'espocrm' con otro nombre?"
    unset old_root_pw
    return 1
  fi
  say "Cuentas encontradas (usuario<TAB>host):"
  say "$accounts"

  local old_espocrm_db_pw
  old_espocrm_db_pw="$(field_from_secrets_file ESPOCRM_DB_PASSWORD)"

  if ! bash "$SCRIPT_DIR/02-generate-secret.sh" "$SECRETS_FILE" --set-line ESPOCRM_DB_PASSWORD --format hex --bytes 32; then
    leave_gate_failed "S3" "no se pudo generar ESPOCRM_DB_PASSWORD."
    unset old_root_pw old_espocrm_db_pw
    return 1
  fi
  if ! bash "$SCRIPT_DIR/02-generate-secret.sh" "$SECRETS_FILE" --set-line ESPOCRM_DB_ROOT_PASSWORD --format hex --bytes 32; then
    leave_gate_failed "S3" "no se pudo generar ESPOCRM_DB_ROOT_PASSWORD."
    unset old_root_pw old_espocrm_db_pw
    return 1
  fi

  local new_db_pw new_root_pw
  new_db_pw="$(field_from_secrets_file ESPOCRM_DB_PASSWORD)"
  new_root_pw="$(field_from_secrets_file ESPOCRM_DB_ROOT_PASSWORD)"

  say "Aplicando ALTER USER solo a los pares (usuario, host) que realmente existen — un ALTER USER por par, con quoting seguro vía FROM_BASE64()/QUOTE() (Bloque 5), reconciliación idempotente: cada usuario se aplica y verifica por separado, nunca como un único bloque DDL 'todo o nada' (MariaDB hace commit implícito por sentencia, así que tampoco lo era antes)."
  say "El par root@<host de autenticación LOCAL> se aplica SIEMPRE primero (Bloque 6, hallazgo del ensayo integral): una conexión hecha desde dentro del propio contenedor sin '-h' explícito se autentica vía socket contra la cuenta que MariaDB resuelva para ese socket — normalmente 'root'@'localhost' si esa fila existe (la imagen oficial de MariaDB crea 'root'@'%' Y 'root'@'localhost' como filas INDEPENDIENTES), nunca necesariamente 'root'@'%'. Alterar '%' primero y asumir que la autenticación local YA usa la contraseña nueva es incorrecto si 'localhost' es una fila aparte — eso rompía el resto de la reconciliación con 'Access denied' pese a que el ALTER de root sí había tenido éxito."
  local user host apply_failed=false local_auth_host=""
  while IFS=$'\t' read -r user host; do
    [ "$user" = root ] || continue
    [ -n "$host" ] || continue
    if [ "$host" = localhost ]; then
      local_auth_host="localhost"
    elif [ -z "$local_auth_host" ]; then
      local_auth_host="$host"
    fi
  done <<EOF
$accounts
EOF

  if [ -n "$local_auth_host" ]; then
    if [ "$(printf '%s\0%s' "$old_root_pw" "$new_root_pw" | _mariadb_apply_password_via_auth espocrm-db root "$local_auth_host" root)" != true ]; then
      apply_failed=true
    else
      # Ahora sí es correcto: la cuenta que gobierna la autenticación LOCAL
      # (socket) acaba de rotar, así que las llamadas siguientes (que
      # también se conectan por socket) deben usar la contraseña nueva.
      old_root_pw="$new_root_pw"
    fi
  fi

  while IFS=$'\t' read -r user host; do
    [ -n "$user" ] || continue
    [ -n "$host" ] || continue
    if [ "$user" = root ] && [ "$host" = "$local_auth_host" ]; then
      continue # ya aplicado arriba, primero
    fi
    case "$user" in
    espocrm)
      if [ "$(printf '%s\0%s' "$old_root_pw" "$new_db_pw" | _mariadb_apply_password_via_auth espocrm-db espocrm "$host" root)" != true ]; then
        apply_failed=true
      fi
      ;;
    root)
      if [ "$(printf '%s\0%s' "$old_root_pw" "$new_root_pw" | _mariadb_apply_password_via_auth espocrm-db root "$host" root)" != true ]; then
        apply_failed=true
      fi
      ;;
    esac
  done <<EOF
$accounts
EOF

  if [ "$apply_failed" = true ]; then
    leave_gate_failed "S3" "el ALTER USER de al menos un par (usuario, host) falló — revisa el mensaje de arriba."
    unset old_root_pw old_espocrm_db_pw new_db_pw new_root_pw
    return 1
  fi

  state_set "S3" verifying

  say "Verificando con una conexión NO privilegiada (usuario 'espocrm', no 'root')..."
  if ! mariadb_capture "SELECT 1;" espocrm "$new_db_pw" >/dev/null; then
    leave_gate_failed "S3" "la conexión no privilegiada con la contraseña nueva falló."
    unset old_root_pw old_espocrm_db_pw new_db_pw new_root_pw
    return 1
  fi
  say "  OK — 'espocrm' autentica con la contraseña nueva."

  if [ -n "$old_espocrm_db_pw" ]; then
    say "Verificando que la contraseña ANTERIOR de 'espocrm' queda rechazada..."
    if mariadb_capture "SELECT 1;" espocrm "$old_espocrm_db_pw" >/dev/null 2>&1; then
      leave_gate_failed "S3" "la contraseña ANTERIOR de 'espocrm' todavía autentica."
      unset old_root_pw old_espocrm_db_pw new_db_pw new_root_pw
      return 1
    fi
    say "  OK — contraseña anterior de 'espocrm' ya rechazada."
  fi
  unset old_espocrm_db_pw

  # Bloque 6 — hallazgo real del ensayo integral: el entrypoint de la
  # imagen SOLO escribe data/config-internal.php desde
  # ESPOCRM_DATABASE_PASSWORD en el PRIMER arranque (cuando ese archivo
  # todavía no existe). Contra una instancia YA instalada -- el caso
  # real -- un restart tras rotar deja ese archivo con la contraseña
  # VIEJA y EspoCRM entra en un bucle infinito de "Waiting for database
  # connection" del que ni siquiera bin/command puede rescatarlo (usa la
  # misma conexión rota). Hay que resincronizarlo explícitamente ANTES
  # de reiniciar. Ver _espo_sync_config_password (lib/dbRecovery.sh).
  say "Sincronizando data/config-internal.php de EspoCRM con la contraseña nueva (el entrypoint de la imagen NO lo hace en un reinicio contra una instancia ya instalada — solo en el primer arranque)..."
  if [ "$(printf '%s' "$new_db_pw" | _espo_sync_config_password espocrm)" = false ]; then
    leave_gate_failed "S3" "no se pudo sincronizar data/config-internal.php de EspoCRM con la contraseña nueva."
    unset old_root_pw new_db_pw new_root_pw
    return 1
  fi

  say "Reiniciando espocrm, espocrm-daemon y espocrm-websocket con las credenciales nuevas..."
  if ! run_cmd docker compose --env-file "$SECRETS_FILE" up -d espocrm espocrm-daemon espocrm-websocket; then
    leave_gate_failed "S3" "no se pudieron reiniciar los contenedores de EspoCRM."
    unset old_root_pw new_db_pw new_root_pw
    return 1
  fi

  say "Esperando a que EspoCRM confirme salud (bin/command app-check)..."
  local attempt ok=false
  for attempt in $(seq 1 12); do
    if run_cmd docker compose --env-file "$SECRETS_FILE" exec -T espocrm bin/command app-check >/dev/null 2>&1; then
      ok=true
      break
    fi
    sleep 5
  done
  if [ "$ok" != true ] && [ "$DRY_RUN" != true ]; then
    leave_gate_failed "S3" "EspoCRM no confirmó salud (app-check) tras la rotación — revisa 'docker compose logs espocrm'."
    unset old_root_pw new_db_pw new_root_pw
    return 1
  fi
  say "  OK — EspoCRM en verde (app-check)."

  unset old_root_pw new_db_pw new_root_pw
  leave_gate_done "S3"
}

# ---------------------------------------------------------------------------
# S4 — EspoCRM admin + API key (completamente automatizado por script
# nativo/API REST — nunca por UI ni por copiar/pegar)
# ---------------------------------------------------------------------------
gate_s4() {
  divider
  say "Puerta S4 — EspoCRM: contraseña de admin + API Key"
  say "Automatizado por completo: 'bin/command set-password' (lee la contraseña por stdin, verificado contra el código fuente de la imagen) para admin, y la API REST nativa 'POST /api/v1/UserSecurity/apiKey/generate' para la API Key. Cero edición manual."
  confirm_gate "S4" || return 0
  require_secrets_file || return 1
  enter_gate "S4" || return 1

  local admin_user espocrm_port
  admin_user="$(field_from_secrets_file ESPOCRM_ADMIN_USERNAME)"
  admin_user="${admin_user:-admin}"
  espocrm_port="$(field_from_secrets_file ESPOCRM_HTTP_PORT)"
  espocrm_port="${espocrm_port:-8081}"

  if ! run_cmd docker compose --env-file "$SECRETS_FILE" up -d espocrm; then
    leave_gate_failed "S4" "no se pudo levantar espocrm."
    return 1
  fi

  if ! bash "$SCRIPT_DIR/02-generate-secret.sh" "$SECRETS_FILE" --set-line ESPOCRM_ADMIN_PASSWORD --format base64 --bytes 24 $([ "$DRY_RUN" = true ] && printf -- '--dry-run'); then
    leave_gate_failed "S4" "no se pudo generar ESPOCRM_ADMIN_PASSWORD."
    return 1
  fi

  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] no se cambia la contraseña ni se regenera la API Key."
    leave_gate_done "S4"
    return 0
  fi

  local new_admin_pw
  new_admin_pw="$(field_from_secrets_file ESPOCRM_ADMIN_PASSWORD)"

  say "Cambiando la contraseña de '$admin_user' (bin/command set-password, por stdin)..."
  if ! run_cmd_stdin "${new_admin_pw}
" docker compose --env-file "$SECRETS_FILE" exec -T espocrm bin/command set-password "$admin_user"; then
    leave_gate_failed "S4" "bin/command set-password falló."
    unset new_admin_pw
    return 1
  fi

  state_set "S4" verifying

  local curl_admin_cfg
  curl_admin_cfg="$(gapssa_secrets_mktemp_secure gapssa-curl-admin)"
  gapssa_cleanup_push shred_plain "$curl_admin_cfg"
  write_curl_config "$curl_admin_cfg" "user = \"${admin_user}:$(gapssa_secrets_curl_cfg_escape "${new_admin_pw}")\"" "fail"

  say "Verificando login de '$admin_user' con la contraseña nueva..."
  if ! run_cmd curl -K "$curl_admin_cfg" -sS -o /dev/null "http://localhost:${espocrm_port}/api/v1/App/user"; then
    leave_gate_failed "S4" "el login del admin nuevo no autenticó."
    gapssa_secrets_shred "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    unset new_admin_pw
    return 1
  fi
  say "  OK — login de admin nuevo verificado."

  say "Buscando el User 'portal-gapssa-api' (API REST real, verificado en el código fuente de EspoCRM)..."
  local search_response user_id=""
  search_response="$(capture_cmd curl -K "$curl_admin_cfg" -sS -G \
    --data-urlencode "maxSize=1" \
    --data-urlencode "select=id" \
    --data-urlencode "where[0][type]=equals" \
    --data-urlencode "where[0][attribute]=userName" \
    --data-urlencode "where[0][value]=portal-gapssa-api" \
    "http://localhost:${espocrm_port}/api/v1/User")"
  user_id="$(printf '%s' "$search_response" | python3 -c "import sys,json
try:
    d=json.load(sys.stdin)
    l=d.get('list',[])
    print(l[0]['id'] if l else '')
except Exception:
    print('')
" 2>/dev/null || true)"

  if [ -z "$user_id" ]; then
    say "No existe (todavía) un User 'portal-gapssa-api' en esta instancia — se omite la rotación de ESPOCRM_API_KEY."
    gapssa_secrets_shred "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    unset new_admin_pw
    leave_gate_done "S4"
    return 0
  fi
  say "  Encontrado: id=$user_id"

  local old_api_key
  old_api_key="$(field_from_secrets_file ESPOCRM_API_KEY)"

  say "Foto de ACL antes de rotar (para comprobar después que la rotación no la tocó)..."
  local acl_before acl_after
  acl_before="$(capture_cmd curl -K "$curl_admin_cfg" -sS -G --data-urlencode "select=teamsIds,rolesIds" "http://localhost:${espocrm_port}/api/v1/User/${user_id}")"

  # Bloque 6: reutiliza EXACTAMENTE el mismo helper endurecido que la
  # recuperación de S4 (Bloque 5, lib/espoRecovery.sh —
  # _espo_regenerate_api_key_and_write) en vez de mantener una segunda
  # copia divergente: la respuesta de curl se procesa en streaming
  # (nunca un fichero regular con el JSON completo) y la actualización de
  # ESPOCRM_API_KEY en $SECRETS_FILE reutiliza el patrón atómico del
  # Bloque 2 (lib/updateSecretsFileField.mjs) — nunca O_TRUNC directo.
  say "Regenerando la API Key (POST /api/v1/UserSecurity/apiKey/generate)..."
  if [ "$(_espo_regenerate_api_key_and_write "$curl_admin_cfg" "$espocrm_port" "$user_id" "$SECRETS_FILE" "$(current_secrets_schema_version)")" != true ]; then
    leave_gate_failed "S4" "no se pudo generar/escribir la API Key nueva — ver mensaje de arriba."
    gapssa_secrets_shred "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    unset new_admin_pw old_api_key
    return 1
  fi

  acl_after="$(capture_cmd curl -K "$curl_admin_cfg" -sS -G --data-urlencode "select=teamsIds,rolesIds" "http://localhost:${espocrm_port}/api/v1/User/${user_id}")"
  if [ "$acl_before" != "$acl_after" ]; then
    say "AVISO: teamsIds/rolesIds de 'portal-gapssa-api' cambiaron durante esta puerta — inesperado, revísalo manualmente (no debería tener relación con regenerar la API Key)."
  else
    say "  OK — ACL (equipos/roles) de 'portal-gapssa-api' sin cambios."
  fi

  local new_api_key
  new_api_key="$(field_from_secrets_file ESPOCRM_API_KEY)"

  say "Verificando: la API Key NUEVA debe autenticar..."
  local curl_newkey_cfg
  curl_newkey_cfg="$(gapssa_secrets_mktemp_secure gapssa-curl-newkey)"
  gapssa_cleanup_push shred_plain "$curl_newkey_cfg"
  write_curl_config "$curl_newkey_cfg" "header = \"X-Api-Key: $(gapssa_secrets_curl_cfg_escape "${new_api_key}")\"" "fail"
  if ! run_cmd curl -K "$curl_newkey_cfg" -sS -o /dev/null "http://localhost:${espocrm_port}/api/v1/App/user"; then
    leave_gate_failed "S4" "la API Key nueva no autenticó."
    gapssa_secrets_shred "$curl_admin_cfg" "$curl_newkey_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_newkey_cfg"
    unset new_admin_pw old_api_key new_api_key
    return 1
  fi
  say "  OK — API Key nueva verificada."

  if [ -n "$old_api_key" ]; then
    say "Verificando: la API Key ANTERIOR debe quedar rechazada..."
    local curl_oldkey_cfg
    curl_oldkey_cfg="$(gapssa_secrets_mktemp_secure gapssa-curl-oldkey)"
    gapssa_cleanup_push shred_plain "$curl_oldkey_cfg"
    write_curl_config "$curl_oldkey_cfg" "header = \"X-Api-Key: $(gapssa_secrets_curl_cfg_escape "${old_api_key}")\"" "fail"
    if run_cmd curl -K "$curl_oldkey_cfg" -sS -o /dev/null "http://localhost:${espocrm_port}/api/v1/App/user" 2>/dev/null; then
      leave_gate_failed "S4" "la API Key ANTERIOR todavía autentica — EspoCRM no la invalidó."
      gapssa_secrets_shred "$curl_admin_cfg" "$curl_newkey_cfg" "$curl_oldkey_cfg"
      gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
      gapssa_cleanup_pop_matching shred_plain "$curl_newkey_cfg"
      gapssa_cleanup_pop_matching shred_plain "$curl_oldkey_cfg"
      unset new_admin_pw old_api_key new_api_key
      return 1
    fi
    gapssa_secrets_shred "$curl_oldkey_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_oldkey_cfg"
    say "  OK — API Key anterior ya rechazada."
  fi

  gapssa_secrets_shred "$curl_admin_cfg" "$curl_newkey_cfg"
  gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
  gapssa_cleanup_pop_matching shred_plain "$curl_newkey_cfg"
  unset new_admin_pw old_api_key new_api_key
  leave_gate_done "S4"
}

# ---------------------------------------------------------------------------
# S5 — Redis (REDIS_URL automatizado con percent-encoding correcto)
# ---------------------------------------------------------------------------
gate_s5() {
  divider
  say "Puerta S5 — Redis (REDIS_PASSWORD, REDIS_URL)"
  say "Genera una contraseña nueva, sincroniza REDIS_URL automáticamente (con percent-encoding correcto) y verifica con PING autenticado."
  confirm_gate "S5" || return 0
  require_secrets_file || return 1
  enter_gate "S5" || return 1

  local old_pw
  old_pw="$(field_from_secrets_file REDIS_PASSWORD)"

  if ! bash "$SCRIPT_DIR/02-generate-secret.sh" "$SECRETS_FILE" --set-line REDIS_PASSWORD --format base64 --bytes 24 $([ "$DRY_RUN" = true ] && printf -- '--dry-run'); then
    leave_gate_failed "S5" "no se pudo generar REDIS_PASSWORD."
    unset old_pw
    return 1
  fi

  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] no se sincroniza REDIS_URL ni se reinicia/verifica nada real."
    leave_gate_done "S5"
    unset old_pw
    return 0
  fi

  say "Sincronizando REDIS_URL con percent-encoding correcto..."
  python3 - "$SECRETS_FILE" <<'PYEOF'
import sys, re, os
from urllib.parse import quote
target = sys.argv[1]
with open(target, "r", encoding="utf-8") as f:
    lines = f.readlines()
pw = None
for line in lines:
    if line.startswith("REDIS_PASSWORD="):
        pw = line.rstrip("\n").split("=", 1)[1]
        break
if not pw:
    print("ERROR: REDIS_PASSWORD no encontrado.", file=sys.stderr)
    sys.exit(1)
encoded = quote(pw, safe="")
out = []
for line in lines:
    if line.startswith("REDIS_URL="):
        rest = line[len("REDIS_URL="):]
        rest = re.sub(r"^(redis://:)[^@]*(@)", rf"\g<1>{encoded}\g<2>", rest)
        line = "REDIS_URL=" + rest
    out.append(line)
fd = os.open(target, os.O_WRONLY | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.writelines(out)
pw = None
print("redis_url_sync_ok=true")
PYEOF

  local new_pw
  new_pw="$(field_from_secrets_file REDIS_PASSWORD)"

  say "Reiniciando redis con la contraseña nueva (--requirepass viene del propio arranque del contenedor)..."
  if ! run_cmd docker compose --env-file "$SECRETS_FILE" up -d --force-recreate redis; then
    leave_gate_failed "S5" "no se pudo reiniciar redis."
    unset old_pw new_pw
    return 1
  fi

  state_set "S5" verifying

  say "Esperando a que redis confirme salud con la contraseña nueva (healthcheck de compose.yml)..."
  if [ "$DRY_RUN" != true ] && ! _gapssa_wait_healthy redis; then
    leave_gate_failed "S5" "redis no confirmó salud (healthcheck) tras el force-recreate — revisa 'docker compose logs redis'."
    unset old_pw new_pw
    return 1
  fi

  say "Verificando PING autenticado por TCP real (Bloque 5 — cliente Node, nunca 'docker compose exec' dentro del propio contenedor; la contraseña viaja solo en memoria de proceso, nunca en argv ni en fichero residual)..."
  local redis_port
  redis_port="$(field_from_secrets_file REDIS_HOST_PORT)"; redis_port="${redis_port:-6380}"
  local ping_ok=false
  if [ "$DRY_RUN" != true ]; then
    local check
    check="$(printf '{"host":"127.0.0.1","port":%s}\n%s' "$redis_port" "$new_pw" | node "$SCRIPT_DIR/lib/redisVerify.mjs" 2>/dev/null || true)"
    [ "$check" = true ] && ping_ok=true
  else
    ping_ok=true
  fi

  if [ "$ping_ok" != true ]; then
    leave_gate_failed "S5" "PING autenticado (TCP real) con la contraseña nueva falló."
    unset old_pw new_pw
    return 1
  fi
  say "  OK — PING autenticado con la contraseña nueva (TCP real)."

  if [ -n "$old_pw" ] && [ "$DRY_RUN" != true ]; then
    say "Verificando que la contraseña ANTERIOR queda rechazada (TCP real)..."
    local old_check
    old_check="$(printf '{"host":"127.0.0.1","port":%s}\n%s' "$redis_port" "$old_pw" | node "$SCRIPT_DIR/lib/redisVerify.mjs" 2>/dev/null || true)"
    if [ "$old_check" = true ]; then
      leave_gate_failed "S5" "la contraseña ANTERIOR de Redis todavía autentica."
      unset old_pw new_pw
      return 1
    fi
    say "  OK — contraseña anterior ya rechazada."
  fi

  unset old_pw new_pw
  leave_gate_done "S5"
}

# ---------------------------------------------------------------------------
# S6 — Payload / Auth / OTP — auditoría real (código citado, no una
# afirmación), verificación dinámica diferida a S9 (requiere apps/web
# arrancado, que este script no hace fuera de S9)
# ---------------------------------------------------------------------------
gate_s6() {
  divider
  say "Puerta S6 — PAYLOAD_SECRET, OTP_HMAC_SECRET, AUTH_RATE_LIMIT_HMAC_SECRET"
  say "Auditoría de impacto real (código citado, sesión 2026-08-14):"
  say "  - PAYLOAD_SECRET: apps/web/src/payload.config.ts:70 — firma el JWT de"
  say "    sesión del panel admin de Payload (cookie payload-token, colección"
  say "    Users). Rotarlo cierra la sesión de TODO editor de contenido"
  say "    conectado en ese instante; las credenciales (email/password) no se"
  say "    tocan, solo deben volver a iniciar sesión."
  say "  - OTP_HMAC_SECRET: packages/contracts/src/otp.ts:159-166 — HMAC-SHA-256"
  say "    de \"v1:<challengeId>:<purpose>:<subjectRef>:<code>\", guardado en"
  say "    Redis (otp:challenge:<id>, TTL=OTP_TTL_MINUTES) — apps/web/src/server/"
  say "    auth/otpService.ts. Rotarlo invalida CUALQUIER código OTP ya enviado"
  say "    y pendiente de verificar, incluido el flujo de 'olvidé mi contraseña'"
  say "    (app/api/auth/password/forgot|reset/route.ts) — el usuario debe"
  say "    pedir un código nuevo."
  say "  - AUTH_RATE_LIMIT_HMAC_SECRET: app/api/auth/login/route.ts:32-40 +"
  say "    server/auth/rateLimit.ts:36 — HMAC de la clave de límite de"
  say "    frecuencia en Redis. Rotarlo 'olvida' cualquier ventana de límite"
  say "    activa (efecto ya documentado como aceptable en .env.example:78) —"
  say "    las claves antiguas no quedan expuestas, solo huérfanas hasta su"
  say "    propio TTL."
  say "  - Sesiones/cookies del PORTAL (no admin): server/auth/session.ts:75-102"
  say "    — token opaco aleatorio (randomBytes), NUNCA firmado con ninguno de"
  say "    estos tres secretos; solo su SHA-256 sin clave se guarda en Postgres."
  say "    Confirmado en el código, no asumido: rotar estos tres secretos NO"
  say "    afecta a ninguna sesión de cliente ya abierta."
  say ""
  say "Verificación DINÁMICA real (OTP/rate-limit reales contra Redis, JWT de"
  say "Payload) se prueba con artefactos desechables — NUNCA se guarda ningún"
  say "secreto anterior en disco, solo salidas de un solo sentido (código OTP de"
  say "vida corta, JWT firmado) — y se confirma en S9, una vez rotado."
  say "Esta puerta queda 'prepared' (nunca 'done' directamente): S9 la promueve a"
  say "'done' solo si esa verificación dinámica pasa entera."
  confirm_gate "S6" || return 0
  require_secrets_file || return 1

  local otp_probe_file="$SECRETS_DIR/tmp/s6-otp-probe.json"
  local artifact_dir="$SECRETS_DIR/tmp"

  if [ "$DRY_RUN" = true ]; then
    enter_gate "S6" || return 1
    say "[dry-run] no se crea ningún artefacto de prueba real ni se genera/activa nada."
    leave_gate_done "S6"
    return 0
  fi

  mkdir -p "$artifact_dir"
  chmod 700 "$artifact_dir"

  # --- Inspección del artefacto ANTES de enter_gate: si hay que
  #     bloquear, el estado de S6 queda EXACTAMENTE como estaba (ni
  #     'applying', ni ningún otro valor) — no se toma backup, no se fija
  #     CURRENT_GATE. Un artefacto válido nunca se retira en automático
  #     aquí: puede ser el único material para diagnosticar o recuperar
  #     una rotación parcialmente aplicada. La única retirada real del
  #     sistema vive en run_s6_dynamic_verification() (S9), tras una
  #     verificación dinámica completada. ---
  say "Comprobando si ya existe un artefacto de prueba previo de un intento anterior..."
  local inspect_json
  if ! inspect_json="$(node "$SCRIPT_DIR/lib/run-tsx.mjs" "$REPO_ROOT" "$SECRETS_FILE" "$SCRIPT_DIR/probes/s6ArtifactMaintenance.mts" inspect "$otp_probe_file" "$artifact_dir" | node "$SCRIPT_DIR/lib/validateProbeJson.mjs" s6-artifact-inspect)"; then
    say "ERROR: no se pudo inspeccionar el estado del artefacto de prueba previo (ver mensaje de arriba). El estado de S6 no se modifica."
    return 1
  fi
  local artifact_status
  artifact_status="$(printf '%s' "$inspect_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")"

  case "$artifact_status" in
  invalid)
    say "S6 BLOQUEADA: el artefacto de prueba en $otp_probe_file no superó su propia verificación de integridad (symlink, modo, propietario o esquema inesperados) — se conserva sin tocar para inspección manual. El estado de S6 no se modifica."
    return 1
    ;;
  valid)
    if [ "$(state_get "S6")" = "prepared" ]; then
      say "S6 BLOQUEADA: ya existe un artefacto de prueba válido pendiente de verificar — completa S9 para promover S6 a 'done' en vez de repetir S6. El estado de S6 no se modifica."
    else
      say "S6 BLOQUEADA: existe un artefacto de prueba válido de una ejecución previa o interrumpida (estado actual de S6: $(state_get "S6")) — se conserva sin tocar como evidencia reanudable, nunca se retira en automático. Resuélvelo manualmente antes de continuar. El estado de S6 no se modifica."
    fi
    return 1
    ;;
  esac
  # absent: continúa con normalidad.

  enter_gate "S6" || return 1

  say "Creando artefactos de prueba desechables ANTES de rotar (OTP real en Redis,"
  say "golpe de rate-limit real, JWT firmado con el PAYLOAD_SECRET actual) — ninguno"
  say "de los tres secretos ANTIGUOS se guarda nunca en disco, solo estas salidas de"
  say "un solo sentido..."
  local probe_status_json
  if ! probe_status_json="$(node "$SCRIPT_DIR/lib/run-tsx.mjs" "$REPO_ROOT" "$SECRETS_FILE" "$SCRIPT_DIR/probes/s6PreRotationProbe.mts" "$otp_probe_file" "$artifact_dir" | node "$SCRIPT_DIR/lib/validateProbeJson.mjs" s6-pre)"; then
    leave_gate_failed "S6" "no se pudieron crear los artefactos de prueba previos a la rotación, o su salida no superó la validación de contrato JSON."
    return 1
  fi
  say "Artefactos de prueba creados (fuera del workspace, modo 600, sin PII, sin ningún secreto)."

  for var in PAYLOAD_SECRET OTP_HMAC_SECRET AUTH_RATE_LIMIT_HMAC_SECRET; do
    if ! bash "$SCRIPT_DIR/02-generate-secret.sh" "$SECRETS_FILE" --set-line "$var" --format base64 --bytes 32; then
      leave_gate_failed "S6" "no se pudo generar $var. El artefacto de prueba se conserva (nunca se retira aquí) — S9 nunca podrá promover con este estado 'failed', pero si necesitas reintentar S6 desde cero, la puerta quedará bloqueada por el artefacto residual hasta resolverlo manualmente."
      return 1
    fi
  done

  state_set "S6" prepared
  CURRENT_GATE=""
  say "Puerta S6: secretos generados y artefactos de prueba listos — queda 'prepared'."
  say "S9 la promoverá a 'done' tras verificar dinámicamente que los artefactos"
  say "ANTIGUOS quedan invalidados y los NUEVOS funcionan de verdad."
}

# ---------------------------------------------------------------------------
# Verificación dinámica de S6 — invocada SOLO desde gate_s9(), una vez que
# los tres secretos ya están rotados y Redis es el real (rotado en S5).
# No requiere que apps/web (Next) esté arrancado: llama directamente a las
# mismas funciones de producción (otpService.ts/rateLimit.ts) contra Redis
# real, más una comprobación JWT pura en memoria para PAYLOAD_SECRET —
# nunca HTTP, nunca un secreto persistido.
# ---------------------------------------------------------------------------
run_s6_dynamic_verification() {
  local otp_probe_file="$SECRETS_DIR/tmp/s6-otp-probe.json"
  local artifact_dir="$SECRETS_DIR/tmp"
  if [ ! -f "$otp_probe_file" ]; then
    say "  FALLO S6: no existe el artefacto de prueba previo a la rotación ($otp_probe_file) — no se puede demostrar la invalidación real. S6 permanece 'prepared'."
    return 1
  fi

  local result_json
  if ! result_json="$(node "$SCRIPT_DIR/lib/run-tsx.mjs" "$REPO_ROOT" "$SECRETS_FILE" "$SCRIPT_DIR/probes/s6PostRotationVerification.mts" "$otp_probe_file" "$artifact_dir" | node "$SCRIPT_DIR/lib/validateProbeJson.mjs" s6-post)"; then
    say "  FALLO S6: la verificación dinámica post-rotación no pudo ejecutarse (ver mensaje de arriba) — el artefacto se conserva para un reintento posterior (esta rama NO está autorizada a retirarlo: la verificación nunca llegó a completarse). S6 permanece 'prepared'."
    return 1
  fi

  # A partir de aquí la verificación SÍ se completó (con independencia de
  # si el resultado es favorable) — la ÚNICA transición del sistema
  # autorizada a retirar el artefacto. SIEMPRE vía removeArtifactStrict
  # (s6ArtifactMaintenance.mts remove) — nunca gapssa_secrets_shred, rm
  # ni unlink desde bash: el hecho de que la sonda de verificación
  # acabara de leerlo no garantiza que la ruta siga apuntando al mismo
  # inodo cuando bash actúa después, en un proceso aparte.
  local otp_old otp_new rl_ok payload_old payload_new
  otp_old="$(printf '%s' "$result_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['otpOldInvalidated'])")"
  otp_new="$(printf '%s' "$result_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['otpNewWorks'])")"
  rl_ok="$(printf '%s' "$result_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['rateLimitFreshCounterOk'])")"
  payload_old="$(printf '%s' "$result_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['payloadOldInvalidated'])")"
  payload_new="$(printf '%s' "$result_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['payloadNewWorks'])")"

  say "  OTP antiguo invalidado tras rotar: $otp_old"
  say "  OTP nuevo funciona end-to-end: $otp_new"
  say "  Rate-limit nuevo, contador independiente del anterior: $rl_ok"
  say "  JWT de Payload antiguo (firmado con el PAYLOAD_SECRET anterior) invalidado: $payload_old"
  say "  JWT de Payload nuevo funciona: $payload_new"

  local remove_json remove_ok=true removed=false
  remove_json="$(node "$SCRIPT_DIR/lib/run-tsx.mjs" "$REPO_ROOT" "$SECRETS_FILE" "$SCRIPT_DIR/probes/s6ArtifactMaintenance.mts" remove "$otp_probe_file" "$artifact_dir" | node "$SCRIPT_DIR/lib/validateProbeJson.mjs" s6-artifact-remove)" || remove_ok=false
  if [ "$remove_ok" = true ]; then
    removed="$(printf '%s' "$remove_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['removed'])")"
  fi
  if [ "$remove_ok" != true ] || [ "$removed" != "True" ]; then
    say "  FALLO S6: la verificación se completó pero el artefacto no pudo retirarse con garantías (ver mensaje de arriba) — S6 NO se declara cerrada por esta vía bajo ninguna circunstancia, requiere revisión manual. S6 permanece 'prepared'."
    return 1
  fi

  if [ "$otp_old" = "True" ] && [ "$otp_new" = "True" ] && [ "$rl_ok" = "True" ] && [ "$payload_old" = "True" ] && [ "$payload_new" = "True" ]; then
    state_set "S6" done
    say "  OK — verificación dinámica de S6 completa. S6 promovida a 'done'."
    return 0
  fi
  say "  FALLO — al menos una comprobación dinámica de S6 no pasó. S6 permanece 'prepared'."
  return 1
}

# ---------------------------------------------------------------------------
# S7 — Booking: los cinco secretos, con comprobaciones de seguridad reales
# antes de sustituir/retirar nada, y retirada obligatoria de v1/v2 dentro
# de esta misma puerta en cuanto el conteo real lo permita.
# ---------------------------------------------------------------------------
gate_s7() {
  divider
  say "Puerta S7 — Booking: los cinco secretos"
  say "Patrón atómico por secreto: genera/activa la versión nueva SIEMPRE (activar"
  say "nunca invalida nada vivo, gracias al versionado real de los 5 secretos);"
  say "migra/reindexa donde aplica; recuenta EN FRESCO (nunca reutiliza un conteo"
  say "de antes de migrar); retira la versión vieja del mapa SOLO si ese conteo"
  say "fresco es 0. S7 termina 'done' únicamente si los CINCO secretos quedan sin"
  say "ninguna versión comprometida en ningún mapa — si no, 'blocked', nunca 'done'"
  say "con una versión vieja todavía viva en cualquiera de los cinco."
  confirm_gate "S7" || return 0
  require_secrets_file || return 1
  enter_gate "S7" || return 1

  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] no se crea ningún fichero temporal, no se genera/activa/migra/retira nada real."
    leave_gate_done "S7"
    return 0
  fi

  # --- generar + activar v3 SIEMPRE para los 4 secretos versionados -----
  for pair in \
    "BOOKING_FIELD_ENCRYPTION_KEYS" \
    "BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS" \
    "BOOKING_EMAIL_LOOKUP_HMAC_SECRETS" \
    "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS"; do
    if ! bash "$SCRIPT_DIR/02-generate-secret.sh" "$SECRETS_FILE" --set-json-map "$pair" v3 --format base64 --bytes 32; then
      leave_gate_failed "S7" "no se pudo generar $pair v3."
      return 1
    fi
  done

  say "Activando v3 como versión ACTIVA de los 4 secretos versionados (las versiones"
  say "viejas se conservan en cada mapa hasta que su conteo real de dependientes sea 0)..."
  python3 - "$SECRETS_FILE" <<'PYEOF'
import sys, os
target = sys.argv[1]
with open(target, "r", encoding="utf-8") as f:
    lines = f.readlines()
targets = {
    "BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION=": "v3\n",
    "BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION=": "v3\n",
    "BOOKING_EMAIL_LOOKUP_HMAC_ACTIVE_KEY_VERSION=": "v3\n",
    "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_ACTIVE_KEY_VERSION=": "v3\n",
}
found = set()
out = []
for line in lines:
    matched = next((p for p in targets if line.startswith(p)), None)
    if matched:
        out.append(matched + targets[matched])
        found.add(matched)
    else:
        out.append(line)
for p, v in targets.items():
    if p not in found:
        out.append(p + v)
fd = os.open(target, os.O_WRONLY | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.writelines(out)
print("active_version_sync_ok=true")
PYEOF

  # --- migración/reindexado + auditoría de allowlist + recuentos FRESCOS,
  # todo en una única invocación de tsx (un solo round-trip contra Postgres) --
  say "Ejecutando migración de recifrado AES, reindexado de email-lookup HMAC,"
  say "auditoría de columnas cifradas y recuentos EN FRESCO (idempotente, reanudable,"
  say "transaccional por fila)..."
  local migrate_json
  if ! migrate_json="$(node "$SCRIPT_DIR/lib/run-tsx.mjs" "$REPO_ROOT" "$SECRETS_FILE" "$SCRIPT_DIR/probes/s7MigrateAndAudit.mts" | node "$SCRIPT_DIR/lib/validateProbeJson.mjs" s7-migrate)"; then
    leave_gate_failed "S7" "la migración/reindexado/auditoría falló, o su salida no superó la validación de contrato JSON — es reanudable, corrige el problema y vuelve a lanzar esta puerta."
    return 1
  fi
  say "Resultado (solo conteos/booleanos, cero PII, cero ciphertext): $migrate_json"

  local allowlist_ok aes_v1 aes_v2 aes_decrypt_ok email_v1 fp_remaining at_remaining
  allowlist_ok="$(printf '%s' "$migrate_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['allowlistOk'])")"
  aes_v1="$(printf '%s' "$migrate_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['aesRemainingV1'])")"
  aes_v2="$(printf '%s' "$migrate_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['aesRemainingV2'])")"
  aes_decrypt_ok="$(printf '%s' "$migrate_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['aesDecryptOk'])")"
  email_v1="$(printf '%s' "$migrate_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['emailLookupRemainingV1'])")"
  fp_remaining="$(printf '%s' "$migrate_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['fingerprintRemaining'])")"
  at_remaining="$(printf '%s' "$migrate_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['accessTokenRemaining'])")"

  if [ "$allowlist_ok" != "True" ]; then
    leave_gate_failed "S7" "auditoría de columnas cifradas falló (allowlistUnlisted/allowlistMissing en el JSON de arriba) — corrige encryptedColumnsAllowlist.ts o el esquema antes de continuar, esto NUNCA es un 'esperar a que se resuelva'."
    return 1
  fi

  state_set "S7" verifying

  local s7_blocked=false s7_blocked_reasons=""

  # --- AES ---
  if [ "$aes_v1" = "0" ] && [ "$aes_v2" = "0" ] && [ "$aes_decrypt_ok" = "True" ]; then
    say "0 filas dependen ya de v1/v2 (AES) y el descifrado completo con el mapa final (solo v3) es válido — retirando v1/v2 AHORA."
    python3 - "$SECRETS_FILE" <<'PYEOF'
import sys, json, os
target = sys.argv[1]
with open(target, "r", encoding="utf-8") as f:
    lines = f.readlines()
out = []
for line in lines:
    if line.startswith("BOOKING_FIELD_ENCRYPTION_KEYS="):
        m = json.loads(line.rstrip("\n").split("=", 1)[1])
        m = {"v3": m["v3"]} if "v3" in m else m
        line = "BOOKING_FIELD_ENCRYPTION_KEYS=" + json.dumps(m, separators=(",", ":")) + "\n"
    out.append(line)
fd = os.open(target, os.O_WRONLY | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.writelines(out)
print("aes_retirement_ok=true")
PYEOF
  else
    s7_blocked=true
    s7_blocked_reasons="${s7_blocked_reasons}AES (v1=$aes_v1, v2=$aes_v2, descifradoFinalOk=$aes_decrypt_ok); "
    say "AVISO: AES NO retirado — v1=$aes_v1, v2=$aes_v2 fila(s) todavía dependientes, o el descifrado final falló. Conservado por seguridad."
  fi

  # --- fingerprint ---
  if [ "$fp_remaining" = "0" ]; then
    say "0 solicitudes vivas referencian v1/v2 de fingerprint (recuento EN FRESCO) — retirando AHORA."
    python3 - "$SECRETS_FILE" <<'PYEOF'
import sys, json, os
target = sys.argv[1]
with open(target, "r", encoding="utf-8") as f:
    lines = f.readlines()
out = []
for line in lines:
    if line.startswith("BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS="):
        m = json.loads(line.rstrip("\n").split("=", 1)[1])
        m = {"v3": m["v3"]} if "v3" in m else m
        line = "BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS=" + json.dumps(m, separators=(",", ":")) + "\n"
    out.append(line)
fd = os.open(target, os.O_WRONLY | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.writelines(out)
print("fingerprint_retirement_ok=true")
PYEOF
  else
    s7_blocked=true
    s7_blocked_reasons="${s7_blocked_reasons}fingerprint ($fp_remaining solicitud(es) viva(s) referencian v1/v2); "
    say "AVISO: fingerprint NO retirado — $fp_remaining solicitud(es) todavía sin resolver referencian v1/v2 (cota superior: APPROVAL_HOLD_HOURS). Vuelve a lanzar esta puerta más adelante."
  fi

  # --- email-lookup ---
  if [ "$email_v1" = "0" ]; then
    say "0 identidades activas dependen ya de v1 (email-lookup) — retirando AHORA."
    python3 - "$SECRETS_FILE" <<'PYEOF'
import sys, json, os
target = sys.argv[1]
with open(target, "r", encoding="utf-8") as f:
    lines = f.readlines()
out = []
for line in lines:
    if line.startswith("BOOKING_EMAIL_LOOKUP_HMAC_SECRETS="):
        m = json.loads(line.rstrip("\n").split("=", 1)[1])
        m = {"v3": m["v3"]} if "v3" in m else m
        line = "BOOKING_EMAIL_LOOKUP_HMAC_SECRETS=" + json.dumps(m, separators=(",", ":")) + "\n"
    out.append(line)
fd = os.open(target, os.O_WRONLY | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.writelines(out)
print("email_lookup_retirement_ok=true")
PYEOF
  else
    s7_blocked=true
    s7_blocked_reasons="${s7_blocked_reasons}email-lookup ($email_v1 identidad(es) activa(s) sin reindexar en v1 — no debería pasar, el reindexado recorre hasta vaciar el lote); "
    say "AVISO: email-lookup NO retirado — $email_v1 fila(s) activa(s) todavía en v1. Revisa antes de volver a lanzar esta puerta."
  fi

  # --- access token ---
  if [ "$at_remaining" = "0" ]; then
    say "0 solicitudes vivas referencian v1 de access-token (recuento EN FRESCO, por versión exacta guardada en cada fila) — retirando AHORA."
    python3 - "$SECRETS_FILE" <<'PYEOF'
import sys, json, os
target = sys.argv[1]
with open(target, "r", encoding="utf-8") as f:
    lines = f.readlines()
out = []
for line in lines:
    if line.startswith("BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS="):
        m = json.loads(line.rstrip("\n").split("=", 1)[1])
        m = {"v3": m["v3"]} if "v3" in m else m
        line = "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS=" + json.dumps(m, separators=(",", ":")) + "\n"
    out.append(line)
fd = os.open(target, os.O_WRONLY | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.writelines(out)
print("access_token_retirement_ok=true")
PYEOF
  else
    s7_blocked=true
    s7_blocked_reasons="${s7_blocked_reasons}access-token ($at_remaining solicitud(es) viva(s) referencian v1 — su token, firmado con v1, sigue vigente hasta que se resuelvan); "
    say "AVISO: access-token NO retirado — $at_remaining solicitud(es) viva(s) todavía referencian v1 (accessTokenKeyVersion, criterio exacto por fila). Vuelve a lanzar esta puerta más adelante."
  fi

  # --- internal API secret: sin filas dependientes por diseño — sustitución
  # directa + verificación real de la función de autenticación (nunca el
  # sweep real), con el valor ANTERIOR solo en memoria de este proceso ---
  local old_internal_api
  old_internal_api="$(field_from_secrets_file BOOKING_INTERNAL_API_SECRET)"
  if ! bash "$SCRIPT_DIR/02-generate-secret.sh" "$SECRETS_FILE" --set-line BOOKING_INTERNAL_API_SECRET --format base64 --bytes 32; then
    unset old_internal_api
    leave_gate_failed "S7" "no se pudo generar BOOKING_INTERNAL_API_SECRET."
    return 1
  fi

  local old_internal_api_file
  old_internal_api_file="$(gapssa_secrets_mktemp_secure gapssa-s7-old-internal-api)"
  gapssa_cleanup_push shred_plain "$old_internal_api_file"
  printf 'OLD_INTERNAL_API_SECRET=%s\n' "$old_internal_api" >"$old_internal_api_file"
  unset old_internal_api
  chmod 600 "$old_internal_api_file"

  local internal_check_json
  local internal_check_ok=true
  internal_check_json="$(node "$SCRIPT_DIR/lib/run-tsx.mjs" "$REPO_ROOT" "$SECRETS_FILE" "$SCRIPT_DIR/probes/s7InternalApiAuthCheck.mts" "$old_internal_api_file" | node "$SCRIPT_DIR/lib/validateProbeJson.mjs" s7-internal-check)" || internal_check_ok=false
  gapssa_secrets_shred "$old_internal_api_file"
  gapssa_cleanup_pop_matching shred_plain "$old_internal_api_file"

  if [ "$internal_check_ok" != true ]; then
    leave_gate_failed "S7" "no se pudo verificar la función de autenticación interna (isValidInternalApiSecret) tras rotar BOOKING_INTERNAL_API_SECRET."
    return 1
  fi
  say "Verificación directa de isValidInternalApiSecret (nunca el sweep real, ningún efecto de negocio): $internal_check_json"
  local new_ok old_ok absent_ok
  new_ok="$(printf '%s' "$internal_check_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['newAccepted'])")"
  old_ok="$(printf '%s' "$internal_check_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['oldRejected'])")"
  absent_ok="$(printf '%s' "$internal_check_json" | python3 -c "import sys,json; print(json.load(sys.stdin)['absentRejected'])")"
  if [ "$new_ok" != "True" ] || [ "$old_ok" != "True" ] || [ "$absent_ok" != "True" ]; then
    s7_blocked=true
    s7_blocked_reasons="${s7_blocked_reasons}internal-api (newAccepted=$new_ok oldRejected=$old_ok absentRejected=$absent_ok); "
  else
    say "BOOKING_INTERNAL_API_SECRET sustituido y verificado: nuevo aceptado, anterior rechazado, ausente rechazado."
  fi

  if [ "$s7_blocked" = true ]; then
    leave_gate_blocked "S7" "quedan dependencias vivas o verificaciones fallidas: $s7_blocked_reasons vuelve a lanzar esta puerta más adelante para completar la retirada/verificación."
    return 1
  fi

  leave_gate_done "S7"
}

# ---------------------------------------------------------------------------
# S8 — inventario explícito con evidencia (nunca un "no aplica" sin más)
# ---------------------------------------------------------------------------
#   Códigos cerrados de S8 (nunca texto libre persistido — el único campo
#   que se guarda/informa es uno de estos cinco):
#     not_configured        — el dominio/fichero no existe en este checkout.
#     separate_secret_store — existe/aplica, pero vive en un almacén SEPARADO,
#                              nunca tocado por este script.
#     affected_rotated      — afectado, y ya rotado en esta ejecución.
#     affected_pending      — afectado, y AÚN NO rotado.
#     unable_to_determine   — evidencia insuficiente/ambigua.
#   S8 termina 'done' solo si las tres integraciones resuelven a
#   not_configured/separate_secret_store/affected_rotated — 'blocked' si
#   cualquiera resuelve a unable_to_determine/affected_pending. Cada
#   comprobación usa ÚNICAMENTE existencia/ruta (nunca abre el contenido de
#   ningún fichero de n8n/FacturaScripts) o un hecho arquitectónico ya
#   conocido por el propio código (Google) — nunca grep/cat/rg sobre un
#   fichero de configuración ajeno.
gate_s8() {
  divider
  say "Puerta S8 — n8n / FacturaScripts / Google Calendar Sync"
  say "Código cerrado por integración (nunca una afirmación de texto libre):"
  confirm_gate "S8" || return 0
  enter_gate "S8" || return 1

  local n8n_env="$REPO_ROOT/integrations/n8n/.env"
  local fs_env="$REPO_ROOT/infra/facturascripts/.env"
  local n8n_status fs_status google_status

  # n8n / FacturaScripts: SOLO existencia/ruta — nunca se abre el fichero.
  if [ -f "$n8n_env" ]; then
    n8n_status="separate_secret_store"
    say "  - n8n: existe $n8n_env — archivo SEPARADO del rotado por este script (solo se comprobó"
    say "         su existencia, nunca se abrió) → $n8n_status."
  else
    n8n_status="not_configured"
    say "  - n8n: $n8n_env no existe en este checkout → $n8n_status."
  fi

  if [ -f "$fs_env" ]; then
    fs_status="separate_secret_store"
    say "  - FacturaScripts: existe $fs_env — archivo SEPARADO (solo existencia comprobada) → $fs_status."
  else
    fs_status="not_configured"
    say "  - FacturaScripts: $fs_env no existe en este checkout → $fs_status."
  fi

  # Google Calendar Sync: hecho arquitectónico ya documentado en el propio
  # código de la extensión (credenciales en data/config-internal.php DENTRO
  # del contenedor espocrm, nunca en el .env de apps/web) — no requiere
  # abrir ningún fichero del contenedor para afirmarlo.
  google_status="separate_secret_store"
  say "  - Google Calendar Sync: credenciales en data/config-internal.php DENTRO del contenedor"
  say "    espocrm (hecho arquitectónico del código de la extensión, nunca leído en vivo aquí) → $google_status."

  local s8_ok=true
  for status in "$n8n_status" "$fs_status" "$google_status"; do
    case "$status" in
    not_configured | separate_secret_store | affected_rotated) ;;
    *) s8_ok=false ;;
    esac
  done

  say ""
  if [ "$s8_ok" = true ]; then
    say "Puerta S8: las tres integraciones resuelven a un código cerrado sin ambigüedad."
    leave_gate_done "S8"
  else
    leave_gate_blocked "S8" "al menos una integración resolvió a unable_to_determine/affected_pending (n8n=$n8n_status, facturascripts=$fs_status, google=$google_status)."
  fi
}

# ---------------------------------------------------------------------------
# S9 — verificación final estricta. RECHAZA ejecutarse si falta cualquier
# puerta anterior (S6 puede estar 'prepared', el resto debe ser 'done') —
# sin opción de "continuar de todas formas". Arranca/detiene apps/web ella
# misma (comando único, sección 10 del plan) — nunca pide al operador abrir
# otra pestaña. Incluye verificación RUNTIME (docker inspect) de la imagen
# real de EspoCRM y verificación REAL de la ACL efectiva de Meeting
# (Portal GAPSSA API + Profesional Gapssa, roles directos y heredados por
# equipo, algoritmo exacto del núcleo — lib/verifyEspoAclSnapshot.mjs,
# Bloque 4) en vez de solo comprobar que el User existe.
# ---------------------------------------------------------------------------

# Mueve TODOS los .env* reales (raíz + apps/web, excluyendo .env.example y
# node_modules) a $QUARANTINE_DIR — solo existencia/ruta, nunca contenido.
# Devuelve por stdout, una por línea, "origen<TAB>destino" de lo movido —
# para poder restaurar exactamente si algo falla después.
_quarantine_all_env_files() {
  mkdir -p "$QUARANTINE_DIR"
  chmod 700 "$QUARANTINE_DIR"
  local f base dest ts
  ts="$(date +%Y%m%d-%H%M%S)"
  for f in "$REPO_ROOT"/.env* "$REPO_ROOT/apps/web"/.env*; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    [ "$base" = ".env.example" ] && continue
    dest="$QUARANTINE_DIR/${base}-compromised-${ts}-$(openssl rand -hex 3)"
    mv "$f" "$dest"
    chmod 600 "$dest"
    printf '%s\t%s\n' "$f" "$dest"
  done
}

# Helpers de introspección REST de ACL (User/Role/Team) — fichero
# compartido con scripts/secrets-rotation/tests/espo_acl_rehearsal.sh
# (Bloque 4), única fuente de verdad para ambos.
# shellcheck source=lib/aclRest.sh
source "$SCRIPT_DIR/lib/aclRest.sh"

gate_s9() {
  divider
  say "Puerta S9 — Verificación final estricta, arranque/cuarentena/apagado en un único comando"

  local g pending=()
  for g in S1 S2 S3 S4 S5 S7 S8; do
    if [ "$(state_get "$g")" != "done" ]; then
      pending+=("$g")
    fi
  done
  local s6_state
  s6_state="$(state_get S6)"
  if [ "$s6_state" != "done" ] && [ "$s6_state" != "prepared" ]; then
    pending+=("S6")
  fi
  if [ "${#pending[@]}" -gt 0 ]; then
    say "BLOQUEADO: faltan puertas por completar: ${pending[*]}"
    say "S9 no se puede ejecutar mientras falte cualquier puerta anterior — no hay opción de 'continuar de todas formas'."
    say "Completa esas puertas (o repítelas con --only Sx) y vuelve a lanzar S9."
    return 1
  fi

  confirm_gate "S9" || return 0
  enter_gate "S9" || return 1

  if [ "$DRY_RUN" = true ]; then
    say "[dry-run] no se arrancan servicios, no se pone nada en cuarentena, no se verifica/genera nada real."
    leave_gate_done "S9"
    return 0
  fi

  local checks_ok=true

  say "Arrancando todos los servicios de docker compose con el archivo externo..."
  if ! run_cmd docker compose --env-file "$SECRETS_FILE" up -d; then
    leave_gate_failed "S9" "docker compose up -d falló."
    return 1
  fi

  say "Comprobando que los servicios esperados están 'running'..."
  local running
  running="$(capture_cmd docker compose --env-file "$SECRETS_FILE" ps --status running --services)"
  say "  Servicios en ejecución: $(printf '%s' "$running" | tr '\n' ' ')"
  for svc in apps-db redis espocrm-db espocrm espocrm-daemon espocrm-websocket; do
    if ! printf '%s\n' "$running" | grep -qx "$svc"; then
      say "  FALLO: '$svc' no está en ejecución."
      checks_ok=false
    fi
  done

  # --- Verificación RUNTIME de la imagen real de EspoCRM (nunca el valor
  # declarado en ESPOCRM_IMAGE del almacén externo — eso solo demuestra
  # configuración, no qué corre realmente) ---
  say "Verificando (docker inspect) la imagen que ejecuta REALMENTE el contenedor 'espocrm'..."
  local espocrm_cid_lines espocrm_cid_count=0 espocrm_cid="" admin_runtime_core_verified=false
  espocrm_cid_lines="$(capture_cmd docker compose --env-file "$SECRETS_FILE" ps -q espocrm)"
  espocrm_cid_count="$(printf '%s\n' "$espocrm_cid_lines" | grep -c . 2>/dev/null || true)"
  if [ "$espocrm_cid_count" = "1" ]; then
    espocrm_cid="$(printf '%s\n' "$espocrm_cid_lines" | grep .)"
    if [ "$(_s9_verify_runtime_image "$espocrm_cid" "espocrm/espocrm:10.0.3-apache-trixie")" = "true" ]; then
      admin_runtime_core_verified=true
    fi
  fi
  if [ "$admin_runtime_core_verified" = true ]; then
    say "  OK — evidencia runtime: el contenedor 'espocrm' ejecuta exactamente la imagen auditada (espocrm/espocrm:10.0.3-apache-trixie)."
  else
    say "  FALLO: no se pudo demostrar en runtime (docker inspect, no .env) que 'espocrm' ejecuta exactamente la imagen auditada — adminRuntimeCoreVerified=false."
    checks_ok=false
  fi

  # --- reverificaciones negativas de secretos ANTERIORES — recuperados
  # SOLO desde el backup cifrado (sección 1b), nunca inventados, nunca
  # asumidos "seguro que ya no funcionan" ---
  say ""
  say "Reverificando que las credenciales ANTERIORES (S2/S3/S4/S5) quedan rechazadas —"
  say "recuperadas solo desde el backup cifrado + tu frase de recuperación, nunca de memoria..."

  local old_pg_pw
  if old_pg_pw="$(recover_old_secret_value S2 POSTGRES_PASSWORD)"; then
    local pg_user; pg_user="$(field_from_secrets_file POSTGRES_USER)"
    if pg_capture "SELECT 1;" "$pg_user" "$old_pg_pw" >/dev/null 2>&1; then
      say "  FALLO: la contraseña ANTERIOR de Postgres todavía autentica."
      checks_ok=false
    else
      say "  OK — contraseña anterior de Postgres rechazada."
    fi
    unset old_pg_pw
  else
    say "  AVISO: no se pudo recuperar la contraseña anterior de Postgres desde el backup — no se puede demostrar su invalidación. S9 quedará bloqueada."
    checks_ok=false
  fi

  local old_espocrm_db_pw
  if old_espocrm_db_pw="$(recover_old_secret_value S3 ESPOCRM_DB_PASSWORD)"; then
    if mariadb_capture "SELECT 1;" espocrm "$old_espocrm_db_pw" >/dev/null 2>&1; then
      say "  FALLO: la contraseña ANTERIOR de MariaDB (espocrm) todavía autentica."
      checks_ok=false
    else
      say "  OK — contraseña anterior de MariaDB (espocrm) rechazada."
    fi
    unset old_espocrm_db_pw
  else
    say "  AVISO: no se pudo recuperar la contraseña anterior de MariaDB desde el backup — no se puede demostrar su invalidación. S9 quedará bloqueada."
    checks_ok=false
  fi

  local espocrm_port admin_user curl_admin_cfg
  espocrm_port="$(field_from_secrets_file ESPOCRM_HTTP_PORT)"; espocrm_port="${espocrm_port:-8081}"
  admin_user="$(field_from_secrets_file ESPOCRM_ADMIN_USERNAME)"; admin_user="${admin_user:-admin}"
  local admin_pw; admin_pw="$(field_from_secrets_file ESPOCRM_ADMIN_PASSWORD)"
  curl_admin_cfg="$(gapssa_secrets_mktemp_secure gapssa-s9-curl-admin)"
  gapssa_cleanup_push shred_plain "$curl_admin_cfg"
  write_curl_config "$curl_admin_cfg" "user = \"${admin_user}:$(gapssa_secrets_curl_cfg_escape "${admin_pw}")\"" "fail"
  unset admin_pw

  local old_api_key
  if old_api_key="$(recover_old_secret_value S4 ESPOCRM_API_KEY)"; then
    if [ -z "$old_api_key" ]; then
      # Vacío recuperado con ÉXITO (no un fallo de descifrado): esta
      # instalación no tenía ESPOCRM_API_KEY configurada antes de que S4
      # la generase por primera vez — no hay nada que invalidar, así que
      # esta comprobación pasa trivialmente en vez de bloquear S9 para
      # siempre en un caso real (primera rotación de una instalación
      # nueva). Ver recover_old_secret_value.
      say "  OK — no había ninguna API Key anterior que invalidar (ESPOCRM_API_KEY se generó por primera vez en esta misma sesión)."
    else
      local curl_oldkey_cfg
      curl_oldkey_cfg="$(gapssa_secrets_mktemp_secure gapssa-s9-curl-oldkey)"
      gapssa_cleanup_push shred_plain "$curl_oldkey_cfg"
      write_curl_config "$curl_oldkey_cfg" "header = \"X-Api-Key: $(gapssa_secrets_curl_cfg_escape "${old_api_key}")\"" "fail"
      unset old_api_key
      if curl -K "$curl_oldkey_cfg" -sS -o /dev/null "http://localhost:${espocrm_port}/api/v1/App/user" 2>/dev/null; then
        say "  FALLO: la API Key ANTERIOR de EspoCRM todavía autentica."
        checks_ok=false
      else
        say "  OK — API Key anterior de EspoCRM rechazada."
      fi
      gapssa_secrets_shred "$curl_oldkey_cfg"
      gapssa_cleanup_pop_matching shred_plain "$curl_oldkey_cfg"
    fi
  else
    say "  AVISO: no se pudo recuperar la API Key anterior de EspoCRM desde el backup — no se puede demostrar su invalidación. S9 quedará bloqueada."
    checks_ok=false
  fi
  unset old_api_key

  # --- ACL efectiva real de Meeting (Portal GAPSSA API + Profesional
  # Gapssa) — Bloque 4: reemplaza la comprobación superficial anterior
  # ("User accesible ⇒ acl_ok=true", incluso con el usuario ausente) por
  # una verificación real vía REST + el algoritmo de fusión exacto del
  # núcleo (scripts/secrets-rotation/lib/verifyEspoAclSnapshot.mjs). Solo
  # lecturas; ninguna credencial en argv/JSON de diagnóstico; ninguna
  # respuesta con PII se imprime.
  say "Comprobando la ACL efectiva real de Meeting (Portal GAPSSA API + Profesional Gapssa)..."
  local acl_ok=false
  local acl_snapshot_json
  acl_snapshot_json="$(_s9_build_acl_snapshot_json "$curl_admin_cfg" "$espocrm_port" "$admin_runtime_core_verified")"

  if _s9_json_has_error "$acl_snapshot_json"; then
    say "  FALLO: alguna consulta REST de identidad (User/Role) falló o devolvió una forma inválida — ACL no verificable, S9 bloqueada."
  else
    local acl_helper_result
    acl_helper_result="$(printf '%s' "$acl_snapshot_json" | node "$SCRIPT_DIR/lib/verifyEspoAclSnapshot.mjs" 2>/dev/null)" || acl_helper_result=""

    if [ -n "$acl_helper_result" ]; then
      local acl_closed_flag
      acl_closed_flag="$(_s9_validate_acl_result_json "$acl_helper_result")"
      say "  Resultado ACL (S9, saneado — sin IDs/PII): $acl_helper_result"
      [ "$acl_closed_flag" = "true" ] && acl_ok=true
    else
      say "  FALLO: la verificación de ACL (verifyEspoAclSnapshot.mjs) no produjo un resultado válido."
    fi
  fi
  [ "$acl_ok" != true ] && checks_ok=false

  # Bloque 6: eliminado el temporal fijo /tmp/.gapssa-s9-redis-auth (y el
  # `docker cp` + `REDISCLI_AUTH="$(cat ...)"` que lo leía dentro del
  # contenedor) — sustituido por el mismo helper TCP real ya usado por
  # S5/la recuperación (lib/redisVerify.mjs): cero fichero, cero entorno
  # de contenedor, cero argv. La contraseña candidata solo vive en la
  # variable de bash `old_redis_pw` (nunca impresa, `unset` en cuanto se
  # entrega al proceso Node por stdin) y en la memoria de ese proceso
  # Node — el propio helper aplica el contrato cerrado de valores
  # secretos antes de intentar conectar.
  local old_redis_pw
  if old_redis_pw="$(recover_old_secret_value S5 REDIS_PASSWORD)"; then
    local redis_port old_redis_ok=false redis_check
    redis_port="$(field_from_secrets_file REDIS_HOST_PORT)"; redis_port="${redis_port:-6380}"
    redis_check="$(printf '{"host":"127.0.0.1","port":%s}\n%s' "$redis_port" "$old_redis_pw" | node "$SCRIPT_DIR/lib/redisVerify.mjs" 2>/dev/null || true)"
    unset old_redis_pw
    [ "$redis_check" = true ] && old_redis_ok=true
    if [ "$old_redis_ok" = true ]; then
      say "  FALLO: la contraseña ANTERIOR de Redis todavía autentica."
      checks_ok=false
    else
      say "  OK — contraseña anterior de Redis rechazada."
    fi
  else
    say "  AVISO: no se pudo recuperar la contraseña anterior de Redis desde el backup — no se puede demostrar su invalidación. S9 quedará bloqueada."
    checks_ok=false
  fi

  say "Comprobando ESPO_BOOKING_ADAPTER (debe ser 'simulated')..."
  local adapter
  adapter="$(field_from_secrets_file ESPO_BOOKING_ADAPTER)"
  say "  ESPO_BOOKING_ADAPTER=$adapter"
  if [ "$adapter" != "simulated" ]; then
    say "  FALLO: ESPO_BOOKING_ADAPTER != 'simulated' — S9 rechaza cerrar la rotación en modo 'http' sin verificación humana explícita fuera de este script."
    checks_ok=false
  fi

  say "Comprobando que ninguna versión comprometida sigue en el archivo externo (S7 debe haberlas retirado — ya lo exige S7=done)..."
  local leftover_versions
  leftover_versions="$(python3 - "$SECRETS_FILE" <<'PYEOF'
import sys, json
target = sys.argv[1]
with open(target, "r", encoding="utf-8") as f:
    lines = f.readlines()
leftover_all = []
for prefix in ("BOOKING_FIELD_ENCRYPTION_KEYS=", "BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS=", "BOOKING_EMAIL_LOOKUP_HMAC_SECRETS=", "BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS="):
    for line in lines:
        if line.startswith(prefix):
            m = json.loads(line.rstrip("\n").split("=", 1)[1])
            leftover_all.extend([f"{prefix}{v}" for v in m if v in ("v1", "v2")])
print(",".join(leftover_all))
PYEOF
)"
  if [ -n "$leftover_versions" ]; then
    say "  FALLO: quedan versiones comprometidas en el archivo externo: $leftover_versions — S9 rechaza cerrar (S7 debería haber quedado 'blocked', no 'done')."
    checks_ok=false
  else
    say "  OK — ninguna versión comprometida (v1/v2) en ningún mapa de booking."
  fi

  if [ "$checks_ok" != true ]; then
    gapssa_secrets_shred "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    leave_gate_failed "S9" "una o más comprobaciones automáticas fallaron — revisa los FALLO/AVISO de arriba antes de repetir S9."
    return 1
  fi

  # --- cuarentena de .env* ANTES de cualquier arranque probatorio — nunca
  # arrancar Next mientras el .env comprometido siga en el workspace ---
  say ""
  say "Poniendo en cuarentena TODOS los .env* reales del workspace (excepto .env.example) ANTES de"
  say "arrancar apps/web — la única prueba válida es arrancar desde cero SIN ellos presentes."
  local quarantine_map
  quarantine_map="$(_quarantine_all_env_files)"

  # Bloque 6 (bug real, detectado por
  # tests/s9_env_example_failure_rehearsal.py): esta función DEBE quedar
  # definida aquí, antes de su primer uso posible (el fallo de
  # `.env.example` más abajo, la primera de las 5 rutas de fallo de esta
  # puerta que la invoca) — definirla más tarde en el cuerpo de la
  # función (como estaba antes) significa que esa primera ruta de fallo
  # la llama ANTES de que exista: bajo `set -e`, invocar una función
  # dentro de un cuerpo que a su vez se invocó como condición de un `if`
  # (`if ! "gate_${gate}"; then` en main()) NO aborta el script — "command
  # not found" se limita a imprimirse y la ejecución sigue con la
  # siguiente línea, así que `leave_gate_failed`/`return 1` seguían
  # ocurriendo correctamente (S9 fallaba bien) pero la restauración real
  # del `.env*` desde cuarentena, pese al mensaje que la prometía, nunca
  # llegaba a ejecutarse en ese camino concreto.
  restore_env_files_from_quarantine() {
    printf '%s\n' "$quarantine_map" | while IFS=$'\t' read -r orig dest; do
      [ -n "$orig" ] || continue
      mv "$dest" "$orig"
    done
  }

  if [ -n "$quarantine_map" ]; then
    say "  Movidos a cuarentena:"
    printf '%s\n' "$quarantine_map" | while IFS=$'\t' read -r orig dest; do
      say "    $orig -> $dest"
    done
  else
    say "  (no había ningún .env* real que retirar — ya estaba fuera del workspace)"
  fi
  local stray
  stray="$(find "$REPO_ROOT" "$REPO_ROOT/apps/web" -maxdepth 1 -name '.env*' ! -name '.env.example' 2>/dev/null || true)"
  if [ -n "$stray" ]; then
    say "  FALLO: sigue habiendo .env* real en el workspace tras la cuarentena: $stray"
    gapssa_secrets_shred "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    leave_gate_failed "S9" "la cuarentena de .env* no dejó el workspace limpio."
    return 1
  fi
  say "  OK — cero .env* real (aparte de .env.example) dentro del workspace."

  say "Verificando .env.example (parser Node seguro, nunca grep/cat — solo variables sensibles deben ser placeholder)..."
  local example_check example_ok
  example_check="$(node "$SCRIPT_DIR/lib/verifyEnvExample.mjs" "$REPO_ROOT/.env.example" 2>&1)" && example_ok=true || example_ok=false
  say "  $example_check"
  if [ "$example_ok" != true ]; then
    # Bug real (Bloque 6, revisión del informe saneado): antes de esta
    # corrección, este fallo solo ponía `checks_ok=false` pero esa
    # variable nunca se volvía a comprobar -- S9 podía seguir adelante,
    # arrancar apps/web, escribir el informe y llamar a
    # `leave_gate_done "S9"` con normalidad pese a que .env.example NO
    # había pasado la verificación de placeholders. Ahora falla cerrado
    # de inmediato, igual que el resto de comprobaciones de esta puerta,
    # restaurando primero el .env* real desde cuarentena (ya se puso en
    # cuarentena unas líneas arriba, antes de esta verificación).
    say "  FALLO: la verificación de .env.example no pasó — revisa el mensaje de arriba. S9 bloqueada."
    restore_env_files_from_quarantine
    gapssa_secrets_shred "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    leave_gate_failed "S9" "la verificación de .env.example (placeholders) falló — .env* restaurado desde cuarentena."
    return 1
  fi

  # --- arranque ÚNICO, ya sin .env* real en el workspace ---
  local pid_file="$SECRETS_DIR/apps-web.pid" log_file="$SECRETS_DIR/apps-web.log"
  : >"$log_file"
  chmod 600 "$log_file"

  say ""
  say "Arrancando apps/web desde cero, EXCLUSIVAMENTE desde el almacén externo (comando único, sin pedirte abrir otra pestaña)..."
  local start_json
  if ! start_json="$(node "$SCRIPT_DIR/start-apps-web.mjs" start "$REPO_ROOT" "$SECRETS_FILE" "$pid_file" "$log_file")"; then
    say "  FALLO al arrancar apps/web."
    restore_env_files_from_quarantine
    gapssa_secrets_shred "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    leave_gate_failed "S9" "no se pudo arrancar apps/web — .env* restaurado desde cuarentena."
    return 1
  fi
  say "  $start_json"

  # Bloque 6 — el puerto SIEMPRE se deriva de lo que start-apps-web.mjs
  # reportó realmente (campo "port" del propio start_json — 3000 en uso
  # real sin cambios, o el puerto efímero que GAPSSA_APPS_WEB_PORT haya
  # resuelto en el ensayo desechable) — NUNCA un "localhost:3000"
  # hardcodeado en este camino, para que un servicio ajeno que por
  # casualidad ocupe el 3000 no pueda producir un falso positivo ni un
  # falso "puerto ocupado" cuando el ensayo corre en otro puerto.
  local health_port
  health_port="$(gapssa_health_port_from_start_json "$start_json")"

  say "Verificando http://localhost:${health_port}/api/health (reintentando, acotado)..."
  local health_ok=false attempt apps_web_pid
  apps_web_pid="$(cat "$pid_file" 2>/dev/null || true)"
  for attempt in $(seq 1 12); do
    # Bloque 6 — tres hallazgos reales corregidos aquí:
    #  1) sin --max-time, un solo intento contra un servidor que acepta la
    #     conexión pero nunca completa la respuesta cuelga ESTE curl
    #     indefinidamente, convirtiendo el presupuesto documentado en un
    #     cuelgue sin límite real — confirmado con un ensayo integral real
    #     que se quedó parado aquí más de 20 minutos.
    #  2) el proceso de apps/web lanzado por ESTA puerta debe seguir vivo
    #     y ser el propietario del puerto ANTES de aceptar el health — si
    #     murió, falla de inmediato aunque algún otro servicio ajeno
    #     responda igual en ese mismo puerto (nunca un falso positivo).
    #  3) --max-time 5 resultó DEMASIADO ajustado: en el primerísimo
    #     arranque contra una base de datos recién creada, el propio
    #     /api/health puede disparar el auto-push de esquema de Payload
    #     (esperado solo la primera vez; un sistema ya migrado responde
    #     en milisegundos) y tardar justo alrededor de 5.0s en responder
    #     con éxito (200) — confirmado en el log real de apps/web,
    #     "GET /api/health 200 in 5.0s" repetido — cortando el intento
    #     justo antes de que complete. Margen amplio (15s) para no volver
    #     a cortar una respuesta que de verdad iba a tener éxito.
    if [ "$(gapssa_pid_alive "$apps_web_pid")" != true ]; then
      say "  FALLO — el proceso de apps/web (PID $apps_web_pid) ya no existe."
      break
    fi
    if curl -fsS --max-time 15 -o /dev/null "http://localhost:${health_port}/api/health" 2>/dev/null; then
      health_ok=true
      break
    fi
    sleep 5
  done

  if [ "$health_ok" != true ]; then
    say "  FALLO — /api/health no respondió (o el proceso murió) dentro del plazo. Deteniendo el proceso y restaurando .env* desde cuarentena..."
    node "$SCRIPT_DIR/start-apps-web.mjs" stop "$pid_file" >/dev/null 2>&1 || true
    restore_env_files_from_quarantine
    gapssa_secrets_shred "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    leave_gate_failed "S9" "apps/web no arrancó correctamente sin .env* — .env* restaurado desde cuarentena, revisa $log_file."
    return 1
  fi
  say "  OK — /api/health responde, arrancado exclusivamente desde el almacén externo."

  say "Escaneando el log de apps/web en busca de cualquier secreto filtrado (escaneo en proceso, nunca grep con el valor como patrón)..."
  local scan_ok=true
  local scan_json
  scan_json="$(node "$SCRIPT_DIR/start-apps-web.mjs" scan-log-for-secrets "$SECRETS_FILE" "$log_file")" || scan_ok=false
  say "  $scan_json"
  if [ "$scan_ok" != true ]; then
    say "  FALLO: al menos un secreto apareció en el log de apps/web."
    node "$SCRIPT_DIR/start-apps-web.mjs" stop "$pid_file" >/dev/null 2>&1 || true
    restore_env_files_from_quarantine
    gapssa_secrets_shred "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    leave_gate_failed "S9" "fuga de secreto detectada en el log de apps/web — .env* restaurado desde cuarentena."
    return 1
  fi

  say "Ejecutando verificación dinámica de S6 (OTP/rate-limit reales, JWT de Payload)..."
  if ! run_s6_dynamic_verification; then
    say "  AVISO: la verificación dinámica de S6 no pasó — S6 permanece 'prepared', S9 no puede darse por completa."
    node "$SCRIPT_DIR/start-apps-web.mjs" stop "$pid_file" >/dev/null 2>&1 || true
    restore_env_files_from_quarantine
    gapssa_secrets_shred "$curl_admin_cfg"
    gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"
    leave_gate_failed "S9" "S6 no se pudo promover a 'done' — .env* restaurado desde cuarentena."
    return 1
  fi

  gapssa_secrets_shred "$curl_admin_cfg"
  gapssa_cleanup_pop_matching shred_plain "$curl_admin_cfg"

  say ""
  say "Todas las comprobaciones estrictas pasaron. .env* permanece en cuarentena (nunca vuelve al workspace)."
  local keep_running=false
  if ask_yes_no "¿Dejar apps/web funcionando (arrancado exclusivamente desde el almacén externo)? Si respondes 'no', se detiene ahora mismo."; then
    keep_running=true
    say "apps/web sigue funcionando — PID en $pid_file, log en $log_file. Detenlo tú mismo cuando quieras: node '$SCRIPT_DIR/start-apps-web.mjs' stop '$pid_file'."
  else
    node "$SCRIPT_DIR/start-apps-web.mjs" stop "$pid_file" >/dev/null 2>&1 || true
    say "apps/web detenido."
  fi

  leave_gate_done "S9"

  # --- material de rollback cifrado pendiente — nunca confundido con
  # secreto activo, nunca sin política de conservación/destrucción ---
  local rollback_material
  rollback_material="$(ls -1 "$BACKUP_DIR"/*.env.gapssa.enc 2>/dev/null || true)"

  mkdir -p "$SECRETS_DIR"

  # --- Bloque 6 (corrección de colisiones): reserva atómica del nombre
  #     del informe final — nunca "comprobar existencia y escribir
  #     después". El nombre incluye SIEMPRE $RUN_ID (generado una única
  #     vez al arrancar el script) además del timestamp. ---
  _report_reserve_candidate() {
    printf 'rotation-report-%s-%s.txt' "$(date -u +%Y%m%dT%H%M%SZ)" "$RUN_ID"
  }
  local report_reserve_lines report_reserve_rc
  report_reserve_lines="$(gapssa_secrets_reserve_with_retry "$SECRETS_DIR" _report_reserve_candidate 8)"
  report_reserve_rc=$?
  unset -f _report_reserve_candidate
  if [ "$report_reserve_rc" != 0 ]; then
    leave_gate_failed "S9" "no se pudo reservar atómicamente el nombre del informe final — ningún informe preexistente fue tocado ni adoptado."
    return 1
  fi
  local report_out report_dir report_dev report_ino report_uid report_mode
  { read -r report_out; read -r report_dir; read -r report_dev report_ino report_uid report_mode; } <<<"$report_reserve_lines"
  REPORT_FILE="$report_out"
  _report_reserved_cleanup() {
    if gapssa_secrets_verify_pinned_tmp "$report_out" "$report_dir" "$report_dev" "$report_ino" "$report_uid" "$report_mode"; then
      rm -f -- "$report_out"
    else
      say "AVISO: '$report_out' cambió de identidad tras reservarlo — limpieza automática omitida por seguridad."
    fi
  }

  # Temporal seguro EN EL MISMO DIRECTORIO (imprescindible para que el
  # rename posterior sea atómico), fijado y reverificado antes de
  # escribir — mismo patrón ya usado por la restauración de S2-S5.
  local report_pin_lines
  if ! report_pin_lines="$(gapssa_secrets_mktemp_secure_same_dir "$REPORT_FILE" report)"; then
    _report_reserved_cleanup
    unset -f _report_reserved_cleanup
    leave_gate_failed "S9" "no se pudo crear el temporal seguro del informe final."
    return 1
  fi
  local report_tmp report_tmp_dir report_tmp_dev report_tmp_ino report_tmp_uid report_tmp_mode
  { read -r report_tmp; read -r report_tmp_dir; read -r report_tmp_dev report_tmp_ino report_tmp_uid report_tmp_mode; } <<<"$report_pin_lines"
  if ! gapssa_secrets_verify_pinned_tmp "$report_tmp" "$report_tmp_dir" "$report_tmp_dev" "$report_tmp_ino" "$report_tmp_uid" "$report_tmp_mode"; then
    rm -f -- "$report_tmp" 2>/dev/null || true
    _report_reserved_cleanup
    unset -f _report_reserved_cleanup
    leave_gate_failed "S9" "el temporal del informe final no pasó su propia verificación de identidad."
    return 1
  fi

  {
    echo "Informe de rotación GAPSSA — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "run_id=$RUN_ID"
    echo "Cero valores, cero DSN, cero fragmentos incluidos en este informe."
    echo ""
    echo "Puertas:"
    local rg
    for rg in S1 S2 S3 S4 S5 S6 S7 S8 S9; do
      echo "  $rg: $(state_get "$rg")"
    done
    echo ""
    echo "secretos_antiguos_requeridos_por_config=false"
    echo "secretos_antiguos_requeridos_por_datos=false"
    echo "secrets_in_workspace=0"
    echo "adapter_simulated=true"
    echo "acl_closed=true"
    echo "services_healthy=true"
    echo "apps_web_dejado_funcionando=$keep_running"
    echo "rollback_required=false"
    echo ""
    if [ -n "$rollback_material" ]; then
      echo "material_de_rollback_cifrado_pendiente_de_purga:"
      printf '%s\n' "$rollback_material" | while read -r f; do echo "  - $f"; done
      echo "  politica: se destruye solo si el operador lo confirma explícitamente (rm manual);"
      echo "            en caso contrario permanece cifrado, sin su clave en disco en ningún momento"
      echo "            (la frase de recuperación de esta sesión vivió solo en memoria del proceso)."
      echo "claves_de_recuperacion_en_disco=false"
    else
      echo "material_de_rollback_cifrado_pendiente_de_purga: ninguno"
    fi
  } >"$report_tmp"
  chmod 600 "$report_tmp"

  if ! node "$SCRIPT_DIR/lib/fsyncPath.mjs" file "$report_tmp"; then
    rm -f -- "$report_tmp" 2>/dev/null || true
    _report_reserved_cleanup
    unset -f _report_reserved_cleanup
    leave_gate_failed "S9" "no se pudo hacer fsync del informe final antes de publicarlo."
    return 1
  fi

  if ! gapssa_secrets_verify_pinned_tmp "$report_tmp" "$report_tmp_dir" "$report_tmp_dev" "$report_tmp_ino" "$report_tmp_uid" "$report_tmp_mode"; then
    rm -f -- "$report_tmp" 2>/dev/null || true
    _report_reserved_cleanup
    unset -f _report_reserved_cleanup
    leave_gate_failed "S9" "el temporal del informe final cambió de identidad justo antes de publicarlo."
    return 1
  fi
  if ! gapssa_secrets_verify_pinned_tmp "$report_out" "$report_dir" "$report_dev" "$report_ino" "$report_uid" "$report_mode"; then
    rm -f -- "$report_tmp" 2>/dev/null || true
    leave_gate_failed "S9" "'$report_out' cambió de identidad entre su reserva y la publicación — nunca se sobrescribe."
    return 1
  fi

  # Rename atómico (mismo directorio/filesystem) + fsync del directorio
  # (mejor esfuerzo — ver comentario de fsyncPath.mjs sobre APFS).
  mv -f -- "$report_tmp" "$report_out"
  node "$SCRIPT_DIR/lib/fsyncPath.mjs" dir "$report_dir" >/dev/null 2>&1 || say "AVISO: fsync del directorio del informe no disponible en esta plataforma (mejor esfuerzo)."
  unset -f _report_reserved_cleanup

  # Verificación final CONTRACTUAL: exactamente UN informe asociado al
  # run_id actual — nunca cero, nunca más de uno, nunca "el más
  # reciente por fecha".
  # Bloque 6 (bug real detectado por el capstone S1->S9): compara
  # IDENTIDAD de fichero (`-ef`, mismo dispositivo+inodo), nunca
  # igualdad de CADENA de ruta -- `$SECRETS_DIR` (definido arriba desde
  # `$HOME`, sin canonicalizar) y `$report_out` (canonicalizado con
  # `pwd -P` dentro de gapssa_secrets_reserve_exclusive_path) pueden
  # referirse al MISMO fichero real con dos cadenas distintas en
  # cualquier sistema donde `$HOME` atraviese un symlink (p. ej. macOS,
  # `/var` -> `/private/var`) -- una comparación de cadenas marcaba
  # entonces S9 como fallida pese a que el informe se había escrito y
  # verificado correctamente.
  local report_confirmed
  if ! report_confirmed="$(gapssa_secrets_find_report_for_run_id "$SECRETS_DIR" "$RUN_ID")" || [ ! "$report_confirmed" -ef "$report_out" ]; then
    leave_gate_failed "S9" "la verificación final del informe (exactamente uno para run_id=$RUN_ID) falló."
    return 1
  fi

  say ""
  say "Informe sanitizado: $REPORT_FILE"

  say ""
  say "Rotación global terminada. No pegues nunca el contenido de $SECRETS_FILE en"
  say "Claude Code — solo el informe sanitizado o descripciones en palabras. Para"
  say "continuar con otro trabajo (por ejemplo 5B-2B), abre una tarea nueva."
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------
# Resumen saneado de cierre de dry-run — nunca puede confundirse con un
# informe de rotación real: cada línea lleva su propio calificador
# ("simulated_*") y los contadores de actividad real son literales fijos
# (0/false), nunca derivados de nada que este proceso haya tocado, porque
# por diseño no ha tocado nada real. Recorre el estado VIRTUAL (nunca
# $STATUS_FILE real) vía state_get, que en --dry-run ya sirve
# exclusivamente ese estado virtual.
gapssa_dry_print_summary() {
  local gate st all_done=true pending_list=""
  divider
  say "RESUMEN DRY-RUN (saneado — ninguna línea de aquí abajo describe una ejecución real)"
  say "dry_run=true"
  for gate in S1 S2 S3 S4 S5 S6 S7 S8 S9; do
    st="$(state_get "$gate")"
    if [ "$st" = done ]; then
      say "${gate}=simulated_ok"
    else
      say "${gate}=simulated_${st}"
      all_done=false
      pending_list="${pending_list}${pending_list:+, }${gate} (estado simulado: ${st})"
    fi
  done
  say "real_writes=0"
  say "real_services_touched=0"
  say "real_secrets_generated=0"
  say "real_secrets_read=0"
  say "external_store_created=false"
  if [ "$all_done" = true ]; then
    say "ready_for_real_run=true"
    say "precondiciones_reales_pendientes=ninguna detectada por este dry-run (repítelo sin --dry-run para verificar credenciales/servicios reales — este resumen nunca los sustituye)"
  else
    say "ready_for_real_run=false"
    say "precondiciones_reales_pendientes=${pending_list}"
  fi
  divider
}

main() {
  divider
  say "Asistente de rotación global de secretos — GAPSSA (v3)"
  say "Almacén externo: $SECRETS_DIR"
  if [ "$DRY_RUN" = true ]; then
    say "MODO DRY-RUN: no se escribirá ni ejecutará nada real."
  fi
  divider
  gapssa_secrets_require_interactive_confirmation

  # Bloqueo de concurrencia (Bloque 6, B6-7) -- nunca dos sesiones a la vez
  # contra el mismo almacén externo. Aborta ANTES de tocar ninguna puerta
  # si otra sesión viva ya lo tiene; recupera automáticamente un bloqueo
  # huérfano (dueño ya no vivo). NUNCA en --dry-run: dry-run no escribe
  # nada real por diseño (cada puerta comprueba $DRY_RUN antes de
  # `state_set`), así que no hay nada que serializar -- y crear/borrar el
  # propio directorio de lock dentro de $SECRETS_DIR cambia su mtime,
  # rompiendo la garantía ya probada de "--dry-run nunca modifica el
  # almacén externo" (bug real, detectado por
  # tests/run_scenarios.py::scenario_dry_run_identity_s2).
  if [ "$DRY_RUN" != true ]; then
    if ! gapssa_secrets_lock_acquire "$SECRETS_DIR"; then
      exit 1
    fi
  fi

  if [ -n "$ONLY_GATE" ]; then
    if ! declare -F "gate_${ONLY_GATE}" >/dev/null; then
      echo "ERROR: puerta desconocida '--only ${ONLY_GATE}'. Usa S1..S9." >&2
      exit 1
    fi
    "gate_${ONLY_GATE}"
    if [ "$DRY_RUN" = true ]; then
      gapssa_dry_print_summary
    fi
    divider
    say "Fin (puerta única)."
    exit 0
  fi

  local gate
  for gate in s1 s2 s3 s4 s5 s6 s7 s8 s9; do
    if ! "gate_${gate}"; then
      say "Puerta '$gate' interrumpida, bloqueada o con error."
      if ! ask_yes_no "¿Continuar con las siguientes puertas de todas formas?"; then
        say "Deteniendo el asistente por decisión tuya. Vuelve a ejecutarlo cuando quieras — retoma desde donde falta."
        exit 1
      fi
    fi
  done

  if [ "$DRY_RUN" = true ]; then
    gapssa_dry_print_summary
  fi

  divider
  say "Fin del asistente de rotación."
}

main
