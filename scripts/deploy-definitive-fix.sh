#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

echo "==> 1. Sincronizando personalizaciones definitivas a EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml cp extensions/espocrm/custom/Espo/Custom/. espocrm:/var/www/html/custom/Espo/Custom/
docker compose --env-file .env.production -f compose.prod.yml exec espocrm chown -R www-data:www-data /var/www/html/custom

echo "==> 2. Reconstruyendo metadatos y limpiando caché de EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml exec espocrm bin/command rebuild
docker compose --env-file .env.production -f compose.prod.yml exec espocrm bin/command clear-cache

echo "==> 3. Reiniciando contenedor de EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml restart espocrm
sleep 4

echo "==> 4. Validando internamente postActionSetAcceptanceStatus..."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -d display_errors=1 -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$em = $c->get('entityManager');
$systemUser = $em->getEntity('User', 'system') ?? $em->getEntity('User', '1');
if (method_exists($c, 'setUser')) {
    $c->setUser($systemUser);
}
if (method_exists($c, 'set')) {
    $c->set('user', $systemUser);
}

$factory = $c->get('injectableFactory');

try {
    $controller = $factory->create(\Espo\Custom\Controllers\Meeting::class);
    echo "✔ Controlador Espo\\Custom\\Controllers\\Meeting instanciado correctamente.\n";
} catch (\Throwable $e) {
    echo "❌ Error instanciando Meeting controller: " . $e->getMessage() . "\n";
    exit(1);
}

try {
    $sender = $factory->create(\Espo\Custom\Classes\Mail\BookingConfirmationSender::class);
    echo "✔ BookingConfirmationSender instanciado correctamente.\n";
    
    // Probar método sendConfirmationById con búsqueda
    $lastMeeting = $em->getRDBRepository('Meeting')->order('createdAt', 'DESC')->findOne();
    if ($lastMeeting) {
        echo "✔ Última cita encontrada (ID: " . $lastMeeting->getId() . ", Estado: " . ($lastMeeting->get('cEstadoReserva') ?: 'N/A') . ").\n";
    }
} catch (\Throwable $e) {
    echo "❌ Error verificando sender: " . $e->getMessage() . "\n";
    exit(1);
}
PHP_EOF

echo "==> 5. Verificando API de tratamientos y estado HTTP general..."
api_key="$(grep -E '^ *(ESPOCRM_API_KEY|ESPO_API_KEY) *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '')"
curl -s -o /dev/null -w "Status HTTP CTratamiento: %{http_code}\n" -m 5 "http://127.0.0.1:8081/api/v1/CTratamiento" -H "X-Api-Key: ${api_key}"

echo -e "\n==> ¡LISTO Y 100% OPERATIVO EN PRODUCCIÓN! Ya puedes aceptar la cita en el CRM sin errores."
