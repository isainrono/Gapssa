# Decisiones de diseño — Fase 1

## Título con el cliente (v1.1.1, 4/8/2026)

20. **El nombre del cliente se toma de la relación `contacts`**, la misma que
    EspoCRM usa para las invitaciones por correo, nunca de `parent`. Formato:
    `Asunto (Nombre)`, o `Asunto (Nombre1, Nombre2)` con varios.

21. **Los cambios de contactos se detectan con `AfterRelate`/`AfterUnrelate`**,
    no con `afterSave`. Verificado en el código de 10.0.3:
    `Espo\Core\FieldProcessing\Relation\LinkMultipleSaver::process()` guarda
    los campos linkMultiple llamando a `relateById()`/`unrelateById()` del
    repositorio, que pasan por `HookMediator` y disparan esos hooks. El
    `afterSave` se ejecuta **antes** y no vería el cambio; además `contactsIds`
    no es un atributo persistente normal.

22. **`silent` NO se ignora en los cambios de relación** (corregido antes de
    construir la 1.1.1). `LinkMultipleSaver` relaciona los contactos de una cita
    nueva con `SaveOption::SILENT`. La primera versión se lo saltaba, razonando
    que el `afterSave` ya había encolado la exportación; eso abría una carrera
    real:

    1. `afterSave` encola el UPSERT.
    2. El daemon lo procesa **antes** de que terminen de crearse las relaciones.
    3. Google recibe el evento sin el nombre del cliente.
    4. El `afterRelate` posterior se ignoraba por venir con `silent`.
    5. El barrido tampoco lo corregía: filtra por `Meeting.modifiedAt`, que
       relacionar un contacto no modifica.
    6. El título quedaba sin cliente **de forma permanente**.

    Ahora la relación se procesa siempre. `gcsSync` sí se sigue respetando: es
    lo que marca los cambios originados por la propia sincronización y evita
    bucles.

    Un UPSERT de más es inofensivo —`SyncService` es idempotente y
    `GcsEventLink` + `espoMeetingId` impiden duplicar el evento— y desde luego
    preferible a un evento permanentemente sin cliente.

23. **Deduplicación por petición.** Guardar una cita con tres contactos dispara
    tres `afterRelate`. El hook recuerda lo ya encolado (`meetingId:acción`) y
    encola una sola vez.

    Verificado en 10.0.3: `HookManager` cachea las instancias por clase
    (`$this->hooks[$className]`, líneas 112-116) y es un servicio del
    contenedor, así que `afterSave` y `afterRelate` **comparten instancia**
    dentro de una petición y la deduplicación funciona. Aun así, la corrección
    del punto 22 no depende de ello: si en algún flujo hubiera instancias
    distintas, se encolarían dos UPSERT sobre la misma cita, lo cual es seguro.

24. **`EventMapper` sigue siendo puro**: recibe los nombres ya resueltos y no
    consulta la base de datos. `ContactNameResolver` aísla el acceso al ORM y
    ordena por `name` para que el resultado sea determinista.

25. **Solo el nombre.** Nunca se envían a Google correo, teléfono ni
    identificadores del contacto. El título es el mínimo necesario.

26. **Renombrar un Contact reexporta sus citas** (`Hooks/Contact/GcsContactRename`,
    `AfterSave`). Sin él, el título quedaría obsoleto para siempre: el barrido
    filtra por `Meeting.modifiedAt` y editar un Contact no lo toca. Se vigilan
    `firstName`, `middleName` y `lastName`, los tres atributos con los que
    `FieldConverters\PersonName` compone `name`. Consulta la relación inversa
    `meetings` de Contact, acotando a `id` y a 200 filas por `dateStart DESC`.

27. **Sin degradación silenciosa.** `ContactNameResolver` no captura
    `Throwable`. Un error del ORM debe hacer fallar la exportación de esa cita
    —`SyncService` lo registra y el trabajo se reintenta— en vez de guardar en
    Google un título sin cliente marcando el trabajo como correcto.

28. **El máximo de diez nombres se aplica al final.** Primero se leen hasta 50
    filas, luego se descartan vacíos y duplicados, se ordena y por último se
    recorta a diez. Aplicarlo a las filas leídas dejaría fuera contactos
    válidos si los primeros estuvieran vacíos o repetidos.

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
   guardar una cita. En `afterSave` respeta `silent` y `gcsSync`; en los hooks
   de relación **solo** `gcsSync`, por la carrera descrita en la decisión 22
   (esta última,
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
