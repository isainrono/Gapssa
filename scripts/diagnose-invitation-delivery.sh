#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== 1. Inspeccionar InvitationService de EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();

$ref = new \ReflectionClass(\Espo\Modules\Crm\Tools\Meeting\InvitationService::class);
echo "Archivo: " . $ref->getFileName() . "\n";
$file = file($ref->getFileName());
foreach ($file as $idx => $line) {
    if (stripos($line, 'function send') !== false || stripos($line, 'mailSender') !== false || stripos($line, 'email') !== false || stripos($line, 'from') !== false) {
        echo "  " . ($idx + 1) . ": " . trim($line) . "\n";
    }
}

echo "\n--- Código completo de InvitationService::send() ---\n";
if ($ref->hasMethod("send")) {
    $m = $ref->getMethod("send");
    $start = $m->getStartLine();
    $end = $m->getEndLine();
    for ($i = $start - 1; $i < $end; $i++) {
        echo $file[$i];
    }
}
PHP_EOF

echo -e "\n=== 2. Últimos registros en la tabla Email de EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$em = $app->getContainer()->get("entityManager");
$emails = $em->getRDBRepository("Email")->order("createdAt", "DESC")->limit(5)->find();
foreach ($emails as $email) {
    echo "ID: " . $email->getId() . "\n";
    echo "  Asunto:    " . $email->get("name") . "\n";
    echo "  De:        " . $email->get("fromString") . " (" . $email->get("from") . ")\n";
    echo "  Para:      " . $email->get("toString") . "\n";
    echo "  Estado:    " . $email->get("status") . "\n";
    echo "  Fecha:     " . $email->get("dateSent") . "\n";
    echo "  Error:     " . ($email->get("errorMessage") ?: "Ninguno") . "\n";
    echo "----------------------------------------\n";
}
PHP_EOF

echo -e "\n=== 3. Últimos logs de EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm sh -c '
log_file=$(ls -t /var/www/html/data/logs/*.log 2>/dev/null | head -n1)
if [ -n "$log_file" ]; then
    tail -n 30 "$log_file"
else
    echo "No hay archivos de log en data/logs"
fi
'

echo -e "\n=== 4. Cola de correo de Postfix en el Host VPS ==="
if command -v mailq >/dev/null 2>&1; then
    mailq | head -n 20 || true
fi

echo -e "\n=== 5. Últimos logs de Postfix en el Host VPS (/var/log/mail.log) ==="
if [ -f /var/log/mail.log ]; then
    grep -E "isainro.no@gmail.com|postfix|smtp" /var/log/mail.log | tail -n 25 || true
fi
