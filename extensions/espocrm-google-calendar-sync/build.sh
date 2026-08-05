#!/usr/bin/env bash
#
# Empaqueta la extensión Google Calendar Sync como ZIP instalable en EspoCRM.
#
# Construye SIEMPRE desde dependencias exactas (composer.lock) y verifica que el
# ZIP resultante es autónomo antes de darlo por bueno.
#
# Requisitos: bash, zip, y php (local o vía Docker con la imagen composer:2).
set -euo pipefail

EXT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

cd "$EXT_DIR"

# shellcheck source=lib/safe-paths.sh
. "$EXT_DIR/lib/safe-paths.sh"

MODULE_DIR="files/custom/Espo/Modules/GoogleCalendarSync"
RUN_TESTS="${RUN_TESTS:-1}"

# ------------------------------------------------- 1. Dependencias exactas
if [ ! -f "$MODULE_DIR/composer.lock" ]; then
    echo "ERROR: falta $MODULE_DIR/composer.lock" >&2
    echo "       Genera el lock una vez con:  make gcs-lock" >&2
    exit 1
fi

if [ ! -f "$MODULE_DIR/vendor/autoload.php" ]; then
    echo "ERROR: no hay dependencias instaladas." >&2
    echo "       Instálalas desde el lock con:  make gcs-deps" >&2
    exit 1
fi

# ---------------------------------------------------------------- PHP a usar
if command -v php >/dev/null 2>&1; then
    PHP_RUN() { php "$@"; }
elif command -v docker >/dev/null 2>&1; then
    PHP_RUN() { docker run --rm -v "$PWD":/app -w /app composer:2 php "$@"; }
else
    echo "ERROR: se necesita php o docker para verificar el paquete." >&2
    exit 1
fi

echo "==> Verificando dependencias del módulo"
PHP_RUN tools/check-dependencies.php "$MODULE_DIR"

# --------------------------------------------------------- 2. Construir ZIP
# Misma validación que package.sh: ambos usan lib/safe-paths.sh, así que no
# pueden desincronizarse.
VERSION="$(gcs_extract_version "$EXT_DIR/manifest.json")"
gcs_validate_version "$VERSION"

# build/ debe ser un directorio real dentro de la extensión, nunca un enlace.
BUILD_DIR="$EXT_DIR/build"

gcs_ensure_real_dir "$BUILD_DIR" "build/"

BUILD_DIR_PHYSICAL="$(gcs_physical_dir "$BUILD_DIR")"

if [ "$BUILD_DIR_PHYSICAL" != "$EXT_DIR/build" ]; then
    gcs_die "build/ resuelve fuera de la extensión. Físico: [$BUILD_DIR_PHYSICAL]. Esperado: [$EXT_DIR/build]."
fi

OUT="$BUILD_DIR_PHYSICAL/google-calendar-sync-${VERSION}.zip"

# El padre físico del artefacto debe ser exactamente build/, y el nombre el
# esperado: así nunca se escribe ni se borra fuera de build/.
[ "$(dirname -- "$OUT")" = "$BUILD_DIR_PHYSICAL" ] || \
    gcs_die "el ZIP quedaría fuera de build/: [$OUT]"

[ "$(basename -- "$OUT")" = "google-calendar-sync-${VERSION}.zip" ] || \
    gcs_die "nombre de ZIP inesperado: [$(basename -- "$OUT")]"

if [ -L "$OUT" ]; then
    gcs_die "el ZIP de destino es un enlace simbólico: [$OUT]. Abortado; revísalo a mano."
fi

if [ -e "$OUT" ] && [ ! -f "$OUT" ]; then
    gcs_die "la ruta del ZIP existe y no es un archivo regular: [$OUT]"
fi

rm -f -- "$OUT"

echo "==> Empaquetando $OUT"
zip -r -q "$OUT" manifest.json files scripts \
    -x '*.DS_Store' \
    -x '*/.git/*' \
    -x '*/tests/*' \
    -x '*/Tests/*' \
    -x '*/.github/*'

# --------------------------- 3. Verificar el CONTENIDO FINAL del ZIP
echo "==> Verificando el contenido del ZIP"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

unzip -q "$OUT" -d "$TMP"

EXTRACTED="$TMP/$MODULE_DIR"

if [ ! -f "$EXTRACTED/vendor/autoload.php" ]; then
    echo "ERROR: el ZIP no incluye vendor/autoload.php" >&2
    exit 1
fi

PHP_RUN tools/check-dependencies.php "$EXTRACTED"

if [ "$RUN_TESTS" = "1" ]; then
    echo "==> Pruebas contra el contenido del ZIP"
    PHP_RUN tests/autoload_test.php "$EXTRACTED"
    PHP_RUN tests/controller_test.php "$EXTRACTED"
    PHP_RUN tests/i18n_test.php "$EXTRACTED"
    PHP_RUN tests/mapper_test.php "$EXTRACTED"
    PHP_RUN tests/relation_hook_test.php "$EXTRACTED"
    PHP_RUN tests/contact_hook_test.php "$EXTRACTED"
    PHP_RUN tests/contact_resolver_test.php "$EXTRACTED"

    # Esta se ejecuta sobre el árbol de trabajo, no sobre el ZIP: revisa
    # tools/ y tests/, que no se empaquetan.
    PHP_RUN tests/no_hardcoded_package_test.php .

    echo "==> php -l sobre el código del ZIP"
    ERRORS=0
    while IFS= read -r f; do
        PHP_RUN -l "$f" >/dev/null 2>&1 || { echo "  ✗ $f"; ERRORS=$((ERRORS + 1)); }
    done < <(find "$EXTRACTED/Classes" "$EXTRACTED/Api" "$EXTRACTED/Hooks" \
                  "$EXTRACTED/Jobs" "$EXTRACTED/EntryPoints" "$TMP/scripts" \
                  -name '*.php' 2>/dev/null)

    if [ "$ERRORS" -gt 0 ]; then
        echo "ERROR: $ERRORS archivos con errores de sintaxis." >&2
        exit 1
    fi

    echo "  · php -l: sin errores"
fi

SIZE="$(du -h "$OUT" | cut -f1)"
FILES="$(unzip -l "$OUT" | tail -1 | awk '{print $2}')"

echo
echo "OK: $OUT  ($SIZE, $FILES archivos, autónomo y verificado)"
