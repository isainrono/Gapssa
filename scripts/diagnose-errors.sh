#!/usr/bin/env bash

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== Diagnóstico sin fallos silenciosos ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -d display_errors=1 -- << 'PHP_EOF'
<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);

require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$em = $c->get("entityManager");

$systemUser = $em->getEntity("User", "system") ?? $em->getEntity("User", "1");
if ($systemUser) {
    if (method_exists($c, "setUser")) $c->setUser($systemUser);
    if (method_exists($c, "set")) $c->set("user", $systemUser);
}

echo "1. Buscando InvitationService...\n";
try {
    $factory = $c->get("injectableFactory");
    $service = $factory->create(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class);
    echo "✔ InvitationService instanciado correctamente.\n";
    
    $ref = new \ReflectionClass($service);
    $prop = $ref->getProperty("invitationSender");
    $prop->setAccessible(true);
    $sender = $prop->getValue($service);
    echo "Clase invitationSender: " . get_class($sender) . "\n";
    echo "Archivo invitationSender: " . (new \ReflectionClass($sender))->getFileName() . "\n";
} catch (\Throwable $e) {
    echo "❌ Error instanciando InvitationService: " . $e->getMessage() . "\n";
}

echo "\n2. Buscando última cita confirmada...\n";
$meetings = $em->getRDBRepository("Meeting")
    ->where(["cEstadoReserva" => "Confirmed"])
    ->order("createdAt", "DESC")
    ->limit(3)
    ->find();

foreach ($meetings as $m) {
    echo "Cita ID: " . $m->getId() . " | Nombre: " . $m->get("name") . " | Estado: " . $m->get("cEstadoReserva") . "\n";
    $contacts = $em->getRelation($m, "contacts")->find();
    echo "  Asistentes Contact: " . count($contacts) . "\n";
    foreach ($contacts as $cnt) {
        echo "    " . $cnt->get("name") . " <" . $cnt->getEmailAddress() . ">\n";
    }
    echo "  Parent: " . $m->get("parentType") . " ID: " . $m->get("parentId") . "\n";
    if ($m->get("parentType") === "Contact" && $m->get("parentId")) {
        $parent = $em->getEntity("Contact", $m->get("parentId"));
        if ($parent) {
            echo "    Parent Contact: " . $parent->get("name") . " <" . $parent->getEmailAddress() . ">\n";
        }
    }
}
PHP_EOF
