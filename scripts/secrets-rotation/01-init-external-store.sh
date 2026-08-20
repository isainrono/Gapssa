#!/usr/bin/env bash
# Puerta S1 — crea el almacén externo de secretos (directorio, modo 700).
# NUNCA escribe ningún valor secreto — solo prepara la estructura vacía.
#
# Uso:
#   ./01-init-external-store.sh <ruta-externa> [--dry-run]
#
# Ejemplo:
#   ./01-init-external-store.sh "$HOME/.gapssa-secrets"
#
# Ver docs/runbook-rotacion-secretos-externa.md antes de ejecutar.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

if [ "$#" -lt 1 ]; then
  echo "Uso: $0 <ruta-externa> [--dry-run]" >&2
  exit 1
fi

TARGET_DIR="$1"
DRY_RUN=false
if [ "${2:-}" = "--dry-run" ]; then
  DRY_RUN=true
fi

gapssa_secrets_abort_if_inside_workspace "$TARGET_DIR"
gapssa_secrets_require_interactive_confirmation

case "$TARGET_DIR" in
"$HOME"/Desktop/*|"$HOME"/Documents/*|"$HOME"/Library/Mobile\ Documents/*)
  echo "ERROR: '$TARGET_DIR' está bajo una carpeta que macOS puede sincronizar con" >&2
  echo "       iCloud Drive. Elige otra ruta bajo \$HOME (p. ej. \$HOME/.gapssa-secrets)" >&2
  echo "       y confirma en Ajustes del Sistema -> ID de Apple -> iCloud que esa ruta" >&2
  echo "       no se sincroniza." >&2
  exit 1
  ;;
esac

already_exists="$(gapssa_secrets_check_dir_mode "$TARGET_DIR")"
echo "target_dir_already_correct_mode=$already_exists"

if [ "$DRY_RUN" = true ]; then
  echo "dry_run=true"
  echo "would_create_dir=$TARGET_DIR"
  exit 0
fi

mkdir -p "$TARGET_DIR"
chmod 700 "$TARGET_DIR"

final_mode_ok="$(gapssa_secrets_check_dir_mode "$TARGET_DIR")"
echo "dir_created=true"
echo "dir_mode_700=$final_mode_ok"
if [ "$final_mode_ok" != "true" ]; then
  echo "ERROR: el directorio no quedó en modo 700 tras crearlo." >&2
  exit 1
fi

echo "S1_OK=true"
