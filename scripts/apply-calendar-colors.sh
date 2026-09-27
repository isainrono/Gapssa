#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

echo "==> 1. Sincronizando personalizaciones de EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml cp extensions/espocrm/custom/Espo/Custom/. espocrm:/var/www/html/custom/Espo/Custom/
if [ -d extensions/espocrm/custom/client/custom ]; then
  docker compose --env-file .env.production -f compose.prod.yml cp extensions/espocrm/custom/client/custom/. espocrm:/var/www/html/client/custom/
fi
docker compose --env-file .env.production -f compose.prod.yml exec espocrm chown -R www-data:www-data /var/www/html/custom /var/www/html/client/custom

echo "==> 2. Reconstruyendo metadatos y limpiando caché de EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml exec espocrm bin/command rebuild
docker compose --env-file .env.production -f compose.prod.yml exec espocrm bin/command clear-cache

smtp_host="$(grep -E '^ *SMTP_HOST *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '172.25.0.1')"
smtp_port="$(grep -E '^ *SMTP_PORT *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '587')"
smtp_user="$(grep -E '^ *SMTP_USER *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo 'reservas@gapssa.es')"
smtp_pass="$(grep -E '^ *(SMTP_PASSWORD|SMTP_PASS) *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '')"

echo "==> 2b. Configurando SMTP y habilitando aprobación de reservas en EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml exec espocrm php -r '
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$crypt = $app->getContainer()->get("crypt");

$configFile = "/var/www/html/data/config.php";
$config = require $configFile;
$config["gapssaBookingDecisionEnabled"] = true;
if (!isset($config["gapssaBookingDecisionAuthorizedUserIds"]) || !is_array($config["gapssaBookingDecisionAuthorizedUserIds"])) {
    $config["gapssaBookingDecisionAuthorizedUserIds"] = [];
}
if (!in_array("6a71e26f5a32d9575", $config["gapssaBookingDecisionAuthorizedUserIds"], true)) {
    $config["gapssaBookingDecisionAuthorizedUserIds"][] = "6a71e26f5a32d9575";
}
// Configuración de SMTP saliente en EspoCRM para envío de confirmaciones
$config["smtpServer"] = $argv[1] ?: "172.25.0.1";
$config["smtpPort"] = (int) ($argv[2] ?: 587);
$config["smtpAuth"] = true;
$config["smtpSecurity"] = "";
$config["smtpUsername"] = $argv[3] ?: "reservas@gapssa.es";
if (!empty($argv[4])) {
    $config["smtpPassword"] = $crypt->encrypt($argv[4]);
}
$config["outboundEmailFromName"] = "GAPSSA";
$config["outboundEmailFromAddress"] = $argv[3] ?: "reservas@gapssa.es";
$config["outboundEmailIsShared"] = true;

file_put_contents($configFile, "<?php\nreturn " . var_export($config, true) . ";\n");
echo "Configuración en data/config.php actualizada (decisiones habilitadas y SMTP configurado con contraseña cifrada para " . $config["outboundEmailFromAddress"] . ").\n";

try {
    $em = $app->getContainer()->get("entityManager");
    if ($em->hasRepository("OutboundEmail")) {
        $repo = $em->getRDBRepository("OutboundEmail");
        $existing = $repo->where(["isShared" => true])->findOne();
        if (!$existing) {
            $existing = $repo->findOne();
        }
        $account = $existing ?? $em->getNewEntity("OutboundEmail");
        $account->set([
            "name" => "GAPSSA",
            "status" => "Active",
            "fromAddress" => $argv[3] ?: "reservas@gapssa.es",
            "fromName" => "GAPSSA",
            "replyToAddress" => $argv[3] ?: "reservas@gapssa.es",
            "replyToName" => "GAPSSA",
            "smtpServer" => $argv[1] ?: "172.25.0.1",
            "smtpPort" => (int) ($argv[2] ?: 587),
            "smtpAuth" => true,
            "smtpSecurity" => "",
            "smtpUsername" => $argv[3] ?: "reservas@gapssa.es",
            "isShared" => true,
        ]);
        if (!empty($argv[4])) {
            $account->set("smtpPassword", $crypt->encrypt($argv[4]));
        }
        $em->saveEntity($account);
        echo "✔ Entidad OutboundEmail del sistema asegurada (ID: " . $account->getId() . ").\n";
    }
} catch (\Throwable $e) {
    echo "⚠ Aviso actualizando OutboundEmail: " . $e->getMessage() . "\n";
}
' "$smtp_host" "$smtp_port" "$smtp_user" "$smtp_pass"

docker compose --env-file .env.production -f compose.prod.yml exec espocrm chown -R www-data:www-data /var/www/html/data

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

echo "==> 3b. Despachando confirmación personalizada a clientes con citas confirmadas..."
docker compose --env-file .env.production -f compose.prod.yml exec espocrm php -r '
require_once "/var/www/html/bootstrap.php";
try {
    $app = new \Espo\Core\Application();
    $container = $app->getContainer();
    $em = $container->get("entityManager");

    if ($container->has(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class)) {
        $invitationService = $container->get(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class);
    } elseif ($container->has("injectableFactory")) {
        $invitationService = $container->get("injectableFactory")->create(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class);
    } else {
        $invitationService = $container->get(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class);
    }

    $meetings = $em->getRDBRepository("Meeting")
        ->where(["cEstadoReserva" => "Confirmed"])
        ->find();

    foreach ($meetings as $meeting) {
        $targets = [];
        $contacts = $em->getRelation($meeting, \Espo\Modules\Crm\Entities\Meeting::LINK_CONTACTS)->find();
        
        // Si no está en la relación, verificar parentId
        if (count($contacts) === 0) {
            $contactId = null;
            if ($meeting->get("parentType") === "Contact" && $meeting->get("parentId")) {
                $contactId = (string) $meeting->get("parentId");
            } elseif ($meeting->get("contactId")) {
                $contactId = (string) $meeting->get("contactId");
            }
            if ($contactId) {
                $parentContact = $em->getEntity("Contact", $contactId);
                if ($parentContact) {
                    $em->getRelation($meeting, \Espo\Modules\Crm\Entities\Meeting::LINK_CONTACTS)->relate($parentContact);
                    $contacts = [$parentContact];
                }
            }
        }

        foreach ($contacts as $contact) {
            if ($contact->getEmailAddress()) {
                $targets[] = new \Espo\Modules\Crm\Tools\Meeting\Invitation\Invitee(
                    $contact->getEntityType(),
                    $contact->getId(),
                    $contact->getEmailAddress()
                );
            }
        }

        if (!empty($targets)) {
            try {
                $invitationService->send("Meeting", $meeting->getId(), $targets);
                echo "✔ Correo de confirmación enviado exitosamente a " . $targets[0]->getEmailAddress() . " para la cita " . $meeting->get("name") . "\n";
            } catch (\Throwable $e) {
                echo "⚠ Aviso enviando correo para la cita " . $meeting->getId() . ": " . $e->getMessage() . "\n";
            }
        } else {
            echo "ℹ No se encontró email de contacto para la cita " . $meeting->getId() . "\n";
        }
    }
} catch (\Throwable $e) {
    echo "⚠ Aviso general en despacho de confirmaciones: " . $e->getMessage() . "\n";
}
'

echo "==> 4. Reconstruyendo y actualizando el contenedor web (BFF)..."
docker compose --env-file .env.production -f compose.prod.yml up -d --build web

echo "==> ¡Listo! Los cambios están aplicados y el calendario coloreado."
