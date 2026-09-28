#!/usr/bin/env bash

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== 1. Buscar peticiones HTTP con Error 500 en Apache ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm sh -c '
grep " 500 " /var/log/apache2/access.log 2>/dev/null | tail -n 20 || echo "No hay 500 en access.log"
'

echo -e "\n=== 2. Analizar por qué falla Crypt::decrypt en las cuentas ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$crypt = $c->get("crypt");
$em = $c->get("entityManager");

echo "--- Cuentas en inbound_email ---\n";
$inbounds = $em->getRDBRepository("InboundEmail")->find();
foreach ($inbounds as $ib) {
    echo "ID: " . $ib->getId() . " | Nombre: " . $ib->get("name") . " | Status: " . $ib->get("status") . " | Email: " . $ib->get("emailAddress") . "\n";
    
    // Probar password
    $pass = $ib->get("password");
    if ($pass) {
        try {
            $dec = $crypt->decrypt($pass);
            echo "  password: ✔ OK\n";
        } catch (\Throwable $e) {
            echo "  password: ❌ Fallo decrypt (" . $e->getMessage() . ")\n";
        }
    } else {
        echo "  password: vacío\n";
    }

    // Probar smtpPassword
    $spass = $ib->get("smtpPassword");
    if ($spass) {
        try {
            $dec = $crypt->decrypt($spass);
            echo "  smtpPassword: ✔ OK\n";
        } catch (\Throwable $e) {
            echo "  smtpPassword: ❌ Fallo decrypt (" . $e->getMessage() . ")\n";
        }
    } else {
        echo "  smtpPassword: vacío\n";
    }
}

echo "\n--- Cuentas en email_account (cuentas personales) ---\n";
if ($em->hasRepository("EmailAccount")) {
    $emailAccs = $em->getRDBRepository("EmailAccount")->find();
    foreach ($emailAccs as $ea) {
        echo "ID: " . $ea->getId() . " | Nombre: " . $ea->get("name") . " | Status: " . $ea->get("status") . " | Email: " . $ea->get("emailAddress") . "\n";
        $pass = $ea->get("password");
        if ($pass) {
            try {
                $dec = $crypt->decrypt($pass);
                echo "  password: ✔ OK\n";
            } catch (\Throwable $e) {
                echo "  password: ❌ Fallo decrypt (" . $e->getMessage() . ")\n";
            }
        }
        $spass = $ea->get("smtpPassword");
        if ($spass) {
            try {
                $dec = $crypt->decrypt($spass);
                echo "  smtpPassword: ✔ OK\n";
            } catch (\Throwable $e) {
                echo "  smtpPassword: ❌ Fallo decrypt (" . $e->getMessage() . ")\n";
            }
        }
    }
}
PHP_EOF
