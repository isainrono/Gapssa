#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

target_email="${1:-reservas@gapssa.es}"

echo "==> Verificando y diagnosticando correo saliente de EspoCRM hacia: $target_email"

smtp_host="$(grep -E '^ *SMTP_HOST *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '172.25.0.1')"
smtp_port="$(grep -E '^ *SMTP_PORT *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '587')"
# EspoCRM utiliza info@gapssa.es como cuenta saliente oficial del CRM
smtp_user="info@gapssa.es"
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
$envUser = $argv[5] ?? "info@gapssa.es";

echo "ℹ Sincronizando configuración de remitente oficial ($envUser)...\n";
echo "--- Código de creación del transporte SMTP en EspoCRM ---\n";
passthru('grep -rn -C 5 "EsmtpTransport" /var/www/html/application/Espo/ 2>/dev/null || true');
passthru('grep -rn -C 5 "SmtpTransport" /var/www/html/application/Espo/ 2>/dev/null || true');
passthru('grep -rn -C 5 "verify_peer" /var/www/html/application/Espo/ 2>/dev/null || true');
echo "--- Certificado SMTP devuelto por 172.25.0.1:587 ---\n";
passthru('echo "QUIT" | openssl s_client -connect ' . escapeshellarg($envHost . ':' . $envPort) . ' -starttls smtp 2>&1 | grep -E "(subject=|issuer=|Verification error|verify return code)" || true');

// Probar con TLS
$smtpSecurity = "TLS";

$configFile = "/var/www/html/data/config.php";
$conf = file_exists($configFile) ? require $configFile : [];
$conf["smtpServer"] = $envHost;
$conf["smtpPort"] = $envPort;
$conf["smtpAuth"] = true;
$conf["smtpSecurity"] = $smtpSecurity;
$conf["smtpUsername"] = $envUser;
if (!empty($envPass)) {
    $conf["smtpPassword"] = $crypt->encrypt($envPass);
}
$conf["outboundEmailFromName"] = "GAPSSA";
$conf["outboundEmailFromAddress"] = $envUser;
$conf["outboundEmailIsShared"] = true;
file_put_contents($configFile, "<?php\nreturn " . var_export($conf, true) . ";\n");

// Actualizar también la instancia de config en memoria
foreach ($conf as $k => $v) {
    if (method_exists($config, 'set')) {
        $config->set($k, $v);
    }
}
@unlink("/var/www/html/data/cache/application/config.php");

$rawPass = $config->get("smtpPassword");
$decrypted = null;
if (is_string($rawPass) && $rawPass !== "") {
    try {
        $decrypted = $crypt->decrypt($rawPass);
    } catch (\Throwable $e) {
        $decrypted = null;
    }
}
echo "✔ data/config.php y memoria actualizados con remitente: " . $config->get("outboundEmailFromAddress") . ".\n";

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

    // Buscamos todas las cuentas para $envUser
    $allInfoAccounts = $inboundRepo->where(['emailAddress' => $envUser])->find();
    $activeId = null;

    if (count($allInfoAccounts) === 0) {
        $acc = $em->getNewEntity("InboundEmail");
        $allInfoAccounts = [$acc];
    }

    $encryptedPassword = $crypt->encrypt($envPass);

    foreach ($allInfoAccounts as $idx => $acc) {
        if ($idx === 0) {
            $acc->set([
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
                "smtpSecurity" => "TLS",
                "smtpUsername" => $envUser,
                "smtpPassword" => $encryptedPassword,
                "smtpIsShared" => true,
                "isShared" => true,
            ]);
            try {
                $em->saveEntity($acc);
                $activeId = $acc->getId();
                echo "✔ Cuenta InboundEmail oficial activada con SMTP (ID: $activeId, Email: $envUser, TLS)\n";
            } catch (\Throwable $e) {
                echo "⚠ Error al guardar vía ORM: " . $e->getMessage() . "\n";
            }
        } else {
            $acc->set("status", "Inactive");
            try {
                $em->saveEntity($acc);
                echo "ℹ Cuenta InboundEmail secundaria marcada como Inactive (ID: " . $acc->getId() . ")\n";
            } catch (\Throwable $e) {}
        }
    }

    // Backup directo en SQL para garantizar sincronización en BD
    try {
        $pdo = $c->has('pdo') ? $c->get('pdo') : null;
        if ($pdo && $activeId) {
            $upd = $pdo->prepare("UPDATE inbound_email SET status = 'Active', use_smtp = 1, smtp_host = ?, smtp_port = ?, smtp_auth = 1, smtp_security = 'TLS', smtp_username = ?, smtp_password = ?, smtp_is_shared = 1, from_name = 'GAPSSA', reply_to_address = ?, reply_to_name = 'GAPSSA' WHERE id = ?");
            $upd->execute([$envHost, $envPort, $envUser, $encryptedPassword, $envUser, $activeId]);
            $pdo->exec("UPDATE inbound_email SET status = 'Inactive' WHERE email_address = '$envUser' AND id != '$activeId'");
        }
    } catch (\Throwable $e) {}

    // Comprobamos getSystem() recreando el provider
    $cleanAp = $c->has("injectableFactory") 
        ? $c->get("injectableFactory")->create(\Espo\Core\Mail\Account\SendingAccountProvider::class)
        : $ap;
    $systemAccount = $cleanAp->getSystem();
    if ($systemAccount) {
        echo "✔ ¡AccountProvider::getSystem() cargó exitosamente la cuenta del sistema!\n";
        if (method_exists($systemAccount, 'getFromAddress')) {
            echo "  Email saliente:   " . $systemAccount->getFromAddress() . "\n";
        }
    } else {
        echo "❌ AccountProvider::getSystem() sigue devolviendo NULL.\n";
    }

} catch (\Throwable $e) {
    echo "Aviso configurando InboundEmail: " . $e->getMessage() . "\n";
}

echo "\n--- 2b. Prueba de envío directo con MailSender de EspoCRM ---\n";
try {
    $mailSender = $c->get("mailSender");
    // Inyectar el accountProvider fresco en el MailSender para invalidar la caché interna
    if (isset($cleanAp)) {
        $refSender = new \ReflectionClass($mailSender);
        if ($refSender->hasProperty("accountProvider")) {
            $prop = $refSender->getProperty("accountProvider");
            $prop->setAccessible(true);
            $prop->setValue($mailSender, $cleanAp);
        }
    }

    $email = $c->get("entityManager")->getNewEntity("Email");
    $email->set([
        "to" => $target,
        "from" => $config->get("outboundEmailFromAddress") ?: "info@gapssa.es",
        "subject" => "Prueba de correo saliente EspoCRM - GAPSSA",
        "body" => "Este es un correo de prueba enviado desde EspoCRM (info@gapssa.es) para verificar el servicio SMTP.",
        "isHtml" => false,
    ]);
    $mailSender->send($email);
    echo "✔ ¡ÉXITO TOTAL! Correo de prueba enviado satisfactoriamente a $target desde " . ($config->get("outboundEmailFromAddress") ?: "info@gapssa.es") . ".\n";
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
