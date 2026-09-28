#!/usr/bin/env bash

set -u
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
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
    echo "  ✔ Meeting Controller creado con éxito via InjectableFactory!\n";
    $ref = new ReflectionClass($controller);
    foreach ($ref->getProperties() as $p) {
        echo "    Propiedad: " . $p->getName() . "\n";
    }
} catch (\Throwable $e) {
    echo "  ❌ Error: " . $e->getMessage() . "\n";
}

echo "\n3. Probando métodos disponibles en Meeting Controller...\n";
foreach (get_class_methods($controller) as $method) {
    if (stripos($method, 'entity') !== false || stripos($method, 'container') !== false || stripos($method, 'log') !== false || stripos($method, 'record') !== false) {
        echo "    Método: $method\n";
    }
}
PHP_EOF
