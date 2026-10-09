#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=========================================================="
echo "    DIAGNÓSTICO DE SINCRONIZACIÓN GOOGLE CALENDAR SYNC    "
echo "=========================================================="
echo ""

echo "=== 1. Extensiones registradas en EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$em = $app->getContainer()->get("entityManager");

$extensions = $em->getRDBRepository("Extension")->find();
echo "Extensiones encontradas (" . count($extensions) . "):\n";
foreach ($extensions as $ext) {
    echo "  - " . $ext->get("name") . " (Versión: " . $ext->get("version") . ", Status: " . ($ext->get("isInstalled") ? "Instalada" : "No instalada") . ")\n";
}
PHP_EOF
echo ""

echo "=== 2. Comprobando existencia de archivos del módulo GoogleCalendarSync ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm sh -c '
echo "Contenido de /var/www/html/custom/Espo/Modules:"
ls -la /var/www/html/custom/Espo/Modules 2>/dev/null || echo "No existe el directorio /var/www/html/custom/Espo/Modules"
echo ""
echo "¿Existe GcsPushSweep.php?"
ls -la /var/www/html/custom/Espo/Modules/GoogleCalendarSync/Jobs/GcsPushSweep.php 2>/dev/null || echo "NO EXISTE GcsPushSweep.php"
'
echo ""

echo "=== 3. Estado de la cuenta de Google Calendar en la base de datos (gcs_account) ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm-db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" -e "
SELECT id, name, type, status, calendar_id, last_sync_at, LEFT(COALESCE(last_error,\"\"),120) AS last_error 
FROM gcs_account 
WHERE deleted = 0;
"' || echo "Error consultando gcs_account"
echo ""

echo "=== 4. Scheduled Jobs de Google Calendar ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm-db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" -e "
SELECT id, name, job, status, scheduling, last_run 
FROM scheduled_job 
WHERE (job LIKE \"%Gcs%\" OR name LIKE \"%Google%\") AND deleted = 0;
"' || echo "Error consultando scheduled_job"
echo ""

echo "=== 5. Últimos trabajos ejecutados de Google Calendar (tabla job) ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm-db sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" -e "
SELECT id, name, status, executed_at, attempts 
FROM job 
WHERE (name LIKE \"%Gcs%\" OR class_name LIKE \"%Gcs%\") 
ORDER BY id DESC 
LIMIT 5;
"' || echo "Error consultando job"
echo ""

echo "=== 6. Configuración de Google Calendar Sync en data/config.php ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
$config = require "/var/www/html/data/config.php";
$gcsKeys = [];
foreach ($config as $k => $v) {
    if (stripos($k, 'google') !== false || stripos($k, 'gcs') !== false) {
        $gcsKeys[$k] = is_scalar($v) ? $v : gettype($v);
    }
}
echo "Claves GCS encontradas en config.php:\n";
print_r($gcsKeys);
PHP_EOF
echo ""

echo "=== DIAGNÓSTICO FINALIZADO ==="
