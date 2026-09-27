#!/usr/bin/env bash

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== Contenido de Espo\Modules\Crm\Tools\Meeting\Invitation\Sender.php ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
$file = file("/var/www/html/application/Espo/Modules/Crm/Tools/Meeting\Invitation/Sender.php");
foreach ($file as $idx => $line) {
    echo ($idx + 1) . ": " . $line;
}
PHP_EOF
