#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
$file = file("/var/www/html/application/Espo/Tools/Email/Api/PostSendTest.php");
foreach ($file as $i => $line) {
    echo ($i + 1) . ": " . $line;
}
PHP_EOF
