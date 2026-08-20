# Puerta 5 — v2: propuesta operativa corregida (Puerta 5A, directa contra EspoCRM real)

> **SUPERADO por `docs/fase4b-puerta5-propuesta-v3.md`.** V2 todavía
> proponía una API Key nueva de `admin` como mecanismo alternativo de
> creación de fixtures (descartado — nunca crear/rotar credenciales
> administrativas), afirmaba incorrectamente que
> `cMotivoResolucionReserva` quedaba fuera del `field_data` de `Portal
> GAPSSA API` (la Puerta 4 lo dejó en `read:yes, edit:yes` — se omite del
> payload de creación por diseño de negocio, no por ACL), usaba `SELECT *`
> sobre `gcs_account` (expondría `accessToken`/`refreshToken`), y
> ejecutaba toda la Puerta 5A como un único bloque de aprobación. V3
> corrige los cinco puntos y divide la ejecución en dos autorizaciones
> separadas por una pausa humana obligatoria. No usar este documento como
> referencia operativa.

**Nada de esto está ejecutado.** No se ha tocado EspoCRM real,
`data/config.php`, ningún `Meeting`, la tabla
`gapssa_meeting_decision_operation`, ni `ESPO_BOOKING_ADAPTER` en ningún
entorno. Sin commits. Este documento **sustituye** a
`docs/fase4b-puerta5-propuesta-v1.md` (marcado como superado — ver su
cabecera) y corrige, punto por punto, los defectos señalados sobre esa
versión.

## 0. Qué cambia respecto a V1

| # | Corrección |
|---|---|
| 1 | Estado de la Puerta 4 documentado en `docs/fase4b-puerta4-cierre.md` (nuevo, exclusivamente documental) — la línea base de este documento lo referencia en vez de repetirlo |
| 2 | `maintenanceMode` esperado ahora `NULL`, no `false` |
| 3 | Conteo de idempotencia corregido: **3 filas**, no 5 |
| 4 | Wire format de `idempotency_key_reused` corregido: texto plano, no JSON |
| 5 | Orden de ejecución reordenado: fixtures y su inspección visual ocurren ANTES de activar el flag, en ese orden explícito |
| 6 | Mecanismo de creación de fixtures cerrado: API estándar de EspoCRM (nunca la UI), payload exacto definido |
| 7 | Evidencia (código + prueba existente, sin ensayo nuevo) de que crear un `Meeting` directamente en `PendingCenterApproval` no requiere un `PUT` genérico posterior |
| 8 | Inspección visual movida a después de crear los fixtures, con la condición exacta de visibilidad citada desde `detail.js` |
| 9 | Conteo de operaciones separado explícitamente en escrituras físicas vs. eventos de negocio — sin mezclar ambos |
| 10 | Política de limpieza con los conteos finales corregidos (activos=10, históricos=12) |
| 11 | Puerta 5B reafirmada fuera de alcance, sin cambios de fondo |

---

## 1. Orden de ejecución (resumen)

| Paso | Acción | Flag |
|---|---|---|
| A | Línea base de solo lectura | `false` |
| B | Crear fixtures A y B | `false` |
| C | Inspección visual sobre A/B | `false` |
| D | Activar flag | `false` → `true` |
| E | Aprobación (A) + replay | `true` |
| F | Rechazo (B) + replay | `true` |
| G | Pruebas negativas (×2) | `true` |
| H | Cerrar flag | `true` → `false` |
| I | Verificaciones de cierre | `false` |
| J | Limpieza (solo si la aprobación la incluye expresamente) | `false` |

Motivo del reordenamiento respecto a V1: inspeccionar visualmente sobre
Meetings reales-de-prueba concretos (A y B), no sobre un `Meeting`
cualquiera, permite verificar exactamente la condición que va a decidirse
después — y hacerlo antes de tocar el flag confirma que la UI está
correcta sobre el caso real de prueba, no sobre un caso genérico que
podría no ser representativo.

---

## 2. Paso A — Línea base de solo lectura

| # | Comprobación | Método | Esperado |
|---|---|---|---|
| 1 | `app-check` | `docker compose exec espocrm bin/command app-check` | Verde |
| 2 | `maintenanceMode` | Lectura de `data/config.php` | **`NULL`** (ausente) — corregido respecto a V1, ver `docs/fase4b-puerta4-cierre.md` |
| 3 | `gapssaBookingDecisionEnabled` | Misma lectura | `false` (booleano explícito, no ausente) |
| 4 | `ESPO_BOOKING_ADAPTER` (todos los entornos de `apps/web`) | Lectura de `.env`/secretos de despliegue | `simulated` en todos |
| 5 | `gapssa_meeting_decision_operation` | `SELECT COUNT(*) FROM gapssa_meeting_decision_operation;` | `0` |
| 6 | `Meeting` totales activos | `SELECT COUNT(*) FROM meeting WHERE deleted = 0;` | `10` |
| 7 | `cMotivoResolucionReserva` de los 10 | `SELECT COUNT(*) FROM meeting WHERE deleted = 0 AND c_motivo_resolucion_reserva IS NOT NULL;` | `0` |
| 8 | `gcs_event_link` totales | `SELECT COUNT(*) FROM gcs_event_link;` | `4` |
| 9 | Hashes de los 6 archivos de metadata (v3 §6) | `sha256sum` sobre los archivos vivos | Coinciden con el manifiesto v2/v3/v4 |
| 10 | ACL de campo `cMotivoResolucionReserva` | `SELECT field_data FROM role WHERE id IN (...)` | `Profesional Gapssa` → `no/no`; `Portal GAPSSA API` → `yes/yes` |
| 11 | `gapssaBookingDecisionAuthorizedApiUserIds` | Lectura de `data/config.php` | Contiene únicamente el id real de `portal-gapssa-api` (`6a7b345b2624dbb56`, a confirmar por lectura directa, no por el nombre) |
| 12 | `gapssaBookingDecisionAuthorizedUserIds` | Misma lectura | Vacía |
| 13 | `routes.json` publica la ruta de decisión | `curl` sin credenciales válidas (espera 401, nunca 404) | 401 |
| 14 | **Nuevo** — `field_data.Meeting` del rol `Portal GAPSSA API`, campo `name` | `SELECT field_data FROM role WHERE id = '6a7b345b239b2ed26';` (o consola admin), inspeccionar la clave `name` dentro de `Meeting` | Ver §3.2 — condiciona qué credencial crea los fixtures |
| 15 | **Nuevo** — `gcs_account` del usuario `admin` | `SELECT * FROM gcs_account WHERE user_id = '<id de admin>';` (solo lectura) | Ver §3.4 — condiciona el `assignedUser` de los fixtures |

**Cualquier discrepancia en 1–15 detiene la ejecución antes de §3.** Los
puntos 14 y 15 son nuevos respecto a V1: resuelven, con datos reales en
vez de suposición, dos decisiones de diseño de los fixtures (§3) que en
V1 quedaban condicionadas ("a confirmar", "si tiene GCS, detente").

---

## 3. Paso B — Creación de fixtures

### 3.1 Mecanismo: API estándar de EspoCRM, nunca la UI

Se cierra la ambigüedad de V1 §3.6: los fixtures se crean vía
`POST /api/v1/Meeting` (la ruta estándar de entidad de EspoCRM, no la
ruta custom `GapssaMeetingDecision` — esa es solo para decidir, nunca
para crear), con un payload cerrado y fijo, **no** desde la interfaz
nativa. Motivo explícito: un payload enviado por script es exactamente
reproducible y queda registrado byte a byte en la entrega final; una
creación por clics en la UI no deja ese rastro y no puede repetirse de
forma idéntica si hiciera falta.

### 3.2 Qué credencial crea los fixtures

Depende del resultado de §2, punto 14:

- **Si `Meeting.name` está en `{read:yes, edit:yes}` para el rol `Portal
  GAPSSA API`**: se usa `portal-gapssa-api` (la misma credencial ya
  auditada que ejecutará las decisiones en §5–§7) — ninguna credencial
  nueva. Confirmado por el registro de la Puerta 3
  (`docs/fase4b-decision-flow-final.md` §13-adyacente): ese rol ya tiene
  `create/read/edit=yes` de scope sobre `Meeting`, y `field_data` explícito
  para `dateStart, dateEnd, status, cEstadoReserva, cTratamiento(Id),
  cZonaAtencion(Id), assignedUser(Id), contacts(Ids), cBookingRequestId,
  description` — todos los campos que necesita el payload de §3.3
  **excepto `name`**, que no aparece en esa lista citada. Por eso el punto
  14 de §2 es una comprobación real, no una formalidad: si `name` quedó
  fuera del allowlist de campo de ese rol (coherente con el patrón
  "denegar por defecto" que el resto del proyecto usa para este rol),
  `portal-gapssa-api` no podría escribir el nombre identificador del
  fixture al crearlo.
- **Si `Meeting.name` NO está en `yes/yes`** para ese rol: se usa, en su
  lugar, una API Key propia del usuario `admin` (generada una vez desde
  el propio panel de EspoCRM — `Administración > Usuarios > admin >
  Generar API Key` o equivalente, **nunca la contraseña del admin**, y
  nunca mostrada ni pedida en este proceso), también vía
  `POST /api/v1/Meeting` con el mismo payload cerrado — sigue sin ser la
  UI, sigue siendo reproducible y auditable. El admin bypasa ACL de campo
  por diseño de EspoCRM (mismo principio ya usado en la Puerta 4, v3 §3:
  "admin nunca está sujeto a ACL de campo").
- Esta decisión se toma en el momento, con el resultado real del punto
  14 — no se asume aquí cuál de las dos ocurre.

### 3.3 Payload cerrado

```
POST /api/v1/Meeting
X-Api-Key: <redactado — portal-gapssa-api o admin, según §3.2>
Content-Type: application/json

{
  "name": "[PRUEBA PUERTA5] Aprobación — no contactar",
  "dateStart": "2026-06-15 09:00:00",
  "dateEnd": "2026-06-15 09:15:00",
  "cEstadoReserva": "PendingCenterApproval",
  "assignedUserId": "<id admin o usuario técnico — ver §3.4>",
  "contactsIds": []
}
```

Y el mismo payload para B, cambiando únicamente `name` a
`"[PRUEBA PUERTA5] Rechazo — no contactar"`.

Deliberadamente **ausentes** del payload (nunca enviados, ni siquiera
como `null` explícito):

- `status`: se deja que `SyncEstadoReservaToStatus` (hook `before`) lo
  derive de `cEstadoReserva` — ver §3.5, evidencia de que esto ocurre sin
  intervención adicional.
- `cMotivoResolucionReserva`: no forma parte del `field_data` allowlist
  de `portal-gapssa-api` (§3.2) y no hace falta — el valor por defecto de
  un campo `enum` nuevo sin dato es `NULL`, que es exactamente el estado
  inicial exigido.
- `cBookingRequestId`: mismo motivo — `NULL` por defecto, correcto (estos
  fixtures no vienen de una solicitud real del portal).
- `cTratamientoId` / `cZonaAtencionId`: confirmado por lectura de
  `metadata/entityDefs/Meeting.json` (`"cTratamiento": {"type": "link"}`,
  `"cZonaAtencion": {"type": "link"}`, sin `"required": true` en ninguno
  de los dos) que ambos aceptan `NULL` — se dejan sin enviar, resultando
  en `NULL`, en vez de inventar un tratamiento/zona de prueba.
- Cualquier campo de `Contact`: sin contacto vinculado
  (`contactsIds: []` explícito, para que el payload sea cerrado y no
  ambiguo entre "omitido" y "vacío a propósito").

### 3.4 `assignedUser` — condicionado al resultado de §2, punto 15

- **Si `admin` no tiene `gcs_account` activa** (resultado esperado y
  recomendado): `assignedUserId` = id de `admin`. Sin sincronización
  configurada para ese usuario, crear o decidir estos `Meeting` no genera
  tráfico hacia Google Calendar — `gcs_event_link` permanece en `4`
  durante toda la Puerta 5A.
- **Si `admin` SÍ tiene `gcs_account` activa**: se detiene aquí (no se
  usa `admin` como `assignedUser`) y se propone un usuario técnico
  alternativo sin cuenta de Google Calendar sincronizada — a designar
  contigo explícitamente en ese momento, nunca inventado ni creado por
  esta sesión sin tu confirmación. Un profesional real, en cualquier
  caso, queda descartado (instrucción explícita: nunca usar un
  profesional real para estos fixtures).

### 3.5 Evidencia de que la creación directa en `PendingCenterApproval` es segura (sin ensayo nuevo)

Confirmado por lectura del código ya desplegado (no una prueba nueva, no
un ensayo desechable — el comportamiento es determinista y ya cubierto
por el arnés existente):

- **`GuardMeetingDecisionTransition::process()`**
  (`Classes/RecordHooks/Meeting/GuardMeetingDecisionTransition.php:85`):
  `if ($entity->isNew() || !$entity->isAttributeChanged('cEstadoReserva')) { return; }`
  — en una creación, `isNew()` es `true`, así que el guard **retorna
  inmediatamente** sin comprobar nada más. Este guard solo protege
  *transiciones* de un `Meeting` ya existente; una creación con
  `cEstadoReserva=PendingCenterApproval` nunca pasa por su lógica de
  rechazo. **No bloquea la creación.**
- **`SyncEstadoReservaToStatus::process()`**
  (`Classes/RecordHooks/Meeting/SyncEstadoReservaToStatus.php:67`):
  `if (!$entity->isNew() && !$entity->isAttributeChanged('cEstadoReserva')) { return; }`
  — en una creación, `isNew()` es `true`, la condición de salida temprana
  es `false`, así que el hook **sí se ejecuta** y llama a
  `EstadoReservaStatusMap::statusFor('PendingCenterApproval')`, que
  devuelve `'Planned'` (`EstadoReservaStatusMap.php:25`,
  `'PendingCenterApproval' => 'Planned'`) — confirmado también por la
  prueba pura existente
  `extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php:73`
  (`check('statusFor(PendingCenterApproval)', ..., 'Planned')`). El hook
  escribe `status='Planned'` en la misma entidad, en el mismo guardado
  `before` — **sin requerir ningún `PUT` genérico posterior.**
- **`GuardMeetingResolutionReasonConsistency::process()`** (el tercer
  guard relevante, no mencionado en V1): a diferencia del anterior, este
  **sí se aplica en creación** (`isNew()` incluido explícitamente en su
  condición) — pero solo actúa si `cMotivoResolucionReserva` no es
  `null`/`''` (línea 63: `if ($reason === null || $reason === '') { return; }`).
  Como el payload de §3.3 nunca envía ese campo (queda `NULL` por
  defecto), este guard tampoco bloquea la creación.

**Conclusión, con las tres piezas relevantes verificadas por lectura
directa del código real desplegado (no por ensayo)**: crear un `Meeting`
con `cEstadoReserva=PendingCenterApproval` mediante `POST /api/v1/Meeting`
(1) no es bloqueado por `GuardMeetingDecisionTransition`, (2) obtiene
`status=Planned` automáticamente vía `SyncEstadoReservaToStatus`
(coincide con `EstadoReservaStatusMap::MAP['PendingCenterApproval']`), y
(3) no requiere ningún `PUT` genérico posterior. Si aun así prefieres una
confirmación empírica adicional antes de tocar la instancia real, un
ensayo desechable (mismo patrón que v4 §3) puede añadirse como paso
previo explícito — no se ejecuta aquí sin que lo pidas.

### 3.6 Estado inicial resultante (esperado)

| Campo | A y B |
|---|---|
| `cEstadoReserva` | `PendingCenterApproval` |
| `status` | `Planned` (derivado, §3.5) |
| `cMotivoResolucionReserva` | `NULL` |
| `cBookingRequestId` | `NULL` |
| `cTratamientoId` / `cZonaAtencionId` | `NULL` |
| `contactsIds` | `[]` |

### 3.7 Registro de IDs

Al ejecutarse, se registran en la entrega final únicamente:
`Meeting.id` de A y B — ningún otro dato.

---

## 4. Paso C — Inspección visual sobre A y B (flag todavía en `false`)

- La realizas tú, con tu sesión administrativa ya existente. Nunca se
  pide, muestra ni cambia ninguna contraseña.
- Se abre el `Meeting` A (y opcionalmente B) recién creado, en la vista
  de detalle nativa.
- **Condición exacta de visibilidad de los botones**, leída directamente
  de `client/custom/src/views/meeting/record/detail.js:96-108`
  (`controlGapssaDecisionItems()`):
  ```js
  const isPending = this.model.get('cEstadoReserva') === 'PendingCenterApproval';
  const hasEditAccess = this.getAcl().checkScope('Meeting', 'edit');
  const visible = isPending && hasEditAccess;
  ```
  Con A/B en `cEstadoReserva=PendingCenterApproval` (§3.6) y tu usuario
  admin con `edit` sobre `Meeting` (siempre `true` para admin), **ambos
  factores son verdaderos** — los ítems "Aprobar reserva"/"Rechazar
  reserva" del menú desplegable deben estar visibles. Si no lo están, es
  una discrepancia real entre el código desplegado y el código de este
  repositorio — condición de parada.
- Qué revisar, sin enviar ningún `PUT`:
  1. Los dos ítems del menú (`gapssaApproveBooking`/`gapssaRejectBooking`)
     visibles sobre A (y B).
  2. Abrir "Aprobar reserva": debe disparar `this.confirm(...)` (un
     diálogo de confirmación nativo de EspoCRM) — **cerrar sin
     confirmar**.
  3. Abrir "Rechazar reserva": debe abrir el modal
     `custom:views/meeting/modals/reject-reason` — verificar que pide una
     nota, que el campo se ve correctamente — **cerrar sin enviar**.
  4. Consola del navegador: sin errores de JS al cargar la vista ni al
     abrir cualquiera de los dos flujos.
  5. Ninguna petición `PUT GapssaMeetingDecision` debe salir en ningún
     momento de este paso — confirmable en la pestaña de red del
     navegador.
- **Cualquier error de UI detiene la ejecución antes de §5 (activar el
  flag)** — no tiene sentido activar el flag si la vía preferida de
  decisión (la interfaz de EspoCRM) no funciona correctamente; en ese
  caso, la Puerta 5A no continúa hasta corregirlo y repetir este paso.

---

## 5. Paso D — Activación controlada del flag

Sin cambios de fondo respecto a V1 §4 (el mecanismo ya era correcto):

1. Backup de `data/config.php` (copia del archivo vivo del contenedor).
2. Hash SHA-256 y tamaño del `config.php` actual como línea base.
3. `ConfigWriter->set('gapssaBookingDecisionEnabled', true)->save()`.
4. `php -l data/config.php` — sin errores.
5. `diff` estructural contra el backup: **exactamente una línea
   cambiada** (`gapssaBookingDecisionEnabled`, `false` → `true`).
   `maintenanceMode` no se toca en ningún momento de este paso — sigue en
   `NULL` antes y después (a diferencia de la Puerta 4, aquí no hace
   falta una ventana de mantenimiento: un único valor booleano vía
   `ConfigWriter::save()` es una operación atómica de fichero, sin estado
   intermedio que proteger).
6. Registrar la hora exacta (UTC) de apertura.
7. Confirmar por lectura directa (no cacheada) que el valor en disco es
   `true`.

Ventana mínima: desde 5.7 hasta el cierre (§8), sin pausas intermedias
con el flag en `true`. Cierre garantizado en éxito y en error, igual que
V1 §4.3 — nunca se deja el flag en `true` mientras se espera una nueva
aprobación o intervención manual.

---

## 6. Paso E — Aprobación (Meeting A)

- Vía exclusiva: `PUT /api/v1/GapssaMeetingDecision/{id}` autenticado con
  la API Key de `portal-gapssa-api` (`X-Api-Key`), llamada HTTP directa
  contra EspoCRM real — sin BFF (§13).

### 6.1 `operationKey`

`puerta5-approval-<YYYYMMDD>-<sufijo aleatorio corto>` — alfanumérica,
cumple `^[A-Za-z0-9_-]+$`, ≤128 caracteres, nueva (línea base §2.5
confirma la tabla en 0 filas).

### 6.2 Payload

```
PUT /api/v1/GapssaMeetingDecision/{meetingId=<id A>}
X-Api-Key: <redactado>
Content-Type: application/json

{
  "decision": "Confirmed",
  "resultReason": "Approved",
  "operationKey": "puerta5-approval-<YYYYMMDD>-<sufijo>"
}
```

Sin `note` — `Approved` no la exige (`MeetingResolutionPolicy::isNoteAcceptable`, sin restricción propia).

### 6.3 Resultado esperado

HTTP `200`, cuerpo JSON:
`{"status":"confirmed","meetingId":"<A>","cEstadoReserva":"Confirmed","cMotivoResolucionReserva":"Approved","meetingStatus":"Planned","modifiedById":"<id de portal-gapssa-api>","modifiedAt":"<timestamp>"}`

(`meetingStatus` se mantiene `Planned` — `EstadoReservaStatusMap::MAP['Confirmed'] === 'Planned'`, sin cambio respecto al valor de creación.)

### 6.4 Verificación

| Comprobación | Método |
|---|---|
| `cEstadoReserva` | Releer vía `GET /api/v1/Meeting/{id}` — `Confirmed` |
| `status` | `Planned` (sin cambio) |
| `cMotivoResolucionReserva` | `Approved` |
| `modifiedById` | Id real de `portal-gapssa-api`, no `admin` |
| Idempotencia | `SELECT * FROM gapssa_meeting_decision_operation WHERE operation_key = '<key>';` — **1 fila**, `result_status='confirmed'`, `result_http_status=200` |
| Auditoría/stream | Ver §9 — se observa, no se afirma un número de filas por adelantado |

### 6.5 Replay (misma `operationKey`, mismo payload)

- Segunda llamada idéntica a §6.2.
- Esperado: HTTP `200`, **cuerpo idéntico byte a byte** (mismo
  `modifiedAt`) — `PutDecide::replayResponse` devuelve el resultado ya
  confirmado sin re-ejecutar nada.
- Verificación: `gapssa_meeting_decision_operation` **sigue en 1 fila**
  para esta clave; `Meeting.modifiedAt` **sin cambios** respecto a §6.4.

---

## 7. Paso F — Rechazo (Meeting B)

### 7.1 `operationKey`

`puerta5-rejection-<YYYYMMDD>-<sufijo aleatorio corto>` — nueva.

### 7.2 Nota

`"Prueba operativa Puerta 5 — sin relación con un caso real."` (cumple
`trim(note) !== ''`, exigido por `RejectedByStaff`).

### 7.3 Payload

```
PUT /api/v1/GapssaMeetingDecision/{meetingId=<id B>}
X-Api-Key: <redactado>
Content-Type: application/json

{
  "decision": "Canceled",
  "resultReason": "RejectedByStaff",
  "note": "Prueba operativa Puerta 5 — sin relación con un caso real.",
  "operationKey": "puerta5-rejection-<YYYYMMDD>-<sufijo>"
}
```

### 7.4 Resultado esperado y verificación

HTTP `200`, `cEstadoReserva=Canceled`, `status=Not Held`
(`EstadoReservaStatusMap::MAP['Canceled'] === 'Not Held'`),
`cMotivoResolucionReserva=RejectedByStaff`, `description` con el texto
exacto de §7.2. Misma tabla de verificación que §6.4, adaptada; **1 fila
nueva** de idempotencia.

### 7.5 Replay idempotente

Igual que §6.5: mismo cuerpo exacto, sin fila nueva, sin cambio en
`Meeting`.

---

## 8. Paso G — Pruebas negativas mínimas

Deterministas, una sola llamada cada una, sin concurrencia genuina (ya
probada exhaustivamente contra una instancia desechable en la Puerta 4 —
no se repite contra la real).

### 8.1 `operationKey` repetida con payload incompatible → 409

- Reutilizar la clave de §6.1, ya usada para A con
  `Confirmed`/`Approved`.
- Nueva llamada, misma clave, payload distinto (mismo `meetingId` A, pero
  `decision=Canceled`, `resultReason=RejectedByStaff`, con nota).
- **Esperado — corregido respecto a V1**: HTTP `409`, **cuerpo de texto
  plano exacto**: `idempotency_key_reused` (no JSON). Confirmado en
  `apps/web/src/server/booking/httpEspoAdapter.ts:792-801`: el segundo
  argumento de `Conflict::createWithBody($mensaje, 'idempotency_key_reused')`
  se escribe tal cual en el cuerpo de la respuesta HTTP, sin envolverlo en
  JSON — verificado ahí contra el core real de EspoCRM 10.0.3
  (`Espo\Core\Api\ErrorOutput::printBody()`). El mensaje legible
  ("operationKey ya usada con un payload distinto.") viaja, si acaso, en
  la cabecera `X-Status-Reason` — **si se registra esa cabecera en la
  entrega, se hace de forma redactada** (puede llevar texto operativo
  libre, aunque en este caso concreto el texto es fijo y no contiene PII).
  **No parsear el cuerpo como JSON en ninguna verificación de este paso.**
- Verificación: `Meeting A` **sin cambios** respecto a §6.4;
  `gapssa_meeting_decision_operation` **sin fila nueva** para esta clave
  (el 409 se lanza antes de `persistIdempotentResult` —
  `PutDecide.php:323-329`, el `existingOperation` ya encontrado corta el
  flujo antes de llegar a esa escritura).

### 8.2 `operationKey` nueva sobre un Meeting ya resuelto → 409 `meeting_decision_conflict`

- Nueva `operationKey` (nunca usada), mismo `meetingId` A (ya
  `Confirmed`), payload válido en forma (p. ej. `decision=Canceled`,
  `resultReason=RejectedByStaff`, con nota).
- Esperado: HTTP `409`, **este sí en JSON**
  (`PutDecide::recordAndRespondConflict` usa `ResponseComposer::json`, a
  diferencia de §8.1):
  `{"status":"conflict","reason":"meeting_decision_conflict","meetingId":"<A>","existingCEstadoReserva":"Confirmed"}`.
- Verificación: `Meeting A` sin cambios; **1 fila nueva** en
  `gapssa_meeting_decision_operation` para esta segunda clave
  (`result_status='conflict'`, `result_http_status=409`) —
  `recordAndRespondConflict` sí llama a `persistIdempotentResult` antes
  de responder, a diferencia de §8.1.

---

## 9. Paso H — Cierre del flag

Igual que V1 §4.3: `ConfigWriter->set('gapssaBookingDecisionEnabled', false)->save()`, `php -l`, lectura directa confirmando `false`, hora exacta de cierre — ejecutado inmediatamente tras §8, tanto en éxito como ante cualquier condición de parada (§14) que se active durante D–G.

---

## 10. Paso I — Verificaciones de cierre

1. `gapssaBookingDecisionEnabled` estrictamente `false` (lectura directa).
2. `maintenanceMode` sigue en `NULL` (nunca se tocó en esta puerta —
   §5, punto 5).
3. `app-check` — verde.
4. Ningún `Meeting` real (de los 10 de línea base, ninguno con prefijo
   `[PRUEBA PUERTA5]`) afectado:
   `SELECT id, c_estado_reserva, c_motivo_resolucion_reserva, modified_at FROM meeting WHERE deleted = 0 AND name NOT LIKE '[PRUEBA PUERTA5]%';`
   — comparar fila por fila contra la línea base de §2.6/§2.7.
5. **Conteo de idempotencia — corregido: 3 filas exactamente** (§6.4 +
   §7.4 + §8.2; §6.5/§7.5 son replays sin escritura, §8.1 no añade fila —
   ver desglose completo en §12). Si el conteo difiere, condición de
   parada.
6. `gcs_event_link`: sigue en `4` si se siguió §3.4 (fixtures sin
   `gcs_account`); si se tomó la alternativa de usuario técnico, mismo
   valor esperado (ese usuario tampoco tiene `gcs_account`, por
   construcción de la alternativa).
7. `Meeting` totales tras la Puerta 5A: `12` (10 reales + A + B),
   `cMotivoResolucionReserva IS NOT NULL` en exactamente 2 (A y B).

---

## 11. Paso J — Política de limpieza (propuesta, no autorizada para ejecutar aquí)

- **Recomendación**: incluir en la futura autorización el soft-delete
  (`deleted=1`, mecanismo nativo de EspoCRM) de A y B, **después** de que
  el flag ya esté de vuelta en `false` (§9) — nunca antes, para no
  mezclar la ventana de la prueba con la de limpieza.
- **Nunca borrado físico.**
- **Conservar** las 3 filas de `gapssa_meeting_decision_operation` y
  cualquier entrada de auditoría/stream generada — evidencia de que la
  prueba ocurrió tal como se documenta, sin fecha de expiración propuesta
  en esta puerta.
- **Efecto sobre conteos tras la limpieza**:
  - `Meeting` activos (`deleted=0`): vuelve a **10** — igual que la línea
    base de §2.6.
  - `Meeting` totales, incluidos eliminados: **12**, permanentemente (el
    soft-delete no revierte el conteo histórico).
  - `gapssa_meeting_decision_operation`: sigue en **3** filas, sin
    relación con el estado `deleted` del `Meeting` (tabla independiente,
    sin `ON DELETE CASCADE`).
- **No se ejecuta ninguna limpieza sin que la autorización la incluya
  expresamente** — la aprobación de §1–§10 no cubre §11 por sí sola.

---

## 12. Conteo de operaciones (físicas vs. eventos de negocio, sin mezclar)

### 12.1 Escrituras físicas totales

| Escritura | Cantidad |
|---|---|
| `data/config.php` (`gapssaBookingDecisionEnabled`) | 2 (abrir + cerrar) |
| `Meeting` — `INSERT` (creación de fixtures, §3) | 2 |
| `Meeting` — `UPDATE` con efecto real (§6/§7) | 2 |
| `gapssa_meeting_decision_operation` — `INSERT` | 3 |
| **Total** | **9** |

### 12.2 Desglose por llamada a `PutDecide` (6 llamadas totales)

| Llamada | `Meeting UPDATE` | `gapssa_meeting_decision_operation INSERT` |
|---|---|---|
| Aprobación inicial (§6) | 1 (A) | 1 |
| Replay aprobación (§6.5) | 0 | 0 |
| Rechazo inicial (§7) | 1 (B) | 1 |
| Replay rechazo (§7.5) | 0 | 0 |
| Clave reutilizada, payload incompatible (§8.1) | 0 | 0 |
| Clave nueva, Meeting ya resuelto (§8.2) | 0 | 1 |
| **Total** | **2** | **3** |

### 12.3 Las 4 llamadas "sin nuevo efecto de negocio"

Ninguna de estas 4 llamadas cambia `cEstadoReserva`/
`cMotivoResolucionReserva` de ningún `Meeting` (ni del ya decidido, ni de
ningún otro): los 2 replays (§6.5, §7.5) y las 2 pruebas negativas (§8.1,
§8.2). **Dentro de esas 4, 3 tampoco escriben ninguna fila nueva**
(§6.5, §7.5, §8.1) — pero **la cuarta (§8.2) sí añade 1 fila de
idempotencia** (registro del conflicto), aunque no toca ningún `Meeting`.
No se mezclan ambas nociones: "sin efecto de negocio sobre el `Meeting`"
no es sinónimo de "sin ninguna escritura física".

### 12.4 Efectos derivados — sin número afirmado

Auditoría de campo/stream de EspoCRM sobre los 2 `UPDATE` de `Meeting`
(§6/§7), y cualquier hook `afterUpdate` no listado explícitamente aquí:
se observan y registran en la entrega, **sin afirmar de antemano un
número exacto de filas** — su comportamiento no se ha revisado línea a
línea para este documento, a diferencia de la tabla de idempotencia
(§12.2, sí verificada contra el código real de `PutDecide.php`). Si al
ejecutar aparece un número de entradas de auditoría distinto del
"esperado implícitamente", eso no es, por sí solo, una condición de
parada — sí lo es cualquier entrada que mencione un `Meeting` fuera de A/B
(§14).

### 12.5 Google Calendar

`0` eventos reales previstos en Google Calendar si se siguió §3.4 — sin
número afirmado si se tomó la alternativa de usuario técnico sin
`gcs_account` confirmada (debería ser igualmente `0`, por construcción).

---

## 13. Separación de alcance — Puerta 5A vs. Puerta 5B (sin cambios respecto a V1)

- Esta propuesta es exclusivamente **5A**: EspoCRM + `PutDecide`
  directamente, vía `portal-gapssa-api`, sin pasar por `apps/web`.
- `ESPO_BOOKING_ADAPTER` permanece en `simulated` en **todos** los
  entornos durante toda la Puerta 5A.
- **Puerta 5B** (BFF → `HttpEspoBookingAdapter` → EspoCRM real,
  `ESPO_BOOKING_ADAPTER=http`): subpuerta futura, propuesta aparte, no
  detallada aquí. **Ninguna llamada desde el BFF a EspoCRM real ocurre en
  esta puerta.**
- No se mezclan ambas subpuertas en una misma ejecución — mismo
  razonamiento que V1 §10 (atribución de fallos, rollback de una sola
  superficie a la vez).

---

## 14. Condiciones de parada

- Cualquier divergencia entre la línea base de §2 (incluidos los nuevos
  puntos 14/15) y lo encontrado.
- La inspección visual de §4 revela cualquier error (ítem ausente, modal
  roto, error de consola, `PUT` disparado sin confirmar).
- El flag no puede verificarse tras escribirlo o no puede revertirse a
  `false` de forma confirmada.
- Cualquier cambio detectado en un `Meeting` no marcado
  `[PRUEBA PUERTA5]`.
- Cualquier discrepancia entre `cEstadoReserva`/`status`/
  `cMotivoResolucionReserva` y lo esperado en §6.3/§7.4.
- `modifiedById` distinto del esperado en cualquiera de las escrituras de
  §6–§8.
- Cualquier fila de idempotencia inesperada — de más, de menos, o con
  contenido distinto del descrito en §12.2.
- El cuerpo de §8.1 llega como JSON en vez de texto plano, o con
  contenido distinto de `idempotency_key_reused` — indicaría una
  discrepancia entre el código real desplegado y `PutDecide.php` tal como
  está en este repositorio.
- Cualquier efecto inesperado de Google Calendar Sync (evento creado
  cuando no se esperaba ninguno; `gcs_event_link` con conteo distinto del
  previsto en §10.6).
- Una entrada de auditoría/stream que mencione un `Meeting` fuera de A/B.

Cualquiera de estas, con el flag ya en `true`, dispara el cierre de §9
inmediatamente, antes de investigar la causa.

---

## 15. Entrega — resumen ejecutivo

- **Plan paso a paso**: A → B → C → D → E → F → G → H → I → (J solo si se
  aprueba aparte) — ver §1.
- **Payloads redactados**: §3.3 (creación), §6.2 (aprobación), §7.3
  (rechazo), §8.1/§8.2 (negativas).
- **Escrituras físicas exactas**: 9 (§12.1) — 2 config, 2 `Meeting`
  `INSERT`, 2 `Meeting` `UPDATE`, 3 idempotencia `INSERT`.
- **Efectos persistentes esperados**: 2 `Meeting [PRUEBA PUERTA5]`
  reales activos (`Confirmed`/`Approved` y `Canceled`/`RejectedByStaff`),
  3 filas de idempotencia, `gapssaBookingDecisionEnabled=false`,
  `maintenanceMode=NULL` (sin cambio), `ESPO_BOOKING_ADAPTER=simulated`
  (sin cambio), 0 `Meeting` reales tocados, 0 eventos nuevos en Google
  Calendar (si se siguió §3.4).
- **Rollback**: del flag, cubierto por §5/§9 con backup de `config.php`
  como última red; de los `Meeting` de prueba, no hay reversión de una
  decisión ya confirmada por diseño — la corrección es el soft-delete de
  §11, no un intento de deshacer vía `PUT` genérico (que además
  `GuardMeetingDecisionTransition` bloquearía siempre, con o sin flag);
  de la tabla de idempotencia, no se propone rollback — sus filas son
  evidencia, no estado operativo.
- **Política de limpieza**: §11 — soft-delete de A/B recomendado, no
  ejecutado sin autorización aparte y explícita.
- **Separación 5A/5B**: §13 — esta propuesta es exclusivamente 5A.

---

**Queda a la espera de tu revisión y de una aprobación explícita, punto
por punto, antes de ejecutar cualquier parte de §2 en adelante.** Para
producir este documento y `docs/fase4b-puerta4-cierre.md` solo se ha
leído el repositorio (código PHP/TS existente, documentos previos) —
cero operaciones contra `gapssa-espocrm-1` real, cero `Meeting` creados,
cero cambios de config, cero llamadas a `PutDecide`, cero limpieza, cero
commits.
