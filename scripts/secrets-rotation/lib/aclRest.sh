# scripts/secrets-rotation/lib/aclRest.sh — Bloque 4
#
# Helpers de introspección REST de solo lectura contra EspoCRM
# (User/Role/Team) usados por la verificación real de ACL de Meeting.
# Fichero compartido, con una única fuente de verdad, entre:
#   - gate_s9 en rotate-all-interactive.sh (verificación real de S9);
#   - scripts/secrets-rotation/tests/espo_acl_rehearsal.sh (ensayo
#     desechable de extremo a extremo contra una instancia REAL).
# Ambos llamadores deben definir `capture_cmd` antes de fuente este
# fichero (rotate-all-interactive.sh ya lo hace; el ensayo desechable
# define un passthrough trivial ya que no tiene concepto de --dry-run).
#
# Cada función hace UNA petición REST de solo lectura con `select=` cerrado
# (nunca userName/name/email/teléfono/Contact salvo el userName exacto que
# se busca) y reduce la respuesta, en el mismo proceso `python3 -c`, al
# subconjunto auditado — nunca se imprime lo descartado. Las funciones que
# resuelven una referencia por ID (Role/{id}, Team/{id}) degradan a
# `{"found": false}` ante CUALQUIER anomalía (ausente, HTTP fallido, JSON
# corrupto, forma inesperada, nivel ACL fuera del enum cerrado) — el
# algoritmo de fusión en verifyEspoAclSnapshot.mjs ya trata una referencia
# irresoluble como ambigua y falla cerrado, así que no hace falta abortar
# aquí. Las búsquedas por identidad (userName/name, y la lista paginada de
# candidatos profesionales) SÍ distinguen "0 o >1 resultados, bien
# formado" (`found:false`, se pasa al snapshot con normalidad) de
# "respuesta inválida/HTTP fallido" (`{"__error__":true}`, aborta S9 de
# inmediato en el llamador).

_s9_fetch_user_by_username_json() {
  local curl_cfg="$1" port="$2" username="$3"
  capture_cmd curl -K "$curl_cfg" -sS -G \
    --data-urlencode "maxSize=2" \
    --data-urlencode "select=id,type,isActive,teamsIds,rolesIds" \
    --data-urlencode "where[0][type]=equals" \
    --data-urlencode "where[0][attribute]=userName" \
    --data-urlencode "where[0][value]=${username}" \
    "http://localhost:${port}/api/v1/User" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    total = d["total"]
    lst = d["list"]
    if not isinstance(total, int) or total < 0 or not isinstance(lst, list) or len(lst) != min(total, 2):
        raise ValueError("forma inesperada")
    if total != 1:
        print(json.dumps({"total": total, "found": False}))
    else:
        u = lst[0]
        for k in ("id", "type", "isActive", "teamsIds", "rolesIds"):
            if k not in u:
                raise ValueError("campo ausente")
        if not isinstance(u["id"], str) or not u["id"] or not isinstance(u["type"], str) or not isinstance(u["isActive"], bool):
            raise ValueError("tipo inesperado")
        if not isinstance(u["teamsIds"], list) or not all(isinstance(x, str) and x for x in u["teamsIds"]):
            raise ValueError("tipo inesperado")
        if not isinstance(u["rolesIds"], list) or not all(isinstance(x, str) and x for x in u["rolesIds"]):
            raise ValueError("tipo inesperado")
        print(json.dumps({"total": 1, "found": True, "id": u["id"], "type": u["type"], "isActive": u["isActive"], "teamsIds": u["teamsIds"], "rolesIds": u["rolesIds"]}))
except Exception:
    print(json.dumps({"__error__": True}))
'
}

_s9_fetch_role_by_name_json() {
  local curl_cfg="$1" port="$2" role_name="$3"
  capture_cmd curl -K "$curl_cfg" -sS -G \
    --data-urlencode "maxSize=2" \
    --data-urlencode "select=id" \
    --data-urlencode "where[0][type]=equals" \
    --data-urlencode "where[0][attribute]=name" \
    --data-urlencode "where[0][value]=${role_name}" \
    "http://localhost:${port}/api/v1/Role" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    total = d["total"]
    lst = d["list"]
    if not isinstance(total, int) or total < 0 or not isinstance(lst, list) or len(lst) != min(total, 2):
        raise ValueError("forma inesperada")
    if total != 1:
        print(json.dumps({"total": total, "found": False}))
    else:
        rid = lst[0].get("id")
        if not isinstance(rid, str) or not rid:
            raise ValueError("id inválido")
        print(json.dumps({"total": 1, "found": True, "id": rid}))
except Exception:
    print(json.dumps({"__error__": True}))
'
}

# Búsqueda paginada y acotada (techo de seguridad 50 páginas / 10000
# usuarios — superado, ambiguo, aborta) de usuarios regulares activos
# (candidatos a "profesional") — nunca incluye userName/name/email.
_s9_fetch_professional_candidates_json() {
  local curl_cfg="$1" port="$2"
  local offset=0 max_size=200 max_pages=50 page=0 out="[]"
  while :; do
    page=$((page + 1))
    if [ "$page" -gt "$max_pages" ]; then
      printf '{"__error__":true}'
      return
    fi
    local page_json
    page_json="$(capture_cmd curl -K "$curl_cfg" -sS -G \
      --data-urlencode "maxSize=${max_size}" \
      --data-urlencode "offset=${offset}" \
      --data-urlencode "select=id,type,isActive,teamsIds,rolesIds" \
      --data-urlencode "where[0][type]=equals" \
      --data-urlencode "where[0][attribute]=type" \
      --data-urlencode "where[0][value]=regular" \
      --data-urlencode "where[1][type]=isTrue" \
      --data-urlencode "where[1][attribute]=isActive" \
      "http://localhost:${port}/api/v1/User" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    total = d["total"]
    lst = d["list"]
    if not isinstance(total, int) or total < 0 or not isinstance(lst, list):
        raise ValueError("forma inesperada")
    # Reduce cada registro a EXACTAMENTE el subconjunto auditado — EspoCRM
    # puede devolver más atributos que los pedidos en `select=` (p.ej.
    # userName/name/*Names para campos linkMultiple); nunca se propagan
    # más allá de este punto, nunca se imprimen.
    reduced = []
    for u in lst:
        for k in ("id", "type", "isActive", "teamsIds", "rolesIds"):
            if k not in u:
                raise ValueError("campo ausente")
        if not isinstance(u["id"], str) or not u["id"] or not isinstance(u["type"], str) or not isinstance(u["isActive"], bool):
            raise ValueError("tipo inesperado")
        if not isinstance(u["teamsIds"], list) or not all(isinstance(x, str) and x for x in u["teamsIds"]):
            raise ValueError("tipo inesperado")
        if not isinstance(u["rolesIds"], list) or not all(isinstance(x, str) and x for x in u["rolesIds"]):
            raise ValueError("tipo inesperado")
        reduced.append({"id": u["id"], "type": u["type"], "isActive": u["isActive"], "teamsIds": u["teamsIds"], "rolesIds": u["rolesIds"]})
    print(json.dumps({"ok": True, "total": total, "list": reduced}))
except Exception:
    print(json.dumps({"ok": False}))
')"
    local page_ok
    page_ok="$(printf '%s' "$page_json" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print("1" if d.get("ok") else "0")
except Exception:
    print("0")')"
    if [ "$page_ok" != "1" ]; then
      printf '{"__error__":true}'
      return
    fi
    out="$(ACC_JSON="$out" PAGE_JSON="$page_json" python3 -c "
import os, json
acc = json.loads(os.environ['ACC_JSON'])
page = json.loads(os.environ['PAGE_JSON'])
acc.extend(page['list'])
print(json.dumps(acc))
")"
    local total got
    total="$(printf '%s' "$page_json" | python3 -c 'import sys,json; print(json.load(sys.stdin)["total"])')"
    got="$(printf '%s' "$page_json" | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["list"]))')"
    offset=$((offset + got))
    if [ "$got" -lt "$max_size" ] || [ "$offset" -ge "$total" ]; then
      break
    fi
  done
  printf '%s' "$out"
}

_s9_fetch_team_roles_json() {
  local curl_cfg="$1" port="$2" team_id="$3"
  capture_cmd curl -K "$curl_cfg" -sS -G \
    --data-urlencode "select=id,rolesIds" \
    "http://localhost:${port}/api/v1/Team/${team_id}" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    if not isinstance(d, dict) or not isinstance(d.get("id"), str) or not d["id"]:
        raise ValueError("id ausente")
    rids = d.get("rolesIds")
    if not isinstance(rids, list) or not all(isinstance(x, str) and x for x in rids):
        raise ValueError("rolesIds con forma inesperada")
    print(json.dumps({"found": True, "rolesIds": rids}))
except Exception:
    print(json.dumps({"found": False}))
'
}

_s9_fetch_role_meeting_json() {
  local curl_cfg="$1" port="$2" role_id="$3"
  capture_cmd curl -K "$curl_cfg" -sS -G \
    --data-urlencode "select=id,data,fieldData" \
    "http://localhost:${port}/api/v1/Role/${role_id}" | python3 -c '
import sys, json
AUDITED_FIELDS = ("name", "cBookingRequestId", "cMotivoResolucionReserva", "cExcluirGoogleCalendarSync")
AUDITED_SCOPE_ACTIONS = ("create", "delete")
LEVELS_FIELD = {"yes", "no"}
LEVELS_SCOPE = {"yes", "all", "team", "own", "no"}
try:
    d = json.load(sys.stdin)
    if not isinstance(d, dict) or not isinstance(d.get("id"), str) or not d["id"]:
        raise ValueError("id ausente")
    data = d.get("data") or {}
    field_data = d.get("fieldData") or {}
    if not isinstance(data, dict) or not isinstance(field_data, dict):
        raise ValueError("data/fieldData con forma inesperada")
    meeting_scope_raw = data.get("Meeting") or {}
    meeting_fields_raw = field_data.get("Meeting") or {}
    if not isinstance(meeting_scope_raw, dict) or not isinstance(meeting_fields_raw, dict):
        raise ValueError("Meeting con forma inesperada")
    meeting_scope = {}
    for action in AUDITED_SCOPE_ACTIONS:
        if action in meeting_scope_raw:
            val = meeting_scope_raw[action]
            if val not in LEVELS_SCOPE:
                raise ValueError("nivel de scope desconocido")
            meeting_scope[action] = val
    meeting_field_data = {}
    for field in AUDITED_FIELDS:
        entry = meeting_fields_raw.get(field)
        if entry is None:
            continue
        if not isinstance(entry, dict):
            raise ValueError("fieldData de campo con forma inesperada")
        reduced = {}
        for action in ("read", "edit"):
            if action in entry:
                val = entry[action]
                if val not in LEVELS_FIELD:
                    raise ValueError("nivel de campo desconocido")
                reduced[action] = val
        meeting_field_data[field] = reduced
    print(json.dumps({"found": True, "meetingScope": meeting_scope, "meetingFieldData": meeting_field_data}))
except Exception:
    print(json.dumps({"found": False}))
'
}

# _s9_verify_runtime_image <container_id> <audited_image_tag>
# Evidencia RUNTIME (docker inspect), nunca el valor declarado en un .env —
# imprime "true"/"false" a stdout, nunca el `docker inspect` completo.
# Compartida por gate_s9 y el ensayo desechable — misma evidencia exigida
# en ambos sitios (Bloque 4, §4 del informe).
_s9_verify_runtime_image() {
  local cid="$1" audited_image="$2"
  if [ -z "$cid" ]; then
    printf 'false'
    return
  fi
  local running_image running_image_id audited_image_id
  running_image="$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
  if [ "$running_image" != "$audited_image" ]; then
    printf 'false'
    return
  fi
  running_image_id="$(docker inspect --format '{{.Image}}' "$cid" 2>/dev/null || true)"
  audited_image_id="$(docker image inspect "$audited_image" --format '{{.Id}}' 2>/dev/null || true)"
  if [ -n "$audited_image_id" ] && [ -n "$running_image_id" ] && [ "$running_image_id" != "$audited_image_id" ]; then
    printf 'false'
    return
  fi
  printf 'true'
}

_s9_json_has_error() {
  printf '%s' "$1" | python3 -c 'import sys, json
try:
    d = json.load(sys.stdin)
    sys.exit(0 if isinstance(d, dict) and d.get("__error__") is True else 1)
except Exception:
    sys.exit(0)' 2>/dev/null
}

# Ensambla el snapshot cerrado (misma forma exacta que exige
# verifyEspoAclSnapshot.mjs) a partir de los fragmentos JSON ya obtenidos.
# Función pura sobre variables de entorno — sin E/S de red.
_s9_assemble_acl_snapshot_json() {
  PORTAL_USER_JSON="$1" PORTAL_ROLE_JSON="$2" PROFESSIONAL_ROLE_JSON="$3" \
    CANDIDATES_JSON="$4" TEAMS_MAP="$5" ROLES_MAP="$6" ADMIN_RUNTIME_VERIFIED="$7" python3 -c "
import os, json
print(json.dumps({
    'portalUser': json.loads(os.environ['PORTAL_USER_JSON']),
    'portalRole': json.loads(os.environ['PORTAL_ROLE_JSON']),
    'professionalRole': json.loads(os.environ['PROFESSIONAL_ROLE_JSON']),
    'professionalCandidates': json.loads(os.environ['CANDIDATES_JSON']),
    'teams': json.loads(os.environ['TEAMS_MAP']),
    'roles': json.loads(os.environ['ROLES_MAP']),
    'adminRuntimeCoreVerified': os.environ['ADMIN_RUNTIME_VERIFIED'] == 'true',
}))
"
}

# Orquesta el flujo REST completo (identidades → equipos → roles →
# snapshot) — única fuente de verdad usada tanto por gate_s9 como por el
# ensayo desechable. Imprime a stdout: el snapshot cerrado en caso normal,
# o `{"__error__":true}` si alguna consulta de identidad de nivel superior
# (User/Role por nombre, o la paginación de candidatos) falló/fue
# inválida — nunca construye un snapshot a medias en ese caso.
_s9_build_acl_snapshot_json() {
  local curl_cfg="$1" port="$2" admin_runtime_verified="$3"
  local portal_user_json portal_role_json professional_role_json professional_candidates_json
  portal_user_json="$(_s9_fetch_user_by_username_json "$curl_cfg" "$port" "portal-gapssa-api")"
  portal_role_json="$(_s9_fetch_role_by_name_json "$curl_cfg" "$port" "Portal GAPSSA API")"
  professional_role_json="$(_s9_fetch_role_by_name_json "$curl_cfg" "$port" "Profesional Gapssa")"
  professional_candidates_json="$(_s9_fetch_professional_candidates_json "$curl_cfg" "$port")"

  if _s9_json_has_error "$portal_user_json" || _s9_json_has_error "$portal_role_json" ||
    _s9_json_has_error "$professional_role_json" || _s9_json_has_error "$professional_candidates_json"; then
    printf '{"__error__":true}'
    return
  fi

  local team_ids_needed
  team_ids_needed="$(PORTAL_USER_JSON="$portal_user_json" CANDIDATES_JSON="$professional_candidates_json" python3 -c "
import os, json
ids = set()
pu = json.loads(os.environ['PORTAL_USER_JSON'])
if pu.get('found'):
    ids.update(pu.get('teamsIds', []))
for c in json.loads(os.environ['CANDIDATES_JSON']):
    ids.update(c.get('teamsIds', []))
for i in sorted(ids):
    print(i)
")"
  local teams_map="{}" team_id
  while IFS= read -r team_id; do
    [ -z "$team_id" ] && continue
    local team_json
    team_json="$(_s9_fetch_team_roles_json "$curl_cfg" "$port" "$team_id")"
    teams_map="$(TEAMS_MAP="$teams_map" TEAM_ID="$team_id" TEAM_JSON="$team_json" python3 -c "
import os, json
m = json.loads(os.environ['TEAMS_MAP'])
m[os.environ['TEAM_ID']] = json.loads(os.environ['TEAM_JSON'])
print(json.dumps(m))
")"
  done <<<"$team_ids_needed"

  local role_ids_needed
  role_ids_needed="$(PORTAL_USER_JSON="$portal_user_json" PORTAL_ROLE_JSON="$portal_role_json" PROFESSIONAL_ROLE_JSON="$professional_role_json" CANDIDATES_JSON="$professional_candidates_json" TEAMS_MAP="$teams_map" python3 -c "
import os, json
ids = set()
pu = json.loads(os.environ['PORTAL_USER_JSON'])
if pu.get('found'):
    ids.update(pu.get('rolesIds', []))
pr = json.loads(os.environ['PORTAL_ROLE_JSON'])
if pr.get('found'):
    ids.add(pr['id'])
prof = json.loads(os.environ['PROFESSIONAL_ROLE_JSON'])
if prof.get('found'):
    ids.add(prof['id'])
for c in json.loads(os.environ['CANDIDATES_JSON']):
    ids.update(c.get('rolesIds', []))
for t in json.loads(os.environ['TEAMS_MAP']).values():
    if t.get('found'):
        ids.update(t.get('rolesIds', []))
for i in sorted(ids):
    print(i)
")"
  local roles_map="{}" role_id
  while IFS= read -r role_id; do
    [ -z "$role_id" ] && continue
    local role_json
    role_json="$(_s9_fetch_role_meeting_json "$curl_cfg" "$port" "$role_id")"
    roles_map="$(ROLES_MAP="$roles_map" ROLE_ID="$role_id" ROLE_JSON="$role_json" python3 -c "
import os, json
m = json.loads(os.environ['ROLES_MAP'])
m[os.environ['ROLE_ID']] = json.loads(os.environ['ROLE_JSON'])
print(json.dumps(m))
")"
  done <<<"$role_ids_needed"

  _s9_assemble_acl_snapshot_json "$portal_user_json" "$portal_role_json" "$professional_role_json" "$professional_candidates_json" "$teams_map" "$roles_map" "$admin_runtime_verified"
}

# Validación defensiva de segunda capa del contrato de salida del helper
# Node (claves exactas, tipos exactos) — imprime "true" solo si la forma
# es exactamente la esperada Y `aclClosed` es `true`; "false" en cualquier
# otro caso (incluida una forma inesperada). Nunca confía ciegamente en el
# exit code del helper.
_s9_validate_acl_result_json() {
  printf '%s' "$1" | python3 -c "
import sys, json
EXPECTED_BOOL = ('portalUserPresent','portalUserActive','portalRoleSetValid','professionalRolePresent','professionalUsersVerified','professionalEffectiveAclClosed','unexpectedPermissiveInheritedRole','unexpectedProfessionalPermissiveRole','adminRuntimeCoreVerified','aclClosed')
EXPECTED_ENUM = ('portalMeetingCreate','portalMeetingDelete','portalMeetingNameRead','portalMeetingNameEdit','portalBookingRequestIdRead','portalBookingRequestIdEdit','portalMotivoResolucionRead','portalMotivoResolucionEdit','portalExcludeGcsRead','portalExcludeGcsEdit','professionalBookingRequestIdRead','professionalBookingRequestIdEdit','professionalMotivoResolucionRead','professionalMotivoResolucionEdit','professionalExcludeGcsRead','professionalExcludeGcsEdit')
EXPECTED_KEYS = set(EXPECTED_BOOL) | set(EXPECTED_ENUM) | {'professionalUserCount'}
try:
    d = json.load(sys.stdin)
    if not isinstance(d, dict) or set(d.keys()) != EXPECTED_KEYS:
        raise ValueError('claves inesperadas')
    for k in EXPECTED_BOOL:
        if not isinstance(d[k], bool):
            raise ValueError('tipo inesperado')
    for k in EXPECTED_ENUM:
        if d[k] not in ('yes', 'no', 'unknown'):
            raise ValueError('valor inesperado')
    if not isinstance(d['professionalUserCount'], int) or isinstance(d['professionalUserCount'], bool) or d['professionalUserCount'] < 0:
        raise ValueError('tipo inesperado')
    print('true' if d['aclClosed'] is True else 'false')
except Exception:
    print('false')
"
}
