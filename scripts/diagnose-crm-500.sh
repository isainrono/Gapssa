#!/usr/bin/env bash

set -u

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

echo "=========================================================="
echo "=== 1. ÚLTIMOS LOGS DE APACHE Y PHP DE ESPOCRM (stderr) ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml logs --tail 60 espocrm

echo -e "\n=========================================================="
echo "=== 2. PETICIÓN DIRECTA A /api/v1/CTratamiento CON API KEY ==="
echo "=========================================================="
api_key="$(grep -E '^ *(ESPOCRM_API_KEY|ESPO_API_KEY) *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '')"
echo "API Key encontrada: ${api_key:0:6}*** (longitud: ${#api_key})"

curl -is -m 5 "http://127.0.0.1:8081/api/v1/CTratamiento?select=id,name,activo" \
  -H "X-Api-Key: ${api_key}" | head -n 30 || echo "Falló petición curl a CTratamiento"

echo -e "\n=========================================================="
echo "=== 3. PRUEBA DE CARGA DE CONTROLADORES Y REFLECTION PHP ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -d display_errors=1 -- << 'PHP_EOF'
<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);

echo "A. Probando bootstrap de EspoCRM...\n";
try {
    require_once "/var/www/html/bootstrap.php";
    $app = new \Espo\Core\Application();
    $container = $app->getContainer();
    echo "  ✔ Bootstrap y Container inicializados correctamente.\n";
} catch (\Throwable $e) {
    echo "  ❌ ERROR en bootstrap: " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n";
    exit(1);
}

echo "\nB. Probando reflexión y carga de controladores...\n";
$controllers = [
    'CTratamiento' => '\Espo\Custom\Controllers\CTratamiento',
    'Meeting' => '\Espo\Custom\Controllers\Meeting',
];

foreach ($controllers as $name => $class) {
    try {
        if (class_exists($class)) {
            $ref = new \ReflectionClass($class);
            echo "  ✔ Clase $class cargada correctamente desde " . $ref->getFileName() . "\n";
            foreach ($ref->getMethods() as $m) {
                if (stripos($m->getName(), 'acceptance') !== false) {
                    echo "    Método " . $m->getName() . " parámetros: " . $m->getNumberOfParameters() . " retorno: " . ($m->getReturnType() ? $m->getReturnType()->getName() : 'none') . "\n";
                }
            }
        } else {
            echo "  ⚠ Clase $class no encontrada.\n";
        }
    } catch (\Throwable $e) {
        echo "  ❌ ERROR cargando $class: " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n";
    }
}

echo "\nC. Probando consulta ORM a CTratamiento...\n";
try {
    $em = $container->get('entityManager');
    $repo = $em->getRDBRepository('CTratamiento');
    $treatments = $repo->limit(5)->find();
    echo "  ✔ Consulta a CTratamiento exitosa. Total obtenidos: " . count($treatments) . "\n";
    foreach ($treatments as $t) {
        echo "    - " . $t->get('name') . " (id: " . $t->getId() . ")\n";
    }
} catch (\Throwable $e) {
    echo "  ❌ ERROR consultando CTratamiento: " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n";
}

echo "\nD. Probando autenticación con ApiKey...\n";
try {
    $keyRepo = $em->getRDBRepository('ApiKey');
    $keys = $keyRepo->where(['status' => 'Active'])->find();
    echo "  ✔ ApiKeys activas encontradas: " . count($keys) . "\n";
    foreach ($keys as $k) {
        echo "    Key ID: " . $k->getId() . " (name: " . $k->get('name') . ", userId: " . $k->get('userId') . ")\n";
    }
} catch (\Throwable $e) {
    echo "  ❌ ERROR verificando ApiKey: " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n";
}

echo "\nE. Probando motor Crypt...\n";
try {
    $crypt = $container->get('crypt');
    $enc = $crypt->encrypt('test-probe');
    $dec = $crypt->decrypt($enc);
    echo "  ✔ Crypt funciona correctamente: " . ($dec === 'test-probe' ? 'OK' : 'FAIL') . "\n";
} catch (\Throwable $e) {
    echo "  ❌ ERROR en Crypt: " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n";
}
PHP_EOF

echo -e "\n=========================================================="
echo "=== 4. ÚLTIMO REGISTRO DE ERROR EN data/logs (si existe) ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm sh -c '
latest_log=$(ls -t /var/www/html/data/logs/espo-*.log 2>/dev/null | head -n1)
if [ -n "$latest_log" ]; then
    echo "Mostrando últimas 20 líneas de: $latest_log"
    tail -n 20 "$latest_log"
fi
'
