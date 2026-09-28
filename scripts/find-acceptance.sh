#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
$dir = new RecursiveDirectoryIterator('/var/www/html/application');
$ite = new RecursiveIteratorIterator($dir);
$files = new RegexIterator($ite, '/\.php$/');

foreach ($files as $file) {
    $content = file_get_contents($file->getPathname());
    if (stripos($content, 'setAcceptanceStatus') !== false) {
        echo "Coincidencia en: " . $file->getPathname() . "\n";
    }
}
PHP_EOF
