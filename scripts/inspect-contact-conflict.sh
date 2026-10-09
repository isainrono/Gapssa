#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== 1. Detalle de la revisión en booking_review_records ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_booking -x -c "
SELECT 
    r.id AS review_id,
    r.booking_request_id,
    r.conflict_type,
    r.candidate_contact_ids,
    r.candidate_meeting_ids,
    r.status AS review_status,
    r.created_at,
    b.start_at,
    b.status AS booking_status
FROM booking_review_records r
JOIN booking_request_records b ON b.id = r.booking_request_id
ORDER BY r.created_at DESC
LIMIT 1;
"

echo "=== 2. Inspeccionar los Contactos candidatos en EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$em = $app->getContainer()->get("entityManager");

// Obtenemos los candidateContactIds de la última revisión en Postgres
// Para hacerlo directamente en PHP, busquemos los últimos contactos modificados o creados
$contacts = $em->getRDBRepository("Contact")
    ->order("createdAt", "DESC")
    ->limit(10)
    ->find();

echo "Últimos contactos en EspoCRM:\n";
foreach ($contacts as $c) {
    echo "ID: " . $c->getId() . "\n";
    echo "  Nombre:   " . $c->get("name") . "\n";
    echo "  Email:    " . $c->getEmailAddress() . "\n";
    echo "  Teléfono: " . $c->getPhoneNumber() . "\n";
    echo "  Creado:   " . $c->get("createdAt") . "\n";
    echo "----------------------------------------\n";
}
PHP_EOF
