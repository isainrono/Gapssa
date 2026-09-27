#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

target_email="${1:-reservas@gapssa.es}"

echo "==> Verificando y diagnosticando correo saliente de EspoCRM hacia: $target_email"

smtp_host="$(grep -E '^ *SMTP_HOST *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '172.25.0.1')"
smtp_port="$(grep -E '^ *SMTP_PORT *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '587')"
smtp_user="$(grep -E '^ *SMTP_USER *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo 'reservas@gapssa.es')"
smtp_pass="$(grep -E '^ *(SMTP_PASSWORD|SMTP_PASS) *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '')"

docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- "$target_email" "$smtp_pass" "$smtp_host" "$smtp_port" "$smtp_user" << 'PHP_SCRIPT'
<?php
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$config = $c->get("config");
$crypt = $c->get("crypt");

$target = $argv[1] ?? "reservas@gapssa.es";
$envPass = $argv[2] ?? "";
$envHost = $argv[3] ?? "172.25.0.1";
$envPort = (int) ($argv[4] ?? 587);
$envUser = $argv[5] ?? "reservas@gapssa.es";

$rawPass = $config->get("smtpPassword");
$decrypted = null;
if (is_string($rawPass) && $rawPass !== "") {
    try {
        $decrypted = $crypt->decrypt($rawPass);
    } catch (\Throwable $e) {
        $decrypted = null;
    }
}

if (empty($decrypted) && !empty($envPass)) {
    echo "ℹ Contraseña no configurada o no descifrable. Aplicando configuración cifrada desde .env.production...\n";
    $configFile = "/var/www/html/data/config.php";
    $conf = require $configFile;
    $conf["smtpServer"] = $envHost;
    $conf["smtpPort"] = $envPort;
    $conf["smtpAuth"] = true;
    $conf["smtpSecurity"] = "";
    $conf["smtpUsername"] = $envUser;
    $conf["smtpPassword"] = $crypt->encrypt($envPass);
    $conf["outboundEmailFromName"] = "GAPSSA";
    $conf["outboundEmailFromAddress"] = $envUser;
    $conf["outboundEmailIsShared"] = true;
    file_put_contents($configFile, "<?php\nreturn " . var_export($conf, true) . ";\n");
    $rawPass = $conf["smtpPassword"];
    $decrypted = $crypt->decrypt($rawPass);
    echo "✔ Configuración guardada con contraseña cifrada exitosamente.\n";
}

echo "\n--- 1. Parámetros en data/config.php ---\n";
echo "Servidor SMTP: " . $config->get("smtpServer") . ":" . $config->get("smtpPort") . "\n";
echo "Usuario SMTP:  " . $config->get("smtpUsername") . "\n";
echo "Seguridad:     " . ($config->get("smtpSecurity") ?: "STARTTLS / Default") . "\n";
echo "Autenticación: " . ($config->get("smtpAuth") ? "Sí" : "No") . "\n";
echo "Remitente:     " . $config->get("outboundEmailFromName") . " <" . $config->get("outboundEmailFromAddress") . ">\n";
echo "Estado Password: " . (!empty($decrypted) ? "✔ Correctamente cifrado y descifrable" : "❌ No configurada o vacía") . "\n";

echo "\n--- 2. Diagnóstico de AccountProvider en EspoCRM ---\n";
try {
    $sender = $c->get("mailSender");
    $refSender = new \ReflectionClass($sender);
    echo "Clase MailSender: " . get_class($sender) . "\n";
    if ($refSender->hasProperty("accountProvider")) {
        $prop = $refSender->getProperty("accountProvider");
        $prop->setAccessible(true);
        $ap = $prop->getValue($sender);
        echo "Clase AccountProvider: " . get_class($ap) . "\n";
        $refAp = new \ReflectionClass($ap);
        echo "Archivo AccountProvider: " . $refAp->getFileName() . "\n";
        if ($refAp->hasMethod("loadSystem")) {
            $m = $refAp->getMethod("loadSystem");
            $start = $m->getStartLine();
            $end = $m->getEndLine();
            $file = file($refAp->getFileName());
            echo "Código de loadSystem() (líneas $start-$end):\n";
            for ($i = max(0, $start - 1); $i < min(count($file), $end); $i++) {
                echo "  " . ($i + 1) . ": " . $file[$i];
            }
        }
        echo "Contenido relevante de SendingAccountProvider:\n";
        $file = file($refAp->getFileName());
        foreach ($file as $idx => $line) {
            if (stripos($line, 'system') !== false || stripos($line, 'smtp') !== false) {
                echo "  " . ($idx + 1) . ": " . $line;
            }
        }
    }
} catch (\Throwable $e) {
    echo "Aviso inspeccionando AccountProvider: " . $e->getMessage() . "\n";
}

echo "\n--- 2a. Inspección y Configuración de InboundEmail del sistema ---\n";
try {
    $em = $c->get("entityManager");
    
    // Verificamos qué devuelve configDataProvider
    if (isset($ap) && isset($refAp) && $refAp->hasProperty("configDataProvider")) {
        $cdpProp = $refAp->getProperty("configDataProvider");
        $cdpProp->setAccessible(true);
        $cdp = $cdpProp->getValue($ap);
        echo "System Outbound Address devuelto por ConfigDataProvider: " . var_export($cdp->getSystemOutboundAddress(), true) . "\n";
    }

    // Establecer el servicio user en el contenedor para evitar 'Could not load user service'
    $systemUser = $em->getEntity('User', 'system') ?? $em->getEntity('User', '1');
    if ($systemUser) {
        if (method_exists($c, 'setUser')) {
            $c->setUser($systemUser);
        }
        if (method_exists($c, 'set')) {
            $c->set('user', $systemUser);
        }
    }

    $inboundRepo = $em->getRDBRepository("InboundEmail");
    $existingList = $inboundRepo->find();
    echo "Total cuentas InboundEmail existentes: " . count($existingList) . "\n";
    foreach ($existingList as $ie) {
        echo "  - ID: " . $ie->getId() . " | Nombre: " . $ie->get('name') . " | Email: " . $ie->get('emailAddress') . " | Status: " . $ie->get('status') . " | useSmtp: " . var_export($ie->get('useSmtp'), true) . " | smtpHost: " . $ie->get('smtpHost') . "\n";
    }

    // Buscamos si existe ya la cuenta para $envUser
    $account = $inboundRepo->where(['emailAddress' => $envUser])->findOne();
    if (!$account) {
        $account = $em->getNewEntity("InboundEmail");
    }

    $encryptedPassword = $crypt->encrypt($envPass);

    $account->set([
        "name" => "GAPSSA",
        "status" => "Active",
        "emailAddress" => $envUser,
        "fromName" => "GAPSSA",
        "replyToAddress" => $envUser,
        "replyToName" => "GAPSSA",
        "useSmtp" => true,
        "smtpHost" => $envHost,
        "smtpPort" => $envPort,
        "smtpAuth" => true,
        "smtpSecurity" => "",
        "smtpUsername" => $envUser,
        "smtpPassword" => $encryptedPassword,
        "smtpIsShared" => true,
        "isShared" => true,
    ]);

    try {
        $em->saveEntity($account);
        echo "✔ Cuenta InboundEmail guardada mediante EntityManager (ID: " . $account->getId() . ")\n";
    } catch (\Throwable $e) {
        echo "⚠ Falló saveEntity (" . $e->getMessage() . "), aplicando directamente vía base de datos...\n";
        $pdo = $c->has('pdo') ? $c->get('pdo') : ($c->has('defaultEntityManager') ? $c->get('defaultEntityManager')->getPDO() : null);
        if ($pdo) {
            $checkStmt = $pdo->prepare("SELECT id FROM inbound_email WHERE LOWER(email_address) = LOWER(?) LIMIT 1");
            $checkStmt->execute([$envUser]);
            $existingId = $checkStmt->fetchColumn();
            if ($existingId) {
                $updStmt = $pdo->prepare("UPDATE inbound_email SET status = 'Active', use_smtp = 1, smtp_host = ?, smtp_port = ?, smtp_auth = 1, smtp_security = '', smtp_username = ?, smtp_password = ?, smtp_is_shared = 1, from_name = 'GAPSSA', reply_to_address = ?, reply_to_name = 'GAPSSA' WHERE id = ?");
                $updStmt->execute([$envHost, $envPort, $envUser, $encryptedPassword, $envUser, $existingId]);
                echo "✔ Cuenta InboundEmail actualizada vía SQL (ID: $existingId)\n";
            } else {
                $newId = bin2hex(random_bytes(8)) . 'a';
                $insStmt = $pdo->prepare("INSERT INTO inbound_email (id, name, status, email_address, from_name, reply_to_address, reply_to_name, use_smtp, smtp_host, smtp_port, smtp_auth, smtp_security, smtp_username, smtp_password, smtp_is_shared, deleted) VALUES (?, 'GAPSSA', 'Active', ?, 'GAPSSA', ?, 'GAPSSA', 1, ?, ?, 1, '', ?, ?, 1, 0)");
                $insStmt->execute([$newId, $envUser, $envUser, $envHost, $envPort, $envUser, $encryptedPassword]);
                echo "✔ Cuenta InboundEmail insertada vía SQL (ID: $newId)\n";
            }
        }
    }

    // Desactivar cuentas con credenciales obsoletas para que el cron no de errores
    try {
        $pdo = $c->has('pdo') ? $c->get('pdo') : null;
        if ($pdo) {
            $pdo->exec("UPDATE inbound_email SET status = 'Inactive' WHERE id IN ('6a70ed04a0fdd2f68', '6a71de063d0f9f1c5')");
            echo "ℹ Cuentas obsoletas desactivadas en BD.\n";
        }
    } catch (\Throwable $e) {
        // Ignorar
    }

    // Comprobamos ahora getSystem() recreando el provider
    if (isset($refSender) && $refSender->hasProperty("accountProvider")) {
        // Obtenemos una nueva instancia limpia de SendingAccountProvider
        $cleanAp = $c->has("injectableFactory") 
            ? $c->get("injectableFactory")->create(\Espo\Core\Mail\Account\SendingAccountProvider::class)
            : $ap;
        $systemAccount = $cleanAp->getSystem();
        if ($systemAccount) {
            echo "✔ ¡AccountProvider::getSystem() cargó exitosamente la cuenta del sistema!\n";
            echo "  Nombre de cuenta: " . $systemAccount->getName() . "\n";
            echo "  Email saliente:   " . $systemAccount->getFromAddress() . "\n";
        } else {
            echo "❌ AccountProvider::getSystem() sigue devolviendo NULL.\n";
        }
    }

} catch (\Throwable $e) {
    echo "Aviso configurando InboundEmail: " . $e->getMessage() . "\n";
}

echo "\n--- 2b. Prueba de envío directo con MailSender de EspoCRM ---\n";
try {
    $mailSender = $c->get("mailSender");
    $email = $c->get("entityManager")->getNewEntity("Email");
    $email->set([
        "to" => $target,
        "from" => $config->get("outboundEmailFromAddress") ?: "reservas@gapssa.es",
        "subject" => "Prueba de correo saliente EspoCRM - GAPSSA",
        "body" => "Este es un correo de prueba enviado desde EspoCRM para verificar el servicio SMTP.",
        "isHtml" => false,
    ]);
    $mailSender->send($email);
    echo "✔ ¡ÉXITO TOTAL! Correo de prueba enviado satisfactoriamente a $target.\n";
} catch (\Throwable $e) {
    echo "❌ ERROR al enviar correo: " . $e->getMessage() . "\n";
    echo "Clase de excepción: " . get_class($e) . "\n";
    if (method_exists($e, 'getTraceAsString')) {
        echo "Traza:\n" . $e->getTraceAsString() . "\n";
    }
}

echo "\n--- 3. Verificación de logs en EspoCRM ---\n";
$logFiles = glob("/var/www/html/data/logs/*.log");
if (!empty($logFiles)) {
    $latestLog = end($logFiles);
    echo "Último archivo de log: $latestLog\n";
    system("grep -iE \"(mail|smtp|invitation|exception|error)\" " . escapeshellarg($latestLog) . " | tail -n 10 || true");
} else {
    echo "ℹ No se han generado archivos de log en /var/www/html/data/logs/ (no hay errores registrados en disco).\n";
}
PHP_SCRIPT

docker compose --env-file .env.production -f compose.prod.yml exec espocrm chown -R www-data:www-data /var/www/html/data
