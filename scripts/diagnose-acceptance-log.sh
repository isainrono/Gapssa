#!/usr/bin/env bash

set -u
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

echo "=========================================================="
echo "=== 1. ÚLTIMO ERROR REGISTRADO EN data/logs/espo-*.log ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
$files = glob('/var/www/html/data/logs/*.log');
if (empty($files)) {
    echo "No hay archivos de log.\n";
    exit;
}
usort($files, function($a, $b) { return filemtime($b) - filemtime($a); });
$latest = $files[0];
echo "Log más reciente: $latest\n";
$lines = file($latest);
$lastLines = array_slice($lines, -60);
foreach ($lastLines as $line) {
    if (stripos($line, 'error') !== false || stripos($line, 'critical') !== false || stripos($line, '14:') !== false) {
        echo $line;
    }
}
PHP_EOF

echo -e "\n=========================================================="
echo "=== 2. ÚLTIMOS ERRORES DE APACHE / DOCKER (últimos 15 min) ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml logs --since 15m espocrm 2>&1 | tail -n 40

echo -e "\n=========================================================="
echo "=== 3. CÓDIGO FUENTE DE Meeting::postActionSetAcceptanceStatus EN ESPOCRM ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
try {
    $ref = new \ReflectionClass(\Espo\Modules\Crm\Controllers\Meeting::class);
    $file = file($ref->getFileName());
    echo "Archivo base: " . $ref->getFileName() . "\n";
    foreach ($ref->getMethods() as $m) {
        if (stripos($m->getName(), 'acceptance') !== false) {
            $start = $m->getStartLine();
            $end = $m->getEndLine();
            echo "Método nativo: " . $m->getName() . " (líneas $start a $end)\n";
            for ($i = max(0, $start - 1); $i < min(count($file), $end); $i++) {
                echo ($i + 1) . ": " . $file[$i];
            }
        }
    }
} catch (\Throwable $e) {
    echo "Error inspeccionando clase: " . $e->getMessage() . "\n";
}
PHP_EOF
