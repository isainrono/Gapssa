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

echo "\n--- 2. Diagnóstico de código del emisor SMTP ---\n";
$cmd = 'grep -rn -C 6 "No system SMTP settings" /var/www/html/application/Espo/';
passthru($cmd);

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
