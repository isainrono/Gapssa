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
$configFile = "/var/www/html/data/config.php";
$config = require $configFile;
$config["gapssaBookingDecisionEnabled"] = true;
if (!isset($config["gapssaBookingDecisionAuthorizedUserIds"]) || !is_array($config["gapssaBookingDecisionAuthorizedUserIds"])) {
    $config["gapssaBookingDecisionAuthorizedUserIds"] = [];
}
if (!in_array("6a71e26f5a32d9575", $config["gapssaBookingDecisionAuthorizedUserIds"], true)) {
    $config["gapssaBookingDecisionAuthorizedUserIds"][] = "6a71e26f5a32d9575";
}
file_put_contents($configFile, "<?php\nreturn " . var_export($config, true) . ";\n");
echo "Decisiones habilitadas correctamente (gapssaBookingDecisionEnabled=true).\n";
'

echo "==> 2c. Reiniciando contenedor de EspoCRM para recargar OPcache de Apache..."
docker compose --env-file .env.production -f compose.prod.yml restart espocrm

echo "==> 3. Configurando sincronización automática de aceptación de reservas y colores..."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm-db sh -c \
  'exec mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' << 'EOF'
-- 1. Triggers automáticos en meeting_user
DROP TRIGGER IF EXISTS trg_meeting_user_after_update;
DELIMITER $$
CREATE TRIGGER trg_meeting_user_after_update
AFTER UPDATE ON meeting_user
FOR EACH ROW
BEGIN
    IF NEW.status = 'Accepted' AND (OLD.status IS NULL OR OLD.status != 'Accepted') THEN
        UPDATE meeting
        SET c_estado_reserva = 'Confirmed',
            color = '#10B981',
            c_motivo_resolucion_reserva = 'Approved',
            status = 'Planned',
            modified_at = UTC_TIMESTAMP()
        WHERE id = NEW.meeting_id
          AND c_estado_reserva = 'PendingCenterApproval';
    ELSEIF NEW.status = 'Declined' AND (OLD.status IS NULL OR OLD.status != 'Declined') THEN
        UPDATE meeting
        SET c_estado_reserva = 'Canceled',
            color = '#9CA3AF',
            c_motivo_resolucion_reserva = 'RejectedByStaff',
            status = 'Not Held',
            modified_at = UTC_TIMESTAMP()
        WHERE id = NEW.meeting_id
          AND c_estado_reserva = 'PendingCenterApproval';
    END IF;
END$$

DROP TRIGGER IF EXISTS trg_meeting_user_after_insert$$
CREATE TRIGGER trg_meeting_user_after_insert
AFTER INSERT ON meeting_user
FOR EACH ROW
BEGIN
    IF NEW.status = 'Accepted' THEN
        UPDATE meeting
        SET c_estado_reserva = 'Confirmed',
            color = '#10B981',
            c_motivo_resolucion_reserva = 'Approved',
            status = 'Planned',
            modified_at = UTC_TIMESTAMP()
        WHERE id = NEW.meeting_id
          AND c_estado_reserva = 'PendingCenterApproval';
    ELSEIF NEW.status = 'Declined' THEN
        UPDATE meeting
        SET c_estado_reserva = 'Canceled',
            color = '#9CA3AF',
            c_motivo_resolucion_reserva = 'RejectedByStaff',
            status = 'Not Held',
            modified_at = UTC_TIMESTAMP()
        WHERE id = NEW.meeting_id
          AND c_estado_reserva = 'PendingCenterApproval';
    END IF;
END$$
DELIMITER ;

-- 2. Sincronizar inmediatamente citas que ya fueron aceptadas por Diana
UPDATE meeting m
JOIN meeting_user mu ON mu.meeting_id = m.id
SET m.c_estado_reserva = 'Confirmed',
    m.color = '#10B981',
    m.c_motivo_resolucion_reserva = 'Approved',
    m.status = 'Planned',
    m.modified_at = UTC_TIMESTAMP()
WHERE mu.status = 'Accepted'
  AND m.c_estado_reserva = 'PendingCenterApproval';

-- 3. Actualizar colores para todas las reservas según su estado
UPDATE meeting SET color = '#F59E0B' WHERE c_estado_reserva = 'PendingCenterApproval';
UPDATE meeting SET color = '#10B981' WHERE c_estado_reserva = 'Confirmed';
UPDATE meeting SET color = '#9CA3AF' WHERE c_estado_reserva = 'Canceled';

SELECT id, name, date_start, c_estado_reserva, status, color, c_motivo_resolucion_reserva FROM meeting;
EOF

echo "==> 4. Reconstruyendo y actualizando el contenedor web (BFF)..."
docker compose --env-file .env.production -f compose.prod.yml up -d --build web

echo "==> ¡Listo! Los cambios están aplicados y el calendario coloreado."
