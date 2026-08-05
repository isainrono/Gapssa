#!/usr/bin/env bash
#
# Helpers compartidos por build.sh y package.sh: lectura y validación de la
# versión, y comprobaciones de sistema de archivos previas a cualquier borrado.
#
# Una sola implementación para que las dos validaciones no puedan divergir.
# Este archivo se carga con `source`; no se ejecuta directamente.
#
# Portabilidad: bash 3.2 (el de macOS) y BSD/GNU coreutils. No se usa
# `realpath` ni `readlink -f`, ausentes o distintos en macOS.

gcs_die() {
    echo "ERROR: $*" >&2
    exit 1
}

# Extrae la versión de un manifest.json. Imprime la versión; aborta si falta.
# Uso:  VERSION="$(gcs_extract_version "$MANIFEST")"
gcs_extract_version() {
    local manifest="$1" version

    [ -f "$manifest" ] || gcs_die "no se encontró $manifest"

    version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -1)"

    [ -n "$version" ] || gcs_die "manifest.json no declara una versión."

    printf '%s' "$version"
}

# Validación estricta de la versión. Debe ejecutarse ANTES de construir
# cualquier ruta con ella.
#
# El patrón ya excluye todo lo peligroso; los `case` posteriores existen para
# que el motivo del rechazo sea legible y para no depender de una sola defensa.
gcs_validate_version() {
    local version="$1"

    [ -n "$version" ] || gcs_die "la versión está vacía."

    if ! printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.]+)?$'; then
        gcs_die "versión con formato no admitido: [$version]. Se espera N.N.N (o N.N.N-rc1)."
    fi

    case "$version" in
        *"'"*)   gcs_die "la versión contiene comilla simple: [$version]" ;;
        *'"'*)   gcs_die "la versión contiene comilla doble: [$version]" ;;
        */*)     gcs_die "la versión contiene una barra: [$version]" ;;
        *'\'*)   gcs_die "la versión contiene una barra invertida: [$version]" ;;
        *..*)    gcs_die "la versión contiene '..': [$version]" ;;
        *' '*)   gcs_die "la versión contiene un espacio: [$version]" ;;
        *$'\t'*) gcs_die "la versión contiene un tabulador: [$version]" ;;
        *$'\n'*) gcs_die "la versión contiene un salto de línea: [$version]" ;;
        *'$'*|*'`'*|*';'*|*'&'*|*'|'*|*'<'*|*'>'*|*'('*|*')'*|*'*'*|*'?'*|*'['*|*']'*|*'{'*|*'}'*|*'!'*|*'#'*|*'~'*)
                 gcs_die "la versión contiene metacaracteres de shell: [$version]" ;;
    esac
}

# Imprime la ruta física (enlaces resueltos) de un directorio existente.
gcs_physical_dir() {
    local dir="$1"

    (cd -P -- "$dir" 2>/dev/null && pwd -P) || gcs_die "no se pudo resolver la ruta física de [$dir]"
}

# Exige que la ruta sea un directorio REAL: ni enlace simbólico, ni archivo.
# No sigue enlaces ni intenta limpiarlos: aborta y deja la decisión a la persona.
gcs_require_real_dir() {
    local dir="$1" label="${2:-$1}"

    if [ -L "$dir" ]; then
        gcs_die "$label es un enlace simbólico: [$dir]. Abortado por seguridad; revísalo a mano."
    fi

    [ -e "$dir" ] || gcs_die "$label no existe: [$dir]"

    if [ ! -d "$dir" ]; then
        gcs_die "$label existe pero no es un directorio: [$dir]"
    fi
}

# Crea el directorio si falta y después exige que sea real.
gcs_ensure_real_dir() {
    local dir="$1" label="${2:-$1}"

    if [ ! -e "$dir" ] && [ ! -L "$dir" ]; then
        mkdir -p -- "$dir"
    fi

    gcs_require_real_dir "$dir" "$label"
}

# Exige que la ruta física de un directorio sea exactamente la esperada.
gcs_require_physical_match() {
    local dir="$1" expected="$2" label="${3:-$1}"

    local actual
    actual="$(gcs_physical_dir "$dir")"

    local expected_physical
    expected_physical="$(gcs_physical_dir "$(dirname -- "$expected")")/$(basename -- "$expected")"

    if [ "$actual" != "$expected_physical" ]; then
        gcs_die "$label apunta fuera de lo esperado. Físico: [$actual]. Esperado: [$expected_physical]."
    fi
}

# Aborta si dentro del árbol hay cualquier enlace simbólico, que una operación
# recursiva podría atravesar.
gcs_assert_no_links() {
    local dir="$1" label="${2:-$1}"

    [ -d "$dir" ] || return 0

    local found
    found="$(find "$dir" -type l -print 2>/dev/null | head -5)"

    if [ -n "$found" ]; then
        echo "ERROR: $label contiene enlaces simbólicos; una operación recursiva podría atravesarlos:" >&2
        printf '  %s\n' $found >&2
        echo "Abortado por seguridad. No se eliminan ni se siguen automáticamente." >&2
        exit 1
    fi
}
