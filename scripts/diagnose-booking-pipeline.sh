#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=========================================================="
echo "    DIAGNÓSTICO DEL PIPELINE DE RESERVAS (WEB -> CRM)     "
echo "=========================================================="
echo ""

echo "=== 1. Variables de entorno relevantes en .env.production ==="
if [ -f .env.production ]; then
    echo "ESPO_BOOKING_ADAPTER: $(grep -E '^ESPO_BOOKING_ADAPTER=' .env.production || echo 'NO CONFIGURADO (por defecto: simulated)')"
    echo "ESPOCRM_API_BASE_URL: $(grep -E '^ESPOCRM_API_BASE_URL=' .env.production || echo 'NO CONFIGURADO')"
    echo "ESPOCRM_PROFESSIONAL_USER_IDS: $(grep -E '^ESPOCRM_PROFESSIONAL_USER_IDS=' .env.production || echo 'NO CONFIGURADO')"
    if grep -q '^ESPOCRM_API_KEY=' .env.production; then
        echo "ESPOCRM_API_KEY: [CONFIGURADA - longitud: $(grep '^ESPOCRM_API_KEY=' .env.production | cut -d'=' -f2 | tr -d '\r\n' | wc -c) chars]"
    else
        echo "ESPOCRM_API_KEY: NO CONFIGURADA"
    fi
else
    echo "ADVERTENCIA: No se encontró .env.production en $(pwd)"
fi
echo ""

echo "=== 2. Últimas solicitudes de reserva en Postgres (gapssa_booking) ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_booking -x -c "
SELECT 
    id, 
    status, 
    meeting_id, 
    start_at, 
    verification_expires_at, 
    created_at, 
    resolution, 
    reason_code,
    otp_challenge_id
FROM booking_request_records 
ORDER BY created_at DESC 
LIMIT 3;
" || echo "Error consultando booking_request_records"
echo ""

echo "=== 3. ¿Hay revisiones pendientes de contacto (conflictos) en Postgres? ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_booking -c "
SELECT 
    id, 
    booking_request_id, 
    conflict_type, 
    status, 
    created_at 
FROM booking_review_records 
ORDER BY created_at DESC 
LIMIT 3;
" || echo "Error consultando booking_review_records"
echo ""

echo "=== 4. ¿Se están guardando en la tabla simulada sim_espo_meetings? ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_booking -c "
SELECT 
    id, 
    name, 
    status, 
    c_estado_reserva, 
    date_start, 
    created_at 
FROM sim_espo_meetings 
ORDER BY created_at DESC 
LIMIT 3;
" || echo "Error consultando sim_espo_meetings"
echo ""

echo "=== 5. Últimas citas creadas directamente en EspoCRM real (MariaDB) ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$em = $app->getContainer()->get("entityManager");

$meetings = $em->getRDBRepository("Meeting")
    ->order("createdAt", "DESC")
    ->limit(3)
    ->find();

foreach ($meetings as $m) {
    echo "ID: " . $m->getId() . " | " . $m->get("name") . " | Fecha: " . $m->get("dateStart") . " | Creado: " . $m->get("createdAt") . " | EstadoReserva: " . ($m->get("cEstadoReserva") ?: "NULL") . "\n";
}
PHP_EOF
echo ""

echo "=== 6. Logs recientes del contenedor Web (últimos eventos de reserva/verify/error) ==="
docker compose --env-file .env.production -f compose.prod.yml logs --tail 80 web | grep -Ei '(booking|verify|requests|espo|error)' || echo "No se encontraron logs recientes coincidentes en web"
echo ""

echo "=== 7. Logs de error recientes de EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm sh -c '
LOG_FILE="/var/www/html/data/logs/espo-$(date +%Y-%m-%d).log"
if [ -f "$LOG_FILE" ]; then
    echo "Últimas 25 líneas de $LOG_FILE:"
    tail -n 25 "$LOG_FILE"
else
    echo "No existe archivo de log para la fecha de hoy: $LOG_FILE"
    echo "Último log disponible:"
    ls -t /var/www/html/data/logs/espo-*.log 2>/dev/null | head -n 1 | xargs -r tail -n 25
fi
'
echo ""

echo "=== DIAGNÓSTICO FINALIZADO ==="
