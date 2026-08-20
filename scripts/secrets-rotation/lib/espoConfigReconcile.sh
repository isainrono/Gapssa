# scripts/secrets-rotation/lib/espoConfigReconcile.sh — S3B (reconciliación
# de data/config-internal.php) helpers.
#
# Motivación real (sesión que escribió este fichero): una ejecución de S3
# llegó hasta "sincronizó config-internal.php" y solo falló en el
# app-check final — pero una sonda de solo lectura posterior
# (probes/dbConfigLayerProbe.sh) mostró MariaDB y el almacén externo
# coordinados (`stored_credential_authenticates=true`) con
# `config_internal_matches_store=false`: el fichero se quedó con un valor
# antiguo pese a que `_espo_sync_config_password` (lib/dbRecovery.sh)
# había informado éxito. Causa raíz confirmada leyendo el propio código
# de esa función (nunca inventada): aceptaba `rename()` como éxito sin
# ninguna relectura posterior que confirmara el valor realmente escrito —
# ver el informe de entrega de esa sesión para el detalle completo (orden
# de fsync/rename corregido, relectura añadida, ver dbRecovery.sh).
#
# S3B existe para reconciliar ESE desajuste concreto SIN volver a rotar
# ninguna credencial: MariaDB y el almacén ya están de acuerdo (lo exige
# como precondición dura) — solo hay que conseguir que
# data/config-internal.php refleje el valor que ambos ya comparten.
#
# Decisión de diseño deliberada: NINGUNA operación de fichero de este
# fichero usa `docker compose exec` contra el contenedor real de
# `espocrm` (que puede estar en bucle de reinicio — un `exec` contra un
# contenedor que se reinicia cada pocos segundos es frágil por
# construcción). Todas leen/escriben `data/config-internal.php` a través
# de un contenedor DESECHABLE de la MISMA imagen que monta el volumen
# real `espocrm-data` directamente (`:ro` para lectura, sin `:ro` para la
# única escritura) — exactamente el mismo patrón, ya endurecido y
# probado, que probes/dbConfigLayerProbe.sh. Esto hace estas funciones
# indiferentes a si `espocrm` está sano, parado o en bucle de reinicio.
#
# El llamador DEBE definir `_gapssa_compose` (para parar/arrancar los
# SERVICIOS reales) antes de fuente este fichero — mismo contrato que
# lib/dbRecovery.sh y lib/dbRootRecovery.sh. Requiere también que
# lib/dbRootRecovery.sh ya esté fuente (reutiliza
# `_s3a_resolve_compose_volume_name`).
#
# Contrato de secretos: igual que el resto del toolkit — SIEMPRE por
# STDIN, nunca argv/env, nunca en la salida (que es "true"/"false" o
# texto de diagnóstico sin el valor).

# _s3b_stat_and_digest <image> <volume>
# Imprime "owner group mode size sha256" (5 campos) de
# data/config-internal.php dentro de <volume>, vía un contenedor
# desechable :ro — o nada + rc=1 si el fichero no existe/no se puede leer.
# Nunca imprime contenido.
_s3b_stat_and_digest() {
  local image="$1" volume="$2"
  docker run --rm --entrypoint sh \
    -v "${volume}:/var/www/html/data:ro" \
    "$image" -c '
      p=/var/www/html/data/config-internal.php
      [ -f "$p" ] || exit 1
      owner="$(stat -c %U "$p" 2>/dev/null)" || exit 1
      group="$(stat -c %G "$p" 2>/dev/null)" || exit 1
      mode="$(stat -c %a "$p" 2>/dev/null)" || exit 1
      size="$(stat -c %s "$p" 2>/dev/null)" || exit 1
      sha="$(sha256sum "$p" 2>/dev/null | cut -d" " -f1)" || exit 1
      [ -n "$sha" ] || exit 1
      printf "%s %s %s %s %s\n" "$owner" "$group" "$mode" "$size" "$sha"
    ' 2>/dev/null
}

# _s3b_php_lint <image> <volume> -> "true"/"false"
_s3b_php_lint() {
  local image="$1" volume="$2"
  docker run --rm --entrypoint php \
    -v "${volume}:/var/www/html/data:ro" \
    "$image" -l /var/www/html/data/config-internal.php >/dev/null 2>&1 \
    && printf true || printf false
}

# _s3b_backup_encrypted <image> <volume> <out_path> <passfile>
# Cifra un backup byte a byte de data/config-internal.php (streaming,
# nunca un temporal en claro), reutilizando el mismo cifrado que
# backup_secrets_file (aes-256-cbc -pbkdf2 -salt). Imprime "true"/"false".
_s3b_backup_encrypted() {
  local image="$1" volume="$2" out="$3" passfile="$4"
  local umask_saved rc=0
  umask_saved="$(umask)"
  umask 077
  # Bajo `set -euo pipefail` (heredado del script que fuente esto), una
  # tubería usada como sentencia de nivel superior SÍ dispara errexit si
  # falla — capturar `$?` en la línea siguiente nunca llega a ejecutarse
  # en ese caso. Envolverla en `if ... ; then ... ; else ... ; fi` es lo
  # que la exime (mismo motivo por el que el resto de funciones de este
  # fichero usan `if cmd; then ok=true; fi`, nunca una tubería suelta).
  if docker run --rm --entrypoint cat \
    -v "${volume}:/var/www/html/data:ro" \
    "$image" /var/www/html/data/config-internal.php 2>/dev/null \
    | openssl enc -aes-256-cbc -pbkdf2 -salt -out "$out" -pass "file:$passfile" 2>/dev/null; then
    rc=0
  else
    rc=1
  fi
  umask "$umask_saved"
  if [ "$rc" != 0 ]; then
    rm -f -- "$out"
    printf false
    return
  fi
  chmod 600 "$out"
  printf true
}

# _s3b_backup_digest <out_path> <passfile>
# Descifra EN STREAMING (nunca a disco en claro) y devuelve el digest
# SHA-256 del contenido — para comparar contra el digest capturado antes
# de cifrar, sin volver a materializar el plano. Cadena vacía si el
# backup no descifra (passphrase incorrecta, bytes corruptos) — NUNCA
# deja que ese fallo interrumpa al llamador vía errexit (ver nota en
# _s3b_backup_encrypted): un backup corrupto/no descifrable simplemente
# no reproduce NINGÚN digest válido, lo que el llamador ya trata como
# "no coincide" al compararlo contra el digest original.
_s3b_backup_digest() {
  local out="$1" passfile="$2" digest=""
  if digest="$(openssl enc -d -aes-256-cbc -pbkdf2 -salt -in "$out" -pass "file:$passfile" 2>/dev/null | sha256sum 2>/dev/null | cut -d' ' -f1)"; then
    printf '%s' "$digest"
  else
    printf ''
  fi
}

# _s3b_write_password_only <image> <volume>
# Lee la contraseña NUEVA por STDIN (bytes completos, nunca recortados),
# valida el contrato de secretos, y reescribe SOLO
# data/config-internal.php['database']['password'] dentro de <volume> —
# vía un contenedor desechable RW (nunca el contenedor real de espocrm).
# Escritura atómica: O_CREAT|O_EXCL (nunca sigue un symlink/fichero
# existente), fsync antes de rename, relectura posterior que compara el
# valor REALMENTE escrito byte a byte con el que se pidió escribir —
# nunca se informa éxito solo porque rename() no falló (la causa raíz
# real que motiva este fichero). Restaura después el propietario/modo que
# tenía el fichero ANTES de la escritura (pasados como argumentos,
# capturados por el llamador vía _s3b_stat_and_digest antes de escribir).
# Imprime "true"/"false" — nunca el valor.
_s3b_write_password_only() {
  local image="$1" volume="$2" orig_owner="$3" orig_group="$4" orig_mode="$5"
  local pw
  IFS= read -r -d '' pw || true
  if ! gapssa_secrets_validate_value "$pw"; then
    unset pw
    printf false
    return
  fi
  local ok=false
  if printf '%s' "$pw" | docker run --rm -i --entrypoint php \
    -v "${volume}:/var/www/html/data" \
    -e S3B_ORIG_OWNER="$orig_owner" -e S3B_ORIG_GROUP="$orig_group" -e S3B_ORIG_MODE="$orig_mode" \
    "$image" -r '
$new = stream_get_contents(STDIN);
$path = "/var/www/html/data/config-internal.php";
if (!is_file($path)) { fwrite(STDERR, "config-internal.php ausente\n"); exit(1); }
$config = include $path;
if (!is_array($config) || !isset($config["database"]) || !is_array($config["database"])) {
    fwrite(STDERR, "config-internal.php: forma inesperada\n");
    exit(1);
}
$config["database"]["password"] = $new;
$out = "<?php\nreturn " . var_export($config, true) . ";\n";
$tmp = $path . ".s3b.tmp." . getmypid();
if (is_link($tmp) || file_exists($tmp)) { fwrite(STDERR, "temporal ya existe\n"); exit(1); }
$fh = fopen($tmp, "x");
if ($fh === false) { fwrite(STDERR, "open failed\n"); exit(1); }
$st = fstat($fh);
if (!$st || $st["nlink"] !== 1) { fclose($fh); @unlink($tmp); fwrite(STDERR, "fstat inesperado\n"); exit(1); }
if (flock($fh, LOCK_EX) === false) { fclose($fh); @unlink($tmp); fwrite(STDERR, "lock failed\n"); exit(1); }
if (fwrite($fh, $out) === false) { fclose($fh); @unlink($tmp); fwrite(STDERR, "write failed\n"); exit(1); }
fflush($fh);
fsync($fh);
flock($fh, LOCK_UN);
fclose($fh);
if (!rename($tmp, $path)) { @unlink($tmp); fwrite(STDERR, "rename failed\n"); exit(1); }
$verify = include $path;
if (!is_array($verify) || !isset($verify["database"]["password"]) || $verify["database"]["password"] !== $new) {
    fwrite(STDERR, "post-write readback mismatch\n");
    exit(1);
}
$mode = octdec(getenv("S3B_ORIG_MODE"));
@chmod($path, $mode);
@chown($path, getenv("S3B_ORIG_OWNER"));
@chgrp($path, getenv("S3B_ORIG_GROUP"));
clearstatcache(true, $path);
$after = stat($path);
$actualMode = $after !== false ? substr(sprintf("%o", $after["mode"]), -4) : null;
if ($actualMode !== null && ltrim($actualMode, "0") !== ltrim(getenv("S3B_ORIG_MODE"), "0")) {
    fwrite(STDERR, "no se pudo restaurar el modo original\n");
    exit(1);
}
' >/dev/null 2>&1; then
    ok=true
  fi
  unset pw
  printf '%s' "$ok"
}

# _s3b_restore_from_backup <image> <volume> <backup_path> <passfile> <owner> <group> <mode>
# Restaura data/config-internal.php EXACTAMENTE como estaba (contenido +
# propietario + modo), descifrando el backup en streaming hacia un
# contenedor desechable RW. Nunca se usa para aplicar una credencial
# nueva — solo para volver al estado de ANTES de que S3B tocara nada.
# Imprime "true"/"false".
_s3b_restore_from_backup() {
  local image="$1" volume="$2" out="$3" passfile="$4" owner="$5" group="$6" mode="$7"
  local ok=false
  if openssl enc -d -aes-256-cbc -pbkdf2 -salt -in "$out" -pass "file:$passfile" 2>/dev/null \
    | docker run --rm -i --entrypoint sh \
      -v "${volume}:/var/www/html/data" \
      -e S3B_OWNER="$owner" -e S3B_GROUP="$group" -e S3B_MODE="$mode" \
      "$image" -c '
        p=/var/www/html/data/config-internal.php
        tmp="${p}.s3b.restore.$$"
        cat >"$tmp"
        chmod "$S3B_MODE" "$tmp"
        chown "$S3B_OWNER:$S3B_GROUP" "$tmp" 2>/dev/null || true
        mv -f "$tmp" "$p"
      '; then
    ok=true
  fi
  printf '%s' "$ok"
}

# _s3b_stop_service_stack <espocrm_service> <daemon_service> <websocket_service> [timeout]
# Para los tres contenedores LIMPIAMENTE (docker compose stop — nunca
# kill/rm), en este orden, y espera confirmación de parada de cada uno.
# Corta el bucle de reinicio indefinido de espocrm ANTES de escribir
# nada. Imprime "true"/"false".
_s3b_stop_service_stack() {
  local espocrm="$1" daemon="$2" websocket="$3" timeout="${4:-60}"
  local cid_espocrm
  cid_espocrm="$(_gapssa_compose ps -q "$espocrm" 2>/dev/null || true)"
  if ! _gapssa_compose stop "$espocrm" "$daemon" "$websocket" >/dev/null 2>&1; then
    printf false
    return
  fi
  if [ -n "$cid_espocrm" ] && ! _s3a_wait_container_stopped "$cid_espocrm" "$timeout"; then
    printf false
    return
  fi
  printf true
}
