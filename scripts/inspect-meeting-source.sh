#!/usr/bin/env bash

set -u
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$ref = new \ReflectionClass(\Espo\Modules\Crm\Controllers\Meeting::class);
echo "Clase: " . $ref->getName() . "\n";
echo "Archivo: " . $ref->getFileName() . "\n";
echo "Parent: " . ($ref->getParentClass() ? $ref->getParentClass()->getName() : 'none') . "\n";

$file = file($ref->getFileName());
foreach ($ref->getMethods() as $m) {
    if ($m->getDeclaringClass()->getName() === $ref->getName() || stripos($m->getName(), 'acceptance') !== false) {
        $start = $m->getStartLine();
        $end = $m->getEndLine();
        echo "\n--- Método: " . $m->getName() . " ($start - $end) ---\n";
        for ($i = max(0, $start - 1); $i < min(count($file), $end); $i++) {
            echo ($i + 1) . ": " . $file[$i];
        }
    }
}

echo "\n--- Constructor y Métodos disponibles en " . $ref->getParentClass()->getName() . " ---\n";
$parentRef = $ref->getParentClass();
while ($parentRef) {
    echo "Parent class: " . $parentRef->getName() . "\n";
    foreach ($parentRef->getMethods() as $pm) {
        if ($pm->isPublic() && (stripos($pm->getName(), 'container') !== false || stripos($pm->getName(), 'log') !== false || stripos($pm->getName(), 'entity') !== false || stripos($pm->getName(), 'service') !== false)) {
            echo "  " . $pm->getName() . "\n";
        }
    }
    $parentRef = $parentRef->getParentClass();
}
PHP_EOF
