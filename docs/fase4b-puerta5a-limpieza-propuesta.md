# Puerta 5A — Propuesta de limpieza (post Bloque 5A-2)

**Estado**: propuesta documental únicamente. **No ejecutada.** Requiere tu
autorización explícita y separada, con una frase que cubra específicamente
la limpieza (p. ej. "limpia los Fixtures A y B con soft-delete") — la
aprobación de esta propuesta como documento no autoriza su ejecución.

## 0. Punto de partida — auditoría de cierre 2026-08-13

Esta propuesta se apoya en la auditoría de solo lectura ejecutada contra
`gapssa-espocrm-1` real el 2026-08-13 (ver entrega de la sesión y
`docs/fase4b-puerta5-propuesta-v3.md`, sección "Bloque 5A-2 — ejecutado").
Estado confirmado en el momento de escribir esta propuesta:

| Entidad | Estado |
|---|---|
| Fixture A (`6a7cf117522f19bcf`) | activo, `cEstadoReserva=Confirmed`, `status=Planned`, `cExcluirGoogleCalendarSync=1`, `assignedUserId=6a7c5d4868f7a2699` (usuario técnico), cero `GcsEventLink`, cero jobs GCS |
| Fixture B (`6a7cf18e8d7531711`) | activo, `cEstadoReserva=Canceled`, `status=Not Held`, nota `"Rechazo controlado de prueba Puerta 5A"` en `description`, `cExcluirGoogleCalendarSync=1`, mismo usuario técnico, cero `GcsEventLink`, cero jobs GCS |
| Fixture A antiguo (`6a7c63799527a4746`) | soft-deleted (`deleted=1`), cero `GcsEventLink`, 2 jobs `GcsPushEvent` en `Failed`/`attempts=0`/`failed_attempts=1` — terminales, no reintentables |
| `gapssa_meeting_decision_operation` | 4 filas, todas `confirmed`/`conflict`, ninguna `processing` |
| `gcs_event_link` global | 4 filas (2 activas, 2 soft-deleted), ninguna relacionada con A/B/A-antiguo |
| Flag `gapssaBookingDecisionEnabled` | `false` (confirmado vía `Config`, no solo `data/config.php`) |
| `ESPO_BOOKING_ADAPTER` | `simulated` (raíz `.env`, usado por `apps/web`) |

## 1. Alcance de esta limpieza

Exclusivamente los tres Meetings de prueba de la Puerta 5A. **No incluye**:
el usuario técnico, el equipo `Asignación Portal GAPSSA`, ninguna fila de
idempotencia, ninguna ACL, ningún flag, ninguna credencial, ningún cambio
en `apps/web`. Cada uno de esos puntos se trata por separado en §5–§7 como
decisión aparte, no como parte de la limpieza en sí.

## 2. Soft-delete nativo de Fixture A y Fixture B

- Mecanismo: `EntityManager::removeEntity()` vía `bin/command` o script PHP
  con `Application::setupSystemUser()` — el mismo mecanismo ORM que usa la
  API REST estándar (`DELETE /api/v1/Meeting/{id}`), nunca SQL directo
  (`DELETE`/`UPDATE meeting SET deleted=1` a mano), nunca la UI (para
  mantener el procedimiento reproducible y auditable, mismo criterio que
  §2.3.1 de `fase4b-puerta5-propuesta-v3.md`).
- Orden: primero Fixture A, después Fixture B, cada uno verificado
  individualmente antes de continuar con el siguiente — nunca en una sola
  transacción por lotes.
- Autenticación: usuario de sistema (`setupSystemUser()`) o `admin` —
  **nunca** `portal-gapssa-api`, que no tiene `Meeting.delete` en su ACL y
  no debería adquirirlo solo para esta limpieza puntual.

## 3. Por qué la exclusión GCS ya activa hace segura esta limpieza

- `Meeting.cExcluirGoogleCalendarSync=true` en ambos Fixtures (desplegado
  por `docs/fase4b-puerta6-exclusion-gcs.md`, Parte B) hace que
  `GcsPush::afterRemove()` corte antes de encolar ningún job — el
  soft-delete no genera ningún job `GcsPushEvent(action=delete)` para
  A ni B, a diferencia de lo ocurrido con el Fixture A antiguo (§0, fila
  3), que no tenía el campo activo cuando se soft-eliminó.
- **Aclaración explícita pedida**: esta protección depende de la exclusión
  GCS, no de la ausencia de `GcsEventLink`. Si alguno de los dos Fixtures
  tuviera una fila `GcsEventLink` heredada de un intento anterior (no es el
  caso aquí — verificado en §0 y en §4), un `DELETE` con exclusión GCS
  activa seguiría siendo una limpieza permitida: `SyncService::processPush()`
  seguiría cortando por la exclusión antes de llegar a
  `deleteByLinks()`, sin necesidad de purgar la fila `GcsEventLink` primero.
  Esta propuesta no depende de la coincidencia de que ambos conteos sean 0.

## 4. Verificación previa (antes de ejecutar, si se autoriza)

```sql
SELECT COUNT(*) FROM gcs_event_link
WHERE meeting_id IN ('6a7cf117522f19bcf','6a7cf18e8d7531711');
-- esperado: 0 (confirmado en la auditoría de 2026-08-13)
```

Si esta consulta devolviera un valor distinto de 0 en el momento real de
ejecución, la limpieza se detiene y se re-evalúa contra §3 antes de
continuar — no se asume que el resultado de la auditoría siga siendo
válido sin releerlo inmediatamente antes de escribir.

## 5. Estado y conservación de las 4 filas de idempotencia

- **Recomendación: conservarlas como evidencia.** `gapssa_meeting_decision_operation`
  no tiene relación de borrado en cascada con `Meeting` (columna
  `meeting_id` es una referencia lógica, no una FK con `ON DELETE CASCADE`
  en el esquema real) — el soft-delete de A/B no las toca por sí solo,
  y esta propuesta no pide ninguna acción adicional sobre ellas.
- **No se propone borrado físico automático** de estas filas bajo ninguna
  circunstancia de esta limpieza. Son el único registro auditable de que
  el Bloque 5A-2 ejecutó exactamente las operaciones documentadas
  (2 éxitos + 2 conflictos, cero duplicados, cero fila `processing`) y su
  valor como evidencia de cierre supera el de liberar 4 filas.
- Si en el futuro existiera un requisito real de purga (p. ej. política de
  retención de datos operativos, no de PII — estas filas no contienen
  PII), sería una decisión separada, con su propia propuesta y su propio
  respaldo, nunca agrupada con la limpieza de los Fixtures.

## 6. Fixture A antiguo (`6a7c63799527a4746`)

**Debe permanecer intacto.** No forma parte de esta limpieza:
- Ya está soft-deleted desde el incidente de 2026-08-12 (`0.4` de
  `fase4b-puerta5-propuesta-v3.md`).
- Confirmado en la auditoría de 2026-08-13: sigue soft-deleted, sin
  `GcsEventLink`, con sus 2 jobs `GcsPushEvent` en estado terminal
  (`Failed`, `attempts=0`) — no reintentables, no requieren ninguna
  intervención.
- Es evidencia del incidente de OAuth documentado en §0 de
  `fase4b-puerta5-propuesta-v3.md` — eliminarlo o modificarlo (incluida
  cualquier purga física) sería destruir esa evidencia sin necesidad
  operativa alguna.

## 7. Usuario técnico (`tecnico-puerta5-asignacion`, `6a7c5d4868f7a2699`)

- **Recomendación: conservarlo.** Confirmado activo en la auditoría de
  2026-08-13, sigue siendo miembro del equipo `Asignación Portal GAPSSA`
  (`6a7c43c8ea6f5c370`, 3 miembros, sin cambios).
- **No se propone su eliminación como parte de esta limpieza.** Es el
  `assignedUser` que la Puerta 5B necesitará reutilizar (o, como mínimo,
  usar como referencia) para cualquier `Meeting` real creado vía
  `HttpEspoBookingAdapter` a través del equipo técnico de asignación — su
  retirada antes de que la Puerta 5B defina si lo reutiliza o crea un
  usuario distinto sería una decisión prematura y potencialmente
  irreversible sin justificación operativa.
- **Cualquier retirada de este usuario debe ser una autorización
  independiente**, explícitamente posterior a que se decida el papel del
  usuario técnico dentro de la Puerta 5B (ver Propuesta B, §6.4), nunca
  agrupada con esta limpieza de Fixtures.

## 8. Backup no sensible

- Ubicación: `data/.backup/gapssa/puerta5-limpieza/<timestamp>/`, modo
  `700`/`600`, propietario `www-data:www-data` — mismo patrón que los
  backups previos de la Puerta 5 (`fase4b-puerta5-propuesta-v3.md` §4.1,
  incidente §0.4).
- Contenido: snapshot de los campos no-PII de A y B
  (`id, c_estado_reserva, c_motivo_resolucion_reserva, status,
  c_excluir_google_calendar_sync, assigned_user_id, modified_at`) antes de
  la operación, más los IDs de las 4 filas de idempotencia y su
  `result_status`/`result_http_status` (sin `payload_hash`, sin cuerpo
  completo).
- Nunca se registra `name`/`description` de los Meetings en el backup si
  contuvieran texto libre distinto del ya conocido (`description` de B es
  el texto operativo ya citado en §0 de esta propuesta, sin PII —
  se incluye tal cual porque ya es público en el propio documento de
  cierre).
- SHA-256 y `stat` del backup, registrados en la entrega — nunca el
  contenido del backup mostrado directamente si llegara a incluir algo
  sensible por error (no se espera, dado el alcance no-PII).

## 9. Conteos esperados antes/después

| Métrica | Antes | Después |
|---|---|---|
| `Meeting` activos (`deleted=0`) | 9 | 7 |
| `Meeting` soft-deleted | 4 | 6 |
| `Meeting` totales | 13 | 13 (sin cambio — soft-delete no borra filas) |
| `gapssa_meeting_decision_operation` | 4 | 4 (sin cambio, §5) |
| `gcs_event_link` | 4 | 4 (sin cambio — ninguna relación con A/B) |
| Jobs `GcsPushEvent` nuevos | 0 | 0 esperado (exclusión GCS activa, §3) |

## 10. Rollback y condiciones de parada

- **Rollback de un soft-delete individual**: restaurar `deleted=0` vía
  `EntityManager` (o `PUT` estándar si el mecanismo elegido lo permite) es
  técnicamente reversible sin pérdida de datos — a diferencia de una
  decisión (`PutDecide`), un soft-delete no tiene efectos de negocio
  adicionales que deshacer. No se necesita backup completo del registro
  para revertir, solo el `id`.
- **Condiciones de parada** (detener antes de continuar con el segundo
  Fixture, o antes de ejecutar cualquiera, según en qué punto ocurra):
  - §4 devuelve un conteo de `GcsEventLink` distinto de 0 para A o B.
  - El soft-delete de A o B genera cualquier job nuevo (`GcsPushEvent` o
    de cualquier otra clase) — contradeciría §3 y debe investigarse antes
    de continuar.
  - `gapssa_meeting_decision_operation` cambia de tamaño (4 → distinto de
    4) tras la operación — indicaría un efecto no esperado del
    soft-delete sobre esa tabla.
  - Cualquier error HTTP/excepción durante la llamada a
    `EntityManager::removeEntity()`.
- **No hay condición que autorice, por sí sola, avanzar a borrado físico**
  bajo ningún resultado de esta limpieza.

## 11. Explícitamente fuera de esta propuesta

- Ningún `DROP`, ningún `DELETE` SQL directo, ningún borrado físico de
  ninguna tabla o fila, bajo ninguna circunstancia.
- Ningún cambio a `ESPO_BOOKING_ADAPTER`, OAuth, `gcsSyncStartAt`, ACL,
  roles, equipos, o al usuario técnico (más allá de la recomendación de
  conservarlo, §7).
- Ninguna conexión de `apps/web` a `gapssa-espocrm-1` real.
- Ningún commit.

---

## 12. Ejecución real — parcial, detenida por incidente (2026-08-13)

**Estado: EJECUCIÓN PARCIAL, DETENIDA.** Autorizada explícitamente el
2026-08-13. Solo se completó el soft-delete del Fixture A. El Fixture B
**no se ha tocado** — la limpieza queda detenida hasta que se corrija y
verifique el defecto descrito abajo.

### 12.1 Precondiciones — revalidadas en verde antes de escribir

Las 15 precondiciones exigidas por la autorización se revalidaron por
lectura directa contra `gapssa-espocrm-1` real inmediatamente antes de
escribir, todas en verde, sin ninguna divergencia: `app-check` verde,
`maintenanceMode=NULL`, `gapssaBookingDecisionEnabled=false`,
`ESPO_BOOKING_ADAPTER=simulated`, `gcsSyncStartAt="2026-08-04 16:32:05"`
intacto, `GcsAccount.status=Error` con el mismo `last_error` del incidente
previo (`2026-08-12 12:43:09 UTC`, sin cambio), ACL de
`cExcluirGoogleCalendarSync` en ambos roles intacta, Fixture A y B con su
estado exacto esperado (0 vínculos, 0 contactos, usuario técnico intacto),
Fixture antiguo soft-deleted sin vínculo y sin jobs reintentables (`Failed`,
`attempts=0`), las 4 filas de idempotencia exactas, `gcs_event_link=4`,
los 10 Meetings reales sin cambio, y 0 jobs GCS pendientes/reintentables
asociados a A/B en ese momento.

### 12.2 Backup

Creado en
`data/.backup/gapssa/puerta5-limpieza/20260813T075937Z/snapshot.json`,
propietario `www-data:www-data`, modo `600`. SHA-256:
`ce992da8c46d3076baab17aebc4e87c4a122e29de9c19f9bbeecfc7e470b8334`.
Contenido: snapshot no-PII de A/B/Fixture antiguo, snapshot de los 10
Meetings reales, referencias seguras (hash) de las 4 filas de
idempotencia, configuración efectiva, ACL, usuario/equipo técnico,
conteos antes, procedimiento de reversión — sin API Keys, tokens,
contraseñas ni PII.

### 12.3 Análisis previo de GCS — correcto en su alcance, incompleto en un punto

El análisis previo a la ejecución (§3 de esta propuesta) confirmó
correctamente, leyendo el código vivo, que `deleteByLinks()`
(`SyncService.php`, entonces líneas 301-331) solo llama a
`$service->events->delete()` para filas `GcsEventLink` existentes, y que
con 0 filas para A/B ese bucle no ejecuta ninguna llamada. **Esa parte
sigue siendo exacta.** Lo que el análisis previo no verificó — y debería
haberlo hecho — es qué ocurre **antes** de llegar a `deleteByLinks()`:
`processPush()` crea el cliente de Google (`createCalendarService()`,
entonces línea 217) de forma **incondicional**, antes de comprobar si hay
vínculos que borrar. Crear ese cliente desencadena, dentro de
`GoogleClientFactory::createForAccount()` →
`TokenService::getAccessToken()`, un intento real de renovación del token
OAuth si el access token está caducado (que lo estaba). Ver §13 de
`docs/fase4b-puerta5-propuesta-v3.md` (actualización de cierre) y el
diagnóstico completo de Fase 2 de esta sesión para el detalle línea por
línea.

**Corrección explícita de una afirmación previa**: la propuesta original
(§3 de este mismo documento) decía *"un DELETE con exclusión GCS activa
seguiría siendo una limpieza permitida"* dando a entender, sin decirlo
literalmente, que un DELETE sin vínculo no generaría ningún tráfico
externo. **Eso no es del todo cierto en el código real**: sí hay tráfico
— hacia el endpoint OAuth de Google, no hacia la API de Calendar — antes
de que el código sepa que no hay nada que borrar. La distinción entre
"tráfico OAuth" y "tráfico API Calendar" no estaba hecha explícita en la
propuesta original.

### 12.4 Secuencia real del soft-delete del Fixture A (timestamps UTC)

1. **08:00:34** — `EntityManager::removeEntity()` ejecutado sobre
   `6a7cf117522f19bcf` (vía `bin/command`/script PHP con
   `Application::setupSystemUser()`, nunca SQL directo). Verificación
   inmediata: `deleted=1`, `cEstadoReserva=Confirmed` (sin cambio de
   negocio), `status=Planned`, `cExcluirGoogleCalendarSync=1` (sin
   cambio), `assignedUserId` intacto. `GcsEventLink` para A: `0` filas,
   confirmado antes y después.
2. **08:00:34** — `GcsPush::afterRemove()` (el hook solo comprueba
   `gcsSyncStartAt`, no la exclusión GCS — así está diseñado, ver §12.5.1)
   encola `GcsPushEvent(action=delete, meetingId=6a7cf117522f19bcf)`. Job
   creado con `attempts=1` (no `0`) — valor tomado de la configuración
   global de EspoCRM `jobRerunAttemptNumber=1` (`Espo\Repositories\Job::beforeSave()`),
   no específico de esta extensión ni de esta limpieza.
3. **08:00:39** — El daemon (`gapssa-espocrm-daemon-1`, en ejecución
   continua desde antes de esta sesión) recoge el job y lo ejecuta:
   `SyncService::pushMeeting('6a7cf117522f19bcf', 'delete')` →
   `processPush()` → `createCalendarService()` → `TokenService::getAccessToken()`
   detecta el access token caducado, obtiene el refresh token cifrado, y
   llama a `$client->fetchAccessTokenWithRefreshToken()` — **primer
   intento real de renovación OAuth**, HTTP hacia el endpoint de tokens
   de Google. Responde `invalid_grant` (mismo fallo de credenciales del
   incidente previo, cuenta Business con el token revocado/caducado).
   `TokenService::handleRefreshError()` fija `GcsAccount.status=Error` y
   `lastError` (primera escritura), lanza `GoogleApiException`, que
   propaga sin capturar hasta `pushMeeting()`, cuyo `catch` llama a
   `registerError()` (segunda escritura sobre `GcsAccount.status`/`lastError`,
   con el formato `"[time UTC] Meeting {id}: {message}"`) y relanza. El
   job queda `Failed`, `attempts=1` (sin decrementar todavía),
   `executed_at=NULL`.
4. **Entre 08:00:39 y el siguiente ciclo de cron** — `QueueUtil::updateFailedJobAttempts()`
   (invocado periódicamente por `JobManager`, parte del ciclo normal de
   cron/daemon, sin ninguna intervención de esta sesión) encuentra el job
   `Failed` con `attempts=1>0` y lo mueve a `Pending`,
   `attempts=1-1=0`, `failedAttempts=1`.
5. **08:00:49** — El daemon reprocesa el job (segundo intento real,
   automático, sin intervención de esta sesión). Mismo camino:
   `createCalendarService()` → `TokenService::getAccessToken()` →
   **segundo intento real de renovación OAuth** → mismo `invalid_grant`.
   `GcsAccount.status`/`lastError` se sobrescriben de nuevo (mismo
   contenido, timestamp `2026-08-13 08:00:49 UTC` nuevo). Job queda
   `Failed`, `attempts=0`, `failedAttempts=1`, `executed_at=NULL` —
   **ahora sí terminal**: `updateFailedJobAttempts()` filtra por
   `attempts>0`, así que un job con `attempts=0` no vuelve a moverse a
   `Pending` nunca más.
6. Esta sesión solo ejecutó lecturas (`SELECT`) entre el paso 3 y el paso
   5 — ninguna intervención sobre el job, la cuenta, ni ningún reintento
   manual.

### 12.5 Qué ocurrió y qué no — sin ambigüedad

| Tráfico/efecto | ¿Ocurrió? |
|---|---|
| Tráfico hacia el endpoint OAuth de Google (`fetchAccessTokenWithRefreshToken`) | **Sí — dos veces** (intento inicial + un reintento automático del daemon) |
| Tráfico hacia la API de Google Calendar (`events.delete`/`events.list`/etc.) | **No** — nunca se llegó a `deleteByLinks()` con una llamada real; ambos intentos fallaron en la fase de token, antes de la API de Calendar |
| Evento eliminado o creado en Google | **No** |
| `GcsEventLink` creado, modificado o eliminado | **No** — 0 antes, 0 después |
| `GcsAccount.status`/`lastError` modificados | **Sí** — el timestamp y el `meetingId` referenciado en `lastError` cambiaron (de `6a7c63799527a4746` del incidente previo a `6a7cf117522f19bcf`); el texto del error y el `status=Error` no cambiaron de forma sustantiva |
| `GcsAccount.refreshToken`/`accessToken`/`tokenExpiresAt` modificados | **No** — `handleRefreshError()` no llama a `storeTokens()`; los tokens en disco no se tocaron |
| Estados de negocio de A (`cEstadoReserva`, `status`, `cMotivoResolucionReserva`) | **Sin cambio** — solo `deleted` pasó a `1` |
| Fixture B | **Sin tocar** — limpieza detenida antes de empezar B |
| 4 filas de idempotencia | **Intactas** |

**No se afirma "cero tráfico Google"** — la afirmación correcta,
distinguiendo explícitamente ambos planos, es: cero tráfico hacia la API
de Calendar, cero efecto en eventos o vínculos, pero **sí** hubo tráfico
real (fallido) hacia el endpoint OAuth, dos veces, y **sí** se modificó
`GcsAccount.last_error`/timestamp como efecto colateral de esos dos
intentos.

### 12.6 Por qué se detiene aquí

La garantía que motivó autorizar esta limpieza — *"un DELETE sin vínculo
no genera tráfico externo"* — resultó ser cierta solo para la API de
Calendar, no para OAuth. Es una divergencia real respecto a lo esperado,
aunque sin consecuencia observable en este caso concreto (la cuenta ya
estaba en `Error` antes de este incidente; no se "rompió" nada que no
estuviera ya roto). Conforme a la condición de parada acordada
("necesitas tocar OAuth" no estaba prevista como parte de esta limpieza),
la sesión se detuvo, no tocó el Fixture B, y no intervino en el job ni en
`GcsAccount`.

**Puerta 6 (`docs/fase4b-puerta6-exclusion-gcs.md`) requiere una revisión
correctiva** antes de continuar cualquier limpieza o despliegue que
dependa de la garantía "sin vínculo, cero tráfico externo": esa puerta
diseñó y desplegó `cExcluirGoogleCalendarSync`, pero no cubrió este caso
concreto (DELETE sin vínculo con OAuth caducado) porque la exclusión
explícitamente no bloquea las rutas DELETE (por diseño, para no dejar
huérfanos eventos ya sincronizados) — el defecto está en `SyncService`,
no en el diseño de la exclusión en sí.

Diagnóstico completo (línea por línea, todos los caminos DELETE),
corrección propuesta en el repositorio, pruebas nuevas, ensayo desechable
de verificación, y propuesta de despliegue correctivo separada (Puerta
6C): ver el resto de la entrega de esta sesión y
`docs/fase4b-puerta6c-correccion-oauth-delete.md`.

### 12.7 Reanudación de la limpieza del Fixture B

**No autorizada en este documento.** Requiere: (a) la corrección de
`SyncService` verificada en el ensayo desechable, (b) su despliegue real
contra `gapssa-espocrm-1` autorizado y ejecutado como Puerta 6C, y (c)
una autorización explícita y separada para retomar el soft-delete de B —
nunca de forma automática al cerrar la Puerta 6C.

---

## 13. Ejecución real de la limpieza del Fixture B — completada (2026-08-13)

**Estado: EJECUTADA Y VERIFICADA.** Autorizada explícitamente el
2026-08-13, tras el despliegue verificado de la Puerta 6C
(`docs/fase4b-puerta6c-correccion-oauth-delete.md` §8).

### 13.1 Precondiciones

Las 15 precondiciones se revalidaron por lectura directa contra
`gapssa-espocrm-1` real inmediatamente antes de escribir, todas en verde:
`app-check` verde (4/4), `maintenanceMode` ausente/NULL, `gcsSyncStartAt`
comprobada vía el servicio `Config` real (no solo `data/config.php`,
lección de `docs/fase4b-puerta5-propuesta-v3.md` §0.2) = `2026-08-04
16:32:05` intacta, `gapssaBookingDecisionEnabled=false`,
`ESPO_BOOKING_ADAPTER=simulated`, extensión GCS v1.2.0
(`id=6a7d8686d91a8e4b4`) con `SyncService.php` en el hash corregido de la
Puerta 6C (`acebf18373aafaede1ae35ba230ec2e6d278d1ea102bc85a779909ccd34e56eb`),
Fixture B activo/`Canceled`/`Not Held`/`RejectedByStaff`/excluido/0
contactos/0 `GcsEventLink`/usuario técnico intacto, Fixture A nuevo y
antiguo soft-deleted e intactos, 4 filas de idempotencia (2
`confirmed`/2 `conflict`), `gcs_event_link=4` (ninguno de los Fixtures),
`GcsAccount` en el mismo estado posterior al incidente y a la Puerta 6C,
cero jobs GCS pendientes/reintentables asociados a B, ACL/usuario
técnico/equipo técnico intactos, los demás 10 Meetings reales coincidentes
con el snapshot previo.

Nota de corrección durante esta revalidación: una primera lectura de
`gcsSyncStartAt` limitada a `data/config.php` la mostró ausente — el mismo
falso negativo ya documentado en `docs/fase4b-puerta5-propuesta-v3.md`
§0.1/§0.2 (el valor vive en `data/config-internal.php`, fusionado por el
servicio `Config`). Se repitió la comprobación con el servicio `Config`
real antes de continuar; confirmó el valor intacto. No se procedió con
ninguna escritura hasta resolver esta divergencia aparente.

### 13.2 Análisis previo

Se releyó `processPush()`/`processDelete()` directamente desde el archivo
vivo desplegado (mismo hash que §3.1 de la Puerta 6C): `processPush()`
delega cualquier `action=delete` a `processDelete()` antes de crear ningún
cliente; `processDelete()` consulta `GcsEventLink` localmente y retorna
`false` de inmediato si no hay filas — confirmado 0 filas para el Fixture
B. `pushMeeting()` no toca `GcsAccount` cuando `processPush()` devuelve
`false`. Análisis confirmado contra el código real, no solo por lectura de
la documentación de la Puerta 6C.

### 13.3 Backup

`data/.backup/gapssa/puerta5-limpieza-b/20260813T092701Z/`, propietario
`www-data:www-data`, modo `700`/`600`. Contenido: snapshot no-PII de B, A
nuevo, A antiguo y los 13 Meetings reales; las 4 filas de `gcs_event_link`;
referencias seguras (hash SHA-256 de `operation_key`, sin `payload_hash` ni
`result_body`) de las 4 filas de idempotencia; estado técnico de
`GcsAccount` sin tokens; configuración efectiva; hash vivo de
`SyncService.php`; `README.md` con procedimiento de reversión;
`SHA256SUMS.txt` de todo lo anterior.

### 13.4 Ejecución (timestamps UTC)

1. **09:34:36** — marcador temporal capturado antes de escribir.
2. **09:39:26** (`modified_at` del registro) — `EntityManager::removeEntity()`
   ejecutado sobre `6a7cf18e8d7531711` vía script PHP con
   `Application::setupSystemUser()`, nunca SQL directo. Verificación
   inmediata por lectura directa: `deleted=1`, `cEstadoReserva=Canceled`,
   `status=Not Held`, `cMotivoResolucionReserva=RejectedByStaff`,
   `cExcluirGoogleCalendarSync=1`, `assignedUserId` intacto — sin cambio de
   negocio, solo `deleted` y `modified_at`.
3. **09:39:26** — `GcsPush::afterRemove()` encoló
   `GcsPushEvent(action=delete, meetingId=6a7cf18e8d7531711)`, `attempts=1`.
4. **09:39:34** — el daemon procesó el job:
   `SyncService::pushMeeting('6a7cf18e8d7531711','delete')` →
   `processPush()` → `processDelete()` encontró 0 `GcsEventLink` y retornó
   `false` **antes** de crear ningún cliente de Google — cero intento de
   OAuth, cero llamada a Calendar. `pushMeeting()` recibió
   `$touchedGoogle=false` y no tocó `GcsAccount`. Job terminado en estado
   **`Success`** (a diferencia del Fixture A, que quedó `Failed` por el
   intento de OAuth contra un token caducado — aquí no hubo ningún intento
   de red, así que no hubo nada que fallara).

### 13.5 Verificación posterior

- `GcsAccount`: `status`, hash SHA-256 de `lastError`, `lastSyncAt`,
  `tokenExpiresAt`, `modifiedAt` — los cinco exactamente idénticos al
  "antes" (`61a036d9f5924c8adf4bb4b48100767e13d138d33a50b0714cb6695a98bcbad8`,
  sin cambio).
- Log de aplicación (`data/logs/espo-2026-08-13.log`): sin ninguna línea
  nueva de error OAuth después del marcador de 09:34:36 — las dos únicas
  entradas de OAuth del día siguen siendo las de 08:00:39/08:00:49 del
  incidente del Fixture A.
- `gcs_event_link`: `4` antes y después, `0` relacionados con B.
- `gapssa_meeting_decision_operation`: `4` filas antes y después, sin
  cambio.
- Job GCS nuevo: exactamente uno (`6a7d90ce5d9a9a1b1`, `Success`,
  `attempts=1`, sin `failedAttempts`) — terminal, sin próxima ejecución.
  Ningún otro job de clase `GoogleCalendarSync` nuevo.
- Meetings: los 10 Meetings reales y los Fixtures A (nuevo y antiguo)
  byte-idénticos al snapshot previo (mismos `modified_at`). `Meeting`
  activos `8→7`, soft-deleted `5→6`, total histórico sin cambio (`13`).
- ACL, usuario técnico (`tecnico-puerta5-asignacion`, activo) y equipo
  técnico (`Asignación Portal GAPSSA`, 3 miembros): sin cambio.
- `gapssaBookingDecisionEnabled=false`, `ESPO_BOOKING_ADAPTER=simulated`,
  `gcsSyncStartAt` intacto: sin cambio.

### 13.6 Desviaciones respecto al plan

Ninguna en el resultado. Única nota operativa: la primera lectura de
`gcsSyncStartAt` durante la revalidación de precondiciones (§13.1) produjo
un falso negativo por leer solo `data/config.php`; se corrigió antes de
escribir, sin impacto en el resultado ni necesidad de detener la
operación una vez verificada con el servicio `Config` real.

### 13.7 Estado final de la Puerta 5A

**Puerta 5A cerrada y limpia.** Los tres Fixtures (A antiguo, A nuevo, B)
están soft-deleted, fuera del conjunto activo de `Meeting`, con sus campos
de negocio intactos. Ver también la actualización de cierre en
`docs/fase4b-puerta5-propuesta-v3.md` §13. La Puerta 5B permanece sin
iniciar, a la espera de su propia autorización explícita y separada — no
se ha llamado a `PutDecide`, no se ha iniciado ninguna parte de la Puerta
5B, no se ha cambiado `ESPO_BOOKING_ADAPTER`, no se han hecho commits.

---

**Queda a la espera de tu autorización explícita y separada.** El estado
de escritura real de esta propuesta es: Fixture A soft-deleted (12.1-12.5
arriba), Fixture B soft-deleted y verificado (§13), limpieza de la Puerta
5A completada.
