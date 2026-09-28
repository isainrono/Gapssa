#!/usr/bin/env bash

cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -d display_errors=1 -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$ref = new ReflectionClass(\Espo\Core\Controllers\Record::class);
echo "Propiedades de Record:\n";
foreach ($ref->getProperties() as $p) {
    echo "  " . ($p->isProtected() ? 'protected' : ($p->isPrivate() ? 'private' : 'public')) . " $" . $p->getName() . "\n";
}
echo "\nMétodos de Record:\n";
foreach ($ref->getMethods() as $m) {
    if ($m->isProtected() || $m->isPublic()) {
        if (stripos($m->getName(), 'service') !== false || stripos($m->getName(), 'record') !== false || stripos($m->getName(), 'factory') !== false) {
            echo "  " . $m->getName() . "\n";
        }
    }
}
PHP_EOF
