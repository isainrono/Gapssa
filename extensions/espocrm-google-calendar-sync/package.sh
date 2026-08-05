#!/usr/bin/env bash
#
# Genera la carpeta de entrega en dist/google-calendar-sync-${VERSION}/.
#
# La versión se LEE aquí dentro desde manifest.json y se valida ANTES de
# construir ninguna ruta. Make nunca la interpola en código shell.
#
# Antes de cualquier borrado se comprueba que dist/ y el destino son
# directorios reales del repositorio, no enlaces simbólicos que apunten fuera.
# Los enlaces no se siguen ni se limpian: se aborta y se deja la decisión a la
# persona.
#
# Requisito previo: el ZIP ya construido y verificado por build.sh.
set -euo pipefail

EXT_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -P -- "$EXT_DIR/../.." && pwd -P)"

# shellcheck source=lib/safe-paths.sh
. "$EXT_DIR/lib/safe-paths.sh"

MANIFEST="$EXT_DIR/manifest.json"
SRC_DOCS="$REPO_ROOT/entrega-google-calendar-sync"

DOCS=(LEEME.md 1-INSTALACION.md 2-GOOGLE-CLOUD.md 3-VERIFICACION.md 4-MANTENIMIENTO.md)

# --------------------------------------------- 1. Versión: leer y validar
VERSION="$(gcs_extract_version "$MANIFEST")"
gcs_validate_version "$VERSION"

echo "==> Versión validada: $VERSION"

# ------------------------------------ 2. dist/ debe ser un directorio real
DIST_PARENT="$REPO_ROOT/dist"

# Si no existe se crea; si existe debe ser un directorio real, nunca un enlace.
gcs_ensure_real_dir "$DIST_PARENT" "dist/"

# Y su ruta física debe ser exactamente <repo>/dist.
DIST_PARENT_PHYSICAL="$(gcs_physical_dir "$DIST_PARENT")"

if [ "$DIST_PARENT_PHYSICAL" != "$REPO_ROOT/dist" ]; then
    gcs_die "dist/ resuelve fuera del repositorio. Físico: [$DIST_PARENT_PHYSICAL]. Esperado: [$REPO_ROOT/dist]."
fi

# ------------------------------- 3. Destino: construir y verificar la ruta
DIST_DIR="$DIST_PARENT_PHYSICAL/google-calendar-sync-$VERSION"
ZIP_SRC="$EXT_DIR/build/google-calendar-sync-$VERSION.zip"

[ "$DIST_DIR" = "$REPO_ROOT/dist/google-calendar-sync-$VERSION" ] || \
    gcs_die "el destino calculado no coincide con el esperado: [$DIST_DIR]"

[ "$(dirname -- "$DIST_DIR")" = "$DIST_PARENT_PHYSICAL" ] || \
    gcs_die "el padre del destino no es $DIST_PARENT_PHYSICAL sino [$(dirname -- "$DIST_DIR")]"

[ "$(basename -- "$DIST_DIR")" = "google-calendar-sync-$VERSION" ] || \
    gcs_die "nombre de carpeta inesperado: [$(basename -- "$DIST_DIR")]"

case "$DIST_DIR" in
    ""|"/"|"$REPO_ROOT"|"$REPO_ROOT/"|"$DIST_PARENT_PHYSICAL"|"$DIST_PARENT_PHYSICAL/")
        gcs_die "destino peligroso: [$DIST_DIR]" ;;
esac

# --------------------- 4. El destino, si existe, no puede ser un enlace
if [ -L "$DIST_DIR" ]; then
    gcs_die "el destino es un enlace simbólico: [$DIST_DIR]. Abortado: borrarlo podría afectar a su objetivo. Revísalo a mano."
fi

if [ -e "$DIST_DIR" ]; then
    [ -d "$DIST_DIR" ] || gcs_die "el destino existe y no es un directorio: [$DIST_DIR]"

    # Ni enlaces dentro que un rm -rf pudiera atravesar.
    gcs_assert_no_links "$DIST_DIR" "el destino"

    # Y su padre físico debe seguir siendo el dist/ real del repositorio.
    DIST_DIR_PHYSICAL="$(gcs_physical_dir "$DIST_DIR")"

    [ "$DIST_DIR_PHYSICAL" = "$DIST_DIR" ] || \
        gcs_die "el destino resuelve a otra ruta. Físico: [$DIST_DIR_PHYSICAL]."

    [ "$(dirname -- "$DIST_DIR_PHYSICAL")" = "$DIST_PARENT_PHYSICAL" ] || \
        gcs_die "el padre físico del destino no es $DIST_PARENT_PHYSICAL."
fi

# ------------------------------------------------- 5. Comprobar el ZIP
[ -f "$ZIP_SRC" ] || gcs_die "no se encontró el ZIP de la versión $VERSION en $ZIP_SRC. Ejecuta 'make gcs-build'."

[ "$(basename -- "$ZIP_SRC")" = "google-calendar-sync-$VERSION.zip" ] || \
    gcs_die "el nombre del ZIP no corresponde a la versión $VERSION."

# --------------------------------------------------- 6. Recrear el destino
echo "==> Objetivo del borrado, ruta física, absoluta y exacta:"
echo "      $DIST_DIR"

if [ -e "$DIST_DIR" ]; then
    echo "    (existe, es un directorio real y sin enlaces dentro; se recrea)"
else
    echo "    (no existe todavía)"
fi

rm -rf -- "$DIST_DIR"
mkdir -p -- "$DIST_DIR"

# ---------------------------- 7. Copiar manuales sustituyendo {versión}
for doc in "${DOCS[@]}"; do
    [ -f "$SRC_DOCS/$doc" ] || gcs_die "falta el manual $doc en $SRC_DOCS"

    sed "s/{versión}/$VERSION/g" "$SRC_DOCS/$doc" > "$DIST_DIR/$doc"
done

cp -- "$ZIP_SRC" "$DIST_DIR/"

# ------------------ 8. El marcador no debe sobrevivir (solo en los .md)
for doc in "${DOCS[@]}"; do
    if grep -q '{versión}' "$DIST_DIR/$doc"; then
        gcs_die "el manual $doc de la entrega aún contiene el marcador {versión}."
    fi
done

# ----------------------------------------------------------- 9. Resultado
echo ""
echo "Entrega generada"
echo "  Ruta:    $DIST_DIR"
echo "  Tamaño:  $(du -sh -- "$DIST_DIR" | cut -f1)"
echo "  Archivos:"
ls -1sh -- "$DIST_DIR" | sed 's/^/    /'

echo ""
echo "  Otras versiones conservadas en dist/:"
find "$DIST_PARENT_PHYSICAL" -maxdepth 1 -mindepth 1 -type d ! -path "$DIST_DIR" \
    -exec basename {} \; 2>/dev/null | sed 's/^/    /' || true
