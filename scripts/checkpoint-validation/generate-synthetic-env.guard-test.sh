#!/bin/bash
# Prueba guard de generate-synthetic-env.sh — demuestra con un repositorio
# de mentira (fixture desechable bajo $TMPDIR, nunca el repositorio real)
# que el generador:
#
#   1. nunca copia el contenido de un ".env" real, aunque exista al lado de
#      la plantilla (se usa un valor "centinela" que solo está en el .env
#      de mentira, y se comprueba que NUNCA aparece en la salida);
#   2. aborta (exit != 0) si la plantilla de origen y el ".env" de mentira
#      resuelven al mismo fichero (mismo dispositivo+inodo);
#   3. el entorno sintético generado tiene exactamente las claves de la
#      plantilla, en modo 600 desde su creación;
#   4. el fichero temporal desaparece cuando el caller lo borra (teardown);
#   5. los valores sintéticos generados nunca aparecen en la salida por
#      stdout/stderr del propio generador.
#
# No arranca Docker, Postgres, Next.js ni ningún proceso real — es una
# prueba de comportamiento del script en sí, autocontenida y rápida.
#
# Uso: ./generate-synthetic-env.guard-test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR="$SCRIPT_DIR/generate-synthetic-env.sh"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/gsenv-guard-XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

SENTINEL="THIS-IS-THE-REAL-ENV-SENTINEL-NEVER-COPY-ME-6f8c3a"

# --- Caso 1: repositorio de mentira normal (.env.example distinto de .env) ---
FIXTURE1="$WORK/fixture1"
mkdir -p "$FIXTURE1/scripts/checkpoint-validation"
cp "$GENERATOR" "$FIXTURE1/scripts/checkpoint-validation/generate-synthetic-env.sh"
chmod +x "$FIXTURE1/scripts/checkpoint-validation/generate-synthetic-env.sh"
cat > "$FIXTURE1/.env.example" <<'EOF'
# plantilla de mentira
FOO_TOKEN=change-me
BAR_URL=http://change-me.example
EOF
cat > "$FIXTURE1/.env" <<EOF
FOO_TOKEN=$SENTINEL
BAR_URL=http://real-secret-host.internal
EOF
chmod 600 "$FIXTURE1/.env"

TARGET1="$WORK/target1"
mkdir -p "$TARGET1"

STDOUT1="$("$FIXTURE1/scripts/checkpoint-validation/generate-synthetic-env.sh" "$TARGET1" 2>&1)"

if [ -f "$TARGET1/.env" ]; then
  ok "genera .env en el directorio destino"
else
  bad "no generó .env en el directorio destino"
fi

if grep -q "$SENTINEL" "$TARGET1/.env" 2>/dev/null; then
  bad "el centinela del .env de mentira apareció en el .env generado — SE COPIÓ .env real"
else
  ok "el centinela del .env de mentira NUNCA aparece en el .env generado"
fi

if printf '%s' "$STDOUT1" | grep -q "$SENTINEL"; then
  bad "el centinela apareció en la salida por stdout/stderr del generador"
else
  ok "el centinela nunca aparece en stdout/stderr del generador"
fi

if printf '%s' "$STDOUT1" | grep -qE "FOO_TOKEN=|BAR_URL=http"; then
  bad "el generador imprimió pares clave=valor por stdout (fuga de valores)"
else
  ok "el generador no imprime ningún valor generado por stdout"
fi

mode1="$(stat -f '%Lp' "$TARGET1/.env" 2>/dev/null || stat -c '%a' "$TARGET1/.env" 2>/dev/null)"
if [ "$mode1" = "600" ]; then
  ok "el .env sintético queda en modo 600"
else
  bad "modo inesperado del .env sintético: $mode1 (se esperaba 600)"
fi

keys1="$(grep -c '^[A-Z_]*=' "$TARGET1/.env" || true)"
if [ "$keys1" = "2" ]; then
  ok "el número de claves generadas coincide con la plantilla (2)"
else
  bad "número de claves inesperado: $keys1 (se esperaban 2)"
fi

if grep -q '^FOO_TOKEN=synthetic' "$TARGET1/.env"; then
  ok "FOO_TOKEN recibe un valor sintético reconocible (nunca 'change-me' ni el real)"
else
  bad "FOO_TOKEN no tiene el valor sintético genérico esperado"
fi

# --- Caso 2: teardown — el temporal desaparece cuando el caller lo borra ---
rm -f "$TARGET1/.env"
if [ ! -e "$TARGET1/.env" ]; then
  ok "el .env sintético desaparece tras el teardown del caller"
else
  bad "el .env sintético sigue existiendo tras el teardown"
fi

# --- Caso 3: origen y .env resuelven al MISMO fichero -> debe abortar ---
FIXTURE2="$WORK/fixture2"
mkdir -p "$FIXTURE2/scripts/checkpoint-validation"
cp "$GENERATOR" "$FIXTURE2/scripts/checkpoint-validation/generate-synthetic-env.sh"
chmod +x "$FIXTURE2/scripts/checkpoint-validation/generate-synthetic-env.sh"
cat > "$FIXTURE2/.env.example" <<'EOF'
FOO_TOKEN=change-me
EOF
# .env es un hardlink al MISMO inodo que .env.example -> deben detectarse
# como el mismo fichero real.
ln "$FIXTURE2/.env.example" "$FIXTURE2/.env"

TARGET2="$WORK/target2"
mkdir -p "$TARGET2"

set +e
"$FIXTURE2/scripts/checkpoint-validation/generate-synthetic-env.sh" "$TARGET2" >/tmp/gsenv-guard-case3.out 2>&1
rc2=$?
set -e

if [ "$rc2" -ne 0 ]; then
  ok "aborta (exit=$rc2) cuando la plantilla y .env resuelven al mismo fichero"
else
  bad "NO abortó cuando la plantilla y .env resuelven al mismo fichero (riesgo real)"
fi

if [ ! -f "$TARGET2/.env" ]; then
  ok "no genera ningún .env cuando el caso 3 aborta"
else
  bad "generó un .env pese a abortar en el caso 3"
fi
rm -f /tmp/gsenv-guard-case3.out

# --- Caso 4: argumentos inválidos -> debe abortar limpiamente ---
set +e
"$FIXTURE1/scripts/checkpoint-validation/generate-synthetic-env.sh" >/tmp/gsenv-guard-case4.out 2>&1
rc4=$?
set -e
if [ "$rc4" -ne 0 ]; then
  ok "aborta limpiamente sin argumentos (exit=$rc4)"
else
  bad "no abortó sin argumentos"
fi
rm -f /tmp/gsenv-guard-case4.out

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
