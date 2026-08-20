# scripts/secrets-rotation/lib/espoRecovery.sh — Bloque 5 (Revisión 2)
#
# Helpers de recuperación de credenciales de EspoCRM (S4) — fichero
# compartido, única fuente de verdad, entre `gate_s4` en
# rotate-all-interactive.sh y el ensayo desechable de Bloque 5.
#
# Distingue explícitamente los dos sub-secretos de S4:
#   - ESPOCRM_ADMIN_PASSWORD: REVERSIBLE — `bin/command set-password` no
#     exige conocer la contraseña anterior (verificado en el código
#     fuente de la imagen, ya citado en el Bloque original de S4), así
#     que reaplicar el valor restaurado es SIEMPRE seguro y determinista,
#     sin necesidad de "detectar" si ya estaba aplicado.
#   - ESPOCRM_API_KEY: IRREVERSIBLE — regenerar invalida la anterior para
#     siempre. Nunca se reintenta "restaurar" un valor antiguo; solo se
#     comprueba si el valor restaurado sigue vivo y, si no, se genera uno
#     NUEVO ("recuperación hacia delante") y se escribe ESE valor en
#     $SECRETS_FILE — nunca el antiguo.
#
# El llamador DEBE definir `_gapssa_compose` (igual que lib/dbRecovery.sh)
# y debe haber fuente lib/aclRest.sh antes (reutiliza
# `_s9_fetch_user_by_username_json` para localizar el User por
# userName sin duplicar esa consulta).

# _espo_set_admin_password <service> <admin_user>
# Lee la contraseña NUEVA por STDIN completo (nunca una sola línea — ver
# el mismo razonamiento que lib/dbRecovery.sh sobre saltos de línea
# embebidos) y la valida contra el contrato cerrado (lib/
# secretValueContract.mjs) ANTES de aplicarla. Imprime "true"/"false" a
# stdout.
_espo_set_admin_password() {
  local service="$1" admin_user="$2"
  local pw
  IFS= read -r -d '' pw || true
  if ! gapssa_secrets_validate_value "$pw"; then
    unset pw
    printf 'false'
    return
  fi
  local ok=false
  if printf '%s\n' "$pw" | _gapssa_compose exec -T "$service" bin/command set-password "$admin_user" >/dev/null 2>&1; then
    ok=true
  fi
  unset pw
  printf '%s' "$ok"
}

# _espo_verify_credential_json <curl_cfg> <port>
# curl_cfg ya debe llevar la credencial configurada (Basic Auth admin, o
# header X-Api-Key) — comprueba GET /api/v1/App/user. Imprime
# "true"/"false".
_espo_verify_credential_json() {
  local curl_cfg="$1" port="$2"
  if curl -K "$curl_cfg" -sS -o /dev/null "http://localhost:${port}/api/v1/App/user" 2>/dev/null; then
    printf 'true'
  else
    printf 'false'
  fi
}

# _espo_find_user_id_by_username <curl_admin_cfg> <port> <username> <expected_type>
# Reutiliza el reductor cerrado de aclRest.sh (Bloque 4) — imprime solo
# el id opaco, cadena vacía si no hay EXACTAMENTE un User con ese
# userName, si la consulta falló, O SI el User encontrado no tiene
# `type` == <expected_type> (Revisión 2, punto 5: un User con el
# userName correcto pero de otro tipo NUNCA cuenta como "encontrado" —
# el llamador debe tratarlo exactamente igual que "ausente", nunca
# como una coincidencia parcial válida).
_espo_find_user_id_by_username() {
  local curl_cfg="$1" port="$2" username="$3" expected_type="$4"
  local json
  json="$(_s9_fetch_user_by_username_json "$curl_cfg" "$port" "$username")"
  EXPECTED_TYPE="$expected_type" python3 -c 'import sys,json,os
try:
    d = json.load(sys.stdin)
    expected_type = os.environ["EXPECTED_TYPE"]
    if d.get("found") and d.get("type") == expected_type:
        print(d["id"])
    else:
        print("")
except Exception:
    print("")' <<<"$json"
}

# _espo_regenerate_api_key_and_write <curl_admin_cfg> <port> <user_id> <secrets_file> <schema_version>
#
# REVISIÓN 2 (punto 4) — la respuesta de
# POST /api/v1/UserSecurity/apiKey/generate (JSON con la API Key en
# claro) se procesa POR STREAMING, en un ÚNICO proceso Node
# (lib/updateSecretsFileField.mjs --json-field apiKey): `curl` escribe su
# stdout DIRECTAMENTE al pipe de entrada de ese proceso — nunca pasa por
# un fichero regular del host, ni siquiera uno temporal registrado. Ese
# mismo proceso Node reutiliza el patrón atómico aceptado en el Bloque 2
# (temporal FIJADO en el mismo directorio que $SECRETS_FILE, O_NOFOLLOW,
# fstat contra el pin, fsync, revalidación por lstat, rename atómico,
# verificación del destino, fsync del directorio) para actualizar
# ÚNICAMENTE el campo ESPOCRM_API_KEY — nunca O_TRUNC directo sobre
# $SECRETS_FILE, nunca una reescritura de línea "a mano" desde bash.
#
# <schema_version> (Bloque 6) — SIEMPRE explícito, nunca "active" a
# ciegas: el llamador (gate_s4 o la recuperación de S4) DEBE pasar el
# resultado real de current_secrets_schema_version() — S4 se ejecuta
# ANTES que S7 en el orden real S1→S9, así que el documento puede seguir
# teniendo forma "legacy-pre-s7" en ese momento (bug real, detectado y
# corregido durante el Bloque 6).
#
# Imprime "true"/"false" a stdout — nunca la clave nueva.
_espo_regenerate_api_key_and_write() {
  local curl_cfg="$1" port="$2" user_id="$3" secrets_file="$4" schema_version="$5"

  local pin_lines
  pin_lines="$(gapssa_secrets_mktemp_secure_same_dir "$secrets_file" apikey)" || {
    printf 'false'
    return
  }
  local tmp dir dev ino uid mode
  {
    read -r tmp
    read -r dir
    read -r dev ino uid mode
  } <<<"$pin_lines"

  if ! gapssa_secrets_verify_pinned_tmp "$tmp" "$dir" "$dev" "$ino" "$uid" "$mode"; then
    printf 'false'
    return
  fi
  gapssa_cleanup_push shred_pinned_tmp "$tmp" "$dir" "$dev" "$ino" "$uid" "$mode"

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local ok=false rc=0
  if curl -K "$curl_cfg" -sS -X POST -H "Content-Type: application/json" \
    --data "{\"id\":\"${user_id}\"}" \
    "http://localhost:${port}/api/v1/UserSecurity/apiKey/generate" |
    node "$script_dir/updateSecretsFileField.mjs" "$secrets_file" "$tmp" "$dev" "$ino" "$uid" "$mode" ESPOCRM_API_KEY "$schema_version" --json-field apiKey >/dev/null 2>&1; then
    ok=true
  else
    rc=$?
  fi

  # rc=13 de updateSecretsFileField.mjs es el ÚNICO caso en el que el
  # rename YA se ejecutó pese al código de salida no-cero (ver el propio
  # script) — todos los demás códigos garantizan que $secrets_file nunca
  # se tocó y que el temporal sigue en su sitio (o nunca llegó a existir
  # con contenido), así que la limpieza normal del temporal fijado sigue
  # siendo correcta para ellos.
  if [ "$ok" = true ] || [ "$rc" = 13 ]; then
    gapssa_cleanup_pop_matching shred_pinned_tmp "$tmp" "$dir" "$dev" "$ino" "$uid" "$mode"
  else
    gapssa_secrets_shred_pinned "$tmp" "$dir" "$dev" "$ino" "$uid" "$mode" || true
    gapssa_cleanup_pop_matching shred_pinned_tmp "$tmp" "$dir" "$dev" "$ino" "$uid" "$mode"
  fi

  printf '%s' "$ok"
}
