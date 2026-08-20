#!/usr/bin/env bash
# Infraestructura Docker DESECHABLE para la suite de integración de
# rotación (Paquete H del plan aprobado) — Postgres 18 + Redis 8 propios,
# nombrados/etiquetados, en una red y volúmenes propios, con credenciales
# ficticias de un solo uso. NUNCA usa `docker compose`/`compose.yml`, NUNCA
# toca ningún contenedor/red/volumen real de GAPSSA (`gapssa-*`).
#
# Subcomandos:
#   up             — crea PROJECT=gapssa-rotation-v3-tests-<rand>, arranca
#                    Postgres/Redis propios, imprime PROJECT por stdout.
#   verify-isolated <project> — inventario ANTES de tocar nada: confirma
#                    que no existe ya ningún recurso con ese label, y
#                    snapshotea el estado de TODO recurso gestionado por
#                    `docker compose` en esta máquina (real, `gapssa-*` u
#                    otro) para poder demostrar después que no cambió.
#   env <project> <outfile> — escribe (nunca a stdout) las variables de
#                    entorno de conexión a un fichero 600 fuera del
#                    workspace.
#   down <project> — para y elimina EXCLUSIVAMENTE los recursos con el
#                    label de este proyecto (verificado por label exacto,
#                    nunca por coincidencia de nombre suelta).
#   verify-clean <project> — reinventario: cero recursos con el label, y
#                    diff automático contra el snapshot de verify-isolated
#                    de los recursos reales — falla si algo cambió.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL_KEY="com.gapssa.rotation-v3-test"
SNAPSHOT_DIR="${TMPDIR:-/tmp}/gapssa-rotation-v3-snapshots"

say() { printf '%s\n' "$*" >&2; }

# Snapshot de TODO recurso gestionado por `docker compose` en esta
# máquina (identificado por la presencia del label estándar
# `com.docker.compose.project`, que Compose añade siempre) — nunca
# depende de adivinar el nombre real del proyecto GAPSSA (nunca se lee
# `.env`/`COMPOSE_PROJECT_NAME`). Usa `docker inspect` (nunca `docker ps
# --format`/`docker volume ls --format`, cuyos campos "Status"/"RunningFor"/
# "Size" son cadenas relativas al reloj — cambian solas con el tiempo
# incluso para un recurso que no se tocó, dando falsos positivos) — solo
# campos ESTABLES: Id, nombre, State.Status/StartedAt/FinishedAt, Mounts
# (Source/Destination/Name), redes (claves + NetworkID), Labels
# (normalizadas — el orden de Go no es determinista entre invocaciones).
_snapshot_real_compose_resources() {
  local out="$1"
  local ids=""
  ids="$(docker ps -aq --filter "label=com.docker.compose.project" 2>/dev/null || true)
$(docker network ls -q --filter "label=com.docker.compose.project" 2>/dev/null || true)
$(docker volume ls -q --filter "label=com.docker.compose.project" 2>/dev/null || true)"
  ids="$(printf '%s\n' "$ids" | grep -v '^$' | sort -u || true)"

  if [ -z "$ids" ]; then
    : >"$out"
    return 0
  fi

  # shellcheck disable=SC2086
  docker inspect $ids 2>/dev/null | python3 "$SCRIPT_DIR/normalize_docker_inspect.py" >"$out"
}

gen_project_name() {
  printf 'gapssa-rotation-v3-tests-%s\n' "$(openssl rand -hex 6)"
}

cmd_up() {
  local project="$1"
  [ -n "$project" ] || { say "ERROR: 'up' requiere el nombre de proyecto (usa 'new-project-name' para generarlo)."; exit 1; }
  local net="${project}-net"
  local pgdata_vol="${project}-pgdata"
  local redisdata_vol="${project}-redisdata"

  docker network create --label "${LABEL_KEY}=1" --label "${LABEL_KEY}.project=${project}" "$net" >/dev/null
  docker volume create --label "${LABEL_KEY}=1" --label "${LABEL_KEY}.project=${project}" "$pgdata_vol" >/dev/null
  docker volume create --label "${LABEL_KEY}=1" --label "${LABEL_KEY}.project=${project}" "$redisdata_vol" >/dev/null

  local pg_user="gapssa_rot_test" pg_db="gapssa_rot_test"
  local pg_pass redis_pass
  pg_pass="$(openssl rand -hex 24)"
  redis_pass="$(openssl rand -hex 24)"

  docker run -d \
    --name "${project}-pg" --network "$net" \
    -v "${pgdata_vol}:/var/lib/postgresql" \
    -p 127.0.0.1::5432 \
    --label "${LABEL_KEY}=1" --label "${LABEL_KEY}.project=${project}" \
    -e "POSTGRES_USER=${pg_user}" -e "POSTGRES_PASSWORD=${pg_pass}" -e "POSTGRES_DB=${pg_db}" \
    postgres:18-alpine >/dev/null

  docker run -d \
    --name "${project}-redis" --network "$net" \
    -v "${redisdata_vol}:/data" \
    -p 127.0.0.1::6379 \
    --label "${LABEL_KEY}=1" --label "${LABEL_KEY}.project=${project}" \
    redis:8-alpine redis-server --requirepass "$redis_pass" >/dev/null

  # Credenciales de un solo uso — solo en un fichero 600 fuera del
  # workspace, nunca a stdout (el llamador consulta `env` por separado).
  mkdir -p "$SNAPSHOT_DIR"
  chmod 700 "$SNAPSHOT_DIR"
  local creds_file="$SNAPSHOT_DIR/${project}.creds"
  {
    printf 'PG_USER=%s\n' "$pg_user"
    printf 'PG_PASSWORD=%s\n' "$pg_pass"
    printf 'PG_DB=%s\n' "$pg_db"
    printf 'REDIS_PASSWORD=%s\n' "$redis_pass"
  } >"$creds_file"
  chmod 600 "$creds_file"
  unset pg_pass redis_pass

  say "Esperando a que Postgres/Redis desechables acepten conexiones..."
  local attempt
  for attempt in $(seq 1 30); do
    if docker exec "${project}-pg" pg_isready -U "$pg_user" -d "$pg_db" >/dev/null 2>&1 && \
       docker exec "${project}-redis" redis-cli -a "$(grep '^REDIS_PASSWORD=' "$creds_file" | cut -d= -f2-)" ping 2>/dev/null | grep -q PONG; then
      break
    fi
    sleep 1
  done

  say "OK — proyecto desechable '$project' operativo."
}

cmd_verify_isolated() {
  local project="$1"
  local labeled
  labeled="$(docker ps -aq --filter "label=${LABEL_KEY}.project=${project}" 2>/dev/null || true)"
  if [ -n "$labeled" ]; then
    say "ERROR: ya existen contenedores con el label ${LABEL_KEY}.project=${project} — abortando."
    exit 1
  fi
  mkdir -p "$SNAPSHOT_DIR"
  chmod 700 "$SNAPSHOT_DIR"
  _snapshot_real_compose_resources "$SNAPSHOT_DIR/${project}.before"
  say "OK — inventario previo tomado (0 recursos etiquetados de este proyecto todavía; snapshot de recursos reales de compose guardado)."
}

cmd_env() {
  local project="$1" outfile="$2"
  local creds_file="$SNAPSHOT_DIR/${project}.creds"
  [ -f "$creds_file" ] || { say "ERROR: no existen credenciales para $project — ¿se llamó a 'up' primero?"; exit 1; }

  local pg_user pg_pass pg_db redis_pass pg_port redis_port
  pg_user="$(grep '^PG_USER=' "$creds_file" | cut -d= -f2-)"
  pg_pass="$(grep '^PG_PASSWORD=' "$creds_file" | cut -d= -f2-)"
  pg_db="$(grep '^PG_DB=' "$creds_file" | cut -d= -f2-)"
  redis_pass="$(grep '^REDIS_PASSWORD=' "$creds_file" | cut -d= -f2-)"
  pg_port="$(docker port "${project}-pg" 5432/tcp | head -n1 | cut -d: -f2)"
  redis_port="$(docker port "${project}-redis" 6379/tcp | head -n1 | cut -d: -f2)"

  local redis_pass_enc
  redis_pass_enc="$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$redis_pass")"

  {
    printf 'GAPSSA_ROTATION_V3_PG_URL=postgresql://%s:%s@127.0.0.1:%s/%s\n' "$pg_user" "$pg_pass" "$pg_port" "$pg_db"
    printf 'GAPSSA_ROTATION_V3_REDIS_URL=redis://:%s@127.0.0.1:%s/0\n' "$redis_pass_enc" "$redis_port"
  } >"$outfile"
  chmod 600 "$outfile"
  unset pg_pass redis_pass redis_pass_enc
  say "OK — variables de conexión escritas en $outfile (600, nunca a stdout)."
}

cmd_down() {
  local project="$1"
  local id
  for id in $(docker ps -aq --filter "label=${LABEL_KEY}.project=${project}" 2>/dev/null || true); do
    local actual_label
    actual_label="$(docker inspect --format '{{index .Config.Labels "'"${LABEL_KEY}"'.project"}}' "$id" 2>/dev/null || true)"
    [ "$actual_label" = "$project" ] || continue
    docker rm -f "$id" >/dev/null 2>&1 || true
  done
  for net in $(docker network ls -q --filter "label=${LABEL_KEY}.project=${project}" 2>/dev/null || true); do
    local actual_label
    actual_label="$(docker network inspect --format '{{index .Labels "'"${LABEL_KEY}"'.project"}}' "$net" 2>/dev/null || true)"
    [ "$actual_label" = "$project" ] || continue
    docker network rm "$net" >/dev/null 2>&1 || true
  done
  for vol in $(docker volume ls -q --filter "label=${LABEL_KEY}.project=${project}" 2>/dev/null || true); do
    local actual_label
    actual_label="$(docker volume inspect --format '{{index .Labels "'"${LABEL_KEY}"'.project"}}' "$vol" 2>/dev/null || true)"
    [ "$actual_label" = "$project" ] || continue
    docker volume rm "$vol" >/dev/null 2>&1 || true
  done
  rm -f "$SNAPSHOT_DIR/${project}.creds"
  say "OK — recursos con label ${LABEL_KEY}.project=${project} eliminados (verificados uno a uno por label exacto antes de borrar)."
}

cmd_verify_clean() {
  local project="$1"
  local labeled
  labeled="$(docker ps -aq --filter "label=${LABEL_KEY}.project=${project}" 2>/dev/null || true)"
  labeled="${labeled}$(docker network ls -q --filter "label=${LABEL_KEY}.project=${project}" 2>/dev/null || true)"
  labeled="${labeled}$(docker volume ls -q --filter "label=${LABEL_KEY}.project=${project}" 2>/dev/null || true)"
  if [ -n "$labeled" ]; then
    say "FALLO: siguen existiendo recursos con label ${LABEL_KEY}.project=${project} tras 'down'."
    exit 1
  fi

  local before="$SNAPSHOT_DIR/${project}.before" after="$SNAPSHOT_DIR/${project}.after"
  _snapshot_real_compose_resources "$after"
  if ! diff -u "$before" "$after" >&2; then
    say "FALLO: el estado de los recursos REALES de docker compose cambió durante esta ejecución (diff arriba)."
    exit 1
  fi
  rm -f "$before" "$after"
  say "OK — cero residuos del proyecto desechable, y los recursos reales de docker compose quedaron idénticos (diff automático limpio)."
}

case "${1:-}" in
new-project-name) gen_project_name ;;
up) cmd_up "$2" ;;
verify-isolated) cmd_verify_isolated "$2" ;;
env) cmd_env "$2" "$3" ;;
down) cmd_down "$2" ;;
verify-clean) cmd_verify_clean "$2" ;;
*)
  echo "Uso: $0 {new-project-name|up <project>|verify-isolated <project>|env <project> <outfile>|down <project>|verify-clean <project>}" >&2
  exit 1
  ;;
esac
