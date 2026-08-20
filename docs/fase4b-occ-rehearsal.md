# Fase 4B — Ensayo OCC del guard PHP en una instancia EspoCRM desechable

Ensayo del punto 8 del encargo original de Fase 4B, diferido explícitamente en
`docs/fase4b-revision-3.md` §12 y `docs/fase4b-revision-4.md` (puerta 5 de
`docs/fase4b-revision-4.md` §8). Objetivo único: demostrar empíricamente si
`GuardMeetingDecisionTransition.php` y `SyncEstadoReservaToStatus.php`
funcionan correctamente bajo EspoCRM 10.0.3 **antes** de autorizar su
despliegue real.

**Ningún dato, servicio, volumen, red, campo, API User ni credencial reales
se ha tocado.** Todo el ensayo corrió contra una instancia EspoCRM+MariaDB
completamente desechable, aislada por nombre de proyecto, red, volúmenes y
puertos del stack real `gapssa`. Sin commits — este documento y los ficheros
temporales del ensayo son el único rastro que queda; el entorno desechable
se ha eliminado por completo al terminar (§11).

**Conclusión anticipada (desarrollada en §9): BLOQUEADO.** El guard resuelve
correctamente la carrera de dos decisiones concurrentes (§6), pero introduce
un fallo de atomicidad distinto y real: su escritura condicional se confirma
en la base de datos de forma independiente del resto del guardado, así que
un fallo posterior dentro de la misma petición dejaba una "decisión
fantasma" — `cEstadoReserva` cambiado en la base de datos aunque la petición
HTTP hubiera fallado y el resto de la operación (incluida su atribución:
`modifiedById`/`modifiedAt`, y cualquier otro campo de la misma petición)
nunca se persistiera. La corrección obvia a nivel de metadato
(`transactionalSave: true`) se probó y **no resuelve el problema** — la
razón, verificada contra el código fuente real de EspoCRM 10.0.3, está en
§7.

## 1. Topología exacta del entorno desechable

Proyecto Docker Compose separado, sin relación con el proyecto real
`gapssa` (`compose.yml` de la raíz del repo):

| | Real (`gapssa`) | Desechable (este ensayo) |
|---|---|---|
| Proyecto Compose | `gapssa` | `gapssa-occ-rehearsal` |
| Contenedores | `gapssa-espocrm-1`, `gapssa-espocrm-db-1`, ... | `gapssa-occ-rehearsal-espocrm-1`, `gapssa-occ-rehearsal-espocrm-db-1` |
| Red | `gapssa_public`, `gapssa_private` | `gapssa-occ-rehearsal-net` (única, sin conexión a las redes reales) |
| Volúmenes | `gapssa_espocrm-db`, `gapssa_espocrm-data`, `gapssa_espocrm-custom`, `gapssa_espocrm-client-custom` | `gapssa-occ-rehearsal-db`, `gapssa-occ-rehearsal-data`, `gapssa-occ-rehearsal-custom`, `gapssa-occ-rehearsal-client-custom` |
| Puerto HTTP | `8081` (`0.0.0.0`) | `18081`, atado solo a `127.0.0.1` |
| Base de datos | `espocrm` (usuario `espocrm`) | `occ_rehearsal` (usuario `occ_rehearsal`) |
| Credenciales admin | reales, en `.env` (nunca leído por este ensayo) | generadas con `openssl rand -hex 12`, exclusivas de esta instancia, nunca reutilizadas |
| Fichero compose | `compose.yml` (raíz) | `compose.occ-rehearsal.yml` (scratchpad de la sesión, no versionado) |

Solo se levantaron los dos servicios imprescindibles: `espocrm` y
`espocrm-db` (sin `espocrm-daemon`/`espocrm-websocket`, innecesarios para
probar hooks `beforeCreate`/`beforeUpdate` vía API síncrona). Cada servicio
con su propio healthcheck independiente (`healthcheck.sh --connect
--innodb_initialized` para MariaDB, `bin/command app-check` para EspoCRM).

`docker compose -p gapssa-occ-rehearsal -f compose.occ-rehearsal.yml
--env-file .env config` se validó antes de levantar nada (`CONFIG_OK`).

Antes de eliminar cualquier recurso al final del ensayo (§11) se enumeraron
y confirmaron uno por uno como pertenecientes solo a `gapssa-occ-rehearsal`
— nunca se usó `docker system prune` ni ningún comando que pudiera alcanzar
recursos de otros proyectos (`gapssa`, `rodnorcrm`, u otros presentes en la
máquina).

## 2. Versiones

- `espocrm/espocrm:10.0.3-apache-trixie` — misma imagen exacta que la
  instancia real (`.env.example`: `ESPOCRM_IMAGE`).
- `mariadb:11.4` — misma imagen exacta que la instancia real
  (`.env.example`: `ESPOCRM_DB_IMAGE`).
- PHP 8.4.23 (cli, NTS) — el del propio contenedor de la imagen anterior.
- Docker 29.2.1 / Docker Compose v5.0.2 (host).

## 3. Incidencia inicial de arranque (documentada, resuelta)

El primer arranque del contenedor `espocrm` fallaba silenciosamente
(`exit 1`, un único log: `info: Running "install" action.`, sin más
detalle). Traza con `bash -x` del propio
`/usr/local/bin/docker-entrypoint.sh` del contenedor: el script de
instalación oficial de la imagen ejecuta siempre `bin/command set-password
admin` (usuario **literal** `admin`, no `$ESPOCRM_ADMIN_USERNAME`) tras
`bin/command create-admin-user "$ESPOCRM_ADMIN_USERNAME"`. Al haber usado
inicialmente un nombre de usuario propio (`occ_rehearsal_admin`) para
reforzar el aislamiento, ese paso fallaba (usuario `admin` inexistente) sin
que el `set -euo pipefail` del script imprimiera ningún mensaje adicional.
Corrección: `ESPOCRM_ADMIN_USERNAME=admin` en el `.env` desechable — mismo
valor que usa el `.env.example` real, pero en una base de datos y
contenedor completamente distintos, así que no supone ninguna colisión de
credenciales. Documentado aquí porque es una peculiaridad real de la imagen
oficial de EspoCRM 10.0.3, no un problema de este ensayo.

## 4. Metadata y hooks instalados (mínimo imprescindible, documentado)

Se instaló **solo** lo necesario para este ensayo, nunca una copia completa
de `extensions/espocrm/custom`:

- `Espo\Custom\Classes\RecordHooks\Meeting\GuardMeetingDecisionTransition`
- `Espo\Custom\Classes\RecordHooks\Meeting\SyncEstadoReservaToStatus`
- `Espo\Custom\Classes\RecordHooks\Meeting\MeetingDecisionTransitionPolicy`
  (dependencia pura de Guard)
- `Espo\Custom\Classes\RecordHooks\Meeting\EstadoReservaStatusMap`
  (dependencia pura de Sync)

Copiados **byte a byte, sin modificar**, desde
`extensions/espocrm/custom/Espo/Custom/Classes/RecordHooks/Meeting/` del
repositorio.

`entityDefs/Meeting.json` desechable: **solo** `cEstadoReserva` (enum
idéntico al real) y `cBookingRequestId` (`varchar(36)`, índice único —
modela la puerta 2 pendiente de `docs/fase4b-revision-4.md` §8 para este
ensayo). Se omitieron deliberadamente `cTratamiento`/`cZonaAtencion` (las
entidades `CTratamiento`/`CZonaAtencion` no existen en la instancia
desechable — no aportan nada a este ensayo) — ver diferencias en §10.

`recordDefs/Meeting.json` desechable: **solo** el registro de
`GuardMeetingDecisionTransition` + `SyncEstadoReservaToStatus` en
`beforeUpdateHookClassNameList`, y `SyncEstadoReservaToStatus` en
`beforeCreateHookClassNameList` — se omitieron
`SendInvitationsAfterCreate`/`SendInvitationsAfterUpdate` (envío de correo,
irrelevante para este ensayo y con riesgo de efectos secundarios no
deseados en un entorno sin SMTP configurado).

```bash
docker cp <hooks .php> gapssa-occ-rehearsal-espocrm-1:/var/www/html/custom/Espo/Custom/Classes/RecordHooks/Meeting/
docker cp <entityDefs/recordDefs Meeting.json> gapssa-occ-rehearsal-espocrm-1:/var/www/html/custom/Espo/Custom/Resources/metadata/...
docker exec gapssa-occ-rehearsal-espocrm-1 chown -R www-data:www-data /var/www/html/custom
docker exec gapssa-occ-rehearsal-espocrm-1 bin/command rebuild
docker exec gapssa-occ-rehearsal-espocrm-1 bin/command app-check
```

**`php -l` sobre los 4 ficheros, con el PHP del propio contenedor**: sin
errores de sintaxis, los cuatro. `bin/command rebuild`: `Rebuild has been
done.`. `bin/command app-check`: las 4 comprobaciones en verde
(`Migration not needed`, `Database`, `Not in maintenance mode`, `Cron is
enabled`).

**Confirmación de que la base de datos reflejó la metadata**
(`SHOW COLUMNS FROM meeting`): `c_estado_reserva varchar(100)`,
`c_booking_request_id varchar(36)` con clave `UNI` (índice único real).

## 5. Registro y ejecución de los hooks — confirmado

Creación de un Meeting ficticio (`cEstadoReserva: RequestReceived`) vía
`POST /api/v1/Meeting`: la respuesta trae `status: "Planned"` — el hook
`beforeCreate` (`SyncEstadoReservaToStatus`) se ejecutó y mapeó
correctamente. Confirmado también con `Completed`→`Held` y
`Canceled`→`Not Held` durante la matriz de §6.

**Orden efectivo `Guard` → `Sync`, confirmado indirectamente pero sin
ambigüedad**: en cada transición rechazada por `Guard` (409, matriz de §6)
el `status` en base de datos permaneció exactamente igual al de antes de la
petición — si `Sync` se hubiera ejecutado de todos modos (orden inverso, o
`Guard` no abortando el resto de la cadena), el `status` habría cambiado
igualmente aunque `cEstadoReserva` no lo hiciera. Nunca ocurrió: la
excepción de `Guard` aborta el guardado completo, `Sync` nunca llega a
ejecutarse en una transición rechazada.

## 6. Matriz completa de transiciones (12 estados origen × 2 decisiones)

Cada fila: Meeting recién creado en el estado origen indicado (vía
`POST`, nunca arrastrado de una fila anterior), un único `PUT
cEstadoReserva=<destino>`, lectura directa de MariaDB tras la respuesta
(nunca vía la propia API, para no depender de que el mapeo de lectura
oculte una inconsistencia).

| Origen | Destino | HTTP | `cEstadoReserva` final | `status` final |
|---|---|---|---|---|
| RequestReceived | Confirmed | 409 | RequestReceived (sin cambio) | Planned |
| RequestReceived | Canceled | 409 | RequestReceived (sin cambio) | Planned |
| PendingGuardianAuthorization | Confirmed | 409 | sin cambio | Planned |
| PendingGuardianAuthorization | Canceled | 409 | sin cambio | Planned |
| PendingAssessment | Confirmed | 409 | sin cambio | Planned |
| PendingAssessment | Canceled | 409 | sin cambio | Planned |
| **PendingCenterApproval** | **Confirmed** | **200** | **Confirmed** | **Planned** |
| **PendingCenterApproval** | **Canceled** | **200** | **Canceled** | **Not Held** |
| Confirmed | Confirmed (mismo valor) | 200* | Confirmed | Planned |
| Confirmed | Canceled | 409 | sin cambio (Confirmed) | Planned |
| ClientArrived | Confirmed | 409 | sin cambio | Planned |
| ClientArrived | Canceled | 409 | sin cambio | Planned |
| InTreatment | Confirmed | 409 | sin cambio | Planned |
| InTreatment | Canceled | 409 | sin cambio | Planned |
| Completed | Confirmed | 409 | sin cambio | Held |
| Completed | Canceled | 409 | sin cambio | Held |
| Canceled | Confirmed | 409 | sin cambio | Not Held |
| Canceled | Canceled (mismo valor) | 200* | Canceled | Not Held |
| NoShow | Confirmed | 409 | sin cambio | Not Held |
| NoShow | Canceled | 409 | sin cambio | Not Held |
| RescheduleRequested | Confirmed | 409 | sin cambio | Planned |
| RescheduleRequested | Canceled | 409 | sin cambio | Planned |
| ScheduleConflict | Confirmed | 409 | sin cambio | Planned |
| ScheduleConflict | Canceled | 409 | sin cambio | Planned |

`*` — pedir el mismo valor que el Meeting ya tiene no cambia
`isAttributeChanged('cEstadoReserva')`, así que `Guard` nunca se dispara
(comportamiento correcto y documentado en el propio código: no es un
escenario de carrera, es un no-op idempotente; no se "salta" ninguna
protección real).

**Conclusión de la matriz**: `Guard` acepta la transición **únicamente**
cuando el origen real en base de datos es `PendingCenterApproval` — las 22
combinaciones restantes se rechazan con 409, **sin ningún cambio parcial**
(ni `cEstadoReserva` ni `status` se tocan). Exactamente el comportamiento
pretendido por `MeetingDecisionTransitionPolicy`.

**Comprobaciones adicionales**:

- **Cambio manual de `status` nunca inventa `cEstadoReserva`**: Meeting con
  `cEstadoReserva=Confirmed`, `PUT {"status":"Held"}` (sin tocar
  `cEstadoReserva`) → `200`, `cEstadoReserva` sigue `Confirmed` en base de
  datos, `status` pasa a `Held`. `Sync` nunca lee `status` para decidir
  nada — confirmado.
- **Valor de enum desconocido falla cerrado**: Meeting en
  `PendingCenterApproval`, `PUT {"cEstadoReserva":"EstadoInventado"}` →
  `400` (`validationFailure`, `field: cEstadoReserva`, capa de validación
  nativa de EspoCRM, antes de que corra ningún hook), base de datos sin
  ningún cambio.

## 7. Concurrencia HTTP real

Meeting fresco en `PendingCenterApproval` por repetición, dos peticiones
`PUT` lanzadas **realmente en paralelo** (procesos `curl` en segundo plano
del mismo shell, `wait`).

**Escenario 1 — Confirmed vs. Canceled simultáneos, 20 repeticiones**:
exactamente una de las dos gana en las 20 (`Confirmed` ganó 9, `Canceled`
ganó 11 — el orden de llegada real al motor de MariaDB decide, sin sesgo
fijo, tal como documenta el propio hook). **0/20** casos con ambas
aplicadas, **0/20** casos con ninguna aplicada. En cada repetición, el
`description` en base de datos coincide exactamente con el de la petición
ganadora — nunca una mezcla.

**Escenario 2 — dos peticiones IDÉNTICAS simultáneas (`Confirmed` vs.
`Confirmed`), 10 repeticiones**: **0/10** casos con las dos devolviendo
`200`. Siempre gana exactamente una (bloqueo de fila real a nivel de
MariaDB); la perdedora recibe `409` explícito aunque pidiera el mismo valor
final — nunca se trata como "inofensiva" por pedir lo mismo.

**Escenario 3 — aprobación vs. "caducidad" (Canceled con nota de barrido),
5 repeticiones**: mismo patrón, un único ganador por repetición, `note`
(`description`) del ganador persistido correctamente.

**Escenario 4 — decisión concurrente con una edición NO relacionada
(`name`), 5 repeticiones**: **5/5** con ambas peticiones devolviendo `200`
— el guard nunca bloquea una edición que no toca `cEstadoReserva`; ninguna
modificación legítima concurrente se pierde.

**Conclusión de concurrencia**: el guard cumple exactamente lo exigido —
ganador único, respuesta explícita y estable para la perdedora (409, nunca
un error genérico ni un 5xx), nunca una combinación incoherente entre
`status` y `cEstadoReserva`, sin pérdida de modificaciones ajenas, sin
efectos duplicados. Reproducible en las 40 repeticiones combinadas.

## 8. Atomicidad frente a un fallo posterior — FALLO CONFIRMADO

Mecanismo de fallo introducido **solo en la instancia desechable**
(`FailAfterGuardForOccRehearsalOnly.php`, nunca commiteado, eliminado al
terminar esta prueba): un tercer hook `beforeUpdate`, registrado **entre**
`Guard` y `Sync`, que lanza una excepción cuando `description` lleva un
centinela explícito (`INJECT_FAILURE_OCC_REHEARSAL`) — simula un fallo del
proceso justo después de que `Guard` haya hecho su `UPDATE` condicional
(que se confirma en MariaDB de forma independiente, fuera de cualquier
transacción) pero antes de que el `UPDATE` principal de EspoCRM persista el
resto de la entidad.

**Resultado**:

| | Antes | Petición | Después (consulta directa a MariaDB) |
|---|---|---|---|
| `cEstadoReserva` | `PendingCenterApproval` | `PUT {cEstadoReserva: Confirmed, description: INJECT_FAILURE_OCC_REHEARSAL}` → **HTTP 500** | **`Confirmed`** |
| `description` | `NULL` | (la petición pedía fijarlo) | `NULL` — nunca se escribió |
| `modifiedById` | `NULL` | | `NULL` — nunca se escribió |
| `modifiedAt` | = `createdAt` | | = `createdAt`, sin cambiar |

**El CAS y el resto de la operación NO revierten juntos.** El cliente
recibe un `500` — la interpretación razonable de cualquier llamador es "la
operación no tuvo efecto, es seguro reintentar o alertar sin más". Es
falso: `cEstadoReserva` cambió de verdad, de forma permanente, sin
atribución (`modifiedById` nulo) y sin el resto de la escritura que
debería haber ido junto a esa decisión. Una "decisión fantasma".

### 8.1. Intento de corrección — `transactionalSave: true` — NO RESUELVE EL PROBLEMA

Se probó la corrección obvia a nivel de metadato:
`entityDefs.Meeting.transactionalSave: true` (repetido `rebuild`, mismo
mecanismo de fallo, Meeting fresco). **Resultado idéntico**: `500`,
`cEstadoReserva` cambiado igualmente a `Confirmed`, `description` sigue sin
persistir. Una decisión posterior normal (sin el centinela) sobre el mismo
Meeting sigue funcionando bien (`200`, todos los campos persistidos) — el
flag no rompe nada, pero tampoco arregla la atomicidad.

## 9. Por qué falla — verificado contra el código fuente real de EspoCRM 10.0.3

`application/Espo/Core/Record/Service.php::update()` (dentro del propio
contenedor de la imagen oficial, lectura directa, nunca inventado):

```php
$this->getRecordHookManager()->processBeforeUpdate($entity, $params); // Guard + Sync corren AQUÍ
$this->beforeUpdateEntity($entity, $data);

$context = new SaveContext();
$this->entityManager->saveEntity($entity, [...]);                     // transactionalSave SOLO envuelve ESTA llamada
```

`application/Espo/ORM/Repository/RDBRepository.php::save()`:

```php
if ($this->transactionalSave) {
    $this->entityManager->getTransactionManager()->run(function () use ($entity, $options) {
        $this->saveInternal($entity, $options);
    });
} else {
    $this->saveInternal($entity, $options);
}
```

Los `RecordHooks` (`SaveHook`, incluidos `Guard` y `Sync`, registrados vía
`beforeUpdateHookClassNameList`) se ejecutan dentro de
`processBeforeUpdate()`, que corre **antes** y **fuera** de
`entityManager->saveEntity()`. `transactionalSave` solo envuelve el
`saveInternal()` interno del repositorio — nunca la fase de `RecordHooks`.
Por diseño de EspoCRM 10.0.3, ningún valor de `transactionalSave` puede
hacer que la escritura cruda de `Guard` (ejecutada durante
`processBeforeUpdate`) participe en la misma transacción que el `UPDATE`
principal (ejecutado después, dentro de `saveEntity`) — son, arquitectónicamente,
dos fases separadas del ciclo de guardado.

**Dato a favor de una corrección real, verificado pero no implementado
aquí**: `application/Espo/ORM/TransactionManager.php` usa un contador de
anidamiento (`private int $level = 0`; `start()`/`commit()`/`rollback()`
incrementan/decrementan `$level`, solo el nivel más externo hace el
`BEGIN`/`COMMIT`/`ROLLBACK` real en MariaDB) — es decir, **sí admite
transacciones anidadas/reentrantes**. Esto abre una vía de corrección real
(que `Guard` abra explícitamente la transacción con
`$this->entityManager->getTransactionManager()->start()` antes de su propio
`UPDATE`, en vez de dejarla implícita) — pero exige verificar, con su
propio ensayo dedicado, que algo en el ciclo de vida de la petición
cierra (`commit`/`rollback`) esa transacción abierta manualmente por un
`SaveHook` cuando el resto de la cadena de hooks + el guardado principal
termina (con éxito o con fallo) — extremo **no verificado** en este
ensayo. No se propone como solución lista para desplegar, solo como la
dirección técnica más prometedora para el siguiente ciclo de trabajo.

## 10. Compatibilidad con Google Calendar Sync

- `make gcs-test` (equivalente a `make gcs-build`, que ejecuta la suite
  local completa: `autoload_test.php`, `controller_test.php`,
  `i18n_test.php`, `mapper_test.php`, `relation_hook_test.php`,
  `contact_hook_test.php`, `contact_resolver_test.php`,
  `no_hardcoded_package_test.php`, `php -l` sobre el ZIP) — **todo en
  verde**, sin tocar ningún fichero de la extensión, sin credenciales ni
  conexión real a Google.
- Verificación adicional (no pedida explícitamente pero de bajo coste dado
  que la instancia desechable ya estaba en pie): se instaló el ZIP ya
  construido de Google Calendar Sync 1.1.1 en la instancia desechable
  (**sin cuenta conectada, sin OAuth, sin credenciales**) y se repitió una
  decisión `PendingCenterApproval → Confirmed`. Resultado idéntico al de
  antes de instalar la extensión (`cEstadoReserva`/`status` correctos), sin
  ningún job `GcsPush*` encolado (sin cuenta conectada, el hook `afterSave`
  de GCS no tiene nada que sincronizar) y sin ningún error nuevo en
  `data/logs/`. Ningún bucle, ninguna alteración indebida de `status`.

## 11. Seguridad del endpoint de decisión (revisión de código)

`apps/web/src/app/api/booking/v1/internal/decisions/route.ts` y
`.../internal/reviews/[id]/resolve/route.ts`:

- **Identidad/autorización**: cabecera `X-Internal-Api-Secret`, comparada
  con `timingSafeEqual` (`internalAuth.ts`) — nunca alcanzable desde el
  navegador ni desde código cliente. `401` antes de tocar cualquier lógica
  de negocio si falta o no coincide.
- **Payload**: esquemas `zod` cerrados (`decision: z.enum(['approved',
  'rejected'])`, `meetingId: z.uuid()`, longitudes acotadas) — un payload
  inesperado o un valor fuera del enum falla con `400` antes de llegar al
  adaptador. Confirmado también del lado EspoCRM en este ensayo (§6): un
  valor de `cEstadoReserva` desconocido falla cerrado, `400`, sin cambio
  parcial.
- **`409` contractual**: `decision_conflict` con `existingResolution`/
  `existingCEstadoReserva` — nunca sobrescribe una decisión incompatible ya
  asentada; la discrepancia queda para revisión humana
  (`SystemReconciliation`), nunca un error genérico.
- **Sin secretos/PII en logs**: `httpEspoAdapter.ts::request()` documenta y
  aplica explícitamente no registrar `Authorization`/`X-Api-Key` ni el
  cuerpo de la petición — solo método, ruta, estado HTTP y un
  `correlationId` opaco. Sin `console.log` en los ficheros revisados.
- **Riesgo nuevo, directamente ligado al hallazgo de §8**: si `Guard` se
  desplegara tal cual, una petición que recibe un error (401/400/500)
  podría, pese a todo, haber aplicado de verdad una decisión sobre el
  Meeting real — sin la atribución (`modifiedById`) ni el resto de campos
  de esa misma petición. Es un problema de integridad/auditabilidad
  además de uno de fiabilidad: el sistema podría llegar a tener una
  decisión de negocio real sin ningún registro atribuible de quién ni con
  qué nota la tomó. Refuerza la recomendación de bloqueo de §12 — no es
  solo "una petición falla", es "una petición falla y el sistema queda con
  un cambio no auditado".

## 12. Validación completa del repositorio

| Comando | Resultado |
|---|---|
| `docker compose config` (real, `compose.yml`) | válido, sin tocar servicios reales |
| `npm run typecheck` | limpio (`@gapssa/web`, `@gapssa/contracts`) |
| `npm run lint` | limpio, 0 errores/avisos |
| `npm run test` | **713/713** (`@gapssa/web`, 37 ficheros) + **98/98** (`@gapssa/contracts`) |
| `npm run test:integration` | **251/251**, 26 ficheros, contra Postgres real de desarrollo (`gapssa_booking`), sin tocar EspoCRM real |
| `npm run build` | compila limpio (Next.js 16.3.0, Turbopack), mismas rutas `internal/decisions`/`internal/reviews/**` en el manifiesto |
| `npm run test:e2e` | **43/43** (Playwright) |
| `php -l` sobre los 6 ficheros reales de `extensions/espocrm/custom/.../RecordHooks/Meeting/*.php` | sin errores, los 6 (con el PHP del contenedor `gapssa-espocrm-1` real, invocado solo como intérprete de lectura vía stdin — nunca se escribió nada en ese contenedor) |
| `make gcs-test` | verde (§10) |

Ningún fichero del repositorio se modificó como parte de este ensayo salvo
este mismo documento.

## 13. Diferencias respecto al EspoCRM real

- Sin `cTratamiento`/`cZonaAtencion` en el Meeting desechable (esas
  entidades no existen ahí) — irrelevante para los dos hooks bajo prueba.
- Sin `SendInvitationsAfterCreate`/`SendInvitationsAfterUpdate` registrados
  — evita efectos secundarios de correo en un entorno sin SMTP, irrelevante
  para el guard/sync.
- Decisiones probadas con autenticación Basic de administrador de la
  instancia desechable, no con un API User dedicado (puerta 3 de
  `docs/fase4b-revision-4.md` §8, todavía sin crear ni real ni en este
  ensayo) — el guard actúa a nivel de guardado de la entidad,
  independientemente de qué credencial dispara la petición, así que esta
  simplificación no afecta a lo que se estaba probando.
- `cBookingRequestId` con índice único ya aplicado en la instancia
  desechable (puerta 2), mientras que la real todavía no lo tiene — el
  ensayo lo adelanta para acercarse más al esquema previsto tras el
  despliegue.
- Sin `espocrm-daemon`/`espocrm-websocket` — no se ejecuta el cron/la cola
  de jobs de la instancia desechable; no fue necesario probar la sincronización
  con Google Calendar Sync en tiempo real (bastó con la suite local + una
  comprobación estática de coexistencia, §10).

## 14. Limitaciones de este ensayo

- El fallo inyectado en §8 simula UN punto de fallo concreto (justo tras el
  `UPDATE` de `Guard`). No se ha probado, por ejemplo, un fallo de MariaDB
  a mitad del propio `UPDATE` de `Guard` (ventana más estrecha, InnoDB
  debería garantizar atomicidad de esa única sentencia por sí sola — no se
  ha verificado explícitamente aquí).
- La vía de corrección esbozada en §9 (transacción abierta explícitamente
  por `Guard`) no se ha implementado ni probado — es una dirección, no una
  solución verificada.
- Concurrencia probada con 2 peticiones simultáneas (el escenario real:
  centro decide vs. barrido de expiración). No se ha probado con más de 2
  peticiones simultáneas sobre el mismo Meeting.

## 15. Conclusión

**BLOQUEADO.** No se autoriza copiar `GuardMeetingDecisionTransition.php`
tal cual está escrito hoy a la instancia real, ni registrar sus hooks allí,
hasta que el hallazgo de §8/§9 se corrija y se vuelva a ensayar en una
instancia desechable nueva con el mismo nivel de exigencia (sin adaptar los
criterios de este documento).

Lo que SÍ queda demostrado y no necesita repetirse en la próxima iteración:
la lógica de negocio de la tabla de transiciones (§6), la resolución
correcta de la carrera entre dos decisiones concurrentes cuando no hay un
fallo adicional de por medio (§7), la compatibilidad con Google Calendar
Sync (§10) y la seguridad del endpoint interno del BFF (§11) — el problema
está acotado exclusivamente a la falta de atomicidad entre la escritura
cruda de `Guard` y el resto del guardado de EspoCRM cuando algo falla
después.

## 16. Plan de las 5 escrituras reales pendientes (presentado, NO ejecutado)

Sin cambios de fondo respecto a `docs/fase4b-revision-4.md` §8 — se repite
aquí solo como referencia, ninguna se ejecuta como parte de este documento
ni de este ensayo:

1. Crear `Contact.cGapssaAccountId` en el EspoCRM real.
2. Crear `Meeting.cBookingRequestId` + índice único en el EspoCRM real.
3. Crear el API User dedicado en el EspoCRM real.
4. Copiar los hooks PHP al contenedor real + `bin/command rebuild` —
   **bloqueado por §15**: no debe ejecutarse hasta resolver el hallazgo de
   atomicidad.
5. Primera prueba de escritura end-to-end contra EspoCRM real.

Ninguno de estos 5 puntos se ejecuta sin tu aprobación expresa y punto por
punto, y el punto 4 específicamente queda bloqueado por este documento
hasta nueva corrección y nuevo ensayo.
