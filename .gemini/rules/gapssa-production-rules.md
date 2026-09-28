---
description: Reglas críticas y obligatorias de arquitectura en producción para GAPSSA (EspoCRM, PHP 8, Docker, SMTP y Next.js)
globs: **/*
---

# Reglas Obligatorias de Arquitectura y Producción GAPSSA

Cualquier agente de IA o desarrollador que opere en este repositorio DEBE seguir estas reglas estrictas para evitar regresiones o caídas en producción.

## 1. Controladores y Clases de EspoCRM (PHP 8)
- **Compatibilidad estricta de firmas**: Al extender cualquier controlador de `Espo\Modules\Crm\Controllers` o `Espo\Core\Controllers\Record`, la firma de cualquier método sobreescrito (`postAction...`, `getAction...`) DEBE coincidir exactamente con el padre (número y tipo de parámetros, y tipo de retorno).
- **Inexistencia de métodos mágicos en controladores**: Los controladores de EspoCRM NO tienen métodos como `$this->getLog()`, `$this->getEntityManager()` ni `$this->getContainer()`. Para instanciar servicios o helpers, utilizar `$this->injectableFactory->create(...)`.
- **Principio de Resiliencia en Notificaciones**: Las notificaciones secundarias (emails de confirmación, webhooks, push) NUNCA deben romper la acción principal del usuario. Deben estar siempre envueltas en `try / catch (\Throwable $e)` y registrar fallos con `error_log()` nativo de PHP.

## 2. Motor de Cifrado y Cuentas de Correo (MariaDB / Crypt)
- NUNCA ejecutar queries manuales directas de SQL que modifiquen `inbound_email.smtp_password` o `email_account.password` con texto plano o cadenas vacías `""`.
- Las contraseñas deben cifrarse siempre con `$container->get('crypt')->encrypt(...)`. Si no hay contraseña, el valor en base de datos DEBE ser `NULL`.
- Para sanear o reparar credenciales, recurrir a `scripts/fix-decrypt-and-500.sh`.

## 3. Conexiones SMTP y STARTTLS (Puerto 587)
- El tráfico SMTP saliente hacia Plesk se realiza sobre `172.25.0.1:587` o `gapssa.es:587` con STARTTLS.
- La verificación estricta de peer SSL debe mantenerse deshabilitada en el SocketStream (`allow_self_signed => true`, `verify_peer => false`) a través de `CustomTransportPreparator` para evitar excepciones `0A000086:certificate verify failed`.

## 4. Inspección de Logs en Docker
- NUNCA ejecutar `tail` sobre `/var/log/apache2/error.log` dentro de contenedores Apache de EspoCRM (es un pipe a stderr y congela la terminal).
- Usar siempre `docker compose logs --tail N espocrm` para errores de Apache/PHP, o `tail` sobre `/var/www/html/data/logs/espo-YYYY-MM-DD.log` para errores de la aplicación.

## 5. Plantillas de Correo
- Cualquier motor de renderizado de plantillas Handlebars/TPL debe incluir parser regex para condicionales `{{#if}}...{{else}}...{{/if}}` y un filtro de purga final que elimine cualquier tag `{{...}}` no sustituido antes de enviar.

Consulta la guía completa de casos y soluciones en `docs/RUNBOOK_TROUBLESHOOTING_PRODUCCION.md`.
