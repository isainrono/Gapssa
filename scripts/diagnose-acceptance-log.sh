#!/usr/bin/env bash

set -u
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

echo "=========================================================="
echo "=== 1. ÚLTIMO ERROR REGISTRADO EN data/logs/espo-*.log ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm sh -c '
latest_log=$(ls -t /var/www/html/data/logs/espo-*.log 2>/dev/null | head -n1)
if [ -n "$latest_log" ]; then
    echo "Log: $latest_log"
    grep -E '(\[2026-09-28 14:4[5-9]|\[2026-09-28 14:5|ERROR|CRITICAL)' "$latest_log" | tail -n 30
fi
'

echo -e "\n=========================================================="
echo "=== 2. ÚLTIMOS ERRORES DE APACHE / DOCKER (últimos 10 min) ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml logs --since 10m espocrm | grep -E '(error|Fatal|Exception|500|POST)' | tail -n 30

echo -e "\n=========================================================="
echo "=== 3. CÓDIGO FUENTE DE Meeting::postActionSetAcceptanceStatus EN ESPOCRM ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
$ref = new \ReflectionClass(\Espo\Modules\Crm\Controllers\Meeting::class);
$file = file($ref->getFileName());
echo "Archivo: " . $ref->getFileName() . "\n";
foreach ($ref->getMethods() as $m) {
    if (stripos($m->getName(), 'acceptance') !== false) {
        $start = $m->getStartLine();
        $end = $m->getEndLine();
        echo "Método: " . $m->getName() . " (líneas $start a $end)\n";
        for ($i = max(0, $start - 1); $i < min(count($file), $end); $i++) {
            echo ($i + 1) . ": " . $file[$i];
        }
    }
}
PHP_EOF
