#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== 1. Inspeccionar InvitationSender de EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$em = $c->get("entityManager");
$systemUser = $em->getEntity("User", "system") ?? $em->getEntity("User", "1");
if ($systemUser) {
    if (method_exists($c, "setUser")) $c->setUser($systemUser);
    if (method_exists($c, "set")) $c->set("user", $systemUser);
}

$service = $c->get(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class);
$refService = new \ReflectionClass($service);
$prop = $refService->getProperty("invitationSender");
$prop->setAccessible(true);
$sender = $prop->getValue($service);

echo "Clase invitationSender: " . get_class($sender) . "\n";
$refSender = new \ReflectionClass($sender);
echo "Archivo: " . $refSender->getFileName() . "\n";

$file = file($refSender->getFileName());
$m = $refSender->getMethod("sendInvitation");
$start = $m->getStartLine();
$end = $m->getEndLine();
echo "\n--- Código de sendInvitation (líneas $start a $end) ---\n";
for ($i = $start - 1; $i < $end; $i++) {
    echo ($i + 1) . ": " . $file[$i];
}

// Veamos también métodos privados o helpers de esa clase
foreach ($refSender->getMethods() as $method) {
    if ($method->getDeclaringClass()->getName() === get_class($sender)) {
        echo "Método: " . $method->getName() . "\n";
    }
}
PHP_EOF

echo -e "\n=== 2. Inspeccionar ejecución exacta de sendInvitation para una cita ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$em = $c->get("entityManager");
$systemUser = $em->getEntity("User", "system") ?? $em->getEntity("User", "1");
if ($systemUser) {
    if (method_exists($c, "setUser")) $c->setUser($systemUser);
    if (method_exists($c, "set")) $c->set("user", $systemUser);
}

// Buscar la cita de las 13:30 o 14:15
$meeting = $em->getRDBRepository("Meeting")
    ->where([
        "cEstadoReserva" => "Confirmed",
        "id!=" => "6ab8fc8e114fe7117"
    ])
    ->findOne();

if (!$meeting) {
    echo "No se encontró cita confirmada con contacto\n";
    exit;
}

echo "Meeting ID: " . $meeting->getId() . " (" . $meeting->get("name") . ")\n";
$contacts = $em->getRelation($meeting, "contacts")->find();
echo "Contactos en relación: " . count($contacts) . "\n";
foreach ($contacts as $cnt) {
    echo "  Contacto: " . $cnt->get("name") . " <" . $cnt->getEmailAddress() . ">\n";
}

$service = $c->get(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class);
$targets = [];
foreach ($contacts as $contact) {
    if ($contact->getEmailAddress()) {
        $targets[] = new \Espo\Modules\Crm\Tools\Meeting\Invitation\Invitee(
            $contact->getEntityType(),
            $contact->getId(),
            $contact->getEmailAddress()
        );
    }
}

echo "Llamando a invitationService->send():\n";
try {
    $res = $service->send("Meeting", $meeting->getId(), $targets);
    echo "Resultado de send(): " . json_encode($res, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
} catch (\Throwable $e) {
    echo "ERROR en send(): " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n";
}
PHP_EOF
