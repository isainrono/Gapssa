# scripts/secrets-rotation/lib/dbRootRecovery.sh — S3A (recuperación de
# ROOT de MariaDB cuando NINGUNA credencial conocida autentica)
#
# Contexto real que motiva este fichero: una ejecución real de S3
# (rotate-all-interactive.sh::gate_s3) falló en su PRIMERA autenticación
# root — "ERROR 1045 (28000)" — antes de generar/aplicar ninguna
# contraseña nueva (ver el informe de entrega de la sesión que escribió
# este fichero para la traza línea a línea que lo demuestra). Causa
# raíz, confirmada leyendo el ENTRYPOINT REAL de la imagen local
# `mariadb:11.4` (nunca inventada, nunca inferida de documentación
# externa): `docker-entrypoint.sh` solo aplica `MARIADB_ROOT_PASSWORD` al
# volumen la PRIMERA vez que arranca contra un `$DATADIR` vacío
# (`DATABASE_ALREADY_EXISTS` se fija únicamente por `[ -d
# "$DATADIR/mysql" ]` — ver `_main`/`docker_setup_env` en el propio
# script vendido dentro de la imagen). En cualquier arranque posterior
# contra un volumen YA inicializado, esa variable de entorno se IGNORA
# por completo — así que si el valor de ESPOCRM_DB_ROOT_PASSWORD en el
# almacén externo cambió alguna vez sin que un ALTER USER equivalente
# llegara a aplicarse con éxito contra el volumen real (rotación
# interrumpida, restauración de un backup más antiguo, edición manual),
# el volumen y el almacén quedan en dos valores distintos de forma
# silenciosa — ningún arranque de `docker compose up` lo detecta ni lo
# corrige. Esta es la deriva que S3A recupera.
#
# S3A usa el mecanismo OFICIAL de MariaDB para pérdida de contraseña root
# (documentado en el KB oficial de MariaDB: arrancar `mariadbd` con
# `--skip-grant-tables --skip-networking`, que desactiva la comprobación
# de privilegios y TODO acceso por red — solo queda alcanzable por un
# socket UNIX local — y permite `ALTER USER`/`FLUSH PRIVILEGES` sin
# conocer ninguna contraseña anterior) contra un contenedor DESECHABLE
# separado que monta el MISMO volumen — nunca contra el contenedor real
# `espocrm-db`/`gapssa-espocrm-db-1` en marcha, y nunca reinicializa ni
# recrea el volumen. Verificado empíricamente en infraestructura
# desechable (tests/s3a_root_recovery_rehearsal.sh) antes de proponerse
# para uso real.
#
# El llamador DEBE definir `_gapssa_compose` ANTES de fuente este
# fichero (mismo contrato que lib/dbRecovery.sh) para las operaciones
# sobre el SERVICIO real (parar/arrancar `espocrm-db`). Las operaciones
# de recuperación en sí (contenedor temporal) usan `docker run`/`docker
# exec`/`docker rm` DIRECTOS, nunca `docker compose` — necesitan
# bypasear el entrypoint compuesto normal y montar el volumen con un
# comando explícito que `compose.yml` no expresa.
#
# Contrato de secretos: igual que lib/dbRecovery.sh — SIEMPRE por STDIN,
# validado con `gapssa_secrets_validate_value` antes de tocar red/disco,
# nunca argv, nunca variable de entorno, nunca en la salida de estas
# funciones (que es siempre "true"/"false"/texto de diagnóstico sin el
# valor, o una lista de HOSTS — nunca contraseñas — para enumerar
# cuentas).

# _s3a_resolve_compose_volume_name <project> <volume_key>
# Nunca asume la convención `${project}_${volume_key}` a ciegas (varía
# entre versiones/config de Compose) — resuelve por LABEL exacto, mismo
# patrón que tests/disposable-infra.sh. Cadena vacía + rc=1 si no hay
# EXACTAMENTE un volumen con esos dos labels.
_s3a_resolve_compose_volume_name() {
  local project="$1" volume_key="$2"
  local ids
  ids="$(docker volume ls -q \
    --filter "label=com.docker.compose.project=${project}" \
    --filter "label=com.docker.compose.volume=${volume_key}" 2>/dev/null || true)"
  local count
  count="$(printf '%s\n' "$ids" | grep -c . || true)"
  if [ "$count" != 1 ]; then
    printf ''
    return 1
  fi
  printf '%s' "$ids"
}

# _s3a_container_running <container_id_or_name> -> true/false
_s3a_container_running() {
  local c="$1" st
  st="$(docker inspect --format '{{.State.Running}}' "$c" 2>/dev/null || true)"
  [ "$st" = "true" ] && printf 'true' || printf 'false'
}

# _s3a_wait_container_stopped <container_id_or_name> [timeout_seconds]
# Sondea hasta que State.Running=false. Fail closed (return 1) por
# ausencia de contenedor O timeout — nunca asume "parado" por defecto.
_s3a_wait_container_stopped() {
  local c="$1" timeout="${2:-60}" waited=0 st
  while [ "$waited" -lt "$timeout" ]; do
    st="$(docker inspect --format '{{.State.Running}}' "$c" 2>/dev/null || true)"
    [ -z "$st" ] && return 0 # ya no existe -> no está corriendo
    [ "$st" = "false" ] && return 0
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# _s3a_other_running_containers_using_volume <volume_name>
#
# Enumera, por NOMBRE, cualquier contenedor ACTUALMENTE EN MARCHA (de
# CUALQUIER proyecto Compose, no solo el nuestro — Docker no impide por
# defecto que dos contenedores no relacionados monten el mismo volumen a
# la vez) cuyos `Mounts` incluyan `<volume_name>` como volumen con
# nombre. Un único fichero JSON de `docker inspect` para TODOS los
# contenedores en marcha (nunca N invocaciones sueltas) — mismo patrón
# que `tests/disposable-infra.sh::_snapshot_real_compose_resources`.
# Imprime una línea por nombre de contenedor encontrado, cadena vacía si
# ninguno. El llamador DEBE tratar CUALQUIER resultado no vacío como
# abortar-sin-tocar-nada: un segundo montador simultáneo (incluso de
# solo lectura) es exactamente el escenario que invalida la garantía de
# "backup consistente + único escritor" del resto de esta puerta.
_s3a_other_running_containers_using_volume() {
  local volume_name="$1"
  local ids
  ids="$(docker ps -q 2>/dev/null || true)"
  [ -n "$ids" ] || {
    printf ''
    return 0
  }
  # shellcheck disable=SC2086
  docker inspect $ids 2>/dev/null | VOLNAME="$volume_name" python3 -c "
import json, os, sys
vol = os.environ['VOLNAME']
try:
    containers = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for c in containers:
    for m in (c.get('Mounts') or []):
        if m.get('Type') == 'volume' and m.get('Name') == vol:
            print((c.get('Name') or '').lstrip('/'))
            break
" 2>/dev/null
}

# _s3a_backup_dir_has_space <dir> <min_kb>
_s3a_backup_volume_has_space() {
  local dir="$1" min_kb="${2:-51200}" avail_kb
  avail_kb="$(df -Pk "$dir" 2>/dev/null | awk 'NR==2 {print $4}')"
  [ -n "$avail_kb" ] && [ "$avail_kb" -ge "$min_kb" ]
}

# _s3a_backup_volume_encrypted <image> <volume_name> <out_path> <passfile>
#
# Backup EN STREAMING, con la base de datos ya parada limpiamente (el
# llamador es responsable de eso ANTES de invocar esta función — nunca
# se comprueba aquí, para no acoplar esta función a `_gapssa_compose`):
# un contenedor DESECHABLE monta <volume_name> de SOLO LECTURA (`:ro`),
# jamás escribe en él, y transmite `tar` por su stdout hacia
# `openssl enc` en el HOST — el contenido en claro del volumen nunca
# toca un fichero regular sin cifrar, ni siquiera temporal. Mismo
# algoritmo (AES-256-CBC + PBKDF2) que backup_secrets_file() en
# rotate-all-interactive.sh, mismo `_backup_passfile` de esa misma
# sesión (un único secreto de recuperación por sesión, nunca dos frases
# distintas que recordar). El contenedor efímero se etiqueta y se borra
# SIEMPRE, éxito o fallo.
#
# Además del propio backup cifrado, escribe `<out_path>.digest`
# (SHA-256 en claro del flujo `tar` ORIGINAL, vía lib/digestStream.mjs —
# mismo programa que ya usa backup_secrets_file() en
# rotate-all-interactive.sh, nunca una segunda implementación de
# digest). Es DELIBERADAMENTE una SEGUNDA pasada de `tar` sobre el mismo
# volumen ya parado (idéntico patrón, por la misma razón, que
# backup_secrets_file()::_backup_plaintext_stream, invocada dos veces —
# nunca una única captura reutilizada). Necesario porque, verificado
# empíricamente durante el ensayo desechable (Bloque de entrega de
# S3A): `tar -tf` (listado, sin extraer) NUNCA valida el contenido de
# los bloques de DATOS de cada fichero, solo recorre cabeceras — un tar
# plano (sin gzip) con bytes de CONTENIDO corrompidos por un fallo de
# hardware/transmisión puede superar `tar -tf` sin que se detecte nada.
# El digest, comparado en _s3a_verify_backup_structural contra el
# descifrado del propio backup, sí lo detecta siempre (cualquier byte
# distinto cambia el digest). El digest en sí NUNCA es secreto (es de
# datos de aplicación, no de credenciales) pero se guarda con modo 600
# de todas formas, por higiene consistente con el resto del toolkit.
#
# Devuelve "true"/"false" a stdout. <out_path> DEBE existir ya
# (reservado atómicamente por el llamador, igual que backup_secrets_file
# reserva el nombre del backup del almacén externo) — esta función solo
# escribe DENTRO de él (y de `<out_path>.digest`), nunca decide su nombre.
_s3a_backup_volume_encrypted() {
  local image="$1" volume_name="$2" out_path="$3" passfile="$4"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local helper_name
  helper_name="gapssa-s3a-backup-$(_gapssa_secrets_random_suffix_hex 4)"

  local rc=0
  if ! docker run --rm -i \
    --network none \
    --label "com.gapssa.rotation-s3a=1" \
    --name "$helper_name" \
    -v "${volume_name}:/gapssa-s3a-src:ro" \
    "$image" \
    tar -C /gapssa-s3a-src -cf - . 2>/dev/null |
    openssl enc -aes-256-cbc -pbkdf2 -salt -out "$out_path" -pass "file:$passfile" 2>/dev/null; then
    rc=1
  fi
  # `docker run --rm` ya retira el contenedor al salir en el camino
  # normal — refuerzo best-effort por si quedó huérfano (p.ej. el propio
  # `docker run` murió antes de poder autolimpiarse).
  docker rm -f "$helper_name" >/dev/null 2>&1 || true
  if [ "$rc" != 0 ] || [ ! -s "$out_path" ]; then
    printf 'false'
    return
  fi

  local digest_helper_name
  digest_helper_name="gapssa-s3a-digest-$(_gapssa_secrets_random_suffix_hex 4)"
  local digest
  digest="$(docker run --rm -i \
    --network none \
    --label "com.gapssa.rotation-s3a=1" \
    --name "$digest_helper_name" \
    -v "${volume_name}:/gapssa-s3a-src:ro" \
    "$image" \
    tar -C /gapssa-s3a-src -cf - . 2>/dev/null |
    node "$script_dir/digestStream.mjs" 2>/dev/null)" || true
  docker rm -f "$digest_helper_name" >/dev/null 2>&1 || true
  if [ -z "$digest" ]; then
    rm -f -- "$out_path"
    printf 'false'
    return
  fi
  printf '%s\n' "$digest" >"${out_path}.digest"
  chmod 600 "${out_path}.digest"
  unset digest
  printf 'true'
}

# _s3a_verify_backup_structural <image> <in_path> <passfile>
#
# Verificación de restaurabilidad EN STREAMING, sin extraer nada a
# disco: descifra <in_path> DOS VECES — una para validarlo con
# `tar -tf -` (listado estructural — cabeceras, truncamiento) y otra
# para comparar su digest SHA-256 contra `<in_path>.digest` (contenido
# byte a byte, ver _s3a_backup_volume_encrypted para por qué el listado
# por sí solo NO basta). El propio flujo descifrado nunca toca un
# fichero regular. No sustituye a un ensayo completo de extracción (ver
# tests/s3a_root_recovery_rehearsal.sh, que SÍ hace una extracción y
# `diff` completos contra infraestructura desechable) — es la
# verificación barata y segura de ejecutar contra un backup real, cuyo
# volumen puede pesar mucho más que un `.env`.
_s3a_verify_backup_structural() {
  local image="$1" in_path="$2" passfile="$3"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  local digest_file="${in_path}.digest"
  [ -f "$digest_file" ] || {
    printf 'false'
    return
  }
  local expected_digest
  expected_digest="$(cat "$digest_file" 2>/dev/null || true)"
  [ -n "$expected_digest" ] || {
    printf 'false'
    return
  }

  if ! openssl enc -d -aes-256-cbc -pbkdf2 -in "$in_path" -pass "file:$passfile" 2>/dev/null |
    docker run --rm -i --network none "$image" tar -tf - >/dev/null 2>&1; then
    unset expected_digest
    printf 'false'
    return
  fi

  local actual_digest
  actual_digest="$(openssl enc -d -aes-256-cbc -pbkdf2 -in "$in_path" -pass "file:$passfile" 2>/dev/null |
    node "$script_dir/digestStream.mjs" 2>/dev/null)" || true
  if [ -n "$actual_digest" ] && [ "$actual_digest" = "$expected_digest" ]; then
    unset expected_digest actual_digest
    printf 'true'
  else
    unset expected_digest actual_digest
    printf 'false'
  fi
}

# _s3a_start_recovery_container <image> <volume_name> <container_name> <socket_path>
#
# Arranca el contenedor DESECHABLE de recuperación: MISMO volumen (r/w —
# imprescindible, ALTER USER escribe en mysql.user), CERO variables de
# entorno de contraseña (el entrypoint real las ignora igualmente contra
# un volumen ya inicializado — ver cabecera de este fichero — así que ni
# siquiera se construyen), CERO red (`--network none`: `--skip-networking`
# ya impediría cualquier conexión TCP, pero no depender de esa única capa
# es defensa en profundidad), CERO puertos publicados. `--skip-grant-tables`
# es el mecanismo OFICIAL de recuperación (KB de MariaDB) — desactiva la
# comprobación de privilegios SOLO en este contenedor desechable, nunca en
# el real. Devuelve "true"/"false" a stdout (arranque aceptado por el
# daemon — no implica todavía que mariadbd esté listo, ver
# _s3a_wait_recovery_ready).
_s3a_start_recovery_container() {
  local image="$1" volume_name="$2" container_name="$3" socket_path="$4"
  if docker run -d \
    --network none \
    --label "com.gapssa.rotation-s3a=1" \
    --name "$container_name" \
    -v "${volume_name}:/var/lib/mysql" \
    "$image" \
    mariadbd --skip-grant-tables --skip-networking "--socket=${socket_path}" >/dev/null 2>&1; then
    printf 'true'
  else
    printf 'false'
  fi
}

# _s3a_wait_recovery_ready <container_name> <socket_path> [timeout_seconds]
# Sondea por SOCKET (nunca TCP — `--skip-networking` lo impediría de
# todas formas) hasta que `SELECT 1;` responde. Sin usuario/contraseña:
# bajo `--skip-grant-tables` CUALQUIER credencial (incluida ninguna)
# autentica — es, precisamente, el mecanismo de recuperación. Fail
# closed (return 1) por timeout.
_s3a_wait_recovery_ready() {
  local container_name="$1" socket_path="$2" timeout="${3:-60}" waited=0
  while [ "$waited" -lt "$timeout" ]; do
    if printf 'SELECT 1;' | docker exec -i "$container_name" \
      mariadb "--socket=${socket_path}" -u root >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

# _s3a_enumerate_root_hosts <container_name> <socket_path>
# Solo lectura. Imprime UN host por línea (columna `Host` de
# `mysql.user` para `User='root'`), orden estable. Cadena vacía si la
# consulta falla o no hay ninguna fila — el llamador decide qué hacer
# ante "cero filas root" (nunca asumido "una hipotética 'root'@'%''").
_s3a_enumerate_root_hosts() {
  local container_name="$1" socket_path="$2"
  printf "SELECT Host FROM mysql.user WHERE User='root' ORDER BY Host;" |
    docker exec -i "$container_name" mariadb "--socket=${socket_path}" -u root -N -B 2>/dev/null
}

# _s3a_apply_root_password_all <container_name> <socket_path> <host> [<host> ...]
#
# Lee la contraseña NUEVA por STDIN completo (protocolo ya usado en todo
# el toolkit — nunca `read` de una sola línea, ver lib/dbRecovery.sh
# sobre saltos de línea embebidos) y la aplica a TODAS las filas
# root@<host> indicadas EN UNA ÚNICA CONEXIÓN/SESIÓN. Esto es
# obligatorio, no cosmético — hallazgo REAL del ensayo desechable
# (Bloque de entrega de S3A), reproducido de forma aislada antes de
# aceptarse: bajo `--skip-grant-tables`, un `FLUSH PRIVILEGES` recarga
# las tablas de permisos EN MEMORIA y REACTIVA la comprobación de
# privilegios/autenticación para cualquier conexión NUEVA a partir de
# ese momento (comportamiento del propio servidor MariaDB, documentado
# como advertencia en el KB oficial: "if you run FLUSH PRIVILEGES, the
# server will begin using privileges again"). La primera versión de
# esta función abría una conexión NUEVA por cada host y hacía FLUSH
# PRIVILEGES antes Y después de cada una — funcionaba para el PRIMER
# host y luego fallaba con "Access denied for user 'root'@'localhost'
# (using password: NO)" en el segundo, porque el FLUSH del primer host
# ya había reactivado la autenticación real contra la fila que ACABABA
# de cambiar, y la conexión siguiente (sin contraseña, confiando en el
# bypass de skip-grant-tables) ya no calificaba. La secuencia OFICIAL
# del KB de MariaDB (FLUSH PRIVILEGES una vez ANTES de cualquier ALTER,
# todos los ALTER de la MISMA sesión, FLUSH PRIVILEGES una vez DESPUÉS)
# es precisamente para evitar esto — nunca reabrir una conexión a mitad.
#
# Quoting seguro por host: igual que _mariadb_apply_password_via_auth
# (lib/dbRecovery.sh) — base64 + FROM_BASE64() + QUOTE() +
# PREPARE/EXECUTE, la contraseña nunca se interpola directamente en el
# texto SQL. Rechaza cualquier <host> con comilla simple (nunca puede
# ser un host real válido de MariaDB) SIN ejecutar nada. Imprime
# "true"/"false" a stdout — "false" si CUALQUIER host de la lista falla
# (el cliente mariadb aborta el resto del script al primer error), o si
# la lista de hosts está vacía.
_s3a_apply_root_password_all() {
  local container_name="$1" socket_path="$2"
  shift 2
  local hosts=("$@")
  [ "${#hosts[@]}" -gt 0 ] || {
    printf 'false'
    return
  }
  local h
  for h in "${hosts[@]}"; do
    case "$h" in
    *"'"*)
      printf 'false'
      return
      ;;
    esac
  done

  local new_pw
  IFS= read -r -d '' new_pw || true
  if ! gapssa_secrets_validate_value "$new_pw"; then
    unset new_pw
    printf 'false'
    return
  fi
  local new_pw_b64
  new_pw_b64="$(printf '%s' "$new_pw" | base64 | tr -d '\n')"
  unset new_pw

  local sql_script
  sql_script="$(
    printf 'FLUSH PRIVILEGES;\n'
    for h in "${hosts[@]}"; do
      printf "SET @pw = FROM_BASE64('%s');\n" "$new_pw_b64"
      printf "SET @sql = CONCAT(\"ALTER USER 'root'@'%s' IDENTIFIED BY \", QUOTE(@pw));\n" "$h"
      printf 'PREPARE stmt FROM @sql;\n'
      printf 'EXECUTE stmt;\n'
      printf 'DEALLOCATE PREPARE stmt;\n'
      printf 'SET @sql = NULL;\n'
      printf 'SET @pw = NULL;\n'
    done
    printf 'FLUSH PRIVILEGES;\n'
  )"
  unset new_pw_b64
  local ok=false
  if printf '%s' "$sql_script" | docker exec -i "$container_name" \
    mariadb "--socket=${socket_path}" -u root >/dev/null 2>&1; then
    ok=true
  fi
  unset sql_script
  printf '%s' "$ok"
}

# _s3a_stop_recovery_container <container_name> <socket_path>
# Apagado LIMPIO del `mariadbd` desechable vía `mariadb-admin ... shutdown`
# (best effort — MariaDB ya hizo commit de cada ALTER USER
# individualmente, así que un fallo de apagado limpio nunca deja una
# escritura a medias, ver el mismo razonamiento ya documentado en
# gate_s3 sobre "commit implícito por sentencia") y SIEMPRE `docker rm
# -f` después, pase lo que pase — nunca deja el contenedor desechable
# corriendo con --skip-grant-tables activo más tiempo del imprescindible.
_s3a_stop_recovery_container() {
  local container_name="$1" socket_path="$2"
  docker exec -i "$container_name" mariadb-admin "--socket=${socket_path}" -u root shutdown >/dev/null 2>&1 || true
  local waited=0
  while [ "$waited" -lt 15 ]; do
    [ "$(_s3a_container_running "$container_name")" = "false" ] && break
    sleep 1
    waited=$((waited + 1))
  done
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}

# _gapssa_write_secret_field <secrets_file> <schema_version> <key_name>
#
# Actualización atómica de UN solo campo YA EXISTENTE en <secrets_file> —
# wrapper delgado sobre lib/updateSecretsFileField.mjs, mismo patrón
# aceptado en Bloque 2/5 (lib/espoRecovery.sh::
# _espo_regenerate_api_key_and_write): temporal FIJADO en el mismo
# directorio, identidad verificada por fstat/lstat, fsync, rename
# atómico, verificación del destino. Lee el valor NUEVO por STDIN
# completo (nunca argv). Nunca crea una clave nueva — <key_name> debe
# existir ya en el documento. Imprime "true"/"false" a stdout, nunca el
# valor. Genérico (no específico de S3A) a propósito: es la MISMA
# primitiva que cualquier recuperación futura de un campo único debería
# reutilizar, en vez de duplicar el patrón de pin+rename una vez más.
_gapssa_write_secret_field() {
  local secrets_file="$1" schema_version="$2" key_name="$3"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  local pin_lines
  pin_lines="$(gapssa_secrets_mktemp_secure_same_dir "$secrets_file" "field-${key_name}")" || {
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

  local new_pw
  IFS= read -r -d '' new_pw || true

  local ok=false rc=0
  if printf '%s' "$new_pw" | node "$script_dir/updateSecretsFileField.mjs" \
    "$secrets_file" "$tmp" "$dev" "$ino" "$uid" "$mode" "$key_name" "$schema_version" >/dev/null 2>&1; then
    ok=true
  else
    rc=$?
  fi
  unset new_pw

  if [ "$ok" = true ] || [ "$rc" = 13 ]; then
    gapssa_cleanup_pop_matching shred_pinned_tmp "$tmp" "$dir" "$dev" "$ino" "$uid" "$mode"
  else
    gapssa_secrets_shred_pinned "$tmp" "$dir" "$dev" "$ino" "$uid" "$mode" || true
    gapssa_cleanup_pop_matching shred_pinned_tmp "$tmp" "$dir" "$dev" "$ino" "$uid" "$mode"
  fi

  printf '%s' "$ok"
}
