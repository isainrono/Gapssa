#!/usr/bin/env bash

set -u
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$em = $c->get('entityManager');
$systemUser = $em->getEntity('User', 'system') ?? $em->getEntity('User', '1');
$c->setUser($systemUser);

$injectableFactory = $c->get('injectableFactory');

echo "1. Probando creación de BookingConfirmationSender via InjectableFactory...\n";
try {
    $sender = $injectableFactory->create(\Espo\Custom\Classes\Mail\BookingConfirmationSender::class);
    echo "  ✔ BookingConfirmationSender creado con éxito via InjectableFactory!\n";
} catch (\Throwable $e) {
    echo "  ❌ Error: " . $e->getMessage() . "\n";
}

echo "\n2. Probando creación de Espo\\Custom\\Controllers\\Meeting via InjectableFactory...\n";
try {
    $controller = $injectableFactory->create(\Espo\Custom\Controllers\Meeting::class);
    echo "  ✔ Meeting Controller creado con éxito!\n";
    $ref = new ReflectionClass($controller);
    foreach ($ref->getProperties() as $p) {
        $p->setAccessible(true);
        $val = $p->getValue($controller);
        $type = is_object($val) ? get_class($val) : gettype($val);
        echo "    Propiedad: $" . $p->getName() . " (" . $type . ")\n";
    }

    echo "\n3. Probando métodos disponibles en Meeting Controller...\n";
    foreach (get_class_methods($controller) as $method) {
        echo "    Método: $method\n";
    }
} catch (\Throwable $e) {
    echo "  ❌ Error: " . $e->getMessage() . "\n";
}
PHP_EOF
