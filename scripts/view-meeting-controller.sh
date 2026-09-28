#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
$ref = new \ReflectionClass(\Espo\Modules\Crm\Controllers\Meeting::class);
$file = file($ref->getFileName());
foreach ($ref->getMethods() as $m) {
    if (stripos($m->getName(), 'acceptance') !== false) {
        $start = $m->getStartLine();
        $end = $m->getEndLine();
        echo "Método: " . $m->getName() . " (líneas $start a $end)\n";
        for ($i = $start - 1; $i < $end; $i++) {
            echo ($i + 1) . ": " . $file[$i];
        }
    }
}
PHP_EOF
