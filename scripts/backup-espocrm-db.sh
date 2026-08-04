#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup_dir="${project_dir}/backups/espocrm"
backup_timestamp="$(date '+%Y%m%d-%H%M%S')"
backup_file="${backup_dir}/espocrm-${backup_timestamp}.sql.gz"

mkdir -p "${backup_dir}"

if [[ -e "${backup_file}" ]]; then
  echo "Ya existe el respaldo: ${backup_file}" >&2
  exit 1
fi

cd "${project_dir}"

docker compose exec -T espocrm-db sh -lc \
  'mariadb-dump --single-transaction --routines --triggers --events --default-character-set=utf8mb4 -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' \
  | gzip -9 > "${backup_file}"

gzip -t "${backup_file}"

echo "Respaldo creado y verificado: ${backup_file}"
