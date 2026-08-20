# Puerta 5 — auditoría de solo lectura de Google Calendar Sync y decisión operativa para los Fixtures A/B

> **Actualización posterior (2026-08-12)**: la subpuerta de §7 (usuario
> técnico) y la reanudación del Bloque 5A-1 sí se ejecutaron después de este
> documento. La reanudación falló y fue contenida — ver
> `docs/fase4b-puerta5-propuesta-v3.md` §"Incidente" para la causa raíz
> exacta (`gcsSyncStartAt` activo en `data/config-internal.php`, invisible
> para quien solo lee `data/config.php`) y el estado final. **La Puerta 5A
> queda bloqueada**; no reanudar sin resolver primero el token OAuth
> caducado/revocado de la cuenta Business (incidencia operativa separada) y
> una decisión de arquitectura para aislar las pruebas de GCS. Esa
> arquitectura de aislamiento es `docs/fase4b-puerta6-exclusion-gcs.md`
> (campo `cExcluirGoogleCalendarSync`, diseñado y probado en repositorio +
> ensayo desechable, aún no desplegado contra `gapssa-espocrm-1`).

**Nada de esto está ejecutado.** No se ha reanudado el Fixture A, no se ha
creado el Fixture B, no se ha creado ningún usuario técnico real, no se ha
llamado a `PutDecide`, no se ha tocado `data/config.php`, no se ha hecho
ningún commit. Todo lo descrito aquí procede de: (a) lecturas SQL mínimas,
agregadas y sin PII contra `gapssa-espocrm-1` real, vía `docker compose exec
espocrm-db`; (b) lectura del código PHP desplegado dentro del contenedor
`gapssa-espocrm-1` (`/var/www/html/application/...`, núcleo real de EspoCRM
10.0.3) y del repositorio de la extensión Google Calendar Sync
(`extensions/espocrm-google-calendar-sync/files/...`); (c) los documentos
previos de las Puertas 3C, 3D y 4 (`docs/fase4b-puerta3c-*`,
`docs/fase4b-puerta3d-*`, `docs/fase4b-puerta4-cierre.md`,
`docs/fase4b-puerta5-propuesta-v3.md`). Ningún ensayo desechable nuevo se ha
levantado en esta sesión — se explica por qué en §6.

---

## 0. Hallazgo principal — corrige la premisa del encargo

El encargo asumía un diseño "una cuenta Google por profesional"
(`gcs_account` ligada al `assignedUser` del `Meeting`). **Eso no es lo que
hace la extensión hoy.** Google Calendar Sync fase 1 (única fase
implementada, `docs/DECISIONS.md`/`03-espocrm-modelo-y-extension-gcs.md`)
usa **una única cuenta compartida `type=Business`**, administrada por el
negocio, que sincroniza **todos** los `Meeting` de la instancia hacia **un
solo calendario**, con independencia de quién sea el `assignedUser`.
Verificado en `SyncService::getBusinessAccount()`
(`Classes/SyncService.php:38-47`): la consulta filtra por
`type='Business'`, nunca por `assignedUserId` ni por ninguna cuenta
`type='User'` (ese tipo existe en el enum de `GcsAccount.type`, pero es para
la fase 2 —bidireccional, no construida— y hoy no hay ninguna fila con ese
tipo, confirmado en §2).

**Consecuencia directa para todo el resto de este documento**: la pregunta
"¿el `assignedUser` de los Fixtures A/B tiene `gcs_account` activa?" no es la
pregunta correcta — la respuesta es estructuralmente **no aplica**, porque
en fase 1 ningún `assignedUser` tiene nunca una cuenta propia. La pregunta
correcta es: **¿está la cuenta Business compartida conectada y activa, y
está encendido el interruptor maestro de sincronización?** — eso, no el
`assignedUser`, es lo único que determina si un `Meeting` cualquiera
produce tráfico hacia Google. Esto invalida la idea de que un "usuario
técnico sin `gcs_account`" evita por sí solo la sincronización — ver §3 y
§4.

---

## 1. Auditoría real de solo lectura — profesional 6a71e26f5a32d9575

Consulta mínima ejecutada, sin `SELECT *` y sin ninguna de las columnas
prohibidas (`accessToken`, `refreshToken`, `googleEmail`, `calendarId`,
`syncToken`, `oauthState`, `config`):

```sql
SELECT type, status,
       (calendar_id IS NOT NULL AND calendar_id <> '') AS has_calendar_id,
       (user_id IS NOT NULL) AS has_user_id,
       deleted
FROM gcs_account;
```

Resultado — **una única fila**:

| `type` | `status` | `has_calendar_id` | `has_user_id` | `deleted` |
|---|---|---|---|---|
| `Business` | `Active` | `1` | `0` | `0` |

No existe ninguna fila `type='User'`. El profesional 6a71e26f5a32d9575 no
tiene, no ha tenido y no puede tener hoy una `gcs_account` propia — esa
funcionalidad no está construida.

**Entrega exacta pedida por el encargo**, con la matización de §0:

```
profesional_gcs_activa = false     (no existe cuenta propia — no aplica en fase 1)
meetings_sync_enabled  = false     (interruptor maestro gcsSyncStartAt ausente — ver §3)
```

**Estado técnico imprescindible** para decidir si los hooks operarían hoy
(§3 desarrolla el porqué):

- Cuenta Business: **conectada y activa**, con calendario elegido
  (`has_calendar_id=1`).
- `gcsSyncStartAt` (interruptor maestro, `data/config.php`): **ausente**.
- Por tanto, con el estado de hoy, ningún `Meeting` —de ningún
  `assignedUser`, incluido el profesional real— produce tráfico hacia
  Google. Ver §3.3 sobre por qué este "hoy" no es una garantía de diseño en
  la que apoyar la decisión.

---

## 2. Comportamiento exacto de GCS — leído del código real desplegado

### 2.1 Hook en `POST` de `Meeting` (creación)

`Hooks/Meeting/GcsPush.php::afterSave()` (`AfterSave`, se ejecuta en el
mismo request que el `POST`, nunca llama a Google directamente):

```php
if ($options->get('silent') || $options->get('gcsSync')) return;
if (!$this->config->get('gcsSyncStartAt')) return;   // interruptor maestro
if (!$entity->isNew() && !$this->hasRelevantChange($entity)) return;
$this->schedule($entity->getId(), SyncService::ACTION_UPSERT);
```

`schedule()` solo **encola** el job `GcsPushEvent` (grupo `gcs-push`); el
`POST` responde sin esperar a Google. El job, cuando el daemon lo procesa,
llama a `SyncService::pushMeeting()`.

### 2.2 `PendingCenterApproval` → `Confirmed`

`PutDecide` (vía `HttpEspoBookingAdapter`/`GapssaMeetingDecision`, ajeno a
GCS) solo escribe `cEstadoReserva`/`cMotivoResolucionReserva` — campos
custom de Gapssa, invisibles para la extensión GCS genérica. El `status`
nativo de EspoCRM **no cambia** en una aprobación (se deriva a `Planned` ya
en la creación y se mantiene, confirmado en
`docs/fase4b-puerta5-propuesta-v3.md` §4.3). `GcsPush::hasRelevantChange()`
solo mira `name`, `description`, `dateStart`, `dateEnd`, `dateStartDate`,
`dateEndDate`, `isAllDay`, `status`, `assignedUserId` — ninguno de ellos
cambia en una aprobación que solo toca los dos campos custom. **Conclusión:
aprobar un `Meeting` no dispara, por sí solo, ninguna llamada nueva a
Google** — corrige la asunción del encargo de que "aprobar A" implica una
"actualización del evento". Solo habría actualización si el `PUT` también
tocara `name`/fechas/`assignedUserId`, cosa que el payload de aprobación de
la Puerta 5A no hace.

### 2.3 `PendingCenterApproval` → `Canceled`

El rechazo sí deriva `status` nativo → `Not Held`
(`EstadoReservaStatusMap`, confirmado en el mismo documento §4.4). `status`
**sí** está en la lista de atributos relevantes de `GcsPush` → se encola un
`UPSERT`. Dentro de `SyncService::processPush()`:

```php
$mustDelete = $action === self::ACTION_DELETE || !$meeting || $this->eventMapper->isCanceled($meeting);
```

`EventMapper::isCanceled()` comprueba `status` contra
`metadata.scopes.Meeting.canceledStatusList` (por defecto `['Not Held']`,
sin personalización en este proyecto). Con `status=Not Held`,
`mustDelete=true` → se ejecuta `deleteByLinks()`: **se elimina el evento de
Google** (no se marca como cancelado dentro de Google, se borra) y se borra
la fila `GcsEventLink` correspondiente.

### 2.4 Soft-delete

El soft-delete de EspoCRM (mecanismo nativo: `deleted=1`, nunca borrado
físico) se ejecuta a través de `RDBRepository::remove()`
(`/var/www/html/application/Espo/ORM/Repository/RDBRepository.php:258-287`),
que llama **síncronamente** a `afterRemove()` dentro del mismo método
`removeInternal()` — confirmado leyendo el núcleo real desplegado, no
documentación pública. Eso dispara `GcsPush::afterRemove()`:

```php
if (!$this->config->get('gcsSyncStartAt')) return;
$this->schedule($entity->getId(), SyncService::ACTION_DELETE);
```

Mismo efecto que Not Held: se encola un `DELETE` (`deleteByLinks()`, elimina
el evento vinculado si existe). Si el `Meeting` ya no tenía vínculo (por
ejemplo, porque ya se había borrado al pasar por `Not Held` antes del
soft-delete), esta llamada no produce tráfico nuevo — `deleteByLinks()`
itera sobre los `GcsEventLink` existentes, y no hay ninguno.

### 2.5 Estados nativos sincronizados / `Planned` / `Not Held` / fechas pasadas

- **Qué estados se sincronizan**: todos, sin distinción — la única
  bifurcación de `processPush()` es "¿está en `canceledStatusList`?" (borra)
  frente a "cualquier otro estado" (inserta/actualiza). No hay una lista
  positiva de estados sincronizables.
- **`Planned` se sincroniza**: sí — no está en `canceledStatusList`, se
  trata como cualquier estado activo (INSERT/UPDATE normal).
- **`Not Held` elimina el evento**: sí, confirmado en §2.3 — elimina, no solo
  "cancela" dentro de Google.
- **Fechas pasadas**: sí se sincronizan. `pushMeeting()`/`processPush()` no
  comprueban `dateStart` en ningún punto — la única ventana de fecha de todo
  el sistema es la del **barrido de reintentos** (`sweep()`,
  `WHERE modifiedAt >= NOW - 14 días`), que limita qué citas se
  **reintentan**, no qué citas se aceptan sincronizar la primera vez. Un
  `Meeting` creado hoy con `dateStart` en 2020 se sincronizaría igual en el
  primer intento (vía el hook inmediato, no el barrido).

### 2.6 `assignedUser` sin `gcs_account` → ¿no-op?

**No.** Como se explica en §0, ningún `assignedUser` tiene nunca
`gcs_account` propia en fase 1 — la comprobación de "no-op por falta de
cuenta" que hace el código es sobre la cuenta **Business compartida**
(`SyncService::pushMeeting()` línea 57-62: `if (!$account ||
!$account->get('calendarId')) return;`), no sobre el `assignedUser` del
`Meeting`. Cualquier `Meeting`, con cualquier `assignedUser` (incluido un
usuario técnico sin ninguna relación con Google), se sincroniza igual si la
cuenta Business está conectada — el `assignedUser` es completamente
irrelevante para esta decisión.

### 2.7 Flag/campo para excluir un `Meeting` concreto

**No existe.** Búsqueda exhaustiva (`grep -r` sobre
`Hooks/`, `Classes/`, `Jobs/`, `Resources/metadata/entityDefs/Meeting.json`)
de cualquier mecanismo de exclusión (`gcsExclude`, `gcsSkip`,
`gcsIgnore`, flag en metadata): cero resultados. La única forma de que un
`Meeting` no se sincronice es que su `status` esté en
`canceledStatusList`, o que la cuenta Business no esté conectada, o que
`gcsSyncStartAt` esté ausente.

### 2.8 `contactsIds=[]`

Afecta únicamente al **título** del evento (sin contactos, el título es
solo el `name`/asunto o el fallback `"Cita"`, `EventMapper::buildSummary()`)
y evita que se disparen los hooks `AfterRelate`/`AfterUnrelate` (no hay
relación que crear). **No** afecta a si el `Meeting` se sincroniza — eso lo
decide únicamente `gcsSyncStartAt` + estado de la cuenta Business (§2.6).

### 2.9 `SendInvitationsAfterCreate`/`Update` — el hook no existe

Verificado contra el núcleo real desplegado
(`/var/www/html/application/Espo/Modules/Crm/`): no hay ningún hook
automático de envío de invitaciones en `afterSave`/`afterCreate` de
`Meeting`. El envío de invitaciones es **exclusivamente** una acción
explícita de API/UI:
`Espo\Modules\Crm\Controllers\Meeting::postActionSendInvitations()`
(`POST /Meeting/{id}/sendInvitations`), nunca invocada automáticamente.
**Conclusión: crear un `Meeting` —con o sin contactos— nunca envía
comunicaciones por sí solo.** Esta preocupación del encargo queda
descartada por completo, con o sin `contactsIds=[]`.

---

## 3. Riesgo real de usar al profesional para A/B

### 3.1 Qué pasaría si Alternativa A se ejecutara **hoy**, tal cual está el sistema

Con el estado real confirmado en §1 (`gcsSyncStartAt` ausente): **cero**
llamadas a Google en toda la secuencia (creación de A, creación de B,
aprobación de A, rechazo de B, soft-delete posterior) — el hook nunca
encola nada, para ningún `Meeting`, con independencia de quién sea el
`assignedUser`. Esto es válido tanto si se usara al profesional real como a
cualquier otro usuario.

### 3.2 Qué pasaría si `gcsSyncStartAt` estuviera activo (hipotético, para dimensionar el riesgo)

Combinando §2.2–§2.4 con el payload cerrado de
`docs/fase4b-puerta5-propuesta-v3.md` §2.3.3/§4.3/§4.4/§4.8:

| Operación | Llamada a Google | Motivo |
|---|---|---|
| Creación de A (`POST`) | 1 `insert` | Nuevo `Meeting`, atributo relevante (todo es nuevo) |
| Creación de B (`POST`) | 1 `insert` | Igual |
| Aprobación de A (`PutDecide Confirmed`) | **0** | `status` no cambia (§2.2) — corrige la asunción del encargo |
| Rechazo de B (`PutDecide Canceled`) | 1 `delete` | `status→Not Held` (§2.3) |
| Soft-delete de A (limpieza, tras aprobar) | 1 `delete` | A nunca se había borrado en Google; su vínculo aún existe |
| Soft-delete de B (limpieza, tras rechazar) | **0** | El vínculo de B ya se eliminó en el rechazo — nada que borrar |

**Mínimo** (solo creación de A y B, sin decidir ni limpiar): **2** llamadas.
**Máximo realista** (flujo completo con aprobación+rechazo+limpieza de
ambos): **4** llamadas (2 `insert` + 2 `delete`), no las 5-6 que una lectura
superficial del encargo podría sugerir — la aprobación no añade ninguna.

### 3.3 Por qué "hoy da cero" no es una salvaguarda en la que apoyar la decisión

Esto es el hallazgo más delicado del documento y se reporta explícitamente
en vez de usarlo como base de una recomendación:

- `status='Active'` en `gcs_account` **solo** puede fijarse desde
  `TokenService::storeTokens()` (`grep` confirmado: es el único punto del
  código que escribe `status='Active'`), y ese método **solo** se llama
  desde `OAuthService::handleCallback()` — el flujo completo de conexión
  OAuth.
- Ese mismo método, **inmediatamente después** de `storeTokens()`, ejecuta:
  `if ($account->get('type') === 'Business' && !$this->config->get('gcsSyncStartAt')) { ...set('gcsSyncStartAt', now)... }` (`OAuthService.php:125-128`).
- Es decir: **toda** conexión OAuth completa de la cuenta Business, por
  diseño del propio código, deja `gcsSyncStartAt` fijado si antes estaba
  ausente. No hay ningún camino de código en el que la cuenta quede
  `Active` y `gcsSyncStartAt` quede ausente al mismo tiempo.
- El estado real observado (`Active` + `gcsSyncStartAt` ausente) es, por
  tanto, **inconsistente con el flujo normal de la extensión** — solo se
  explica por una edición manual posterior de `data/config.php` que quitó
  la clave después de una conexión real, o por un mecanismo fuera del
  código de la extensión. Esta sesión no tiene forma de confirmar la
  intención detrás de ese estado (podría ser una pausa deliberada tuya
  durante las Puertas 3–5, o un efecto colateral no relacionado) — se
  reporta como hecho observado, no como salvaguarda diseñada.
- **Consecuencia operativa**: no es un interruptor de "modo prueba" — es un
  estado frágil que cualquier acción no relacionada con esta puerta (por
  ejemplo, reconectar la cuenta Business para el uso real del negocio)
  volvería a activar sin que nadie lo asocie con la Puerta 5. Apoyar la
  decisión de esta puerta en que hoy da cero sería frágil y no auditable a
  medio plazo.

---

## 4. Matriz de alternativas

Con el hallazgo de §0 (el `assignedUser` no influye en absoluto en si GCS
sincroniza), **ninguna** elección de "a quién se asigna el `Meeting`" puede,
por sí sola, garantizar cero tráfico hacia Google si la cuenta Business
estuviera conectada y `gcsSyncStartAt` activo — eso es una propiedad global
del sistema, no del `assignedUser`. El criterio para elegir entre A/B/C/D
pasa a ser, entonces, el que ya motivó las Puertas 3C/3D: **exposición de
ACL, mínimo privilegio y reversibilidad dentro de EspoCRM** — no la
sincronización con Google, que depende de una variable ajena a las cuatro
alternativas.

| | **A — profesional real** | **B — usuario técnico sin credenciales** | **C — autoasignación al API User** | **D — admin al equipo técnico** |
|---|---|---|---|---|
| Riesgo Google (si `gcsSyncStartAt` estuviera activo) | Igual que cualquier alternativa (§0) — el evento aparecería etiquetado con el profesional real en cualquier UI que muestre `assignedUser` | Igual (estructural) — pero el evento, si existiera, no se asociaría visualmente al profesional real | Igual (estructural) | Igual (estructural) |
| Exposición ACL adicional | Ninguna nueva, pero usa la identidad real del único profesional para datos de prueba (`[PRUEBA PUERTA5]`) en su propio historial de citas | Ninguna — usuario nuevo, sin rol directo, sin rol heredado (equipo sin `role_team`, igual que Puerta 3D) | Ninguna nueva, pero **no valida la ruta real** `professionalId`/equipo — el API User nunca es el `assignedUser` en producción | Amplía temporalmente qué usuarios son asignables por el equipo técnico y modifica la membership del admin |
| Reversibilidad | Alta (soft-delete de A/B), pero dos citas de prueba quedan en el historial real del profesional | Alta — usuario nuevo, desactivable/soft-deleteable, retirable del equipo, sin dejar rastro en el profesional real | Alta, pero no aporta valor de prueba real | Media — hay que revertir membership del admin, riesgo de olvido |
| Valida el camino real de producción | Sí (100 %) | Sí — el mecanismo de asignación (`assignmentPermission=team` + equipo técnico) es exactamente el mismo que usará el profesional real; solo cambia el `assignedUserId` final | No — se salta la comprobación de equipo/`assignmentPermission` que protege la ruta real | Sí, pero contaminando el equipo real de decisión |
| Escrituras adicionales necesarias | Ninguna (equipo técnico de Puerta 3D ya incluye al profesional) | 1 `User` nuevo + 1 fila `team_user` (alta en el equipo técnico ya existente) | Ninguna | 1 fila `team_user` (admin), revertida después |
| Recomendado por el encargo | Solo con autorización explícita aparte — no evaluada como preferida | **Sí** | No, salvo que A/B sean inviables | No — descartada |

### 4.1 Alternativa A — profesional real

Solo viable con tu autorización explícita, separada de esta. Si se
ejecutara: aparecerían en el Google Calendar Business (si `gcsSyncStartAt`
estuviera activo) dos eventos con el asunto `[PRUEBA PUERTA5] Aprobación —
no contactar` / `[PRUEBA PUERTA5] Rechazo — no contactar`, sin invitados
(§2.9), en las fechas de §3.2 de `docs/fase4b-puerta5-propuesta-v3.md`.
Residuo tras limpieza: ninguno en Google (ambos se borran, §3.2), pero A y B
quedan en el historial (`deleted=1`) de `Meeting` reales del profesional,
visibles para siempre en una consulta sin filtro de `deleted`. **No se
ejecuta.**

### 4.2 Alternativa B — usuario técnico sin GCS (recomendada, ver §5)

Desarrollada en detalle en §5 y §6 (subpuerta propuesta, sin ejecutar).

### 4.3 Alternativa C — autoasignación al API User

Documentada, no recomendada salvo que A/B resulten inviables. Evitaría
cualquier duda sobre GCS (el API User tampoco tiene, ni podría tener,
`gcs_account`), pero **no ejercita la comprobación real** que protege la
ruta de producción: `Espo\Core\Record\Service::processAssignmentCheck()`
nunca se pondría a prueba con un destino distinto del propio actor (la
autoasignación siempre está permitida, con independencia de
`assignmentPermission`, confirmado en `docs/fase4b-puerta3d-assignment-team.md`
§2.2). Un fixture así no prueba nada que la Puerta 3D no haya probado ya.
**No se ejecuta.**

### 4.4 Alternativa D — admin al equipo técnico

Evaluada y descartada, mismo motivo que documentó la Puerta 3D al descartar
unir el API User al equipo real `Gapssa`: cualquier alta en el equipo
técnico amplía temporalmente el conjunto de destinos asignables por
`portal-gapssa-api` y exige revertir la membership del admin al terminar —
un paso manual más que puede olvidarse. La Alternativa B logra el mismo
objetivo sin tocar la identidad del admin. **No se ejecuta.**

---

## 5. Recomendación única — Alternativa B

**Usuario técnico nuevo, sin credenciales utilizables, miembro exclusivo del
equipo `Asignación Portal GAPSSA` (el mismo equipo creado y ya verificado
en la Puerta 3D), sin `gcs_account` propia (irrelevante en fase 1, §0, pero
se mantiene como propiedad explícita del diseño).**

**Advertencia explícita, repetida a propósito**: el usuario técnico **no
protege frente a Google Calendar Sync** — por el hallazgo de §0, ningún
`assignedUser` lo hace. Si `gcsSyncStartAt` estuviera activo en el momento
de ejecutar la Puerta 5A real, el `Meeting` se sincronizaría igual, con
independencia de a quién esté asignado. `gcsSyncStartAt` activo en la
relectura previa a esa ejecución **sigue siendo una condición de parada**
(§5.9), no un riesgo que esta alternativa elimine.

### 5.1 Por qué, dado el hallazgo de §0

No porque evite GCS por sí sola (nada lo hace, estructuralmente, salvo el
estado global de §1/§3.3) — sino porque:

1. Mantiene los datos de prueba fuera del historial de `Meeting` del único
   profesional real, evitando que `[PRUEBA PUERTA5]` aparezca para siempre
   en una consulta sin filtro de `deleted` sobre su actividad.
2. Reutiliza sin cambios el mecanismo ya construido, probado y cerrado en
   la Puerta 3D (`assignmentPermission=team` + equipo técnico sin
   `role_team`) — cero escritura de ACL nueva, cero riesgo nuevo de
   herencia de permisos.
3. Es la alternativa que mejor tolera el hallazgo de §3.3: si por cualquier
   motivo `gcsSyncStartAt` se reactivara sin relación con esta puerta, el
   evento de Google (si llegara a crearse) quedaría asociado a un usuario
   técnico marcado como tal, no al calendario percibido del profesional
   real — un blast radius menor si la premisa "hoy da cero" resultara
   equivocada.

### 5.2 Escrituras adicionales necesarias

- 1 `User` nuevo (`type=regular`, sin roles directos).
- **1 fila nueva** en `team_user` (alta del usuario técnico en el equipo
  `Asignación Portal GAPSSA`, `6a7c43c8ea6f5c370`) — corregido respecto a
  una versión anterior de este documento, que decía por error "2 filas
  `team_user`". `team_user` es una tabla puente simple, una fila por par
  (`team_id`, `user_id`) (`DESCRIBE team_user`: `id`, `team_id`, `user_id`,
  `role`, `deleted` — confirmado contra `gapssa-espocrm-1` real). Añadir un
  único usuario a un único equipo es, por definición del esquema, **una**
  fila — el equipo pasa de 2 a 3 miembros, pero eso es un cambio en el
  *conteo de miembros*, no en el número de filas escritas por esta
  operación. `role_team` de ese equipo permanece en 0 filas, verificado hoy
  en §1 y sin motivo para cambiar.
- Ningún cambio en `role.assignment_permission` (ya es `team` desde la
  Puerta 3D), ningún cambio en `role.data`/`field_data`, ningún cambio en
  el profesional real ni en su membership de `Gapssa`.

### 5.3 Permisos del usuario técnico

- Sin roles directos (`role_user` vacío).
- Sin rol heredado por equipo (`role_team` del equipo técnico = 0 filas,
  igual que hoy).
- Sin `API Key`.
- Sin contraseña conocida ni establecida (`password` `NULL`).
- **`isActive=true`** — **corregido tras el ensayo desechable de §8**, que
  refutó la recomendación original de este documento (`isActive=false`). Ver
  §5.4: `isActive=false` bloquea la asignación real por un motivo distinto
  de `assignmentPermission`, así que la propiedad "técnico, sin acceso
  efectivo" se logra con `isActive=true` **sin credenciales utilizables**
  (sin contraseña, sin `API Key`), no con `isActive=false`.
- Sin email real (usar un dominio interno no entregable, p. ej.
  `tecnico-puerta5@invalid.gapssa.local`, o el patrón que ya use el
  proyecto para cuentas técnicas — a confirmar en la aprobación).
- Sin `gcs_account` — no aplica y no se crea ninguna.

### 5.4 `isActive=false` — la lectura de código inicial era incompleta; el ensayo lo corrigió

Versión anterior de este documento: "un `Meeting` puede asignarse por API a
un usuario `isActive=false` sin ningún bloqueo adicional", basada en una
búsqueda de `isActive` limitada a `Core/Acl/`, `Core/Record/Service.php` y
`Modules/Crm/`. **Esa búsqueda tenía un punto ciego real**: EspoCRM registra
comprobadores de ACL específicos por entidad fuera de `Core/Acl/`, en
`application/Espo/Classes/Acl/<Entidad>/`, declarados vía
`aclDefs/<Entidad>.json` → `accessCheckerClassName`. Para `User` existe
exactamente uno: `Espo\Classes\Acl\User\AccessChecker`
(`application/Espo/Classes/Acl/User/AccessChecker.php`), con esta
comprobación como primera línea de `checkEntityRead()`:

```php
public function checkEntityRead(User $user, Entity $entity, ScopeData $data): bool
{
    if (!$user->isAdmin() && !$entity->isActive()) {
        return false;
    }
    ...
}
```

**Un actor no administrador (`portal-gapssa-api` nunca lo es) no puede leer
el registro `User` de un destino con `isActive=false`, con independencia de
cualquier ACL de scope (`User: {read: all}`, exactamente como está
configurado el rol real) o de `assignmentPermission`.** Y esa lectura del
`User` destino es un requisito independiente del `assignmentPermission`
(confirmado también en `docs/fase4b-puerta3d-assignment-team.md` §2.2:
"además de `assignmentPermission`, EspoCRM exige que el actor pueda LEER el
registro `User` destino"). Confirmado empíricamente en §8.3 (escenario 1a):
con el usuario técnico en `isActive=false`, `checkAssignmentPermission`
daba `true` pero `checkEntityRead` daba `false`, y el `POST /api/v1/Meeting`
real devolvía `403 cannotRelateForbidden` (`foreignEntityType: User,
action: read`) — nunca se llegó a crear el `Meeting`. Al pasar el mismo
usuario a `isActive=true` (manteniendo cero credenciales), el mismo `POST`
devolvió `200`.

**Lección explícita para el resto del proyecto**: una búsqueda de texto
sobre un directorio "obvio" del núcleo (`Core/Acl/`) no basta para descartar
un comportamiento de ACL en EspoCRM — los checkers específicos por entidad
viven fuera de ese directorio y se registran por metadata, no por
convención de ruta. Esto es precisamente el tipo de afirmación que este
proyecto exige verificar con un ensayo antes de decidir (`[[06-seguridad-privacidad-y-gobernanza]]`
§9, pregunta 8: "¿cómo se prueba...?") en vez de con una sola pasada de
lectura de código, por exhaustiva que parezca.

### 5.5 Efectos externos

Ninguno distinto de los ya analizados en §3.2/§3.3 — el usuario técnico no
introduce ni elimina ningún riesgo de Google Calendar respecto a cualquier
otra alternativa, por el hallazgo de §0.

### 5.6 Rollback

- Retirar al usuario técnico del equipo `Asignación Portal GAPSSA`
  (`team_user`, vuelve a 2 miembros).
- Desactivar (`isActive` ya en `false`) y/o soft-delete (`deleted=1`) del
  `User` técnico.
- El equipo técnico, el profesional real y `portal-gapssa-api` quedan
  exactamente como están hoy (§1 de `docs/fase4b-puerta3d-assignment-team.md`).

### 5.7 Limpieza — preimagen mínima, no la fila `User` completa

Corregido respecto a una versión anterior de este documento, que proponía
respaldar "la fila `User`" sin más precisión. La tabla `user` real
(`DESCRIBE user` contra `gapssa-espocrm-1`) incluye `password` (hash),
`api_key` y `auth_method` — columnas de autenticación que **nunca** deben
quedar en ningún archivo de backup de esta puerta, ni siquiera cifradas o
solo con su hash reportado (a diferencia del backup de `data/config.php` en
la Puerta 5A, donde lo que se evita mostrar es el *contenido*, aquí se evita
que el *archivo de backup mismo* contenga esas columnas).

**Preimagen mínima propuesta** — suficiente para verificar el resultado y
revertirlo, capturada con una lista explícita de columnas (nunca
`SELECT *`):

```sql
SELECT id, user_name, type, is_active, deleted,
       default_team_id, contact_id, created_at, modified_at
FROM user WHERE id = '<id del usuario técnico>';

SELECT id, team_id, user_id, role, deleted
FROM team_user WHERE user_id = '<id del usuario técnico>';
```

Explícitamente **fuera** de la preimagen: `password`, `password_version`,
`api_key`, `auth_method`, `salutation_name`, `avatar_id`,
`dashboard_template_id`, `working_time_calendar_id`, `layout_set_id` — ninguna
de ellas es necesaria para confirmar que el usuario técnico existe, está en
el equipo correcto, y puede desactivarse/soft-deletearse; todas son
candidatas a credencial o dato no esencial. Mismo directorio dedicado que
Puertas 3C/3D (`data/.backup/gapssa/puerta5/<timestamp>/`, `600`), pero el
contenido del archivo es esta preimagen de columnas explícitas, no un volcado
de la fila. Soft-delete tras el cierre del Bloque 5A-2 — igual criterio de
"requiere frase explícita aparte" que ya aplica a los propios Fixtures A/B
en `docs/fase4b-puerta5-propuesta-v3.md` §4.8.

### 5.8 Impacto sobre el valor de la prueba

Ninguno negativo: el mecanismo de asignación que se prueba
(`assignmentPermission=team` + equipo técnico + `Meeting.assignedUserId`)
es idéntico al que usará el profesional real en producción — el único
cambio es el `id` final del `assignedUser`, que no forma parte de lo que la
Puerta 5A necesita validar (eso ya lo cerró la Puerta 3D). La Puerta 5A
sigue probando exactamente lo mismo: creación, decisión, idempotencia,
ACL — con menos ruido en el historial del profesional real.

### 5.9 Condiciones de parada (específicas de esta alternativa, además de las de `fase4b-puerta5-propuesta-v3.md` §8)

- El usuario técnico resulta tener, tras crearlo, algún rol o permiso
  efectivo distinto de "ninguno" (verificar vía `AclManager`, mismo patrón
  que Puerta 3D §6 punto 7, y que §8.4 de este documento).
- El usuario técnico se crea con `isActive=false` — **ya no es la
  recomendación** (§5.3/§5.4): el ensayo de §8 demostró que bloquea la
  asignación real (`403 cannotRelateForbidden`). Crear con `isActive=false`
  por error, sin corregirlo antes de continuar, es ahora una condición de
  parada explícita de la subpuerta (§7).
- El equipo técnico `Asignación Portal GAPSSA` no tiene exactamente 2
  miembros y 0 `role_team` antes de añadir al usuario técnico (releer, no
  asumir el resultado de §1 de este documento).
- `gcsSyncStartAt` aparece **activo** en la relectura previa a la ejecución
  real de la Puerta 5A/5B — condición de parada nueva, propuesta aquí,
  ausente del Paso A de `docs/fase4b-puerta5-propuesta-v3.md` (que solo
  comprobaba `gcs_account` de `admin`, una comprobación que §0 de este
  documento muestra que no es la relevante). Se recomienda añadir esta
  relectura como punto nuevo del Paso A antes de aprobar la ejecución real.

---

## 6. Ensayo desechable — ejecutado (superseded, ver §8)

La versión original de este documento explicaba aquí por qué no se había
levantado un entorno desechable todavía, y proponía hacerlo como siguiente
paso. **Ese paso se ejecutó**, con autorización explícita separada, en la
misma sesión de trabajo — resultado completo, evidencia y teardown en
**§8**. La confianza "alta, solo por lectura de código" que este apartado
describía para `isActive=false` **resultó incorrecta** (§5.4/§8.3): el
ensayo encontró un bloqueo real que la lectura de código no había
detectado. Este apartado se conserva solo como registro de lo que se
decidió antes del ensayo; §8 es la fuente autoritativa a partir de ahora.

---

## 7. Propuesta de subpuerta — creación del usuario técnico (sin ejecutar)

Aparte de la aprobación de este documento, requiere su propia aprobación
explícita, igual que exigió la Puerta 3D respecto a la Puerta 5A.

1. **Precondiciones** (solo lectura, releer, no asumir): `app-check` verde,
   `maintenanceMode=NULL`, `gapssaBookingDecisionEnabled=false`,
   `gcsSyncStartAt` releído (condición de parada si está activo, §5.9),
   equipo `Asignación Portal GAPSSA` con exactamente 2 miembros y 0
   `role_team`, `Meeting` activos=7/soft-deleted=3, ningún usuario existente
   con el nombre/email técnico propuesto.
2. **Backup**: fila completa del equipo técnico (`team_user` actual) y, tras
   crear el usuario, la fila `user` nueva completa — mismo patrón de
   directorio dedicado que Puertas 3C/3D
   (`data/.backup/gapssa/puerta5/<timestamp>/`, `www-data:www-data`, `600`,
   SHA-256, README).
3. **Creación nativa** del `User` vía `EntityManager`
   (`getRDBRepositoryByClass(User::class)->getNew()`), nunca por SQL directo
   — mismo mecanismo que exige la gobernanza del proyecto
   (`[[06-seguridad-privacidad-y-gobernanza]]` §8: "nunca escritura directa
   entre bases de datos", aplica también dentro de la misma base a través de
   SQL crudo evitando el ORM). **`isActive=true`** (corregido tras §8 —
   `isActive=false` bloquea la asignación real, §5.4), sin contraseña
   establecida, sin `emailAddress` real, sin roles (`rolesIds` vacío,
   verificado explícitamente tras guardar, no solo por omisión).
4. **Ausencia de credenciales — verificación explícita**: sin fila en
   `auth_token` asociable, sin `API Key` (`api_key` de `user` vacío/NULL),
   `password` NULL o hash no derivable de ningún valor conocido (EspoCRM
   genera uno aleatorio si no se especifica; no se registra ni se muestra).
   Con `isActive=true` y `password NULL`, confirmar con un intento real de
   autenticación (`GET` a un endpoint autenticado con credenciales
   inventadas o vacías) que la respuesta es `401` — reproduce §8.3 contra
   la instancia real, sin asumir que el resultado del ensayo desechable se
   traslada sin comprobarlo.
5. **Membership exclusiva**: alta en `Asignación Portal GAPSSA`
   (`6a7c43c8ea6f5c370`) únicamente — verificar `team_user` del nuevo
   usuario tiene exactamente 1 fila tras el alta.
6. **Comprobación de cero roles**: `AclManager` sobre el usuario técnico —
   ACL efectiva vacía en todos los scopes salvo lo que el equipo técnico
   otorgue (nada, `role_team=0` filas).
7. **Comprobación de cero GCS**: releer `gcs_account` (mismo patrón no-PII
   de §1) — sigue existiendo únicamente la fila `Business`, ninguna fila
   nueva `type=User` asociada a este usuario.
8. **`bin/command clear-cache`** tras la creación (mismo motivo que Puertas
   3C/3D: la compilación de ACL no se invalida sola).
9. **Uso**: únicamente como `assignedUserId` de los Fixtures A/B de la
   Puerta 5A — ningún otro uso, ninguna otra escritura con este usuario
   como actor (nunca autentica, nunca ejecuta nada — es solo un destino de
   asignación).
10. **Retirada tras la Puerta 5A**: baja de `team_user` (equipo técnico
    vuelve a 2 miembros) y soft-delete (`deleted=1`) del `User` técnico,
    solo con autorización explícita aparte (mismo criterio que la limpieza
    de A/B en `docs/fase4b-puerta5-propuesta-v3.md` §4.8) — nunca borrado
    físico.
11. **Rollback exacto**: si algo de 1-9 falla o produce un resultado
    inesperado, eliminar la membership recién creada y soft-delete
    inmediato del usuario técnico, sin esperar a que termine la Puerta 5A —
    mismo criterio de "detener antes de investigar la causa" que
    `docs/fase4b-puerta5-propuesta-v3.md` §8.
12. **Ninguna alteración del profesional real** en ningún paso de esta
    subpuerta — no se toca su `User`, ni su membership de `Gapssa`, ni su
    membership del equipo técnico (permanece como está hoy, miembro de
    ambos).

---

## 8. Resultado del ensayo desechable — ejecutado

Autorizado exclusivamente para el ensayo desechable (no para crear el
usuario técnico real, no para Fixtures A/B reales, no para `PutDecide`, no
para cambiar `gcsSyncStartAt`/`gapssaBookingDecisionEnabled`/
`ESPO_BOOKING_ADAPTER`, no para escribir en Google Calendar, no para
reanudar el Bloque 5A-1). Todo lo que sigue ocurrió **exclusivamente**
contra un EspoCRM+MariaDB desechable — cero relación con `gapssa-espocrm-1`.

### 8.1 Topología exacta del entorno desechable

| | Real (`gapssa`) | Desechable (este ensayo) |
|---|---|---|
| Proyecto Compose | `gapssa` | `gapssa-puerta5-rehearsal` |
| Contenedores | `gapssa-espocrm-1`, `gapssa-espocrm-db-1`, ... | `gapssa-puerta5-rehearsal-espocrm-1`, `gapssa-puerta5-rehearsal-espocrm-db-1` |
| Red | `gapssa_public`/`gapssa_private` | `gapssa-puerta5-rehearsal_net` (única) |
| Volúmenes | `gapssa_espocrm-*` | `gapssa-puerta5-rehearsal_{db,data,custom,client-custom}` (4) |
| Puerto HTTP | `8081` (`0.0.0.0`) | `18084`, atado solo a `127.0.0.1` |
| Base de datos | `espocrm`/`espocrm` | `puerta5_rehearsal`/`puerta5_rehearsal` |
| Credenciales | reales, `.env` (nunca leído) | generadas con `openssl rand -hex 12`, exclusivas de este ensayo, nunca reutilizadas, nunca mostradas en la entrega |
| Imágenes | — | `espocrm/espocrm:10.0.3-apache-trixie` + `mariadb:11.4`, idénticas a la real |
| Fichero compose | `compose.yml` (raíz) | `compose.yml` propio, en el scratchpad de la sesión, no versionado |

Mismo patrón que `docs/fase4b-puerta3d-assignment-team.md` §3.2 y
`docs/fase4b-occ-rehearsal.md` §1: solo `espocrm` + `espocrm-db` (sin
`daemon`/`websocket`, innecesarios para probar ACL vía API síncrona).
`docker compose -p gapssa-puerta5-rehearsal config` validado antes de
levantar nada.

**Extensión GCS instalada** (necesaria para la comprobación de §8.5, algo
que ni la Puerta 3D ni la OCC necesitaron): copia completa de
`extensions/espocrm-google-calendar-sync/files/custom/Espo/Modules/GoogleCalendarSync`
y `files/client/custom/modules/google-calendar-sync` al contenedor
desechable vía `docker cp` (sin `composer`, sin red — el `vendor/` ya
estaba presente en el repositorio), más el único campo custom necesario del
módulo Gapssa (`cEstadoReserva`, copiado byte a byte de
`extensions/espocrm/custom/.../entityDefs/Meeting.json`, mismo patrón
minimalista que `docs/fase4b-occ-rehearsal.md` §4). **Ningún cliente OAuth
configurado, ningún token, cero llamadas de red salientes en todo el
ensayo** — la extensión quedó instalada pero sin ninguna cuenta Google
conectada.

**Incidencia inicial, documentada y resuelta** (irrelevante para el objeto
del ensayo, anotada por transparencia): `bin/command rebuild` fallaba con
`DivisionByZeroError` en `Core/Utils/Currency/DatabasePopulator.php` — el
mismo problema de configuración de monedas por defecto que
`PROJECT_CONTEXT.md` ya documenta para la instancia real (USD sin tasa
frente a base EUR). Corregido fijando `currencyList=["EUR"]` en el
`config.php` **del propio entorno desechable** — no toca nada real.

### 8.2 Fixtures creados (vía `EntityManager`, con `setupSystemUser()`, nunca SQL crudo)

| Fixture | Propiedad clave |
|---|---|
| Rol `Puerta5RehearsalApi` | Réplica mínima del rol real `Portal GAPSSA API`: `Meeting: {create:yes, read:all, edit:all, delete:no}`, `User: {read:all, edit:no}`, `Meeting.name: {read:no, edit:yes}`, `assignmentPermission: team` |
| Equipo `Puerta5RehearsalEquipoTecnico` | Sin ninguna fila `role_team` (igual que el equipo real de la Puerta 3D) |
| Usuario API `puerta5-rehearsal-api` | `type=api`, con el rol anterior, miembro del equipo técnico, `API Key` generada por el propio ensayo (nunca mostrada, destruida con el entorno) |
| Usuario `puerta5-rehearsal-profesional` | `type=regular`, activo, miembro del equipo técnico — control/referencia, análogo al único profesional real |
| **Usuario técnico** `puerta5-rehearsal-tecnico` | `type=regular`, sin roles, sin `API Key`, sin contraseña, miembro exclusivo del equipo técnico — variable bajo prueba |
| Usuario `puerta5-rehearsal-externo` | `type=regular`, activo, **fuera** del equipo técnico — control negativo |

**Lección operativa repetida de la Puerta 3D**: crear un `Role` por
`EntityManager` no invalida la compilación de ACL por sí solo —
`bin/command clear-cache` fue necesario tras crear el rol, antes de que la
primera prueba (§8.3, escenario 1) diera el resultado correcto.

### 8.3 Matriz de pruebas — causa y resultado exacto de cada escenario

| # | Escenario | Método | Resultado | Causa exacta (evidencia) |
|---|---|---|---|---|
| 1a | `POST /api/v1/Meeting`, `assignedUserId`=técnico con `isActive=false` | API (`X-Api-Key`) | **`403 cannotRelateForbidden`** (`foreignEntityType: User, action: read`) | `Espo\Classes\Acl\User\AccessChecker::checkEntityRead()`: `if (!$user->isAdmin() && !$entity->isActive()) return false;` — bloquea la lectura del `User` destino, con independencia del ACL de scope. Verificado también con un script directo contra `AclManager`: `checkAssignmentPermission=true` pero `checkEntityRead=false` para el mismo par actor/destino |
| 1b | Mismo `POST`, tras cambiar el técnico a `isActive=true` (mismo usuario, cero credenciales) | API | **`200`**, `Meeting` creado (`id` registrado, sin PII), `cEstadoReserva=PendingCenterApproval`, `assignedUserId`=técnico, `name` **ausente** de la respuesta (ACL de campo `{read:no}` respetada, igual que Puerta 3C real) | `isActive=true` satisface `checkEntityRead`; `assignmentPermission=team` + equipo compartido satisface `checkAssignmentPermission` (igual que caso 3 de la Puerta 3D) |
| 2 | `GET /api/v1/App/user` con Basic Auth, usuario técnico, contraseña adivinada | API | **`401`** | `password` `NULL` en `user` — ninguna contraseña puede coincidir nunca |
| 2b | Igual, contraseña vacía | API | **`401`** | Mismo motivo |
| 3 | `POST /api/v1/Meeting`, `assignedUserId`=usuario **fuera** del equipo técnico | API | **`403`**, `X-Status-Reason: Assignment failure: assigned user or team not allowed.` | Mismo mensaje que el hallazgo real de la Puerta 3D — `assignmentPermission=team` sin equipo compartido deniega |
| 4 | `DELETE /api/v1/Meeting/{id}` sobre el `Meeting` creado en 1b | API | **`403`**, `X-Status-Reason: No delete access.` | `role.data.Meeting.delete = no` |

**Sin escritura parcial en ningún escenario denegado** (3 y 4): el
`Meeting` del escenario 3 nunca se creó (`SELECT COUNT(*) FROM meeting`
tras el intento = 1, el mismo que tras 1b); el `Meeting` de 1b siguió
existiendo sin cambios tras el intento de borrado en 4.

### 8.4 Evidencia adicional — ausencia de permisos heredados

Script de solo lectura contra `AclManager` (mismo patrón que Puerta 3D
§3.3, caso 4) sobre el usuario técnico tras crearlo:

```
Meeting: read=no edit=no create=no delete=no
User:    read=own edit=no create=no delete=no   (default universal, no del equipo)
Contact: read=no edit=no create=no delete=no
Role:    read=no edit=no create=no delete=no
Team:    read=team edit=no create=no delete=no  (default universal, no del equipo)
isAdmin: false
roles:   (vacío)
teams:   1 (el equipo técnico, únicamente)
```

Ningún scope muestra permisos por encima de los valores universales por
defecto de EspoCRM (visibilidad de la propia fila / del propio equipo) —
confirma "no hereda permisos inesperados" de forma directa, no solo por
ausencia de `role_team`.

### 8.5 Comprobación de GCS — sin credenciales, sin red, resultado

Con la extensión instalada (§8.1) y `gcsSyncStartAt` **ausente** (nunca se
activó, nunca se configuró `gcsClientId`/`gcsClientSecret`, cero llamadas
salientes en todo el ensayo):

| Comprobación | Resultado |
|---|---|
| `gcs_event_link` tras crear el `Meeting` de 1b | **0** filas |
| `gcs_account` tras crear el `Meeting` de 1b | **0** filas (ninguna cuenta, ni `Business` ni `User`, se creó nunca) |
| Filas en `job` con `class_name LIKE '%GcsPush%'` tras crear el `Meeting` de 1b | **0** — confirma que `GcsPush::afterSave()` no encoló nada (igual que predijo la lectura de código de §2.1) |

**Sobre "cambiar el `assignedUser` por el usuario técnico no constituye una
exclusión de GCS"**: confirmado por inspección de código (§0/§2.6, sin
cambios) — `SyncService::pushMeeting()` decide únicamente por la cuenta
`Business` compartida, nunca por el `assignedUser`. El resultado empírico
de esta tabla (cero jobs, cero vínculos) es consistente con esa lectura,
pero por el motivo correcto: no hubo tráfico porque `gcsSyncStartAt` está
ausente, **no** porque el `assignedUser` fuera el usuario técnico — si
`gcsSyncStartAt` hubiera estado activo, el mismo `POST` habría encolado un
`UPSERT` exactamente igual que con cualquier otro `assignedUser` (§0, §3.3).
Esta puerta no activó `gcsSyncStartAt` en el ensayo, tal como exigía la
autorización ("no actives OAuth, no uses tokens y no efectúes ninguna
llamada externa").

### 8.6 Teardown

```
docker compose -p gapssa-puerta5-rehearsal down -v
```

2 contenedores, 4 volúmenes, 1 red eliminados. Verificación posterior
(`docker ps -a` / `network ls` / `volume ls`, todos filtrados por
`gapssa-puerta5-rehearsal`): las tres listas vacías — cero residuos.
Ficheros locales del ensayo (`compose.yml`, `.env` con las credenciales
generadas, IDs, respuestas HTTP guardadas) eliminados del scratchpad de la
sesión al terminar; los únicos que se conservaron (`compose.yml` sin
credenciales, los dos scripts PHP de diagnóstico, el `Meeting.json` mínimo)
no contienen ningún secreto ni dato del sistema real.

### 8.7 Estado real antes/después — comparación exacta

| Comprobación | Antes del ensayo | Después del ensayo |
|---|---|---|
| `Meeting` activos | 7 | 7 |
| `Meeting` soft-deleted | 3 | 3 |
| `PendingCenterApproval` | 0 | 0 |
| `gapssa_meeting_decision_operation` | 0 | 0 |
| `gcs_event_link` | 4 | 4 |
| `gapssaBookingDecisionEnabled` | `false` | `false` |
| `maintenanceMode` | `NULL` | `NULL` |
| `gcsSyncStartAt` | ausente | ausente |
| Equipo técnico `Asignación Portal GAPSSA` | 2 miembros, 0 `role_team` | 2 miembros, 0 `role_team` |
| `app-check` | verde (4/4) | verde (4/4) |
| `gapssa-espocrm-1` — `StartedAt` (Docker) | `2026-08-10T08:30:10.562545459Z` | `2026-08-10T08:30:10.562545459Z` (idéntico — el contenedor real nunca se reinició) |

**`gapssa-espocrm-1` real confirmado intacto — cero escrituras de esta
sesión sobre él en todo el ensayo.**

### 8.8 Hallazgo que corrige la recomendación — resumen

El ensayo refutó una parte concreta de la recomendación original (§5.3/§5.4
de la versión previa de este documento, ya corregidas más arriba):
`isActive=false` **no** es viable para el usuario técnico —
`Espo\Classes\Acl\User\AccessChecker::checkEntityRead()` bloquea la lectura
del `User` destino a cualquier actor no administrador cuando ese destino
está inactivo, con independencia de `assignmentPermission` o del ACL de
scope. La propiedad "técnico, sin acceso efectivo" se logra con
`isActive=true` **y cero credenciales** (sin contraseña, sin `API Key`) —
confirmado que basta para impedir el login (`401` en todos los intentos) y
para permitir la asignación real (`200`). Todo lo demás de la
recomendación de §5 (equipo técnico exclusivo, cero roles, cero
`gcs_account`, cero protección frente a GCS) queda confirmado sin cambios.

---

## 9. Confirmación del estado real — sin alterar, todo verificado en esta sesión

| Elemento | Estado confirmado hoy (lectura directa, esta sesión) |
|---|---|
| `Meeting` activos (`deleted=0`) | **7** |
| `Meeting` soft-deleted (`deleted=1`) | **3** |
| `Meeting` históricos (activos + soft-deleted) | **10** |
| `Meeting` en `PendingCenterApproval` | **0** |
| `gapssa_meeting_decision_operation` (idempotencia) | **0** filas |
| `gapssaBookingDecisionEnabled` | **`false`** |
| `maintenanceMode` | **`NULL`** (ausente) |
| `gcs_event_link` totales | **4** (1 de 4 pertenece a un `Meeting` del profesional real; conteo agregado, sin `eventId`/`calendarId`/datos del `Meeting`) |
| Equipo técnico `Asignación Portal GAPSSA` (`6a7c43c8ea6f5c370`) | Intacto — **2** miembros (`portal-gapssa-api`, profesional real), **0** filas `role_team` |
| `role.assignment_permission` de `Portal GAPSSA API` | `team` (sin cambios desde el cierre de la Puerta 3D) |
| Fixtures Puerta 5 creados en esta sesión | **0** |
| Llamadas a `PutDecide` en esta sesión | **0** |
| Modificaciones en Google Calendar en esta sesión | **0** — ninguna escritura contra la API de Google en ningún momento; todas las lecturas de esta sesión fueron `SELECT`/`DESCRIBE`/lectura de `data/config.php` vía `php -r` (sin secretos impresos) y `bin/command app-check` (diagnóstico de solo lectura) |
| `app-check` | Verde (`Migration not needed: OK`, `Database: OK`, `Not in maintenance mode: OK`, `Cron is enabled: OK`) |
| Commits realizados en esta sesión | **0** |

---

## 10. Resumen ejecutivo

- **Hallazgo principal (§0)**: Google Calendar Sync fase 1 sincroniza por
  una única cuenta Business compartida, nunca por `gcs_account` del
  `assignedUser` — la premisa "usuario sin `gcs_account` = no-op" no aplica
  a este diseño. Esto reduce el peso de la elección de `assignedUser` sobre
  el riesgo de Google, y lo traslada al estado global (§1/§3.3).
- **Riesgo real hoy**: cero llamadas a Google en toda la secuencia A/B,
  porque `gcsSyncStartAt` está ausente — pero ese estado es inconsistente
  con el flujo normal de conexión de la cuenta (§3.3) y no debe tratarse
  como una salvaguarda diseñada.
- **Comportamiento GCS verificado con evidencia de código real** (§2):
  aprobar no genera tráfico nuevo a Google (corrige una asunción del
  encargo); rechazar sí (borra el evento); soft-delete sí (borra si aún
  existe vínculo); no existe flag de exclusión por `Meeting`; las
  invitaciones nunca son automáticas.
- **Recomendación única, corregida por el ensayo**: Alternativa B — usuario
  técnico nuevo, **`isActive=true` con cero credenciales** (no
  `isActive=false`, corregido en §5.3/§5.4/§8.8 tras el ensayo de §8),
  miembro exclusivo del equipo técnico ya construido en la Puerta 3D.
  Justificada por mínimo privilegio y reversibilidad, no por evitar Google
  (nada la evita estructuralmente, §0).
- **Ensayo desechable ejecutado** (§8), con autorización explícita separada
  y limitada a él: matriz de 6 escenarios, todos con causa y resultado
  verificados empíricamente, incluida la corrección de `isActive` (§8.3).
  Teardown completo y confirmado sin residuos (§8.6). `gapssa-espocrm-1`
  real confirmado intacto antes y después, comparación campo a campo
  (§8.7).
- **Documentación corregida** (a petición explícita): `team_user` — 1 fila
  nueva, no 2 (§5.2); backup del usuario técnico — preimagen mínima de
  columnas no sensibles, nunca la fila completa (§5.7); advertencia
  explícita repetida de que el usuario técnico no protege frente a GCS y de
  que `gcsSyncStartAt` activo sigue siendo condición de parada de la
  Puerta 5A real (§5, §5.9).
- **Subpuerta propuesta** (§7): documentada en detalle, actualizada con
  `isActive=true`, requiere su propia aprobación explícita — **no
  ejecutada**.
- **Estado real**: confirmado intacto en su totalidad, antes y después del
  ensayo (§8.7, §9), cero escrituras de esta sesión sobre
  `gapssa-espocrm-1`.

---

**Queda a la espera de tu aprobación explícita** antes de: (a) ejecutar
cualquier parte de la subpuerta de §7 (creación del usuario técnico real),
o (b) reanudar el Bloque 5A-1 de `docs/fase4b-puerta5-propuesta-v3.md`. El
ensayo desechable de §8 ya se ejecutó con la autorización recibida para él
— ninguna de las dos acciones restantes se inicia sin una aprobación
separada y explícita para cada una.
