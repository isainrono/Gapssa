#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== 1. Detalle de la última revisión en Postgres (gapssa_booking) ==="
REV_INFO=$(docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_booking -t -A -c "
SELECT 
    r.id,
    r.booking_request_id,
    r.conflict_type,
    r.candidate_contact_ids,
    r.status,
    r.created_at
FROM booking_review_records r
ORDER BY r.created_at DESC
LIMIT 1;
")

if [ -z "$REV_INFO" ]; then
    echo "No hay revisiones en la base de datos."
    exit 0
fi

echo "Registro de revisión encontrado:"
echo "$REV_INFO"
echo ""

CANDIDATES=$(docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_booking -t -A -c "
SELECT r.candidate_contact_ids::text
FROM booking_review_records r
ORDER BY r.created_at DESC
LIMIT 1;
")

echo "Candidate Contact IDs (JSON): $CANDIDATES"
echo ""

echo "=== 2. Buscando los contactos en conflicto en EspoCRM real ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T -e CANDIDATES_JSON="$CANDIDATES" espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$em = $app->getContainer()->get("entityManager");

$json = getenv('CANDIDATES_JSON');
$candidateIds = json_decode($json, true) ?: [];

echo "IDs a consultar: " . implode(", ", $candidateIds) . "\n\n";

foreach ($candidateIds as $cid) {
    $contact = $em->getEntity("Contact", $cid);
    if ($contact) {
        echo "✔ CONTACTO ENCONTRADO:\n";
        echo "   ID:       " . $contact->getId() . "\n";
        echo "   Nombre:   " . $contact->get("name") . "\n";
        echo "   Email:    " . $contact->getEmailAddress() . "\n";
        echo "   Teléfono: " . $contact->getPhoneNumber() . "\n";
    } else {
        echo "✖ Contacto con ID $cid no encontrado en EspoCRM.\n";
    }
    echo "--------------------------------------------------\n";
}
PHP_EOF

echo ""
echo "=== Diagnóstico de conflicto completado ==="
