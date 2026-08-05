# Resultados de validación — Fase 1 (4/8/2026)

> Revisión 2 (4/8/2026): el cliente HTTP propio se sustituyó por la librería
> oficial `google/apiclient` ^2.18. Las validaciones de abajo se reejecutaron
> sobre el código nuevo; los añadidos de esta revisión están marcados como
> **[rev2]**.
>
> Revisión 3 (4/8/2026): gestión reproducible de dependencias con
> `composer.lock` y ZIP autónomo. Las pruebas dejaron de ser scripts sueltos y
> viven en `tests/` y `tools/`, ejecutándose **contra el contenido del ZIP**
> desde `build.sh`. Marcadas como **[rev3]**.

## Revisión 5 (4/8/2026) — extensión genérica y reutilizable (v1.1.0) ⚠️ SIN VALIDAR

Objetivo: que la extensión se pueda instalar en cualquier EspoCRM sin rastro
del proyecto de origen. **Ningún cambio de comportamiento**: la instalación
actual se actualiza sin reconectar Google ni tocar datos.

### Correcciones de la auditoría del sistema de entrega

| Problema detectado | Corrección |
|---|---|
| `gcs-package` decía instalar dependencias pero solo dependía de `gcs-build`; fallaba en un checkout limpio | Ahora `gcs-package: gcs-deps gcs-build` |
| `acceptableVersions: ">=10.0.0"` aceptaba EspoCRM 11+ pese a estar probada solo en 10.x | `">=10.0.0 <11.0.0"`, sintaxis validada contra `Composer\Semver\Semver` |
| `php: ">=8.2"` incoherente: EspoCRM 10.0.3 exige `>=8.3.0 <8.6.0` y el lock se resolvió con `platform.php = 8.3.0` | `">=8.3.0"` |
| `gcs-package` borraba `FALTA-EL-ZIP.md`, versionado, ensuciando Git | Fuente versionada en `entrega-google-calendar-sync/`; resultado generado en `dist/`, ignorado |
| Globs destructivos que borraban otras versiones | Eliminados; solo se recrea la carpeta de la versión exacta |
| `gcs-status` mostraba como activos trabajos borrados lógicamente | `deleted = 0` en las cuatro consultas |
| La entrega remitía al monorepo | Manuales autónomos |
| El borrado de tablas estaba mezclado con la desinstalación normal | Sección propia «Desinstalación total avanzada — destructiva» |

### Auditoría de portabilidad (repetida tras los cambios)

| Comprobación | Resultado |
|---|---|
| Cadena «Gapssa» en el código empaquetado | **0** ✅ |
| URLs, puertos o rutas fijas (`localhost`, `8081`, `/var/www`…) | **0** ✅ |
| Dependencia de entidades propias (`CTratamiento`, `CZonaAtencion`) | **0** ✅ |
| `Europe/Madrid` codificado | **0** ✅ (respaldo ahora `UTC`) |
| Mensajes lanzados en español fuera de i18n | **0** ✅ |
| Entidades de EspoCRM requeridas | Solo `Meeting` (nativa) |

### Cambios

- `manifest.json`: autor **Isain Rodríguez**, descripción en inglés,
  versión **1.1.0**.
- `composer.json`: paquete `isainro/espocrm-google-calendar-sync`.
- `Classes/Messages.php`: mensajes de error traducibles con
  `Language $defaultLanguage`, cada uno con respaldo en inglés.
- **14 claves de error** movidas a i18n (`errors`) en `en_US` y `es_ES`.
- Mensajes de `data/logs/` pasados a inglés (5 cadenas).
- `EventMapper`: respaldo de zona horaria `UTC`.
- `AfterInstall`: el nombre de la cuenta Business se traduce al idioma por
  defecto de la instancia.
- `make gcs-relock`: refirma el lock tras cambiar metadatos de `composer.json`
  sin mover versiones.

### Prueba añadida: `tests/i18n_test.php`

```
I18N: OK (19 comprobaciones, idiomas: en_US, es_ES,
          14 claves de error usadas en PHP verificadas)
```

Falla si una clave existe en un idioma y falta en otro, si sobra en el
traducido, o si el PHP usa una clave de error no declarada en los i18n. Se
ejecuta en `build.sh` sobre el contenido del ZIP.

### Estado de la versión 1.1.0

> **1.1.0 NO está validada ni es entregable.** Solo se han ejecutado
> verificaciones estáticas. No se ha construido el ZIP, ni instalado, ni
> probado en ninguna instancia. No la distribuyas hasta completar los cuatro
> bloques de abajo.

#### A · Verificaciones estáticas — ejecutadas ✅

| Comprobación | Resultado |
|---|---|
| `php -l` sobre los 20 archivos PHP propios (incluidos `tests/` y `tools/`) | 0 errores |
| `tests/i18n_test.php` (paridad en_US ↔ es_ES + claves usadas en PHP) | OK — 19 comprobaciones, 14 claves |
| `tests/controller_test.php` | OK — 4 comprobaciones, 2 entidades |
| Validez de todos los JSON del paquete | OK |
| `bash -n build.sh`, `make -n` de los objetivos | OK |
| Auditoría de neutralidad (sin «Gapssa», rutas, dominios ni secretos) | 0 coincidencias |
| Sintaxis de `acceptableVersions` contra `Composer\Semver\Semver` de 10.0.3 | Válida |

#### B · Pendientes que requieren Docker ⏳

Ninguna se ha ejecutado; el entorno de desarrollo no tiene Docker ni red.

- [ ] `make gcs-relock` — **obligatorio**. `composer.json` cambió dos veces en
      esta revisión y ambos campos entran en el `content-hash` del lock:
      1. `name`: `gapssa/...` → `isainro/espocrm-google-calendar-sync`.
      2. `require.php`: `>=8.2` → `>=8.3.0`, para que coincida con el mínimo de
         EspoCRM 10 y con `platform.php = 8.3.0` del propio lock.

      `gcs-relock` ejecuta `composer update --lock --no-install`, que **solo**
      refresca la firma. No uses `gcs-lock`: re-resolvería y podría mover
      versiones.
- [ ] **Verificar que las 19 versiones bloqueadas NO cambian** tras el relock.
      El `git diff` de `composer.lock` debe afectar únicamente a
      `content-hash`; ninguna línea `"version"` debe aparecer modificada:

      ```bash
      git diff -- .../composer.lock | grep -E '^[+-]' | grep -v content-hash
      ```

      Si sale algo más que las cabeceras del diff, **para**: el relock movió
      dependencias y hay que revisar por qué.
- [ ] `make gcs-package` — construir el ZIP y generar `dist/`.
- [ ] Batería completa de `build.sh` sobre el contenido del ZIP: dependencias
      completas y autónomas, autoload, controladores, i18n, mapper y `php -l`.

#### C · Pendientes de actualización sobre la instalación local ⏳

La instancia local corre **1.0.1**. La actualización a 1.1.0 debe comprobar:

- [ ] `make gcs-install` completa sin errores.
- [ ] `bin/command app-check` sin fallos.
- [ ] **Se conservan**: la cuenta Business, el Client ID, el Client Secret, los
      tokens (sin reconectar Google), el calendario elegido y los vínculos
      `GcsEventLink` existentes.
- [ ] El registro de la cuenta mantiene su nombre actual (no se renombra).
- [ ] Crear una cita → aparece en Google una sola vez.
- [ ] Modificar una cita → se actualiza **el mismo evento**, no se crea otro.
- [ ] Cambiar el usuario asignado → el evento Business sigue coherente.
- [ ] Cancelar una cita → el evento se elimina; la cita permanece en el CRM.
- [ ] **Ausencia de duplicados** tras todo lo anterior (revisar el calendario
      completo, no solo la última cita).

#### D · Pendientes antes de distribuir a otro cliente ⏳

- [ ] Instalación **desde cero** en una instancia limpia de EspoCRM 10.0.x
      (no una actualización): el flujo de `1-INSTALACION.md` de principio a fin.
- [ ] Verificar que `AfterInstall` crea la cuenta Business con el nombre
      traducido según el idioma por defecto de esa instancia.
- [ ] Probar la interfaz con un usuario de idioma **inglés**, para confirmar que
      no aparece ningún texto en español.
- [ ] Comprobar el rechazo de instalación en una versión fuera de rango
      (`acceptableVersions` limita a 10.x).
- [ ] Recorrer `3-VERIFICACION.md` completo en esa instancia.
- [ ] Confirmar que la carpeta `dist/` entregada no contiene credenciales.

## Revisión 4 (4/8/2026) — fallo detectado en integración real 🐞

Primer despliegue de la extensión en la instancia local. **Todas las pruebas
automáticas pasaban y aun así la pantalla no abría.**

### Síntoma

Administración → Google Calendar Sync → **Cuentas de Google** → error 404.
Log de EspoCRM:

```
Controller 'GcsAccount' does not exist. :: GET /GcsAccount
```

### Causa raíz

Faltaba el **controlador API del servidor**. La entidad, la tabla, el scope,
los `clientDefs` y la entrada de menú existían, pero EspoCRM resuelve el
controlador de cada entidad por su ubicación
(`{Modulo}\Controllers\{Entidad}`) y **no aplica ningún fallback**: en
`Espo\Core\Api\ControllerActionProcessor::getControllerClassName()`, si
`ClassFinder` no encuentra la clase se lanza `NotFound` directamente
(verificado en el código de 10.0.3).

Las entidades creadas desde Entity Manager no sufren esto porque Espo les
genera el controlador en `custom/Espo/Custom/Controllers/`. **Las de un módulo
hay que escribirlo a mano**, como hacen los propios módulos del núcleo
(`Espo\Modules\Crm\Controllers\Meeting`).

### Corrección

- Nuevo `Controllers/GcsAccount.php`, que extiende
  `Espo\Core\Templates\Controllers\Base` (a su vez `Espo\Core\Controllers\Record`,
  que aporta el CRUD estándar).
- **`GcsEventLink` no lleva controlador**: `object: false`, sin ACL ni layouts,
  y ninguna ruta ni vista lo referencia; solo se usa desde PHP vía
  EntityManager. Exponerlo por la API sería ampliar la superficie sin motivo.
- Versión de la extensión: **1.0.1**.

### Por qué no lo detectaron las pruebas anteriores

Validaban dependencias, autoload, mapeo y sintaxis —todo lo que se puede
comprobar sin una instancia— pero **ninguna comprobaba el contrato entre los
metadatos y las clases que EspoCRM espera encontrar**. Un ZIP perfectamente
formado puede seguir dando 404.

### Prueba añadida: `tests/controller_test.php`

Se ejecuta en `make gcs-build` sobre el contenido del ZIP y aplica una regla
general, no un caso particular:

| Regla | Comprobación |
|---|---|
| Entidad con `object: true` | Debe existir `Controllers/{Entidad}.php` |
| El archivo | Debe definir `{Modulo}\Controllers\{Entidad}` y **cargar** |
| La clase | Debe heredar de `Templates\Controllers\Base` |
| Entidad con `object: false` | **No** debe tener controlador |

Verificada en ambos sentidos:

```
# Estado actual
CONTROLADORES: OK (4 comprobaciones sobre 2 entidades)

# Simulando el módulo sin el controlador (el bug original)
CONTROLADORES: FALLA
  ✗ GcsAccount está expuesta ('object: true') pero falta
    Controllers/GcsAccount.php — la API devolvería 404.

# Simulando que se expone GcsEventLink por error
CONTROLADORES: FALLA
  ✗ GcsEventLink tiene 'object: false' pero incluye un controlador…
```

Cualquier entidad futura queda cubierta por la misma regla.

### Pendiente de ejecutar ⏳

`make gcs-build`, `make gcs-install`, `app-check` y las tres comprobaciones
funcionales (API 200, pantalla sin 404, «Calendario Business» visible) requieren
Docker y la instancia, ausentes en el entorno de desarrollo. Anota aquí el
resultado.

## Estado de la revisión 3 — pipeline de dependencias ✅ COMPLETADO

Resumen: `make gcs-lock && make gcs-build` terminan correctamente. **19
paquetes bloqueados, ZIP de 1,6 MB con 1.061 archivos, autónomo y verificado**,
sin vulnerabilidades conocidas. El detalle del fallo intermedio se conserva
abajo porque documenta por qué `phpseclib` es dependencia directa.

### Lo que pasó en el primer intento

`make gcs-lock` funcionó y bloqueó **16 paquetes**. `make gcs-build` **falló a
propósito** en el primer filtro:

```
COMPROBACIÓN DE DEPENDENCIAS: FALLA
  ✗ No se resuelven sin EspoCRM (el ZIP no sería autónomo): phpseclib3\Crypt\RSA
```

**Causa raíz**: la restricción `^2.18` resolvió a `google/apiclient` **v2.19.4**,
y esa versión **retiró `phpseclib/phpseclib` de sus `require`** (v2.18.3 sí lo
exigía). `google/auth` solo lo declara como `suggest`, así que Composer no lo
instaló — pero el código sí lo usa:

| Archivo instalado | Clases de phpseclib que referencia |
|---|---|
| `google/auth/src/AccessToken.php` | `PublicKeyLoader`, `Crypt\RSA`, `Math\BigInteger` |
| `google/auth/src/ServiceAccountSignerTrait.php` | `Crypt\RSA` (firma sin OpenSSL) |

Sin el paquete, esos caminos fallan en runtime. **El verificador cumplió
exactamente su función**: detectó una dependencia ausente antes de empaquetar,
no en producción.

### Corrección aplicada

- `composer.json`: `phpseclib/phpseclib: ^3` como **dependencia directa**.
- `tools/check-dependencies.php`: se mantiene la comprobación de
  `phpseclib3\Crypt\RSA` y se añaden `PublicKeyLoader` y `Math\BigInteger`,
  que son las otras clases realmente usadas.
- `make gcs-deps`: al cambiar `composer.json` el lock queda desincronizado;
  ahora el objetivo lo detecta y responde con
  `ERROR: composer.lock no coincide con composer.json → make gcs-lock`
  en vez de con la salida cruda de `composer validate`.

Añadir phpseclib arrastró además sus dos dependencias
(`paragonie/constant_time_encoding` y `paragonie/random_compat`): de 16 a **19
paquetes**.

### Resultado final ✅ — `make gcs-lock && make gcs-build`

Ejecución completa y correcta. Los cinco filtros de `build.sh` pasan:

| Filtro | Resultado |
|---|---|
| Comprobación de dependencias del módulo (lock ↔ vendor, paquete y versión) | **OK** |
| Autonomía: clases críticas resueltas solo con el vendor del ZIP | **OK — 22 clases** |
| Recorte de `google/apiclient-services` a solo `Calendar` | **OK** |
| Misma comprobación repetida **sobre el ZIP extraído** | **OK** |
| `tests/autoload_test.php` | **OK — 21 clases y los 2 scopes** |
| `tests/mapper_test.php` | **OK — 17 aserciones sobre objetos `Event`** |
| `php -l` sobre el PHP propio contenido en el ZIP | **OK — sin errores** |
| `composer audit` | **Sin vulnerabilidades conocidas** |

**ZIP final: 1,6 MB y 1.061 archivos.**

### Versiones bloqueadas (19 paquetes)

Instantánea real de `composer.lock`, sin paquetes de desarrollo:

| Paquete | Versión | | Paquete | Versión |
|---|---|---|---|---|
| firebase/php-jwt | v7.1.0 | | phpseclib/phpseclib | **3.0.56** |
| google/apiclient | v2.19.4 | | psr/cache | 3.0.0 |
| google/apiclient-services | v0.453.0 | | psr/http-client | 1.0.3 |
| google/auth | v1.53.0 | | psr/http-factory | 1.1.0 |
| guzzlehttp/guzzle | 7.15.2 | | psr/http-message | 2.0 |
| guzzlehttp/promises | 2.5.1 | | psr/log | 3.0.2 |
| guzzlehttp/psr7 | 2.13.0 | | ralouphie/getallheaders | 3.0.3 |
| monolog/monolog | 3.10.0 | | symfony/deprecation-contracts | v3.7.1 |
| paragonie/constant_time_encoding | v3.1.3 | | symfony/polyfill-php80 | v1.37.0 |
| paragonie/random_compat | v9.99.100 | | | |

El ZIP es autónomo: trae su propia Guzzle 7.15.2, Monolog 3.10.0, phpseclib
3.0.56 y `psr/http-message` **2.0** — frente a la **1.1** que empaqueta
EspoCRM 10.0.3. Ninguna clase depende del `vendor/` del CRM.

## Entorno de validación

La implementación se validó en un entorno aislado (sin acceso al contenedor
Docker local). Las pruebas que requieren la instancia real de EspoCRM y una
cuenta de Google están **pendientes de ejecución por el usuario** siguiendo
`TESTING.md`; este archivo debe actualizarse con sus resultados.

## Validaciones ejecutadas ✅

### Sintaxis y estructura

- `php -l` sobre los **17 archivos PHP propios** (módulo + scripts): sin errores
  (PHP 8.5 vía php-wasm; la imagen de EspoCRM 10.0.3 usa PHP 8.3, dentro del
  rango soportado `>=8.3 <8.6` del propio EspoCRM). **[rev2]** reejecutado tras
  la migración, más los archivos críticos del vendor (`Client.php`,
  `aliases.php`, `Calendar.php`, `Calendar/Event.php`, `auth/OAuth2.php`).
- Validación JSON de los archivos de metadata, layouts, i18n, manifest y
  **[rev2]** `autoload.json` + `composer.json` del módulo: todos válidos.
- `node --check` sobre las 3 vistas JS: sin errores.
- ZIP generado y verificado: **[rev2]** 256 entradas / 304 KB, estructura
  `manifest.json + files/ + scripts/` conforme al formato de extensiones, sin
  rastro del cliente cURL anterior. *(Superado por la rev3: aquel ZIP
  reutilizaba librerías de EspoCRM; el actual es autónomo — 1.061 archivos /
  1,6 MB.)*

### Verificación contra el código fuente real de EspoCRM 10.0.3

Clonado el tag `10.0.3` oficial y comprobadas una a una las API utilizadas:

| API | Verificado |
|---|---|
| `Hook\AfterSave::afterSave(Entity, SaveOptions)` | ✅ firma exacta |
| `Hook\BeforeSave`, `Hook\AfterRemove` (`RemoveOptions`) | ✅ |
| `SaveOptions::get()` (trait `Options`) | ✅ |
| `Job::run(Job\Data)`, `JobDataLess::run()` | ✅ |
| `JobSchedulerFactory` / `JobScheduler::setClassName/setGroup/setData/schedule` | ✅ |
| `Crypt::encrypt/decrypt` | ✅ |
| `ConfigWriter::set/save` | ✅ |
| `ResponseComposer::json`, `Response::setStatus/setHeader` | ✅ |
| `EntryPoint` (auth requerida por defecto) + descubrimiento por `ClassFinder` | ✅ |
| `EntityManager::getEntityById/getNewEntity/saveEntity/removeEntity/getRDBRepository` | ✅ |
| `Entity::isNew/isAttributeChanged` | ✅ |
| `User::isAdmin` | ✅ |
| `entityAcl.fields.forbidden` (`GlobalRestriction`) | ✅ |
| `app/scheduledJobs.json` con `isDefault` + `scheduling` (`Populator`) | ✅ |
| `app/adminPanel.json` con `recordView` | ✅ formato del núcleo |
| Config `level: internal/admin` (`Config\Access`) | ✅ (patrón `smtpPassword`) |
| Cliente: `setupOptions`/`translatedOptions` en `views/fields/enum`, `dropdownItemList` en `views/record/detail`, `Espo.Ui.notifyWait` | ✅ |
| `Meeting.status` opciones núcleo (`Planned/Held/Not Held`) + `canceledStatusList` de la instancia (`Not Held`) | ✅ |
| `bin/command extension --file` / `-u --name` | ✅ |

### Verificación de la librería oficial **[rev2]**

Comprobado contra el código real de los paquetes vendorizados, no asumido:

| Elemento | Verificado |
|---|---|
| `Google\Client`: `setClientId/setClientSecret/setRedirectUri/setScopes/setAccessType/setPrompt/setIncludeGrantedScopes/setState/setLogger/createAuthUrl/fetchAccessTokenWithAuthCode/fetchAccessTokenWithRefreshToken/setAccessToken/revokeToken` | ✅ firmas exactas |
| `Google\Service\Calendar\Resource\Events::insert/update/delete/listEvents` | ✅ |
| `Google\Service\Calendar\Resource\CalendarList::listCalendarList` | ✅ (nombre real, no `list`) |
| Constantes de scope `CALENDAR_EVENTS` y `CALENDAR_CALENDARLIST_READONLY` | ✅ valores comprobados en ejecución |
| `Google\Service\Exception::getCode()` = estado HTTP | ✅ |
| Compatibilidad de versiones apiclient 2.18 ↔ vendor de EspoCRM 10.0.3 | ✅ las 10 dependencias reutilizadas satisfacen las restricciones (tabla en `VENDOR.md`) |
| `Espo\Core\Utils\Log implements Psr\Log\LoggerInterface` | ✅ inyectable en `setLogger` |

### Pruebas unitarias (php-wasm, con stubs)

- **Autoload [rev2]**: autoloador PSR-4 construido a partir del
  `autoload.json` real (con las interfaces PSR simulando el vendor de EspoCRM)
  → **21 clases resueltas**, incluidas `Google\Service\Exception` y
  `Google\Service\Resource`, que confirman el retroceso de prefijo largo a
  corto. `aliases.php` carga y expone los alias `Google_*`. **Pasa.**
- **`EventMapper` [rev2]**: 14 aserciones sobre objetos reales
  `Google\Service\Calendar\Event` — conversión UTC→Madrid en verano
  (`10:00Z → 12:00+02:00`) e invierno (`10:00Z → 11:00+01:00`), evento de día
  completo con fin exclusivo (+1 día) y sin `dateTime`, título por defecto,
  detección de estado cancelado desde metadata, y **serialización real**
  (`toSimpleObject()`) comprobando que el payload lleva
  `extendedProperties.private.espoMeetingId` y no incluye `id` al crear.
  **Todas pasan.**

### Compatibilidad con las personalizaciones existentes

- `extensions/espocrm/custom/` **no se modifica**.
- Los record hooks de invitaciones (`recordDefs/Meeting.json` en Custom) usan
  `afterCreateHookClassNameList`/`afterUpdateHookClassNameList`; la extensión
  usa hooks de repositorio (`Hooks/Meeting/`), mecanismo independiente. El
  merge de metadata de `Meeting.json` del módulo solo añade el link
  `gcsEventLinks`.
- Generador ICS y envío de invitaciones: sin cambios.

## Verificado en la revisión 3 (sin red) ✅ **[rev3]**

- `php -l` sobre `tools/check-dependencies.php`, `tests/autoload_test.php` y
  `tests/mapper_test.php`: sin errores.
- `bash -n build.sh`: sintaxis correcta.
- **Guardarraíles probados en ejecución**, que es lo importante de esta
  revisión:
  - `build.sh` sin `composer.lock` → aborta con
    `ERROR: falta …/composer.lock — Genera el lock una vez con: make gcs-lock`
    y código de salida 1. **No construye un ZIP incompleto.**
  - `tools/check-dependencies.php` sin `vendor/` → informa de los tres
    artefactos que faltan y devuelve fallo.
  - `make gcs-deps` sin lock → aborta antes de invocar Composer.
- `make -n` sobre `gcs-lock`, `gcs-deps`, `gcs-deps-check`, `gcs-clean`:
  comandos correctos; Composer y PHP se ejecutan en la imagen `composer:2`, sin
  requisitos en macOS más allá de Docker.
- `vendor/` retirado del índice de Git (144 archivos) y añadido a `.gitignore`;
  `composer.lock` sí se versionará.

> Nota metodológica: el intérprete usado aquí (php-wasm) **no propaga códigos
> de salida**, así que la verificación de los `exit(1)` se hizo por el mensaje
> de error y el comportamiento de `build.sh` bajo `set -e`. Con el PHP real de
> la imagen `composer:2` los códigos se propagan con normalidad.

## Pendiente de ejecutar en la primera construcción ⏳ **[rev3]**

Un solo comando encadena todo:

```bash
make gcs-lock     # genera composer.lock (requiere red; una sola vez)
make gcs-build    # construye y verifica el ZIP
```

`make gcs-build` ejecuta y debe pasar:

1. Comprobación de dependencias del módulo: lock ↔ `vendor/` paquete a paquete
   y versión a versión, sin paquetes de desarrollo.
2. Autonomía: 20 clases críticas —incluidas `GuzzleHttp\Client`,
   `Monolog\Logger`, `phpseclib3\Crypt\RSA` y las interfaces PSR— resueltas
   cargando **solo** el `vendor/autoload.php` del paquete.
3. Recorte de `google/apiclient-services` a únicamente `Calendar`.
4. Las mismas comprobaciones repetidas **sobre el ZIP extraído**.
5. `tests/autoload_test.php`: 21 clases y los dos scopes.
6. `tests/mapper_test.php`: 17 aserciones sobre objetos `Event` reales.
7. `php -l` sobre todo el PHP propio contenido en el ZIP.

Anota aquí el resultado, el tamaño final del ZIP y la salida de
`composer show --locked`.

## Limpieza realizada ✅ **[rev2]**

- `Classes/GoogleApiClient.php` (cliente cURL obsoleto): eliminado del disco y
  del índice de Git. Las clases activas del módulo son `EventMapper`,
  `GoogleApiException`, `GoogleClientFactory`, `OAuthService`, `SyncService` y
  `TokenService`.
- Temporal huérfano `build/ziPhE51R` y dos `.DS_Store`: eliminados.
- `.git/index.lock` huérfano: eliminado; Git operativo.

Verificado tras la limpieza: ninguna referencia pendiente al cliente antiguo y
`extensions/espocrm/custom/` sin cambios.

## Pendiente de ejecutar en la instancia real ⏳

Los 14 casos de `TESTING.md` (conexión OAuth real, push, cancelación,
simulación de error, reintentos, persistencia tras reinicio) más:
instalación del ZIP (`make gcs-install`), `rebuild`, `app-check`,
actualización y desinstalación. Requieren el Docker local y una cuenta Google.

**[rev2]** Al instalar, comprobar además que el autoload del módulo resuelve la
librería en la instancia real. Si aparece `Class "Google\Client" not found`, la
causa es `Resources/autoload.json` o la caché: `make gcs-rebuild`.
