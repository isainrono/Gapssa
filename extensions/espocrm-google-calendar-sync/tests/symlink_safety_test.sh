#!/usr/bin/env bash
#
# Comprueba que package.sh y build.sh se niegan a operar cuando dist/ o el
# destino son enlaces simbólicos, o cuando dist/ es un archivo normal.
#
# La prueba es aislada: monta réplicas del repositorio en un directorio
# temporal y verifica que NINGÚN archivo externo se elimina.
#
# Uso:  bash tests/symlink_safety_test.sh <ruta-de-la-extension>
set -uo pipefail

EXT_SRC="$(cd -P -- "${1:-$(dirname -- "${BASH_SOURCE[0]}")/..}" && pwd -P)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

ok()   { echo "  ✅ $*"; PASS=$((PASS + 1)); }
bad()  { echo "  ❌ $*"; FAIL=$((FAIL + 1)); }

# Crea una réplica mínima del repositorio con la extensión dentro.
make_repo() {
    local repo="$1" version="${2:-1.1.0}"

    mkdir -p "$repo/extensions/ext/lib" "$repo/extensions/ext/build" "$repo/entrega-google-calendar-sync"

    cp "$EXT_SRC/package.sh" "$repo/extensions/ext/"
    cp "$EXT_SRC/lib/safe-paths.sh" "$repo/extensions/ext/lib/"

    printf '{"name":"X","version":"%s"}\n' "$version" > "$repo/extensions/ext/manifest.json"
    echo "ZIP" > "$repo/extensions/ext/build/google-calendar-sync-$version.zip"

    local doc
    for doc in LEEME.md 1-INSTALACION.md 2-GOOGLE-CLOUD.md 3-VERIFICACION.md 4-MANTENIMIENTO.md; do
        echo "manual {versión}" > "$repo/entrega-google-calendar-sync/$doc"
    done
}

# Datos externos que ninguna prueba debe tocar.
EXTERNAL="$WORK/externo"
mkdir -p "$EXTERNAL"
echo "NO BORRAR" > "$EXTERNAL/importante.txt"
echo "NO BORRAR TAMPOCO" > "$EXTERNAL/segundo.txt"

echo "=== Caso 1 · dist/ es un enlace simbólico a una carpeta externa ==="
R1="$WORK/repo1"; make_repo "$R1"
ln -s "$EXTERNAL" "$R1/dist"
OUT="$(bash "$R1/extensions/ext/package.sh" 2>&1)"; RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "enlace simbólico"; then
    ok "abortado: $(printf '%s' "$OUT" | grep -m1 'ERROR' | cut -c1-90)"
else
    bad "NO abortó (rc=$RC): $OUT"
fi

echo "=== Caso 2 · DIST_DIR es un enlace simbólico externo ==="
R2="$WORK/repo2"; make_repo "$R2"
mkdir -p "$R2/dist"
ln -s "$EXTERNAL" "$R2/dist/google-calendar-sync-1.1.0"
OUT="$(bash "$R2/extensions/ext/package.sh" 2>&1)"; RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "enlace simbólico"; then
    ok "abortado: $(printf '%s' "$OUT" | grep -m1 'ERROR' | cut -c1-90)"
else
    bad "NO abortó (rc=$RC): $OUT"
fi

echo "=== Caso 3 · dist/ es un archivo normal ==="
R3="$WORK/repo3"; make_repo "$R3"
echo "soy un archivo" > "$R3/dist"
OUT="$(bash "$R3/extensions/ext/package.sh" 2>&1)"; RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "no es un directorio"; then
    ok "abortado: $(printf '%s' "$OUT" | grep -m1 'ERROR' | cut -c1-90)"
else
    bad "NO abortó (rc=$RC): $OUT"
fi

echo "=== Caso 4 · enlace DENTRO del destino ==="
R4="$WORK/repo4"; make_repo "$R4"
mkdir -p "$R4/dist/google-calendar-sync-1.1.0"
ln -s "$EXTERNAL" "$R4/dist/google-calendar-sync-1.1.0/atajo"
OUT="$(bash "$R4/extensions/ext/package.sh" 2>&1)"; RC=$?
if [ "$RC" -ne 0 ] && printf '%s' "$OUT" | grep -q "enlaces simbólicos"; then
    ok "abortado: $(printf '%s' "$OUT" | grep -m1 'ERROR' | cut -c1-90)"
else
    bad "NO abortó (rc=$RC): $OUT"
fi

echo "=== Caso 5 · destino normal dentro de dist/ (debe funcionar) ==="
R5="$WORK/repo5"; make_repo "$R5"
mkdir -p "$R5/dist/google-calendar-sync-1.0.9"
echo "version antigua" > "$R5/dist/google-calendar-sync-1.0.9/marca.txt"
OUT="$(bash "$R5/extensions/ext/package.sh" 2>&1)"; RC=$?
if [ "$RC" -eq 0 ] && [ -f "$R5/dist/google-calendar-sync-1.1.0/LEEME.md" ]; then
    ok "entrega generada"
else
    bad "falló (rc=$RC): $OUT"
fi
if grep -q "1.1.0" "$R5/dist/google-calendar-sync-1.1.0/LEEME.md" 2>/dev/null; then
    ok "marcador {versión} sustituido"
else
    bad "el marcador no se sustituyó"
fi
if [ -f "$R5/dist/google-calendar-sync-1.0.9/marca.txt" ]; then
    ok "la versión 1.0.9 sobrevive intacta"
else
    bad "se borró otra versión de dist/"
fi

echo "=== Comprobación final · ningún archivo externo eliminado ==="
if [ -f "$EXTERNAL/importante.txt" ] && [ -f "$EXTERNAL/segundo.txt" ]; then
    ok "los 2 archivos externos siguen existiendo"
else
    bad "SE ELIMINARON ARCHIVOS EXTERNOS"
fi
if [ "$(find "$EXTERNAL" -type f | wc -l | tr -d ' ')" = "2" ]; then
    ok "el contenido de la carpeta externa está intacto (2 archivos)"
else
    bad "la carpeta externa cambió"
fi

echo ""
if [ "$FAIL" -gt 0 ]; then
    echo "SYMLINK: FALLA ($PASS correctas, $FAIL fallidas)"
    exit 1
fi

echo "SYMLINK: OK ($PASS comprobaciones)"
exit 0
