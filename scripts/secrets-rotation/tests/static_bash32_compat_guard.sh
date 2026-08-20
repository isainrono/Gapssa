#!/usr/bin/env bash
# Aserción estática: el asistente de rotación se ejecuta con el bash de
# sistema de macOS (/bin/bash, 3.2.57 — sin arrays asociativos, sin
# mapfile/readarray, sin ${var,,}/${var^^}, sin globstar). Este guard
# falla si aparece sintaxis exclusiva de Bash 4+ en cualquier .sh de
# scripts/secrets-rotation/, para detectarlo en revisión en vez de en
# producción. No toca Docker, Postgres, Redis, ~/.gapssa-secrets ni el
# .env real — solo lee el propio repositorio.
#
# Uso: ./static_bash32_compat_guard.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

PASS=0
FAIL=0

assert() {
  local description="$1"
  local condition="$2"
  if [ "$condition" = "true" ]; then
    echo "ok   - $description"
    PASS=$((PASS + 1))
  else
    echo "FAIL - $description"
    FAIL=$((FAIL + 1))
  fi
}

# Patrones exclusivos de Bash 4+: arrays asociativos, mapfile/readarray,
# ${var,,}/${var^^} (minúsculas/mayúsculas), globstar, &>> .
FORBIDDEN_PATTERN='declare[[:space:]]+-A|readonly[[:space:]]+-A|\<mapfile\>|\<readarray\>|\$\{[A-Za-z_][A-Za-z0-9_]*,,?\}|\$\{[A-Za-z_][A-Za-z0-9_]*\^\^?\}|shopt[[:space:]]+-s[[:space:]]+globstar|&>>'

SELF="$(cd "$SCRIPT_DIR" && pwd)/$(basename "${BASH_SOURCE[0]}")"

while IFS= read -r -d '' file; do
  # Este propio guard menciona los patrones prohibidos en comentarios y en
  # la definición de FORBIDDEN_PATTERN — se excluye a sí mismo del escaneo.
  if [ "$file" = "$SELF" ]; then
    continue
  fi
  matches="$(grep -nE "$FORBIDDEN_PATTERN" "$file" 2>/dev/null || true)"
  rel="${file#"$SR_DIR"/}"
  if [ -z "$matches" ]; then
    assert "sin sintaxis Bash 4+ en $rel" "true"
  else
    assert "sin sintaxis Bash 4+ en $rel" "false"
    echo "$matches" | sed 's/^/       /'
  fi
done < <(find "$SR_DIR" -name '*.sh' -type f -print0 | sort -z)

# Guard de versión: /bin/bash existe y responde (no exige que sea 3.2 en
# todo entorno — CI puede correr Linux con bash 5 — pero confirma que la
# ausencia de sintaxis 4+ de arriba es la garantía real de portabilidad,
# no una casualidad de qué "bash" resuelve el PATH de quien ejecuta esto).
assert "/bin/bash existe y es ejecutable" "$([ -x /bin/bash ] && echo true || echo false)"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
