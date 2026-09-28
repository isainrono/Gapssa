#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== Localizando la comprobación de internal host en EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
$dir = new RecursiveDirectoryIterator('/var/www/html/application');
$ite = new RecursiveIteratorIterator($dir);
$files = new RegexIterator($ite, '/\.php$/');

foreach ($files as $file) {
    $content = file_get_contents($file->getPathname());
    if (stripos($content, 'Not allowed internal host') !== false || stripos($content, 'isInternal') !== false || stripos($content, 'hostCheck') !== false) {
        echo "Coincidencia en: " . $file->getPathname() . "\n";
        $lines = explode("\n", $content);
        foreach ($lines as $i => $l) {
            if (stripos($l, 'internal') !== false || stripos($l, 'host') !== false) {
                echo "  " . ($i + 1) . ": " . trim($l) . "\n";
            }
        }
    }
}
PHP_EOF
