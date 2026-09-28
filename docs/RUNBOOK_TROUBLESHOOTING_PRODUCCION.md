# Runbook de Producción y Guía Definitiva de Troubleshooting
## GAPSSA — Web (Next.js BFF) ↔ EspoCRM ↔ Correo Corporativo (Plesk)

> **Propósito del documento**:  
> Esta guía recopila todos los incidentes críticos, fallos y comportamientos detectados en el entorno de producción de GAPSSA, detallando para cada uno su síntoma, causa raíz bajo el capó, solución técnica implementada y la regla estricta de prevención para evitar que desarrolladores o agentes de IA repitan los mismos errores en el futuro.

---

## Índice de Fichas de Incidentes

1. [Ficha 1: Entregabilidad y Autenticación de Correo (SPF / DKIM / DMARC)](#ficha-1-entregabilidad-y-autenticacion-de-correo-spf--dkim--dmarc)
2. [Ficha 2: STARTTLS y Certificados SSL en Puerto 587 (`certificate verify failed`)](#ficha-2-starttls-y-certificados-ssl-en-puerto-587-certificate-verify-failed)
3. [Ficha 3: Error 500 General por Descifrado OpenSSL (`OpenSSL decrypt failure`)](#ficha-3-error-500-general-por-descifrado-openssl-openssl-decrypt-failure)
4. [Ficha 4: Compatibilidad Estricta de Firmas en PHP 8 (`Declaration must be compatible`)](#ficha-4-compatibilidad-estricta-de-firmas-en-php-8-declaration-must-be-compatible)
5. [Ficha 5: Arquitectura de Controladores en EspoCRM (`Call to undefined method getLog`)](#ficha-5-arquitectura-de-controladores-en-espocrm-call-to-undefined-method-getlog)
6. [Ficha 6: Fuga de Sintaxis Handlebars en Correos (`{{#if isAllDay}}` visible)](#ficha-6-fuga-de-sintaxis-handlebars-en-correos-if-isallday-visible)
7. [Ficha 7: Bloqueo de Terminal al Leer Logs de Apache en Docker](#ficha-7-bloqueo-de-terminal-al-leer-logs-de-apache-en-docker)

---

## Ficha 1: Entregabilidad y Autenticación de Correo (SPF / DKIM / DMARC)

### 1. Síntoma
- Gmail o servidores externos rechazan los correos salientes del CRM y la web con el código:  
  `550-5.7.26 This mail has been blocked because sender does not meet current authentication requirements. Gmail requires senders to authenticate with either SPF or DKIM.`
- O en los encabezados del correo se observa `Received-SPF: permerror` o `softfail`.

### 2. Causa Raíz
1. **SPF con `include` roto**: El dominio `gapssa.es` en Arsys incluía `include:spf.servidoresdns.net`, el cual no resolvía o excedía los límites de lookup de DNS.
2. **Falta de DKIM**: Plesk generaba firma DKIM, pero la clave pública RSA no estaba publicada en la zona DNS pública de Arsys.
3. **Ausencia de DMARC**: Faltaba el registro `_dmarc` obligatorio por los estándares modernos de Google y Yahoo.

### 3. Solución Técnica Aplicada
Configurar los siguientes registros DNS en el panel de **Arsys**:

| Tipo | Nombre | Valor | Explicación |
| :--- | :--- | :--- | :--- |
| **TXT** | `@` (o `gapssa.es.`) | `"v=spf1 ip4:82.223.121.69 ~all"` | Autoriza de forma limpia y directa la IP fija del VPS (sin includes externos frágiles). |
| **TXT** | `default._domainkey` | `"v=DKIM1; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyqf2yQ+Nl52gM8z...IDAQAB"` | Clave pública RSA de 2048 bits exportada desde Plesk para el selector `default`. |
| **TXT** | `_domainkey` | `"o=-"` | Declara que todos los correos del dominio deben estar firmados. |
| **TXT** | `_dmarc` | `"v=DMARC1; p=none; sp=none; rua=mailto:info@gapssa.es"` | Política DMARC para validar alineación de SPF y DKIM. |

### 4. Regla Preventiva para el Futuro
- **NUNCA** añadir includes genéricos (`include:...`) sin validar con `dig txt <include>` si el registro existe y responde.
- Para verificar entregabilidad:
  ```bash
  dig TXT gapssa.es +short
  dig TXT default._domainkey.gapssa.es +short
  ```

---

## Ficha 2: STARTTLS y Certificados SSL en Puerto 587 (`certificate verify failed`)

### 1. Síntoma
- Al intentar enviar un correo desde EspoCRM (`mailSender`) o scripts PHP, se produce una excepción fatal:
  `Unable to connect with STARTTLS: stream_socket_enable_crypto(): SSL operation failed with code 1. OpenSSL Error messages: error:0A000086:SSL routines::certificate verify failed at SocketStream.php:171`

### 2. Causa Raíz
- El contenedor Docker de EspoCRM se comunica con el servidor SMTP de Plesk (Postfix) a través de la gateway Docker `172.25.0.1:587` o del hostname `gapssa.es:587`.
- Al negociar STARTTLS sobre el puerto 587, Postfix presenta un certificado que Symfony Mailer valida de forma estricta contra el almacén de CA del contenedor Linux, fallando la verificación de peer o nombre.

### 3. Solución Técnica Aplicada
1. En `extensions/espocrm/custom/Espo/Custom/Classes/Mail/Sender/CustomTransportPreparator.php`:
   Interceptar la creación del transporte SMTP y configurar los parámetros SSL del flujo de socket:
   ```php
   if ($transport instanceof EsmtpTransport) {
       $stream = $transport->getStream();
       if ($stream instanceof SocketStream) {
           $stream->setStreamOptions([
               'ssl' => [
                   'verify_peer' => false,
                   'verify_peer_name' => false,
                   'allow_self_signed' => true,
               ],
           ]);
       }
   }
   ```
2. En `BookingConfirmationSender::ensureTlsStreamPrepared()`:
   Establecer el contexto de stream por defecto antes de despachar:
   ```php
   @stream_context_set_default([
       'ssl' => [
           'verify_peer' => false,
           'verify_peer_name' => false,
           'allow_self_signed' => true,
       ],
   ]);
   ```

### 4. Regla Preventiva para el Futuro
- En comunicaciones internas entre contenedores y el host (puerto 587 STARTTLS), **siempre** asegurar que el transporte SMTP tenga deshabilitada la verificación estricta de peer para el stream socket, o bien usar SSL directo (puerto 465) con certificado de dominio validado.

---

## Ficha 3: Error 500 General por Descifrado OpenSSL (`OpenSSL decrypt failure`)

### 1. Síntoma
- Cualquier petición a EspoCRM o la web devuelve `HTTP 500 Internal Server Error`.
- En los logs de EspoCRM aparece:
  `CRITICAL: (0) OpenSSL decrypt failure. at application/Espo/Core/Utils/Crypt.php:57`

### 2. Causa Raíz
- EspoCRM almacena las contraseñas SMTP de las cuentas (`inbound_email` y `email_account`) cifradas con AES-256 usando la clave de cifrado definida en `data/config.php` (`cryptKey`).
- Si en MariaDB existen cuentas inactivas o de prueba que se guardaron con una clave anterior, o si un script de configuración actualizó la tabla con una cadena vacía o corrupta, cualquier llamada del CRM que cargue usuarios o cuentas intenta descifrar el valor y lanza una excepción fatal que tumba la API.

### 3. Solución Técnica Aplicada
- Ejecutar el script `scripts/fix-decrypt-and-500.sh`:
  1. Verifica que el motor `Crypt` cifre y descifre correctamente con la clave activa.
  2. Re-cifra la cuenta oficial `info@gapssa.es` con la contraseña activa (`Gapssa2026!.`).
  3. Desactiva (`status = 'Inactive'`) y limpia la contraseña (`password = NULL`, `smtpPassword = NULL`) de todas las cuentas obsoletas o de prueba.
  4. Elimina de la tabla `job` los trabajos que hayan fallado en bucle.

### 4. Regla Preventiva para el Futuro
- **NUNCA** ejecutar queries directas `UPDATE inbound_email SET smtp_password = ...` sin pasar por `$crypt->encrypt(...)`.
- Si la contraseña está vacía, debe almacenarse como `NULL`, **nunca** como cadena vacía `""`.

---

## Ficha 4: Compatibilidad Estricta de Firmas en PHP 8 (`Declaration must be compatible`)

### 1. Síntoma
- Toda la API de EspoCRM y la interfaz web devuelven `500 Internal server error` / `checkLogsForDetails`.
- En los logs de Apache (`docker compose logs espocrm`):
  `PHP Fatal error: Declaration of Espo\Custom\Controllers\Meeting::postActionSetAcceptanceStatus(Request $request, Response $response): void must be compatible with Espo\Modules\Crm\Controllers\Meeting::postActionSetAcceptanceStatus(Request $request): bool in Meeting.php on line 18`

### 2. Causa Raíz
- En PHP 8+, cualquier clase hija que sobreescribe un método de la clase padre **debe coincidir exactamente** en número de argumentos, tipos de argumentos y tipo de retorno.
- La clase padre de EspoCRM (`Espo\Modules\Crm\Controllers\Meeting`) declara:  
  `public function postActionSetAcceptanceStatus(Request $request): bool`
- Nuestra clase personalizada declaraba por error `(Request $request, Response $response): void`.
- Al no coincidir, PHP detiene la compilación antes de atender cualquier petición, dejando fuera de servicio todo el CRM.

### 3. Solución Técnica Aplicada
En `extensions/espocrm/custom/Espo/Custom/Controllers/Meeting.php`:
```php
class Meeting extends BaseMeeting
{
    public function postActionSetAcceptanceStatus(Request $request): bool
    {
        $result = parent::postActionSetAcceptanceStatus($request);
        // ... lógica propia ...
        return $result;
    }
}
```

### 4. Regla Preventiva para el Futuro
- **OBLIGATORIO**: Antes de sobreescribir cualquier método en `Espo/Custom/Controllers/`, verificar la firma del método en la clase base usando Reflection PHP:
  ```php
  $ref = new ReflectionMethod(BaseClass::class, 'methodName');
  // ver getParameters() y getReturnType()
  ```

---

## Ficha 5: Arquitectura de Controladores en EspoCRM (`Call to undefined method getLog`)

### 1. Síntoma
- Al pulsar "Aceptar" en una cita dentro del CRM, salta el cartel:  
  `Internal server error Check logs for details.`
- En `data/logs/espo-YYYY-MM-DD.log`:
  `Slim Application Error: Call to undefined method Espo\Custom\Controllers\Meeting::getLog() File: Meeting.php Line: 44`

### 2. Causa Raíz
- Los controladores en EspoCRM (que extienden de `Espo\Core\Controllers\Record`) son servicios desacoplados instanciados por `InjectableFactory`.
- **NO TIENEN** métodos auxiliares mágicos como `$this->getLog()` o `$this->getEntityManager()`.
- Cuando se produjo una excepción interna y el bloque `catch` intentó llamar a `$this->getLog()`, se lanzó un error fatal no capturado que devolvió un HTTP 500 al cliente.

### 3. Solución Técnica Aplicada
1. **Uso de `InjectableFactory` nativo**: La clase base `Record` ya cuenta con `$this->injectableFactory`, con la cual se puede instanciar cualquier servicio:
   ```php
   /** @var BookingConfirmationSender $sender */
   $sender = $this->injectableFactory->create(BookingConfirmationSender::class);
   $sender->sendConfirmationById((string) $id);
   ```
2. **Encapsular la lógica en el servicio**: Añadir `sendConfirmationById(string $meetingId): bool` en `BookingConfirmationSender`, que ya tiene inyectado su propio `EntityManager`, `Config`, `MailSender` y `Log`.
3. **Manejo de errores infalible**: En el controlador, registrar cualquier excepción secundaria con el `error_log()` nativo de PHP:
   ```php
   try {
       // Envío de correo
   } catch (\Throwable $e) {
       error_log("GAPSSA Acceptance Notification: " . $e->getMessage());
   }
   return $result;
   ```

### 4. Regla Preventiva para el Futuro
- **PRINCIPIO DE RESILIENCIA**: Las notificaciones secundarias (como enviar un email de confirmación) **NUNCA** deben poder tumbar la acción principal del usuario (aceptar la cita). Siempre deben estar aisladas en un `try/catch` con `error_log()`.
- En controladores de EspoCRM, delegar toda la lógica pesada a clases de servicio instanciadas mediante `$this->injectableFactory->create(...)`.

---

## Ficha 6: Fuga de Sintaxis Handlebars en Correos (`{{#if isAllDay}}` visible)

### 1. Síntoma
- El cliente recibe el correo de confirmación pero el texto incluye fragmentos de código visible:  
  `Fecha y hora: {{#if isAllDay}}Lunes, 28 de Septiembre...{{else}}...{{/if}}`

### 2. Causa Raíz
- La plantilla HTML oficial (`invitation/es_ES/body.tpl`) contenía condicionales Handlebars.
- El sustituidor de variables simple (`str_replace('{{dateStartFull}}', ...)` no evaluaba los bloques condicionales `{{#if}}...{{else}}...{{/if}}`, dejando los delimitadores como texto plano.

### 3. Solución Técnica Aplicada
1. En `body.tpl`, se simplificó la etiqueta a `{{dateStartFull}}` directo (la fecha ya viene formateada y localizada en español desde PHP).
2. En `BookingConfirmationSender::renderHtmlTemplate()`:
   - Se añadió un evaluador con expresiones regulares para resolver bloques condicionales:
     ```php
     $template = preg_replace_callback(
         '/\{\{#if\s+([a-zA-Z0-9_]+)\}\}(.*?)(?:\{\{else\}\}(.*?))?\{\{\/if\}\}/s',
         function ($matches) use ($params) {
             $var = $matches[1];
             $ifPart = $matches[2];
             $elsePart = $matches[3] ?? '';
             return !empty($params[$var]) ? $ifPart : $elsePart;
         },
         $template
     );
     ```
   - Se añadió un paso de purga final para eliminar cualquier etiqueta residual que no haya sido reemplazada:
     ```php
     $template = preg_replace('/\{\{[#\/]?.*?\}\}/s', '', $template);
     ```

### 4. Regla Preventiva para el Futuro
- Cualquier motor de correo que utilice plantillas debe tener un paso de limpieza que garantice que ningún delimitador `{{...}}` llegue a la bandeja de entrada del usuario final.

---

## Ficha 7: Bloqueo de Terminal al Leer Logs de Apache en Docker

### 1. Síntoma
- Scripts de diagnóstico o comandos de terminal ejecutados en el VPS se quedan congelados indefinidamente sin terminar ni devolver el prompt.

### 2. Causa Raíz
- En la imagen oficial de EspoCRM Docker (`espocrm:10.0.3-apache-trixie`), el archivo `/var/log/apache2/error.log` no es un archivo de texto regular en disco, sino una tubería FIFO o symlink a `/proc/self/fd/2` (`stderr`).
- Ejecutar `tail -n 20 /var/log/apache2/error.log` bloquea la consola esperando el cierre del stream (EOF), el cual nunca llega.

### 3. Solución Técnica Aplicada
- Para consultar los logs de Apache y PHP de EspoCRM, consultar directamente el stream de Docker:
  ```bash
  docker compose --env-file .env.production -f compose.prod.yml logs --tail 50 espocrm
  ```
- Para consultar los logs de la aplicación EspoCRM:
  ```bash
  docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm tail -n 50 /var/www/html/data/logs/espo-$(date +%Y-%m-%d).log
  ```

### 4. Regla Preventiva para el Futuro
- **NUNCA** ejecutar `tail` sobre `/var/log/apache2/*.log` dentro de contenedores Apache basados en Docker Debian/Alpine.

---

## Resumen de Comandos de Despliegue y Validación Rápida

| Objetivo | Comando |
| :--- | :--- |
| **Diagnóstico de Error 500** | `./scripts/diagnose-crm-500.sh` |
| **Reparar Cuentas y Cifrado** | `./scripts/fix-decrypt-and-500.sh` |
| **Desplegar Correcciones a EspoCRM** | `./scripts/deploy-definitive-fix.sh` |
| **Comprobar Carga de Tratamientos** | `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8081/api/v1/CTratamiento -H "X-Api-Key: $ESPOCRM_API_KEY"` |
