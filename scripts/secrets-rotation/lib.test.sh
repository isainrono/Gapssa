#!/usr/bin/env bash
# Pruebas de las guardas de seguridad de lib.sh — nunca genera, escribe ni
# imprime ningún secreto real; solo valida las condiciones de RUTA y MODO
# de archivo/directorio con datos de prueba desechables bajo un
# directorio temporal del sistema.
#
# Uso: ./lib.test.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

PASS=0
FAIL=0

assert_exit_code() {
  local description="$1"
  local expected="$2"
  shift 2
  local actual=0
  "$@" >/dev/null 2>&1 || actual="$?"
  if [ "$actual" = "$expected" ]; then
    echo "ok   - $description"
    PASS=$((PASS + 1))
  else
    echo "FAIL - $description (esperado exit=$expected, obtenido exit=$actual)"
    FAIL=$((FAIL + 1))
  fi
}

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# --- gapssa_secrets_abort_if_inside_workspace ---

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

assert_exit_code \
  "aborta con una ruta dentro del workspace" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_abort_if_inside_workspace '$REPO_ROOT/.env'"

assert_exit_code \
  "aborta con una subruta profunda dentro del workspace" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_abort_if_inside_workspace '$REPO_ROOT/apps/web/.env.local'"

OUTSIDE_DIR="$TMP_ROOT/outside-workspace"
mkdir -p "$OUTSIDE_DIR"
assert_exit_code \
  "acepta (no aborta) una ruta claramente fuera del workspace" \
  0 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_abort_if_inside_workspace '$OUTSIDE_DIR/.env.gapssa'"

# --- gapssa_secrets_check_dir_mode / check_file_mode ---

NONEXISTENT_DIR="$TMP_ROOT/does-not-exist"
result="$(gapssa_secrets_check_dir_mode "$NONEXISTENT_DIR")"
if [ "$result" = "false" ]; then
  echo "ok   - directorio inexistente reporta false"
  PASS=$((PASS + 1))
else
  echo "FAIL - directorio inexistente debería reportar false, dio '$result'"
  FAIL=$((FAIL + 1))
fi

WRONG_MODE_DIR="$TMP_ROOT/wrong-mode"
mkdir -p "$WRONG_MODE_DIR"
chmod 755 "$WRONG_MODE_DIR"
result="$(gapssa_secrets_check_dir_mode "$WRONG_MODE_DIR")"
if [ "$result" = "false" ]; then
  echo "ok   - directorio con modo 755 reporta false (se exige 700)"
  PASS=$((PASS + 1))
else
  echo "FAIL - directorio con modo 755 debería reportar false, dio '$result'"
  FAIL=$((FAIL + 1))
fi

RIGHT_MODE_DIR="$TMP_ROOT/right-mode"
mkdir -p "$RIGHT_MODE_DIR"
chmod 700 "$RIGHT_MODE_DIR"
result="$(gapssa_secrets_check_dir_mode "$RIGHT_MODE_DIR")"
if [ "$result" = "true" ]; then
  echo "ok   - directorio con modo 700 reporta true"
  PASS=$((PASS + 1))
else
  echo "FAIL - directorio con modo 700 debería reportar true, dio '$result'"
  FAIL=$((FAIL + 1))
fi

WRONG_MODE_FILE="$TMP_ROOT/wrong-mode-file"
: > "$WRONG_MODE_FILE"
chmod 644 "$WRONG_MODE_FILE"
result="$(gapssa_secrets_check_file_mode "$WRONG_MODE_FILE")"
if [ "$result" = "false" ]; then
  echo "ok   - archivo con modo 644 reporta false (se exige 600)"
  PASS=$((PASS + 1))
else
  echo "FAIL - archivo con modo 644 debería reportar false, dio '$result'"
  FAIL=$((FAIL + 1))
fi

RIGHT_MODE_FILE="$TMP_ROOT/right-mode-file"
: > "$RIGHT_MODE_FILE"
chmod 600 "$RIGHT_MODE_FILE"
result="$(gapssa_secrets_check_file_mode "$RIGHT_MODE_FILE")"
if [ "$result" = "true" ]; then
  echo "ok   - archivo con modo 600 reporta true"
  PASS=$((PASS + 1))
else
  echo "FAIL - archivo con modo 600 debería reportar true, dio '$result'"
  FAIL=$((FAIL + 1))
fi

# --- los scripts de nivel superior rechazan invocación no interactiva ---
# (stdin no-TTY bajo el test runner) — verifica que nunca proceden sin
# confirmación humana explícita, incluso con argumentos por lo demás
# válidos.

assert_exit_code \
  "01-init-external-store.sh rechaza ejecución no interactiva" \
  1 \
  bash -c "echo | '$SCRIPT_DIR/01-init-external-store.sh' '$TMP_ROOT/would-be-store' --dry-run"

# --- guardia de harness: capa 1 (variable de entorno explícita) ---

assert_exit_code \
  "sin ROTACION_GAPSSA_FUERA_DEL_HARNESS=SI, la guardia aborta" \
  1 \
  bash -c "unset ROTACION_GAPSSA_FUERA_DEL_HARNESS; source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_require_interactive_confirmation </dev/null"

assert_exit_code \
  "gapssa_secrets_harness_env_var_ok=false cuando la variable no vale 'SI'" \
  1 \
  bash -c "ROTACION_GAPSSA_FUERA_DEL_HARNESS=si; source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_harness_env_var_ok"

assert_exit_code \
  "gapssa_secrets_harness_env_var_ok=true cuando la variable vale exactamente 'SI'" \
  0 \
  bash -c "ROTACION_GAPSSA_FUERA_DEL_HARNESS=SI; source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_harness_env_var_ok"

# --- guardia de harness: capa 2a (variables de entorno delatoras) ---
#
# El propio entorno de pruebas puede tener variables reales de Claude Code
# ya exportadas (verificado empíricamente: CLAUDE_CODE_ENTRYPOINT está
# presente en la sesión que escribió estas pruebas) — cada subproceso de
# prueba empieza haciendo `unset` de TODA la lista real de
# `_GAPSSA_SUSPECT_ENV_VARS` (nunca una copia parcial hardcodeada, para no
# desincronizarse si la lista cambia) antes de decidir qué exportar.

UNSET_ALL_SUSPECTS='source '"$SCRIPT_DIR"'/lib.sh; unset '"$(printf '%s' "$_GAPSSA_SUSPECT_ENV_VARS")"' TERM_PROGRAM'

result="$(bash -c "$UNSET_ALL_SUSPECTS; gapssa_secrets_harness_suspect_env_var" 2>/dev/null || true)"
if [ -z "$result" ]; then
  echo "ok   - entorno limpio: ninguna variable sospechosa detectada"
  PASS=$((PASS + 1))
else
  echo "FAIL - entorno limpio debería no detectar nada, detectó '$result'"
  FAIL=$((FAIL + 1))
fi

result="$(bash -c "$UNSET_ALL_SUSPECTS; export CLAUDECODE=1; gapssa_secrets_harness_suspect_env_var" 2>/dev/null || true)"
if [ "$result" = "CLAUDECODE" ]; then
  echo "ok   - CLAUDECODE=1 detectado como variable sospechosa"
  PASS=$((PASS + 1))
else
  echo "FAIL - CLAUDECODE=1 debería detectarse, dio '$result'"
  FAIL=$((FAIL + 1))
fi

result="$(bash -c "$UNSET_ALL_SUSPECTS; export TERM_PROGRAM=vscode; gapssa_secrets_harness_suspect_env_var" 2>/dev/null || true)"
if [ "$result" = "TERM_PROGRAM=vscode" ]; then
  echo "ok   - TERM_PROGRAM=vscode detectado como terminal integrada"
  PASS=$((PASS + 1))
else
  echo "FAIL - TERM_PROGRAM=vscode debería detectarse, dio '$result'"
  FAIL=$((FAIL + 1))
fi

result="$(bash -c "$UNSET_ALL_SUSPECTS; export TERM_PROGRAM=Apple_Terminal; gapssa_secrets_harness_suspect_env_var" 2>/dev/null || true)"
if [ -z "$result" ]; then
  echo "ok   - TERM_PROGRAM=Apple_Terminal (Terminal.app real) no se marca como sospechoso"
  PASS=$((PASS + 1))
else
  echo "FAIL - Apple_Terminal no debería detectarse, dio '$result'"
  FAIL=$((FAIL + 1))
fi

# --- guardia de harness: capa 2b (ancestría de procesos), con un `ps`
# falso en PATH — nunca depende de la ancestría real de este proceso de
# pruebas, así el resultado es determinista tanto en local como en CI.

FAKE_BIN="$TMP_ROOT/fake-bin"
mkdir -p "$FAKE_BIN"

# Cadena "sospechosa": 9101(zsh) <- 9102(claude) <- 9103(Terminal) <- 1
cat >"$FAKE_BIN/ps" <<'EOF'
#!/usr/bin/env bash
# ps -o comm= -p PID  |  ps -o ppid= -p PID
pid=""
mode=""
prev=""
for arg in "$@"; do
  case "$prev" in
  -p) pid="$arg" ;;
  esac
  case "$arg" in
  comm=|-ocomm=) mode="comm" ;;
  ppid=|-oppid=) mode="ppid" ;;
  esac
  prev="$arg"
done
case "$1$2" in
  -ocomm=) mode="comm" ;;
  -oppid=) mode="ppid" ;;
esac
case "$pid" in
9101) comm=zsh; ppid=9102 ;;
9102) comm=claude; ppid=9103 ;;
9103) comm=Terminal; ppid=1 ;;
*) comm=unknown; ppid=1 ;;
esac
if [ "$mode" = "ppid" ]; then
  echo "$ppid"
else
  echo "$comm"
fi
EOF
chmod +x "$FAKE_BIN/ps"

result="$(PATH="$FAKE_BIN:$PATH" bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_harness_suspect_ancestor 9101" 2>/dev/null || true)"
if [ "$result" = "claude" ]; then
  echo "ok   - ancestro 'claude' detectado en la cadena de procesos simulada"
  PASS=$((PASS + 1))
else
  echo "FAIL - debería detectar 'claude' como ancestro, dio '$result'"
  FAIL=$((FAIL + 1))
fi

# Cadena "limpia": 9201(zsh) <- 9202(login) <- 9203(Terminal) <- 1
cat >"$FAKE_BIN/ps" <<'EOF'
#!/usr/bin/env bash
pid=""
mode=""
prev=""
for arg in "$@"; do
  case "$prev" in
  -p) pid="$arg" ;;
  esac
  case "$arg" in
  comm=|-ocomm=) mode="comm" ;;
  ppid=|-oppid=) mode="ppid" ;;
  esac
  prev="$arg"
done
case "$pid" in
9201) comm=zsh; ppid=9202 ;;
9202) comm=login; ppid=9203 ;;
9203) comm=Terminal; ppid=1 ;;
*) comm=unknown; ppid=1 ;;
esac
if [ "$mode" = "ppid" ]; then
  echo "$ppid"
else
  echo "$comm"
fi
EOF
chmod +x "$FAKE_BIN/ps"

result="$(PATH="$FAKE_BIN:$PATH" bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_harness_suspect_ancestor 9201" 2>/dev/null || true)"
if [ -z "$result" ]; then
  echo "ok   - cadena de procesos limpia no dispara falso positivo"
  PASS=$((PASS + 1))
else
  echo "FAIL - la cadena limpia no debería detectar nada, detectó '$result'"
  FAIL=$((FAIL + 1))
fi

# --- máquina de estados ---

STATUS_FILE_TEST="$TMP_ROOT/state-store/.rotation-status"
result="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_get '$STATUS_FILE_TEST' S1")"
if [ "$result" = "pending" ]; then
  echo "ok   - puerta sin registro previo reporta estado 'pending'"
  PASS=$((PASS + 1))
else
  echo "FAIL - debería reportar 'pending', dio '$result'"
  FAIL=$((FAIL + 1))
fi

bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_set '$STATUS_FILE_TEST' S1 applying"
result="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_get '$STATUS_FILE_TEST' S1")"
if [ "$result" = "applying" ]; then
  echo "ok   - transición pending -> applying persiste"
  PASS=$((PASS + 1))
else
  echo "FAIL - debería persistir 'applying', dio '$result'"
  FAIL=$((FAIL + 1))
fi

bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_set '$STATUS_FILE_TEST' S1 done"
result="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_get '$STATUS_FILE_TEST' S1")"
if [ "$result" = "done" ]; then
  echo "ok   - transición applying -> done reemplaza (no duplica) la línea anterior"
  PASS=$((PASS + 1))
else
  echo "FAIL - debería persistir 'done', dio '$result'"
  FAIL=$((FAIL + 1))
fi

lines_for_s1="$(grep -c '^S1=' "$STATUS_FILE_TEST" || true)"
if [ "$lines_for_s1" = "1" ]; then
  echo "ok   - el archivo de estado nunca acumula líneas duplicadas para la misma puerta"
  PASS=$((PASS + 1))
else
  echo "FAIL - debería haber exactamente 1 línea S1=, hay $lines_for_s1"
  FAIL=$((FAIL + 1))
fi

result="$(gapssa_secrets_check_file_mode "$STATUS_FILE_TEST")"
if [ "$result" = "true" ]; then
  echo "ok   - el archivo de estado queda en modo 600"
  PASS=$((PASS + 1))
else
  echo "FAIL - el archivo de estado debería quedar en modo 600, dio '$result'"
  FAIL=$((FAIL + 1))
fi

assert_exit_code \
  "gapssa_secrets_state_set rechaza un estado fuera del conjunto cerrado" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_set '$STATUS_FILE_TEST' S2 no-es-un-estado-valido"

assert_exit_code \
  "gapssa_secrets_state_set rechaza escribir el estado dentro del workspace" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_set '$REPO_ROOT/.rotation-status' S1 done"

# --- ficheros temporales seguros ---

TMPDIR_TEST="$TMP_ROOT/secure-tmp"
secure_file="$(bash -c "export GAPSSA_SECRETS_TMPDIR='$TMPDIR_TEST'; source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_mktemp_secure gapssa-test")"
if [ -f "$secure_file" ]; then
  echo "ok   - gapssa_secrets_mktemp_secure crea el archivo"
  PASS=$((PASS + 1))
else
  echo "FAIL - gapssa_secrets_mktemp_secure debería crear un archivo, no existe '$secure_file'"
  FAIL=$((FAIL + 1))
fi

case "$secure_file" in
"$TMPDIR_TEST"/*)
  echo "ok   - el archivo se crea dentro de GAPSSA_SECRETS_TMPDIR (no en el /tmp del sistema por defecto)"
  PASS=$((PASS + 1))
  ;;
*)
  echo "FAIL - debería crearse dentro de '$TMPDIR_TEST', se creó en '$secure_file'"
  FAIL=$((FAIL + 1))
  ;;
esac

result="$(gapssa_secrets_check_file_mode "$secure_file")"
if [ "$result" = "true" ]; then
  echo "ok   - el archivo temporal seguro queda en modo 600"
  PASS=$((PASS + 1))
else
  echo "FAIL - debería quedar en modo 600, dio '$result'"
  FAIL=$((FAIL + 1))
fi

echo -n "contenido-de-prueba-no-secreto" >"$secure_file"
gapssa_secrets_shred "$secure_file"
if [ ! -f "$secure_file" ]; then
  echo "ok   - gapssa_secrets_shred borra el archivo temporal"
  PASS=$((PASS + 1))
else
  echo "FAIL - el archivo temporal debería haberse borrado"
  FAIL=$((FAIL + 1))
fi

# Bug real detectado en las pruebas de rotate-all-interactive.sh: varias
# llamadas pasaban 2-3 ficheros a la vez esperando que TODOS se borraran —
# gapssa_secrets_shred debe aceptar múltiples argumentos, no ignorar los
# que sobran del primero.
MULTI_A="$TMP_ROOT/secure-tmp/multi-a"
MULTI_B="$TMP_ROOT/secure-tmp/multi-b"
MULTI_C="$TMP_ROOT/secure-tmp/multi-c"
echo -n "a" >"$MULTI_A"
echo -n "b" >"$MULTI_B"
echo -n "c" >"$MULTI_C"
gapssa_secrets_shred "$MULTI_A" "$MULTI_B" "$MULTI_C"
if [ ! -f "$MULTI_A" ] && [ ! -f "$MULTI_B" ] && [ ! -f "$MULTI_C" ]; then
  echo "ok   - gapssa_secrets_shred borra TODOS los ficheros cuando se le pasa más de uno"
  PASS=$((PASS + 1))
else
  echo "FAIL - gapssa_secrets_shred debería borrar los 3 ficheros, quedaron: $([ -f "$MULTI_A" ] && echo -n "$MULTI_A ")$([ -f "$MULTI_B" ] && echo -n "$MULTI_B ")$([ -f "$MULTI_C" ] && echo -n "$MULTI_C ")"
  FAIL=$((FAIL + 1))
fi

assert_exit_code \
  "gapssa_secrets_mktemp_secure rechaza un directorio temporal dentro del workspace" \
  1 \
  bash -c "export GAPSSA_SECRETS_TMPDIR='$REPO_ROOT/tmp-would-be-inside'; source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_mktemp_secure gapssa-test"

if [ ! -e "$REPO_ROOT/tmp-would-be-inside" ]; then
  echo "ok   - el intento rechazado no deja ningún directorio creado dentro del workspace"
  PASS=$((PASS + 1))
else
  echo "FAIL - se creó '$REPO_ROOT/tmp-would-be-inside' dentro del workspace pese al rechazo"
  FAIL=$((FAIL + 1))
  rm -rf "$REPO_ROOT/tmp-would-be-inside"
fi

# --- BLOQUE 2: xtrace rechazado al cargar lib.sh ---

assert_exit_code \
  "lib.sh rechaza cargarse con xtrace (set -x) activo" \
  1 \
  bash -x -c "source '$SCRIPT_DIR/lib.sh'"

# --- BLOQUE 2: temporal fijado en el mismo directorio (mktemp_secure_same_dir) ---

SAME_DIR_TARGET_DIR="$TMP_ROOT/same-dir-target"
mkdir -p "$SAME_DIR_TARGET_DIR"
SAME_DIR_TARGET="$SAME_DIR_TARGET_DIR/.env.gapssa"
: >"$SAME_DIR_TARGET"

pin_lines="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_mktemp_secure_same_dir '$SAME_DIR_TARGET' restore")"
pinned_path="$(printf '%s\n' "$pin_lines" | sed -n '1p')"
pinned_dir="$(printf '%s\n' "$pin_lines" | sed -n '2p')"
pinned_statline="$(printf '%s\n' "$pin_lines" | sed -n '3p')"

SAME_DIR_TARGET_DIR_CANONICAL="$(cd "$SAME_DIR_TARGET_DIR" && pwd -P)"
case "$pinned_path" in
"$SAME_DIR_TARGET_DIR_CANONICAL"/*)
  echo "ok   - mktemp_secure_same_dir crea el temporal en el MISMO directorio que el destino"
  PASS=$((PASS + 1))
  ;;
*)
  echo "FAIL - debería crearse dentro de '$SAME_DIR_TARGET_DIR', se creó en '$pinned_path'"
  FAIL=$((FAIL + 1))
  ;;
esac

result="$(gapssa_secrets_check_file_mode "$pinned_path")"
if [ "$result" = "true" ]; then
  echo "ok   - el temporal fijado queda en modo 600"
  PASS=$((PASS + 1))
else
  echo "FAIL - debería quedar en modo 600, dio '$result'"
  FAIL=$((FAIL + 1))
fi

assert_exit_code \
  "mktemp_secure_same_dir rechaza un destino dentro del workspace" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_mktemp_secure_same_dir '$REPO_ROOT/.env' restore"

read -r pinned_dev pinned_ino pinned_uid pinned_mode <<<"$pinned_statline"

assert_exit_code \
  "verify_pinned_tmp acepta el temporal recién creado con su propio pin" \
  0 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_verify_pinned_tmp '$pinned_path' '$pinned_dir' '$pinned_dev' '$pinned_ino' '$pinned_uid' '$pinned_mode'"

# --- BLOQUE 2: verify_pinned_tmp / shred_pinned detectan sustitución ---

# 1) sustitución por symlink antes de la limpieza: el temporal original se
#    borra y se sustituye por un symlink hacia otro fichero — verify debe
#    rechazarlo (nunca seguir el enlace), y shred_pinned nunca debe
#    sobrescribir el destino del enlace.
SUBST_VICTIM="$TMP_ROOT/same-dir-target/victima-no-debe-tocarse"
printf 'CONTENIDO-QUE-DEBE-SOBREVIVIR' >"$SUBST_VICTIM"
rm -f "$pinned_path"
ln -s "$SUBST_VICTIM" "$pinned_path"

assert_exit_code \
  "verify_pinned_tmp rechaza el temporal sustituido por un symlink" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_verify_pinned_tmp '$pinned_path' '$pinned_dir' '$pinned_dev' '$pinned_ino' '$pinned_uid' '$pinned_mode'"

bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_shred_pinned '$pinned_path' '$pinned_dir' '$pinned_dev' '$pinned_ino' '$pinned_uid' '$pinned_mode'" >/dev/null 2>&1 || true
if [ -f "$SUBST_VICTIM" ] && [ "$(cat "$SUBST_VICTIM")" = "CONTENIDO-QUE-DEBE-SOBREVIVIR" ]; then
  echo "ok   - shred_pinned ante un symlink NUNCA sobrescribe el fichero destino"
  PASS=$((PASS + 1))
else
  echo "FAIL - el destino del symlink debería seguir intacto, victima='$SUBST_VICTIM'"
  FAIL=$((FAIL + 1))
fi

# 2) cambio de inodo: el temporal se borra y se recrea con el MISMO nombre
#    (inodo distinto) — debe detectarse aunque la ruta sea idéntica.
rm -f "$pinned_path"
: >"$pinned_path"
chmod 600 "$pinned_path"

assert_exit_code \
  "verify_pinned_tmp detecta un cambio de inodo bajo la misma ruta" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_verify_pinned_tmp '$pinned_path' '$pinned_dir' '$pinned_dev' '$pinned_ino' '$pinned_uid' '$pinned_mode'"

# 3) directorio padre inesperado: verify_pinned_tmp recibe el directorio
#    canónico esperado como argumento explícito (nunca lo re-deriva "de
#    memoria") — un fichero perfectamente válido, con SU directorio real
#    pasado deliberadamente distinto al esperado, debe rechazarse. Esto es
#    exactamente lo que ocurre cuando el componente padre de la ruta fue
#    sustituido (p.ej. por un symlink) entre el momento en que se fijó el
#    pin y el momento en que se revalida.
PARENT_REAL="$TMP_ROOT/parent-real"
PARENT_OTHER="$TMP_ROOT/parent-other"
mkdir -p "$PARENT_REAL" "$PARENT_OTHER"
parent_target="$PARENT_REAL/.env.gapssa"
: >"$parent_target"
parent_pin_lines="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_mktemp_secure_same_dir '$parent_target' restore")"
parent_path="$(printf '%s\n' "$parent_pin_lines" | sed -n '1p')"
parent_statline="$(printf '%s\n' "$parent_pin_lines" | sed -n '3p')"
read -r parent_dev parent_ino parent_uid parent_mode <<<"$parent_statline"
parent_other_canonical="$(cd "$PARENT_OTHER" && pwd -P)"

assert_exit_code \
  "verify_pinned_tmp rechaza cuando el directorio padre esperado no coincide con el real (sustitución del padre)" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_verify_pinned_tmp '$parent_path' '$parent_other_canonical' '$parent_dev' '$parent_ino' '$parent_uid' '$parent_mode'"

# 4) propietario/modo inesperados: se fuerza un pin con valores que NO
#    coinciden con el fichero real (simulado, ya que las pruebas corren sin
#    privilegios y no pueden cambiar el propietario real de un fichero).
UNEXPECTED_TARGET="$TMP_ROOT/same-dir-target/otro.tmp"
: >"$UNEXPECTED_TARGET"
chmod 600 "$UNEXPECTED_TARGET"
real_dir="$(cd "$(dirname "$UNEXPECTED_TARGET")" && pwd -P)"
real_statline="$(stat -f '%d %i %u %Lp' "$UNEXPECTED_TARGET" 2>/dev/null || stat -c '%d %i %u %a' "$UNEXPECTED_TARGET" 2>/dev/null)"
read -r real_dev real_ino real_uid real_mode <<<"$real_statline"

assert_exit_code \
  "verify_pinned_tmp rechaza un propietario (uid) inesperado" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_verify_pinned_tmp '$UNEXPECTED_TARGET' '$real_dir' '$real_dev' '$real_ino' '99999' '$real_mode'"

assert_exit_code \
  "verify_pinned_tmp rechaza un modo inesperado" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_verify_pinned_tmp '$UNEXPECTED_TARGET' '$real_dir' '$real_dev' '$real_ino' '$real_uid' '644'"

# --- BLOQUE 2: safe_unlink_if_symlink solo borra el enlace, nunca el destino ---

UNLINK_VICTIM="$TMP_ROOT/same-dir-target/unlink-victima"
printf 'CONTENIDO-QUE-DEBE-SOBREVIVIR-2' >"$UNLINK_VICTIM"
UNLINK_LINK="$TMP_ROOT/same-dir-target/unlink-enlace"
ln -s "$UNLINK_VICTIM" "$UNLINK_LINK"
bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_safe_unlink_if_symlink '$UNLINK_LINK'"
if [ ! -e "$UNLINK_LINK" ] && [ -L "$UNLINK_LINK" ] 2>/dev/null; then
  : # no debería llegar aquí (comprobación redundante, ver siguiente bloque)
fi
if [ ! -e "$UNLINK_LINK" ] && [ ! -L "$UNLINK_LINK" ] && [ -f "$UNLINK_VICTIM" ] && [ "$(cat "$UNLINK_VICTIM")" = "CONTENIDO-QUE-DEBE-SOBREVIVIR-2" ]; then
  echo "ok   - safe_unlink_if_symlink borra el enlace y deja el destino intacto"
  PASS=$((PASS + 1))
else
  echo "FAIL - el enlace debería haber desaparecido y el destino seguir intacto"
  FAIL=$((FAIL + 1))
fi

NOT_A_SYMLINK="$TMP_ROOT/same-dir-target/no-es-enlace"
printf 'x' >"$NOT_A_SYMLINK"
bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_safe_unlink_if_symlink '$NOT_A_SYMLINK'"
if [ -f "$NOT_A_SYMLINK" ]; then
  echo "ok   - safe_unlink_if_symlink no toca un fichero regular (solo actúa sobre symlinks)"
  PASS=$((PASS + 1))
else
  echo "FAIL - un fichero regular no debería haberse borrado"
  FAIL=$((FAIL + 1))
fi

# --- BLOQUE 2: digest de fichero coincide con una referencia de confianza ---

DIGEST_FIXTURE="$TMP_ROOT/digest-fixture.txt"
printf 'contenido-de-prueba-para-digest-001' >"$DIGEST_FIXTURE"
reference_digest="$(shasum -a 256 "$DIGEST_FIXTURE" 2>/dev/null | cut -d' ' -f1 || sha256sum "$DIGEST_FIXTURE" | cut -d' ' -f1)"
result="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_digest_of_file '$DIGEST_FIXTURE'")"
if [ "$result" = "$reference_digest" ]; then
  echo "ok   - gapssa_secrets_digest_of_file coincide con una referencia de confianza (shasum/sha256sum)"
  PASS=$((PASS + 1))
else
  echo "FAIL - digest '$result' no coincide con la referencia '$reference_digest'"
  FAIL=$((FAIL + 1))
fi

# --- BLOQUE 2: nuevo estado de la máquina de estados ---

# --- BLOQUE 5: escapado seguro para ficheros de configuración `curl -K` ---

if result="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_curl_cfg_escape 'sin-especiales'")" && [ "$result" = "sin-especiales" ]; then
  echo "ok   - gapssa_secrets_curl_cfg_escape: valor sin caracteres especiales queda igual"
  PASS=$((PASS + 1))
else
  echo "FAIL - gapssa_secrets_curl_cfg_escape: valor sin caracteres especiales queda igual (obtenido: '${result:-}')"
  FAIL=$((FAIL + 1))
fi

if result="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_curl_cfg_escape 'con\"comilla'")" && [ "$result" = 'con\"comilla' ]; then
  echo "ok   - gapssa_secrets_curl_cfg_escape: comilla doble embebida se escapa a \\\""
  PASS=$((PASS + 1))
else
  echo "FAIL - gapssa_secrets_curl_cfg_escape: comilla doble embebida se escapa a \\\" (obtenido: '${result:-}')"
  FAIL=$((FAIL + 1))
fi

if result="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_curl_cfg_escape 'con\\\\barra'")" && [ "$result" = 'con\\\\barra' ]; then
  echo "ok   - gapssa_secrets_curl_cfg_escape: backslash embebido se escapa a \\\\\\\\"
  PASS=$((PASS + 1))
else
  echo "FAIL - gapssa_secrets_curl_cfg_escape: backslash embebido se escapa a \\\\\\\\ (obtenido: '${result:-}')"
  FAIL=$((FAIL + 1))
fi

# El valor escapado, embebido en una línea real de config `curl -K` y
# re-parseado por curl, debe reproducir el valor ORIGINAL exacto — la
# prueba de fondo que de verdad importa (no solo "el escapado tiene la
# forma esperada", sino "curl lo reconstruye correctamente"). Se verifica
# con un servidor HTTP local mínimo (python3 http.server + un handler que
# devuelve el propio header Authorization recibido) — un intento contra
# un puerto cerrado nunca llega a construir/enviar la cabecera Basic Auth.
if command -v curl >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1; then
  cfgtest_dir="$(mktemp -d "$TMP_ROOT/curlcfgtest.XXXXXX")"
  cfgtest_file="$cfgtest_dir/cfg"
  probe_port=18923
  raw_value='adversarial-$(){};'"'"'"\pw'
  escaped_value="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_curl_cfg_escape \"\$1\"" _ "$raw_value")"
  {
    echo "silent"
    printf 'user = "probe:%s"\n' "$escaped_value"
  } >"$cfgtest_file"

  cat >"$cfgtest_dir/echo_auth_server.py" <<'PYEOF'
import base64, http.server, sys
port = int(sys.argv[1])
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        auth = self.headers.get("Authorization", "")
        body = auth.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *a):
        pass
http.server.HTTPServer(("127.0.0.1", port), Handler).serve_forever()
PYEOF
  python3 "$cfgtest_dir/echo_auth_server.py" "$probe_port" &
  probe_server_pid=$!
  probe_ready=false
  for _ in $(seq 1 20); do
    if curl -sS -o /dev/null --connect-timeout 1 "http://127.0.0.1:${probe_port}/" 2>/dev/null; then
      probe_ready=true
      break
    fi
    sleep 0.2
  done

  if [ "$probe_ready" = true ]; then
    got_auth="$(curl -K "$cfgtest_file" -sS "http://127.0.0.1:${probe_port}/")"
    expected_auth="Basic $(printf 'probe:%s' "$raw_value" | base64 | tr -d '\n')"
    if [ "$got_auth" = "$expected_auth" ]; then
      echo "ok   - gapssa_secrets_curl_cfg_escape: curl reconstruye el valor EXACTO (comilla/backslash/\$()/;) desde el fichero -K"
      PASS=$((PASS + 1))
    else
      echo "FAIL - gapssa_secrets_curl_cfg_escape: curl reconstruye el valor EXACTO desde el fichero -K"
      FAIL=$((FAIL + 1))
    fi
  else
    echo "AVISO: servidor de prueba local no respondió a tiempo — se omite la comprobación de round-trip real de curl -K (no cuenta como fallo del propio escapado)."
  fi
  kill "$probe_server_pid" 2>/dev/null || true
  wait "$probe_server_pid" 2>/dev/null || true
  rm -rf "$cfgtest_dir"
fi

assert_exit_code \
  "gapssa_secrets_state_set acepta el nuevo estado 'server_coordination_required'" \
  0 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_set '$TMP_ROOT/state-store-2/.rotation-status' S2 server_coordination_required"

# --- BLOQUE 5: nuevo estado 'forward_recovery_required' (API Key
# irreversible recuperada hacia delante) ---

assert_exit_code \
  "gapssa_secrets_state_set acepta el nuevo estado 'forward_recovery_required'" \
  0 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_set '$TMP_ROOT/state-store-2/.rotation-status' S4 forward_recovery_required"

assert_exit_code \
  "gapssa_secrets_state_is_valid acepta 'forward_recovery_required'" \
  0 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_is_valid forward_recovery_required"

if state_readback="$(bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_state_set '$TMP_ROOT/state-store-2/.rotation-status' S4 forward_recovery_required; gapssa_secrets_state_get '$TMP_ROOT/state-store-2/.rotation-status' S4")" && [ "$state_readback" = "forward_recovery_required" ]; then
  echo "ok   - 'forward_recovery_required' se lee de vuelta exactamente igual tras escribirse"
  PASS=$((PASS + 1))
else
  echo "FAIL - 'forward_recovery_required' no se leyó de vuelta correctamente (leído: '${state_readback:-}')"
  FAIL=$((FAIL + 1))
fi

# --- BLOQUE 2: pila de limpieza global — TIPADA, sin eval — idempotencia
# y composición. ---

# LIFO: se registran DOS umask distintos; el dispatcher los ejecuta en
# orden INVERSO al de registro, así que el ÚLTIMO en aplicarse (y por
# tanto el umask final observable) es el PRIMERO que se registró — si el
# orden fuera FIFO, el resultado final sería el otro valor.
result="$(bash -c "
  source '$SCRIPT_DIR/lib.sh'
  gapssa_cleanup_push restore_umask 022
  gapssa_cleanup_push restore_umask 077
  gapssa_cleanup_dispatch
  umask
")"
if [ "$result" = "0022" ]; then
  echo "ok   - la pila de limpieza se ejecuta en orden inverso (LIFO) al de registro"
  PASS=$((PASS + 1))
else
  echo "FAIL - orden inesperado en la pila de limpieza: umask final '$result', se esperaba '0022'"
  FAIL=$((FAIL + 1))
fi

# Idempotencia: tras un primer dispatch, se cambia el umask A MANO; un
# segundo dispatch NUNCA debe tocarlo de nuevo.
result="$(bash -c "
  source '$SCRIPT_DIR/lib.sh'
  gapssa_cleanup_push restore_umask 022
  gapssa_cleanup_dispatch
  umask 077
  gapssa_cleanup_dispatch
  umask
")"
if [ "$result" = "0077" ]; then
  echo "ok   - gapssa_cleanup_dispatch es idempotente (una segunda llamada no repite la limpieza)"
  PASS=$((PASS + 1))
else
  echo "FAIL - se esperaba que el segundo dispatch no tocara nada (umask final '0077'), dio '$result'"
  FAIL=$((FAIL + 1))
fi

# gapssa_cleanup_pop_matching retira una entrada para que el dispatcher no
# la repita (p.ej. tras una limpieza ya hecha a mano por el llamador) —
# probado con la operación real shred_plain sobre un fichero desechable.
CLEANUP_SHRED_TARGET="$TMP_ROOT/cleanup-shred-target"
printf 'x' >"$CLEANUP_SHRED_TARGET"
bash -c "
  source '$SCRIPT_DIR/lib.sh'
  gapssa_cleanup_push shred_plain '$CLEANUP_SHRED_TARGET'
  gapssa_cleanup_pop_matching shred_plain '$CLEANUP_SHRED_TARGET'
  gapssa_cleanup_dispatch
"
if [ -f "$CLEANUP_SHRED_TARGET" ]; then
  echo "ok   - gapssa_cleanup_pop_matching retira una entrada antes de que el dispatcher la ejecute"
  PASS=$((PASS + 1))
else
  echo "FAIL - la entrada retirada con pop_matching no debería haberse ejecutado"
  FAIL=$((FAIL + 1))
fi

# Sin eval / sin inyección: un argumento con metacaracteres de shell
# (`;`, sustitución de comando, backticks, `#`) viaja como TEXTO LITERAL
# del argumento — nunca se interpreta como código adicional. Se prueba
# con la operación real shred_plain sobre una ruta que, si se
# interpretara como shell, crearía INJECTION_MARKER.
INJECTION_MARKER="$TMP_ROOT/injection-marker"
rm -f "$INJECTION_MARKER"
bash -c "
  source '$SCRIPT_DIR/lib.sh'
  gapssa_cleanup_push shred_plain '/no/existe/nada; touch $INJECTION_MARKER #'
  gapssa_cleanup_dispatch
"
if [ ! -e "$INJECTION_MARKER" ]; then
  echo "ok   - un argumento con metacaracteres de shell nunca se ejecuta como comando adicional (sin eval)"
  PASS=$((PASS + 1))
else
  echo "FAIL - el metacarácter se interpretó como comando — posible eval activo"
  FAIL=$((FAIL + 1))
fi

# Una operación fuera del conjunto cerrado (allowlist) nunca se ejecuta.
UNKNOWN_OP_MARKER="$TMP_ROOT/unknown-op-marker"
rm -f "$UNKNOWN_OP_MARKER"
bash -c "
  source '$SCRIPT_DIR/lib.sh'
  gapssa_cleanup_push operacion_inventada '$UNKNOWN_OP_MARKER'
  gapssa_cleanup_dispatch
"
if [ ! -e "$UNKNOWN_OP_MARKER" ]; then
  echo "ok   - una operación fuera de la allowlist cerrada nunca se ejecuta"
  PASS=$((PASS + 1))
else
  echo "FAIL - se ejecutó una operación no declarada en la allowlist"
  FAIL=$((FAIL + 1))
fi

# --- BLOQUE 2 (corrección): la pila de limpieza NUNCA serializa varios
# argumentos en una sola cadena con un delimitador — \x1f (separador de
# unidad ASCII) SÍ puede aparecer en un nombre de fichero POSIX real (los
# únicos bytes prohibidos son NUL y "/"), así que un diseño anterior que
# lo usaba como "delimitador seguro" era incorrecto. Aquí cada argumento
# vive en su propio array (GAPSSA_CLEANUP_ARG1..ARG6) — se prueba
# operando sobre FICHEROS REALES cuyo nombre contiene, literalmente,
# cada uno de esos bytes/metacaracteres, usando parámetros posicionales
# de `bash -c` (nunca interpolación de cadena) para no reintroducir un
# problema de escapado equivalente en la propia prueba.

CLEANUP_PRESERVE_DIR="$TMP_ROOT/cleanup-preserve"
mkdir -p "$CLEANUP_PRESERVE_DIR"

_run_cleanup_preserve_case() {
  local label="$1" name="$2"
  local target_file="$CLEANUP_PRESERVE_DIR/$name"
  printf 'x' >"$target_file"
  bash -c '
    source "$1/lib.sh"
    gapssa_cleanup_push shred_plain "$2"
    gapssa_cleanup_dispatch
  ' _ "$SCRIPT_DIR" "$target_file"
  if [ -f "$target_file" ]; then
    echo "FAIL - preservación de argumento ($label): el fichero objetivo no se borró — el argumento no llegó intacto a la operación"
    FAIL=$((FAIL + 1))
  else
    echo "ok   - preservación de argumento ($label): el argumento (nombre de fichero) llegó intacto a la operación"
    PASS=$((PASS + 1))
  fi
}

_run_cleanup_preserve_case "espacios" "con espacios de sobra"
_run_cleanup_preserve_case "byte \\x1f" "$(printf 'con\x1fseparador')"
_run_cleanup_preserve_case "salto de línea" "$(printf 'con\nsalto')"
_run_cleanup_preserve_case "tab" "$(printf 'con\ttab')"
_run_cleanup_preserve_case "comilla simple" "con'comilla"
_run_cleanup_preserve_case "comilla doble" 'con"comilla'
_run_cleanup_preserve_case '$() sustitución de comando' 'con$(marker)'
_run_cleanup_preserve_case "backticks" 'con`marker`'
_run_cleanup_preserve_case "punto y coma" "con;marker"
_run_cleanup_preserve_case "ampersand" "con&marker"

# Ninguno de los casos anteriores debe haber creado un marcador de
# inyección en el directorio de pruebas (serían ficheros nuevos con
# nombre "marker" sueltos si `;`/`$()`/backticks se hubieran ejecutado).
if [ ! -e "$TMP_ROOT/marker" ] && [ ! -e "$CLEANUP_PRESERVE_DIR/marker" ]; then
  echo "ok   - ningún caso anterior creó un marcador de inyección"
  PASS=$((PASS + 1))
else
  echo "FAIL - se encontró un marcador de inyección — algún metacarácter se interpretó como comando"
  FAIL=$((FAIL + 1))
fi

# Argumento VACÍO preservado como tal (distinto de "argumento ausente") —
# inspección directa del estado interno.
result="$(bash -c "
  source '$SCRIPT_DIR/lib.sh'
  gapssa_cleanup_push shred_plain ''
  printf 'argc=%s arg1=[%s]' \"\${GAPSSA_CLEANUP_ARGC[0]}\" \"\${GAPSSA_CLEANUP_ARG1[0]}\"
")"
if [ "$result" = "argc=1 arg1=[]" ]; then
  echo "ok   - un argumento vacío se preserva como tal (argc=1, no se confunde con 'ausente')"
  PASS=$((PASS + 1))
else
  echo "FAIL - argumento vacío no preservado correctamente: '$result'"
  FAIL=$((FAIL + 1))
fi

# pop_matching con comparación EXACTA: dos entradas con los mismos
# argumentos salvo el ÚLTIMO — pop_matching debe retirar SOLO la que
# coincide exactamente en los 6, dejando la otra intacta en la pila.
result="$(bash -c "
  source '$SCRIPT_DIR/lib.sh'
  gapssa_cleanup_push shred_pinned_tmp a b c d e f
  gapssa_cleanup_push shred_pinned_tmp a b c d e g
  gapssa_cleanup_pop_matching shred_pinned_tmp a b c d e f
  printf 'remaining=%s last=%s' \"\${#GAPSSA_CLEANUP_OPS[@]}\" \"\${GAPSSA_CLEANUP_ARG6[0]}\"
")"
if [ "$result" = "remaining=1 last=g" ]; then
  echo "ok   - pop_matching retira SOLO la entrada con los 6 argumentos exactamente iguales, deja la que difiere en uno"
  PASS=$((PASS + 1))
else
  echo "FAIL - pop_matching no distinguió entradas que difieren en un solo argumento: '$result'"
  FAIL=$((FAIL + 1))
fi

# --- BLOQUE 2 (corrección): gapssa_secrets_parse_orphan_stream — protocolo
# NUL-delimitado campo a campo (nunca \x1f empaquetado). Construido con
# `printf '%s\0' campo1 campo2 ...` — cada `%s` produce un campo, cada
# `\0` es su propio delimitador, sin colisión con dígitos siguientes
# (a diferencia de escribir literalmente "\0123" en una sola cadena de
# formato, donde bash interpretaría "\0123" como UN escape octal). ---

result="$(bash -c "
  source '$SCRIPT_DIR/lib.sh'
  gapssa_secrets_parse_orphan_stream < <(printf '%s\0' regular /tmp/a 100 200 501 600 symlink /tmp/b 100 201 501 600)
  printf 'rc=%s count=%s p0=%s p1=%s' \"\$?\" \"\${#GAPSSA_ORPHAN_TYPES[@]}\" \"\${GAPSSA_ORPHAN_PATHS[0]}\" \"\${GAPSSA_ORPHAN_PATHS[1]}\"
")"
if [ "$result" = "rc=0 count=2 p0=/tmp/a p1=/tmp/b" ]; then
  echo "ok   - gapssa_secrets_parse_orphan_stream interpreta un flujo válido de 2 registros"
  PASS=$((PASS + 1))
else
  echo "FAIL - flujo válido mal interpretado: '$result'"
  FAIL=$((FAIL + 1))
fi

assert_exit_code \
  "gapssa_secrets_parse_orphan_stream rechaza un flujo truncado (número de campos no múltiplo de 6)" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_parse_orphan_stream < <(printf '%s\0' regular /tmp/a 100 200 501)"

result="$(bash -c "
  source '$SCRIPT_DIR/lib.sh'
  gapssa_secrets_parse_orphan_stream < <(printf '%s\0' regular /tmp/a 100 200 501) 2>/dev/null || true
  printf 'count-after-fail=%s' \"\${#GAPSSA_ORPHAN_TYPES[@]}\"
")"
if [ "$result" = "count-after-fail=0" ]; then
  echo "ok   - un flujo truncado deja los arrays vacíos (nunca datos parciales a medio interpretar)"
  PASS=$((PASS + 1))
else
  echo "FAIL - un flujo truncado no debería dejar datos parciales: '$result'"
  FAIL=$((FAIL + 1))
fi

assert_exit_code \
  "gapssa_secrets_parse_orphan_stream rechaza un tipo fuera del conjunto cerrado" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_parse_orphan_stream < <(printf '%s\0' fifo /tmp/a 100 200 501 600)"

assert_exit_code \
  "gapssa_secrets_parse_orphan_stream rechaza un 'dev' con formato no numérico" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_parse_orphan_stream < <(printf '%s\0' regular /tmp/a abc 200 501 600)"

assert_exit_code \
  "gapssa_secrets_parse_orphan_stream rechaza un 'modo' con formato no octal" \
  1 \
  bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_parse_orphan_stream < <(printf '%s\0' regular /tmp/a 100 200 501 899)"

# Una ruta que contenga \x1f, tab o salto de línea se preserva como UN
# solo campo — nunca se parte en campos de más (que rompería el
# agrupamiento de 6 en 6 y sería detectado como flujo "truncado" o con
# campos desplazados).
result="$(bash -c "
  source '$SCRIPT_DIR/lib.sh'
  weird=\"\$(printf 'con\x1ftab\there\nsalto')\"
  gapssa_secrets_parse_orphan_stream < <(printf '%s\0' regular \"\$weird\" 100 200 501 600)
  printf 'rc=%s count=%s path=[%s]' \"\$?\" \"\${#GAPSSA_ORPHAN_TYPES[@]}\" \"\${GAPSSA_ORPHAN_PATHS[0]}\"
")"
expected="rc=0 count=1 path=[$(printf 'con\x1ftab\there\nsalto')]"
if [ "$result" = "$expected" ]; then
  echo "ok   - una ruta con \\x1f/tab/salto de línea se interpreta como UN solo campo, nunca partida"
  PASS=$((PASS + 1))
else
  echo "FAIL - ruta con bytes especiales mal interpretada: '$result' (se esperaba '$expected')"
  FAIL=$((FAIL + 1))
fi


# ---------------------------------------------------------------------------
# BLOQUE 3 (gate_s7 — old_internal_api_file): la retirada del artefacto S6
# usa un protocolo propio (inspectArtifact/removeArtifactStrict, ver
# secureArtifact.test.mts) y NUNCA pasa por esta pila. El único fichero de
# este bloque que SÍ se registra aquí es old_internal_api_file (el valor
# ANTERIOR de BOOKING_INTERNAL_API_SECRET), con la operación shred_plain
# ya existente — mismo primitivo genérico probado arriba, aquí se fija el
# patrón EXACTO que gate_s7() usa (mktemp con el prefijo real
# "gapssa-s7-old-internal-api", registro inmediato tras crear, antes de
# escribir el valor) para que una regresión en ese patrón concreto quede
# cubierta con su propio nombre, no solo de forma genérica.
# ---------------------------------------------------------------------------

# Caso A: interrupción simulada ANTES del pop_matching normal — el
# dispatcher (única vía real de limpieza ante un SIGINT/EXIT no
# controlado, ver on_interrupt()+trap gapssa_cleanup_dispatch EXIT) debe
# shreddear el fichero.
S7_OLD_API_A="$(bash -c '
  source "$1/lib.sh"
  f="$(gapssa_secrets_mktemp_secure gapssa-s7-old-internal-api)"
  gapssa_cleanup_push shred_plain "$f"
  printf "OLD_INTERNAL_API_SECRET=valor-ficticio-desechable" >"$f"
  printf "%s" "$f"
' _ "$SCRIPT_DIR")"
bash -c '
  source "$1/lib.sh"
  gapssa_cleanup_push shred_plain "$2"
  gapssa_cleanup_dispatch
' _ "$SCRIPT_DIR" "$S7_OLD_API_A"
if [ ! -f "$S7_OLD_API_A" ]; then
  echo "ok   - old_internal_api_file (gapssa-s7-old-internal-api): el dispatcher lo retira si el proceso se interrumpe antes de completar la verificación"
  PASS=$((PASS + 1))
else
  echo "FAIL - old_internal_api_file sobrevivió a gapssa_cleanup_dispatch tras una interrupción simulada"
  FAIL=$((FAIL + 1))
  rm -f "$S7_OLD_API_A"
fi

# Caso B: camino normal — pop_matching retira la entrada de la pila
# ANTES de que el dispatcher (EXIT trap) pueda actuar; el propio
# gapssa_secrets_shred explícito de gate_s7() ya lo borró primero (mismo
# orden que rotate-all-interactive.sh: shred explícito + pop_matching),
# así que una dispatch posterior no debe fallar ni intentar tocarlo de
# nuevo.
S7_OLD_API_B_RESULT="$(bash -c '
  source "$1/lib.sh"
  f="$(gapssa_secrets_mktemp_secure gapssa-s7-old-internal-api)"
  gapssa_cleanup_push shred_plain "$f"
  printf "OLD_INTERNAL_API_SECRET=valor-ficticio-desechable" >"$f"
  gapssa_secrets_shred "$f"
  gapssa_cleanup_pop_matching shred_plain "$f"
  gapssa_cleanup_dispatch
  [ -f "$f" ] && echo "still-exists" || echo "gone"
  printf "count=%s" "${#GAPSSA_CLEANUP_OPS[@]}"
' _ "$SCRIPT_DIR")"
if [ "$S7_OLD_API_B_RESULT" = "$(printf 'gone\ncount=0')" ]; then
  echo "ok   - old_internal_api_file: camino normal (shred explícito + pop_matching) deja la pila vacía, dispatch posterior no falla ni repite nada"
  PASS=$((PASS + 1))
else
  echo "FAIL - camino normal de old_internal_api_file dejó estado inesperado: $S7_OLD_API_B_RESULT"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# BLOQUE 6: primitivo compartido de temporal fijado (mktemp_secure_same_dir
# + verify_pinned_tmp + shred_pinned + pila de limpieza) bajo SIGINT real,
# ejecuciones concurrentes, y rutas con caracteres POSIX problemáticos —
# el mismo primitivo que hoy usan la restauración de backups, la
# actualización atómica de la API Key y el fichero de opciones de
# MariaDB (Bloque 5). El temporal específico de S9 (redis-auth) se
# ELIMINÓ por completo en el Bloque 6 (sustituido por lib/redisVerify.mjs
# vía TCP real) precisamente para no tener que endurecer un fichero más
# — estas pruebas cubren el primitivo que SIGUE existiendo para los
# demás casos.
# ---------------------------------------------------------------------------

# --- SIGINT real durante la vida del temporal fijado ---
SIGINT_PIN_DIR="$TMP_ROOT/sigint-pin-target"
mkdir -p "$SIGINT_PIN_DIR"
SIGINT_PIN_TARGET="$SIGINT_PIN_DIR/.env.gapssa"
: >"$SIGINT_PIN_TARGET"
SIGINT_MARKER="$TMP_ROOT/sigint-pin-marker"
(
  bash -c "
    source '$SCRIPT_DIR/lib.sh'
    pin_lines=\"\$(gapssa_secrets_mktemp_secure_same_dir '$SIGINT_PIN_TARGET' restore)\"
    tmp=\"\$(printf '%s\n' \"\$pin_lines\" | sed -n '1p')\"
    dir=\"\$(printf '%s\n' \"\$pin_lines\" | sed -n '2p')\"
    read -r dev ino uid mode <<<\"\$(printf '%s\n' \"\$pin_lines\" | sed -n '3p')\"
    gapssa_cleanup_push shred_pinned_tmp \"\$tmp\" \"\$dir\" \"\$dev\" \"\$ino\" \"\$uid\" \"\$mode\"
    printf '%s' \"\$tmp\" >'$SIGINT_MARKER'
    sleep 30
  "
) &
SIGINT_TEST_PID=$!
SIGINT_TMP_PATH=""
for _ in $(seq 1 50); do
  [ -s "$SIGINT_MARKER" ] && { SIGINT_TMP_PATH="$(cat "$SIGINT_MARKER")"; break; }
  sleep 0.1
done
if [ -n "$SIGINT_TMP_PATH" ] && [ -f "$SIGINT_TMP_PATH" ]; then
  echo "ok   - SIGINT/temporal fijado: existe justo antes de interrumpir (precondición)"
  PASS=$((PASS + 1))
else
  echo "FAIL - SIGINT/temporal fijado: no se pudo confirmar la precondición"
  FAIL=$((FAIL + 1))
fi
kill -INT "$SIGINT_TEST_PID" 2>/dev/null || true
wait "$SIGINT_TEST_PID" 2>/dev/null || true
if [ -n "$SIGINT_TMP_PATH" ] && [ ! -e "$SIGINT_TMP_PATH" ]; then
  echo "ok   - SIGINT/temporal fijado: el trap EXIT (disparado por la señal) lo borra, nunca queda huérfano"
  PASS=$((PASS + 1))
else
  echo "FAIL - SIGINT/temporal fijado: sigue existiendo tras la interrupción ('$SIGINT_TMP_PATH')"
  FAIL=$((FAIL + 1))
fi
rm -f "$SIGINT_MARKER"

# --- dos ejecuciones concurrentes de mktemp_secure_same_dir contra el
#     MISMO destino: cada una debe obtener un temporal PROPIO y distinto
#     (mktemp usa O_EXCL — nunca hay colisión ni corrupción cruzada),
#     nunca "dos rotaciones simultáneas sobre el mismo fichero temporal". ---
CONCURRENT_DIR="$TMP_ROOT/concurrent-pin-target"
mkdir -p "$CONCURRENT_DIR"
CONCURRENT_TARGET="$CONCURRENT_DIR/.env.gapssa"
: >"$CONCURRENT_TARGET"
CONCURRENT_OUT_A="$TMP_ROOT/concurrent-out-a"
CONCURRENT_OUT_B="$TMP_ROOT/concurrent-out-b"
bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_mktemp_secure_same_dir '$CONCURRENT_TARGET' restore | sed -n '1p'" >"$CONCURRENT_OUT_A" &
CONCURRENT_PID_A=$!
bash -c "source '$SCRIPT_DIR/lib.sh'; gapssa_secrets_mktemp_secure_same_dir '$CONCURRENT_TARGET' restore | sed -n '1p'" >"$CONCURRENT_OUT_B" &
CONCURRENT_PID_B=$!
wait "$CONCURRENT_PID_A" "$CONCURRENT_PID_B"
CONCURRENT_PATH_A="$(cat "$CONCURRENT_OUT_A")"
CONCURRENT_PATH_B="$(cat "$CONCURRENT_OUT_B")"
if [ -n "$CONCURRENT_PATH_A" ] && [ -n "$CONCURRENT_PATH_B" ] && [ "$CONCURRENT_PATH_A" != "$CONCURRENT_PATH_B" ] && [ -f "$CONCURRENT_PATH_A" ] && [ -f "$CONCURRENT_PATH_B" ]; then
  echo "ok   - dos ejecuciones concurrentes de mktemp_secure_same_dir sobre el mismo destino obtienen temporales DISTINTOS, ambos válidos"
  PASS=$((PASS + 1))
else
  echo "FAIL - concurrencia: A='$CONCURRENT_PATH_A' B='$CONCURRENT_PATH_B'"
  FAIL=$((FAIL + 1))
fi
rm -f "$CONCURRENT_PATH_A" "$CONCURRENT_PATH_B" "$CONCURRENT_OUT_A" "$CONCURRENT_OUT_B"

# --- ruta con caracteres POSIX problemáticos (espacios, comilla simple,
#     punto y coma, símbolo dólar) donde corresponda — el propio nombre
#     de directorio/fichero de destino, nunca dentro de un valor secreto
#     (que no aplica aquí, el primitivo nunca ve secretos). ---
WEIRD_DIR="$TMP_ROOT/weird dir with spaces & 'quote' ; semicolon \$dollar"
mkdir -p "$WEIRD_DIR"
WEIRD_TARGET="$WEIRD_DIR/.env.gapssa"
: >"$WEIRD_TARGET"
weird_pin_lines="$(bash -c 'source "$1/lib.sh"; gapssa_secrets_mktemp_secure_same_dir "$2" restore' _ "$SCRIPT_DIR" "$WEIRD_TARGET")"
weird_path="$(printf '%s\n' "$weird_pin_lines" | sed -n '1p')"
weird_dir="$(printf '%s\n' "$weird_pin_lines" | sed -n '2p')"
read -r weird_dev weird_ino weird_uid weird_mode <<<"$(printf '%s\n' "$weird_pin_lines" | sed -n '3p')"
if [ -n "$weird_path" ] && [ -f "$weird_path" ]; then
  echo "ok   - mktemp_secure_same_dir funciona con una ruta de destino con espacios/comillas/';'/'\$'"
  PASS=$((PASS + 1))
else
  echo "FAIL - mktemp_secure_same_dir falló con una ruta de destino con caracteres POSIX problemáticos"
  FAIL=$((FAIL + 1))
fi
assert_exit_code \
  "verify_pinned_tmp acepta ese mismo temporal con ruta problemática" \
  0 \
  bash -c 'source "$1/lib.sh"; gapssa_secrets_verify_pinned_tmp "$2" "$3" "$4" "$5" "$6" "$7"' _ "$SCRIPT_DIR" "$weird_path" "$weird_dir" "$weird_dev" "$weird_ino" "$weird_uid" "$weird_mode"
bash -c 'source "$1/lib.sh"; gapssa_secrets_shred_pinned "$2" "$3" "$4" "$5" "$6" "$7"' _ "$SCRIPT_DIR" "$weird_path" "$weird_dir" "$weird_dev" "$weird_ino" "$weird_uid" "$weird_mode" >/dev/null 2>&1 || true
if [ ! -e "$weird_path" ]; then
  echo "ok   - shred_pinned limpia correctamente un temporal con ruta de destino problemática"
  PASS=$((PASS + 1))
else
  echo "FAIL - shred_pinned no limpió el temporal de ruta problemática"
  FAIL=$((FAIL + 1))
fi

# --- BLOQUE 6: gapssa_health_port_from_start_json / gapssa_pid_alive
#     (mismas funciones que gate_s9 usa para el healthcheck de apps/web
#     con puerto configurable, GAPSSA_APPS_WEB_PORT) ---

check_health_port() {
  local desc="$1" json="$2" expected="$3"
  local got
  got="$(gapssa_health_port_from_start_json "$json")"
  if [ "$got" = "$expected" ]; then
    echo "ok   - $desc"
    PASS=$((PASS + 1))
  else
    echo "FAIL - $desc (esperado '$expected', obtenido '$got')"
    FAIL=$((FAIL + 1))
  fi
}

check_health_port "extrae 'port' cuando está presente" '{"started":true,"pid":123,"port":41234}' "41234"
check_health_port "por defecto 3000 si 'port' está ausente (comportamiento real sin GAPSSA_APPS_WEB_PORT)" '{"started":true,"pid":123}' "3000"
check_health_port "por defecto 3000 con JSON malformado (fail-safe, nunca aborta)" 'esto no es json' "3000"
check_health_port "por defecto 3000 con entrada vacía" "" "3000"

check_pid_alive() {
  local desc="$1" pid="$2" expected="$3"
  local got
  got="$(gapssa_pid_alive "$pid")"
  if [ "$got" = "$expected" ]; then
    echo "ok   - $desc"
    PASS=$((PASS + 1))
  else
    echo "FAIL - $desc (esperado '$expected', obtenido '$got')"
    FAIL=$((FAIL + 1))
  fi
}

check_pid_alive "el propio proceso de la prueba está vivo" "$$" "true"
check_pid_alive "una cadena vacía nunca se considera viva" "" "false"

# PID definitivamente muerto: se lanza y se espera su salida real, nunca
# se adivina un número "seguro" al azar (que podría, en teoría, coincidir
# con un proceso real).
sh -c 'exit 0' &
DEAD_PID=$!
wait "$DEAD_PID" 2>/dev/null || true
check_pid_alive "un PID ya terminado (esperado con wait) se considera muerto" "$DEAD_PID" "false"

# --- BLOQUE 6 (B6-7): bloqueo de concurrencia de rotate-all-interactive.sh
#     (gapssa_secrets_lock_acquire / gapssa_secrets_lock_release) — nunca
#     dos sesiones a la vez contra el mismo almacén externo. ---

LOCK_TEST_DIR="$TMP_ROOT/lock-store-1"

LOCK_ACQUIRE_RC="$(
  source "$SCRIPT_DIR/lib.sh"
  gapssa_secrets_lock_acquire "$LOCK_TEST_DIR" >/dev/null 2>&1
  echo "$?"
)"
if [ "$LOCK_ACQUIRE_RC" = "0" ] && [ -d "$LOCK_TEST_DIR/.rotation.lock" ]; then
  echo "ok   - gapssa_secrets_lock_acquire sobre un almacén libre tiene éxito y crea el directorio de bloqueo"
  PASS=$((PASS + 1))
else
  echo "FAIL - gapssa_secrets_lock_acquire en almacén libre: rc='$LOCK_ACQUIRE_RC'"
  FAIL=$((FAIL + 1))
fi
# El subshell anterior liberó el lock al salir (trap EXIT de
# rotate-all-interactive.sh no aplica aquí -- se comprueba el release
# explícito más abajo). Aquí solo confirmamos que el propio comando
# `source ...; acquire; echo $?` no dejó el lock detrás si el proceso
# terminó sin invocar release (bash sin trap no libera solo) -- por
# diseño, el lock SOLO se libera con `gapssa_secrets_lock_release` o el
# trap EXIT del script real, nunca "solo" (comportamiento correcto: si el
# proceso muere sin limpiar, el lock queda como evidencia recuperable, no
# desaparece por arte de magia). Limpiar aquí para no interferir con las
# siguientes pruebas.
rm -rf "$LOCK_TEST_DIR/.rotation.lock"

# --- segunda adquisición mientras el dueño registrado SIGUE VIVO -> falla ---
LOCK_TEST_DIR2="$TMP_ROOT/lock-store-2"
mkdir -p "$LOCK_TEST_DIR2"
(
  source "$SCRIPT_DIR/lib.sh"
  gapssa_secrets_lock_acquire "$LOCK_TEST_DIR2" >/dev/null 2>&1
  # Mantiene el lock vivo (proceso propio sigue en ejecución) hasta que el
  # padre lo confirme.
  sleep 5
) &
LOCK_HOLDER_PID=$!
# Espera a que el subshell realmente haya creado el directorio de bloqueo
# (evita una condición de carrera de arranque en la propia prueba).
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if [ -d "$LOCK_TEST_DIR2/.rotation.lock" ]; then break; fi
  sleep 0.2
done
LOCK_SECOND_ERR="$TMP_ROOT/lock-second-err"
if bash -c 'source "$1/lib.sh"; gapssa_secrets_lock_acquire "$2"' _ "$SCRIPT_DIR" "$LOCK_TEST_DIR2" >/dev/null 2>"$LOCK_SECOND_ERR"; then
  LOCK_SECOND_RC=0
else
  LOCK_SECOND_RC=$?
fi
if [ "$LOCK_SECOND_RC" != "0" ] && grep -q "otra sesión de rotación" "$LOCK_SECOND_ERR"; then
  echo "ok   - una segunda adquisición mientras el dueño sigue vivo falla con un mensaje claro (nunca un secreto)"
  PASS=$((PASS + 1))
else
  echo "FAIL - segunda adquisición con dueño vivo: rc=$LOCK_SECOND_RC, stderr='$(cat "$LOCK_SECOND_ERR")'"
  FAIL=$((FAIL + 1))
fi
kill "$LOCK_HOLDER_PID" 2>/dev/null || true
wait "$LOCK_HOLDER_PID" 2>/dev/null || true
rm -rf "$LOCK_TEST_DIR2" "$LOCK_SECOND_ERR"

# --- bloqueo huérfano (dueño registrado ya no vivo) -> se recupera solo ---
LOCK_TEST_DIR3="$TMP_ROOT/lock-store-3"
mkdir -p "$LOCK_TEST_DIR3/.rotation.lock"
sh -c 'exit 0' &
LOCK_DEAD_PID=$!
wait "$LOCK_DEAD_PID" 2>/dev/null || true
printf '%s\n' "$LOCK_DEAD_PID" >"$LOCK_TEST_DIR3/.rotation.lock/owner"
# Retrasa el mtime del directorio de bloqueo 10 minutos -- un huérfano
# real siempre es viejo; un lock recién creado nunca debe recuperarse
# solo por parecer "vacío/ausente" (ver grace_seconds en
# gapssa_secrets_lock_acquire, lib.sh: cierra una condición de carrera
# real detectada por este mismo ensayo).
LOCK_BACKDATE_STAMP="$(date -v-10M +%Y%m%d%H%M.%S 2>/dev/null || date -d '10 minutes ago' +%Y%m%d%H%M.%S)"
touch -t "$LOCK_BACKDATE_STAMP" "$LOCK_TEST_DIR3/.rotation.lock"
LOCK_ORPHAN_ERR="$TMP_ROOT/lock-orphan-err"
if bash -c 'source "$1/lib.sh"; gapssa_secrets_lock_acquire "$2"' _ "$SCRIPT_DIR" "$LOCK_TEST_DIR3" >/dev/null 2>"$LOCK_ORPHAN_ERR"; then
  LOCK_ORPHAN_RC=0
else
  LOCK_ORPHAN_RC=$?
fi
if [ "$LOCK_ORPHAN_RC" = "0" ] && [ -d "$LOCK_TEST_DIR3/.rotation.lock" ] && grep -q "huérfano" "$LOCK_ORPHAN_ERR"; then
  echo "ok   - un bloqueo huérfano (dueño ya no vivo) se recupera automáticamente, con aviso explícito"
  PASS=$((PASS + 1))
else
  echo "FAIL - recuperación de bloqueo huérfano: rc=$LOCK_ORPHAN_RC, stderr='$(cat "$LOCK_ORPHAN_ERR")'"
  FAIL=$((FAIL + 1))
fi
rm -rf "$LOCK_TEST_DIR3" "$LOCK_ORPHAN_ERR"

# --- gapssa_secrets_lock_release NUNCA borra un lock que no es suyo ---
LOCK_TEST_DIR4="$TMP_ROOT/lock-store-4"
mkdir -p "$LOCK_TEST_DIR4/.rotation.lock"
printf '999999\n' >"$LOCK_TEST_DIR4/.rotation.lock/owner"
(
  source "$SCRIPT_DIR/lib.sh"
  GAPSSA_SECRETS_LOCK_DIR="$LOCK_TEST_DIR4/.rotation.lock"
  GAPSSA_SECRETS_LOCK_OWNER_PID="12345"
  gapssa_secrets_lock_release
)
if [ -d "$LOCK_TEST_DIR4/.rotation.lock" ]; then
  echo "ok   - gapssa_secrets_lock_release nunca borra un bloqueo cuyo dueño registrado no coincide con el propio PID"
  PASS=$((PASS + 1))
else
  echo "FAIL - gapssa_secrets_lock_release borró un bloqueo ajeno"
  FAIL=$((FAIL + 1))
fi
rm -rf "$LOCK_TEST_DIR4"

# --- gapssa_secrets_lock_release SÍ borra el lock que sí es suyo ---
LOCK_TEST_DIR5="$TMP_ROOT/lock-store-5"
LOCK_RELEASE_OK="$(
  source "$SCRIPT_DIR/lib.sh"
  gapssa_secrets_lock_acquire "$LOCK_TEST_DIR5" >/dev/null 2>&1
  gapssa_secrets_lock_release
  [ -d "$LOCK_TEST_DIR5/.rotation.lock" ] && echo present || echo absent
)"
if [ "$LOCK_RELEASE_OK" = "absent" ]; then
  echo "ok   - gapssa_secrets_lock_release borra el bloqueo que sí es suyo"
  PASS=$((PASS + 1))
else
  echo "FAIL - gapssa_secrets_lock_release no borró su propio bloqueo"
  FAIL=$((FAIL + 1))
fi
rm -rf "$LOCK_TEST_DIR5"

# --- dos adquisiciones REALMENTE concurrentes (dos procesos lanzados a la
#     vez, nunca en secuencia) contra el MISMO almacén -> EXACTAMENTE una
#     tiene éxito, la otra falla limpio (nunca las dos "ganan", nunca las
#     dos fallan). Repetido varias veces: esta prueba reprodujo un bug
#     real (condición de carrera entre el `mkdir` del lock y la escritura
#     de su `owner`, ver comentario de `grace_seconds` en
#     gapssa_secrets_lock_acquire) — una sola pasada en verde no basta
#     para confiar en que la corrección cierra la ventana de verdad. ---
LOCK_RACE_ITERATION=1
while [ "$LOCK_RACE_ITERATION" -le 5 ]; do
  LOCK_TEST_DIR6="$TMP_ROOT/lock-store-6-$LOCK_RACE_ITERATION"
  mkdir -p "$LOCK_TEST_DIR6"
  LOCK_RACE_OUT_A="$TMP_ROOT/lock-race-a-$LOCK_RACE_ITERATION"
  LOCK_RACE_OUT_B="$TMP_ROOT/lock-race-b-$LOCK_RACE_ITERATION"
  # Nunca un `echo "$?"` DENTRO del propio `bash -c` -- `SHELLOPTS`
  # (con `errexit`) se hereda automáticamente en un `bash -c` hijo, así
  # que si `gapssa_secrets_lock_acquire` falla, ese `bash -c` muere ANTES
  # de llegar al `echo` siguiente (nunca imprime nada, no "1"). Envolver
  # el `bash -c` en un `if`/`else` EXTERNO sí captura el resultado real
  # con garantías, sea por `return 1` explícito o por una muerte por
  # errexit -- ambas dan el mismo exit status observable desde fuera.
  ( if bash -c 'source "$1/lib.sh"; gapssa_secrets_lock_acquire "$2"' _ "$SCRIPT_DIR" "$LOCK_TEST_DIR6" >/dev/null 2>&1; then echo 0; else echo 1; fi ) >"$LOCK_RACE_OUT_A" &
  LOCK_RACE_PID_A=$!
  ( if bash -c 'source "$1/lib.sh"; gapssa_secrets_lock_acquire "$2"' _ "$SCRIPT_DIR" "$LOCK_TEST_DIR6" >/dev/null 2>&1; then echo 0; else echo 1; fi ) >"$LOCK_RACE_OUT_B" &
  LOCK_RACE_PID_B=$!
  wait "$LOCK_RACE_PID_A" "$LOCK_RACE_PID_B" || true
  LOCK_RACE_RC_A="$(cat "$LOCK_RACE_OUT_A")"
  LOCK_RACE_RC_B="$(cat "$LOCK_RACE_OUT_B")"
  LOCK_RACE_SUCCESSES=0
  if [ "$LOCK_RACE_RC_A" = "0" ]; then LOCK_RACE_SUCCESSES=$((LOCK_RACE_SUCCESSES + 1)); fi
  if [ "$LOCK_RACE_RC_B" = "0" ]; then LOCK_RACE_SUCCESSES=$((LOCK_RACE_SUCCESSES + 1)); fi
  if [ "$LOCK_RACE_SUCCESSES" -eq 1 ]; then
    echo "ok   - carrera de adquisición #$LOCK_RACE_ITERATION: EXACTAMENTE una gana (rc A=$LOCK_RACE_RC_A, B=$LOCK_RACE_RC_B)"
    PASS=$((PASS + 1))
  else
    echo "FAIL - carrera de adquisición #$LOCK_RACE_ITERATION: rc A='$LOCK_RACE_RC_A' B='$LOCK_RACE_RC_B' (se esperaba exactamente un 0)"
    FAIL=$((FAIL + 1))
  fi
  rm -rf "$LOCK_TEST_DIR6" "$LOCK_RACE_OUT_A" "$LOCK_RACE_OUT_B"
  LOCK_RACE_ITERATION=$((LOCK_RACE_ITERATION + 1))
done

# =============================================================================
# Bloque 6 (corrección de colisiones) — reserva atómica de rutas
# exclusivas (gapssa_secrets_reserve_exclusive_path /
# gapssa_secrets_reserve_with_retry, usadas por el nombre de cada backup
# cifrado Y por el informe final) y selección del informe final por
# run_id (gapssa_secrets_find_report_for_run_id) — nunca por fecha de
# modificación más reciente.
# =============================================================================

RESERVE_DIR="$TMP_ROOT/reserve-dir-1"
mkdir -p "$RESERVE_DIR"
# Canonicaliza (pwd -P) para que las comparaciones de ruta de más abajo
# coincidan con lo que gapssa_secrets_reserve_exclusive_path devuelve
# (también canonicalizado) -- en macOS $TMPDIR resuelve bajo /var, que es
# un symlink a /private/var; sin esto, una comparación de cadena entre
# "$RESERVE_DIR/x" (no canónico) y la ruta devuelta (canónica) fallaría
# por una diferencia puramente cosmética de prefijo, nunca por un fallo
# real de la reserva.
RESERVE_DIR="$(cd "$RESERVE_DIR" && pwd -P)"

# --- primera reserva exitosa ---
set +e
RESERVE_OUT="$(gapssa_secrets_reserve_exclusive_path "$RESERVE_DIR/foo.txt")"
RESERVE_RC=$?
set -e
if [ "$RESERVE_RC" = 0 ] && [ -f "$RESERVE_DIR/foo.txt" ]; then
  echo "ok   - primera reserva exitosa: rc=0, fichero creado"
  PASS=$((PASS + 1))
else
  echo "FAIL - primera reserva exitosa: rc=$RESERVE_RC"
  FAIL=$((FAIL + 1))
fi
RESERVE_MODE="$(stat -f '%Lp' "$RESERVE_DIR/foo.txt" 2>/dev/null || stat -c '%a' "$RESERVE_DIR/foo.txt" 2>/dev/null)"
if [ "$RESERVE_MODE" = "600" ]; then
  echo "ok   - primera reserva exitosa: modo 600 desde la creación (nunca create+chmod en dos pasos)"
  PASS=$((PASS + 1))
else
  echo "FAIL - primera reserva exitosa: modo '$RESERVE_MODE', se esperaba 600"
  FAIL=$((FAIL + 1))
fi
RESERVE_STAT_LINE="$(printf '%s\n' "$RESERVE_OUT" | tail -n1)"
RESERVE_REAL_STAT="$(stat -f '%d %i %u %Lp' "$RESERVE_DIR/foo.txt" 2>/dev/null || stat -c '%d %i %u %a' "$RESERVE_DIR/foo.txt" 2>/dev/null)"
if [ "$RESERVE_STAT_LINE" = "$RESERVE_REAL_STAT" ]; then
  echo "ok   - primera reserva exitosa: identidad (dev/ino/uid/modo) impresa coincide con la real (identidad fijada)"
  PASS=$((PASS + 1))
else
  echo "FAIL - primera reserva exitosa: identidad impresa ('$RESERVE_STAT_LINE') != real ('$RESERVE_REAL_STAT')"
  FAIL=$((FAIL + 1))
fi

# --- nombre ya existente (fichero regular) -- nunca se toca, nunca se
#     sobrescribe, contenido preexistente byte a byte intacto ---
printf 'contenido-preexistente' >"$RESERVE_DIR/existing-file.txt"
EXISTING_BEFORE="$(cat "$RESERVE_DIR/existing-file.txt")"
set +e
gapssa_secrets_reserve_exclusive_path "$RESERVE_DIR/existing-file.txt" >/dev/null 2>/dev/null
RC_EXISTING_FILE=$?
set -e
EXISTING_AFTER="$(cat "$RESERVE_DIR/existing-file.txt")"
if [ "$RC_EXISTING_FILE" = 1 ] && [ "$EXISTING_BEFORE" = "$EXISTING_AFTER" ]; then
  echo "ok   - fichero regular ya existente: rc=1 (colisión), contenido preexistente byte a byte intacto"
  PASS=$((PASS + 1))
else
  echo "FAIL - fichero regular ya existente: rc=$RC_EXISTING_FILE, contenido antes='$EXISTING_BEFORE' después='$EXISTING_AFTER'"
  FAIL=$((FAIL + 1))
fi

# --- symlink existente (colgante) -- nunca se sigue, nunca se borra ---
ln -s "$RESERVE_DIR/no-existe-nunca" "$RESERVE_DIR/dangling-link.txt"
set +e
gapssa_secrets_reserve_exclusive_path "$RESERVE_DIR/dangling-link.txt" >/dev/null 2>/dev/null
RC_DANGLING=$?
set -e
if [ "$RC_DANGLING" = 1 ] && [ -L "$RESERVE_DIR/dangling-link.txt" ]; then
  echo "ok   - symlink colgante ya existente: rc=1, symlink sigue intacto (nunca seguido, nunca borrado)"
  PASS=$((PASS + 1))
else
  echo "FAIL - symlink colgante: rc=$RC_DANGLING"
  FAIL=$((FAIL + 1))
fi

# --- symlink existente apuntando a un fichero REAL fuera del directorio
#     -- ese fichero real NUNCA se toca (protección contra symlinks) ---
OUTSIDE_TARGET="$TMP_ROOT/outside-target.txt"
printf 'contenido-del-objetivo-real' >"$OUTSIDE_TARGET"
ln -s "$OUTSIDE_TARGET" "$RESERVE_DIR/link-to-real.txt"
set +e
gapssa_secrets_reserve_exclusive_path "$RESERVE_DIR/link-to-real.txt" >/dev/null 2>/dev/null
RC_LINK_REAL=$?
set -e
OUTSIDE_TARGET_AFTER="$(cat "$OUTSIDE_TARGET")"
if [ "$RC_LINK_REAL" = 1 ] && [ "$OUTSIDE_TARGET_AFTER" = "contenido-del-objetivo-real" ] && [ -L "$RESERVE_DIR/link-to-real.txt" ]; then
  echo "ok   - symlink a fichero real: rc=1, el fichero apuntado NUNCA se toca (ni se lee ni se escribe), symlink intacto"
  PASS=$((PASS + 1))
else
  echo "FAIL - symlink a fichero real: rc=$RC_LINK_REAL, contenido objetivo='$OUTSIDE_TARGET_AFTER'"
  FAIL=$((FAIL + 1))
fi

# --- directorio existente en esa ruta exacta -- nunca se toca, nunca se
#     crea nada dentro ---
mkdir -p "$RESERVE_DIR/existing-dir.txt"
touch "$RESERVE_DIR/existing-dir.txt/marker"
set +e
gapssa_secrets_reserve_exclusive_path "$RESERVE_DIR/existing-dir.txt" >/dev/null 2>/dev/null
RC_EXISTING_DIR=$?
set -e
if [ "$RC_EXISTING_DIR" != 0 ] && [ -d "$RESERVE_DIR/existing-dir.txt" ] && [ -f "$RESERVE_DIR/existing-dir.txt/marker" ]; then
  echo "ok   - directorio ya existente en esa ruta: rc!=0 (colisión), directorio y su contenido intactos"
  PASS=$((PASS + 1))
else
  echo "FAIL - directorio ya existente: rc=$RC_EXISTING_DIR"
  FAIL=$((FAIL + 1))
fi

# --- colisión repetida hasta agotar reintentos: candidato_fn SIEMPRE
#     devuelve el mismo nombre ya ocupado -> fallo cerrado (rc=3), nunca
#     adopta ni borra el preexistente, ningún artefacto nuevo ---
printf 'no-tocar' >"$RESERVE_DIR/always-taken.txt"
_test_candidate_always_taken() { printf 'always-taken.txt'; }
set +e
gapssa_secrets_reserve_with_retry "$RESERVE_DIR" _test_candidate_always_taken 3 >/dev/null 2>/dev/null
RC_RETRY_EXHAUST=$?
set -e
unset -f _test_candidate_always_taken
if [ "$RC_RETRY_EXHAUST" = 3 ] && [ "$(cat "$RESERVE_DIR/always-taken.txt")" = "no-tocar" ]; then
  echo "ok   - colisión repetida hasta agotar reintentos: rc=3 (fallo cerrado), preexistente intacto, ningún artefacto nuevo"
  PASS=$((PASS + 1))
else
  echo "FAIL - colisión repetida: rc=$RC_RETRY_EXHAUST, contenido='$(cat "$RESERVE_DIR/always-taken.txt" 2>/dev/null || echo AUSENTE)'"
  FAIL=$((FAIL + 1))
fi

# --- reintento acotado: los dos primeros candidatos colisionan, el
#     tercero está libre -- éxito en el 3er intento, nunca adopta los
#     dos primeros (nuevo identificador CSPRNG por intento, vía el
#     candidato inyectado por la prueba) ---
printf 'ocupado-1' >"$RESERVE_DIR/retry-1.txt"
printf 'ocupado-2' >"$RESERVE_DIR/retry-2.txt"
RETRY_SUCCESS_COUNTER_FILE="$TMP_ROOT/retry-success-counter"
printf '0' >"$RETRY_SUCCESS_COUNTER_FILE"
_test_candidate_retry_then_free() {
  local n; n="$(cat "$RETRY_SUCCESS_COUNTER_FILE")"
  n=$((n + 1))
  printf '%s' "$n" >"$RETRY_SUCCESS_COUNTER_FILE"
  case "$n" in
  1) printf 'retry-1.txt' ;;
  2) printf 'retry-2.txt' ;;
  *) printf 'retry-3.txt' ;;
  esac
}
set +e
RETRY_SUCCESS_OUT="$(gapssa_secrets_reserve_with_retry "$RESERVE_DIR" _test_candidate_retry_then_free 5)"
RC_RETRY_SUCCESS=$?
set -e
unset -f _test_candidate_retry_then_free
RETRY_SUCCESS_PATH="$(printf '%s\n' "$RETRY_SUCCESS_OUT" | head -n1)"
if [ "$RC_RETRY_SUCCESS" = 0 ] && [ "$RETRY_SUCCESS_PATH" = "$RESERVE_DIR/retry-3.txt" ] && [ "$(cat "$RESERVE_DIR/retry-1.txt")" = "ocupado-1" ] && [ "$(cat "$RESERVE_DIR/retry-2.txt")" = "ocupado-2" ]; then
  echo "ok   - reintento acotado: dos colisiones + un candidato libre -> éxito en el 3er intento, los dos primeros quedan intactos"
  PASS=$((PASS + 1))
else
  echo "FAIL - reintento acotado: rc=$RC_RETRY_SUCCESS, ruta='$RETRY_SUCCESS_PATH'"
  FAIL=$((FAIL + 1))
fi

# --- limpieza/reserva no toca artefactos ajenos del mismo directorio ---
mkdir -p "$RESERVE_DIR/ajenos"
printf 'ajeno-1' >"$RESERVE_DIR/ajenos/otro-fichero-1.txt"
printf 'ajeno-2' >"$RESERVE_DIR/ajenos/otro-fichero-2.txt"
gapssa_secrets_reserve_exclusive_path "$RESERVE_DIR/ajenos/nuevo.txt" >/dev/null
if [ "$(cat "$RESERVE_DIR/ajenos/otro-fichero-1.txt")" = "ajeno-1" ] && [ "$(cat "$RESERVE_DIR/ajenos/otro-fichero-2.txt")" = "ajeno-2" ]; then
  echo "ok   - reserva no toca artefactos ajenos del mismo directorio"
  PASS=$((PASS + 1))
else
  echo "FAIL - la reserva tocó ficheros ajenos del directorio"
  FAIL=$((FAIL + 1))
fi

# --- interrupción después de reservar y antes de escribir: el fichero
#     reservado queda VACÍO (0 bytes), nunca a medio escribir/corrupto ---
gapssa_secrets_reserve_exclusive_path "$RESERVE_DIR/interrupted.txt" >/dev/null
INTERRUPT_SIZE="$(wc -c <"$RESERVE_DIR/interrupted.txt" | tr -d ' ')"
if [ "$INTERRUPT_SIZE" = "0" ]; then
  echo "ok   - interrupción entre reserva y escritura: el fichero reservado queda vacío (0 bytes), nunca corrupto/parcial"
  PASS=$((PASS + 1))
else
  echo "FAIL - fichero reservado no vacío tras 'interrupción' simulada: $INTERRUPT_SIZE bytes"
  FAIL=$((FAIL + 1))
fi

# --- mismo escenario aplicado al patrón temporal-mismo-directorio+rename
#     que usa gate_s9 para el informe final: temporal creado, escrito,
#     pero NUNCA renombrado ("interrupción" antes del rename atómico) --
#     el destino final reservado sigue vacío, y find_report_for_run_id
#     encuentra ese placeholder (identidad de nombre), nunca el temporal
#     huérfano (que no coincide con el patrón cerrado) ---
REPORT_INTERRUPT_DIR="$TMP_ROOT/report-interrupt-dir"
mkdir -p "$REPORT_INTERRUPT_DIR"
INTERRUPT_RUN_ID="deadbeefdeadbeef"
INTERRUPT_REPORT_NAME="rotation-report-20260101T000000Z-${INTERRUPT_RUN_ID}.txt"
gapssa_secrets_reserve_exclusive_path "$REPORT_INTERRUPT_DIR/$INTERRUPT_REPORT_NAME" >/dev/null
INTERRUPT_REPORT_FINAL="$REPORT_INTERRUPT_DIR/$INTERRUPT_REPORT_NAME"
INTERRUPT_TMP_LINES="$(gapssa_secrets_mktemp_secure_same_dir "$INTERRUPT_REPORT_FINAL" report)"
INTERRUPT_TMP_PATH="$(printf '%s\n' "$INTERRUPT_TMP_LINES" | head -n1)"
printf 'contenido-parcial-nunca-publicado' >"$INTERRUPT_TMP_PATH"
INTERRUPT_FINAL_SIZE="$(wc -c <"$INTERRUPT_REPORT_FINAL" | tr -d ' ')"
set +e
gapssa_secrets_find_report_for_run_id "$REPORT_INTERRUPT_DIR" "$INTERRUPT_RUN_ID" >/dev/null 2>/dev/null
RC_INTERRUPT_FIND=$?
set -e
if [ "$INTERRUPT_FINAL_SIZE" = "0" ] && [ "$RC_INTERRUPT_FIND" = 0 ]; then
  echo "ok   - temporal interrumpido (informe): destino final vacío tras interrupción; find_report_for_run_id encuentra el placeholder reservado, nunca el temporal huérfano"
  PASS=$((PASS + 1))
else
  echo "FAIL - temporal interrumpido (informe): tamaño final=$INTERRUPT_FINAL_SIZE, rc find=$RC_INTERRUPT_FIND"
  FAIL=$((FAIL + 1))
fi
rm -f "$INTERRUPT_TMP_PATH"

# --- dos procesos REALMENTE concurrentes reservando el MISMO candidato
#     exacto -> EXACTAMENTE uno gana (mismo patrón que la carrera de
#     locks de arriba, 5 iteraciones -- cubre a la vez "dos procesos
#     concurrentes" del backup y del informe, ambos construidos sobre
#     esta misma primitiva) ---
RESERVE_RACE_ITERATION=1
while [ "$RESERVE_RACE_ITERATION" -le 5 ]; do
  RESERVE_RACE_DIR="$TMP_ROOT/reserve-race-$RESERVE_RACE_ITERATION"
  mkdir -p "$RESERVE_RACE_DIR"
  RESERVE_RACE_TARGET="$RESERVE_RACE_DIR/candidate.txt"
  RESERVE_RACE_OUT_A="$TMP_ROOT/reserve-race-out-a-$RESERVE_RACE_ITERATION"
  RESERVE_RACE_OUT_B="$TMP_ROOT/reserve-race-out-b-$RESERVE_RACE_ITERATION"
  ( if bash -c 'source "$1/lib.sh"; gapssa_secrets_reserve_exclusive_path "$2" >/dev/null 2>&1 && printf "ganador-A" >"$2"' _ "$SCRIPT_DIR" "$RESERVE_RACE_TARGET"; then echo 0; else echo 1; fi ) >"$RESERVE_RACE_OUT_A" &
  RESERVE_RACE_PID_A=$!
  ( if bash -c 'source "$1/lib.sh"; gapssa_secrets_reserve_exclusive_path "$2" >/dev/null 2>&1 && printf "ganador-B" >"$2"' _ "$SCRIPT_DIR" "$RESERVE_RACE_TARGET"; then echo 0; else echo 1; fi ) >"$RESERVE_RACE_OUT_B" &
  RESERVE_RACE_PID_B=$!
  wait "$RESERVE_RACE_PID_A" "$RESERVE_RACE_PID_B" || true
  RESERVE_RACE_RC_A="$(cat "$RESERVE_RACE_OUT_A")"
  RESERVE_RACE_RC_B="$(cat "$RESERVE_RACE_OUT_B")"
  RESERVE_RACE_SUCCESSES=0
  [ "$RESERVE_RACE_RC_A" = "0" ] && RESERVE_RACE_SUCCESSES=$((RESERVE_RACE_SUCCESSES + 1))
  [ "$RESERVE_RACE_RC_B" = "0" ] && RESERVE_RACE_SUCCESSES=$((RESERVE_RACE_SUCCESSES + 1))
  RESERVE_RACE_CONTENT="$(cat "$RESERVE_RACE_TARGET" 2>/dev/null || echo "")"
  if [ "$RESERVE_RACE_SUCCESSES" -eq 1 ] && { [ "$RESERVE_RACE_CONTENT" = "ganador-A" ] || [ "$RESERVE_RACE_CONTENT" = "ganador-B" ]; }; then
    echo "ok   - carrera de reserva #$RESERVE_RACE_ITERATION: EXACTAMENTE una gana (rc A=$RESERVE_RACE_RC_A, B=$RESERVE_RACE_RC_B), contenido final = '$RESERVE_RACE_CONTENT'"
    PASS=$((PASS + 1))
  else
    echo "FAIL - carrera de reserva #$RESERVE_RACE_ITERATION: rc A='$RESERVE_RACE_RC_A' B='$RESERVE_RACE_RC_B' contenido='$RESERVE_RACE_CONTENT'"
    FAIL=$((FAIL + 1))
  fi
  rm -rf "$RESERVE_RACE_DIR" "$RESERVE_RACE_OUT_A" "$RESERVE_RACE_OUT_B"
  RESERVE_RACE_ITERATION=$((RESERVE_RACE_ITERATION + 1))
done

# --- gapssa_secrets_find_report_for_run_id ---
FIND_REPORT_DIR="$TMP_ROOT/find-report-dir"
mkdir -p "$FIND_REPORT_DIR"

RUN_ID_A="aaaaaaaaaaaaaaaa"
printf 'informe A' >"$FIND_REPORT_DIR/rotation-report-20260101T000000Z-$RUN_ID_A.txt"
set +e
FOUND_A="$(gapssa_secrets_find_report_for_run_id "$FIND_REPORT_DIR" "$RUN_ID_A")"
RC_FOUND_A=$?
set -e
if [ "$RC_FOUND_A" = 0 ] && [ "$FOUND_A" = "$FIND_REPORT_DIR/rotation-report-20260101T000000Z-$RUN_ID_A.txt" ]; then
  echo "ok   - find_report_for_run_id: informe normal, exactamente uno, ruta correcta"
  PASS=$((PASS + 1))
else
  echo "FAIL - find_report_for_run_id (informe normal): rc=$RC_FOUND_A ruta='$FOUND_A'"
  FAIL=$((FAIL + 1))
fi

set +e
gapssa_secrets_find_report_for_run_id "$FIND_REPORT_DIR" "run-id-sin-informe-alguno" >/dev/null 2>/dev/null
RC_ZERO=$?
set -e
if [ "$RC_ZERO" = 1 ]; then
  echo "ok   - find_report_for_run_id: cero informes actuales para el run_id -> rc=1"
  PASS=$((PASS + 1))
else
  echo "FAIL - find_report_for_run_id (cero informes): rc=$RC_ZERO"
  FAIL=$((FAIL + 1))
fi

# informe antiguo preexistente (formato previo a este bloque, sin
# run_id) -- coexiste, NUNCA se adopta como el informe actual
printf 'informe formato antiguo' >"$FIND_REPORT_DIR/rotation-report-20250101-000000.txt"
set +e
FOUND_A_WITH_OLD="$(gapssa_secrets_find_report_for_run_id "$FIND_REPORT_DIR" "$RUN_ID_A")"
RC_FOUND_A_WITH_OLD=$?
set -e
if [ "$RC_FOUND_A_WITH_OLD" = 0 ] && [ "$FOUND_A_WITH_OLD" = "$FIND_REPORT_DIR/rotation-report-20260101T000000Z-$RUN_ID_A.txt" ]; then
  echo "ok   - find_report_for_run_id: un informe de formato ANTIGUO (sin run_id) coexistiendo nunca se adopta como el actual"
  PASS=$((PASS + 1))
else
  echo "FAIL - find_report_for_run_id (informe antiguo coexistente): rc=$RC_FOUND_A_WITH_OLD ruta='$FOUND_A_WITH_OLD'"
  FAIL=$((FAIL + 1))
fi

# selección del informe actual sin adoptar uno histórico -- el
# "histórico" de OTRO run_id tiene mtime MÁS RECIENTE (nunca gana por
# fecha, solo por run_id exacto)
RUN_ID_B="bbbbbbbbbbbbbbbb"
printf 'informe B (otro run_id, mas reciente)' >"$FIND_REPORT_DIR/rotation-report-20260102T000000Z-$RUN_ID_B.txt"
touch -t 203001010000 "$FIND_REPORT_DIR/rotation-report-20260102T000000Z-$RUN_ID_B.txt" 2>/dev/null || true
set +e
FOUND_A_AGAIN="$(gapssa_secrets_find_report_for_run_id "$FIND_REPORT_DIR" "$RUN_ID_A")"
FOUND_B="$(gapssa_secrets_find_report_for_run_id "$FIND_REPORT_DIR" "$RUN_ID_B")"
set -e
if [ "$FOUND_A_AGAIN" = "$FIND_REPORT_DIR/rotation-report-20260101T000000Z-$RUN_ID_A.txt" ] && [ "$FOUND_B" = "$FIND_REPORT_DIR/rotation-report-20260102T000000Z-$RUN_ID_B.txt" ]; then
  echo "ok   - find_report_for_run_id: selección exclusivamente por run_id (nunca por mtime más reciente), cada sesión encuentra solo el suyo"
  PASS=$((PASS + 1))
else
  echo "FAIL - find_report_for_run_id (selección sin adoptar histórico): A='$FOUND_A_AGAIN' B='$FOUND_B'"
  FAIL=$((FAIL + 1))
fi

# dos sesiones en el MISMO segundo (mismo timestamp, run_id distinto) --
# cada una identificable solo por su propio run_id, sin colisión
SAME_TS="20260103T120000Z"
printf 'sesion 1' >"$FIND_REPORT_DIR/rotation-report-$SAME_TS-1111111111111111.txt"
printf 'sesion 2' >"$FIND_REPORT_DIR/rotation-report-$SAME_TS-2222222222222222.txt"
set +e
FOUND_SAME_TS_1="$(gapssa_secrets_find_report_for_run_id "$FIND_REPORT_DIR" "1111111111111111")"
FOUND_SAME_TS_2="$(gapssa_secrets_find_report_for_run_id "$FIND_REPORT_DIR" "2222222222222222")"
set -e
if [ "$(cat "$FOUND_SAME_TS_1" 2>/dev/null)" = "sesion 1" ] && [ "$(cat "$FOUND_SAME_TS_2" 2>/dev/null)" = "sesion 2" ]; then
  echo "ok   - find_report_for_run_id: dos sesiones en el mismo segundo (mismo timestamp) se distinguen sin ambigüedad por run_id"
  PASS=$((PASS + 1))
else
  echo "FAIL - find_report_for_run_id (mismo segundo, run_id distinto)"
  FAIL=$((FAIL + 1))
fi

# dos informes con el MISMO run_id (colisión/ambigüedad real) -> rc=2,
# fallo cerrado, nunca "el primero"/"el más reciente"
RUN_ID_DUP="cccccccccccccccc"
printf 'duplicado 1' >"$FIND_REPORT_DIR/rotation-report-20260104T000000Z-$RUN_ID_DUP.txt"
printf 'duplicado 2' >"$FIND_REPORT_DIR/rotation-report-20260104T000001Z-$RUN_ID_DUP.txt"
set +e
gapssa_secrets_find_report_for_run_id "$FIND_REPORT_DIR" "$RUN_ID_DUP" >/dev/null 2>/dev/null
RC_DUP=$?
set -e
if [ "$RC_DUP" = 2 ]; then
  echo "ok   - find_report_for_run_id: dos informes con el mismo run_id -> rc=2 (ambigüedad, fallo cerrado, nunca adopta ninguno)"
  PASS=$((PASS + 1))
else
  echo "FAIL - find_report_for_run_id (dos informes mismo run_id): rc=$RC_DUP"
  FAIL=$((FAIL + 1))
fi

# informe corrupto (contenido roto, nombre válido) -- localizar por
# identidad de NOMBRE es un contrato DISTINTO de validar contenido: se
# encuentra igual (esta función identifica, nunca valida contenido) --
# documentado aquí explícitamente para que la frontera quede clara.
RUN_ID_CORRUPT="dddddddddddddddd"
printf '\x00\x01BASURA-BINARIA-NO-ES-UN-INFORME-VALIDO' >"$FIND_REPORT_DIR/rotation-report-20260105T000000Z-$RUN_ID_CORRUPT.txt"
set +e
FOUND_CORRUPT="$(gapssa_secrets_find_report_for_run_id "$FIND_REPORT_DIR" "$RUN_ID_CORRUPT")"
RC_FOUND_CORRUPT=$?
set -e
if [ "$RC_FOUND_CORRUPT" = 0 ] && [ "$FOUND_CORRUPT" = "$FIND_REPORT_DIR/rotation-report-20260105T000000Z-$RUN_ID_CORRUPT.txt" ]; then
  echo "ok   - find_report_for_run_id: localiza por identidad de nombre incluso con contenido corrupto (identidad != validación de contenido)"
  PASS=$((PASS + 1))
else
  echo "FAIL - find_report_for_run_id (informe corrupto): rc=$RC_FOUND_CORRUPT ruta='$FOUND_CORRUPT'"
  FAIL=$((FAIL + 1))
fi

# ---------------------------------------------------------------------------
# BLOQUE 12 (incidente real 2026-08-21 — limpieza de temporales atómicos
# no consumidos): _s7_apply_mutations()/_s7_migrate_legacy_schema()
# (rotate-all-interactive.sh) dejaban un temporal FIJADO sin retirar en
# disco cada vez que atomicSecretsFileMutate.mjs/
# migrateLegacySecretsFileToActive.mjs terminaban en no-op (rc=20) o en
# cualquier error sin consumirlo: _s7_unpin_secrets_tmp() solo hacía
# gapssa_cleanup_pop_matching (retirar el REGISTRO de la pila de
# limpieza), nunca gapssa_secrets_shred_pinned (retirar el FICHERO) — así
# que el propio AVISO del script Node ("bórralo") quedaba sin nadie que
# lo ejecutara, y dos temporales de 0 bytes sobrevivían indefinidamente
# en el almacén externo real. Estas pruebas invocan las funciones REALES
# extraídas de rotate-all-interactive.sh (nunca una reimplementación
# aparte — así una regresión futura en el propio fichero de producción se
# detecta aquí) contra el CLI real de atomicSecretsFileMutate.mjs, con
# fixtures desechables fuera del repositorio.
# ---------------------------------------------------------------------------

S7FN_SNIPPET="$TMP_ROOT/s7-fns.sh"
{
  awk '/^_s7_pin_secrets_tmp\(\) \{/,/^\}/' "$SCRIPT_DIR/rotate-all-interactive.sh"
  awk '/^_s7_unpin_secrets_tmp\(\) \{/,/^\}/' "$SCRIPT_DIR/rotate-all-interactive.sh"
  awk '/^_s7_apply_mutations\(\) \{/,/^\}/' "$SCRIPT_DIR/rotate-all-interactive.sh"
  awk '/^_s7_migrate_legacy_schema\(\) \{/,/^\}/' "$SCRIPT_DIR/rotate-all-interactive.sh"
} >"$S7FN_SNIPPET"

# Sanity: las 4 funciones se extrajeron de verdad — si el patrón awk
# alguna vez deja de casar (p. ej. tras un refactor real del fichero),
# esta prueba debe fallar RUIDOSAMENTE en vez de "pasar" contra un
# snippet vacío que no ejercería nada.
S7FN_COUNT="$(grep -c '^_s7_.*() {' "$S7FN_SNIPPET" || true)"
if [ "$S7FN_COUNT" = 4 ]; then
  echo "ok   - BLOQUE 12: las 4 funciones _s7_* se extrajeron de rotate-all-interactive.sh (snippet no vacío)"
  PASS=$((PASS + 1))
else
  echo "FAIL - BLOQUE 12: extracción de funciones _s7_* rota (se esperaban 4, se encontraron $S7FN_COUNT) — revisa el patrón awk si rotate-all-interactive.sh cambió de forma"
  FAIL=$((FAIL + 1))
fi

# Generador de fixture — importa MANDATORY_KEYS_ACTIVE del propio
# backupSchema.mjs real (nunca una lista copiada a mano, que podría
# divergir en silencio) para producir un $SECRETS_FILE válido contra el
# esquema "active" completo, con valores ficticios desechables.
S7_FIXTURE_GEN="$TMP_ROOT/s7-fixture-gen.mjs"
cat >"$S7_FIXTURE_GEN" <<'FIXTURE_EOF'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const backupSchemaPath = process.argv[2]
const outPath = process.argv[3]
const { MANDATORY_KEYS_ACTIVE } = await import(pathToFileURL(backupSchemaPath).href)
const lines = ['# fixture de prueba (BLOQUE 12, lib.test.sh) - desechable', '']
for (const k of MANDATORY_KEYS_ACTIVE) {
  if (k.endsWith('_KEYS') || k.endsWith('_SECRETS')) {
    lines.push(k + '=' + JSON.stringify({ v1: 'valor-v1-' + k.toLowerCase() }))
  } else if (k.endsWith('_ACTIVE_KEY_VERSION')) {
    lines.push(k + '=v1')
  } else {
    lines.push(k + '=valor-original-' + k.toLowerCase())
  }
}
writeFileSync(outPath, lines.join('\n') + '\n', { mode: 0o600 })
FIXTURE_EOF

s7_make_fixture_dir() {
  local d="$TMP_ROOT/s7-case-$1"
  mkdir -p "$d"
  node "$S7_FIXTURE_GEN" "$SCRIPT_DIR/lib/backupSchema.mjs" "$d/.env.gapssa"
  printf '%s' "$d/.env.gapssa"
}

# --- Caso 1: NO-OP (rc=20) — el temporal, vacío, se retira de forma
#     síncrona (nunca queda para que el operador lo borre a mano). ---
CASE1_DIR="$TMP_ROOT/s7-case-1"
CASE1_SECRETS_FILE="$(s7_make_fixture_dir 1)"
CASE1_CURRENT_VALUE="$(grep '^BOOKING_INTERNAL_API_SECRET=' "$CASE1_SECRETS_FILE" | cut -d= -f2-)"
CASE1_RESULT="$(bash -c '
  set -euo pipefail
  SCRIPT_DIR="$1"; SECRETS_FILE="$2"
  source "$SCRIPT_DIR/lib.sh"
  source "$3"
  say() { :; }
  current_secrets_schema_version() { printf "active"; }
  mutations="[{\"op\":\"set-line\",\"key\":\"BOOKING_INTERNAL_API_SECRET\",\"value\":\"$4\"}]"
  rc=0
  _s7_apply_mutations "$mutations" "noop-test" >/dev/null 2>/dev/null || rc=$?
  tmp_gone="no"; [ -e "$S7_PIN_TMP" ] || tmp_gone="yes"
  stack_empty="no"; [ "${#GAPSSA_CLEANUP_OPS[@]}" -eq 0 ] && stack_empty="yes"
  printf "rc=%s tmp_gone=%s stack_empty=%s" "$rc" "$tmp_gone" "$stack_empty"
' _ "$SCRIPT_DIR" "$CASE1_SECRETS_FILE" "$S7FN_SNIPPET" "$CASE1_CURRENT_VALUE")"
if [ "$CASE1_RESULT" = "rc=20 tmp_gone=yes stack_empty=yes" ]; then
  echo "ok   - BLOQUE 12 caso 1 (no-op rc=20): el temporal SIN CONSUMIR se retira de forma síncrona, pila de limpieza queda vacía"
  PASS=$((PASS + 1))
else
  echo "FAIL - BLOQUE 12 caso 1 (no-op): $CASE1_RESULT"
  FAIL=$((FAIL + 1))
fi
# El nombre real que produce gapssa_secrets_mktemp_secure_same_dir es
# ".${base}.${label}-XXXXXXXX" con base=".env.gapssa" (YA empieza por
# punto) -> doble punto inicial de verdad: "..env.gapssa.<label>-XXXXXXXX"
# (confirmado empíricamente sobre el almacén externo real durante el
# diagnóstico de este incidente) — el patrón de abajo usa exactamente esa
# forma, nunca una aproximación de un solo punto que dejaría pasar en
# silencio un huérfano real sin que esta prueba lo detectara.
if find "$CASE1_DIR" -maxdepth 1 -name '..env.gapssa.*' 2>/dev/null | grep -q .; then
  echo "FAIL - BLOQUE 12 caso 1: quedó un temporal huérfano en $CASE1_DIR"
  FAIL=$((FAIL + 1))
else
  echo "ok   - BLOQUE 12 caso 1: cero temporales huérfanos (patrón '..env.gapssa.*') en $CASE1_DIR"
  PASS=$((PASS + 1))
fi

# --- Caso 2: error ANTES de escribir (rc=2, versión pedida ausente en
#     json-map-retain) — el temporal (vacío, nunca abierto para
#     escritura) se retira igual, nunca queda para el operador. ---
CASE2_SECRETS_FILE="$(s7_make_fixture_dir 2)"
CASE2_RESULT="$(bash -c '
  set -euo pipefail
  SCRIPT_DIR="$1"; SECRETS_FILE="$2"
  source "$SCRIPT_DIR/lib.sh"
  source "$3"
  say() { :; }
  current_secrets_schema_version() { printf "active"; }
  mutations="[{\"op\":\"json-map-retain\",\"key\":\"BOOKING_FIELD_ENCRYPTION_KEYS\",\"versions\":[\"v9-nunca-existio\"]}]"
  rc=0
  _s7_apply_mutations "$mutations" "error-before-write-test" >/dev/null 2>/dev/null || rc=$?
  tmp_gone="no"; [ -e "$S7_PIN_TMP" ] || tmp_gone="yes"
  stack_empty="no"; [ "${#GAPSSA_CLEANUP_OPS[@]}" -eq 0 ] && stack_empty="yes"
  printf "rc=%s tmp_gone=%s stack_empty=%s" "$rc" "$tmp_gone" "$stack_empty"
' _ "$SCRIPT_DIR" "$CASE2_SECRETS_FILE" "$S7FN_SNIPPET")"
if [ "$CASE2_RESULT" = "rc=2 tmp_gone=yes stack_empty=yes" ]; then
  echo "ok   - BLOQUE 12 caso 2 (error antes de escribir, rc=2): el temporal se retira, pila de limpieza queda vacía, \$SECRETS_FILE nunca se tocó"
  PASS=$((PASS + 1))
else
  echo "FAIL - BLOQUE 12 caso 2 (error antes de escribir): $CASE2_RESULT"
  FAIL=$((FAIL + 1))
fi

# --- Caso 3: error DESPUÉS de escribir == interrupción real (SIGKILL vía
#     GAPSSA_ROTATION_TEST_FAILPOINT="after-fsync-before-rename", Bloque
#     10) — el temporal SÍ contiene ya los bytes completos del secreto
#     nuevo (fsync ya ocurrió, rename nunca) cuando el proceso Node
#     muere; _s7_unpin_secrets_tmp debe SOBRESCRIBIR (shred, nunca un
#     simple rm) antes de borrar, y $SECRETS_FILE debe seguir intacto. ---
CASE3_SECRETS_FILE="$(s7_make_fixture_dir 3)"
CASE3_RESULT="$(bash -c '
  set -euo pipefail
  SCRIPT_DIR="$1"; SECRETS_FILE="$2"
  source "$SCRIPT_DIR/lib.sh"
  source "$3"
  say() { :; }
  current_secrets_schema_version() { printf "active"; }
  export GAPSSA_ROTATION_TEST_FAILPOINT="after-fsync-before-rename"
  export GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL="gapssa-s7-cleanup-tests-deadbeef02"
  mutations="[{\"op\":\"set-line\",\"key\":\"BOOKING_INTERNAL_API_SECRET\",\"value\":\"valor-que-nunca-debe-sobrevivir-en-disco\"}]"
  rc=0
  _s7_apply_mutations "$mutations" "crash-after-write-test" >/dev/null 2>/dev/null || rc=$?
  tmp_gone="no"; [ -e "$S7_PIN_TMP" ] || tmp_gone="yes"
  stack_empty="no"; [ "${#GAPSSA_CLEANUP_OPS[@]}" -eq 0 ] && stack_empty="yes"
  secrets_intact="no"; grep -q "^BOOKING_INTERNAL_API_SECRET=valor-original-booking_internal_api_secret$" "$SECRETS_FILE" && secrets_intact="yes"
  printf "rc=%s tmp_gone=%s stack_empty=%s secrets_intact=%s" "$rc" "$tmp_gone" "$stack_empty" "$secrets_intact"
' _ "$SCRIPT_DIR" "$CASE3_SECRETS_FILE" "$S7FN_SNIPPET")"
if [ "$CASE3_RESULT" = "rc=137 tmp_gone=yes stack_empty=yes secrets_intact=yes" ]; then
  echo "ok   - BLOQUE 12 caso 3 (interrupción real / error tras escribir, SIGKILL after-fsync-before-rename): el temporal con bytes de secreto real se retira (shred) igual, \$SECRETS_FILE original intacto"
  PASS=$((PASS + 1))
else
  echo "FAIL - BLOQUE 12 caso 3 (interrupción real): $CASE3_RESULT"
  FAIL=$((FAIL + 1))
fi

# --- Caso 4a: sustitución por SYMLINK — entre el pin y la retirada, el
#     temporal fijado se sustituye por un enlace simbólico a un fichero
#     "víctima" ajeno. _s7_unpin_secrets_tmp NUNCA debe seguir el enlace
#     ni tocar su destino — como mucho retira el propio enlace (mismo
#     contrato que gapssa_secrets_safe_unlink_if_symlink, ya probado en
#     BLOQUE 6). ---
CASE4A_SECRETS_FILE="$(s7_make_fixture_dir 4a)"
CASE4A_VICTIM="$TMP_ROOT/s7-case-4a-victima.txt"
printf 'CONTENIDO-VICTIMA-QUE-DEBE-SOBREVIVIR' >"$CASE4A_VICTIM"
CASE4A_RESULT="$(bash -c '
  set -euo pipefail
  SCRIPT_DIR="$1"; SECRETS_FILE="$2"; VICTIM="$4"
  source "$SCRIPT_DIR/lib.sh"
  source "$3"
  say() { :; }
  _s7_pin_secrets_tmp "symlink-swap-test"
  rm -f -- "$S7_PIN_TMP"
  ln -s "$VICTIM" "$S7_PIN_TMP"
  _s7_unpin_secrets_tmp false
  link_gone="no"; [ -e "$S7_PIN_TMP" ] || [ -h "$S7_PIN_TMP" ] || link_gone="yes"
  victim_intact="no"; [ "$(cat "$VICTIM")" = "CONTENIDO-VICTIMA-QUE-DEBE-SOBREVIVIR" ] && victim_intact="yes"
  stack_empty="no"; [ "${#GAPSSA_CLEANUP_OPS[@]}" -eq 0 ] && stack_empty="yes"
  printf "link_gone=%s victim_intact=%s stack_empty=%s" "$link_gone" "$victim_intact" "$stack_empty"
' _ "$SCRIPT_DIR" "$CASE4A_SECRETS_FILE" "$S7FN_SNIPPET" "$CASE4A_VICTIM")"
if [ "$CASE4A_RESULT" = "link_gone=yes victim_intact=yes stack_empty=yes" ]; then
  echo "ok   - BLOQUE 12 caso 4a (sustitución por symlink): el enlace se retira, el destino/víctima NUNCA se toca"
  PASS=$((PASS + 1))
else
  echo "FAIL - BLOQUE 12 caso 4a (symlink): $CASE4A_RESULT"
  FAIL=$((FAIL + 1))
fi

# --- Caso 4b: sustitución por OTRO fichero regular (mismo path, inodo
#     distinto) — _s7_unpin_secrets_tmp NUNCA debe sobrescribir/borrar
#     algo que ya no coincide con el pin capturado; el fichero sustituido
#     debe sobrevivir intacto y la función debe seguir retirando el
#     registro de la pila (para que el trap EXIT no repita el intento con
#     datos obsoletos). ---
CASE4B_SECRETS_FILE="$(s7_make_fixture_dir 4b)"
CASE4B_RESULT="$(bash -c '
  set -euo pipefail
  SCRIPT_DIR="$1"; SECRETS_FILE="$2"
  source "$SCRIPT_DIR/lib.sh"
  source "$3"
  say() { :; }
  _s7_pin_secrets_tmp "inode-swap-test"
  rm -f -- "$S7_PIN_TMP"
  printf "CONTENIDO-SUSTITUTO-QUE-DEBE-SOBREVIVIR" >"$S7_PIN_TMP"
  chmod 600 "$S7_PIN_TMP"
  _s7_unpin_secrets_tmp false
  substituted_intact="no"; [ -f "$S7_PIN_TMP" ] && [ "$(cat "$S7_PIN_TMP")" = "CONTENIDO-SUSTITUTO-QUE-DEBE-SOBREVIVIR" ] && substituted_intact="yes"
  stack_empty="no"; [ "${#GAPSSA_CLEANUP_OPS[@]}" -eq 0 ] && stack_empty="yes"
  rm -f -- "$S7_PIN_TMP"
  printf "substituted_intact=%s stack_empty=%s" "$substituted_intact" "$stack_empty"
' _ "$SCRIPT_DIR" "$CASE4B_SECRETS_FILE" "$S7FN_SNIPPET")"
if [ "$CASE4B_RESULT" = "substituted_intact=yes stack_empty=yes" ]; then
  echo "ok   - BLOQUE 12 caso 4b (sustitución por inodo distinto): el fichero sustituido NUNCA se toca, pila de limpieza igual queda vacía"
  PASS=$((PASS + 1))
else
  echo "FAIL - BLOQUE 12 caso 4b (sustitución por inodo): $CASE4B_RESULT"
  FAIL=$((FAIL + 1))
fi

# --- Caso 5: llamadas idempotentes repetidas — EXACTAMENTE la secuencia
#     real de gate_s7() ("generar-v3" seguido de "activar-v3", cada una
#     relanzada una segunda vez simulando una reanudación tras
#     interrupción) — cero temporales huérfanos al final, valor v3
#     idéntico entre la primera pasada y la reanudación. Regresión
#     directa del incidente real 2026-08-21. ---
CASE5_DIR="$TMP_ROOT/s7-case-5"
CASE5_SECRETS_FILE="$(s7_make_fixture_dir 5)"
CASE5_RESULT="$(bash -c '
  set -euo pipefail
  SCRIPT_DIR="$1"; SECRETS_FILE="$2"
  source "$SCRIPT_DIR/lib.sh"
  source "$3"
  say() { :; }
  current_secrets_schema_version() { printf "active"; }
  gen_mutations="[{\"op\":\"json-map-generate\",\"key\":\"BOOKING_FIELD_ENCRYPTION_KEYS\",\"versionKey\":\"v3\",\"bytes\":32,\"format\":\"base64\"}]"
  act_mutations="[{\"op\":\"set-line\",\"key\":\"BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION\",\"value\":\"v3\"}]"
  rc1=0; _s7_apply_mutations "$gen_mutations" "generar-v3" >/dev/null 2>/dev/null || rc1=$?
  rc2=0; _s7_apply_mutations "$act_mutations" "activar-v3" >/dev/null 2>/dev/null || rc2=$?
  v3_first="$(node -e "console.log(JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\").match(/^BOOKING_FIELD_ENCRYPTION_KEYS=(.*)$/m)[1]).v3)" "$SECRETS_FILE")"
  # Segunda "ejecución" (reanudación) — ambas deben ser no-op (rc=20).
  rc3=0; _s7_apply_mutations "$gen_mutations" "generar-v3" >/dev/null 2>/dev/null || rc3=$?
  rc4=0; _s7_apply_mutations "$act_mutations" "activar-v3" >/dev/null 2>/dev/null || rc4=$?
  v3_second="$(node -e "console.log(JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\").match(/^BOOKING_FIELD_ENCRYPTION_KEYS=(.*)$/m)[1]).v3)" "$SECRETS_FILE")"
  same_v3="no"; [ "$v3_first" = "$v3_second" ] && same_v3="yes"
  printf "rc1=%s rc2=%s rc3=%s rc4=%s same_v3=%s" "$rc1" "$rc2" "$rc3" "$rc4" "$same_v3"
' _ "$SCRIPT_DIR" "$CASE5_SECRETS_FILE" "$S7FN_SNIPPET")"
if [ "$CASE5_RESULT" = "rc1=0 rc2=0 rc3=20 rc4=20 same_v3=yes" ]; then
  echo "ok   - BLOQUE 12 caso 5 (llamadas idempotentes repetidas, secuencia real generar-v3/activar-v3): primera pasada cambia, reanudación es no-op, v3 nunca se regenera"
  PASS=$((PASS + 1))
else
  echo "FAIL - BLOQUE 12 caso 5 (idempotencia repetida): $CASE5_RESULT"
  FAIL=$((FAIL + 1))
fi
CASE5_ORPHANS="$(find "$CASE5_DIR" -maxdepth 1 -name '..env.gapssa.*' 2>/dev/null | wc -l | tr -d ' ')"
if [ "$CASE5_ORPHANS" = "0" ]; then
  echo "ok   - BLOQUE 12 caso 5: cero temporales huérfanos tras las 4 invocaciones (regresión directa del incidente real 2026-08-21)"
  PASS=$((PASS + 1))
else
  echo "FAIL - BLOQUE 12 caso 5: $CASE5_ORPHANS temporal(es) huérfano(s) sobrevivieron en $CASE5_DIR"
  FAIL=$((FAIL + 1))
fi

# --- Caso 6: _s7_migrate_legacy_schema — mismo contrato (no-op cuando el
#     archivo YA está en esquema "active", que es el caso normal en estas
#     fixtures) también retira su temporal de forma síncrona. ---
CASE6_SECRETS_FILE="$(s7_make_fixture_dir 6)"
CASE6_RESULT="$(bash -c '
  set -euo pipefail
  SCRIPT_DIR="$1"; SECRETS_FILE="$2"
  source "$SCRIPT_DIR/lib.sh"
  source "$3"
  say() { :; }
  rc=0
  _s7_migrate_legacy_schema >/dev/null 2>/dev/null || rc=$?
  tmp_gone="no"; [ -e "$S7_PIN_TMP" ] || tmp_gone="yes"
  stack_empty="no"; [ "${#GAPSSA_CLEANUP_OPS[@]}" -eq 0 ] && stack_empty="yes"
  printf "rc=%s tmp_gone=%s stack_empty=%s" "$rc" "$tmp_gone" "$stack_empty"
' _ "$SCRIPT_DIR" "$CASE6_SECRETS_FILE" "$S7FN_SNIPPET")"
if [ "$CASE6_RESULT" = "rc=0 tmp_gone=yes stack_empty=yes" ]; then
  echo "ok   - BLOQUE 12 caso 6 (_s7_migrate_legacy_schema, no-op porque ya está en 'active'): el temporal se retira igual, pila de limpieza queda vacía"
  PASS=$((PASS + 1))
else
  echo "FAIL - BLOQUE 12 caso 6 (_s7_migrate_legacy_schema): $CASE6_RESULT"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
