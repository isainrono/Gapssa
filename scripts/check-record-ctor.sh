#!/usr/bin/env bash

cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -d display_errors=1 -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$ref = new ReflectionClass(\Espo\Core\Controllers\Record::class);
echo "Constructor de Record:\n";
$ctor = $ref->getConstructor();
if ($ctor) {
    foreach ($ctor->getParameters() as $p) {
        echo "  Param: " . $p->getName() . " (" . ($p->getType() ? $p->getType()->getName() : 'no type') . ")\n";
    }
} else {
    echo "  Sin constructor en Record\n";
}

$app = new \Espo\Core\Application();
$factory = $app->getContainer()->get('injectableFactory');
try {
    $em = $factory->create(\Espo\ORM\EntityManager::class);
    echo "✔ factory->create(EntityManager::class): OK\n";
} catch (\Throwable $e) {
    echo "❌ Error EntityManager: " . $e->getMessage() . "\n";
}
try {
    $log = $factory->create(\Espo\Core\Utils\Log::class);
    echo "✔ factory->create(Log::class): OK\n";
} catch (\Throwable $e) {
    echo "❌ Error Log: " . $e->getMessage() . "\n";
}
try {
    $sender = $factory->create(\Espo\Custom\Classes\Mail\BookingConfirmationSender::class);
    echo "✔ factory->create(BookingConfirmationSender::class): OK\n";
} catch (\Throwable $e) {
    echo "❌ Error BookingConfirmationSender: " . $e->getMessage() . "\n";
}
PHP_EOF
