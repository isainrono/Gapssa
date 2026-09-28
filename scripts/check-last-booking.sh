#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== 1. Últimas citas creadas/modificadas hoy en EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$em = $app->getContainer()->get("entityManager");

$meetings = $em->getRDBRepository("Meeting")
    ->order("createdAt", "DESC")
    ->limit(3)
    ->find();

foreach ($meetings as $m) {
    echo "ID: " . $m->getId() . "\n";
    echo "  Nombre:        " . $m->get("name") . "\n";
    echo "  Creado:        " . $m->get("createdAt") . "\n";
    echo "  Modificado:    " . $m->get("modifiedAt") . "\n";
    echo "  EstadoReserva: " . ($m->get("cEstadoReserva") ?: "NULL") . "\n";
    echo "  Status Nativo: " . $m->get("status") . "\n";
    echo "  Color:         " . ($m->get("color") ?: "NULL") . "\n";
    echo "  Motivo Res.:   " . ($m->get("cMotivoResolucionReserva") ?: "NULL") . "\n";

    // Asistentes usuarios
    $users = $em->getRelation($m, "users")->find();
    echo "  Usuarios asignados/asistentes (" . count($users) . "):\n";
    foreach ($users as $u) {
        $rel = $em->getRDBRepository("MeetingUser")->where(["meetingId" => $m->getId(), "userId" => $u->getId()])->findOne();
        $st = $rel ? $rel->get("status") : "sin estado";
        echo "    - " . $u->get("name") . " (ID: " . $u->getId() . ") -> Status: $st\n";
    }

    // Asistentes contactos
    $contacts = $em->getRelation($m, "contacts")->find();
    echo "  Contactos asistentes (" . count($contacts) . "):\n";
    foreach ($contacts as $cnt) {
        echo "    - " . $cnt->get("name") . " <" . $cnt->getEmailAddress() . "> (ID: " . $cnt->getId() . ")\n";
    }

    echo "  ParentType:    " . $m->get("parentType") . " | ParentID: " . $m->get("parentId") . "\n";
    echo "----------------------------------------\n";
}
PHP_EOF

echo -e "\n=== 2. Logs de EspoCRM de los últimos minutos ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm tail -n 40 /var/www/html/data/logs/espo-$(date +%Y-%m-%d).log
