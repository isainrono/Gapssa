#!/usr/bin/env bash
# Genera un secreto CSPRNG nuevo y lo escribe DIRECTAMENTE en el archivo
# externo indicado — nunca lo imprime, nunca lo devuelve por stdout, nunca
# lo deja en una variable de shell (el propio valor nunca sale del proceso
# Node que lo genera Y lo escribe — ver lib/atomicSecretsFileMutate.mjs).
#
#   --set-line VAR_NAME [--bytes N] [--format hex|base64]
#     Genera un valor nuevo y sustituye la línea "VAR_NAME=..." COMPLETA
#     en el archivo destino — <VAR_NAME> debe existir ya (nunca añade una
#     clave nueva). Para secretos NO versionados (ej. PAYLOAD_SECRET,
#     REDIS_PASSWORD, BOOKING_INTERNAL_API_SECRET).
#
# Bloque 9 (S7 atómico y reanudable): la escritura ya NUNCA usa
# `os.open(..., O_TRUNC)` — delega en lib/atomicSecretsFileMutate.mjs
# (temporal FIJADO en el mismo directorio, O_NOFOLLOW + fstat contra el
# pin, fsync, revalidación, rename atómico, fsync de directorio,
# relectura completa) exactamente igual que updateSecretsFileField.mjs.
# El modo `--set-json-map` (añadir una versión nueva a un mapa JSON
# versionado) se retiró de este script: su único llamador real
# (gate_s7(), rotate-all-interactive.sh) ahora invoca
# lib/atomicSecretsFileMutate.mjs directamente para añadir v3 a los
# CUATRO mapas de booking en una única reescritura atómica (ver su
# comentario de cabecera) — necesita esa idempotencia de "nunca
# regenerar una versión que ya existe" para poder reanudarse tras una
# interrupción sin huérfanos, algo que este script de un solo campo no
# necesitaba resolver antes.
#
# Uso:
#   ./02-generate-secret.sh <archivo-externo> --set-line VAR_NAME --schema-version <versión> [--bytes N] [--format hex|base64] [--dry-run]
#
# <versión> es SIEMPRE explícita (una de lib/backupSchema.mjs::KNOWN_SCHEMA_VERSIONS)
# — el llamador en bash SIEMPRE debe derivarla de current_secrets_schema_version(),
# igual que el resto de escritores atómicos de este directorio (nunca se
# asume "active" a ciegas: S2/S3/S4/S6 pueden ejecutarse antes de que S7
# haya migrado el archivo al esquema versionado).
#
# AES-256-GCM (BOOKING_FIELD_ENCRYPTION_KEYS) requiere exactamente 32 bytes
# — usa --bytes 32 --format base64 para esa variable.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

if [ "$#" -lt 3 ]; then
  cat >&2 <<'EOF'
Uso:
  02-generate-secret.sh <archivo-externo> --set-line VAR_NAME --schema-version <versión> [--bytes N] [--format hex|base64] [--dry-run]
EOF
  exit 1
fi

TARGET_FILE="$1"
shift
MODE="$1"
shift

BYTES=32
FORMAT="base64"
DRY_RUN=false
VAR_NAME=""
SCHEMA_VERSION=""

case "$MODE" in
--set-line)
  VAR_NAME="$1"
  shift
  ;;
*)
  echo "ERROR: modo desconocido '$MODE' (solo se admite --set-line)." >&2
  exit 1
  ;;
esac

while [ "$#" -gt 0 ]; do
  case "$1" in
  --bytes)
    BYTES="$2"
    shift 2
    ;;
  --format)
    FORMAT="$2"
    shift 2
    ;;
  --schema-version)
    SCHEMA_VERSION="$2"
    shift 2
    ;;
  --dry-run)
    DRY_RUN=true
    shift
    ;;
  *)
    echo "ERROR: argumento desconocido '$1'." >&2
    exit 1
    ;;
  esac
done

gapssa_secrets_abort_if_inside_workspace "$TARGET_FILE"
gapssa_secrets_require_interactive_confirmation

# Corrección "dry-run fresco S1->S9": --dry-run debe cortar ANTES de
# cualquier comprobación física sobre $TARGET_FILE (existencia, modo) —
# antes de esta corrección, un $TARGET_FILE inexistente (el caso normal
# de un almacén externo que ningún S1 real ha creado todavía) hacía
# abortar con un error físico incluso pasando --dry-run, porque la
# comprobación `-f` corría antes de mirar $DRY_RUN. La puerta que invoca
# este script decide su propia precondición virtual (ver
# require_secrets_file en rotate-all-interactive.sh) — este script nunca
# debe imponer una física adicional en modo simulado.
echo "mode=$MODE"
echo "var_name=$VAR_NAME"
echo "bytes=$BYTES"
echo "format=$FORMAT"
echo "dry_run=$DRY_RUN"

if [ "$DRY_RUN" = true ]; then
  echo "would_write_to=$TARGET_FILE"
  echo "S_DRY_RUN_OK=true"
  exit 0
fi

if [ -z "$SCHEMA_VERSION" ]; then
  echo "ERROR: falta --schema-version (nunca se asume 'active' a ciegas)." >&2
  exit 1
fi

if [ ! -f "$TARGET_FILE" ]; then
  echo "ERROR: '$TARGET_FILE' no existe todavía — ejecuta 01-init-external-store.sh primero" >&2
  echo "       y crea el archivo vacío con modo 600 antes de generar secretos." >&2
  exit 1
fi

file_mode_ok="$(gapssa_secrets_check_file_mode "$TARGET_FILE")"
echo "target_file_mode_600=$file_mode_ok"
if [ "$file_mode_ok" != "true" ]; then
  echo "ERROR: '$TARGET_FILE' no tiene modo 600 — corrígelo (chmod 600) antes de continuar." >&2
  exit 1
fi

pin_lines="$(gapssa_secrets_mktemp_secure_same_dir "$TARGET_FILE" gensecret)"
tmp_path="$(printf '%s\n' "$pin_lines" | sed -n '1p')"
tmp_dir="$(printf '%s\n' "$pin_lines" | sed -n '2p')"
tmp_stat="$(printf '%s\n' "$pin_lines" | sed -n '3p')"
tmp_dev="$(printf '%s\n' "$tmp_stat" | awk '{print $1}')"
tmp_ino="$(printf '%s\n' "$tmp_stat" | awk '{print $2}')"
tmp_uid="$(printf '%s\n' "$tmp_stat" | awk '{print $3}')"
tmp_mode="$(printf '%s\n' "$tmp_stat" | awk '{print $4}')"

if ! gapssa_secrets_verify_pinned_tmp "$tmp_path" "$tmp_dir" "$tmp_dev" "$tmp_ino" "$tmp_uid" "$tmp_mode"; then
  echo "ERROR: el temporal recién creado ya no coincide con su propio pin — abortado." >&2
  rm -f -- "$tmp_path" 2>/dev/null || true
  exit 1
fi

# VAR_NAME/BYTES/FORMAT se validan aquí ANTES de interpolarlos en JSON a
# mano (nunca llevan comillas/backslash — alfabeto cerrado comprobado
# explícitamente, así que no hace falta un escapador JSON genérico) —
# atomicSecretsFileMutate.mjs vuelve a validarlos de forma estricta antes
# de aplicarlos, esto es solo para construir un documento bien formado.
if ! [[ "$VAR_NAME" =~ ^[A-Z_][A-Z0-9_]*$ ]]; then
  rm -f -- "$tmp_path" 2>/dev/null || true
  echo "ERROR: VAR_NAME '$VAR_NAME' no tiene forma MAYUSCULA_CON_GUIONES_BAJOS." >&2
  exit 1
fi
if ! [[ "$BYTES" =~ ^[0-9]+$ ]]; then
  rm -f -- "$tmp_path" 2>/dev/null || true
  echo "ERROR: --bytes '$BYTES' no es un entero." >&2
  exit 1
fi
case "$FORMAT" in
hex | base64) ;;
*)
  rm -f -- "$tmp_path" 2>/dev/null || true
  echo "ERROR: --format '$FORMAT' desconocido (usa hex o base64)." >&2
  exit 1
  ;;
esac

mutations_json="$(printf '[{"op":"set-line-generate","key":"%s","bytes":%s,"format":"%s"}]' "$VAR_NAME" "$BYTES" "$FORMAT")"

write_rc=0
write_summary="$(printf '%s' "$mutations_json" | node "$SCRIPT_DIR/lib/atomicSecretsFileMutate.mjs" "$TARGET_FILE" "$tmp_path" "$tmp_dev" "$tmp_ino" "$tmp_uid" "$tmp_mode" "$SCHEMA_VERSION")" || write_rc=$?

if [ "$write_rc" -eq 20 ]; then
  # No-op (nunca debería ocurrir para --set-line-generate, que siempre
  # cambia el valor — ver comentario de cabecera de
  # atomicSecretsFileMutate.mjs; se trata igual que un caso real por si
  # acaso) — el temporal nunca se consumió, hay que limpiarlo.
  rm -f -- "$tmp_path" 2>/dev/null || true
  echo "ERROR: la escritura no cambió nada (inesperado para --set-line, que siempre rota el valor)." >&2
  exit 1
fi
if [ "$write_rc" -ne 0 ]; then
  rm -f -- "$tmp_path" 2>/dev/null || true
  echo "ERROR: no se pudo escribir '$VAR_NAME' de forma atómica (código $write_rc)." >&2
  exit 1
fi

echo "write_summary=$write_summary"
echo "S_WRITE_OK=true"
