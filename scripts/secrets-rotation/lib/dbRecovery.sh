# scripts/secrets-rotation/lib/dbRecovery.sh — Bloque 5 (Revisión 2)
#
# Helpers de aplicación/verificación de credenciales para la
# RECUPERACIÓN post-restauración de S2 (Postgres) y S3 (MariaDB) —
# fichero compartido, única fuente de verdad, entre `gate_s2`/`gate_s3`
# en rotate-all-interactive.sh y el ensayo desechable de Bloque 5
# (scripts/secrets-rotation/tests/s2_s5_recovery_rehearsal.sh).
#
# Contrato de secretos (lib/secretValueContract.mjs — Revisión 2, punto
# 1): SIEMPRE por STDIN, validado con `gapssa_secrets_validate_value`
# ANTES de tocar red/disco alguno; nunca argv, nunca variable de entorno
# visible en `docker inspect`/`ps`, nunca en el valor de retorno por
# stdout de estas funciones (que es siempre "true"/"false", o texto de
# diagnóstico SIN el valor dentro).
#
# El llamador DEBE definir, antes de fuente este fichero, una función
# `_gapssa_compose` que invoque `docker compose` con el contexto correcto
# (p.ej. `docker compose --env-file "$SECRETS_FILE"` en producción, o
# `docker compose -p "$PROJECT" -f "$COMPOSE_FILE"` en el ensayo
# desechable) — mismo patrón dinámico que `capture_cmd` en
# lib/aclRest.sh (Bloque 4). También es el requisito de la operación de
# limpieza `docker_rm_container_path` de lib.sh, que la invoca.
#
# --- PostgreSQL: vía administrativa real, verificada empíricamente ---
#
# `pg_hba.conf` de la imagen oficial `postgres:18-alpine` (comprobado
# directamente, nunca asumido) trae:
#   local   all   all                    trust
#   host    all   all   127.0.0.1/32     trust
#   host    all   all   ::1/128          trust
#   host    all   all   all              scram-sha-256
# La conexión por SOCKET UNIX dentro del contenedor (`docker ... exec ...
# psql` sin `-h`) NUNCA exige contraseña, para NINGÚN rol, sea cual sea
# su contraseña actual — es la vía administrativa que permite reaplicar
# una contraseña SIN conocer la que se está sustituyendo. Nótese que
# 127.0.0.1 TAMBIÉN es `trust` en esta imagen — por eso toda verificación
# real usa el nombre del SERVICIO en la red de compose (nunca loopback),
# cayendo en la línea `scram-sha-256` final, que sí es SCRAM real.
#
# REVISIÓN 2 — eliminado el mecanismo anterior (`\set raw_pw `cat
# ruta``, con la contraseña copiada a un fichero DENTRO del contenedor en
# la ruta FIJA `/tmp/.gapssa-pg-recover-pw` vía `docker compose cp`):
# sustituido por un diseño que NO necesita ningún fichero, ni fijo ni
# CSPRNG, dentro NI fuera del contenedor. La contraseña nueva se
# codifica en base64 (alfabeto seguro, sin metacaracteres SQL) EN
# MEMORIA, se embebe en el propio texto SQL — que viaja SIEMPRE por
# STDIN del `exec`, nunca por argv ni por un fichero — y el servidor la
# decodifica con `decode(...,'base64')` + `convert_from(...,'UTF8')`
# antes de componerla en `format('ALTER ROLE %I WITH PASSWORD %L', ...)`
# — `format()` hace el quoting de identificador/literal en el propio
# servidor, con `standard_conforming_strings=on` (el valor por defecto),
# así que ni bash ni psql necesitan escapar nada por su cuenta. Esto es
# estrictamente superior al mecanismo anterior: cero temporales que
# gestionar, cero rutas fijas, cero backtick/`cat` invocado por psql.
# Postgres redacta el valor de PASSWORD en `log_statement`/`pg_stat_
# statements` para sentencias ALTER/CREATE ROLE (comportamiento del
# propio servidor, documentado en su código fuente, `utility.c`) —
# comportamiento sin cambios respecto al mecanismo anterior, que también
# terminaba enviando la MISMA sentencia final `ALTER ROLE ... PASSWORD
# 'valor';` una vez psql interpolaba `:sql` del lado cliente.
#
# Probado empíricamente (Bloque 5, Revisión 2) con comilla simple,
# comilla doble, backslash, `$()`, backticks, `;`, `&`, espacios y
# Unicode válido — ver s2_s5_recovery_rehearsal.sh.

# _pg_apply_password_via_socket <service> <role> <db>
# Lee la contraseña NUEVA por STDIN completo — NUNCA `read -r` de una
# sola línea: una contraseña puede contener un salto de línea embebido,
# que un `read` normal (delimitado por '\n') truncaría en silencio,
# aplicando una contraseña más corta de la esperada sin ningún error
# visible (bug real detectado y corregido durante las pruebas de este
# bloque) — nótese que, desde la Revisión 2, ese salto de línea embebido
# ya nunca puede ser un valor VÁLIDO (el contrato cerrado del punto 1 lo
# rechaza), pero `read -r -d ''` se conserva de todos modos como defensa
# en profundidad: SIEMPRE lee hasta EOF sin truncar, sea cual sea el
# contenido, antes incluso de que el contrato tenga ocasión de
# rechazarlo. Imprime "true"/"false" a stdout — nunca el valor, nunca
# detalle de error que lo incluya.
_pg_apply_password_via_socket() {
  local service="$1" role="$2" db="$3"
  case "$role" in
  *"'"*)
    printf 'false'
    return
    ;;
  esac
  local pw
  IFS= read -r -d '' pw || true
  if ! gapssa_secrets_validate_value "$pw"; then
    unset pw
    printf 'false'
    return
  fi
  local pw_b64
  pw_b64="$(printf '%s' "$pw" | base64 | tr -d '\n')"
  unset pw
  local sql_script
  sql_script="$(
    printf "SELECT format('ALTER ROLE %%I WITH PASSWORD %%L', '%s', convert_from(decode('%s','base64'),'UTF8')) AS sql \\\\gset\n" "$role" "$pw_b64"
    printf ':sql;\n'
  )"
  unset pw_b64
  local ok=false
  if printf '%s' "$sql_script" | _gapssa_compose exec -T "$service" psql -v ON_ERROR_STOP=1 -U "$role" -d "$db" >/dev/null 2>&1; then
    ok=true
  fi
  unset sql_script
  printf '%s' "$ok"
}

# --- MariaDB: sin vía administrativa passwordless ---
#
# Comprobado empíricamente (Bloque 5) contra `mariadb:11.4`: `root`
# SIEMPRE exige contraseña, incluso por socket local dentro del propio
# contenedor, cuando `MARIADB_ROOT_PASSWORD` está fijado — a diferencia
# de Postgres, esta imagen NO ofrece ninguna vía administrativa sin
# contraseña. La recuperación de S3 solo puede aplicar una credencial
# MariaDB si YA tiene una credencial root que autentica (el valor
# restaurado, u otro conocido) — si ninguna autentica, la recuperación
# automática de esa cuenta concreta no es posible, es una limitación
# residual documentada, no un fallo silencioso: la función devuelve
# "false" y el llamador debe informarlo como server_coordination_required.
#
# Quoting seguro de la contraseña NUEVA: se codifica en base64 (alfabeto
# seguro, sin metacaracteres SQL) ANTES de entrar en el texto SQL; el
# servidor decodifica con `FROM_BASE64()` y compone la sentencia
# dinámica con `QUOTE()` (equivalente a `quote_literal` de Postgres),
# ejecutada vía `PREPARE`/`EXECUTE` — probado empíricamente con los
# mismos caracteres adversarios que Postgres. Ese texto SQL viaja SIEMPRE
# por STDIN del `exec`, nunca por argv.
#
# REVISIÓN 2 — eliminado `MYSQL_PWD=... mariadb -u ...` (variable de
# entorno del proceso `mariadb` dentro del contenedor, visible vía
# `/proc/<pid>/environ` para cualquier proceso con el mismo UID o root
# dentro de ese contenedor) para la contraseña de AUTENTICACIÓN: se
# sustituye por un FICHERO DE OPCIONES de cliente MariaDB
# (`--defaults-extra-file`, sección `[client]`, `password="..."` con el
# mismo escapado backslash/comilla-doble que ya usa
# gapssa_secrets_curl_cfg_escape para los ficheros `curl -K`) — nombre
# CSPRNG tanto en el host (gapssa_secrets_mktemp_secure) como dentro del
# contenedor (reutiliza el MISMO sufijo aleatorio del nombre del
# temporal del host, nunca la ruta fija anterior
# `/tmp/.gapssa-mariadb-recover-pw`), modo 600 antes de contener datos,
# comprobación de AUSENCIA antes de copiarlo dentro del contenedor,
# registrado INMEDIATAMENTE en la pila global de limpieza (lib.sh) tanto
# en el host como dentro del contenedor — se limpia ante éxito, fallo,
# SIGINT y TERM.

# _mariadb_apply_password_via_auth <service> <target_user> <target_host> <auth_user>
# Lee POR STDIN, en este orden, DOS valores separados por un byte NUL
# (`printf '%s\0%s' "$auth_pw" "$new_pw"`, nunca separados por '\n' — un
# valor puede contener un salto de línea embebido, que un delimitador de
# línea truncaría en silencio; NUL es, por construcción, el único byte
# que nunca puede aparecer en un valor bash, así que es el único
# delimitador de flujo seguro entre dos secretos, igual que el protocolo
# de huérfanos de lib.sh): la contraseña de AUTENTICACIÓN (auth_user) y
# la contraseña NUEVA a aplicar al target_user@target_host. Imprime
# "true"/"false" a stdout.
_mariadb_apply_password_via_auth() {
  local service="$1" target_user="$2" target_host="$3" auth_user="$4"
  case "$target_user$target_host$auth_user" in
  *"'"*)
    printf 'false'
    return
    ;;
  esac
  local auth_pw new_pw
  IFS= read -r -d '' auth_pw || true
  IFS= read -r -d '' new_pw || true
  if ! gapssa_secrets_validate_value "$auth_pw" || ! gapssa_secrets_validate_value "$new_pw"; then
    unset auth_pw new_pw
    printf 'false'
    return
  fi
  local new_pw_b64
  new_pw_b64="$(printf '%s' "$new_pw" | base64 | tr -d '\n')"
  unset new_pw

  local hostfile
  hostfile="$(gapssa_secrets_mktemp_secure gapssa-mariadb-recover-optfile)"
  gapssa_cleanup_push shred_plain "$hostfile"
  {
    printf '[client]\n'
    printf 'user="%s"\n' "$(gapssa_secrets_mariadb_cfg_escape "$auth_user")"
    printf 'password="%s"\n' "$(gapssa_secrets_mariadb_cfg_escape "$auth_pw")"
  } >"$hostfile"
  chmod 600 "$hostfile"
  unset auth_pw

  # Ruta CSPRNG dentro del contenedor: reutiliza el sufijo aleatorio ya
  # generado por `mktemp` para el fichero del host — nunca una ruta fija,
  # nunca un generador de aleatoriedad nuevo y separado.
  local container_path
  container_path="/tmp/.$(basename "$hostfile")"

  if _gapssa_compose exec -T "$service" sh -c "[ -e '$container_path' ]" >/dev/null 2>&1; then
    gapssa_cleanup_pop_matching shred_plain "$hostfile"
    gapssa_secrets_shred "$hostfile"
    unset new_pw_b64
    printf 'false'
    return
  fi
  if ! _gapssa_compose cp "$hostfile" "${service}:${container_path}" >/dev/null 2>&1; then
    gapssa_cleanup_pop_matching shred_plain "$hostfile"
    gapssa_secrets_shred "$hostfile"
    unset new_pw_b64
    printf 'false'
    return
  fi
  gapssa_cleanup_push docker_rm_container_path "$service" "$container_path"
  # Refuerza modo 600 dentro del contenedor — nunca se confía en que
  # `docker cp` preserve el modo de origen por contrato (no lo garantiza
  # documentalmente, aunque en la práctica suele hacerlo).
  _gapssa_compose exec -T "$service" chmod 600 "$container_path" >/dev/null 2>&1 || true

  gapssa_cleanup_pop_matching shred_plain "$hostfile"
  gapssa_secrets_shred "$hostfile"

  local sql_script
  sql_script="$(
    printf "SET @pw = FROM_BASE64('%s');\n" "$new_pw_b64"
    printf "SET @sql = CONCAT(\"ALTER USER '%s'@'%s' IDENTIFIED BY \", QUOTE(@pw));\n" "$target_user" "$target_host"
    printf 'PREPARE stmt FROM @sql;\n'
    printf 'EXECUTE stmt;\n'
    printf 'DEALLOCATE PREPARE stmt;\n'
    printf 'SET @sql = NULL;\n'
    printf 'SET @pw = NULL;\n'
  )"
  unset new_pw_b64
  local ok=false
  # `--defaults-extra-file` DEBE ser el primer argumento del cliente
  # MariaDB — aquí es el único, así que se cumple trivialmente. Ni la
  # contraseña de autenticación ni la nueva aparecen en argv ni en el
  # entorno del proceso `mariadb`.
  if printf '%s' "$sql_script" | _gapssa_compose exec -T "$service" mariadb "--defaults-extra-file=$container_path" >/dev/null 2>&1; then
    ok=true
  fi
  unset sql_script

  _gapssa_compose exec -T "$service" rm -f "$container_path" >/dev/null 2>&1 || true
  gapssa_cleanup_pop_matching docker_rm_container_path "$service" "$container_path"

  printf '%s' "$ok"
}

# _espo_sync_config_password <espocrm_service>
# Bloque 6 — hallazgo REAL del ensayo integral contra infraestructura
# desechable (nunca hipotético): la imagen oficial de EspoCRM solo
# escribe data/config-internal.php desde ESPOCRM_DATABASE_PASSWORD en el
# PRIMER arranque (cuando ese archivo todavía no existe). Contra una
# instancia YA instalada (el caso real: EspoCRM llevaba tiempo
# funcionando antes de rotar nada), rotar la contraseña MariaDB de
# 'espocrm' vía ALTER USER y simplemente reiniciar el contenedor deja
# config-internal.php con la contraseña VIEJA — EspoCRM entra en un
# bucle infinito de "Waiting for database connection", el contenedor
# nunca vuelve a quedar sano, y ni siquiera `bin/command` (que también
# depende de esa misma conexión) sirve para arreglarlo desde dentro.
# Reproducido y confirmado de forma aislada antes de este parche.
#
# Reescribe SOLO el campo 'password' de ese archivo con la contraseña
# NUEVA, leída por STDIN completo (nunca argv/env) — vía PHP puro
# (include + var_export, nunca arranca el framework de EspoCRM ni
# depende de que la conexión a BD funcione), con temporal+rename
# atómico dentro del propio contenedor. Si el archivo AÚN no existe
# (instancia sin instalar todavía — primer arranque real), no hace
# nada: el propio entrypoint la escribirá desde ESPOCRM_DATABASE_PASSWORD,
# como ya hacía. Imprime "true" (reescrito), "false" (fallo) o "skipped"
# (nada que reescribir) a stdout — nunca el valor.
_espo_sync_config_password() {
  local service="$1"
  # </dev/null es imprescindible: sin ella, esta comprobación (que no
  # necesita nada de entrada) hereda el MISMO stdin por el que llega la
  # contraseña nueva y se la traga en silencio -- el `read` de más abajo
  # encontraría entonces el pipe ya vacío, y la función fallaría con
  # "false" pese a que tanto la comprobación como la escritura PHP
  # funcionan perfectamente por separado (bug real, detectado por este
  # mismo ensayo integral: reproducible incluso con el resto de la
  # lógica intacta).
  if ! _gapssa_compose exec -T "$service" sh -c "[ -f /var/www/html/data/config-internal.php ]" </dev/null >/dev/null 2>&1; then
    printf 'skipped'
    return
  fi
  local pw
  IFS= read -r -d '' pw || true
  if ! gapssa_secrets_validate_value "$pw"; then
    unset pw
    printf 'false'
    return
  fi
  local ok=false
  if printf '%s' "$pw" | _gapssa_compose exec -T "$service" php -r '
$new = stream_get_contents(STDIN);
$path = "/var/www/html/data/config-internal.php";
$config = include $path;
if (!is_array($config) || !isset($config["database"]) || !is_array($config["database"])) {
    fwrite(STDERR, "config-internal.php: forma inesperada\n");
    exit(1);
}
$config["database"]["password"] = $new;
$out = "<?php\nreturn " . var_export($config, true) . ";\n";
$tmp = $path . ".tmp." . getmypid();
$fh = fopen($tmp, "x");
if ($fh === false) { fwrite(STDERR, "open failed\n"); exit(1); }
if (flock($fh, LOCK_EX) === false) { fclose($fh); @unlink($tmp); fwrite(STDERR, "lock failed\n"); exit(1); }
if (fwrite($fh, $out) === false) { fclose($fh); @unlink($tmp); fwrite(STDERR, "write failed\n"); exit(1); }
fflush($fh);
fsync($fh);
flock($fh, LOCK_UN);
fclose($fh);
chmod($tmp, 0664);
@chown($tmp, "www-data");
@chgrp($tmp, "www-data");
if (!rename($tmp, $path)) { fwrite(STDERR, "rename failed\n"); @unlink($tmp); exit(1); }
$verify = include $path;
if (!is_array($verify) || !isset($verify["database"]["password"]) || $verify["database"]["password"] !== $new) {
    fwrite(STDERR, "post-write readback mismatch\n");
    exit(1);
}
' >/dev/null 2>&1; then
    ok=true
  fi
  unset pw
  printf '%s' "$ok"
}

# _espo_config_password_matches <espocrm_service>
# Lee la contraseña ESPERADA por STDIN completo y compara (en PHP, sin
# imprimirla nunca) contra el valor REAL de
# data/config-internal.php['database']['password'] dentro del contenedor
# EN MARCHA de <espocrm_service> en este instante. Verificación
# INDEPENDIENTE de la relectura que ya hace _espo_sync_config_password
# (Bloque S3B): existe para que gate_s3 pueda comprobar, por su cuenta,
# tanto justo después de sincronizar (antes de reiniciar nada) como justo
# después de reiniciar (para detectar si el entrypoint u otra cosa
# reescribió el fichero durante la recreación del contenedor).
#
# Imprime "true" (coincide), "false" (NO coincide — se pudo comparar) o
# "unreachable" (el contenedor no respondió al exec, p.ej. a mitad de un
# reinicio, o el fichero no tiene la forma esperada — la comparación no
# se pudo hacer en absoluto). "unreachable" NUNCA debe tratarse como
# "false": el llamador decide si reintentar o tratarlo como inconcluyente.
_espo_config_password_matches() {
  local service="$1"
  local pw
  IFS= read -r -d '' pw || true
  if ! gapssa_secrets_validate_value "$pw"; then
    unset pw
    printf 'unreachable'
    return
  fi
  local out
  if ! out="$(printf '%s' "$pw" | _gapssa_compose exec -T "$service" php -r '
$expected = stream_get_contents(STDIN);
$path = "/var/www/html/data/config-internal.php";
if (!is_file($path)) { echo "unreachable"; exit(0); }
try {
    $config = include $path;
} catch (\Throwable $e) {
    echo "unreachable";
    exit(0);
}
if (!is_array($config) || !isset($config["database"]["password"]) || !is_string($config["database"]["password"])) {
    echo "unreachable";
    exit(0);
}
echo ($config["database"]["password"] === $expected) ? "true" : "false";
' 2>/dev/null)"; then
    out="unreachable"
  fi
  unset pw
  case "$out" in
  true | false) printf '%s' "$out" ;;
  *) printf 'unreachable' ;;
  esac
}
