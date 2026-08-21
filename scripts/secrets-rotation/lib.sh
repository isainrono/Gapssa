#!/usr/bin/env bash
# Funciones compartidas por los scripts de scripts/secrets-rotation/.
#
# Ninguna función de este archivo lee, imprime, genera ni transporta un
# valor secreto — solo valida RUTAS y CONDICIONES DE ENTORNO antes de que
# un script hermano tenga permiso para tocar un archivo de secretos, y
# ofrece utilidades de bajo nivel (ficheros temporales, máquina de
# estados) que los scripts hermanos reutilizan para no repetir lógica de
# seguridad.
#
# Pensado para ejecutarse EXCLUSIVAMENTE desde una terminal interactiva
# fuera de este harness (docs/runbook-rotacion-secretos-externa.md).
#
# No usar `set -x` en ningún script que cargue este archivo: un trace de
# shell puede imprimir valores de variables, incluidas rutas que a su vez
# podrían revelar nombres de archivo sensibles.
set -euo pipefail

# Rechaza cerrado (nunca intenta desactivarlo por su cuenta) si `set -x`
# ya está activo al cargar este archivo — un trace de shell imprime el
# valor de CUALQUIER variable usada en cada comando, incluidas rutas de
# ficheros temporales de secretos y, en el peor caso, fragmentos de
# secretos pasados como argumento en algún punto del código. `$-`
# contiene las opciones de shell activas como una cadena de letras; 'x'
# es la de xtrace.
case "$-" in
*x*)
  echo "ERROR: xtrace (set -x) está activo en esta shell — podría imprimir valores sensibles en la traza. Desactívalo (no usar 'bash -x' ni 'set -x' con estos scripts) y vuelve a intentarlo." >&2
  exit 1
  ;;
esac

# ---------------------------------------------------------------------------
# Guardas de ruta
# ---------------------------------------------------------------------------

# Aborta si $1 (una ruta) está dentro del workspace de este repositorio —
# el incidente que motiva estos scripts es exactamente "un secreto real
# viviendo en un archivo que un agente puede leer/editar dentro del
# workspace". Ningún script de rotación debe poder escribir ahí.
gapssa_secrets_abort_if_inside_workspace() {
  local target="$1"
  local workspace_root
  workspace_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  local resolved
  resolved="$(cd "$(dirname "$target")" 2>/dev/null && pwd)/$(basename "$target")" || {
    echo "ERROR: no se pudo resolver la ruta '$target'." >&2
    exit 1
  }
  case "$resolved" in
  "$workspace_root"/*|"$workspace_root")
    echo "ERROR: '$target' está dentro del workspace del repositorio ($workspace_root)." >&2
    echo "       Los secretos reales nunca deben vivir dentro de un directorio que un" >&2
    echo "       agente de Claude Code pueda leer o editar. Usa una ruta bajo \$HOME," >&2
    echo "       fuera de este repositorio y fuera de cualquier carpeta sincronizada" >&2
    echo "       con iCloud Drive/Git." >&2
    exit 1
    ;;
  esac
}

# ---------------------------------------------------------------------------
# Guardia de "fuera del harness"
# ---------------------------------------------------------------------------
#
# Tres capas independientes, todas obligatorias (ninguna sustituye a las
# otras — cada una cubre un fallo distinto de las demás):
#
#   1. Variable de entorno explícita ROTACION_GAPSSA_FUERA_DEL_HARNESS=SI
#      — el operador debe exportarla A MANO en su propia terminal antes de
#      ejecutar cualquier script de este directorio. Un agente no puede
#      "adelantarse" a exportarla por el usuario de forma útil, porque
#      hacerlo requeriría que el propio agente ejecutara el comando en la
#      terminal del operador, que es exactamente lo que estas guardas
#      existen para impedir.
#   2. Detección heurística de entorno: variables de entorno y ancestros
#      de proceso característicos de un editor/agente con terminal
#      integrada (Claude Code, Codex, VS Code, Cursor, JetBrains...).
#      Es DEFENSA EN PROFUNDIDAD, no la guardia principal — una detección
#      basada en nombres de proceso siempre se puede evadir por alguien
#      decidido a evadirla. Verificada empíricamente contra la ancestría
#      real de un proceso lanzado desde el CLI de Claude Code en macOS
#      (`zsh` <- `claude` <- `-zsh` <- `login` <- `Terminal.app`): el
#      proceso `claude` aparece como ancestro directo, de ahí que
#      "claude"/"codex"/"cursor" sean los términos de mayor confianza.
#   3. TTY real en stdin Y stdout, más la frase de confirmación exacta
#      escrita a mano — la guardia original, sigue siendo obligatoria.
#
# La salida de esta función es deliberadamente solo booleana
# (`harness_guard_*=true|false`) seguida, como mucho, del NOMBRE de la
# variable/proceso que hizo saltar la alarma — nunca un volcado de
# variables de entorno completas ni de la tabla de procesos.

# Lista de variables de entorno cuyo NOMBRE (nunca su valor, salvo
# TERM_PROGRAM que se compara contra un valor conocido) delata una
# terminal integrada de editor/agente. Best-effort: puede haber falsos
# negativos (una herramienta nueva no listada aquí) — la capa 2 (ancestría
# de proceso) y la capa 1 (variable explícita) son las que de verdad
# sostienen esta guardia.
_GAPSSA_SUSPECT_ENV_VARS="CLAUDECODE CLAUDE_CODE CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_SSE_PORT CODEX_SANDBOX CODEX_SANDBOX_NETWORK_DISABLED CURSOR_TRACE_ID VSCODE_PID VSCODE_INJECTION VSCODE_GIT_ASKPASS_NODE JETBRAINS_IDE JETBRAINS_IDE_PROPERTIES_FILE"

# Nombres de proceso (comparación por subcadena, insensible a mayúsculas)
# que, si aparecen entre los ancestros de este proceso, delatan que se
# está ejecutando dentro de un agente/editor, no en una terminal normal.
_GAPSSA_SUSPECT_PROCESS_NAMES="claude codex cursor code\\ helper jetbrains pycharm intellij webstorm goland"

gapssa_secrets_harness_env_var_ok() {
  [ "${ROTACION_GAPSSA_FUERA_DEL_HARNESS:-}" = "SI" ]
}

gapssa_secrets_harness_tty_ok() {
  [ -t 0 ] && [ -t 1 ]
}

# Devuelve por stdout el nombre de la primera variable sospechosa
# encontrada, o cadena vacía si ninguna lo está. No imprime valores.
gapssa_secrets_harness_suspect_env_var() {
  local v val
  for v in $_GAPSSA_SUSPECT_ENV_VARS; do
    val="$(eval "printf '%s' \"\${$v:-}\"")"
    if [ -n "$val" ]; then
      printf '%s' "$v"
      return 0
    fi
  done
  case "${TERM_PROGRAM:-}" in
  vscode)
    printf '%s' "TERM_PROGRAM=vscode"
    return 0
    ;;
  esac
  printf ''
  return 1
}

# Camina la ancestría de procesos desde el proceso actual hasta PID 1 (o
# 20 niveles, lo que ocurra antes) y devuelve por stdout el primer nombre
# de proceso sospechoso encontrado (nunca la línea de comando completa,
# solo `comm`, que no contiene argumentos ni secretos). Cadena vacía si no
# encuentra ninguno.
gapssa_secrets_harness_suspect_ancestor() {
  local pid="${1:-$$}"
  local i comm lower name
  for i in $(seq 1 20); do
    [ -z "$pid" ] && break
    [ "$pid" = "1" ] && break
    comm="$(ps -o comm= -p "$pid" 2>/dev/null || true)"
    comm="$(basename "${comm:-}" 2>/dev/null || printf '%s' "$comm")"
    lower="$(printf '%s' "$comm" | tr '[:upper:]' '[:lower:]')"
    for name in $_GAPSSA_SUSPECT_PROCESS_NAMES; do
      case "$lower" in
      *"$name"*)
        printf '%s' "$comm"
        return 0
        ;;
      esac
    done
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  done
  printf ''
  return 1
}

# Punto de entrada único usado por todos los scripts de este directorio.
# Aborta con exit=1 si CUALQUIERA de las tres capas falla. Imprime solo
# booleanos/nombres de variable o proceso — nunca valores ni volcados.
gapssa_secrets_require_interactive_confirmation() {
  if gapssa_secrets_harness_env_var_ok; then
    echo "harness_guard_env_var=true"
  else
    echo "harness_guard_env_var=false" >&2
    echo "ERROR: exporta ROTACION_GAPSSA_FUERA_DEL_HARNESS=SI en tu propia terminal" >&2
    echo "       (no en un archivo del repositorio) antes de ejecutar esto. Ejemplo:" >&2
    echo "         export ROTACION_GAPSSA_FUERA_DEL_HARNESS=SI" >&2
    exit 1
  fi

  if gapssa_secrets_harness_tty_ok; then
    echo "harness_guard_tty=true"
  else
    echo "harness_guard_tty=false" >&2
    echo "ERROR: se requiere una terminal interactiva real (TTY) en stdin y stdout." >&2
    echo "       No lo ejecutes desde un agente, un pipe ni un script no interactivo." >&2
    exit 1
  fi

  local suspect
  suspect="$(gapssa_secrets_harness_suspect_env_var || true)"
  if [ -n "$suspect" ]; then
    echo "harness_guard_env_denylist=false suspect=$suspect" >&2
    echo "ERROR: variable de entorno '$suspect' detectada — parece una terminal" >&2
    echo "       integrada de un editor/agente, no Terminal.app." >&2
    exit 1
  fi
  echo "harness_guard_env_denylist=true"

  suspect="$(gapssa_secrets_harness_suspect_ancestor || true)"
  if [ -n "$suspect" ]; then
    echo "harness_guard_process_ancestry=false suspect=$suspect" >&2
    echo "ERROR: proceso ancestro '$suspect' detectado — parece que esta terminal" >&2
    echo "       cuelga de un editor/agente. Cierra esa sesión y abre Terminal.app." >&2
    exit 1
  fi
  echo "harness_guard_process_ancestry=true"

  echo "Este script va a preparar o escribir material de secretos REAL fuera del"
  echo "workspace del repositorio. Confirma que estás ejecutándolo desde una"
  echo "terminal local, FUERA de Claude Code / cualquier sesión de agente,"
  echo "y que has cerrado esa sesión antes de continuar."
  read -r -p "Escribe exactamente 'confirmo fuera de claude code' para continuar: " reply
  if [ "$reply" != "confirmo fuera de claude code" ]; then
    echo "harness_guard_phrase=false" >&2
    echo "ABORTADO: confirmación no recibida." >&2
    exit 1
  fi
  echo "harness_guard_phrase=true"
}

# ---------------------------------------------------------------------------
# Modo de archivo/directorio
# ---------------------------------------------------------------------------

# Confirma que un directorio existe, con el propietario esperado y modo 700.
gapssa_secrets_check_dir_mode() {
  local dir="$1"
  if [ ! -d "$dir" ]; then
    echo "false"
    return 0
  fi
  local mode
  mode="$(stat -f '%Lp' "$dir" 2>/dev/null || stat -c '%a' "$dir" 2>/dev/null)"
  [ "$mode" = "700" ] && echo "true" || echo "false"
}

# Confirma que un archivo existe, con modo 600.
gapssa_secrets_check_file_mode() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "false"
    return 0
  fi
  local mode
  mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file" 2>/dev/null)"
  [ "$mode" = "600" ] && echo "true" || echo "false"
}

# ---------------------------------------------------------------------------
# Bloqueo de concurrencia (Bloque 6, B6-7) — evita que dos sesiones de
# `rotate-all-interactive.sh` corran a la vez contra el MISMO almacén
# externo (mismo `$SECRETS_DIR`): sin esto, dos procesos podrían leer el
# mismo estado "pending", rotar el mismo secreto en paralelo, o pisarse
# entre sí las escrituras de `$SECRETS_FILE`/`$STATUS_FILE` -- hallazgo
# real de la revisión (nunca existió ningún mecanismo de bloqueo antes de
# esto). `mkdir` es atómico en cualquier sistema de ficheros POSIX (nunca
# una condición de carrera entre comprobar y crear, a diferencia de
# `[ -f ... ] || touch ...`), así que el "lock" es un directorio, no un
# fichero — no hace falta `flock(1)` (ausente en macOS de fábrica).
# ---------------------------------------------------------------------------

# Antigüedad en segundos de un directorio (mtime), o cadena vacía si no
# se puede determinar -- BSD (macOS) y GNU `stat` tienen flags distintos,
# igual que el resto de usos de `stat` en este fichero.
_gapssa_secrets_lock_age_seconds() {
  local dir="$1"
  local mtime
  mtime="$(stat -f '%m' "$dir" 2>/dev/null || stat -c '%Y' "$dir" 2>/dev/null || true)"
  if [ -z "$mtime" ]; then
    printf ''
    return 0
  fi
  printf '%s' "$(($(date +%s) - mtime))"
}

# Adquiere el bloqueo de `$SECRETS_DIR` para este proceso. Éxito (0): el
# lock es nuestro, con un `trap` registrado para liberarlo en
# EXIT/INT/TERM. Fallo (1): otra sesión viva ya tiene el lock (mensaje a
# stderr con su PID, nunca con ningún secreto). Un lock cuyo PID
# propietario ya no está vivo (proceso terminado sin liberar, p. ej. tras
# un `kill -9`) se considera huérfano y se recupera automáticamente, con
# aviso explícito.
gapssa_secrets_lock_acquire() {
  local secrets_dir="$1"
  local lock_dir="$secrets_dir/.rotation.lock"
  local owner_file="$lock_dir/owner"
  # Ningún lock más joven que esto se recupera jamás, ni siquiera si
  # parece "huérfano" -- cierra una condición de carrera REAL (detectada
  # por este mismo ensayo, dos adquisiciones lanzadas a la vez sobre el
  # mismo almacén): entre el `mkdir "$lock_dir"` del ganador y su
  # siguiente línea escribiendo `owner_file`, hay una ventana en la que
  # el perdedor podía leer un `owner_file` vacío/ausente, confundirlo con
  # un huérfano, borrar el lock recién creado del ganador y quedarse
  # él mismo con el lock -- los dos procesos terminaban creyendo tener el
  # lock. Un huérfano de verdad (proceso muerto sin liberar) siempre tiene
  # muchos segundos de antigüedad; un lock en plena creación, no.
  local grace_seconds=2

  local saved_umask
  saved_umask="$(umask)"
  umask 077
  mkdir -p "$secrets_dir"
  umask "$saved_umask"
  chmod 700 "$secrets_dir" 2>/dev/null || true

  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" >"$owner_file"
    chmod 600 "$owner_file" 2>/dev/null || true
    GAPSSA_SECRETS_LOCK_DIR="$lock_dir"
    GAPSSA_SECRETS_LOCK_OWNER_PID="$$"
    return 0
  fi

  # Ya existe -- ¿sigue vivo el dueño, es un huérfano recuperable, o está
  # siendo creado AHORA MISMO por otro proceso?
  local owner_pid=""
  if [ -f "$owner_file" ]; then owner_pid="$(cat "$owner_file" 2>/dev/null || true)"; fi
  if [ -n "$owner_pid" ] && kill -0 "$owner_pid" 2>/dev/null; then
    echo "ERROR: ya hay otra sesión de rotación en marcha para este almacén (PID $owner_pid, $secrets_dir). Espera a que termine, o ciérrala primero." >&2
    return 1
  fi

  local lock_age
  lock_age="$(_gapssa_secrets_lock_age_seconds "$lock_dir")"
  if [ -z "$lock_age" ] || [ "$lock_age" -lt "$grace_seconds" ]; then
    echo "ERROR: otra sesión está adquiriendo este almacén ahora mismo ($secrets_dir) — vuelve a intentarlo en unos segundos." >&2
    return 1
  fi

  echo "AVISO: se encontró un bloqueo huérfano en $lock_dir (proceso $owner_pid ya no existe, con ${lock_age}s de antigüedad) — se recupera automáticamente." >&2
  rm -rf "$lock_dir"
  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" >"$owner_file"
    chmod 600 "$owner_file" 2>/dev/null || true
    GAPSSA_SECRETS_LOCK_DIR="$lock_dir"
    GAPSSA_SECRETS_LOCK_OWNER_PID="$$"
    return 0
  fi
  echo "ERROR: no se pudo adquirir el bloqueo de rotación tras recuperar el huérfano (carrera con otra sesión) — vuelve a intentarlo." >&2
  return 1
}

# Libera el bloqueo adquirido por ESTE proceso -- nunca el de otro (solo
# borra si el PID propietario registrado coincide exactamente con el
# nuestro), así que un orden de traps inesperado nunca puede robarle el
# lock a una sesión ajena.
gapssa_secrets_lock_release() {
  [ -n "${GAPSSA_SECRETS_LOCK_DIR:-}" ] || return 0
  local owner_file="$GAPSSA_SECRETS_LOCK_DIR/owner"
  local current_owner=""
  if [ -f "$owner_file" ]; then current_owner="$(cat "$owner_file" 2>/dev/null || true)"; fi
  if [ "$current_owner" = "${GAPSSA_SECRETS_LOCK_OWNER_PID:-}" ]; then
    rm -rf "$GAPSSA_SECRETS_LOCK_DIR"
  fi
  GAPSSA_SECRETS_LOCK_DIR=""
}

# ---------------------------------------------------------------------------
# Ficheros temporales seguros para material sensible de corta vida
# (contraseñas antiguas, ficheros de configuración de curl/mariadb) —
# nunca dentro del workspace, modo 600, y con borrado explícito
# (sobrescritura + rm) a cargo del llamador, típicamente desde un `trap`.
# ---------------------------------------------------------------------------

gapssa_secrets_mktemp_secure() {
  local base="${1:-gapssa-rotation}"
  local dir="${GAPSSA_SECRETS_TMPDIR:-${TMPDIR:-/tmp}}"
  gapssa_secrets_abort_if_inside_workspace "$dir"
  mkdir -p "$dir"
  chmod 700 "$dir" 2>/dev/null || true
  local file
  file="$(mktemp "${dir%/}/${base}.XXXXXXXX")"
  chmod 600 "$file"
  printf '%s' "$file"
}

# Sobrescribe el contenido antes de borrar (mejor esfuerzo — en un SSD con
# wear-leveling ninguna sobrescritura por software garantiza el borrado
# físico del bloque anterior; esto reduce la ventana de exposición en el
# sistema de archivos lógico, no es una garantía criptográfica) y borra.
# Acepta uno o más ficheros — cada uno se sobrescribe y borra por
# separado, nunca se ignoran silenciosamente los argumentos de más de uno
# (bug real detectado en las pruebas de rotate-all-interactive.sh: varias
# llamadas pasaban 2-3 ficheros esperando que se borraran todos).
# gapssa_secrets_validate_value <value> [--generated]
# Aplica el contrato cerrado de lib/secretValueContract.mjs (Bloque 5,
# Revisión 2, punto 1) — SIEMPRE antes de aplicar `value` a cualquier
# servidor real o de escribirlo en $SECRETS_FILE. `value` viaja como
# ARGUMENTO DE FUNCIÓN bash (nunca de un proceso externo vía execve, así
# que nunca aparece en `ps`/`docker inspect` — mismo patrón ya usado por
# gapssa_secrets_curl_cfg_escape) hasta el `printf` que lo entrega por
# STDIN al proceso Node, que tampoco lo imprime nunca. Devuelve 0 si el
# valor cumple el contrato, 1 si no (sin imprimir el motivo — el
# llamador decide qué mensaje, sin valor, mostrar).
gapssa_secrets_validate_value() {
  local value="$1" mode="${2:-}"
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [ "$mode" = "--generated" ]; then
    printf '%s' "$value" | node "$script_dir/lib/secretValueContract.mjs" --generated >/dev/null 2>/dev/null
  else
    printf '%s' "$value" | node "$script_dir/lib/secretValueContract.mjs" >/dev/null 2>/dev/null
  fi
}

gapssa_secrets_shred() {
  local file
  for file in "$@"; do
    [ -f "$file" ] || continue
    local size
    size="$(wc -c <"$file" 2>/dev/null | tr -d ' ')"
    if [ -n "$size" ] && [ "$size" -gt 0 ] 2>/dev/null; then
      dd if=/dev/urandom of="$file" bs=1024 count=$(((size / 1024) + 1)) conv=notrunc >/dev/null 2>&1 || true
    fi
    rm -f "$file"
  done
}

# ---------------------------------------------------------------------------
# Temporal "fijado" (pinned) en el mismo directorio que un destino real —
# necesario para que un `mv` posterior sea atómico (mv entre sistemas de
# archivos distintos deja de ser atómico, degrada a copy+unlink) y para
# poder detectar una sustitución del temporal por un symlink/otro fichero
# entre su creación y su uso.
# ---------------------------------------------------------------------------

# Crea un temporal 600 en el MISMO directorio que $1 (nunca en
# $GAPSSA_SECRETS_TMPDIR/$TMPDIR) y devuelve por stdout, en 3 líneas:
# ruta del temporal, directorio canónico que lo contiene, y
# "device inode uid modo" tal como quedó justo al crearlo. El llamador
# DEBE guardar esas 3 líneas y volver a comprobarlas con
# gapssa_secrets_verify_pinned_tmp antes de CUALQUIER operación posterior
# sobre ese fichero (escribir, leer, mover, borrar) — nunca confiar en
# que la ruta sigue apuntando a lo mismo solo porque "acaba de crearse".
gapssa_secrets_mktemp_secure_same_dir() {
  local target_path="$1" label="${2:-tmp}"
  local dir; dir="$(dirname "$target_path")"
  gapssa_secrets_abort_if_inside_workspace "$dir"
  [ -d "$dir" ] || { echo "ERROR: '$dir' no existe." >&2; return 1; }
  local canonical_dir
  canonical_dir="$(cd "$dir" && pwd -P)" || { echo "ERROR: no se pudo resolver '$dir'." >&2; return 1; }
  local base; base="$(basename "$target_path")"
  local file
  file="$(mktemp "${canonical_dir%/}/.${base}.${label}-XXXXXXXX")" || return 1
  chmod 600 "$file"
  local stat_out
  stat_out="$(stat -f '%d %i %u %Lp' "$file" 2>/dev/null || stat -c '%d %i %u %a' "$file" 2>/dev/null)" || {
    rm -f "$file"
    echo "ERROR: no se pudo fijar (stat) el temporal recién creado." >&2
    return 1
  }
  printf '%s\n%s\n%s\n' "$file" "$canonical_dir" "$stat_out"
}

# Patrón cerrado de nombre de los temporales de restauración creados por
# la función de arriba con label="restore": ".<base>.restore-XXXXXXXX".
# El escaneo de huérfanos NUNCA usa un glob de bash (`for f in patrón`
# rompe con espacios/caracteres especiales en el nombre y no distingue
# symlinks de forma fiable) — vive en lib/scanOrphanRestoreTmp.mjs
# (readdir + lstat), cuyo prefijo `.${secretsFileBasename}.restore-` es,
# a propósito, la MISMA construcción de cadena que el `mktemp` de arriba
# — mantenerla en un único sitio evitaría divergencia si algún día deja
# de bastar con un comentario para documentarlo.

# ---------------------------------------------------------------------------
# Reserva atómica de una ruta EXCLUSIVA (Bloque 6, corrección de
# colisiones) — primitiva compartida por el nombre de cada backup
# cifrado y por el informe final saneado. Nunca "comprueba existencia y
# escribe después" en dos pasos separados (eso es exactamente el TOCTOU
# que este bloque corrige): usa `noclobber` de bash para la redirección
# `>`, que el propio shell implementa con open(O_CREAT|O_EXCL|O_WRONLY)
# — POSIX garantiza que esa llamada falla con EEXIST si el último
# componente de la ruta YA existe, sea fichero regular, directorio,
# FIFO o symlink (colgante o no) — nunca sigue un symlink existente para
# crear el destino. Modo 600 desde el primer byte (via `umask 077`
# alrededor de la creación, nunca create+chmod en dos pasos separados).
# ---------------------------------------------------------------------------

# Generador de sufijo CSPRNG por defecto — función independiente (no
# inlined) precisamente para que las pruebas puedan redefinirla DESPUÉS
# de hacer `source lib.sh` y así suministrar candidatos deterministas
# sin depender de `openssl rand` real ni del reloj real.
_gapssa_secrets_random_suffix_hex() {
  local nbytes="${1:-4}"
  openssl rand -hex "$nbytes"
}

# gapssa_secrets_reserve_exclusive_path <ruta_completa>
# Reserva ATÓMICAMENTE <ruta_completa> — falla cerrado (rc=1) sin tocar,
# adoptar ni borrar NADA si ya existe cualquier cosa en esa ruta exacta.
# Éxito (rc=0): imprime 3 líneas (ruta, directorio canónico, "dev ino uid
# modo") — mismo contrato exacto que gapssa_secrets_mktemp_secure_same_dir
# — para que el llamador fije la identidad con
# gapssa_secrets_verify_pinned_tmp antes de escribir nada en ella y
# vuelva a comprobarla justo antes de la escritura real. rc=2: fallo real
# no relacionado con una colisión (directorio ausente, permisos, etc.).
gapssa_secrets_reserve_exclusive_path() {
  local full_path="$1"
  local dir; dir="$(dirname "$full_path")"
  local base; base="$(basename "$full_path")"
  if [ -z "$base" ] || [ "$base" = "." ] || [ "$base" = ".." ]; then
    echo "ERROR: nombre de fichero inválido para reservar ('$full_path')." >&2
    return 2
  fi
  gapssa_secrets_abort_if_inside_workspace "$dir"
  [ -d "$dir" ] || { echo "ERROR: '$dir' no existe." >&2; return 2; }
  local canonical_dir
  canonical_dir="$(cd "$dir" && pwd -P)" || { echo "ERROR: no se pudo resolver '$dir'." >&2; return 2; }
  local full="$canonical_dir/$base"

  # Defensa en profundidad rápida (NO es la garantía real — ver más
  # abajo): detecta la colisión más común, incluido un symlink colgante,
  # sin necesidad de tocar el umask ni abrir ningún subshell.
  if [ -e "$full" ] || [ -L "$full" ]; then
    return 1
  fi

  local umask_saved
  umask_saved="$(umask)"
  umask 077
  # LA GARANTÍA REAL: `noclobber` hace que bash abra este destino con
  # O_CREAT|O_EXCL — atómico a nivel de kernel, cierra exactamente la
  # ventana entre el "-e"/"-L" de arriba y esta línea. Si algo (incluido
  # un symlink recién creado por otro proceso) ocupa ya esa ruta exacta,
  # esta redirección falla y NO se crea NI se sigue el symlink.
  if ! ( set -o noclobber; : >"$full" ) 2>/dev/null; then
    umask "$umask_saved"
    return 1
  fi
  umask "$umask_saved"

  # Verificación post-creación: lo reservado debe ser EXACTAMENTE un
  # fichero regular normal, nunca un symlink — inalcanzable si el
  # O_EXCL de arriba se cumplió de verdad, pero se comprueba de todas
  # formas (mismo estilo paranoico que el resto de este fichero).
  if [ -h "$full" ] || [ ! -f "$full" ]; then
    rm -f -- "$full" 2>/dev/null || true
    echo "ERROR: '$full' no es un fichero regular normal tras reservarlo — abortado." >&2
    return 2
  fi

  local stat_out
  stat_out="$(stat -f '%d %i %u %Lp' "$full" 2>/dev/null || stat -c '%d %i %u %a' "$full" 2>/dev/null)" || {
    rm -f -- "$full"
    echo "ERROR: no se pudo fijar (stat) el fichero reservado." >&2
    return 2
  }
  printf '%s\n%s\n%s\n' "$full" "$canonical_dir" "$stat_out"
  return 0
}

# gapssa_secrets_reserve_with_retry <directorio> <nombre_función_candidata> [máx_intentos=8]
# <nombre_función_candidata> se invoca (sin argumentos) en cada intento y
# DEBE imprimir por stdout un nombre de fichero (nunca una ruta completa)
# — se espera que cada llamada difiera (nuevo componente CSPRNG y/o
# timestamp), para que una colisión real solo bloquee ESE candidato, no
# los siguientes. Reintenta de forma ACOTADA; agota los intentos -> falla
# cerrado (rc=3) sin haber tocado, adoptado ni borrado ningún artefacto
# preexistente en ningún momento del bucle. rc=2 si el propio generador
# de candidatos falla (nombre vacío) o si la reserva falla por un motivo
# que no es colisión.
gapssa_secrets_reserve_with_retry() {
  local dir="$1" candidate_fn="$2" max_attempts="${3:-8}"
  local attempt=1 name full pin_lines rc
  while [ "$attempt" -le "$max_attempts" ]; do
    name="$("$candidate_fn")"
    if [ -z "$name" ]; then
      echo "ERROR: el generador de candidatos '$candidate_fn' devolvió un nombre vacío." >&2
      return 2
    fi
    full="${dir%/}/$name"
    pin_lines="$(gapssa_secrets_reserve_exclusive_path "$full")"
    rc=$?
    if [ "$rc" = 0 ]; then
      printf '%s\n' "$pin_lines"
      return 0
    fi
    if [ "$rc" != 1 ]; then
      echo "ERROR: fallo no relacionado con colisión al reservar '$full' (rc=$rc) — abortado." >&2
      return 2
    fi
    attempt=$((attempt + 1))
  done
  echo "ERROR: agotados $max_attempts intentos de reserva atómica en '$dir' — todos los candidatos colisionaron. Abortado; ningún artefacto preexistente fue tocado ni adoptado." >&2
  return 3
}

# gapssa_secrets_find_report_for_run_id <secrets_dir> <run_id>
# Localiza el informe ACTUAL de la sesión con identificador <run_id> —
# NUNCA por fecha de modificación más reciente, NUNCA "el único fichero
# que hay si no coincide el patrón": exige coincidencia exacta del
# patrón cerrado `rotation-report-*-<run_id>.txt`. Un informe con
# formato antiguo (sin run_id, `rotation-report-<fecha>.txt` previo a
# este bloque) o de OTRO run_id nunca puede adoptarse como resultado
# actual — simplemente no coincide con el patrón. rc=0 + imprime la ruta
# si hay EXACTAMENTE un informe para ese run_id. rc=1 si hay CERO. rc=2
# si hay MÁS DE UNO (ambigüedad -> fallo cerrado, nunca "el primero" ni
# "el más reciente").
gapssa_secrets_find_report_for_run_id() {
  local secrets_dir="$1" run_id="$2"
  if [ -z "$run_id" ]; then
    echo "ERROR: run_id vacío." >&2
    return 2
  fi
  local -a matches=()
  local f
  for f in "$secrets_dir"/rotation-report-*"-$run_id.txt"; do
    [ -e "$f" ] || continue
    matches+=("$f")
  done
  case "${#matches[@]}" in
  0)
    echo "ERROR: cero informes encontrados para el run_id actual ('$run_id')." >&2
    return 1
    ;;
  1)
    printf '%s\n' "${matches[0]}"
    return 0
    ;;
  *)
    echo "ERROR: ${#matches[@]} informes encontrados para el mismo run_id ('$run_id') — ambigüedad, fallo cerrado." >&2
    return 2
    ;;
  esac
}

# ---------------------------------------------------------------------------
# Parser del flujo de huérfanos emitido por lib/scanOrphanRestoreTmp.mjs
# ---------------------------------------------------------------------------
#
# Protocolo: CAMPOS INDEPENDIENTES terminados en byte NUL (0x00), en
# grupos de SEIS por huérfano (tipo, ruta, dev, ino, uid, modo, en ese
# orden) — NUNCA varios campos combinados en una sola cadena con un
# delimitador "que se supone que no aparece en una ruta": en un
# componente de ruta POSIX los ÚNICOS bytes prohibidos son NUL y "/", así
# que cualquier otro byte (salto de línea, tabulador, comillas,
# separador de unidad ASCII \x1f, etc.) es válido dentro de un nombre de
# fichero real. NUL es, por construcción del propio sistema de ficheros,
# el único delimitador que nunca puede aparecer en una ruta — y es
# también el único byte que bash NO puede almacenar dentro de una
# variable, así que aquí solo se usa como separador de FLUJO entre
# procesos (vía `read -r -d ''`), nunca como contenido guardado.
declare -a GAPSSA_ORPHAN_TYPES=()
declare -a GAPSSA_ORPHAN_PATHS=()
declare -a GAPSSA_ORPHAN_DEVS=()
declare -a GAPSSA_ORPHAN_INOS=()
declare -a GAPSSA_ORPHAN_UIDS=()
declare -a GAPSSA_ORPHAN_MODES=()

# Lee el protocolo de arriba DESDE STDIN y rellena los 6 arrays globales
# de arriba (se vacían al empezar). Comprueba:
#   - que el número total de campos sea múltiplo de 6 (si no, el flujo
#     está truncado o corrupto);
#   - que cada `tipo` pertenezca al conjunto cerrado symlink/regular/other;
#   - que dev/ino/uid tengan forma de entero no negativo;
#   - que `modo` tenga forma de octal.
# Ante CUALQUIER fallo de los anteriores: vacía los 6 arrays, imprime un
# mensaje de error (nunca contenido de fichero) a stderr, y devuelve 1 —
# el llamador NUNCA debe actuar sobre huérfanos si esta función no
# devuelve 0.
gapssa_secrets_parse_orphan_stream() {
  GAPSSA_ORPHAN_TYPES=()
  GAPSSA_ORPHAN_PATHS=()
  GAPSSA_ORPHAN_DEVS=()
  GAPSSA_ORPHAN_INOS=()
  GAPSSA_ORPHAN_UIDS=()
  GAPSSA_ORPHAN_MODES=()

  local field_count=0 field
  while IFS= read -r -d '' field; do
    case $((field_count % 6)) in
    0) GAPSSA_ORPHAN_TYPES+=("$field") ;;
    1) GAPSSA_ORPHAN_PATHS+=("$field") ;;
    2) GAPSSA_ORPHAN_DEVS+=("$field") ;;
    3) GAPSSA_ORPHAN_INOS+=("$field") ;;
    4) GAPSSA_ORPHAN_UIDS+=("$field") ;;
    5) GAPSSA_ORPHAN_MODES+=("$field") ;;
    esac
    field_count=$((field_count + 1))
  done

  local fail=false
  if [ "$((field_count % 6))" != 0 ]; then
    echo "ERROR: flujo de huérfanos con número de campos inconsistente (posible truncamiento)." >&2
    fail=true
  fi

  if [ "$fail" != true ]; then
    local n="${#GAPSSA_ORPHAN_TYPES[@]}" i
    for ((i = 0; i < n; i++)); do
      case "${GAPSSA_ORPHAN_TYPES[$i]}" in
      symlink | regular | other) ;;
      *)
        echo "ERROR: tipo de huérfano no reconocido '${GAPSSA_ORPHAN_TYPES[$i]}'." >&2
        fail=true
        break
        ;;
      esac
      case "${GAPSSA_ORPHAN_DEVS[$i]}" in
      '' | *[!0-9]*)
        echo "ERROR: 'dev' con formato no válido para un huérfano." >&2
        fail=true
        break
        ;;
      esac
      case "${GAPSSA_ORPHAN_INOS[$i]}" in
      '' | *[!0-9]*)
        echo "ERROR: 'ino' con formato no válido para un huérfano." >&2
        fail=true
        break
        ;;
      esac
      case "${GAPSSA_ORPHAN_UIDS[$i]}" in
      '' | *[!0-9]*)
        echo "ERROR: 'uid' con formato no válido para un huérfano." >&2
        fail=true
        break
        ;;
      esac
      case "${GAPSSA_ORPHAN_MODES[$i]}" in
      '' | *[!0-7]*)
        echo "ERROR: 'modo' con formato no válido para un huérfano." >&2
        fail=true
        break
        ;;
      esac
    done
  fi

  if [ "$fail" = true ]; then
    GAPSSA_ORPHAN_TYPES=()
    GAPSSA_ORPHAN_PATHS=()
    GAPSSA_ORPHAN_DEVS=()
    GAPSSA_ORPHAN_INOS=()
    GAPSSA_ORPHAN_UIDS=()
    GAPSSA_ORPHAN_MODES=()
    return 1
  fi
  return 0
}

# Revalida, con comprobaciones que NUNCA siguen un symlink ( [ -h ]/[ -f ]
# sobre la propia ruta, nunca `-L` de stat), que $1 sigue siendo
# EXACTAMENTE el fichero fijado por gapssa_secrets_mktemp_secure_same_dir:
# mismo directorio padre canónico, mismo device+inode+propietario+modo.
# Devuelve 1 SIN ejecutar ninguna otra acción si algo diverge — el
# llamador nunca debe abrir/leer/escribir/mover/sobrescribir el fichero
# tras un fallo de esta función. Esta comprobación en bash es la primera
# línea de defensa (rápida, falla pronto) pero no es atómica a nivel de
# syscall — la escritura real del contenido de una restauración pasa,
# además, por lib/writeRestorePayload.mjs, que abre con O_NOFOLLOW y
# revalida sobre el fd ya abierto (fstat), cerrando ahí la ventana de
# sustitución que un `stat` en bash seguido de una operación aparte no
# puede cerrar por sí solo.
gapssa_secrets_verify_pinned_tmp() {
  local path="$1" expected_dir="$2" expected_dev="$3" expected_ino="$4" expected_owner="$5" expected_mode="$6"
  [ -h "$path" ] && return 1
  [ -f "$path" ] || return 1
  local dir_now
  dir_now="$(cd "$(dirname "$path")" 2>/dev/null && pwd -P)" || return 1
  [ "$dir_now" = "$expected_dir" ] || return 1
  local dev_ino
  dev_ino="$(stat -f '%d %i' "$path" 2>/dev/null || stat -c '%d %i' "$path" 2>/dev/null)" || return 1
  [ "$dev_ino" = "$expected_dev $expected_ino" ] || return 1
  local owner
  owner="$(stat -f '%u' "$path" 2>/dev/null || stat -c '%u' "$path" 2>/dev/null)" || return 1
  [ "$owner" = "$expected_owner" ] || return 1
  local mode
  mode="$(stat -f '%Lp' "$path" 2>/dev/null || stat -c '%a' "$path" 2>/dev/null)" || return 1
  [ "$mode" = "$expected_mode" ] || return 1
  return 0
}

# Si $1 es un symlink, borra SOLO el enlace (nunca su destino, nunca lo
# abre ni lo resuelve). Si no es un symlink, no hace nada — el llamador
# decide aparte qué hacer con un fichero regular huérfano.
gapssa_secrets_safe_unlink_if_symlink() {
  local path="$1"
  if [ -h "$path" ]; then
    rm -- "$path"
  fi
}

# Borra (sobrescritura + rm) $1 SOLO si sigue coincidiendo con el pin
# dado — igual que gapssa_secrets_shred pero rechazando actuar sobre
# cualquier cosa que ya no sea, con certeza, el mismo fichero regular que
# se fijó. Un symlink se retira con unlink del enlace (nunca se sigue,
# nunca se sobrescribe su destino). Devuelve 1 sin tocar nada si la
# identidad no coincide — el llamador debe tratar eso como una señal de
# alarma (posible sustitución), nunca como "ya no había nada que
# limpiar".
gapssa_secrets_shred_pinned() {
  local path="$1" expected_dir="$2" expected_dev="$3" expected_ino="$4" expected_owner="$5" expected_mode="$6"
  if [ -h "$path" ]; then
    gapssa_secrets_safe_unlink_if_symlink "$path"
    return 0
  fi
  [ -e "$path" ] || return 0
  if gapssa_secrets_verify_pinned_tmp "$path" "$expected_dir" "$expected_dev" "$expected_ino" "$expected_owner" "$expected_mode"; then
    gapssa_secrets_shred "$path"
    return 0
  fi
  echo "AVISO: '$path' cambió de identidad (posible symlink/sustitución) — NO se sobrescribe su contenido; limpieza automática abortada para ese fichero." >&2
  return 1
}

# Digest SHA-256 de un fichero, vía el mismo helper Node que se usa para
# el digest en streaming del ensayo de restauración de backups — un
# único punto de verdad para el algoritmo/formato de digest en todo el
# código (evita depender de qué herramienta de digest, sha256sum/shasum/
# openssl dgst, esté instalada en cada plataforma). No imprime nada más
# que el propio digest.
gapssa_secrets_digest_of_file() {
  local file="$1" script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  node "$script_dir/lib/digestStream.mjs" <"$file"
}

# ---------------------------------------------------------------------------
# Pila de limpieza global — un único trap EXIT que compone de forma
# segura con cualquier otro código de este toolkit (p.ej. el
# `trap on_interrupt INT TERM` propio de rotate-all-interactive.sh, que
# sigue instalado sin cambios: EXIT e INT/TERM son traps independientes
# en bash). Cada llamador registra funciones de limpieza SIN pisar las de
# otro; la ejecución es idempotente (una interrupción que ya provocó un
# `exit` dispara este mismo trap una única vez) y recorre la pila en
# orden inverso (LIFO) al de registro, sin dejar que el fallo de una
# función impida las siguientes.
# ---------------------------------------------------------------------------

# IMPORTANTE sobre alcance: un trap EXIT se ejecuta en un contexto donde
# las variables `local` de la función que estaba en curso cuando se
# disparó YA NO son visibles (comprobado empíricamente: bash no conserva
# el ámbito dinámico de esa función dentro del propio manejador del
# trap). Por eso cada entrada de esta pila guarda sus valores YA
# capturados en el momento de registrarla.
#
# SOBRE DELIMITADORES: en un componente de ruta POSIX, los ÚNICOS bytes
# prohibidos son NUL (0x00) y "/" — CUALQUIER otro byte, incluido el
# separador de unidad ASCII (\x1f), un salto de línea, un tabulador o
# comillas/backticks/`$()`, es válido dentro de un nombre de fichero. Una
# versión anterior de este código empaquetaba varios argumentos en una
# única cadena separándolos con \x1f bajo la afirmación de que ese byte
# "nunca puede aparecer en una ruta" — esa afirmación era INCORRECTA: una
# ruta que contuviera \x1f de verdad se habría partido en argumentos
# distintos al desempaquetarla, pudiendo hacer que la limpieza actuara
# sobre una identidad distinta a la registrada. Por eso aquí NO se
# serializa nada — bash tampoco puede almacenar NUL en una variable
# (motivo por el que NUL solo se usa como separador de FLUJO entre
# procesos, nunca como contenido de una variable bash), así que la única
# representación real e inequívoca en bash puro es mantener cada
# argumento en su PROPIO elemento de un array independiente — nunca una
# cadena combinada, con o sin delimitador.
#
# Representación: arrays paralelos, indexados por posición — la entrada
# `i` de la pila es `GAPSSA_CLEANUP_OPS[i]` con `GAPSSA_CLEANUP_ARGC[i]`
# argumentos reales, guardados uno por uno en `GAPSSA_CLEANUP_ARG1[i]` ..
# `GAPSSA_CLEANUP_ARG6[i]` (los índices más allá de ARGC son relleno sin
# significado, nunca se leen). Las operaciones actuales usan como mucho 6
# argumentos — ampliar a ARG7/ARG8/... si una operación futura necesitara
# más, nunca volver a empaquetar en una cadena.
#
# Nunca usa `eval` ni ejecuta un fragmento de shell arbitrario: cada
# entrada es un NOMBRE DE OPERACIÓN de un conjunto CERRADO (ver el `case`
# de _gapssa_cleanup_run_one) — un nombre de operación no reconocido se
# rechaza sin ejecutar nada. Un argumento con metacaracteres de shell
# (`;`, `$(...)`, backticks, etc.) viaja como TEXTO LITERAL de ese
# argumento, nunca se interpreta como código.
declare -a GAPSSA_CLEANUP_OPS=()
declare -a GAPSSA_CLEANUP_ARGC=()
declare -a GAPSSA_CLEANUP_ARG1=()
declare -a GAPSSA_CLEANUP_ARG2=()
declare -a GAPSSA_CLEANUP_ARG3=()
declare -a GAPSSA_CLEANUP_ARG4=()
declare -a GAPSSA_CLEANUP_ARG5=()
declare -a GAPSSA_CLEANUP_ARG6=()
GAPSSA_CLEANUP_DONE=false

# Registra una operación de limpieza TIPADA: $1 = nombre de operación (uno
# de los que entiende _gapssa_cleanup_run_one), $2.. = sus argumentos
# (como mucho 6) — cada uno preserva EXACTAMENTE su valor, incluidos
# vacío, espacios, saltos de línea, tabs, \x1f o metacaracteres de shell,
# porque nunca se combinan en una cadena.
gapssa_cleanup_push() {
  local op="$1"
  shift
  local argc="$#"
  if [ "$argc" -gt 6 ]; then
    echo "ERROR: gapssa_cleanup_push admite como máximo 6 argumentos (recibidos $argc) para '$op'." >&2
    return 1
  fi
  GAPSSA_CLEANUP_OPS+=("$op")
  GAPSSA_CLEANUP_ARGC+=("$argc")
  GAPSSA_CLEANUP_ARG1+=("${1-}")
  GAPSSA_CLEANUP_ARG2+=("${2-}")
  GAPSSA_CLEANUP_ARG3+=("${3-}")
  GAPSSA_CLEANUP_ARG4+=("${4-}")
  GAPSSA_CLEANUP_ARG5+=("${5-}")
  GAPSSA_CLEANUP_ARG6+=("${6-}")
}

# Retira de la pila (todas) las entradas cuya operación + número de
# argumentos + CADA argumento coincidan EXACTAMENTE con $1 (operación) y
# $2.. (argumentos) — para cuando el propio llamador ya completó esa
# limpieza por su cuenta (p.ej. tras un rename con éxito, o tras un
# `return` de error donde ya limpió a mano) y no quiere que el
# dispatcher la repita/la ejecute con datos obsoletos al salir.
gapssa_cleanup_pop_matching() {
  local target_op="$1"
  shift
  local target_argc="$#"
  local t1="${1-}" t2="${2-}" t3="${3-}" t4="${4-}" t5="${5-}" t6="${6-}"
  local kept_ops=() kept_argc=() kept_a1=() kept_a2=() kept_a3=() kept_a4=() kept_a5=() kept_a6=() i
  for ((i = 0; i < ${#GAPSSA_CLEANUP_OPS[@]}; i++)); do
    if [ "${GAPSSA_CLEANUP_OPS[$i]}" = "$target_op" ] &&
      [ "${GAPSSA_CLEANUP_ARGC[$i]}" = "$target_argc" ] &&
      [ "${GAPSSA_CLEANUP_ARG1[$i]}" = "$t1" ] &&
      [ "${GAPSSA_CLEANUP_ARG2[$i]}" = "$t2" ] &&
      [ "${GAPSSA_CLEANUP_ARG3[$i]}" = "$t3" ] &&
      [ "${GAPSSA_CLEANUP_ARG4[$i]}" = "$t4" ] &&
      [ "${GAPSSA_CLEANUP_ARG5[$i]}" = "$t5" ] &&
      [ "${GAPSSA_CLEANUP_ARG6[$i]}" = "$t6" ]; then
      continue
    fi
    kept_ops+=("${GAPSSA_CLEANUP_OPS[$i]}")
    kept_argc+=("${GAPSSA_CLEANUP_ARGC[$i]}")
    kept_a1+=("${GAPSSA_CLEANUP_ARG1[$i]}")
    kept_a2+=("${GAPSSA_CLEANUP_ARG2[$i]}")
    kept_a3+=("${GAPSSA_CLEANUP_ARG3[$i]}")
    kept_a4+=("${GAPSSA_CLEANUP_ARG4[$i]}")
    kept_a5+=("${GAPSSA_CLEANUP_ARG5[$i]}")
    kept_a6+=("${GAPSSA_CLEANUP_ARG6[$i]}")
  done
  # BLOQUE 3 (corrección de un bug real, pre-existente, descubierto al
  # escribir las pruebas de este bloque): "${arr[@]:-}" con un array
  # REALMENTE vacío no expande a CERO palabras bajo `set -u` (bash 3.2)
  # — expande a UNA palabra vacía, así que la pila nunca volvía a quedar
  # genuinamente vacía tras retirar su última entrada (quedaba un
  # elemento fantasma con todos los campos ""). "${arr[@]:+"${arr[@]}"}"
  # es el idiomático correcto: cero palabras si el array está vacío,
  # todas sus palabras intactas si no — verificado en esta misma bash.
  GAPSSA_CLEANUP_OPS=("${kept_ops[@]:+"${kept_ops[@]}"}")
  GAPSSA_CLEANUP_ARGC=("${kept_argc[@]:+"${kept_argc[@]}"}")
  GAPSSA_CLEANUP_ARG1=("${kept_a1[@]:+"${kept_a1[@]}"}")
  GAPSSA_CLEANUP_ARG2=("${kept_a2[@]:+"${kept_a2[@]}"}")
  GAPSSA_CLEANUP_ARG3=("${kept_a3[@]:+"${kept_a3[@]}"}")
  GAPSSA_CLEANUP_ARG4=("${kept_a4[@]:+"${kept_a4[@]}"}")
  GAPSSA_CLEANUP_ARG5=("${kept_a5[@]:+"${kept_a5[@]}"}")
  GAPSSA_CLEANUP_ARG6=("${kept_a6[@]:+"${kept_a6[@]}"}")
}

# Ejecuta la operación de limpieza registrada en el índice $1. Conjunto
# CERRADO de nombres — nunca invoca un nombre de función arbitrario ni un
# fragmento de shell; añadir una operación nueva exige añadir un `case`
# aquí a propósito, como allowlist explícita. Un nombre de operación
# desconocido se rechaza (return 1) sin ejecutar nada.
_gapssa_cleanup_run_one() {
  local idx="$1"
  local op="${GAPSSA_CLEANUP_OPS[$idx]}"
  local a1="${GAPSSA_CLEANUP_ARG1[$idx]}"
  local a2="${GAPSSA_CLEANUP_ARG2[$idx]}"
  local a3="${GAPSSA_CLEANUP_ARG3[$idx]}"
  local a4="${GAPSSA_CLEANUP_ARG4[$idx]}"
  local a5="${GAPSSA_CLEANUP_ARG5[$idx]}"
  local a6="${GAPSSA_CLEANUP_ARG6[$idx]}"
  case "$op" in
  restore_umask)
    umask "$a1"
    ;;
  shred_pinned_tmp)
    gapssa_secrets_shred_pinned "$a1" "$a2" "$a3" "$a4" "$a5" "$a6"
    ;;
  shred_plain)
    gapssa_secrets_shred "$a1"
    ;;
  docker_rm_container_path)
    # Limpieza de un fichero sensible TEMPORAL dentro de un contenedor
    # (Bloque 5, Revisión 2, punto 9) — a1=servicio, a2=ruta dentro del
    # contenedor. Requiere que el llamador haya definido `_gapssa_compose`
    # ANTES de que se pudiera disparar este trap (documentado como
    # requisito de lib/dbRecovery.sh y lib/espoRecovery.sh) — mejor
    # esfuerzo, nunca bloquea la salida del proceso ni falla si el
    # contenedor ya no existe.
    _gapssa_compose exec -T "$a1" rm -f "$a2" >/dev/null 2>&1 || true
    ;;
  docker_rm_standalone_container)
    # S3A (lib/dbRootRecovery.sh) — retirada del contenedor DESECHABLE de
    # recuperación (a1=nombre), creado con `docker run` directo (nunca
    # `docker compose`, así que NO depende de `_gapssa_compose`). Mejor
    # esfuerzo: nunca bloquea la salida del proceso ni falla si el
    # contenedor ya no existe. Ante una interrupción mid-S3A, esta es la
    # única vía que garantiza que el contenedor con --skip-grant-tables
    # activo no siga corriendo indefinidamente tras salir del script.
    docker rm -f "$a1" >/dev/null 2>&1 || true
    ;;
  stop_apps_web)
    # S9 (rotate-all-interactive.sh, gate_s9) — a1=pid_file. apps/web se
    # lanza con `detached: true` (start-apps-web.mjs) precisamente para
    # sobrevivir a un `next dev` que tarda en apagarse -- pero eso también
    # significa que NO forma parte del grupo de procesos en primer plano
    # de esta terminal, así que un Ctrl-C real (SIGINT) nunca le llega
    # solo. Sin este ítem en la pila (bug real, auditoría de preflight de
    # S9, 2026-08-21), una interrupción mientras apps/web está arrancado
    # lo dejaba huérfano, sirviendo indefinidamente contra Postgres/Redis
    # reales sin que nadie lo supiera. Mejor esfuerzo: `stop` ya es
    # idempotente (informa `alreadyDead=true` y sale 0 si el proceso ya no
    # existe), así que repetirlo tras un `stop` explícito previo nunca
    # falla ni hace ruido.
    node "$SCRIPT_DIR/start-apps-web.mjs" stop "$a1" >/dev/null 2>&1 || true
    ;;
  lock_release)
    # Bloqueo de concurrencia (gapssa_secrets_lock_acquire/_release, más
    # arriba en este mismo fichero) — participa en ESTA pila (registrado
    # por rotate-all-interactive.sh justo tras adquirir el lock, nunca vía
    # un `trap ... EXIT` propio) precisamente para que se libere en el
    # mismo punto de choque que cualquier otra limpieza pendiente. Un
    # `trap gapssa_secrets_lock_release EXIT` SEPARADO en
    # rotate-all-interactive.sh (como existía antes de este cambio, bug
    # real encontrado en la auditoría de preflight de S9 2026-08-21)
    # SUSTITUYE en silencio a este `trap gapssa_cleanup_dispatch EXIT`
    # (bash solo conserva un manejador por señal, nunca los compone) —
    # así que ningún ítem de esta pila (ficheros temporales con secretos,
    # el contenedor desechable de S3A...) llegaba a limpiarse nunca ante
    # un SIGINT/EXIT real del proceso principal, pese a que
    # `lib.test.sh` sí probaba `gapssa_cleanup_dispatch` correctamente en
    # aislamiento (nunca contra el trap realmente instalado por el script
    # compuesto). gapssa_secrets_lock_release ya es idempotente por
    # diseño (no-op si el lock nunca se adquirió, o si el propietario
    # registrado ya no es este proceso), así que puede repetirse sin
    # riesgo si esta operación se dispatch-ea más de una vez.
    gapssa_secrets_lock_release
    ;;
  *)
    return 1
    ;;
  esac
}

gapssa_cleanup_dispatch() {
  [ "$GAPSSA_CLEANUP_DONE" = true ] && return 0
  GAPSSA_CLEANUP_DONE=true
  local i
  for ((i = ${#GAPSSA_CLEANUP_OPS[@]} - 1; i >= 0; i--)); do
    _gapssa_cleanup_run_one "$i" 2>/dev/null || true
  done
}
trap gapssa_cleanup_dispatch EXIT

# Escapa un valor para insertarlo dentro de un literal ENTRE COMILLAS
# DOBLES de un fichero de configuración `curl -K` (p.ej.
# `user = "usuario:VALOR"` / `header = "X-Api-Key: VALOR"`) — curl
# soporta `\\`/`\"` como secuencias de escape dentro de un valor citado
# (documentado en `curl --manual`, sección de ficheros de configuración);
# sin este escapado, un valor que contenga una comilla doble CIERRA el
# literal antes de tiempo y trunca en silencio la credencial real que se
# envía (bug real detectado y corregido durante las pruebas del Bloque
# 5). El backslash se escapa SIEMPRE primero — si se hiciera al revés,
# el backslash recién insertado para escapar una comilla se escaparía a
# sí mismo por error.
_gapssa_secrets_backslash_dquote_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s' "$value"
}

gapssa_secrets_curl_cfg_escape() {
  _gapssa_secrets_backslash_dquote_escape "$1"
}

# Escapa un valor para insertarlo dentro de un literal ENTRE COMILLAS
# DOBLES de un fichero de opciones de cliente MariaDB (`password="VALOR"`
# dentro de una sección `[client]`, leído vía `--defaults-extra-file`,
# Bloque 5 — Revisión 2, punto 3) — el parser de opciones de MariaDB
# (mysys/my_default) reconoce las mismas dos secuencias de escape que
# necesitamos (`\\` y `\"`) dentro de un valor citado, así que comparte
# exactamente el mismo algoritmo que gapssa_secrets_curl_cfg_escape
# (backslash SIEMPRE primero, por la misma razón: si se escapara al
# revés, el backslash recién insertado para escapar una comilla se
# escaparía a sí mismo por error) — de ahí que ambas deleguen en el mismo
# helper interno en vez de mantener dos copias que podrían divergir.
gapssa_secrets_mariadb_cfg_escape() {
  _gapssa_secrets_backslash_dquote_escape "$1"
}

# Escapa un valor para insertarlo como campo (usuario o contraseña) de una
# línea `.pgpass` (formato `hostname:port:database:username:password`,
# documentado en la referencia de PostgreSQL) — ese formato define UN
# solo carácter de escape: cualquier `:` o `\` literal dentro de un campo
# se escapa como `\:` / `\\` (backslash SIEMPRE primero, misma razón que
# las demás funciones de escape de este fichero). Usado por pg_capture en
# rotate-all-interactive.sh (Bloque 5, Revisión 2, punto 9) para no pasar
# nunca PGPASSWORD como variable de entorno de un contenedor (visible vía
# `docker inspect` mientras el contenedor efímero de verificación existe)
# — el fichero `.pgpass` se monta de solo lectura desde el host, nunca se
# copia dentro del contenedor.
gapssa_secrets_pgpass_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//:/\\:}"
  printf '%s' "$value"
}

# ---------------------------------------------------------------------------
# Máquina de estados por puerta — nunca almacena secretos, solo
# GATE=ESTADO en un archivo de texto plano dentro del almacén externo.
# ---------------------------------------------------------------------------

# Estados de fallo/recuperación tras restaurar un backup — nunca se
# confunden entre sí:
#   - recovery_required: el ARCHIVO externo y el SERVIDOR real quedaron
#     coordinados con la credencial ANTERIOR (comprometida) — disponible,
#     pero la rotación sigue incompleta.
#   - server_coordination_required: el ARCHIVO externo ya quedó
#     restaurado correctamente, pero la reaplicación de esa credencial
#     ANTERIOR al SERVIDOR real falló, no aplica, o no se pudo verificar
#     — la disponibilidad NO puede darse por recuperada, hace falta
#     reaplicarla manualmente. Nunca se reutiliza rollback_required para
#     este caso: esa puerta ya no tiene nada que "revertir" a nivel de
#     archivo, el problema está exclusivamente del lado del servidor.
#   - rollback_required: una puerta quedó interrumpida a mitad de
#     'applying'/'verifying' — el estado del ARCHIVO puede ser
#     inconsistente y todavía no se sabe con seguridad si el servidor
#     quedó coordinado; hace falta decidir si restaurar un backup.
#   - forward_recovery_required (Bloque 5): SOLO para sub-secretos
#     IRREVERSIBLES (p.ej. ESPOCRM_API_KEY) — la recuperación nunca
#     restauró el valor antiguo (ya no puede autenticar, restaurarlo
#     sería mentir), sino que generó uno NUEVO y lo escribió en
#     $SECRETS_FILE ("recuperación hacia delante"). El archivo y el
#     servidor están coordinados entre sí con ese valor nuevo, pero la
#     puerta sigue sin ser una rotación cerrada (exactamente igual de
#     "abierta" que recovery_required, con la dirección invertida) — S9
#     debe rechazar este estado igual que rechaza los demás no-'done'.
_GAPSSA_VALID_STATES="pending prepared applying verifying done blocked recovery_required server_coordination_required rollback_required forward_recovery_required failed"

gapssa_secrets_state_is_valid() {
  local state="$1" s
  for s in $_GAPSSA_VALID_STATES; do
    [ "$s" = "$state" ] && return 0
  done
  return 1
}

# Primitiva compartida KEY=VALUE de $status_file -- `gapssa_secrets_state_*`
# (validada contra la máquina de estados) y `gapssa_secrets_meta_*` (sin
# validar, para metadatos NO sensibles como el nombre de un fichero de
# backup) son ambas una fina capa sobre esta misma lectura/escritura, para
# que compartan exactamente la misma disciplina de fichero (700/600,
# escritura vía temporal + `mv`, nunca dos escrituras concurrentes
# divergentes) sin duplicar código.
_gapssa_secrets_kv_get() {
  local status_file="$1" key="$2" default="${3:-}"
  if [ -f "$status_file" ]; then
    local line
    line="$(grep "^$key=" "$status_file" 2>/dev/null | tail -n1 || true)"
    if [ -n "$line" ]; then
      printf '%s' "${line#*=}"
      return 0
    fi
  fi
  printf '%s' "$default"
}

_gapssa_secrets_kv_set() {
  local status_file="$1" key="$2" value="$3"
  gapssa_secrets_abort_if_inside_workspace "$status_file"
  local dir
  dir="$(dirname "$status_file")"
  mkdir -p "$dir"
  chmod 700 "$dir" 2>/dev/null || true
  touch "$status_file"
  chmod 600 "$status_file"
  local tmp
  tmp="$(mktemp "${dir%/}/.status.XXXXXXXX")"
  { grep -v "^$key=" "$status_file" 2>/dev/null || true; printf '%s=%s\n' "$key" "$value"; } >"$tmp"
  mv "$tmp" "$status_file"
  chmod 600 "$status_file"
}

gapssa_secrets_state_get() {
  _gapssa_secrets_kv_get "$1" "$2" "pending"
}

gapssa_secrets_state_set() {
  local status_file="$1" gate="$2" state="$3"
  if ! gapssa_secrets_state_is_valid "$state"; then
    echo "ERROR: estado '$state' no es un estado válido de la máquina de estados." >&2
    exit 1
  fi
  _gapssa_secrets_kv_set "$status_file" "$gate" "$state"
}

# gapssa_secrets_meta_get/_set -- metadatos NO sensibles, un espacio de
# claves separado del de la máquina de estados (sufijo `__meta`, nunca
# puede colisionar con un nombre de puerta real como "S2" o "S3A") y sin
# la validación de `_GAPSSA_VALID_STATES`: un nombre de fichero de backup
# nunca es un estado válido, así que reutilizar gapssa_secrets_state_set
# para esto abortaría siempre. Usado por backup_secrets_file() para
# recordar, junto al propio backup y en el momento exacto de tomarlo, qué
# fichero le corresponde a cada puerta -- así una ejecución de S9 futura
# puede resolverlo por identidad en vez de adivinar por timestamp. Nunca
# contiene un valor secreto: solo el nombre de un fichero cifrado.
gapssa_secrets_meta_get() {
  _gapssa_secrets_kv_get "$1" "${2}__meta" ""
}

gapssa_secrets_meta_set() {
  local status_file="$1" key="$2" value="$3"
  _gapssa_secrets_kv_set "$status_file" "${key}__meta" "$value"
}

# gapssa_health_port_from_start_json <start_json>
# Extrae el campo "port" del JSON que imprime `start-apps-web.mjs start`
# — 3000 por defecto si el campo está ausente, vacío o el JSON no se
# puede parsear (Bloque 6: el mismo valor por defecto que ya usaba
# start-apps-web.mjs cuando GAPSSA_APPS_WEB_PORT no está presente).
# gate_s9 usa SIEMPRE este valor para el healthcheck, nunca un
# "localhost:3000" fijo en el propio código de la puerta — así un
# servicio ajeno que por casualidad ocupe el 3000 nunca puede satisfacer
# un ensayo que arrancó apps/web en otro puerto.
gapssa_health_port_from_start_json() {
  local start_json="$1"
  local port
  port="$(printf '%s' "$start_json" | python3 -c "
import sys, json
try:
    v = json.load(sys.stdin).get('port', 3000)
    print(int(v))
except Exception:
    print(3000)
" 2>/dev/null || true)"
  printf '%s' "${port:-3000}"
}

# gapssa_pid_alive <pid>
# "true"/"false" — nunca se usa una respuesta HTTP con éxito como prueba
# de que el proceso concreto que arrancó apps/web sigue vivo: un servicio
# AJENO que por casualidad responda en el mismo puerto no debe poder
# producir un falso positivo si el proceso propio ya murió.
gapssa_pid_alive() {
  local pid="$1"
  if [ -z "$pid" ]; then
    printf 'false'
    return
  fi
  if kill -0 "$pid" 2>/dev/null; then
    printf 'true'
  else
    printf 'false'
  fi
}
