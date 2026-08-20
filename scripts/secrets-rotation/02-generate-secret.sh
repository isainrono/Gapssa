#!/usr/bin/env bash
# Genera un secreto CSPRNG nuevo y lo escribe DIRECTAMENTE en el archivo
# externo indicado — nunca lo imprime, nunca lo devuelve por stdout, nunca
# lo deja en una variable de shell más tiempo del necesario para escribirlo.
#
# Dos modos:
#
#   --set-line VAR_NAME [--bytes N] [--format hex|base64]
#     Escribe/reemplaza una línea "VAR_NAME=<valor nuevo>" completa en el
#     archivo destino. Para secretos NO versionados (ej. PAYLOAD_SECRET,
#     REDIS_PASSWORD, BOOKING_INTERNAL_API_SECRET).
#
#   --set-json-map VAR_NAME VERSION_KEY [--bytes N] [--format hex|base64]
#     Añade {"VERSION_KEY": "<valor nuevo>"} al mapa JSON ya existente en
#     esa variable dentro del archivo destino (preserva las versiones que
#     ya estén ahí) — para secretos versionados (BOOKING_FIELD_ENCRYPTION_KEYS,
#     BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS). Si la variable no existe
#     todavía en el archivo, crea el mapa con esa única versión.
#
# Uso:
#   ./02-generate-secret.sh <archivo-externo> --set-line VAR_NAME [--dry-run]
#   ./02-generate-secret.sh <archivo-externo> --set-json-map VAR_NAME VERSION [--dry-run]
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
  02-generate-secret.sh <archivo-externo> --set-line VAR_NAME [--bytes N] [--format hex|base64] [--dry-run]
  02-generate-secret.sh <archivo-externo> --set-json-map VAR_NAME VERSION_KEY [--bytes N] [--format hex|base64] [--dry-run]
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
VERSION_KEY=""

case "$MODE" in
--set-line)
  VAR_NAME="$1"
  shift
  ;;
--set-json-map)
  VAR_NAME="$1"
  VERSION_KEY="$2"
  shift 2
  ;;
*)
  echo "ERROR: modo desconocido '$MODE' (usa --set-line o --set-json-map)." >&2
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

echo "mode=$MODE"
echo "var_name=$VAR_NAME"
if [ -n "$VERSION_KEY" ]; then
  echo "version_key=$VERSION_KEY"
fi
echo "bytes=$BYTES"
echo "format=$FORMAT"
echo "dry_run=$DRY_RUN"

if [ "$DRY_RUN" = true ]; then
  echo "would_write_to=$TARGET_FILE"
  echo "S_DRY_RUN_OK=true"
  exit 0
fi

# El valor nunca sale de este subshell salvo para escribirse en el archivo
# destino — nunca a stdout, nunca a una variable exportada, nunca a un log.
python3 - "$TARGET_FILE" "$MODE" "$VAR_NAME" "$VERSION_KEY" "$BYTES" "$FORMAT" <<'PYEOF'
import sys, os, re, json, secrets, base64

target_file, mode, var_name, version_key, bytes_n, fmt = sys.argv[1:7]
bytes_n = int(bytes_n)

raw = secrets.token_bytes(bytes_n)
if fmt == "hex":
    value = raw.hex()
elif fmt == "base64":
    value = base64.b64encode(raw).decode("ascii")
else:
    print(f"ERROR: formato desconocido '{fmt}'", file=sys.stderr)
    sys.exit(1)

with open(target_file, "r", encoding="utf-8") as f:
    lines = f.readlines()

idx = None
for i, line in enumerate(lines):
    if re.match(rf"^{re.escape(var_name)}=", line):
        idx = i
        break

if mode == "--set-line":
    new_line = f"{var_name}={value}\n"
    if idx is None:
        lines.append(new_line)
    else:
        lines[idx] = new_line
elif mode == "--set-json-map":
    if idx is None:
        current_map = {}
    else:
        existing_value = lines[idx].rstrip("\n")[len(var_name) + 1:]
        current_map = json.loads(existing_value) if existing_value else {}
    current_map[version_key] = value
    new_line = f"{var_name}={json.dumps(current_map, separators=(',', ':'))}\n"
    if idx is None:
        lines.append(new_line)
    else:
        lines[idx] = new_line
else:
    print(f"ERROR: modo desconocido '{mode}'", file=sys.stderr)
    sys.exit(1)

fd = os.open(target_file, os.O_WRONLY | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as f:
    f.writelines(lines)

value = None
raw = None
print("write_completed=true")
PYEOF

echo "S_WRITE_OK=true"
