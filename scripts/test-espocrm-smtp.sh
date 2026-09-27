#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

target_email="${1:-reservas@gapssa.es}"

echo "==> Verificando y diagnosticando correo saliente de EspoCRM hacia: $target_email"

docker compose --env-file .env.production -f compose.prod.yml exec espocrm php -r '
require_once "/var/www/html/bootstrap.php";
$app = new \Espo\Core\Application();
$c = $app->getContainer();
$config = $c->get("config");
$crypt = $c->get("crypt");

echo "\n--- 1. Parámetros actuales en data/config.php ---\n";
echo "Servidor SMTP: " . $config->get("smtpServer") . ":" . $config->get("smtpPort") . "\n";
echo "Usuario SMTP:  " . $config->get("smtpUsername") . "\n";
echo "Seguridad:     " . ($config->get("smtpSecurity") ?: "STARTTLS / Default") . "\n";
echo "Autenticación: " . ($config->get("smtpAuth") ? "Sí" : "No") . "\n";
echo "Remitente:     " . $config->get("outboundEmailFromName") . " <" . $config->get("outboundEmailFromAddress") . ">\n";

$rawPass = $config->get("smtpPassword");
$decrypted = $crypt->decrypt($rawPass);
echo "Estado Password: " . ($decrypted ? "✔ Correctamente cifrado y descifrable" : "❌ Error al descifrar (¿estaba en texto plano?)") . "\n";

echo "\n--- 2. Prueba de envío directo con MailSender de EspoCRM ---\n";
$target = $argv[1] ?? "reservas@gapssa.es";
try {
    $mailSender = $c->get("mailSender");
    $email = $c->get("entityManager")->getNewEntity("Email");
    $email->set([
        "to" => $target,
        "subject" => "Prueba de correo saliente EspoCRM - GAPSSA",
        "body" => "Este es un correo de prueba enviado desde EspoCRM para verificar el servicio SMTP.",
        "isHtml" => false,
    ]);
    $mailSender->send($email);
    echo "✔ ¡ÉXITO! Correo de prueba enviado satisfactoriamente a $target.\n";
} catch (\Throwable $e) {
    echo "❌ ERROR al enviar correo: " . $e->getMessage() . "\n";
    echo "Clase de excepción: " . get_class($e) . "\n";
}

echo "\n--- 3. Últimos registros en el log de EspoCRM ---\n";
$logFiles = glob("/var/www/html/data/logs/*.log");
if (!empty($logFiles)) {
    $latestLog = end($logFiles);
    echo "Archivo: $latestLog\n";
    system("grep -iE \"(mail|smtp|invitation|exception|error)\" " . escapeshellarg($latestLog) . " | tail -n 15");
} else {
    echo "No hay archivos de log todavía.\n";
}
' "$target_email"
