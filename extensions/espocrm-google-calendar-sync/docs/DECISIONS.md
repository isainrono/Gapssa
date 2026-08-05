# Decisiones de diseño — Fase 1

## Portabilidad (v1.1.0, 4/8/2026)

16. **La extensión es genérica, no específica de Gapssa** (validada). Auditado:
    sin URLs, puertos ni rutas fijas, y sin dependencia de entidades
    personalizadas (`CTratamiento`, `CZonaAtencion`). Solo requiere `Meeting`,
    nativa del módulo CRM. Cambios de esta versión:

    - Autor `Isain Rodríguez`; paquete `isainro/espocrm-google-calendar-sync`;
      descripción del manifiesto en inglés.
    - Respaldo de zona horaria `Europe/Madrid` → **`UTC`**. Se sigue leyendo
      `timeZone` de la configuración; el respaldo solo actúa si no hubiera.
    - El nombre del registro de la cuenta Business se traduce con el idioma por
      defecto de la instancia («Business Calendar» / «Calendario Business»).

17. **No se renombran el módulo `GoogleCalendarSync` ni el prefijo `Gcs`.**
    Los nombres de entidad determinan los de tabla (`gcs_account`,
    `gcs_event_link`); cambiarlos rompería las instalaciones existentes y
    obligaría a migrar datos. El prefijo ya cumple su función: evitar
    colisiones con otras extensiones.

18. **Mensajes de error bilingües, logs en inglés.** `Classes\Messages`
    traduce con `Language $defaultLanguage` —el idioma **por defecto** de la
    instancia, no el del usuario, porque parte de estos textos se guardan en el
    campo `lastError` y los lee cualquier administrador. Cada llamada lleva un
    respaldo en inglés, así que una traducción ausente nunca muestra la clave
    en crudo. Los mensajes de `data/logs/` van siempre en inglés, que es lo
    esperable en un log.

19. **La paridad de traducciones se verifica automáticamente**
    (`tests/i18n_test.php`): falla si una clave existe en un idioma y falta en
    otro, o si el PHP usa una clave de error que no está declarada en los i18n.
    Sin esto, añadir un idioma o un mensaje se degrada en silencio.

Registro de decisiones tomadas durante la implementación, con su razón.
Las tres primeras fueron validadas explícitamente por Isain el 4/8/2026.

1. **Cancelación → eliminación del evento** (validada). Al cancelar una cita
   (estado en `canceledStatusList`, hoy `Not Held`) o al borrarla, el evento se
   elimina del calendario Business. El calendario es un espejo limpio; el
   historial vive en el CRM. Si la cita se reactiva, el evento se recrea.

2. **Librería oficial `google/apiclient` ^2.18** (revisada el 4/8/2026;
   sustituye al cliente cURL propio de la primera iteración). Se usa
   `Google\Client` para OAuth y `Google\Service\Calendar` para los eventos:
   manejo de errores, reintentos y renovación de tokens los mantiene Google, no
   nosotros.

   2.1 **ZIP autónomo con el árbol completo de Composer** (revisada el
   4/8/2026). La iteración anterior vendorizaba solo cuatro paquetes y
   reutilizaba la Guzzle, Monolog, phpseclib y PSR de EspoCRM; se descartó
   porque acoplaba la extensión a lo que empaquete el CRM. Ahora
   `composer install` instala el árbol completo y el ZIP no depende de ninguna
   librería interna de EspoCRM. `tools/check-dependencies.php` lo verifica
   cargando solo el autoloader del paquete.

   2.2 **`composer.lock` versionado, `vendor/` no** (validada). El lock es el
   registro exacto de lo que se despliega y va a Git; `vendor/` se regenera con
   `make gcs-deps` y está en `.gitignore`. Evita ~1 MB de binarios en el
   monorepo y hace auditable cualquier cambio de dependencias.

   2.3 **Recorte sin intervención manual.** `extra."google/apiclient-services"`
   + el script oficial `Google\Task\Composer::cleanup` en `post-install-cmd` y
   `post-update-cmd` dejan solo el servicio Calendar (sin esto, `vendor/`
   superaría los 500 MB). Nadie borra paquetes a mano y la comprobación de
   dependencias falla si el recorte no se aplicó.

   2.4 **`autoload.json` carga `vendor/autoload.php`** en vez de enumerar
   prefijos PSR-4. La lista manual se desincroniza en cuanto cambia una
   dependencia y omite los *files* de autoload (funciones de Guzzle,
   polyfills).

   2.5 **`platform.php = 8.3.0`** en `composer.json`: el lock se resuelve para
   el PHP de la imagen oficial de EspoCRM, no para el del Mac donde se
   construye.

   2.9 **`phpseclib/phpseclib ^3` es dependencia directa** (añadida el 4/8/2026
   tras el primer `make gcs-lock` real). `google/apiclient` v2.19 lo quitó de
   sus `require` y `google/auth` solo lo sugiere, pero `AccessToken.php` y
   `ServiceAccountSignerTrait.php` referencian `phpseclib3\Crypt\RSA`,
   `PublicKeyLoader` y `Math\BigInteger`. Declararlo explícitamente evita un
   fallo en runtime en esos caminos y mantiene el ZIP autónomo. Lo detectó
   `tools/check-dependencies.php`, no una prueba manual: el verificador cumplió
   su función.

   2.6 **Se conserva `GoogleApiException`** para los errores del endpoint de
   tokens, que la librería devuelve como array (`['error' => ...]`) en vez de
   lanzar. Los errores de la API de Calendar se tratan directamente como
   `Google\Service\Exception` usando su `getCode()` HTTP.

   2.7 **El cifrado de tokens sigue siendo nuestro.** No se delega el
   almacenamiento en la librería: `TokenService` guarda access y refresh token
   cifrados con `Espo\Core\Utils\Crypt` y solo usa `Google\Client` para
   renovarlos.

   2.8 **La construcción verifica antes de entregar.** `build.sh` aborta si
   falta el lock o el `vendor/`, comprueba las dependencias del módulo,
   empaqueta, **extrae el ZIP** y repite la comprobación más el autoload, el
   mapper y `php -l` sobre el contenido final. Un ZIP que no pasa esos filtros
   no se produce.

3. **Módulo + build propio en el monorepo** (validada). Sin `ext-template`
   (instancia de desarrollo propia, npm, transpilado): estructura
   `manifest.json + files/ + scripts/` y `build.sh`. Las vistas JS usan AMD
   `define()`, que el loader de EspoCRM 10 resuelve sin transpilar.

4. **Estados cancelados leídos de metadata**. `EventMapper` lee
   `scopes/Meeting/canceledStatusList` en tiempo real: si mañana se añade un
   estado "Cancelada" personalizado, la extensión lo respeta sin cambios.

5. **El hook nunca llama a Google**. `afterSave`/`afterRemove` solo encolan un
   job (grupo `gcs-push`, ejecución serializada). Un fallo de red jamás impide
   guardar una cita. Respeta las opciones `silent` y `gcsSync` (esta última,
   preparada para el pull de la fase 2).

6. **Barrido cada 5 minutos como red de reintentos** (`GcsPushSweep`). Los
   jobs fallidos de EspoCRM no se reintentan solos; el barrido detecta citas
   con push pendiente (sin vínculo, o vínculo más antiguo que `modifiedAt`) y
   los reintenta. Ventana: citas modificadas en los últimos 14 días, máx. 100
   por pasada.

7. **Anti-duplicados en dos capas**. (a) `GcsEventLink` con índice único
   `meeting+account`; (b) antes de insertar sin vínculo, se busca en Google por
   `privateExtendedProperty espoMeetingId` y se adopta el evento si ya existe.
   Un reintento tras un fallo a mitad de operación nunca duplica.

8. **No se exporta el histórico**. Solo se sincronizan citas creadas o
   modificadas después de conectar la cuenta Business (`gcsSyncStartAt`).
   Exportación retroactiva masiva: fuera de alcance, se haría bajo demanda.

9. **Tokens cifrados y bloqueados**. `Crypt` de EspoCRM para el cifrado en BD;
   `entityAcl.fields.forbidden` para que la API nunca los devuelva;
   `gcsClientSecret` con nivel de config `internal` (solo escritura). Ningún
   log contiene tokens.

10. **Cuenta Business única, creada al instalar**. `AfterInstall` crea el
    registro `Calendario Business` (idempotente); un hook `beforeSave` impide
    crear una segunda cuenta Business.

11. **Scopes mínimos**: `calendar.events` + `calendar.calendarlist.readonly`.
    No se pide el scope completo `calendar`.

12. **Sin cambios en Meeting salvo un link inverso**. Ningún campo de Google en
    `Meeting`; solo el link `gcsEventLinks` (merge de metadata). Los record
    hooks de invitaciones existentes (`recordDefs` en Custom) usan un mecanismo
    distinto al hook de repositorio de la extensión: no hay colisión, y el
    generador ICS y el envío de invitaciones no se tocan.

13. **Zona horaria desde la config** (`timeZone`, hoy `Europe/Madrid`), con
    `Europe/Madrid` como respaldo. Los datetimes UTC de EspoCRM se convierten
    a RFC3339 con la zona en el payload.

14. **Actualizaciones sin `If-Match`**. El calendario Business es solo espejo
    de salida: EspoCRM siempre tiene la última palabra (last-write-wins). El
    `etag` se guarda en el vínculo para la fase 2, donde sí habrá resolución
    de conflictos.

15. **Desinstalación no destructiva**. Ver `UNINSTALL.md`.

## Diferencias respecto al documento de diseño

- El diseño proponía `google/apiclient` y advertía de su peso; se usa la
  librería oficial pero con vendor recortado al servicio Calendar y sin
  duplicar lo que EspoCRM ya trae (decisión 2).
- El diseño proponía `If-Match`/412; pospuesto a fase 2 (decisión 14).
- El diseño usaba `type: User` por defecto en `GcsAccount`; en fase 1 el
  default es `Business` (no hay cuentas User todavía).
- Se añadió `GcsPushSweep`, no presente en el diseño, para cumplir los casos
  11–13 de las pruebas de aceptación (reintentos sin duplicados).
- Firmas verificadas contra EspoCRM 10.0.3 real: `AfterSave/BeforeSave/AfterRemove`
  con `SaveOptions`/`RemoveOptions` tipados, `Job\Data`, `JobDataLess`,
  `ResponseComposer::json`, `Crypt::encrypt/decrypt`, `ConfigWriter::set/save`,
  scheduled jobs vía `app/scheduledJobs.json` con `isDefault` + `scheduling`.
- El diseño escribía el prefijo `Google\Service\` en `autoload.json` apuntando a
  `apiclient-services`; funciona, pero solo porque el `ClassLoader` de Composer
  retrocede al prefijo `Google\` cuando el archivo no existe (así se resuelven
  `Google\Service\Exception` y `Google\Service\Resource`). Verificado con una
  prueba de autoload, no asumido.
- `Espo\Core\Utils\Log` implementa `Psr\Log\LoggerInterface`, así que se inyecta
  directamente en `Google\Client::setLogger` y la librería no crea su propio
  Monolog.
