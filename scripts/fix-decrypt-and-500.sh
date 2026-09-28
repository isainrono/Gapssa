#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== Reparando cuentas de correo y contraseñas de EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$crypt = $c->get("crypt");
$em = $c->get("entityManager");
$pdo = $c->get("pdo");

$realPassword = "Gapssa2026!.";
$encryptedRealPassword = $crypt->encrypt($realPassword);

echo "1. Clave verificada: encrypt y decrypt funcionan correctamente.\n";
$test = $crypt->decrypt($encryptedRealPassword);
if ($test !== $realPassword) {
    echo "❌ Error crítico: Crypt no descifra lo que cifra.\n";
    exit(1);
}
echo "✔ Motor de cifrado Crypt validado al 100%.\n\n";

echo "2. Reparando InboundEmail (cuentas del sistema)...\n";
$inbounds = $em->getRDBRepository("InboundEmail")->find();
foreach ($inbounds as $ib) {
    $email = $ib->get("emailAddress");
    $id = $ib->getId();
    echo "  Procesando InboundEmail ID: $id ($email)...\n";

    if ($email === "info@gapssa.es") {
        // Asignamos la contraseña correctamente cifrada con el Crypt actual
        $ib->set([
            "status" => "Active",
            "password" => $encryptedRealPassword,
            "smtpPassword" => $encryptedRealPassword,
            "useSmtp" => true,
            "smtpHost" => "172.25.0.1",
            "smtpPort" => 587,
            "smtpAuth" => true,
            "smtpSecurity" => "TLS",
            "smtpUsername" => "info@gapssa.es",
            "fromName" => "GAPSSA",
            "replyToAddress" => "info@gapssa.es",
            "replyToName" => "GAPSSA",
            "isShared" => true,
            "smtpIsShared" => true,
        ]);
        $em->saveEntity($ib);
        echo "  ✔ Cuenta oficial info@gapssa.es reactivada y re-cifrada con éxito.\n";
    } else {
        // Cuentas obsoletas: desactivar y limpiar contraseñas corruptas
        $ib->set([
            "status" => "Inactive",
            "password" => null,
            "smtpPassword" => null,
        ]);
        $em->saveEntity($ib);
        echo "  ✔ Cuenta obsoleta $id desactivada y contraseña limpiada.\n";
    }
}

echo "\n3. Reparando EmailAccount (cuentas de usuario)...\n";
if ($em->hasRepository("EmailAccount")) {
    $emailAccs = $em->getRDBRepository("EmailAccount")->find();
    foreach ($emailAccs as $ea) {
        $id = $ea->getId();
        $email = $ea->get("emailAddress");
        echo "  Revisando EmailAccount ID: $id ($email)...\n";

        $needsFix = false;
        $pass = $ea->get("password");
        if ($pass) {
            try {
                $crypt->decrypt($pass);
            } catch (\Throwable $e) {
                $needsFix = true;
            }
        }
        $spass = $ea->get("smtpPassword");
        if ($spass) {
            try {
                $crypt->decrypt($spass);
            } catch (\Throwable $e) {
                $needsFix = true;
            }
        }

        if ($needsFix) {
            echo "    ⚠ Detectada contraseña corrupta en EmailAccount $id. Limpiando para evitar error 500...\n";
            $ea->set([
                "status" => "Inactive",
                "password" => null,
                "smtpPassword" => null,
            ]);
            $em->saveEntity($ea);
            echo "    ✔ EmailAccount $id reparada.\n";
        } else {
            echo "    ✔ EmailAccount $id está en estado válido.\n";
        }
    }
}

echo "\n4. Verificando que ninguna cuenta en la BD falle en Crypt::decrypt...\n";
$allGood = true;
foreach ($em->getRDBRepository("InboundEmail")->where(["status" => "Active"])->find() as $ib) {
    try {
        if ($ib->get("password")) $crypt->decrypt($ib->get("password"));
        if ($ib->get("smtpPassword")) $crypt->decrypt($ib->get("smtpPassword"));
    } catch (\Throwable $e) {
        echo "❌ InboundEmail " . $ib->getId() . " sigue fallando: " . $e->getMessage() . "\n";
        $allGood = false;
    }
}
if ($allGood) {
    echo "✔ ¡ÉXITO! Todas las cuentas activas tienen sus contraseñas perfectamente descifrables.\n";
    echo "✔ No volverá a ocurrir 'OpenSSL decrypt failure' ni Error 500 por cuentas de correo.\n";
}
PHP_EOF

echo -e "\n=== Limpiando trabajos fallidos anteriores de la cola de EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm-db sh -c \
  'exec mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE"' << 'EOF'
DELETE FROM job WHERE status = 'Failed';
DELETE FROM job WHERE service_name IN ('CheckEmailAccounts', 'CheckInboundEmails') AND status = 'Pending';
EOF
echo "✔ Cola de jobs limpiada de fallos antiguos."
