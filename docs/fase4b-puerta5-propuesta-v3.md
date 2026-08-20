# Puerta 5 — v3: propuesta operativa final (Puerta 5A, dividida en dos autorizaciones)

## Incidente — reanudación real del Bloque 5A-1, ejecución fallida y contenida (2026-08-12)

**La Puerta 5A queda bloqueada.** Este incidente reemplaza, para toda
reanudación futura, cualquier lectura del estado de más abajo que asuma que
comprobar `data/config.php` basta para verificar `gcsSyncStartAt`.

### 0.1 Qué pasó

Tras el cierre de la Puerta 3D (equipo técnico `Asignación Portal GAPSSA`,
`6a7c43c8ea6f5c370`, `assignmentPermission=team`) y la creación del usuario
técnico real `tecnico-puerta5-asignacion` (`6a7c5d4868f7a2699`, subpuerta de
`docs/fase4b-puerta5-gcs-fixtures.md` §7), se reanudó el Bloque 5A-1 con las
16 precondiciones de línea base revalidadas por lectura directa contra
`gapssa-espocrm-1` real — todas en verde, incluida `gcsSyncStartAt`
comprobada leyendo únicamente `data/config.php` (ausente ahí).

- `POST /api/v1/Meeting` (Fixture A) → `HTTP 200`. `id=6a7c63799527a4746`,
  `cBookingRequestId=puerta5-fixture-a-abea0916`,
  `cEstadoReserva=PendingCenterApproval`, `status=Planned`,
  `cMotivoResolucionReserva=NULL`, `assignedUserId` = usuario técnico,
  `name` ausente de la respuesta (ACL `{read:no}` respetada). Sin
  escritura parcial, sin duplicados.
- Al verificar el estado posterior a la creación se encontró un job
  `Espo\Modules\GoogleCalendarSync\Jobs\GcsPushEvent` (`action=upsert`)
  encolado y en estado `Failed`. **Causa raíz**: `gcsSyncStartAt` **sí**
  está activo — `2026-08-04 16:32:05` — pero vive en
  `data/config-internal.php`, no en `data/config.php`. El servicio
  `Espo\Core\Utils\Config` fusiona ambos ficheros (ver §0.2); leer solo
  `data/config.php`, como especificaba el Paso A original de este
  documento, produce un falso negativo. El hook `GcsPush::afterSave()` sí
  vio el flag activo (usa el mismo servicio `Config`) y encoló el job
  correctamente — el error estaba en la comprobación manual de la
  precondición, no en el código de la extensión.
- El job falló con `GoogleApiException 401: Error de OAuth: invalid_grant.
  Token has been expired or revoked.` (`TokenService.php:145`) — la cuenta
  Business de Google tiene el token OAuth caducado/revocado. **Ningún
  evento se creó ni actualizó en Google, ninguna fila `GcsEventLink` nueva
  se creó** (confirmado: 0 antes y después del intento) — el fallo ocurre
  en la fase de refresco de token, antes de cualquier llamada a la API de
  Calendar.
- **Bloque 5A-1 detenido de inmediato**: no se intentó el Fixture B.

### 0.2 Precedencia real de configuración — corrige el Paso A de este documento

`Espo\Core\Utils\Config::load()` fusiona, en este orden (cada fuente
posterior sobrescribe a la anterior), vía `Util::merge()`:

```
application/Espo/Resources/defaults/systemConfig.php   (defaults del sistema)
  → data/config.php                                     (config visible/editable)
  → data/config-internal.php                             (config interna, p. ej. gcsSyncStartAt)
  → data/config-override.php
  → data/config-internal-override.php
  → data/state.php
```

`ConfigWriter`/`OAuthService::handleCallback()` escriben `gcsSyncStartAt` en
`data/config-internal.php`, nunca en `data/config.php` — por eso la
Puerta 4/5A original nunca lo vio. **Toda precondición de cualquier puerta
futura que dependa de un valor de configuración debe leerlo a través del
servicio `Config` real** (`$container->get('config')->get('clave')`,
vía `bin/command` o un script PHP con `Application::setupSystemUser()`),
nunca mediante `include data/config.php` en solitario.

### 0.3 Diagnóstico de seguridad antes de contener (resumen)

Lectura del código real (`SyncService.php`, `GcsPush.php`) confirmó, antes
de escribir nada:

- `SyncService::processPush()` resuelve `$mustDelete=true` para cualquier
  Meeting que `getEntityById()` no encuentre — y el ORM (`BaseQueryComposer.php:605`)
  excluye `deleted=1` por defecto en toda consulta que no pida
  `withDeleted()`, incluida `getEntityById()`. Tras un soft-delete, **cualquier**
  intento de push para ese Meeting cae siempre en `deleteByLinks()`.
- `deleteByLinks()` solo llama a la API de Google por cada fila
  `GcsEventLink` existente para ese `meetingId`+`accountId`. Con **0**
  filas para el Fixture A, el bucle no ejecuta ninguna llamada — soft-delete
  no puede producir ninguna escritura real en Google para este fixture.
- `SyncService::sweep()` filtra `Meeting` por el mismo mecanismo ORM — tras
  el soft-delete, el Fixture A queda excluido de todo barrido futuro.
- El job de creación (`upsert`, `attempts=0`) y el nuevo job encolado por
  `afterRemove()` (`delete`) no se reintentan automáticamente: `QueueUtil::updateFailedJobAttempts()`
  solo reprograma jobs con `attempts>0`; ambos terminaron en `attempts=0`.

### 0.4 Contención ejecutada (autorización separada, exclusiva para el incidente)

- **Backup no sensible**: `data/.backup/gapssa/puerta5-incidente/20260812T122603Z/`
  (`www-data:www-data`, `600`/`700`), con snapshot del Fixture A, IDs/estados
  de sus jobs, conteos globales y configuración efectiva sin secretos.
  SHA-256 de cada fichero registrado en la entrega de la sesión.
- **Soft-delete nativo** del Fixture A (`6a7c63799527a4746`) vía
  `EntityManager::removeEntity()` (mismo mecanismo ORM que usa la API
  REST — nunca SQL directo, nunca `DELETE` físico).
- **Resultado verificado**: `Meeting` activos vuelve a **7**, soft-deleted
  pasa de 3 a **4** (únicamente el Fixture A), total **11**. Los 10
  `Meeting` reales preexistentes, byte-idénticos antes/después. `GcsEventLink`
  sigue en **4**, ninguno del Fixture A. El job `delete` encolado por el
  soft-delete falló por el mismo `invalid_grant` — mismo resultado sin
  escritura real — y quedó terminal (`attempts=0`, sin próxima ejecución,
  sin job pendiente/reintentable para este Meeting). Usuario técnico y
  equipo `Asignación Portal GAPSSA` intactos (3 miembros, 0 `role_team`).
  `gapssaBookingDecisionEnabled` sigue `false`. `ESPO_BOOKING_ADAPTER` sigue
  `simulated`. `app-check` verde. Cero commits.
- **No se tocó**: `gcsSyncStartAt`, ningún token/credencial OAuth,
  `ESPO_BOOKING_ADAPTER`, el interruptor global de GCS, ACL/roles/equipos,
  los 10 `Meeting` reales, ni el usuario técnico (permanece activo para una
  futura reanudación).

### 0.5 Incidencia operativa separada, fuera de alcance de la Puerta 5

La cuenta Business de Google Calendar Sync tiene el token OAuth
caducado/revocado (`invalid_grant`). Esto es independiente de la Puerta 5 y
**puede estar afectando ya la sincronización real del negocio** (los 4
`GcsEventLink` existentes podrían no estar actualizándose desde que el
token dejó de ser válido). Requiere una reconexión OAuth deliberada, fuera
del alcance de esta puerta y de cualquier subpuerta de fixtures.

### 0.6 Bloqueo explícito de la Puerta 5A

**La Puerta 5A no debe reanudarse apoyándose en que el fallo de OAuth
"protege" contra escrituras reales en Google** — es un fallo de
credenciales ajeno al diseño de esta puerta, no una salvaguarda. Reanudar
requiere una decisión de arquitectura separada para aislar las pruebas de
GCS (p. ej. cuenta Business de pruebas, o repetir el patrón de entorno
desechable ya usado en las Puertas 3D/5 para cualquier ensayo que involucre
la extensión GCS) — no solo corregir el token real. Toda precondición de
cualquier reanudación futura debe validar la configuración efectiva vía el
servicio `Config` (§0.2) y el estado operativo real de GCS (cuenta Business,
`status`, `lastError`), no solo los flags de decisión.

**Puerta nueva pendiente antes de reanudar**: `docs/fase4b-puerta6-exclusion-gcs.md`
diseña y prueba (repositorio + ensayo desechable, sin desplegar aún contra
`gapssa-espocrm-1`) el campo `cExcluirGoogleCalendarSync` — el aislamiento
real que esta sección exige, no dependiente del estado del token OAuth. La
reanudación de este Bloque 5A-1 (Parte C de esa puerta) queda bloqueada
hasta que la Parte B (despliegue real del campo) de `fase4b-puerta6-exclusion-gcs.md`
esté aprobada y ejecutada.

---

## Estado de ejecución real — actualizado, Bloque 5A-1 detenido en el Paso B

**Autorizado y ejecutado**: Paso A (línea base de solo lectura, completo,
13 comprobaciones en verde) y el inicio del Paso B (creación de
fixtures). **Bloqueado y detenido en el primer `POST`** — nunca se llegó
a intentar el Fixture B.

- Primer `POST /api/v1/Meeting` (Fixture A) vía `portal-gapssa-api`
  respondió `HTTP 400`:
  `{"messageTranslation":{"label":"validationFailure","scope":null,"data":{"field":"name","type":"required"}}}`.
  `Meeting.name` es obligatorio en el entity def real de EspoCRM,
  independientemente de que `Portal GAPSSA API` tenga ese campo en ACL
  `{read:no, edit:no}`.
- **Sin escritura parcial**: `SELECT COUNT(*) FROM meeting;` tras el
  fallo devolvió el mismo valor que antes del intento — verificado.
- **Fixture B nunca se intentó** — detención inmediata tras el primer
  fallo, tal como exigía la autorización.
- Línea base confirmada y sin alterar tras el intento: `Meeting` activos
  = **7**, históricos (incluidos soft-deleted) = **10**,
  `gapssaBookingDecisionEnabled` = **`false`**,
  `gapssa_meeting_decision_operation` = **0** filas.
- **Causa raíz — confirmada** (ya no pendiente): reproducida y aislada
  contra un EspoCRM 10.0.3 + MariaDB 11.4 completamente desechable, sin
  ninguna relación con `gapssa-espocrm-1` (destruido al terminar, cero
  residuos verificados). Con la ACL original (`Meeting.name = {read:no,
  edit:no}`), tanto omitir `name` como enviarlo explícitamente producen
  el mismo `400 validationFailure field=name type=required` — EspoCRM
  descarta el campo por ACL antes de la validación de obligatoriedad.
  Detalle completo en `docs/fase4b-puerta3c-meeting-name-acl.md` §0/§2.
- **Corrección de código aplicada y probada** (repositorio únicamente,
  nada contra EspoCRM real): `HttpEspoBookingAdapter.createMeeting()`
  ahora envía `PORTAL_MEETING_NAME = 'Reserva portal GAPSSA'` — constante
  fija, sin PII, nunca derivada de `CreateMeetingInput`. 43/43 pruebas
  contractuales en verde (`httpEspoAdapter.test.ts`), incluida una prueba
  de regresión verificada manualmente en ambos sentidos (falla sin la
  corrección con el mismo `EspoApiError 400`, pasa con ella).
- **Validado end-to-end en el mismo ensayo desechable**: con la ACL
  corregida (`Meeting.name = {read:no, edit:yes}`, aplicada SOLO en la
  instancia desechable), el `POST` con `name='Reserva portal GAPSSA'`
  devolvió `200`, el `Meeting` quedó en `cEstadoReserva=PendingCenterApproval`/
  `status=Planned`/`cMotivoResolucionReserva=NULL`, `name` nunca apareció
  en ninguna respuesta HTTP al API User (aunque se pidiera explícitamente
  en `select=`) pero sí al admin ficticio, y tanto el `PUT` genérico
  (`409 meeting_decision_requires_atomic_action`) como `PutDecide` con el
  flag apagado (`503 meeting_decision_disabled`) siguieron bloqueados
  como se espera.

**Puerta 3C — ejecutada y cerrada** (`docs/fase4b-puerta3c-meeting-name-acl.md`):
`Meeting.name` para `Portal GAPSSA API` quedó en `{read:no, edit:yes}`
contra `gapssa-espocrm-1` real. Backup, verificación bit a bit y
verificación runtime vía `AclManager` completas — ver ese documento para el
detalle. Esta corrección permanece vigente y no se ha revertido.

### Segundo intento de Fixture A — detenido con `403`, causa raíz distinta

Con la Puerta 3C ya cerrada, se reanudó el Bloque 5A-1 y se repitió el
`POST /api/v1/Meeting` (Fixture A) vía `portal-gapssa-api`, con las mismas
13 precondiciones revalidadas y en verde (incluida la nueva:
`Meeting.name={read:no,edit:yes}`).

- **Resultado**: `HTTP 403`, `X-Status-Reason: "Assignment failure:
  assigned user or team not allowed."`. **Sin escritura parcial** — `Meeting`
  activos=7/históricos=10 confirmados idénticos antes y después.
- **Fixture B no se intentó** — detención inmediata tras el primer fallo,
  igual criterio que el primer intento.
- **Causa raíz — confirmada** por lectura directa contra `gapssa-espocrm-1`
  real y por auditoría del núcleo de EspoCRM 10.0.3, más un ensayo
  desechable independiente (`gapssa-puerta3d-rehearsal`, destruido al
  terminar, cero residuos): el rol `Portal GAPSSA API` tiene
  `assignment_permission = 'no'` (atributo dedicado de `Role`, columna SQL
  propia — **no** el mismo mecanismo `field_data` de la Puerta 3C) y no
  pertenece a ningún equipo. Con `assignmentPermission=no`, EspoCRM solo
  permite que un actor se asigne un registro **a sí mismo** — nunca al
  profesional real, que es el `assignedUserId` que
  `HttpEspoBookingAdapter.createMeeting()` necesita enviar. Detalle
  completo, incluida la matriz de 7 casos del ensayo y la auditoría de
  equipos reales (sin PII), en
  `docs/fase4b-puerta3d-assignment-team.md` §1/§2/§3.
- **Revisión del adaptador (`HttpEspoBookingAdapter`)**: se confirmó que
  `professionalId` nunca puede llegar a `createMeeting()` sin haber pasado
  antes por la allowlist `ESPOCRM_PROFESSIONAL_USER_IDS`
  (`getProfessional()`/`validateSlotRequest()`) — no había ningún hueco de
  código que corregir. Se añadieron 4 pruebas contractuales nuevas en
  `httpEspoAdapter.test.ts` para dejar ese invariante cubierto (antes no lo
  estaba) — 47/47 en verde. Ver
  `docs/fase4b-puerta3d-assignment-team.md` §5.
- **Propuesta nueva**: `docs/fase4b-puerta3d-assignment-team.md` — equipo
  técnico nuevo, sin ningún rol adjunto (`role_team`), compartido por
  `portal-gapssa-api` y el/los profesional(es) de
  `ESPOCRM_PROFESSIONAL_USER_IDS`, más `Portal GAPSSA API.assignmentPermission`:
  `no` → `team`. Unir el API User al equipo real `Gapssa` existente se
  descartó explícitamente — heredaría el rol `Profesional Gapssa` completo
  (demostrado en el ensayo, mismo documento §3.3 caso 4).

**Reanudación del Bloque 5A-1 (Paso B) bloqueada hasta**:

a) ✅ Corregir y validar `HttpEspoBookingAdapter` (constante `name` fija)
   — **hecho**.
b) ✅ Aprobar y ejecutar la **Puerta 3C** — **hecho**, ver arriba.
c) ⏳ Aprobar y ejecutar la **Puerta 3D**
   (`docs/fase4b-puerta3d-assignment-team.md`) contra `gapssa-espocrm-1`
   real — **propuesta, sin ejecutar, a la espera de tu aprobación
   explícita y separada**.

Sin (c), el Paso B seguirá fallando contra la instancia real exactamente
con el mismo `403` — ni la corrección del adaptador ni la Puerta 3C, por sí
solas, bastan.

**Actualización — Bloque 5A-1 reanudado y completado vía Puerta 6
(2026-08-12), Bloque 5A-2 ejecutado y cerrado (2026-08-13).** La
reanudación bloqueada por §0.6 se resolvió mediante el mecanismo de
aislamiento real (`Meeting.cExcluirGoogleCalendarSync`, independiente del
token OAuth) diseñado y desplegado por `docs/fase4b-puerta6-exclusion-gcs.md`
(Parte B, §11.8) y su subpuerta `5A-1-apertura` (§12.1.1 de ese mismo
documento) — ver ahí el detalle completo de la creación de los Fixtures A
(`6a7cf117522f19bcf`) y B (`6a7cf18e8d7531711`), ambos con
`cExcluirGoogleCalendarSync=true`, cero jobs GCS, cero tráfico Google.
Inspección humana de ambos completada y confirmada por el usuario.

**Bloque 5A-2 — ejecutado por autorización explícita separada, 2026-08-13.**
Precondiciones (las 15 exigidas por el encargo) revalidadas por lectura
directa contra `gapssa-espocrm-1` real inmediatamente antes de escribir —
todas en verde, ninguno de los dos Fixtures decidido manualmente durante
la pausa humana. Backup no sensible en
`/var/www/html/data/.backup/gapssa/puerta5-decisiones/20260812T221459Z/`.

- `gapssaBookingDecisionEnabled` activado `false→true` vía `ConfigWriter`
  real (nunca edición manual de `data/config.php`/`data/config-internal.php`),
  releído vía `Espo\Core\Utils\Config`. Confirmado que la sola activación
  no cambió ningún `Meeting`.
- `PUT /api/v1/GapssaMeetingDecision/6a7cf117522f19bcf`
  (`decision=Confirmed`, `resultReason=Approved`) → `HTTP 200`.
  `cEstadoReserva=Confirmed`, `status=Planned` (mapeo correcto), exclusión
  GCS y asignación intactas, cero jobs/`GcsEventLink`/tráfico Google
  nuevos, una única fila de idempotencia.
- Idempotencia de A verificada: misma `operationKey`+payload → mismo `200`
  replayado sin duplicar fila; misma `operationKey` con payload distinto →
  `409 idempotency_key_reused`, cero mutación.
- `PUT /api/v1/GapssaMeetingDecision/6a7cf18e8d7531711`
  (`decision=Canceled`, `resultReason=RejectedByStaff`,
  `note="Rechazo controlado de prueba Puerta 5A"`) → `HTTP 200`.
  `cEstadoReserva=Canceled`, `status=Not Held` (mapeo correcto), nota
  persistida en `description`, exclusión GCS y asignación intactas, cero
  jobs/`GcsEventLink`/tráfico Google nuevos, segunda fila de idempotencia.
- Idempotencia de B verificada con el mismo patrón que A: replay sin
  duplicar, conflicto `409 idempotency_key_reused` con payload distinto,
  cero mutación en ambos casos.
- Pruebas negativas: re-decidir A desde `Confirmed` y B desde `Canceled`
  (cada una con `operationKey` nueva) → ambas `409
  meeting_decision_conflict`, estado sin cambios. Tabla de idempotencia
  cerrada en **4 filas** (2 éxitos `200` + 2 conflictos `409` de estas
  pruebas negativas — los reintentos de payload distinto sobre las claves
  originales no añadieron fila, por diseño de `PutDecide`).
- Prueba de "actor no autorizado" **no ejecutada** — habría requerido
  crear una credencial nueva o usar la contraseña de un usuario real
  existente, ninguna de las dos autorizada. Verificado en su lugar de
  forma estructural: `gapssaBookingDecisionAuthorizedUserIds=[]` (lectura
  directa de configuración efectiva) y `MeetingDecisionAuthorizationPolicy`
  (política pura) deniegan por defecto a cualquier no-admin ausente de su
  allowlist correspondiente.
- Cierre: `gapssaBookingDecisionEnabled` restaurado `true→false` vía
  `ConfigWriter`, confirmado vía `Config`; un intento posterior de
  `PutDecide` devolvió `503 meeting_decision_disabled` sin tocar la tabla
  de idempotencia.
- Estado final verificado: Fixture A activo/`Confirmed`/`Planned`/
  exclusión GCS `true`; Fixture B activo/`Canceled`/`Not Held`/exclusión
  GCS `true`; Fixture A antiguo (`6a7c63799527a4746`) sigue soft-deleted;
  `Meeting` = 9 activos + 4 soft-deleted (los 11 históricos + los 2
  Fixtures, sin alteración de los históricos); `gcs_event_link=4` sin
  variación; `gapssaBookingDecisionAuthorizedApiUserIds`/`AuthorizedUserIds`
  sin cambio; ACL de `cExcluirGoogleCalendarSync` en ambos roles sin
  cambio; `GcsAccount` (`status=Error`, `last_error` con el mismo
  timestamp del incidente previo) y `gcsSyncStartAt` intactos;
  `ESPO_BOOKING_ADAPTER=simulated`; `app-check` final verde. Cero commits.
- **Detenido tal como exige el encargo**: no se han eliminado ni
  soft-deleted los Fixtures, no se ha limpiado el usuario técnico, no se
  ha modificado `ESPO_BOOKING_ADAPTER`/OAuth/`gcsSyncStartAt`/ACL/roles/
  equipos/usuarios, `apps/web` no se ha conectado a `gapssa-espocrm-1`
  real. Queda a la espera de autorización explícita y separada para
  cualquier limpieza posterior.

**Auditoría de cierre de solo lectura — ejecutada y verde (2026-08-13).**
Revalidación completa contra `gapssa-espocrm-1` real, posterior a la
aceptación del informe del Bloque 5A-2:

- Inspección inicial (pausa humana, §3) — **completada**, confirmada por
  el usuario antes de autorizar el Bloque 5A-2.
- **Bloque 5A-2 — completado**, ver arriba para el detalle operativo
  completo.
- **Estados finales verificados por lectura directa**: Fixture A
  (`6a7cf117522f19bcf`) activo, `cEstadoReserva=Confirmed`,
  `status=Planned`, `cExcluirGoogleCalendarSync=1`, `assignedUserId`
  = usuario técnico, sin contactos, sin `GcsEventLink`, sin jobs GCS.
  Fixture B (`6a7cf18e8d7531711`) activo, `cEstadoReserva=Canceled`,
  `status=Not Held`, `cMotivoResolucionReserva=RejectedByStaff`, nota
  operativa exacta en `description`, `cExcluirGoogleCalendarSync=1`,
  mismo usuario técnico, sin contactos, sin `GcsEventLink`, sin jobs GCS.
  Fixture A antiguo (`6a7c63799527a4746`) sigue soft-deleted, sin
  `GcsEventLink`, sus 2 jobs `GcsPushEvent` terminales
  (`Failed`/`attempts=0`), no reintentables.
- **Feature flag restaurado a `false`** — confirmado vía
  `Espo\Core\Utils\Config` real (no solo `data/config.php`), coherente
  con la lección de §0.2. `maintenanceMode` sigue `NULL`.
  `ESPO_BOOKING_ADAPTER=simulated` en la raíz `.env` usada por
  `apps/web`. `gcsSyncStartAt`, allowlists de decisión, y OAuth sin
  cambios.
- **ACL confirmada sin cambios**: `Portal GAPSSA API` →
  `cExcluirGoogleCalendarSync={read:yes, edit:no}`; `Profesional Gapssa` →
  `{read:no, edit:no}`; `assignmentPermission=team` sobre
  `Portal GAPSSA API` intacto.
- **Idempotencia — 4 filas exactas**, sin ninguna fila `processing`, sin
  `operationKey` duplicada (restricción `PRIMARY KEY` sobre
  `operation_key`), 2 éxitos (`200`, decisiones de A y B) + 2 conflictos
  (`409 meeting_decision_conflict`, re-decisión de A y B con
  `operationKey` nueva sobre un Meeting ya resuelto) — coherente con el
  código de `PutDecide.php`, que solo escribe `result_status` en
  `{'confirmed','conflict'}`, nunca un estado intermedio.
- **`gcs_event_link` global**: 4 filas totales (2 activas + 2
  soft-deleted), ninguna asociada a A/B/Fixture A antiguo — sin
  variación respecto a la línea base.
- **`app-check` verde, `git diff --check` limpio, cero commits nuevos**
  generados por esta auditoría.
- **Puerta 5A queda funcionalmente aprobada.** Limpieza de los Fixtures
  **todavía pendiente y no autorizada** — ver
  `docs/fase4b-puerta5a-limpieza-propuesta.md` (propuesta documental, sin
  ejecutar). **Puerta 5B todavía no iniciada** — ver
  `docs/fase4b-puerta5b-propuesta-v1.md` (propuesta documental, sin
  ejecutar, dividida en subpuertas 5B-1/5B-2/5B-3).

**Actualización — limpieza autorizada y ejecutada parcialmente, detenida
por un incidente real (2026-08-13).** Se autorizó la limpieza descrita en
`docs/fase4b-puerta5a-limpieza-propuesta.md`. Solo se completó el
soft-delete del Fixture A (`6a7cf117522f19bcf`) — el Fixture B
(`6a7cf18e8d7531711`) **no se ha tocado**. La ejecución reveló que la
garantía "DELETE sin `GcsEventLink` ⇒ cero tráfico externo", asumida por
el análisis previo de esa propuesta y por el diseño de
`docs/fase4b-puerta6-exclusion-gcs.md`, es incompleta: `SyncService::processPush()`
crea el cliente de Google (y con él, intenta renovar el token OAuth) de
forma incondicional, **antes** de comprobar localmente si existe algún
vínculo que borrar. Con el token OAuth de la cuenta Business ya caducado
desde el incidente previo (§0), el soft-delete del Fixture A disparó dos
intentos reales (uno inicial + un reintento automático del daemon,
`jobRerunAttemptNumber=1`) de renovación OAuth, ambos fallidos con el
mismo `invalid_grant` ya conocido — **cero tráfico hacia la API de
Calendar, cero evento creado/eliminado, cero `GcsEventLink` afectado**,
pero **sí** tráfico OAuth real y **sí** una actualización de
`GcsAccount.last_error`/timestamp como efecto colateral. Detalle
línea por línea, secuencia exacta con timestamps, y la corrección
propuesta (sin desplegar): `docs/fase4b-puerta5a-limpieza-propuesta.md`
§12 y `docs/fase4b-puerta6c-correccion-oauth-delete.md`.

- **Limpieza**: parcial, detenida. Fixture A soft-deleted, Fixture B
  intacto. Reanudación de B bloqueada hasta que la corrección de
  `SyncService` (Puerta 6C) esté verificada en un ensayo desechable y,
  si se autoriza por separado, desplegada contra `gapssa-espocrm-1` real.
- **Puerta 6 requiere revisión correctiva** antes de dar por cerrado su
  diseño de aislamiento: la exclusión GCS nunca bloquea rutas DELETE (por
  diseño, para no dejar huérfanos eventos ya sincronizados), y ese diseño
  sigue siendo correcto — el defecto real está en que `SyncService` no
  comprueba localmente la existencia de vínculos antes de tocar OAuth,
  independientemente de la exclusión.
- Todo lo demás (4 filas de idempotencia, Fixture A antiguo, usuario y
  equipo técnico, ACL, flags, `gcs_event_link=4`) permanece intacto y
  verificado — ver el documento de limpieza §12 para el detalle exacto.

El resto de este documento (§1 en adelante) es la propuesta original, sin
cambios respecto a como se aprobó.

## 0. Qué cambia respecto a V2

| # | Corrección |
|---|---|
| 1 | Eliminada por completo la alternativa de API Key de `admin` — no se crea, rota ni modifica ninguna credencial administrativa en ningún escenario |
| 2 | Paso A ahora comprueba explícitamente `Meeting.create` de scope, `field_data.Meeting.name` y si `name` es un campo obligatorio del entity def — si `name` no está permitido para `portal-gapssa-api`, es STOP antes de crear nada, con dos propuestas separadas (ninguna ejecutada sin nueva aprobación) |
| 3 | Corregida la afirmación sobre `cMotivoResolucionReserva`: la Puerta 4 dejó `Portal GAPSSA API` en `read:yes, edit:yes` para ese campo — se omite del payload de creación por diseño (debe nacer `NULL`), no por restricción de ACL |
| 4 | `SELECT * FROM gcs_account` sustituido por una consulta mínima (`EXISTS`/`COUNT` + `status`, nunca tokens ni `googleEmail`) |
| 5 | Ejecución dividida en **Bloque 5A-1** (línea base + fixtures) → **pausa humana obligatoria** → **Bloque 5A-2** (flag + decisiones + cierre) |
| 6 | El flag permanece `false` durante todo 5A-1 y toda la pausa humana — invariante explícito, sin excepción |
| 7 | Backup de `config.php` movido a `data/.backup/gapssa/puerta5/<timestamp>/`, modo `600`, solo hash/stat registrados, backups anteriores nunca borrados |
| 8 | Snapshot no-PII de los 10 `Meeting` reales capturado en el Paso A, usado para la comparación final fila por fila |
| 9 | Las comprobaciones de `Meeting.name`/`gcs_account` del admin se describen como bifurcaciones controladas (continuar / STOP), no como "divergencias" genéricas |
| 10 | `operationKey` generada por CSPRNG, con comprobación previa de no-existencia, sin reutilizar claves de ensayos anteriores (salvo la reutilización deliberada de la propia clave de aprobación en la prueba negativa) |
| 11 | Limpieza reubicada dentro del propio Bloque 5A-2 (sigue exigiendo autorización explícita aparte, pero ya no es un "Paso J" fuera de bloque) |
| 12 | Sin cambios: idempotencia final = 3, `idempotency_key_reused` en texto plano, `maintenanceMode=NULL`, `ESPO_BOOKING_ADAPTER=simulated`, Puerta 5B fuera de alcance |

---

## 1. Estructura de autorización — dos bloques, una pausa humana obligatoria

```
Bloque 5A-1 ──► [detenerse] ──► Pausa humana (tú, en EspoCRM) ──► tu confirmación explícita ──► Bloque 5A-2
```

- **Bloque 5A-1** y **Bloque 5A-2** son dos autorizaciones operativas
  distintas. Aprobar este documento autoriza, como máximo, la ejecución
  de 5A-1 hasta su detención — **no** autoriza 5A-2. 5A-2 requiere tu
  confirmación explícita del resultado de la pausa humana, dada después
  de ver 5A-1 ya ejecutado.
- La pausa humana **no es un paso técnico** — no hay ninguna llamada,
  lectura ni escritura de esta sesión durante ella. Es tiempo tuyo, en tu
  propia sesión de EspoCRM, inspeccionando los fixtures ya creados por
  5A-1.
- El flag `gapssaBookingDecisionEnabled` permanece en `false` durante
  **todo** 5A-1 y **toda** la pausa humana, sin excepción — ver §5
  (invariante explícito). Nunca hay una espera con el flag en `true`.

---

## 2. Bloque 5A-1

### 2.1 Paso A — Línea base de solo lectura

| # | Comprobación | Método | Esperado |
|---|---|---|---|
| 1 | `app-check` | `docker compose exec espocrm bin/command app-check` | Verde |
| 2 | `maintenanceMode` | Lectura de `data/config.php` | `NULL` (ausente) — `docs/fase4b-puerta4-cierre.md` |
| 3 | `gapssaBookingDecisionEnabled` | Misma lectura | `false` (booleano explícito) |
| 4 | `ESPO_BOOKING_ADAPTER` (todos los entornos de `apps/web`) | Lectura de `.env`/secretos de despliegue | `simulated` en todos |
| 5 | `gapssa_meeting_decision_operation` | `SELECT COUNT(*) FROM gapssa_meeting_decision_operation;` | `0` |
| 6 | `gcs_event_link` totales | `SELECT COUNT(*) FROM gcs_event_link;` | `4` |
| 7 | Hashes de los 6 archivos de metadata (v3 de la Puerta 4, §6) | `sha256sum` sobre los archivos vivos | Coinciden con el manifiesto v2/v3/v4 de la Puerta 4 |
| 8 | ACL de campo `cMotivoResolucionReserva` | `SELECT field_data FROM role WHERE id IN (...)` | `Profesional Gapssa` → `no/no`; `Portal GAPSSA API` → `yes/yes` |
| 9 | `gapssaBookingDecisionAuthorizedApiUserIds` | Lectura de `data/config.php` | Contiene únicamente el id real de `portal-gapssa-api` |
| 10 | `gapssaBookingDecisionAuthorizedUserIds` | Misma lectura | Vacía |
| 11 | `routes.json` publica la ruta de decisión | `curl` sin credenciales válidas (espera 401, nunca 404) | 401 |
| 12 | **Snapshot no-PII de los 10 `Meeting` reales** (§2.1.1) | `SELECT id, c_estado_reserva, c_motivo_resolucion_reserva, status, modified_at, deleted FROM meeting WHERE deleted = 0;` | Exactamente 10 filas — registradas como línea base, usadas en la verificación final (Bloque 5A-2, §4.7) |
| 13 | **`Meeting.create` de scope para `Portal GAPSSA API`** (§2.2) | `SELECT data FROM role WHERE id = '6a7b345b239b2ed26';`, extraer `Meeting.create` | `yes` (ya registrado por la Puerta 3 — se reconfirma aquí por lectura directa, no se asume por el documento histórico) |
| 14 | **`field_data.Meeting.name` para `Portal GAPSSA API`** (§2.2) | `SELECT field_data FROM role WHERE id = '6a7b345b239b2ed26';`, extraer la clave `name` dentro de `Meeting` | Determina la bifurcación de §2.2 — sin valor esperado fijado de antemano |
| 15 | **¿`Meeting.name` es un campo obligatorio del entity def real?** | `GET /api/v1/Metadata` (endpoint de solo lectura, estándar de EspoCRM, sin credenciales de escritura) → `entityDefs.Meeting.fields.name.required` | Informativo — no cambia la bifurcación de §2.2 por sí solo, pero se registra para el informe de parada si aplica |
| 16 | **`gcs_account` de `admin` — consulta mínima** (§2.2, corregido respecto a V2) | `SELECT EXISTS(SELECT 1 FROM gcs_account WHERE user_id = '<id de admin>' AND status = 'Active') AS admin_has_active_gcs;` — **nunca** `SELECT *`, nunca `accessToken`/`refreshToken`/`googleEmail`/`calendarId`/`calendarListCache`/`oauthState`/`syncToken`/`lastError`, ninguna columna de `gcs_account` fuera de esta comprobación booleana | `false` (recomendado) — determina la bifurcación de §2.2 |

**Cualquier discrepancia en 1–11 detiene la ejecución antes de crear
nada.** Los puntos 12–16 alimentan directamente las bifurcaciones
controladas de §2.2, no son comprobaciones de aprobar/reprobar por sí
solas.

#### 2.1.1 Por qué el snapshot es no-PII

Se capturan únicamente `id`, `c_estado_reserva`, `c_motivo_resolucion_reserva`, `status`, `modified_at`, `deleted` — **nunca** `name`, `description`, `contacts`/`contactsIds`, ni ningún otro campo que pudiera identificar a un cliente real o describir el contenido de una cita real. Es suficiente para la comparación fila por fila de §4.7 (detectar si algún `Meeting` real cambió de estado, motivo, status nativo o fecha de modificación) sin necesitar ni exponer ningún dato personal.

### 2.2 Bifurcaciones controladas (no "divergencias" genéricas)

Con los resultados de §2.1, puntos 13–16, exactamente una de estas
cuatro rutas aplica — no hay una quinta:

| Condición | Resultado |
|---|---|
| `Meeting.create=yes` **y** `field_data.Meeting.name` en `{read:yes, edit:yes}` **y** `admin` sin `gcs_account` activa | **Continuar** a §2.3 — `portal-gapssa-api` crea los fixtures, `assignedUserId=admin` |
| `field_data.Meeting.name` **no** está en `{read:yes, edit:yes}` (de scope o de campo) | **STOP** — ver §2.2.1, dos propuestas separadas, ninguna ejecutada sin nueva aprobación |
| `admin` **tiene** `gcs_account` con `status='Active'` | **STOP** — no se usa `admin` como `assignedUser`; se propone un usuario técnico alternativo, a designar contigo explícitamente, nunca un profesional real ni un usuario inventado por esta sesión |
| Cualquier otro resultado de §2.1 (puntos 1–11) distinto del esperado | **STOP** — condición de parada general (§8), sin continuar a §2.3 bajo ninguna circunstancia |

Estas cuatro filas son exhaustivas y mutuamente excluyentes sobre el
resultado real de §2.1 — no hay una interpretación intermedia.

#### 2.2.1 STOP por `Meeting.name` no permitido — dos propuestas, sin elegir ninguna aquí

Si `portal-gapssa-api` no puede escribir `Meeting.name` (de scope o de
campo), la Puerta 5A se detiene en el Paso A, **antes** de crear ningún
fixture. Se documentan aquí, para tu decisión, dos caminos — **esta
sesión no elige ni ejecuta ninguno sin tu aprobación explícita y
separada**:

- **Propuesta A — ampliar el ACL de `Meeting.name` para `Portal GAPSSA
  API`, como una puerta específica aparte.** Requeriría su propia
  propuesta (mecanismo `EntityManager`/`saveEntity()` sobre el rol, mismo
  patrón que la Puerta 3B), su propio backup/rollback del `role.field_data`
  anterior, y su propia verificación — no se detalla aquí porque sería
  una escritura de ACL fuera del alcance mínimo de la Puerta 5.
- **Propuesta B — creación manual por ti, desde tu sesión admin.** Tú
  creas A y B directamente en la interfaz de EspoCRM, con exactamente los
  valores de §2.3.3 (mismo `name`, mismas fechas, mismo
  `cEstadoReserva=PendingCenterApproval`, sin contacto, sin
  tratamiento/zona). Ya no sería un payload de script exacto y
  reproducible (la limitación que motivó excluir la UI en primer lugar),
  pero sí evita cualquier cambio de ACL y cualquier credencial nueva —
  sigue siendo tu propia sesión ya existente, sin API Key adicional.
- **Explícitamente descartado, no una tercera propuesta**: generar o usar
  una API Key nueva de `admin` — eliminado por instrucción directa (§0,
  punto 1). No se ofrece como opción C.

### 2.3 Paso B — Creación de fixtures (solo si §2.2 dio "Continuar")

#### 2.3.1 Mecanismo — únicamente `portal-gapssa-api`, únicamente vía API

`POST /api/v1/Meeting` (ruta estándar de entidad, nunca la ruta custom
`GapssaMeetingDecision`, que es solo para decidir), autenticado con la
API Key **ya existente** de `portal-gapssa-api` (`X-Api-Key`) — la misma
credencial que ejecutará las decisiones en el Bloque 5A-2, sin crear
ninguna credencial nueva. Nunca la UI (payload no reproducible). Nunca
una API Key de `admin` (§0, punto 1 — eliminado).

#### 2.3.2 Sobre `cMotivoResolucionReserva` — corrección respecto a V2

La Puerta 4 dejó `Portal GAPSSA API` en `field_data.Meeting.cMotivoResolucionReserva = {read: yes, edit: yes}` (v3 de la Puerta 4, §3; reconfirmado en `docs/fase4b-puerta4-cierre.md` y en el punto 8 de §2.1 de este documento). **`portal-gapssa-api` sí podría escribir ese campo si quisiera** — se omite del payload de creación (§2.3.3) exclusivamente porque el estado inicial exigido es `cMotivoResolucionReserva=NULL` (§3.6 de V2, sin cambios), nunca porque el ACL lo prohíba. V2 afirmaba lo contrario por error; queda corregido aquí.

#### 2.3.3 Payload cerrado

```
POST /api/v1/Meeting
X-Api-Key: <redactado — portal-gapssa-api>
Content-Type: application/json

{
  "name": "[PRUEBA PUERTA5] Aprobación — no contactar",
  "dateStart": "2026-06-15 09:00:00",
  "dateEnd": "2026-06-15 09:15:00",
  "cEstadoReserva": "PendingCenterApproval",
  "assignedUserId": "<id de admin, confirmado sin gcs_account activa en §2.1.16>",
  "contactsIds": []
}
```

Mismo payload para B, cambiando únicamente `name` a
`"[PRUEBA PUERTA5] Rechazo — no contactar"`.

Deliberadamente ausentes (nunca enviados, ni como `null` explícito):

- `status`: derivado por `SyncEstadoReservaToStatus` (hook `before`) —
  ver §2.3.4 para la evidencia de que esto ocurre sin intervención
  adicional.
- `cMotivoResolucionReserva`: omitido por diseño de negocio (§2.3.2), no
  por ACL — el valor por defecto de un `enum` nuevo sin dato es `NULL`.
- `cBookingRequestId`: `NULL` por defecto — estos fixtures no vienen de
  una solicitud real del portal.
- `cTratamientoId` / `cZonaAtencionId`: confirmado por
  `metadata/entityDefs/Meeting.json` que ambos son `type: link` sin
  `required: true` — aceptan `NULL`.
- Cualquier campo de `Contact`: `contactsIds: []` explícito.

#### 2.3.4 Evidencia de que la creación directa en `PendingCenterApproval` es segura (código + prueba existente, sin ensayo nuevo)

Sin cambios respecto a V2 §3.5 — se resume:

- `GuardMeetingDecisionTransition::process()` (línea 85): `if ($entity->isNew() || ...) { return; }` — retorna de inmediato en creación, no bloquea.
- `SyncEstadoReservaToStatus::process()` (línea 67): sí se ejecuta en creación, deriva `status='Planned'` de `EstadoReservaStatusMap::MAP['PendingCenterApproval']`, confirmado por la prueba pura existente (`MeetingHooksPureLogicTest.php:73`) — sin `PUT` genérico posterior.
- `GuardMeetingResolutionReasonConsistency::process()`: sí se aplica en creación, pero solo actúa si `cMotivoResolucionReserva` no es `null`/`''` (línea 63) — el payload de §2.3.3 lo deja `NULL`, así que no bloquea.

#### 2.3.5 Estado inicial resultante (esperado)

| Campo | A y B |
|---|---|
| `cEstadoReserva` | `PendingCenterApproval` |
| `status` | `Planned` (derivado) |
| `cMotivoResolucionReserva` | `NULL` |
| `cBookingRequestId` | `NULL` |
| `cTratamientoId` / `cZonaAtencionId` | `NULL` |
| `contactsIds` | `[]` |

### 2.4 Verificación de estado inicial (cierre del Bloque 5A-1)

1. Releer A y B vía `GET /api/v1/Meeting/{id}` — confirmar §2.3.5 exacto.
2. `gcs_event_link` sigue en `4` (mismo valor que §2.1.6 — sin
   sincronización, `assignedUser` sin `gcs_account` activa).
3. Los 10 `Meeting` reales del snapshot de §2.1.12 **sin cambios**.
4. Registrar `Meeting.id` de A y B — ningún otro dato.

### 2.5 Fin del Bloque 5A-1 — detenerse aquí

El flag sigue en `false` (nunca se tocó en este bloque). No se ejecuta
ninguna llamada a `PutDecide`, no se activa el flag, no se continúa a
5A-2 sin la pausa humana de §3.

---

## 3. Pausa humana (obligatoria, sin ejecución de esta sesión)

- **La realizas tú**, con tu sesión administrativa ya existente. Nunca se
  pide, muestra ni cambia ninguna contraseña ni credencial.
- Abres A (y B) en la vista de detalle nativa de EspoCRM.
- **Condición exacta de visibilidad** de los botones "Aprobar
  reserva"/"Rechazar reserva", leída directamente de
  `client/custom/src/views/meeting/record/detail.js:96-108`
  (`controlGapssaDecisionItems()`):
  ```js
  const isPending = this.model.get('cEstadoReserva') === 'PendingCenterApproval';
  const hasEditAccess = this.getAcl().checkScope('Meeting', 'edit');
  const visible = isPending && hasEditAccess;
  ```
  Con A/B en `PendingCenterApproval` y tu usuario admin con `edit` sobre
  `Meeting` (siempre `true`), ambos factores son verdaderos — los dos
  ítems deben estar visibles.
- Qué revisar, **sin enviar ningún `PUT`**:
  1. Los dos ítems visibles sobre A (y B).
  2. "Aprobar reserva" abre el diálogo de confirmación nativo
     (`this.confirm(...)`) — cerrar sin confirmar.
  3. "Rechazar reserva" abre el modal
     `custom:views/meeting/modals/reject-reason`, pide una nota — cerrar
     sin enviar.
  4. Consola del navegador sin errores de JS.
  5. Pestaña de red del navegador: ninguna petición
     `PUT GapssaMeetingDecision` sale en ningún momento.
- **El flag permanece en `false` durante toda esta pausa** — no hay
  ninguna espera con el flag en `true` esperando tu inspección (§5).
- **Tu confirmación explícita** de estos 5 puntos (o la discrepancia
  exacta encontrada) es lo único que autoriza el inicio del Bloque 5A-2.
  Sin ella, la Puerta 5A no avanza.

---

## 4. Bloque 5A-2 (solo tras tu confirmación explícita de la pausa humana)

### 4.1 Paso D — Activación controlada del flag

1. **Backup de `data/config.php`** — ubicación corregida respecto a V2:
   `data/.backup/gapssa/puerta5/<timestamp>/config.php.bak`, **no** junto
   al `config.php` real. Directorio creado si no existe, modo del archivo
   de backup `600` como máximo. **Nunca se muestra el contenido del
   backup ni ningún secreto que pudiera contener** `data/config.php`
   (SMTP, claves de cifrado, etc.) — el informe registra únicamente
   `sha256sum` y `stat` (tamaño, propietario, modo, mtime) del archivo de
   backup, nunca su contenido.
2. **Backups anteriores de esta ruta nunca se borran** — cada ejecución
   crea su propio subdirectorio `<timestamp>`, acumulativo.
3. `ConfigWriter->set('gapssaBookingDecisionEnabled', true)->save()`.
4. `php -l data/config.php` — sin errores.
5. `diff` estructural contra el backup del paso 1: exactamente una línea
   cambiada (`gapssaBookingDecisionEnabled`, `false` → `true`).
   `maintenanceMode` no se toca — sigue en `NULL`.
6. Registrar la hora exacta (UTC) de apertura.
7. Confirmar por lectura directa (no cacheada) que el valor en disco es
   `true`.

Ventana mínima: desde 4.1.7 hasta el cierre (§4.5), sin pausas
intermedias con el flag en `true`. Cierre garantizado en éxito y en
error — nunca se deja el flag en `true` mientras se espera una nueva
aprobación o intervención manual (mismo principio que §5).

### 4.2 `operationKey` — generación (aplica a §4.3/§4.4/§4.5.2)

- Generada por **CSPRNG** (p. ej. `random_bytes()`/`bin2hex()` en PHP, o
  el generador nativo equivalente del script que ejecute la llamada) —
  nunca un contador ni un valor predecible.
- Formato: prefijo descriptivo + valor aleatorio, ej.
  `puerta5-approval-<32 hex chars>` — cumple `^[A-Za-z0-9_-]+$` y
  ≤128 caracteres con margen amplio.
- **Antes de usarla**: `SELECT 1 FROM gapssa_meeting_decision_operation WHERE operation_key = '<candidata>';` — debe devolver **0 filas**. Si por una colisión estadísticamente casi imposible ya existiera, se genera una nueva y se repite la comprobación.
- **Nunca se reutiliza una clave de un ensayo o puerta anterior** (v4 de
  la Puerta 4, `fase4b-decision-flow-final.md`, etc.). La única
  reutilización deliberada es la de la prueba negativa §4.5.1, que
  reusa **la propia clave generada en §4.3 de esta misma ejecución** —
  ese es el escenario que esa prueba existe para comprobar, no un atajo.

### 4.3 Paso E — Aprobación (Meeting A)

Payload (`operationKey` generada según §4.2):

```
PUT /api/v1/GapssaMeetingDecision/{meetingId=<id A>}
X-Api-Key: <redactado>
Content-Type: application/json

{
  "decision": "Confirmed",
  "resultReason": "Approved",
  "operationKey": "puerta5-approval-<hex>"
}
```

Resultado esperado: HTTP `200`,
`{"status":"confirmed","meetingId":"<A>","cEstadoReserva":"Confirmed","cMotivoResolucionReserva":"Approved","meetingStatus":"Planned","modifiedById":"<id de portal-gapssa-api>","modifiedAt":"<timestamp>"}`.

Verificación: `cEstadoReserva=Confirmed`, `status=Planned` (sin cambio),
`cMotivoResolucionReserva=Approved`, `modifiedById` = id real de
`portal-gapssa-api`, **1 fila** nueva en
`gapssa_meeting_decision_operation` (`result_status='confirmed'`,
`result_http_status=200`).

**Replay** (misma `operationKey`, mismo payload, segunda llamada
idéntica): HTTP `200`, cuerpo idéntico byte a byte (mismo `modifiedAt`),
**sin fila nueva**, `Meeting.modifiedAt` sin cambios.

### 4.4 Paso F — Rechazo (Meeting B)

Payload (`operationKey` nueva, generada según §4.2; nota:
`"Prueba operativa Puerta 5 — sin relación con un caso real."`):

```
PUT /api/v1/GapssaMeetingDecision/{meetingId=<id B>}
X-Api-Key: <redactado>
Content-Type: application/json

{
  "decision": "Canceled",
  "resultReason": "RejectedByStaff",
  "note": "Prueba operativa Puerta 5 — sin relación con un caso real.",
  "operationKey": "puerta5-rejection-<hex>"
}
```

Resultado esperado: HTTP `200`, `cEstadoReserva=Canceled`,
`status=Not Held`, `cMotivoResolucionReserva=RejectedByStaff`, nota
persistida. **1 fila** nueva de idempotencia.

**Replay**: igual que §4.3 — mismo cuerpo exacto, sin fila nueva, sin
cambio en `Meeting`.

### 4.5 Paso G — Pruebas negativas mínimas

#### 4.5.1 `operationKey` repetida con payload incompatible → 409

- Reutiliza **deliberadamente** la clave de §4.3 (ya usada para A con
  `Confirmed`/`Approved`) — la única reutilización permitida (§4.2).
- Nueva llamada, misma clave, payload distinto (mismo `meetingId` A, pero
  `decision=Canceled`, `resultReason=RejectedByStaff`, con nota).
- Esperado: HTTP `409`, **cuerpo de texto plano exacto**:
  `idempotency_key_reused` (no JSON) — confirmado en
  `apps/web/src/server/booking/httpEspoAdapter.ts:792-801`: el segundo
  argumento de `Conflict::createWithBody($mensaje, 'idempotency_key_reused')`
  se escribe tal cual en el cuerpo, sin envolverlo en JSON, verificado ahí
  contra el core real de EspoCRM 10.0.3
  (`Espo\Core\Api\ErrorOutput::printBody()`). Si se registra la cabecera
  `X-Status-Reason` en la entrega, se hace de forma redactada (puede
  llevar texto operativo). **No parsear el cuerpo como JSON.**
- Verificación: `Meeting A` sin cambios; **sin fila nueva** de
  idempotencia (el 409 corta antes de `persistIdempotentResult` —
  `PutDecide.php:323-329`).

#### 4.5.2 `operationKey` nueva sobre un Meeting ya resuelto → 409 `meeting_decision_conflict`

- `operationKey` **nueva** (generada según §4.2, nunca usada), mismo
  `meetingId` A (ya `Confirmed`), payload válido en forma.
- Esperado: HTTP `409`, **este sí en JSON**:
  `{"status":"conflict","reason":"meeting_decision_conflict","meetingId":"<A>","existingCEstadoReserva":"Confirmed"}`.
- Verificación: `Meeting A` sin cambios; **1 fila nueva** de idempotencia
  (`result_status='conflict'`, `result_http_status=409`) —
  `recordAndRespondConflict` sí llama a `persistIdempotentResult`.

### 4.6 Paso H — Cierre del flag

`ConfigWriter->set('gapssaBookingDecisionEnabled', false)->save()`,
`php -l`, lectura directa confirmando `false`, hora exacta de cierre —
ejecutado inmediatamente tras §4.5, tanto en éxito como ante cualquier
condición de parada (§8) activada durante D–G. Si el propio cierre
fallara, restaurar desde el backup de §4.1.1
(`data/.backup/gapssa/puerta5/<timestamp>/config.php.bak`), con la misma
verificación de `php -l` + lectura directa.

### 4.7 Paso I — Verificaciones de cierre

1. `gapssaBookingDecisionEnabled` estrictamente `false`.
2. `maintenanceMode` sigue en `NULL`.
3. `app-check` — verde.
4. **Comparación fila por fila contra el snapshot de §2.1.12**: releer
   `SELECT id, c_estado_reserva, c_motivo_resolucion_reserva, status, modified_at, deleted FROM meeting WHERE id IN (<los 10 ids del snapshot>);`
   y comparar campo a campo contra el snapshot capturado antes de
   escribir nada — **cero diferencias esperadas** en los 10 `Meeting`
   reales.
5. Conteo de idempotencia — **3 filas exactamente** (§4.3 aprobación +
   §4.4 rechazo + §4.5.2 conflicto de re-decisión; ver desglose completo
   en §6).
6. `gcs_event_link` sigue en `4`.
7. `Meeting` totales tras la Puerta 5A: `12` (10 reales + A + B),
   `cMotivoResolucionReserva IS NOT NULL` en exactamente 2 (A y B).

### 4.8 Paso J — Limpieza (dentro de 5A-2, solo si está expresamente autorizada)

- Recomendación: soft-delete (`deleted=1`, mecanismo nativo de EspoCRM —
  vía API estándar, no la UI, mismo motivo de reproducibilidad que §2.3.1)
  de A y B, **después** de que el flag ya esté de vuelta en `false`
  (§4.6) — nunca antes.
- Nunca borrado físico.
- Conservar las 3 filas de `gapssa_meeting_decision_operation` y
  cualquier entrada de auditoría/stream generada.
- Verificación tras limpieza: `Meeting` activos (`deleted=0`) vuelve a
  **10**; `Meeting` totales incluyendo eliminados: **12**, permanente;
  `gapssa_meeting_decision_operation` sigue en **3** filas.
- **Esta autorización de Puerta 5 (5A-1 + pausa humana + 5A-2) no incluye
  la limpieza por sí sola** — requiere una frase explícita aparte en tu
  aprobación (p. ej. "limpia los fixtures A y B con soft-delete al
  terminar 5A-2"). Si no se incluye, A y B quedan activos
  (`deleted=0`) al terminar la puerta, en sus estados finales
  `Confirmed`/`Canceled`.

---

## 5. Invariante del flag (aplica a todo el documento)

`gapssaBookingDecisionEnabled` permanece en `false` durante: todo el
Bloque 5A-1 (§2), toda la pausa humana (§3), y antes de §4.1.3 dentro del
Bloque 5A-2. Solo pasa a `true` en §4.1.3 y solo permanece así durante la
ejecución continua de §4.2–§4.5, cerrándose en §4.6 inmediatamente al
terminar esa secuencia o ante cualquier condición de parada. **En ningún
momento de todo el proceso hay una espera de confirmación, revisión o
intervención humana con el flag en `true`.**

---

## 6. Conteo de operaciones (físicas vs. eventos de negocio, sin mezclar)

Sin cambios respecto a V2 §12 — se reproduce aquí para que este
documento sea autosuficiente:

### 6.1 Escrituras físicas totales

| Escritura | Cantidad |
|---|---|
| `data/config.php` (`gapssaBookingDecisionEnabled`) | 2 (abrir + cerrar) |
| `Meeting` — `INSERT` (creación de fixtures, §2.3) | 2 |
| `Meeting` — `UPDATE` con efecto real (§4.3/§4.4) | 2 |
| `gapssa_meeting_decision_operation` — `INSERT` | 3 |
| **Total** | **9** |

### 6.2 Desglose por llamada a `PutDecide` (6 llamadas totales)

| Llamada | `Meeting UPDATE` | `gapssa_meeting_decision_operation INSERT` |
|---|---|---|
| Aprobación inicial (§4.3) | 1 (A) | 1 |
| Replay aprobación | 0 | 0 |
| Rechazo inicial (§4.4) | 1 (B) | 1 |
| Replay rechazo | 0 | 0 |
| Clave reutilizada, payload incompatible (§4.5.1) | 0 | 0 |
| Clave nueva, Meeting ya resuelto (§4.5.2) | 0 | 1 |
| **Total** | **2** | **3** |

### 6.3 Las 4 llamadas "sin nuevo efecto de negocio"

Ninguna de estas 4 llamadas cambia `cEstadoReserva`/
`cMotivoResolucionReserva` de ningún `Meeting`: los 2 replays y las 2
pruebas negativas. Dentro de esas 4, 3 tampoco escriben fila nueva (los 2
replays y §4.5.1) — pero §4.5.2 sí añade 1 fila de idempotencia (registro
del conflicto) sin tocar ningún `Meeting`. No se mezclan ambas nociones.

### 6.4 Efectos derivados — sin número afirmado

Auditoría de campo/stream de EspoCRM sobre los 2 `UPDATE` de `Meeting`:
se observan y registran en la entrega, sin afirmar de antemano un número
exacto de filas — su comportamiento no se ha revisado línea a línea para
este documento, a diferencia de la tabla de idempotencia (§6.2, sí
verificada contra el código real). Una entrada que mencione un `Meeting`
fuera de A/B sí es condición de parada (§8).

### 6.5 Google Calendar

`0` eventos reales previstos — `assignedUser` sin `gcs_account` activa,
confirmado en §2.1.16 antes de crear los fixtures.

---

## 7. Separación de alcance — Puerta 5A vs. Puerta 5B (sin cambios)

- Esta propuesta es exclusivamente **5A** (5A-1 + 5A-2): EspoCRM +
  `PutDecide` directamente, vía `portal-gapssa-api`, sin pasar por
  `apps/web`.
- `ESPO_BOOKING_ADAPTER` permanece en `simulated` en todos los entornos
  durante toda la Puerta 5A.
- **Puerta 5B** (BFF → `HttpEspoBookingAdapter` → EspoCRM real,
  `ESPO_BOOKING_ADAPTER=http`): subpuerta futura, propuesta aparte, no
  detallada aquí. Ninguna llamada desde el BFF a EspoCRM real ocurre en
  esta puerta.

---

## 8. Condiciones de parada

- Cualquier discrepancia en los puntos 1–11 de §2.1.
- Cualquiera de las bifurcaciones controladas de §2.2 que no sea
  "Continuar".
- La pausa humana (§3) revela cualquier error (ítem ausente, modal roto,
  error de consola, `PUT` disparado sin confirmar) o tu confirmación no
  llega/es negativa.
- El flag no puede verificarse tras escribirlo o no puede revertirse a
  `false` de forma confirmada.
- Cualquier cambio detectado en un `Meeting` no marcado
  `[PRUEBA PUERTA5]` (comparación de §4.7.4 contra el snapshot de
  §2.1.12).
- Cualquier discrepancia entre `cEstadoReserva`/`status`/
  `cMotivoResolucionReserva` y lo esperado en §4.3/§4.4.
- `modifiedById` distinto del esperado en cualquiera de las escrituras de
  §4.3–§4.5.
- Cualquier fila de idempotencia inesperada — de más, de menos, o con
  contenido distinto del descrito en §6.2.
- El cuerpo de §4.5.1 llega como JSON en vez de texto plano, o con
  contenido distinto de `idempotency_key_reused`.
- Una `operationKey` candidata ya existe en la tabla de idempotencia
  antes de usarse (§4.2) y no se resuelve con una nueva generación.
- Cualquier efecto inesperado de Google Calendar Sync.
- Una entrada de auditoría/stream que mencione un `Meeting` fuera de A/B.

Cualquiera de estas, con el flag ya en `true`, dispara el cierre de §4.6
inmediatamente, antes de investigar la causa.

---

## 9. Entrega — resumen ejecutivo

- **Estructura**: Bloque 5A-1 (§2) → pausa humana obligatoria (§3, sin
  ejecución de esta sesión) → Bloque 5A-2 (§4), solo tras tu confirmación
  explícita.
- **Payloads redactados**: §2.3.3 (creación), §4.3 (aprobación), §4.4
  (rechazo), §4.5.1/§4.5.2 (negativas).
- **Bifurcaciones controladas**: §2.2 — cuatro rutas exhaustivas, dos de
  ellas STOP con propuestas documentadas y sin ejecutar (§2.2.1).
- **Escrituras físicas exactas**: 9 (§6.1) — 2 config, 2 `Meeting`
  `INSERT`, 2 `Meeting` `UPDATE`, 3 idempotencia `INSERT`.
- **Backup**: `data/.backup/gapssa/puerta5/<timestamp>/`, modo `600`,
  solo hash/stat registrados, acumulativo (§4.1).
- **Invariante del flag**: `false` en todo momento salvo la ventana
  mínima y continua de §4.2–§4.5 (§5).
- **Rollback**: del flag, cubierto por §4.1/§4.6 con backup como última
  red; de los `Meeting` de prueba, no hay reversión de una decisión ya
  confirmada por diseño — la corrección es el soft-delete de §4.8; de la
  tabla de idempotencia, no se propone rollback.
- **Política de limpieza**: §4.8 — soft-delete de A/B recomendado, dentro
  de 5A-2, no ejecutado sin autorización expresa y separada.
- **Separación 5A/5B**: §7 — esta propuesta es exclusivamente 5A.

---

**Queda a la espera de tu aprobación explícita del Bloque 5A-1** (§2) —
5A-2 (§4) requiere, además, tu confirmación explícita posterior de la
pausa humana (§3). Para producir este documento solo se ha leído el
repositorio (código PHP/TS existente, documentos previos de las Puertas
3/3B/4) — cero lecturas reales contra `gapssa-espocrm-1`, cero fixtures
creados, cero cambios de config, cero llamadas a `PutDecide`, cero
limpieza, cero commits.

---

## 13. Actualización de cierre — Puerta 5A cerrada y limpia (2026-08-13)

Referenciada desde `docs/fase4b-puerta5a-limpieza-propuesta.md` §12.3 y
`docs/fase4b-puerta6c-correccion-oauth-delete.md` §7.9/§8.1.

**Puerta 5A: cerrada y limpia.** Los tres Meetings de prueba (Fixture A
antiguo, Fixture A nuevo, Fixture B) están fuera del conjunto activo de
`Meeting`, sin ninguno de los tres afectando los conteos ni el estado del
negocio real:

- Bloque 5A-2 (§4 de este documento): ejecutado el 2026-08-13, 2 éxitos + 2
  conflictos vía `PutDecide`, cero duplicados, cero fila `processing` — las
  4 filas de idempotencia se conservan como evidencia (sin rollback, por
  diseño, §4.8).
- Limpieza de Fixtures (`docs/fase4b-puerta5a-limpieza-propuesta.md` §12):
  soft-delete del Fixture A ejecutado el mismo día. Detenida antes de tocar
  el Fixture B por el hallazgo de OAuth incondicional en cualquier ruta
  DELETE (§12.3 de ese documento).
- Corrección y despliegue (Puerta 6C, `docs/fase4b-puerta6c-correccion-oauth-delete.md`
  §8): `SyncService::processDelete()` desplegado y verificado contra
  `gapssa-espocrm-1` real sin crear ningún `Meeting` nuevo — reutilizó el
  Fixture A ya soft-deleted como objeto de verificación.
- Limpieza del Fixture B: autorizada de forma explícita y separada el
  mismo día, tras el despliegue verificado de la Puerta 6C. Las 15
  precondiciones exigidas se revalidaron en verde inmediatamente antes de
  escribir (incluida `gcsSyncStartAt`, comprobada vía el servicio `Config`
  real, no solo `data/config.php` — ver §0.2). Soft-delete ejecutado vía
  `EntityManager::removeEntity()`. El job `GcsPushEvent(action=delete)`
  encolado por el hook llegó a estado terminal `Success` (no `Failed` como
  en el caso del Fixture A) — con la corrección de la Puerta 6C desplegada,
  `processDelete()` encontró 0 `GcsEventLink` para el Fixture B y retornó
  antes de crear ningún cliente de Google: cero intento de OAuth, cero
  tráfico hacia Calendar. `GcsAccount` quedó byte/valor-equivalente
  (`status`, hash de `lastError`, `lastSyncAt`, `tokenExpiresAt` sin
  ningún cambio). Backup no sensible en
  `data/.backup/gapssa/puerta5-limpieza-b/20260813T092701Z/`.

**Estado final**: los tres Fixtures, soft-deleted e intactos en sus campos
de negocio; `Meeting` activos 7 / soft-deleted 6 (sin cambio en el total
histórico de 13); 4 filas de idempotencia conservadas como evidencia; 4
`GcsEventLink` reales, ninguno relacionado con los Fixtures; usuario técnico
y equipo técnico conservados (decisión pendiente, no ejecutada aquí, sobre
su reutilización en la Puerta 5B — §7 de `docs/fase4b-puerta5a-limpieza-propuesta.md`);
`gapssaBookingDecisionEnabled=false`; `ESPO_BOOKING_ADAPTER=simulated`.

**Sigue pendiente, fuera del alcance de este cierre** (§0.5, sin cambio): la
reconexión OAuth deliberada de la cuenta Business real — el `GcsAccount`
sigue en `status=Error` con el `lastError` heredado del incidente original,
sin que este cierre lo corrija ni lo intente corregir.

La Puerta 5B (`docs/fase4b-puerta5b-propuesta-v1.md`) permanece sin
iniciar, a la espera de su propia autorización explícita y separada.
