#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== Código de sendInternal en InvitationService.php ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$ref = new \ReflectionClass(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class);
$file = file($ref->getFileName());
$m = $ref->getMethod("sendInternal");
$start = $m->getStartLine();
$end = $m->getEndLine();
for ($i = $start - 1; $i < $end; $i++) {
    echo ($i + 1) . ": " . $file[$i];
}
PHP_EOF

echo -e "\n=== Métodos y lógica de envío de invitaciones ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$ref = new \ReflectionClass(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class);
foreach ($ref->getMethods() as $method) {
    echo $method->getName() . "\n";
}
PHP_EOF

echo -e "\n=== Probar envío real de InvitationService y capturar retorno ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$em = $c->get("entityManager");

$meeting = $em->getRDBRepository("Meeting")->where(["cEstadoReserva" => "Confirmed"])->findOne();
if (!$meeting) {
    echo "No hay reunión confirmada\n";
    exit;
}
echo "Probando con Meeting: " . $meeting->getId() . " (" . $meeting->get("name") . ")\n";

$invitationService = $c->get(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class);

$contacts = $em->getRelation($meeting, "contacts")->find();
echo "Contactos relacionados: " . count($contacts) . "\n";
foreach ($contacts as $cnt) {
    echo "  Contacto: " . $cnt->get("name") . " <" . $cnt->getEmailAddress() . ">\n";
}

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

echo "Llamando a invitationService->send...\n";
try {
    $result = $invitationService->send("Meeting", $meeting->getId(), $targets);
    echo "Resultado devuelto por send(): " . var_export($result, true) . "\n";
} catch (\Throwable $e) {
    echo "ERROR en send(): " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n";
}
PHP_EOF

echo -e "\n=== Verificar Crypt::decrypt en InboundEmail y config.php ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$crypt = $c->get("crypt");
$config = $c->get("config");

echo "Config smtpPassword decrypt: ";
try {
    $res = $crypt->decrypt($config->get("smtpPassword"));
    echo ($res ? "✔ OK (longitud: " . strlen($res) . ")" : "vacío") . "\n";
} catch (\Throwable $e) {
    echo "❌ Error: " . $e->getMessage() . "\n";
}

$em = $c->get("entityManager");
$inbound = $em->getEntity("InboundEmail", "6a70ed04a0fdd2f68");
if ($inbound) {
    echo "InboundEmail 6a70ed04a0fdd2f68 smtpPassword decrypt: ";
    try {
        $res = $crypt->decrypt($inbound->get("smtpPassword"));
        echo ($res ? "✔ OK (longitud: " . strlen($res) . ")" : "vacío") . "\n";
    } catch (\Throwable $e) {
        echo "❌ Error: " . $e->getMessage() . "\n";
    }

    echo "InboundEmail 6a70ed04a0fdd2f68 password (IMAP/POP3) decrypt: ";
    try {
        $res = $crypt->decrypt($inbound->get("password"));
        echo ($res ? "✔ OK (longitud: " . strlen($res) . ")" : "vacío") . "\n";
    } catch (\Throwable $e) {
        echo "❌ Error: " . $e->getMessage() . "\n";
    }
}
PHP_EOF
