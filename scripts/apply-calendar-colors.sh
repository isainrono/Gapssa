#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

echo "==> 1. Sincronizando personalizaciones de EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml cp extensions/espocrm/custom/Espo/Custom/. espocrm:/var/www/html/custom/Espo/Custom/

echo "==> 2. Reconstruyendo metadatos y limpiando caché de EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml exec espocrm php command.php rebuild
docker compose --env-file .env.production -f compose.prod.yml exec espocrm php command.php clear-cache

echo "==> 3. Actualizando color naranja en citas pendientes existentes en la base de datos..."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm-db sh -c \
  'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" -e "UPDATE meeting SET color = '\''#F59E0B'\'' WHERE c_estado_reserva = '\''PendingCenterApproval'\'' AND (color IS NULL OR color != '\''#F59E0B'\'');"'

echo "==> 4. Reconstruyendo y actualizando el contenedor web (BFF)..."
docker compose --env-file .env.production -f compose.prod.yml up -d --build web

echo "==> ¡Listo! Los cambios están aplicados y el calendario coloreado."
