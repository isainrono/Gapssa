#!/usr/bin/env bash
# Aserción estática: confirma que rotate-all-interactive.sh ya no genera
# ningún script TypeScript/ESM ejecutable mediante heredoc dentro de
# apps/web (Bloque 3) — ni en S6 ni en S7 ni en ninguna otra puerta — y
# que las 4 sondas permanentes que los sustituyen existen realmente bajo
# scripts/secrets-rotation/probes/. No toca Docker, Postgres, Redis,
# ~/.gapssa-secrets ni el .env real — solo lee el propio repositorio.
#
# Uso: ./static_no_heredoc_in_apps_web.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$SR_DIR/../.." && pwd)"
ORCHESTRATOR="$SR_DIR/rotate-all-interactive.sh"

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

count_matches() {
  # Cuenta líneas que coincidan con el patrón extendido $1 en $2 — 0 si
  # no hay ninguna coincidencia (grep -c ya devuelve 0 en ese caso, pero
  # con `set -e` activo un grep sin coincidencias devuelve exit 1, así
  # que se envuelve con `|| true`).
  grep -cE "$1" "$2" 2>/dev/null || true
}

# --- 1. Ningún heredoc que escriba un .ts/.mts/.mjs bajo apps/web ---
heredoc_mts_matches="$(count_matches 'mktemp[^|]*apps/web[^|]*\.(mts|ts|mjs)' "$ORCHESTRATOR")"
assert "cero heredocs/mktemp que generen .ts/.mts/.mjs bajo apps/web en rotate-all-interactive.sh" "$([ "${heredoc_mts_matches:-0}" = "0" ] && echo true || echo false)"

# --- 2. Ningún heredoc "cat >... <<'TS'" (el patrón exacto que usaban
#        los 4 heredocs de S6/S7 antes del Bloque 3) ---
cat_ts_heredoc_matches="$(count_matches "cat >.*<<'TS'" "$ORCHESTRATOR")"
assert "cero heredocs 'cat > ... <<\"TS\"' en rotate-all-interactive.sh" "$([ "${cat_ts_heredoc_matches:-0}" = "0" ] && echo true || echo false)"

# --- 3. Las 4 sondas permanentes existen realmente bajo probes/ ---
for probe in s6PreRotationProbe.mts s6PostRotationVerification.mts s6ArtifactMaintenance.mts s7MigrateAndAudit.mts s7InternalApiAuthCheck.mts; do
  assert "existe scripts/secrets-rotation/probes/$probe" "$([ -f "$SR_DIR/probes/$probe" ] && echo true || echo false)"
done
assert "existe scripts/secrets-rotation/probes/shared/hs256.mts" "$([ -f "$SR_DIR/probes/shared/hs256.mts" ] && echo true || echo false)"
assert "existe scripts/secrets-rotation/probes/shared/secureArtifact.mts" "$([ -f "$SR_DIR/probes/shared/secureArtifact.mts" ] && echo true || echo false)"
assert "existe scripts/secrets-rotation/lib/validateProbeJson.mjs" "$([ -f "$SR_DIR/lib/validateProbeJson.mjs" ] && echo true || echo false)"

# --- 4. rotate-all-interactive.sh invoca las sondas por ruta absoluta
#        resuelta desde $SCRIPT_DIR/probes/, nunca $(basename ...) de un
#        temporal generado ---
for probe in s6PreRotationProbe.mts s6PostRotationVerification.mts s6ArtifactMaintenance.mts s7MigrateAndAudit.mts s7InternalApiAuthCheck.mts; do
  invocation_matches="$(count_matches "SCRIPT_DIR/probes/$probe" "$ORCHESTRATOR")"
  assert "rotate-all-interactive.sh referencia \$SCRIPT_DIR/probes/$probe" "$([ "${invocation_matches:-0}" -gt "0" ] && echo true || echo false)"
done

# --- 5. Ningún resto de las variables de los heredocs eliminados
#        (ts_pre/ts_post/ts_migrate/ts_internal_check) ---
for varname in ts_pre ts_post ts_migrate ts_internal_check; do
  leftover_matches="$(count_matches "\\b$varname\\b" "$ORCHESTRATOR")"
  assert "ninguna referencia residual a la variable '$varname' en rotate-all-interactive.sh" "$([ "${leftover_matches:-0}" = "0" ] && echo true || echo false)"
done

# --- 6. Estado real del árbol de trabajo: ningún artefacto huérfano de
#        una ejecución anterior a este bloque bajo apps/web (comprobación
#        de higiene del propio checkout, no solo del código fuente) ---
orphan_files="$(find "$REPO_ROOT/apps/web" -maxdepth 1 -name '.gapssa-s*.mts' 2>/dev/null || true)"
assert "ningún fichero .gapssa-s*.mts huérfano en la raíz de apps/web ahora mismo" "$([ -z "$orphan_files" ] && echo true || echo false)"

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
