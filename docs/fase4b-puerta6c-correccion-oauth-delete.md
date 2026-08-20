# Puerta 6C — Corrección: OAuth se intentaba en cualquier DELETE, incluso sin `GcsEventLink`

**Estado**: propuesta documental únicamente. **No ejecutada, no desplegada
contra `gapssa-espocrm-1`.** Requiere tu autorización explícita y separada.
La corrección ya existe, verificada, en el repositorio y en un ensayo
desechable — ver §2 y §5. Este documento propone únicamente su despliegue
real.

## 0. Origen

Incidente ocurrido durante la ejecución autorizada de la limpieza de la
Puerta 5A (2026-08-13): el soft-delete del Fixture A
(`6a7cf117522f19bcf`) disparó dos intentos reales de renovación OAuth
contra Google (bloqueados por el token ya caducado, cero tráfico hacia la
API de Calendar) a pesar de que el Meeting no tenía ningún
`GcsEventLink`. Detalle completo, secuencia con timestamps, y la
distinción exacta entre tráfico OAuth y tráfico Calendar:
`docs/fase4b-puerta5a-limpieza-propuesta.md` §12.

## 1. Causa raíz exacta

`SyncService::processPush()` (antes de esta corrección) creaba el cliente
de Google —y con él, intentaba renovar el token OAuth si estaba
caducado— de forma **incondicional**, antes de comprobar si existía algún
`GcsEventLink` que borrar:

```php
// Antes (vulnerable):
private function processPush(Entity $account, string $meetingId, string $action): void
{
    $mustDelete = ...;

    $service = $this->clientFactory->createCalendarService($account); // ← OAuth aquí, siempre

    if ($mustDelete) {
        $this->deleteByLinks($service, $account, $meetingId); // ← la consulta local vivía AQUÍ, demasiado tarde
        return;
    }
    ...
}
```

La consulta local a `GcsEventLink` (la única fuente de verdad de "hay algo
que borrar") vivía dentro de `deleteByLinks()`, que se llamaba **después**
de crear el cliente — nunca antes. `isExcludedFromSync()` tampoco protegía
este caso: por diseño, deja pasar cualquier `ACTION_DELETE` explícito (para
no dejar huérfanos eventos ya sincronizados antes de excluir una cita) —
protección correcta y que se conserva sin cambios.

## 2. Tabla de caminos DELETE — todos comparten el mismo defecto (y la misma corrección)

| Punto de entrada | Consulta local previa (antes) | Creación de cliente (antes) | OAuth (antes) | Calendar (antes) | Estado tras la corrección |
|---|---|---|---|---|---|
| `GcsPush::afterRemove()` (soft-delete) | Ninguna | Incondicional | Intentado si el token está caducado, independientemente de si hay vínculo | Solo si hay vínculo | `processDelete()` consulta primero; sin vínculo, cero cliente/OAuth |
| `GcsPush::afterSave()`, `cExcluirGoogleCalendarSync` false→true | Ninguna | Incondicional | Igual | Igual | Igual |
| `GcsPush::afterSave()`, cita cancelada (`isCanceled` fuerza `mustDelete` dentro de `processPush()`) | Ninguna | Incondicional | Igual | Igual | Igual |
| `SyncService::sweep()`, cita excluida con vínculo | Sí (`findLink()` en el propio `sweep()`, antes de llamar a `pushMeeting()`) | Incondicional (redundante si sweep ya confirmó el vínculo) | Igual | Igual (con vínculo, comportamiento sin cambios) | Sin cambio de comportamiento — sweep ya se protegía a su manera; ahora además protegido por la guardia central |
| Job `GcsPushEvent(action=delete)` manual o antiguo (creado antes de esta corrección, o cualquier llamador que no pase por `GcsPush`) | Ninguna | Incondicional | Igual | Igual | Protegido igual que el resto — la guardia vive en `SyncService`, no en el hook que encola el job |

**Todos los caminos terminan en `SyncService::processPush()`/`processDelete()`** — por eso una única corrección, en un único punto central, cierra el defecto para los cinco caminos a la vez. No existe ningún camino DELETE que no pase por ahí.

## 3. Corrección aplicada (repositorio, ya presente y verificada)

Archivo: `extensions/espocrm-google-calendar-sync/files/custom/Espo/Modules/GoogleCalendarSync/Classes/SyncService.php`.

- `processPush()` ahora delega cualquier `mustDelete=true` a un método
  nuevo, `processDelete()`, **antes** de crear ningún cliente.
- `processDelete()` consulta `GcsEventLink` localmente primero. Sin
  ninguna fila, retorna `false` de inmediato — cero cliente, cero OAuth,
  cero llamada a Calendar. Con una o más filas, crea el cliente y reutiliza
  exactamente el mismo `deleteByLinksCollection()` de siempre (renombrado
  desde `deleteByLinks()`, ahora recibe la colección ya consultada en vez
  de volver a consultar).
- `pushMeeting()` ahora solo actualiza `GcsAccount` (`lastSyncAt`,
  `status=Active`, `lastError=null`) cuando `processPush()` devuelve
  `true` (se tocó Google de verdad) — el no-op local ya no deja ningún
  rastro en `GcsAccount`.
- El comportamiento UPSERT (creación/actualización de eventos) **no se ha
  tocado** — mismo camino, mismo orden de llamadas, ninguna prueba de
  regresión de UPSERT ha cambiado su expectativa.
- **Deliberadamente no se optimizó `GcsPush::afterRemove()`** para dejar de
  encolar el job cuando ya sabe que no hay vínculo — encolar el job sigue
  costando una fila en `job`, pero añadir esa optimización habría exigido
  inyectar `EntityManager` en el hook y duplicar la misma consulta que ya
  hace `processDelete()`, sin aportar ninguna garantía adicional (la
  garantía central ya cubre el caso). Se documenta como decisión
  deliberada, no como omisión.

### 3.1 Hashes de los archivos modificados (estado actual del repositorio)

```
acebf18373aafaede1ae35ba230ec2e6d278d1ea102bc85a779909ccd34e56eb  SyncService.php
715879102722194b5e840538c9be24ef71b00b783c5137c47585c06bbc6c24a1  exclusion_sync_service_test.php
```

(SHA-256, `extensions/espocrm-google-calendar-sync/files/custom/Espo/Modules/GoogleCalendarSync/Classes/SyncService.php` y `extensions/espocrm-google-calendar-sync/tests/exclusion_sync_service_test.php` respectivamente.)

## 4. Pruebas añadidas

`extensions/espocrm-google-calendar-sync/tests/exclusion_sync_service_test.php`,
bloques E (corregido) y K–R (nuevos), 38 aserciones totales en este
archivo (antes 26). Cubren los 10 casos exigidos:

| # | Caso | Bloque |
|---|---|---|
| 1 | DELETE sin vínculo, OAuth válido | E |
| 2 | DELETE sin vínculo, OAuth caducado/revocado | K |
| 3 | Soft-delete de Meeting excluido=true sin vínculo | L |
| 4 | Cancelación de Meeting excluido=true sin vínculo | M |
| 5 | Transición false→true sin vínculo | N |
| 6 | DELETE con vínculo, OAuth válido | D (existente, regresión) |
| 7 | DELETE con vínculo, OAuth inválido | O |
| 8 | Job DELETE antiguo/manual sin vínculo | P |
| 9 | Sweep de Meeting excluido sin vínculo | H (existente, ya cubría el caso) |
| 10 | Concurrencia: dos DELETE sobre el mismo vínculo | Q |

Más R1, comprobación estructural directa sobre el código fuente: el texto
de `processDelete()` debe consultar `GcsEventLink` y poder retornar
**antes** de la línea `createCalendarService`.

## 5. Resultado del control pre-fix y post-fix

### 5.1 Suite de dobles (PHP puro, sin red, sin EspoCRM)

- **Contra el código previo a la corrección** (reconstruido desde el
  estado del repositorio inmediatamente antes de esta sesión):
  `FALLA (14/38)` — fallan exactamente los bloques E, K, L, M, N, P, Q3,
  R1 (los que verifican la garantía nueva) y ningún otro. Cero falsos
  positivos, cero falsos negativos.
- **Contra el código corregido**: `OK (38/38)`.

### 5.2 Ensayo desechable (EspoCRM 10.0.3 real, aislado, sin ruta a Google)

Entorno: proyecto Docker Compose separado (`gcs-oauth-rehearsal`), red
`internal: true` (sin ruta de salida en absoluto — confirmado: `curl` a
`oauth2.googleapis.com` desde dentro del contenedor falla con "Could not
resolve host", sin llegar siquiera a intentar la conexión TCP), base de
datos y contenedor de EspoCRM propios, mismo `google/apiclient` que la
extensión real (vendor ya vendorizado, sin instalar nada nuevo desde
Internet), extensión empaquetada con el mismo `build.sh`/`manifest.json`
del repositorio real.

**Control (código previo, versión anterior a esta corrección)**:
- `GcsAccount` con token de acceso caducado, `Meeting` real con
  `cExcluirGoogleCalendarSync=true`, cero `GcsEventLink`.
- `SyncService::pushMeeting($id, 'delete')` invocado directamente contra
  el contenedor de EspoCRM real (DI container real, ORM real).
- **Resultado**: `GuzzleHttp\Exception\ConnectException`, mensaje `cURL
  error 6: Could not resolve host: oauth2.googleapis.com` — confirma que
  el código SÍ intentó una conexión real hacia el endpoint OAuth de
  Google, bloqueada únicamente por el aislamiento de red del ensayo, no
  por el código. `GcsAccount.status` pasó a `Error`, `lastError` se
  actualizó. Reproduce exactamente el mecanismo del incidente real.

**Post-fix (código de esta corrección)**:
- Mismo `GcsAccount`, mismo `Meeting`, cero `GcsEventLink`.
- **Resultado**: sin excepción, `1 ms` de duración (frente a `13 ms` del
  control — sin ningún intento de red), `GcsAccount.status`/`lastError`
  sin ningún cambio.
- **Control positivo, mismo build corregido, con un `GcsEventLink` real**:
  `SyncService::pushMeeting($id, 'delete')` **sí** intenta OAuth (misma
  excepción de red que el control), `GcsAccount` pasa a `Error`, y el
  vínculo local se conserva (no se borra tras el fallo) — confirma que la
  corrección no bloquea la limpieza legítima cuando sí hay algo que
  limpiar.

### 5.3 Teardown

`docker compose down -v --remove-orphans` sobre el proyecto
`gcs-oauth-rehearsal`. Confirmado tras el teardown: cero contenedores,
cero volúmenes, cero redes con ese nombre de proyecto. Las imágenes base
(`espocrm/espocrm:10.0.3-apache-trixie`, `mariadb:11.4`) ya estaban
presentes localmente (compartidas con la instancia real) y no se
eliminaron ni se consideran residuo de este ensayo. Directorios
temporales del ensayo (ZIPs de control y corregido, scripts, copias de
clases) eliminados del scratchpad de la sesión.

## 6. Archivos exactos que cambiarían en `gapssa-espocrm-1`

Solo si se autoriza el despliegue (§7):

- `custom/Espo/Modules/GoogleCalendarSync/Classes/SyncService.php` —
  reemplazo completo por el contenido ya verificado (hash en §3.1).
- Ningún otro archivo de la extensión cambia. No hay migración de base de
  datos (ningún campo/tabla nuevo), no hay cambio de metadata, no hay
  cambio de ACL.

## 7. Propuesta de despliegue (no ejecutada)

### 7.1 Mecanismo

Igual que la actualización de la extensión ya usada en este proyecto:
`bin/command extension --file=<zip>` con el ZIP reconstruido desde el
repositorio real (`make gcs-build`), **nunca** edición manual del archivo
dentro del contenedor. Esto además reinstala el resto de la extensión sin
cambios (mismo contenido, mismo hash salvo `SyncService.php`), lo cual es
aceptable porque `bin/command extension` es idempotente sobre archivos
idénticos.

### 7.2 Backup vivo

- `data/.backup/gapssa/puerta6c/<timestamp>/SyncService.php.bak` — copia
  del archivo real tal como está desplegado en `gapssa-espocrm-1` en este
  momento, **antes** de sobrescribirlo. Modo `600`, hash SHA-256
  registrado.
- Backup de base de datos completo (`espocrm-backup` / `scripts/backup-espocrm-db.sh`,
  ya existente en este repositorio) inmediatamente antes del despliegue —
  no porque este cambio toque el esquema (no lo hace), sino como red de
  seguridad estándar antes de cualquier actualización de extensión.

### 7.3 Mantenimiento

- `maintenanceMode` no es necesario para este cambio: `bin/command
  extension` no requiere downtime para un cambio de un único archivo PHP
  sin migración. Se documenta aquí por si se prefiere igualmente activarlo
  como precaución adicional — decisión tuya, no asumida.

### 7.4 Instalación

1. `make gcs-build` (o equivalente) para regenerar el ZIP desde el
   repositorio real, con las pruebas del propio `build.sh` en verde
   (`RUN_TESTS=1`, por defecto).
2. Backup de `SyncService.php` real (§7.2).
3. `docker compose cp` del ZIP al contenedor.
4. `bin/command extension --file=...`.
5. `sha256sum` del `SyncService.php` recién desplegado — debe coincidir
   con §3.1.

### 7.5 Rebuild

No es necesario ningún rebuild de assets de cliente (`clearCache`/`rebuild`
de metadata) porque este cambio no toca `Resources/metadata/` ni
`clientDefs/` — es lógica de servidor pura. Se recomienda igualmente un
`bin/command clear-cache` como parte estándar de cualquier despliegue de
extensión, sin que sea estrictamente indispensable aquí.

### 7.6 Verificación viva tras el despliegue — sin crear ningún Meeting

**Corrección respecto a una versión anterior de este documento**: la
versión previa de esta sección proponía crear y luego soft-eliminar un
"Meeting de prueba desechable" y la llamaba, contradictoriamente,
"pruebas no destructivas... en modo estrictamente de lectura" — crear y
borrar un registro real no es una prueba de solo lectura, aunque el
registro sea desechable. Queda corregido: **la verificación de esta
puerta no crea ningún Meeting**, ni de prueba ni de otro tipo.

En su lugar, la verificación reutiliza el **Fixture A ya soft-deleted**
(`6a7cf117522f19bcf`, soft-eliminado durante el Bloque de limpieza de la
Puerta 5A —`docs/fase4b-puerta5a-limpieza-propuesta.md` §12— y sin tocar
desde entonces) como objeto de una única invocación directa y controlada
del código ya desplegado:

```php
$syncService->pushMeeting('6a7cf117522f19bcf', SyncService::ACTION_DELETE);
```

invocada una sola vez, vía un script PHP ejecutado con
`Application::setupSystemUser()` (mismo patrón que el resto de esta
sesión), **nunca** a través de la API REST, **nunca** a través de
`GcsPush`/hooks, **nunca** encolando ningún `Job` — es una llamada directa
al método de la clase ya cargada por el propio proceso, no una operación
que EspoCRM registre como transacción HTTP ni como job.

#### 7.6.1 Por qué esta invocación es localmente inerte para este Fixture — análisis previo obligatorio

Antes de ejecutar, se traza el código desplegado (idéntico al ya
verificado en el repositorio y en el ensayo desechable, §3/§5) contra el
estado real conocido de `6a7cf117522f19bcf`:

1. `pushMeeting()` obtiene la cuenta Business (`getBusinessAccount()`,
   solo lectura) y comprueba que tiene `calendarId` — si no lo tuviera,
   retorna de inmediato, también inerte, aunque por un motivo distinto.
2. `getEntityById('Meeting', '6a7cf117522f19bcf')` — el ORM excluye
   `deleted=1` por defecto (`BaseQueryComposer.php`, sin `withDeleted()`):
   como el Fixture A ya está soft-deleted, esta llamada devuelve `null`.
3. `isExcludedFromSync(null, ACTION_DELETE)` — con `action===ACTION_DELETE`
   retorna `false` en la primera línea (nunca llega a evaluar el Meeting,
   que de todas formas es `null`) — no bloquea, continúa.
4. `processPush()` recalcula `$meeting=null`, `$mustDelete=true` (por
   `action===ACTION_DELETE`, ya verdadero antes de evaluar `!$meeting`) →
   delega en `processDelete()`.
5. `processDelete()` consulta `GcsEventLink` para
   `meetingId=6a7cf117522f19bcf` — **0 filas, confirmado repetidas veces
   en esta sesión** (auditoría de cierre, precondiciones de la limpieza,
   verificación posterior al soft-delete). `count($links) === 0` →
   `return false` inmediato. **Ningún cliente de Google se crea. Ninguna
   llamada a `TokenService`/OAuth ocurre.**
6. `pushMeeting()` recibe `$touchedGoogle=false` → retorna sin tocar
   `GcsAccount`.

**Conclusión del análisis**: con el estado real ya confirmado (0
`GcsEventLink` para este Fixture, mismo hecho verificado múltiples veces
en esta sesión y revalidado de nuevo en §7.6.2 inmediatamente antes de
ejecutar), esta invocación no puede producir ninguna escritura salvo que
el estado real haya cambiado desde la última lectura — por eso el paso
0 de la ejecución revalida `GcsEventLink=0` una última vez, en el mismo
momento, antes de invocar.

Esta llamada **no cambia el Fixture**: no hay ningún campo de negocio que
tocar (`cEstadoReserva`, `status`, `deleted` no se leen ni escriben en
esta ruta salvo la lectura de existencia en el paso 2), y `processDelete`
sin vínculos no escribe nada en absoluto.

#### 7.6.2 Procedimiento exacto

0. **Revalidación inmediata**: `GcsEventLink` para
   `meetingId=6a7cf117522f19bcf` — debe seguir siendo `0`. Si no lo es,
   **no se ejecuta la invocación** — ver §7.6.4.
1. Capturar snapshot "antes" (sin secretos): `GcsAccount.id/status`,
   hash seguro de `lastError`, `lastSyncAt`, `tokenExpiresAt` (solo la
   fecha, nunca el token); conteo y IDs de `GcsEventLink`; conteo/estado
   de `job` (todas las clases, no solo GCS); snapshot no-PII de todos los
   Meetings activos y soft-deleted (mismos campos que el snapshot de la
   Puerta 5A: `id, c_estado_reserva, status, c_motivo_resolucion_reserva,
   modified_at, deleted`); marcador de tiempo UTC exacto antes de invocar.
2. Ejecutar la invocación única de §7.6 (nunca en un bucle, nunca
   repetida "por si acaso").
3. Capturar snapshot "después" con los mismos campos exactos.
4. Comparar campo a campo.

#### 7.6.3 Expectativa contractual exacta

- Retorno sin excepción.
- `GcsAccount` byte/valor-equivalente en todos los campos comprobados:
  `status`, hash de `lastError`, `lastSyncAt`, `tokenExpiresAt`.
- Cero líneas de log nuevas de refresco/error OAuth con timestamp
  posterior al marcador del paso 1.
- Cero `GcsEventLink` nuevo o eliminado.
- Cero filas nuevas en `job` (ninguna clase, no solo `GcsPushEvent` —
  esta invocación no pasa por ningún `JobScheduler`).
- Cero cambios en cualquier Meeting, incluido el propio Fixture A
  (`deleted` sigue en `1`, ningún otro campo se toca).
- Fixture B sin ninguna relación con esta invocación (no se referencia su
  ID en ningún punto del procedimiment).
- Tiempo de ejecución compatible con un no-op local puro — del orden de
  milisegundos, sin ninguna latencia de red (el ensayo desechable de §5.2
  ya estableció la referencia: ~1 ms sin red intentada, ~13-17 ms cuando
  sí hubo un intento de conexión real).

#### 7.6.4 Si el análisis previo no puede confirmar inercia, o la revalidación del paso 0 diverge

Si `GcsEventLink` para este Fixture ya no es `0` en el momento de
ejecutar, o si cualquier otro hecho del análisis de §7.6.1 ya no coincide
con el estado real (p. ej. la cuenta Business cambiara de tipo o
desapareciera), **la invocación no se ejecuta**. La verificación de esta
puerta se limita entonces a: hashes de archivos (§4.2 de la instalación),
resultado de la suite de pruebas (§4/§5), y lectura del estado —
exactamente lo que ya está cubierto por el resto de este documento — y se
reporta la razón exacta por la que no se ejecutó la invocación viva, como
una desviación del plan, no como un fallo silencioso.

### 7.7 Verificación de `GcsAccount`

Antes y después del despliegue, por lectura directa (nunca `SELECT *`,
nunca exponer tokens):

```sql
SELECT id, status, LEFT(last_error, 120) FROM gcs_account;
```

Debe ser **idéntico** antes y después del propio despliegue (el
despliegue en sí no ejecuta ningún `pushMeeting`) — cualquier cambio aquí,
fuera de la prueba controlada de §7.6, es una condición de parada.

### 7.8 Condiciones de parada

- El hash del `SyncService.php` desplegado no coincide con §3.1.
- `app-check` no queda verde tras el despliegue.
- El paso 0 de §7.6.2 encuentra `GcsEventLink>0` para el Fixture A en el
  momento de verificar — la invocación de §7.6 no se ejecuta (§7.6.4), y
  se reporta como desviación, no como fallo del despliegue en sí.
- La invocación de §7.6 muestra cualquier cambio en `GcsAccount`, en
  `GcsEventLink`, en cualquier `job`, o en cualquier Meeting (incluido el
  propio Fixture A).
- Cualquier Meeting real, de cualquier tipo, resulta afectado — esta
  puerta no crea ni modifica ningún Meeting bajo ninguna circunstancia.
- Cualquier llamada real observada hacia Google durante la verificación.
- `bin/command extension` reporta cualquier error o advertencia no
  esperada.

### 7.9 Estado esperado posterior

- `SyncService.php` real actualizado, hash coincidente con §3.1.
- Resto de la extensión sin cambio funcional.
- `app-check` verde.
- `GcsAccount` (cuenta Business real) exactamente igual que antes del
  despliegue — mismo `status=Error`, mismo `last_error` heredado del
  incidente OAuth ya conocido (este despliegue no lo corrige; sigue
  requiriendo la reconexión OAuth deliberada ya señalada como pendiente
  operativo separado en `fase4b-puerta5-propuesta-v3.md` §0.5).
- Los 4 `GcsEventLink` reales, las 4 filas de idempotencia, el Fixture A
  nuevo y el Fixture antiguo (ambos soft-deleted, sin ningún cambio de
  ningún campo), el usuario y equipo técnico: sin cambio.
- Fixture B: activo, sin tocar, sin ninguna relación con este despliegue.
- Cero Meetings nuevos creados por esta puerta, en ningún momento.

### 7.10 Reanudación de la limpieza del Fixture B — autorización separada

Este documento **no autoriza** retomar el soft-delete del Fixture B
(`6a7cf18e8d7531711`). Tras un despliegue exitoso de esta Puerta 6C,
retomar esa limpieza requiere:

1. Confirmación de que este despliegue se completó y verificó (§7.6–§7.9).
2. Una autorización explícita y separada, específica para el Fixture B,
   idéntica en rigor a la que ya cubrió al Fixture A —
   `docs/fase4b-puerta5a-limpieza-propuesta.md` §12.1 (revalidar las 15
   precondiciones inmediatamente antes de escribir, backup propio o
   reutilización justificada del ya existente, verificación inmediata
   post-soft-delete).
3. Con la corrección desplegada, el soft-delete de B debería completarse
   sin ningún intento de OAuth (mismo caso que el Fixture A: 0
   `GcsEventLink`) — pero esa expectativa se verifica en el momento, no se
   asume.

---

## 8. Ejecución real — desplegada y verificada (2026-08-13)

**Estado: DESPLEGADA Y VERIFICADA.** Autorizada explícitamente el
2026-08-13, con la corrección documental de §7.6 aplicada antes de
ejecutar (versión de este documento anterior a esta sección).

### 8.1 Precondiciones

Las 15 precondiciones exigidas se revalidaron por lectura directa contra
`gapssa-espocrm-1` real inmediatamente antes de escribir — todas en
verde: `app-check` verde, `maintenanceMode=NULL`,
`gapssaBookingDecisionEnabled=false`, `ESPO_BOOKING_ADAPTER=simulated`,
`gcsSyncStartAt="2026-08-04 16:32:05"` intacto, `GcsAccount`
(`6a720ca88062944a7`) en `status=Error` con el mismo `last_error` del
incidente de la Puerta 5A (hash sin cambio), extensión real instalada
(`Google Calendar Sync` v1.2.0, ID `6a7c85ea33e2f13b5` antes del
despliegue), hash vivo de `SyncService.php` confirmado
(`a3654179fc212350a9958caaaafb08008cc52c1b20eb71b5c25fc3c5ea1ea1ea`,
versión previa a esta corrección), Fixture A (`6a7cf117522f19bcf`)
soft-deleted/`Confirmed`/`Planned`/excluido/0 vínculos/job terminal, Fixture
B (`6a7cf18e8d7531711`) activo/`Canceled`/`Not Held`/excluido/0 vínculos,
Fixture antiguo (`6a7c63799527a4746`) soft-deleted e intacto, 4 filas de
idempotencia, `gcs_event_link=4`, ACL/usuario técnico/equipo técnico
intactos, cero jobs GCS nuevos/pendientes/reintentables.

### 8.2 Backup

`data/.backup/gapssa/puerta6c/20260813T085349Z/`, propietario
`www-data:www-data`, modo `700`/`600`. Contenido: `SyncService.php.bak`
(copia exacta pre-despliegue) + su SHA-256, `full-inventory.sha256` (hash
de los 895 archivos vivos de la extensión antes de instalar),
`db-snapshot-before.txt` (Fixtures, conteos, idempotencia,
`GcsEventLink`, `GcsAccount.id/status`, sin secretos ni PII), `README.md`
con procedimiento de rollback. `full-inventory-after.sha256` añadido tras
el despliegue para la comparación de §8.4.

### 8.3 Build, test, lint

`make gcs-build`, `make gcs-test`, `make gcs-lint`: los tres en verde.
Suite completa del ZIP: 10 comprobaciones, todas `OK`, incluida
`EXCLUSIÓN GCS (SyncService): OK (38 aserciones)`. `php -l` sin errores.
Hash del `SyncService.php` dentro del ZIP construido:
`acebf18373aafaede1ae35ba230ec2e6d278d1ea102bc85a779909ccd34e56eb` —
coincide exactamente con §3.1.

### 8.4 Instalación

1. Hash del `SyncService.php` vivo revalidado inmediatamente antes de
   instalar — sin cambios desde el backup (§8.2).
2. `maintenanceMode` activado vía `ConfigWriter` (`true`), confirmado por
   lectura directa.
3. ZIP copiado al contenedor; hash del ZIP en el host y dentro del
   contenedor coincidentes
   (`d1b840efd003e39bec90dc536a2a718d8b5ab814e9b885abd623e341e89321ec`).
4. `bin/command extension --file=...` — instalación correcta.
   **`extension.id` cambió de `6a7c85ea33e2f13b5` a
   `6a7d8686d91a8e4b4`** — registrado como hecho operativo, esperado (todo
   reinstalado como paquete nuevo cada vez, id.a asignada por EspoCRM en
   cada instalación).
5. **Verificación byte a byte de los 895 archivos**: se comparó el
   inventario de hashes de antes (§8.2) contra un inventario idéntico
   generado inmediatamente después de instalar. **Única línea distinta:
   `SyncService.php`** (hash pre-despliegue → hash de §8.3). Los otros 894
   archivos, exactamente el mismo contenido — confirma la advertencia del
   encargo: el instalador reescribe el paquete completo por `mtime`, pero
   el contenido de todo salvo `SyncService.php` es idéntico.
6. `php -l` sobre todos los `.php` propios de la extensión (excluyendo
   `vendor/`): sin errores. JSON de metadata comprobado (`GcsAccount.json`
   parsea correctamente).
7. `app-check`: `Migration not needed: OK`, `Database: OK`, `Not in
   maintenance mode: FAIL` (esperado — `maintenanceMode` seguía activo a
   propósito en este punto), `Cron is enabled: OK`. Sin necesidad de
   ningún `rebuild`.
8. `bin/command clear-cache` ejecutado sin errores.

### 8.5 Verificación viva sin crear Meetings

Procedimiento exacto de §7.6.2, sobre el Fixture A ya soft-deleted:

- Paso 0: `GcsEventLink` para `6a7cf117522f19bcf` revalidado en `0`
  inmediatamente antes de invocar.
- Snapshot "antes": `GcsAccount.status=Error`, hash de `lastError`
  (`61a036d9...`), `lastSyncAt`/`tokenExpiresAt` de agosto (sin relación
  con el incidente — la propia cuenta nunca se ha reconectado, pendiente
  operativo aparte, §7.9), `GcsEventLink` total `4` (los mismos 4 IDs de
  siempre, ninguno del Fixture A), `job` con clase GCS: `13` filas totales,
  `max(number)=108975`, Meetings: hash SHA-256 del snapshot no-PII
  completo de las 13 filas reales (`7c10b44c...`).
- Invocación única: `SyncService::pushMeeting('6a7cf117522f19bcf',
  SyncService::ACTION_DELETE)`, vía script con
  `Application::setupSystemUser()`, sin pasar por la API REST ni por
  ningún hook/`JobScheduler`.
- **Resultado**: sin excepción, `3 ms` de duración — compatible con un
  no-op local puro (el ensayo desechable de §5.2 midió `~1 ms` sin red
  intentada frente a `~13-17 ms` cuando sí hubo un intento de conexión
  real).
- Snapshot "después": `GcsAccount` — `status`, hash de `lastError`,
  `lastSyncAt`, `tokenExpiresAt`: **los cuatro exactamente idénticos** al
  "antes". `GcsEventLink`: mismos `4` IDs, sin ningún cambio. Jobs con
  clase GCS: siguen en `13` — **cero jobs nuevos**; la búsqueda específica
  de jobs que referencian `6a7cf117522f19bcf` en su `data` sigue
  mostrando únicamente los 2 ya conocidos de antes de esta sesión (el
  `NotifyAboutAssignment` de la creación del Fixture y el `GcsPushEvent`
  terminal del incidente de la Puerta 5A) — ninguno nuevo. Meetings: hash
  SHA-256 del mismo snapshot, **idéntico byte a byte** al "antes" —
  confirmado también con `diff` (sin salida). `max(number)` del `job`
  avanzó de `108975` a `108981` — actividad rutinaria de cron ajena a GCS
  (ninguna de esas filas nuevas es de clase `GoogleCalendarSync`, y
  ninguna referencia al Fixture A), coherente con un sistema vivo con
  cron activo, no atribuible a esta invocación.
- **Evidencia de cero OAuth/Calendar**: ausencia total de cambio en
  `GcsAccount` (ni siquiera el timestamp), ausencia de cualquier fila de
  `job` nueva de clase GCS, y el propio flujo del código desplegado
  (§7.6.1) — `processDelete()` encontró `0` vínculos y retornó antes de
  la línea `createCalendarService`, exactamente como predijo el análisis
  previo y como demostró el ensayo desechable contra el mismo escenario.

### 8.6 Cierre

- `maintenanceMode` restaurado a su preimagen exacta (`NULL`/ausente, vía
  `ConfigWriter->remove()`, no `set(false)`) — confirmado por lectura
  directa.
- `app-check` final: **verde en las cuatro comprobaciones**, incluida
  `Not in maintenance mode: OK`.
- Hash final de `SyncService.php` vivo:
  `acebf18373aafaede1ae35ba230ec2e6d278d1ea102bc85a779909ccd34e56eb` —
  coincide con §3.1/§8.3.
- Conteos finales, todos coincidentes con el estado previo al
  despliegue: Meetings activos `8` / soft-deleted `5` (sin cambio),
  idempotencia `4` filas, `gcs_event_link=4`, ACL de
  `cExcluirGoogleCalendarSync` en ambos roles sin cambio, usuario técnico
  activo, equipo técnico con `3` miembros, `gapssaBookingDecisionEnabled=false`,
  `ESPO_BOOKING_ADAPTER=simulated`.
- Fixture A: soft-deleted, sin cambio de ningún campo. Fixture B: activo,
  sin tocar. Fixture antiguo: soft-deleted, intacto.
- Cero Meetings creados en ningún momento de esta puerta.
- Cero commits.

### 8.7 Desviaciones respecto al plan

Ninguna. Todo el procedimiento se ejecutó exactamente como quedó
documentado tras la corrección de §7.6 — incluida la decisión de no
optimizar `GcsPush::afterRemove()` (§3), que se mantuvo sin cambios.

### 8.8 Limpieza del Fixture B

**Sigue sin autorizar.** No se ha tocado `6a7cf18e8d7531711` en ningún
momento de esta puerta — confirmado en los snapshots de §8.5 y en los
conteos de §8.6. Requiere la autorización explícita y separada descrita
en §7.10.

---

**Puerta 6C cerrada y verificada.** La corrección está desplegada en
`gapssa-espocrm-1` real, verificada sin crear ningún Meeting nuevo. La
limpieza del Fixture B y la Puerta 5B permanecen sin iniciar, a la espera
de autorización explícita y separada.

### 8.9 Referencia — resultado real de la limpieza del Fixture B (2026-08-13)

Autorizada por separado el mismo día y ejecutada según §7.10 de este
documento. Resultado real, sin modificar la propuesta original de arriba:
`processDelete()` encontró 0 `GcsEventLink` para el Fixture B y retornó
antes de crear ningún cliente de Google — cero OAuth, cero Calendar,
`GcsAccount` sin ningún cambio, job terminado en `Success`. Detalle
completo (precondiciones, timestamps, verificación campo a campo):
`docs/fase4b-puerta5a-limpieza-propuesta.md` §13.
