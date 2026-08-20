# scripts/secrets-rotation/lib/recoveryEvidence.sh — Bloque 5
#
# Constructores JSON genéricos de un componente/evidencia de recuperación
# — la forma EXACTA que exige lib/decideRecoveryPlan.mjs. Nunca imprimen
# un valor de secreto (solo booleanos ya calculados por el llamador).

# _recovery_component_reversible <name> <restoredWorks:true|false> <applyAttempted> <applySucceeded> <verifiedAfterApply>
_recovery_component_reversible() {
  NAME="$1" RESTORED="$2" ATTEMPTED="$3" SUCCEEDED="$4" VERIFIED="$5" python3 -c "
import os, json
def b(k): return os.environ[k] == 'true'
print(json.dumps({
    'name': os.environ['NAME'],
    'reversible': True,
    'restoredValueWorks': b('RESTORED'),
    'applyAttempted': b('ATTEMPTED'),
    'applySucceeded': b('SUCCEEDED'),
    'verifiedAfterApply': b('VERIFIED'),
}))
"
}

# _recovery_component_irreversible <name> <restoredWorks> <forwardRecoveryAttempted> <forwardRecovered>
_recovery_component_irreversible() {
  NAME="$1" RESTORED="$2" ATTEMPTED="$3" RECOVERED="$4" python3 -c "
import os, json
def b(k): return os.environ[k] == 'true'
print(json.dumps({
    'name': os.environ['NAME'],
    'reversible': False,
    'restoredValueWorks': b('RESTORED'),
    'forwardRecoveryAttempted': b('ATTEMPTED'),
    'forwardRecovered': b('RECOVERED'),
}))
"
}

# _recovery_evidence_envelope <gate> <component_json...>
# Cada argumento adicional es UNA línea JSON ya construida por las dos
# funciones de arriba. Imprime la evidencia completa {gate, components}.
_recovery_evidence_envelope() {
  local gate="$1"
  shift
  local joined
  joined="$(printf '%s\n' "$@")"
  GATE="$gate" python3 -c "
import os, sys, json
components = [json.loads(line) for line in sys.stdin if line.strip()]
print(json.dumps({'gate': os.environ['GATE'], 'components': components}))
" <<<"$joined"
}

# _recovery_decide <evidence_json> <script_dir>
# Invoca decideRecoveryPlan.mjs y devuelve SOLO el nombre del estado
# ('recovery_required' | 'forward_recovery_required' |
# 'server_coordination_required') — cualquier fallo de invocación o
# forma de salida inesperada cae, fail-closed, en
# 'server_coordination_required'.
_recovery_decide() {
  local evidence_json="$1" script_dir="$2"
  local decision
  decision="$(printf '%s' "$evidence_json" | node "$script_dir/lib/decideRecoveryPlan.mjs" 2>/dev/null)" || decision=""
  if [ -z "$decision" ]; then
    printf 'server_coordination_required'
    return
  fi
  printf '%s' "$decision" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    state = d.get("gateState")
    if not isinstance(d, dict) or set(d.keys()) != {"gate", "componentStatuses", "gateState", "allCoordinated"}:
        raise ValueError()
    if state not in ("recovery_required", "forward_recovery_required", "server_coordination_required"):
        raise ValueError()
    print(state)
except Exception:
    print("server_coordination_required")
'
}

# _recovery_print_component_statuses <evidence_json> <script_dir>
# (Bloque 5, Revisión 2, punto 7) — imprime, una línea por componente,
# SOLO su nombre y su estado cerrado ('coordinated' | 'forward_recovered'
# | 'server_mismatch') — nunca un valor secreto, decideRecoveryPlan.mjs
# nunca los ve. Distingue explícitamente, componente a componente,
# "credencial coordinada" de "aplicación disponible" (p.ej. en S3:
# mariadb_root/mariadb_espocrm son la credencial; espocrm_app_availability
# es la aplicación) de "recuperación completa" (el veredicto agregado de
# la puerta, que el llamador ya imprime aparte como
# server_reconciliation_state). Cualquier fallo de invocación o forma de
# salida inesperada imprime nada (silencioso, nunca hace fallar al
# llamador) — el veredicto agregado, ya calculado por _recovery_decide,
# es la fuente de verdad; esto es solo detalle informativo adicional.
_recovery_print_component_statuses() {
  local evidence_json="$1" script_dir="$2"
  local decision
  decision="$(printf '%s' "$evidence_json" | node "$script_dir/lib/decideRecoveryPlan.mjs" 2>/dev/null)" || return 0
  printf '%s' "$decision" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    statuses = d.get("componentStatuses")
    if not isinstance(statuses, dict):
        raise ValueError()
    for name in sorted(statuses):
        print(f"  componente {name}: {statuses[name]}")
except Exception:
    pass
' 2>/dev/null || true
}
