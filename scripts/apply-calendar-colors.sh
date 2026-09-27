#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

echo "==> 1. Sincronizando personalizaciones de EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml cp extensions/espocrm/custom/Espo/Custom/. espocrm:/var/www/html/custom/Espo/Custom/
if [ -d extensions/espocrm/custom/client/custom ]; then
  docker compose --env-file .env.production -f compose.prod.yml cp extensions/espocrm/custom/client/custom/. espocrm:/var/www/html/client/custom/
fi

echo "==> 2. Reconstruyendo metadatos y limpiando caché de EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml exec espocrm bin/command rebuild
docker compose --env-file .env.production -f compose.prod.yml exec espocrm bin/command clear-cache

echo "==> 2b. Habilitando aprobación de reservas en EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml exec espocrm php -r '
$container = (new \Espo\Core\Application())->getContainer();
$configWriter = $container->get("configWriter");
$configWriter->set("gapssaBookingDecisionEnabled", true);
$configWriter->set("gapssaBookingDecisionAuthorizedUserIds", ["6a71e26f5a32d9575"]);
$configWriter->save();
echo "Decisiones habilitadas correctamente (gapssaBookingDecisionEnabled=true).\n";
'

echo "==> 3. Actualizando colores en base de datos para todas las citas..."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm-db sh -c \
  'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" -e "
    UPDATE meeting SET color = '\''#F59E0B'\'' WHERE c_estado_reserva = '\''PendingCenterApproval'\'';
    UPDATE meeting SET color = '\''#10B981'\'' WHERE c_estado_reserva = '\''Confirmed'\'';
    UPDATE meeting SET color = '\''#9CA3AF'\'' WHERE c_estado_reserva = '\''Canceled'\'';
  "'

echo "==> 4. Reconstruyendo y actualizando el contenedor web (BFF)..."
docker compose --env-file .env.production -f compose.prod.yml up -d --build web

echo "==> ¡Listo! Los cambios están aplicados y el calendario coloreado."
