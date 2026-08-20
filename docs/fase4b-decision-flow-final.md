# Fase 4B — Flujo de decisión final (cierre de los 4 huecos operativos)

Revisión preparatoria del flujo completo de decisión de reservas
(aprobar/rechazar/caducar) antes de cualquier despliegue real en EspoCRM.
**No se ha escrito ningún registro nuevo en la instancia real de EspoCRM. No
se ha creado el campo `Meeting.cMotivoResolucionReserva` en la instancia
real. No se ha modificado ningún rol real. No se han desplegado hooks,
rutas ni SQL contra la instancia real. `ESPO_BOOKING_ADAPTER` sigue en
`simulated` en todos los entornos. No se han hecho escrituras de negocio
reales. No se ha tocado la API Key real. No se ha hecho ningún commit.**
Todo el trabajo vive en el árbol de trabajo, pendiente de revisión.

Complementa, no sustituye, `docs/fase4b-integracion-http.md`,
`docs/fase4b-revision-3.md`/`-4.md`, `docs/fase4b-occ-rehearsal.md` y
`docs/fase4b-occ-revision-2.md`/`-3.md`.

## 0. Corrección de puerta 4 (bloqueo de autorización y de concurrencia)

Esta revisión corrige dos bloqueos detectados en la propia auditoría antes
de aprobar la puerta 4, y añade una auditoría de solo lectura de una
deriva de migraciones local. **Sigue sin escribirse ni desplegarse nada
contra la instancia real de EspoCRM ni contra `gapssa_booking` real — las
mismas garantías de §11 aplican íntegramente a esta corrección.**

1. **Autorización de API Users demasiado amplia** (§6 original): `PutDecide`
   autorizaba a CUALQUIER usuario `type === 'api'`, sin lista blanca — el
   tipo de usuario no es autorización. Corregido: política cerrada en dos
   listas separadas (`MeetingDecisionAuthorizationPolicy`, clase pura
   nueva) — ver §6 reescrito.
2. **Concurrencia BFF**: dos decisiones humanas distintas compitiendo por
   el mismo `bookingRequestId` contra el adaptador HTTP real podían
   producir un 500 evitable (`idempotency_key_reused` sin capturar en
   `applyOrAdoptBookingDecision`), documentado como límite conocido no
   resuelto en la revisión anterior (antiguo §5). Corregido — ver §5
   reescrito.
3. **Auditoría de la migración local aplicada por error** (nota de
   transparencia, antiguo §7): confirmado de solo lectura contra
   `gapssa_booking` real — ver §7 actualizado.

Archivos nuevos/modificados de esta corrección:

- `extensions/espocrm/custom/Espo/Custom/Classes/Api/GapssaMeetingDecision/MeetingDecisionAuthorizationPolicy.php`
  (nuevo, puro).
- `PutDecide.php`: `isAuthorizedToDecide()` delega en la clase de arriba;
  nueva constante `AUTHORIZED_DECISION_API_USER_IDS_CONFIG_KEY`.
- `tests/MeetingHooksPureLogicTest.php`: +16 comprobaciones (84/84 en
  total).
- `apps/web/src/server/booking/httpEspoAdapter.ts`: el cuerpo crudo de una
  respuesta de error no-JSON ya no se descarta (`EspoApiError.body` guarda
  el texto tal cual cuando no es JSON — así es como responde de verdad
  `Conflict::createWithBody()` del core de EspoCRM); nueva función
  exportada `isIdempotencyKeyReusedConflict()`.
- `apps/web/src/server/booking/decisionRecovery.ts`: `applyOrAdoptBookingDecision`
  captura ÚNICAMENTE ese código contractual, nunca genera una
  `operationKey` nueva, reconcilia contra el Meeting real; nuevo outcome
  `inconsistent` (antes conflado con `conflict`).
- `apps/web/src/app/api/booking/v1/internal/decisions/route.ts`: nuevo
  caso `inconsistent` -> 409 `decision_state_inconsistent`; `meetingId`
  relajado de `z.uuid()` a `z.string().min(1).max(200)` — hallado durante
  el ensayo end-to-end (§0.1.2), bloqueaba cualquier id real de EspoCRM.
- `apps/web/tests/contract/fakeEspoServer.ts`: el 409
  `idempotency_key_reused` ahora responde con cuerpo de texto plano (no
  JSON) — réplica fiel del wire format real, confirmada leyendo el core de
  EspoCRM 10.0.3 (`Espo\Core\Api\ErrorOutput::printBody()`) en el
  contenedor real, solo lectura.
- `apps/web/src/server/booking/httpEspoAdapter.test.ts`: +2 pruebas.
- `apps/web/tests/integration/booking.decisionRecovery.httpConflict.int.test.ts`
  (nuevo, 10 pruebas): concurrencia genuina vía `HttpEspoBookingAdapter` +
  `FakeEspoServer`, y ramas deterministas vía un adaptador stub.
- `apps/web/tests/integration/bookingDb.ts`: `createPendingApprovalBookingRequestForTesting`
  (nuevo).
- `apps/web/tests/integration/ephemeralDatabaseGuard.ts` (nuevo) +
  `ephemeralDatabaseGuard.int.test.ts` (nuevo, 11 pruebas): guardia única
  antes de crear/migrar/destruir cualquier base de la suite — aborta
  contra `gapssa_booking`/`gapssa_auth`/`gapssa_cms` reales o cualquier
  nombre sin prefijo efímero aprobado. `tests/integration/global-setup.ts`
  la invoca antes de crear y antes de destruir.

## 0.1 Ensayo end-to-end real — EspoCRM 10.0.3 desechable, concurrencia HTTP real

Ensayo adicional exigido antes de aprobar la puerta 4: demostrar
`BFF real → HttpEspoBookingAdapter → EspoCRM 10.0.3` de extremo a extremo,
no solo contra `FakeEspoServer`. **Ningún componente de este ensayo tocó
jamás la instancia real (`gapssa-espocrm-1`, `localhost:8081`) ni
`gapssa_booking` real** — topología completamente aparte, verificada antes
de empezar (ver §0.1.1) y destruida al terminar (ver §0.1.6).

### 0.1.1 Topología y versiones

| Componente | Detalle |
|---|---|
| EspoCRM | `espocrm/espocrm:10.0.3-apache-trixie` (misma imagen que producción), contenedor `gapssa-decision-rehearsal2-espocrm-1`, puerto `127.0.0.1:8092` (real: `8081`) |
| MariaDB | `mariadb:11.4` (misma imagen que producción), contenedor `gapssa-decision-rehearsal2-espocrm-db-1`, sin puerto publicado al host |
| Red Docker | `gapssa-decision-rehearsal2_rehearsal` (aparte de `gapssa_public`/`gapssa_private`/`gapssa_apps-private` reales) |
| Volúmenes | Ninguno con nombre — capa de escritura del contenedor únicamente, se destruye con `docker compose down` sin necesitar `-v` |
| Postgres booking | Base efímera `gapssa_booking_test_rehearsal_<hex>` en el MISMO servidor Postgres de desarrollo (`gapssa-apps-db-1`) que ya usa el resto de la suite de integración — nunca `gapssa_booking`; creada/migrada/destruida bajo `assertEphemeralTestDatabaseUrl()` |
| BFF | `next dev` dedicado (Next.js 16.3.0, Turbopack), proceso aparte del servidor de desarrollo habitual, puerto efímero propio, `ESPO_BOOKING_ADAPTER=http`, `ESPOCRM_API_BASE_URL=http://localhost:8092` |
| Usuarios/roles/API Keys | Todos ficticios, creados vía la API admin del EspoCRM desechable — nunca ids/claves reales, ninguno incrustado en el repositorio |

**Verificación previa de aislamiento** (antes de escribir nada): contenedores
`gapssa-decision-rehearsal2-*` con nombres/puertos/red distintos de los
`gapssa-*` reales, confirmado con `docker ps` en paralelo (real
`gapssa-espocrm-1` en `8081`, desechable en `8092`, ambos visibles y
distintos simultáneamente); `DATABASE_URL_BOOKING` del BFF de ensayo
apuntando siempre a un nombre `gapssa_booking_test_rehearsal_*` (nunca
`gapssa_booking`), verificado con `assertEphemeralTestDatabaseUrl()`
ejecutándose antes de cualquier `CREATE DATABASE`.

### 0.1.2 Bloqueo adicional hallado y corregido: `meetingId` exigía formato UUID

Al conectar la ruta interna real (`/api/booking/v1/internal/decisions`)
contra el EspoCRM desechable, la primera llamada con un `meetingId` real
(formato propio de EspoCRM, alfanumérico corto — nunca un UUID) devolvió
400 `invalid_input` — el esquema
`bodySchema` exigía `meetingId: z.uuid()`, válido únicamente para
`sim_espo_meetings.id` (UUID de Postgres, adaptador simulado). Con
`ESPO_BOOKING_ADAPTER=http` esta ruta rechazaba CUALQUIER `meetingId` real
antes de llegar siquiera a `applyOrAdoptBookingDecision` — nunca ejercitada
contra un id real hasta este ensayo. Corregido en
`apps/web/src/app/api/booking/v1/internal/decisions/route.ts`:
`meetingId: z.string().min(1).max(200)` (mismo patrón que
`treatmentId`/`professionalId`/`zoneId` en `requests/route.ts` — opaco, sin
asumir formato). Verificado: `npx tsc --noEmit` limpio,
`booking.decisionRecovery.int.test.ts` (adaptador simulado) sigue en verde
(6/6) tras el cambio — ningún test asumía el formato UUID.

### 0.1.3 Wire format real de `idempotency_key_reused` — forzado y confirmado

Confirmado leyendo el core de EspoCRM (`Espo\Core\Exceptions\Conflict`,
`Espo\Core\Api\ErrorOutput`, solo lectura) y REPRODUCIDO en vivo contra el
EspoCRM desechable (dos llamadas a `PutDecide` con la misma `operationKey`
y payloads distintos):

```
HTTP/1.1 409 Conflict
X-Status-Reason: operationKey ya usada con un payload distinto.
Content-Type: text/html; charset=UTF-8
Content-Length: 22

idempotency_key_reused
```

Cuerpo de **texto plano**, 22 bytes exactos, sin comillas ni envoltura
JSON — confirma que el fallback añadido en `httpEspoAdapter.ts::request()`
(conservar el texto crudo cuando `JSON.parse` falla) era necesario: sin él,
`error.body` habría quedado `undefined` y `isIdempotencyKeyReusedConflict()`
nunca lo habría reconocido, pese al `catch` ya en su sitio.
`FakeEspoServer` replica ahora este mismo formato exacto (antes enviaba
JSON, una aproximación incorrecta — ver §0).

### 0.1.4 Concurrencia real — matriz de resultados

Todas las decisiones se ejecutaron **a través del BFF real**
(`POST /api/booking/v1/internal/decisions` / `POST /api/booking/v1/internal/sweep`
del servidor `next dev` dedicado), nunca llamando al adaptador
directamente ni a `FakeEspoServer`. Cada escenario crea un Meeting real
nuevo en el EspoCRM desechable + su `BookingRequestRecord` en la Postgres
efímera antes de cada intento — nunca se reutiliza un Meeting ya decidido.

| Escenario | Iteraciones | OK | 500 evitables | Notas |
|---|---|---|---|---|
| approve vs. reject (concurrentes) | 20 | 20 | 0 | Ganador alterna (200 `applied:now`) — perdedor siempre 409 `decision_conflict` |
| aprobación vs. aprobación, candidatas de idempotencia distintas | 20 | 20 | 0 | Ambas 200 (`now`/`already`), MISMO `requestId`, 1 sola fila de idempotencia, 1 solo evento de auditoría — nunca doble efecto |
| dos rechazos equivalentes | 20 | 20 | 0 | Igual que el anterior, resolución `rejected` |
| approve vs. caducidad de sistema (barrido real) | 20 | 20 | 0 | Quien comprometa primero gana; 2 filas de idempotencia cuando ambos alcanzan `PutDecide` (claves distintas: UUID humana vs. `expiry-v1-<id>` determinista) |
| reject vs. caducidad de sistema (barrido real) | 20 | 20 | 0 | Igual — observado en ambas direcciones (a veces gana el rechazo, a veces la caducidad) |
| `operationKey` reutilizada con payload incompatible (mismo `bookingRequestId`) | 20 | 20 | 0 | Segunda decisión → 409 `decision_conflict`, `existingResolution`/`existingCEstadoReserva` reflejan el estado real ya asentado |
| replay tras timeout posterior al commit (misma clave, mismo payload, reintento explícito) | 20 | 20 | 0 | Segunda llamada → 200 `applied:already`, mismo `modifiedAt` |
| carrera ancha (6 decisiones concurrentes por Meeting: 3 aprobar + 3 rechazar) | 20 | 20 | 0 | Exactamente un ganador; el resto 409; nunca un estado mixto |
| procesos `curl` del SO concurrentes (fuera del hilo de Python, `&`+`wait`) | 30 | 30 | 0 | Mismo patrón — confirma que el resultado no depende del mecanismo de concurrencia del cliente de pruebas |

**Total: 190 intentos de concurrencia real contra EspoCRM 10.0.3 desechable
+ Postgres real — 0 HTTP 500 evitables, 0 resoluciones divergentes entre
EspoCRM y PostgreSQL, ganador único en el 100% de los casos.**

Nota de honestidad metodológica: en las 190 repeticiones, el contador de
filas de `gapssa_meeting_decision_operation` para el escenario 1v1
`approve vs. reject` se mantuvo siempre en 1 — esto **no** significa que la
carrera nunca fuera real (los 200/409 alternan de lado en ambas
direcciones a lo largo de las repeticiones, prueba de interleaving
genuino), sino que `idempotency_key_reused` y el atajo "la solicitud ya
está resuelta" son, correctamente, indistinguibles desde fuera cuando
ambas decisiones comparten la MISMA `operationKey` convergida — ninguna de
las dos rutas persiste una fila nueva ni produce un resultado distinto.
Los escenarios de caducidad (claves distintas, sin converger) SÍ muestran
2 filas cuando ambos llegan a `PutDecide`, demostrando la contención real
sobre el candado de fila del Meeting en EspoCRM. Combinado con la
confirmación directa del wire format (§0.1.3) y las pruebas deterministas
ya existentes con el adaptador stub (`booking.decisionRecovery.httpConflict.int.test.ts`),
la cobertura es completa aunque esta métrica concreta no distinga el
camino interno exacto en ese escenario particular.

### 0.1.5 Matriz de autorización — verificada en vivo

| # | Actor | Resultado esperado | Resultado real | `X-Status-Reason` / evidencia |
|---|---|---|---|---|
| 1 | Administrador | 200 | **200** | `modifiedById` = id del admin |
| 2 | API User en `...ApiUserIds` | 200 | **200** | `modifiedById` = id real del API User |
| 3 | API User CON `Meeting.edit=all` pero AUSENTE de `...ApiUserIds` | 403 | **403** | "Este usuario no está autorizado para decidir reservas." — Meeting releído: sigue `PendingCenterApproval`, nunca tocado |
| 4 | Humano regular en `...UserIds` | 200 | **200** | `modifiedById` = id real del profesional (nunca admin/API) |
| 5 | Humano regular AUSENTE de `...UserIds` | 403 | **403** | "Este usuario no está autorizado para decidir reservas." |
| 6 | Usuario sin `Meeting.edit` en absoluto | 403 | **403** | "Sin permiso de edición sobre Meeting." (mensaje del ACL genérico, distinto del de la política — confirma el orden: ACL primero) |
| 7a | Configuración AUSENTE (ambas claves sin escribir) — API antes autorizado | 403 | **403** | Config eliminada con `unset` real en `data/config.php`, `bin/command clear-cache` |
| 7b | Configuración AUSENTE — humano antes autorizado | 403 | **403** | Igual |
| 8a | Configuración CORRUPTA (`string` en vez de array) — API | 403, nunca 500 | **403** | `MeetingDecisionAuthorizationPolicy::idInAllowlist` trata no-array como vacío |
| 8b | Configuración CORRUPTA (`int` en vez de array) — humano | 403, nunca 500 | **403** | Igual |
| — | "Ningún usuario se autoriza solo por `type=api`" | — | **Confirmado** | Fila 3: `type=api` + `Meeting.edit=all`, sin estar en la allowlist -> 403 |

Configuración restaurada a los valores autorizados tras las filas 7/8
(verificado por lectura de `data/config.php`) antes de continuar.

### 0.1.6 Teardown

Enumerado, validado por nombre y destruido, en este orden:

1. **BFF de ensayo** (`next dev` dedicado, puerto efímero): `SIGTERM` al
   proceso; sus tres bases efímeras (`gapssa_cms_test_72061d9ff355`,
   `gapssa_auth_test_4681f845ea16`, `gapssa_booking_test_rehearsal_97574777ae40`)
   destruidas con `DROP DATABASE ... WITH (FORCE)` tras validar que cada
   nombre coincidía con uno de los prefijos efímeros aprobados (nunca
   `gapssa_booking`/`gapssa_auth`/`gapssa_cms`).
2. **Contenedores EspoCRM desechable**: `docker compose -f
   <compose del ensayo> down` — `gapssa-decision-rehearsal2-espocrm-1`,
   `gapssa-decision-rehearsal2-espocrm-db-1`, ambos `Removed`. Sin
   volúmenes con nombre (la capa de escritura del contenedor desaparece
   con el contenedor).
3. **Red Docker** `gapssa-decision-rehearsal2_rehearsal`: `Removed`.
4. **Directorio de build del BFF de ensayo** (`.next-decision-rehearsal2`,
   local a `apps/web`, nunca parte del repositorio): borrado.
5. **Script auxiliar** (`apps/web/rehearsal-bff-server.mjs`, temporal):
   borrado.

Verificado tras el teardown:

- `docker ps -a --filter name=gapssa-decision-rehearsal2` -> vacío.
- `docker network ls --filter name=gapssa-decision-rehearsal2` -> vacío.
- `psql -U gapssa_apps -lqt | grep _test_` (servidor Postgres de
  desarrollo compartido) -> ninguna base efímera residual.
- Los 6 contenedores reales (`gapssa-apps-db-1`, `gapssa-redis-1`,
  `gapssa-espocrm-1`, `gapssa-espocrm-db-1`, `gapssa-espocrm-daemon-1`,
  `gapssa-espocrm-websocket-1`) siguen `Up`/`healthy`, sin reinicios.
- `curl http://localhost:8081/` (EspoCRM real) -> `200`.
- `gapssa_booking` real: **0 filas** en `booking_request_records` — igual
  que antes del ensayo (§7), ningún dato tocado.

### 0.1.7 Veredicto de este ensayo

**Ningún HTTP 500 evitable** en 190 intentos de concurrencia real (7
escenarios × 20 + carrera ancha × 20 + procesos `curl` del SO × 30).
**Ninguna resolución divergente** entre EspoCRM y PostgreSQL en ningún
caso — el ganador en EspoCRM (`cEstadoReserva`/`cMotivoResolucionReserva`)
coincide siempre con la resolución persistida en `booking_request_records`.
**Ningún API User no listado consiguió decidir** — la matriz de
autorización (§0.1.5) se comportó exactamente como especifica
`MeetingDecisionAuthorizationPolicy` en los 10 casos verificados en vivo,
incluidos configuración ausente y corrupta. Un bloqueo adicional (esquema
`meetingId` incompatible con ids reales de EspoCRM, §0.1.2) se encontró y
corrigió durante el propio ensayo, con tu autorización explícita, y quedó
reverificado (typecheck limpio, suite de integración simulada sin
regresión).

Con esto, el mecanismo de concurrencia BFF→HttpEspoBookingAdapter→EspoCRM y
la política de autorización quedan verificados de extremo a extremo contra
una instancia EspoCRM 10.0.3 real (desechable). La decisión final de
aprobar la puerta 4 sigue correspondiéndote a ti — este documento no la
declara aprobada por su cuenta; reporta que, en todo lo ejecutado en este
ensayo, no ha aparecido ninguna de las tres condiciones de bloqueo que
tú mismo fijaste (500 evitable, resolución divergente, API User no
listado decidiendo).

## 1. Causa de los tres huecos operativos

| # | Hueco | Causa raíz |
|---|---|---|
| 1 | `HttpEspoBookingAdapter.decideMeeting`/`expireMeeting` seguían usando `PUT /api/v1/Meeting/{id}` genérico + lectura-antes-de-escribir (`writeIfPendingCenterApproval`) | La acción atómica `PutDecide` (`GapssaMeetingDecision`) se diseñó y probó en las revisiones OCC 2/3 del lado EspoCRM, pero el adaptador HTTP de `apps/web` nunca se actualizó para llamarla — quedó una discrepancia entre "lo que el guard del lado EspoCRM exige" y "lo que el adaptador del lado BFF realmente envía". `GuardMeetingDecisionTransition` ya rechazaba cualquier `PUT` genérico que moviera `cEstadoReserva` fuera de `PendingCenterApproval`, así que el adaptador HTTP real habría fallado con 409 en todo intento de decidir. |
| 2 | La interfaz de EspoCRM no tenía ninguna acción para invocar `PutDecide` | `PutDecide` nació como acción API pura (`PUT /api/v1/GapssaMeetingDecision/{id}`), sin ningún cliente que la invocara desde la UI — ni siquiera se había diseñado el punto de entrada humano preferido (sesión propia del usuario, no el API User técnico). |
| 3 | Rechazo manual y caducidad de sistema, ambos `Canceled`, se distinguían por `decidedBy`/`modifiedById` | Nunca existió un campo durable para el MOTIVO de la resolución — `modifiedById` es un dato TÉCNICO (quién ejecutó la escritura: casi siempre el API User técnico, o un admin/profesional si edita el Meeting por cualquier otro motivo después), no un dato de NEGOCIO (por qué se llegó a ese estado). `deriveResolutionFromDecidedMeeting` inferí­a el motivo comparando `decidedBy` contra el literal `'system:approval-sweep'` — fràgil ante cualquier edición posterior ajena a la decisión, y dependiente exclusivamente de la tabla de idempotencia de EspoCRM (`gapssa_meeting_decision_operation`) para cualquier reconstrucción más fiable, lo cual el encargo prohíbe explícitamente. |
| 4 | `PutDecide` aceptaba `note` opcional incluso al rechazar | El contrato original solo distinguía `decision` (`Confirmed`/`Canceled`), sin ningún motivo cerrado — un rechazo sin nota era indistinguible de una caducidad de sistema en el propio payload de la API, además de permitir que un rechazo "silencioso" (sin motivo operativo) llegara a persistirse. |

## 2. Nuevo modelo durable del resultado

Campo NUEVO `Meeting.cMotivoResolucionReserva` (enum, `isCustom: true`,
prefijo `c` — misma convención que `cEstadoReserva`/`cTratamiento`/
`cZonaAtencion`/`cBookingRequestId`, confirmada por auditoría de la
metadata real antes de nombrarlo, igual que se hizo con
`cGapssaAccountId`). Valores: `Approved` | `RejectedByStaff` |
`ApprovalExpired` — **exactamente los tres primeros valores de
`BOOKING_REASON_CODES`** (`packages/contracts/src/booking.ts`), no una
lista paralela: `MEETING_RESOLUTION_REASONS` es la fuente única, y
`BOOKING_REASON_CODES` la reutiliza por `spread` para que el campo real de
EspoCRM y el `reasonCode` que `BookingRequestRecord` termina guardando en
Postgres sean, literalmente, el mismo concepto.

Mapeo obligatorio (`MEETING_RESOLUTION_COMPATIBLE_REASONS` en TS,
`MeetingResolutionPolicy::isCompatible()` en PHP — mismo mapeo, dos
lenguajes, comentado en ambos como "no cambiar un lado sin el otro"):

| `cEstadoReserva` | Motivos compatibles |
|---|---|
| `Confirmed` | `Approved` únicamente |
| `Canceled` | `RejectedByStaff` (rechazo humano) o `ApprovalExpired` (caducidad de sistema) |
| Cualquier otro estado | Ninguno — el campo debe quedar `null` |

Requisitos del encargo, todos cumplidos:

- **Nunca description/note como marcador técnico**: el motivo vive en su
  propio campo enum, `description`/`note` sigue siendo exclusivamente la
  nota humana opcional/obligatoria según el motivo.
- **Nunca se infiere desde `modifiedById`**: `deriveResolutionFromDecidedMeeting`
  (`decisionRecovery.ts`) fue reescrita para leer EXCLUSIVAMENTE
  `resolutionReason` — ver §3 más abajo, código completo.
- **No depende exclusivamente de la tabla de idempotencia**: el campo vive
  en el propio `Meeting`, se lee con cualquier `GET` normal, sobrevive a
  reinicios, y permite reconciliar incluso si `gapssa_meeting_decision_operation`
  se purgara o no existiera.
- **Combinaciones incompatibles se rechazan**: dos capas — (a) `PutDecide`
  valida `resultReason` contra `decision` ANTES de escribir
  (`MeetingResolutionPolicy::isCompatible`); (b) `GuardMeetingResolutionReasonConsistency`
  (hook `before` NUEVO, `beforeCreate`+`beforeUpdate`) rechaza CUALQUIER
  escritura — incluida una que solo tocara `cMotivoResolucionReserva` sin
  tocar `cEstadoReserva`, camino que `GuardMeetingDecisionTransition` no
  cubre — que deje una combinación incoherente, verificado en vivo (§9,
  escenarios 15a/15b).
- **Otros estados nunca reciben un motivo inventado**: cubierto por la
  misma política — `isCompatible()` devuelve `false` para cualquier
  `cEstadoReserva` ajeno a `Confirmed`/`Canceled`.

**No creado en la instancia real** — vive únicamente en
`extensions/espocrm/custom/Espo/Custom/Resources/metadata/entityDefs/Meeting.json`
(export local). Requiere una autorización de escritura de esquema aparte,
anterior a la puerta 4 — ver §10 punto 1.

## 3. Flujo humano (decisión manual)

```
Usuario humano (EspoCRM UI) ──click "Aprobar"/"Rechazar"──▶
  detail.js (custom, Meeting)
    ├── confirma (Aprobar) o abre modal de motivo obligatorio (Rechazar)
    ├── genera operationKey (UUID) UNA vez por clic
    ├── PUT /api/v1/GapssaMeetingDecision/{id}  (sesión propia del usuario)
    │     { decision, resultReason, note?, operationKey }
    └── PutDecide.php
          ├── ACL edit sobre Meeting
          ├── isAuthorizedToDecide() — admin | id en allowlist de API (type=api) | id en allowlist humana
          ├── valida resultReason vs decision, note vs resultReason
          ├── SELECT ... FOR UPDATE (lock de fila, transacción única)
          ├── idempotencia (operationKey + hash del payload)
          ├── Service::update() → cEstadoReserva + cMotivoResolucionReserva
          │     (MISMA llamada, nunca dos escrituras separadas)
          └── commit único
```

Esta es la vía **preferida** (encargo, punto 5): usa la sesión/ACL propia
del usuario humano — `modifiedById` queda con el id REAL de la persona que
decidió, no con el API User técnico. Verificado en vivo (§9, escenario
10e): `modifiedById` del Meeting tras la decisión = el id del usuario que
hizo la llamada, no el de `admin` ni el de ningún API User.

La vía administrativa/de recuperación (`POST /internal/decisions` del BFF)
sigue existiendo para casos donde el BFF necesita reconciliar o para
operación manual fuera de la UI de EspoCRM — pero ahí `modifiedById`
siempre será el API User técnico (limitación ya documentada, sin cambios).

### Interfaz de EspoCRM

`extensions/espocrm/custom/client/custom/src/views/meeting/record/detail.js`
(extiende `views/record/detail`) + `.../modals/reject-reason.js` (extiende
`views/modal`). Registrado en `clientDefs/Meeting.json` (`recordViews.detail:
"custom:views/meeting/record/detail"`).

- Acciones "Aprobar reserva"/"Rechazar reserva" visibles SOLO cuando
  `cEstadoReserva === PendingCenterApproval` (`hideActionItem`/
  `showActionItem`, reevaluado en `change:cEstadoReserva` y `sync`).
- Confirmación (`this.confirm()`) antes de aprobar.
- Modal dedicado con validación de nota no vacía antes de rechazar.
- `operationKey` UUID generado una vez por clic, reutilizado en el único
  reintento automático permitido (fallo de red/timeout, `xhr.status === 0`
  — nunca ante una respuesta definitiva 4xx/5xx).
- Botones deshabilitados (`disableActionItem`/`enableActionItem`) durante
  toda la operación — impide un segundo clic mientras la primera sigue en
  vuelo.
- 200 (aplicado o replay, indistinguibles y ambos correctos) → éxito +
  refresco del Meeting. 409 → aviso + refresco (el registro puede haber
  cambiado por otra vía). Cualquier otro estado → error genérico, sin
  refrescar.
- Nunca incluye la API Key del BFF — usa `Espo.Ajax`, que reutiliza la
  sesión/cookies/CSRF del propio EspoCRM.

Toda la API de EspoCRM usada (`dropdownItemList`, `hideActionItem`/
`showActionItem`/`disableActionItem`/`enableActionItem`, `Espo.Ajax.putRequest`,
`Espo.Ui.success/warning/error/notifyWait`, `this.confirm()`,
`this.createView()`, `this.getAcl().checkScope()`, `views/modal` con
`templateContent`/`buttonList`) se verificó contra el bundle real de
EspoCRM 10.0.3 (`client/lib/espo-main.js`, solo lectura) y contra el
precedente ya en producción en este mismo repositorio
(`extensions/espocrm-google-calendar-sync/.../gcs-account/record/detail.js`)
— nunca inventada. El identificador de módulo AMD exacto (`"custom:views/..."`)
no pudo confirmarse por lectura estática (la imagen Docker de producción no
incluye el loader sin minificar) y se verificó **empíricamente** contra la
instancia desechable (§9) — resultado: correcto, la interfaz carga y
funciona sin errores de consola.

## 4. Flujo de caducidad (sistema)

```
reconciliation.ts::sweepExpiredApprovals
  └── operationKey = buildApprovalExpiryOperationKey(bookingRequestId)
        (determinista: `expiry-v1-${bookingRequestId}` — nunca una UUID
        nueva por pasada del barrido)
  └── adapter.expireMeeting({ meetingId, operationKey })
        └── HTTP: PUT GapssaMeetingDecision { decision: Canceled,
              resultReason: ApprovalExpired, operationKey }
              (nunca nota humana; PutDecide solo admite ausencia de nota o
              la nota técnica fija — `MeetingResolutionReason::EXPIRY_TECHNICAL_NOTE`
              / `APPROVAL_EXPIRED_TECHNICAL_NOTE`, no usada aquí porque el
              barrido no envía ninguna)
```

Dos pasadas del barrido sobre la MISMA solicitud vencida (p. ej. tras un
timeout de la primera) reenvían la MISMA `operationKey` — `PutDecide` la
reconoce como replay, nunca reintenta la escritura ni produce un segundo
efecto. Verificado en vivo (§9, escenario 6/expiración): dos llamadas con
la misma clave determinista devuelven exactamente el mismo `modifiedAt`.

## 5. Idempotencia

| Nivel | Clave | Estrategia |
|---|---|---|
| `PutDecide` (EspoCRM) | `operationKey` (string cerrado, `^[A-Za-z0-9_-]+$`, máx. 128) | Tabla `gapssa_meeting_decision_operation` (PK `operation_key`), hash del payload (`meetingId`+`decision`+`resultReason`+hash de `note`) comparado en cada llamada — misma clave+mismo payload → replay del resultado ya confirmado; misma clave+payload distinto (incluido `resultReason`/`note`) → 409 `idempotency_key_reused`. Verificado en vivo (§9). |
| Decisión humana vía BFF (`/internal/decisions`) | `idempotencyKey` (UUID) | **Estrategia elegida y demostrada**: el cliente operativo puede aportar la clave; si no, el endpoint genera una. En ambos casos, `repository.ts::ensureDecisionOperationKey` la asegura y persiste en `BookingRequestRecord.decisionOperationKey` (columna nueva, índice único parcial `WHERE decision_operation_key IS NOT NULL`) mediante un `UPDATE ... SET decision_operation_key = COALESCE(decision_operation_key, $candidata)` — atómico, de una sola sentencia — **ANTES** de llamar al adaptador (antes del primer efecto externo). Un reintento (candidata distinta o repetida) siempre converge en la clave que ganó la primera vez. |
| Caducidad de sistema | `expiry-v1-${bookingRequestId}` | Determinista y versionada (prefijo `v1`, nunca colisiona con una futura `v2` de criterio distinto) — sin necesidad de persistir nada nuevo, el propio `bookingRequestId` ya es estable. |

**Resuelto en la corrección de puerta 4 (§0)**: dos decisiones HUMANAS
genuinamente distintas (p. ej. aprobar y rechazar) llegando casi a la vez
para la MISMA solicitud comparten la misma `decisionOperationKey`
persistida (`ensureDecisionOperationKey` solo se parametriza por
`bookingRequestId`, no por `decision` — sin cambios, sigue siendo el
diseño correcto: la clave debe converger, no divergir). Contra el
adaptador SIMULADO esto sigue siendo inofensivo (el CAS de Postgres decide
el ganador sin mirar `operationKey`, nunca reproducible ahí). Contra el
adaptador HTTP real, el perdedor de la carrera por `ensureDecisionOperationKey`
reenvía la clave del ganador con un payload distinto →
`HttpEspoBookingAdapter.putDecide` propaga el 409 `idempotency_key_reused`
como excepción (correcto y sin cambios: nunca se trata ahí como "ya
decidido", es responsabilidad del llamante reconciliar).

`applyOrAdoptBookingDecision` (`decisionRecovery.ts`) ahora captura
ÚNICAMENTE ese código contractual exacto (`isIdempotencyKeyReusedConflict()`,
`httpEspoAdapter.ts` — compara `error.status === 409` y el CUERPO crudo de
la respuesta contra el literal `'idempotency_key_reused'`; nunca inspecciona
`error.message`, texto libre) — nunca genera una `operationKey` nueva para
reintentar, nunca convierte cualquier 409/excepción genérica en un
resultado propio. Al capturarlo, cae al MISMO camino de reconciliación que
ya existía para "el CAS no ganó": relee el Meeting real
(`adapter.getMeetingById`) y deriva su resolución con
`deriveResolutionFromDecidedMeeting` (exclusivamente `cEstadoReserva` +
`cMotivoResolucionReserva`, nunca `decidedBy`):

- Coincide con la decisión solicitada -> `already_applied_compatible`
  (o `applied`, si esta llamada es la que completa la resolución
  pendiente).
- Decisión distinta reconocible (el Meeting SÍ está `Confirmed`/`Canceled`
  con un motivo válido, pero no el pedido) -> `conflict`, 409
  `decision_conflict` — sin cambios respecto al conflicto ya manejado.
- El Meeting sigue `PendingCenterApproval`, o presenta una combinación
  `cEstadoReserva`/`cMotivoResolucionReserva` incoherente (dato heredado o
  corrupto) -> **outcome nuevo `inconsistent`**, 409
  `decision_state_inconsistent` — nunca se inventa un éxito, nunca se
  confunde con "otra decisión ya ganó".

Cualquier otro error (401/403/404/5xx, fallo de red, JSON inválido,
cualquier 409 con un cuerpo distinto de `idempotency_key_reused`) se sigue
propagando tal cual — nunca capturado por este mecanismo, nunca convertido
en un 409 propio. Corregido un incidente descubierto durante la
verificación de wire format real: `Conflict::createWithBody()` (core de
EspoCRM) escribe el segundo argumento COMO TEXTO PLANO, no como JSON — a
diferencia de `meeting_decision_conflict` (que sí compone su propia
respuesta JSON manualmente); `httpEspoAdapter.ts::request()` descartaba
antes ese cuerpo no-JSON (`parsedBody = undefined`), lo que habría hecho
indetectable el código contractual incluso con el `catch` en su sitio —
ahora se conserva el texto crudo cuando `JSON.parse` falla. Confirmado
leyendo el core real de EspoCRM 10.0.3 en el contenedor de desarrollo
(`Espo\Core\Api\ErrorOutput::printBody()`, solo lectura) y replicado
fielmente en `FakeEspoServer` para que la prueba contractual detecte una
regresión futura en ese fallback.

Probado contra: el adaptador simulado (sigue sin poder reproducir el 409,
por diseño — cobertura ya existente en
`booking.decisionRecovery.int.test.ts`), `FakeEspoServer` +
`HttpEspoBookingAdapter` reales con concurrencia genuina del event loop
(`Promise.all`, nunca simulada con `setTimeout`) y un adaptador stub
determinista para las ramas de error (relectura incoherente, fallo de red
durante la relectura, 401/403/500/409-ajeno) —
`apps/web/tests/integration/booking.decisionRecovery.httpConflict.int.test.ts`,
10 pruebas nuevas, todas en verde. No se ha reproducido contra una
instancia EspoCRM 10.0.3 desechable con concurrencia HTTP real en esta
revisión (alcance no cerrado en el tiempo disponible) — queda anotado en
§10 como verificación pendiente, no como duda sobre la corrección: el
mecanismo de detección se verificó carácter a carácter contra el código
fuente real de `Espo\Core\Api\ErrorOutput`/`Espo\Core\Exceptions\Conflict`
en el contenedor de desarrollo (solo lectura, sin escritura alguna).

## 6. ACL — autorización de `PutDecide` (política cerrada, corrección de puerta 4)

Dos puertas, evaluadas en orden, ambas dentro de la propia acción:

1. `Acl::check('Meeting', 'edit')` — ya existente.
2. `isAuthorizedToDecide()`, delegada íntegramente en
   `MeetingDecisionAuthorizationPolicy::isAuthorized()` (clase pura nueva,
   `Classes/Api/GapssaMeetingDecision/MeetingDecisionAuthorizationPolicy.php`
   — sin ningún `Espo\...` en sus imports, probada con el arnés mínimo sin
   bootstrap de EspoCRM, `tests/MeetingHooksPureLogicTest.php`):
   - Administrador → autorizado siempre.
   - Usuario `type === 'api'` → autorizado **ÚNICAMENTE si su id está en
     la config `gapssaBookingDecisionAuthorizedApiUserIds`** — corrige la
     regla anterior de esta misma revisión ("cualquier `type=api`
     autorizado siempre"), señalada como demasiado amplia: el TIPO de
     usuario no es autorización por sí solo, autorizaría a cualquier API
     User futuro (no solo al técnico dedicado, `portal-gapssa-api`).
   - Cualquier otro usuario (profesional humano regular) → autorizado
     ÚNICAMENTE si su id está en la config
     `gapssaBookingDecisionAuthorizedUserIds` — sin cambios respecto a la
     versión anterior.

Ambas configs (`Espo\Core\Utils\Config`, `data/config.php`) — **vacías por
defecto, denegar por defecto**, mismo patrón que
`ESPOCRM_PROFESSIONAL_USER_IDS` en `httpEspoAdapter.ts` (listas blancas
explícitas, nunca un rol/equipo/tipo inventado como criterio). Config
corrupta (valor no-array) o ausente se trata IGUAL — lista vacía, deniega,
nunca lanza (`MeetingDecisionAuthorizationPolicy::idInAllowlist`). Un id
presente en una lista NUNCA autoriza por la otra — la política nunca
"hereda" permisos entre tipo API y tipo humano, ni entre sí un mismo id
literal apareciera por error en ambas.

### Matriz final de autorización

| Actor | ACL `edit` | En `...ApiUserIds` | En `...UserIds` | Autorizado a decidir |
|---|---|---|---|---|
| Administrador | — | — | — | sí, siempre |
| API User, id en la allowlist de API | sí | sí | — | sí |
| API User, id AUSENTE de la allowlist de API (aunque tenga `Meeting.edit`) | sí | no | — | **no** — 403 |
| API User, id en la allowlist de API pero SIN `Meeting.edit` | no | sí | — | **no** — 403 (por ACL, antes de llegar a `isAuthorizedToDecide`) |
| Usuario humano regular, id en la allowlist humana | sí | — | sí | sí |
| Usuario humano regular, id AUSENTE de la allowlist humana | sí | — | no | **no** — 403 |
| Usuario sin `Meeting.edit`, cualquier tipo | no | — | — | **no** — 403 (`Sin permiso de edición sobre Meeting.`) |
| Config ausente (nunca escrita) en cualquiera de las dos claves | — | — (tratada `[]`) | — (tratada `[]`) | solo administradores |
| Config corrupta (no es un array) | — | — (tratada `[]`) | — (tratada `[]`) | solo administradores |
| Id con tipo inesperado dentro de una lista (número, `bool`, `null`) | — | ignorado, nunca coincide | ignorado, nunca coincide | no autoriza por esa entrada |

Probado con 16 comprobaciones nuevas de `MeetingDecisionAuthorizationPolicy`
(`tests/MeetingHooksPureLogicTest.php`, 84/84 en total) cubriendo cada fila
de arriba a nivel de política pura. La interacción real con el ACL
(`Meeting.edit` evaluado ANTES, en la propia acción) — filas 3ª y 6ª — no
es reproducible sin bootstrap de EspoCRM; sigue demostrada en vivo contra
la instancia desechable (§9, sin cambios en esa parte del ensayo, ver tabla
original de esa sección para el detalle histórico ACL+config).

### Recomendación V1 (valores NO escritos en la instancia real)

- `gapssaBookingDecisionAuthorizedApiUserIds`: únicamente el id real de
  `portal-gapssa-api` — el único API User técnico que debe poder
  aprobar/rechazar/expirar reservas vía `PutDecide`.
- `gapssaBookingDecisionAuthorizedUserIds`: vacía — ningún profesional
  humano regular autorizado inicialmente (solo admin + `portal-gapssa-api`
  hasta que Gapssa decida explícitamente ampliarla).
- Administradores: autorizados por su condición nativa, sin config
  adicional.

Ningún id real se incrusta en el repositorio, en pruebas, en JavaScript
cliente ni en documentación pública — los ejemplos de este documento usan
siempre placeholders (`api-user-1`, `prof-1`, etc.).

**No se ha modificado ningún rol real ni la config real** — la matriz de
arriba se demostró en pruebas puras (esta revisión) y, para la parte
ACL+config, contra una instancia EspoCRM 10.0.3 completamente desechable
(§9, revisión anterior), con roles/usuarios/config creados y destruidos
solo ahí.

## 7. Migración necesaria

### EspoCRM real (NO ejecutada — puerta de escritura aparte, §10)

- Nuevo campo `Meeting.cMotivoResolucionReserva` (enum, 3 opciones,
  `audited: true`).
- Nuevos ficheros PHP: `MeetingResolutionReason.php`,
  `MeetingResolutionPolicy.php`, `GuardMeetingResolutionReasonConsistency.php`
  (registrado en `beforeCreateHookClassNameList`/`beforeUpdateHookClassNameList`
  de `recordDefs/Meeting.json`).
- `PutDecide.php`/`DecisionIdempotencyStore.php` actualizados (mismo
  fichero, contrato ampliado — no requiere cambio de esquema SQL adicional,
  `resultReason` solo participa en el hash, nunca se guarda en columna
  propia).
- Nuevos ficheros cliente: `client/custom/src/views/meeting/record/detail.js`,
  `client/custom/src/views/meeting/modals/reject-reason.js`.
- `clientDefs/Meeting.json`, `layouts/Meeting/detail.json`,
  `i18n/{es_ES,en_US}/Meeting.json` actualizados.
- Dos configs nuevas (corrección de puerta 4, §6): `gapssaBookingDecisionAuthorizedApiUserIds`
  (recomendación V1: únicamente el id de `portal-gapssa-api`) y
  `gapssaBookingDecisionAuthorizedUserIds` (recomendación V1: vacía).
  Ninguna de las dos escrita en la instancia real.

### `gapssa_booking` (Postgres, BFF) — SÍ aplicable, ámbito de este repo

Migración `apps/web/drizzle/booking/migrations/0006_eminent_mimic.sql`
(generada con `drizzle-kit generate`, nunca escrita a mano):

```sql
CREATE TYPE "public"."sim_espo_meeting_resolution_reason" AS ENUM('Approved', 'RejectedByStaff', 'ApprovalExpired');
ALTER TABLE "booking_request_records" ADD COLUMN "decision_operation_key" text;
ALTER TABLE "sim_espo_meetings" ADD COLUMN "resolution_reason" "sim_espo_meeting_resolution_reason";
CREATE UNIQUE INDEX "booking_request_records_decision_operation_key_key" ON "booking_request_records" USING btree ("decision_operation_key") WHERE "booking_request_records"."decision_operation_key" IS NOT NULL;
```

Puramente aditiva (columnas nullable, sin `NOT NULL`, sin borrar ni
renombrar nada) — verificada contra una base efímera vacía
(aplicación completa desde cero + segunda aplicación idempotente, ambas
limpias) y, por un error de shell propio corregido en el momento (ver
nota de transparencia más abajo), también aplicada sin incidentes al
`gapssa_booking` de desarrollo local real.

**Nota de transparencia**: durante la validación de esta migración, un
error en un `sed` de mi propio script de verificación (patrón mal
escapado) hizo que dos ejecuciones de `booking:db:migrate` apuntaran, sin
intención, al `gapssa_booking` real de desarrollo local en vez de a la
copia efímera prevista. Al investigar, se descubrió además que ese
`gapssa_booking` real ya estaba desactualizado (5 migraciones por detrás,
deriva preexistente y no relacionada con esta tarea — probablemente un
volumen local no re-migrado tras revisiones anteriores). El cambio
aplicado es puramente aditivo, no destructivo, y deja el `gapssa_booking`
local exactamente en el estado que el árbol de trabajo actual ya requiere
para funcionar — se optó por NO revertirlo (revertir solo reintroduciría
la deriva) y, en su lugar, repetir correctamente la validación contra una
base efímera aislada (creada, migrada dos veces de forma idempotente,
verificada y destruida). Ningún dato real de negocio existe en ese entorno
de desarrollo (regla del proyecto: nunca datos reales en desarrollo/pruebas).

### Auditoría de solo lectura de la deriva (corrección de puerta 4)

Auditoría posterior, exclusivamente de lectura (`\d`, `select count`,
`select ... from drizzle.__drizzle_migrations` contra el contenedor real
`gapssa-apps-db-1`; ningún `UPDATE`/`DELETE`/`DROP`/reversión ejecutados):

- **Journal del repositorio** (`apps/web/drizzle/booking/migrations/meta/_journal.json`):
  7 entradas, `idx` 0–6, tags `0000_shiny_enchantress` …
  `0006_eminent_mimic`.
- **Journal aplicado en `gapssa_booking` real** (`drizzle.__drizzle_migrations`):
  7 filas, `id` 1–7, cada `hash` idéntico byte a byte al `sha256` calculado
  localmente sobre el `.sql` correspondiente, en el MISMO orden —
  confirma que las 7 migraciones aplicadas son exactamente las 7 del
  repositorio, sin modificar, sin reordenar.
- **Las cinco migraciones que estaban atrasadas** (identificadas por
  `applied_at`: la `id 1` = `0000` se aplicó el 2026-08-07, mucho antes que
  el resto; `id 2`–`id 6` = `0001`–`0005` se aplicaron todas el 2026-08-10,
  en momentos distintos a lo largo del día — consistente con desarrollo
  normal incremental, no con un único `migrate()` de arrastre): `0001_revision2_outbox_and_identity_fingerprint`,
  `0002_revision3_outbox_lease`, `0003_aberrant_longshot`,
  `0004_blue_lyja`, `0005_useful_frightful_four`. `0006_eminent_mimic`
  (`id 7`) se aplicó el 2026-08-11, coincidiendo con el incidente descrito
  arriba — es la migración que el `sed` mal escapado estaba validando.
- **Ninguna migración parcialmente aplicada**: el hash de cada fila del
  journal coincide exactamente con el `.sql` del repositorio (una
  aplicación parcial cambiaría el esquema físico sin que el hash
  coincidiera, o dejaría el `migrate()` en fallo antes de escribir la
  fila — ninguno de los dos ocurre). Verificado además a nivel de esquema
  físico: `\d booking_request_records`/`\d sim_espo_meetings` muestran
  exactamente las columnas/índices que `0006` añade
  (`decision_operation_key` + su índice único parcial;
  `resolution_reason` + el enum `sim_espo_meeting_resolution_reason` con
  sus 3 valores) — la migración más reciente está físicamente completa,
  no solo registrada.
- **Conteos de datos** (sin PII, solo `count(*)`): las 9 tablas de
  `gapssa_booking` (`booking_request_records`, `booking_review_records`,
  `booking_outbox_jobs`, `booking_audit_log`, `pending_guest_identities`,
  `pending_authenticated_contact_details`, `sim_espo_contacts`,
  `sim_espo_meetings`, `sim_espo_meeting_contacts`) tienen **0 filas** —
  consistente con la regla del proyecto (nunca datos reales de negocio en
  desarrollo).
- **Reaplicación idempotente**: `runBookingMigrations()` ejecutado dos
  veces seguidas contra una base efímera nueva (creada y destruida solo
  para esta comprobación, guardada por `assertEphemeralTestDatabaseUrl()`
  — nunca contra `gapssa_booking` real) — primera aplicación desde vacío
  (7/7 migraciones, sin error), segunda aplicación inmediatamente después
  (sin error, sin duplicar filas del journal: sigue en 7). Confirma que
  una reaplicación es un no-op seguro.
- **No se editó ni borró el journal, no se revirtió ninguna migración, no
  se usó `sed` para construir ninguna URL de base de datos** en esta
  auditoría — toda construcción de URL de base efímera pasa por `new URL()`
  + `assertEphemeralTestDatabaseUrl()` (nuevo, ver más abajo), nunca por
  manipulación de string libre.

## 8. Compatibilidad con registros heredados

`deriveResolutionFromDecidedMeeting` (`decisionRecovery.ts`) reescrita para
leer EXCLUSIVAMENTE `resolutionReason`:

```ts
export function deriveResolutionFromDecidedMeeting(
  meeting: Pick<SimMeeting, 'cEstadoReserva' | 'resolutionReason'>,
): DerivedMeetingResolution | null {
  if (meeting.cEstadoReserva === 'Confirmed') {
    return meeting.resolutionReason === 'Approved' ? { resolution: 'confirmed', reasonCode: 'Approved' } : null
  }
  if (meeting.cEstadoReserva === 'Canceled') {
    if (meeting.resolutionReason === 'RejectedByStaff') {
      return { resolution: 'rejected', reasonCode: 'RejectedByStaff' }
    }
    if (meeting.resolutionReason === 'ApprovalExpired') {
      return { resolution: 'approval_expired', reasonCode: 'ApprovalExpired' }
    }
    return null
  }
  return null
}
```

Casos heredados/ambiguos — TODOS devuelven `null` (nunca una adivinanza;
el llamante los cuenta en `inconsistentMeetings`, para revisión manual):

- `Canceled` sin motivo (`resolutionReason === null`) — dato de antes de
  que el campo existiera.
- `Confirmed` con un motivo que no sea `Approved`.
- `Canceled` con un motivo que no sea `RejectedByStaff`/`ApprovalExpired`.
- Cualquier `cEstadoReserva` ajeno a `Confirmed`/`Canceled`.

Cubierto con pruebas de integración dedicadas
(`booking.sweepRecovery.int.test.ts`, dos casos nuevos: `Canceled` sin
motivo, `Confirmed` con motivo incompatible) — ambos convergen en
`inconsistentMeetings`, la solicitud permanece `pending_approval`, nunca se
inventa una resolución.

## 9. Pruebas

### Unitarias e integración (TypeScript) — actualizado en la corrección de puerta 4

| Suite | Resultado |
|---|---|
| `npm run typecheck` (todos los workspaces) | limpio |
| `npm run lint -w @gapssa/web` | limpio, 0 errores/avisos |
| `npx vitest run` (`apps/web`, unitarias) | **721/721**, 37 ficheros (+2 respecto a la revisión anterior: reuso de `operationKey` reconocido como `EspoApiError` 409 con cuerpo `idempotency_key_reused`; un `meeting_decision_conflict` JSON real nunca se confunde con ese código) |
| `node --test` (`@gapssa/contracts`) | **98/98** |
| `npm run test:integration` (raíz) | **276/276**, 28 ficheros (+21 pruebas, +2 ficheros: `booking.decisionRecovery.httpConflict.int.test.ts` — 10 pruebas nuevas, concurrencia genuina `HttpEspoBookingAdapter`+`FakeEspoServer` y ramas deterministas con adaptador stub; `ephemeralDatabaseGuard.int.test.ts` — 11 pruebas nuevas. `booking.otpOutbox.int.test.ts` pasó 7/7 en esta ejecución de la suite completa — el fallo por timing documentado en la revisión anterior sigue siendo aislado e intermitente, no reproducido esta vez) |
| `npm run build` (`next build`, Turbopack) | compila limpio, misma superficie de rutas |
| `npx playwright test` (`test:e2e`) | **43/43** — los 3 fallos preexistentes de la revisión anterior (robots.txt, indexabilidad de `/mi-cuenta`, CTA de navegación) no se reprodujeron en esta ejecución; no investigado más a fondo por ser ajeno a este cambio |
| `git diff --check` | limpio |
| Escaneo de secretos sobre archivos modificados/nuevos de esta corrección | sin coincidencias (patrones de API key/token/clave privada/contraseña; ningún id real de EspoCRM incrustado cerca de las nuevas claves de config) |
| `php -l` sobre todo `extensions/espocrm/custom` | sin errores |
| `make gcs-test` (Google Calendar Sync 1.1.1) | OK — dependencias, autoload, hooks, mapper, i18n, paquete y `php -l` sobre el ZIP, todo limpio |
| Migraciones desde base vacía + reaplicación idempotente (`gapssa_booking_test_auditcheck<hex>`, efímera, creada y destruida solo para esta comprobación) | OK ambas veces — 7/7 migraciones, sin error, sin duplicar filas del journal en la segunda pasada |

### PHP puro (`extensions/espocrm/custom/tests/MeetingHooksPureLogicTest.php`)

**84/84** comprobaciones (68 de la revisión anterior + 16 nuevas de
`MeetingDecisionAuthorizationPolicy` — ver §6) — ampliado con:
`MeetingResolutionReason::isValid`
(válidos/inválidos/vacío), `MeetingResolutionPolicy::isCompatible` (los 6
pares válidos/inválidos de `cEstadoReserva`×motivo, incluidos "otros
estados nunca admiten motivo"), `MeetingResolutionPolicy::isNoteAcceptable`
(nota vacía/solo-espacios rechazada para `RejectedByStaff`, texto libre
rechazado para `ApprovalExpired`, nota técnica exacta aceptada,
`Approved` sin restricción), `DecisionIdempotencyStore::hashPayload` con
`resultReason` (cambia el hash por sí solo, incluso con
`meetingId`/`decision`/`note` idénticos).

### Ensayo en vivo — EspoCRM 10.0.3 completamente desechable

Entorno: `docker compose -p gapssa-decision-rehearsal` (ficheros de env con
credenciales aleatorias, solo en el scratchpad de esta sesión), puertos
`8092`/`8094` (distintos de los reales `8081`/`8083`), red/volúmenes
propios. Desplegado: los 9 ficheros PHP de `Classes/RecordHooks/Meeting` +
`Classes/Api/GapssaMeetingDecision`, `routes.json`, `sql/install.sql`,
`entityDefs`/`recordDefs`/`clientDefs`/`i18n` de `Meeting`/`Contact`, y los
2 ficheros cliente nuevos. **Eliminado por completo al terminar**
(`down -v`) — cero contenedores/volúmenes/redes residuales, verificado; los
6 contenedores reales (`gapssa-*`) intactos durante y después.

Los 15 escenarios del encargo, todos verificados contra esta instancia real
(no simulados, no solo unitarios):

| # | Escenario | Método | Resultado |
|---|---|---|---|
| 1 | Aprobación desde la nueva interfaz | Playwright (clic real, confirmación, refresco) | Confirmada, `cMotivoResolucionReserva=Approved`, botones ocultos tras decidir, 0 errores de consola |
| 2 | Rechazo con motivo | Playwright + `curl` | Cancelada, `RejectedByStaff`, nota persistida y visible |
| 3 | Rechazo sin motivo | Playwright (validación en el modal) + `curl` (400) | Modal no envía sin nota; API rechaza con 400 |
| 4 | Caducidad técnica | `curl` (`ApprovalExpired`, sin nota) | 200, nota libre en `ApprovalExpired` → 400 |
| 5 | Doble clic | Playwright (respuesta artificialmente retrasada 2s, segundo clic forzado durante la espera) | Ítem del menú queda con clase `disabled`; **exactamente 1** petición `PUT GapssaMeetingDecision` enviada |
| 6 | Timeout posterior al commit y replay | `curl` (misma `operationKey`, misma llamada dos veces) + adaptador HTTP real (`expireMeeting` con clave determinista, dos veces) | Mismo cuerpo, mismo `modifiedAt`/`decidedAt` exacto en ambas llamadas |
| 7 | Conflicto entre aprobación y caducidad | `curl`, dos peticiones REALMENTE concurrentes (`&`/`wait`) sobre el mismo Meeting | Exactamente un ganador (200), el otro 409 `meeting_decision_conflict`, estado final coherente con el ganador |
| 8 | `PUT` genérico bloqueado | `curl` (`PUT /api/v1/Meeting/{id}` con `cEstadoReserva=Confirmed`) | 409 `meeting_decision_requires_atomic_action`, estado sin cambios |
| 9 | Usuario sin permiso rechazado | `curl`, usuario real sin rol | 403, `X-Status-Reason: Sin permiso de edición sobre Meeting.` |
| 10 | Profesional no autorizado rechazado | `curl`, usuario real con `Meeting.edit=all` pero sin config | 403, `X-Status-Reason: Este usuario no está autorizado para decidir reservas.` — y demostrado también el camino inverso (con la config, 200) |
| 11 | `modifiedById` humano correcto | `curl` como el profesional autorizado | `modifiedById` = id real de ese usuario, no admin ni API User |
| 12 | Motivo durable correcto | Todos los escenarios anteriores | `cMotivoResolucionReserva` exacto en cada caso, releído independientemente vía `getMeetingById` |
| 13 | Reconciliación del BFF tras cada resultado | Script real (`tsx`) instanciando `HttpEspoBookingAdapter` de `apps/web` contra la instancia desechable (no `FakeEspoServer`) | `findMeetingByBookingRequestId`, `getMeetingById`, `decideMeeting`, `expireMeeting` — los 4 correctos; replay con timestamp idéntico; decidir un Meeting ya decidido devuelve `null` (nunca lanza, nunca sobrescribe) |
| 14 | Compatibilidad con Google Calendar Sync | `make gcs-build` + instalación real de la extensión 1.1.1 en la instancia desechable | Extensión instalada correctamente; decisión normal antes/después de instalarla, sin interferencia; UI del Meeting sin errores de consola con GCS instalado |
| 15 | Combinaciones estado/motivo corruptas detectadas | `curl` — PUT genérico tocando solo `cMotivoResolucionReserva`, y creación directa con `Confirmed`+`RejectedByStaff` | Ambas rechazadas con 409 `meeting_resolution_reason_incompatible` (`GuardMeetingResolutionReasonConsistency`) |

Nota metodológica, sin relación con este cambio: el primer intento de
instalar Google Calendar Sync falló con la misma `DivisionByZeroError`ya
documentada en `docs/fase4b-occ-revision-3.md` §5.1 (instalación limpia sin
`EUR` en `currencyList`) — corregido con el mismo one-liner ya documentado,
exclusivo de esta instancia desechable.

## 10. Lista revisada de operaciones reales pendientes

Sin cambios de fondo respecto a `docs/fase4b-occ-revision-3.md` §8 en los 5
primeros puntos — se listan aquí actualizados y ampliados con los nuevos.
**Ninguno de estos puntos se ejecuta sin tu aprobación expresa y punto por
punto.** Las filas 4–7 (Puerta 4) tienen su propuesta detallada,
manifiesto de archivos y procedimiento paso a paso repartido en
`docs/fase4b-puerta4-propuesta-v2.md` (manifiesto de archivos),
`-v3.md` (análisis de la ACL/flag y orden de activación) y `-v4.md`
(decisión adoptada, código implementado, pruebas y ensayo desechable —
la versión vigente) — este documento no lo duplica. La fila 8 queda fuera
de la Puerta 4: es la **Puerta 5**, aparte, con su propia autorización;
su primer paso será activar `gapssaBookingDecisionEnabled=true` (v4 §5).

| # | Escritura | Estado |
|---|---|---|
| 1 | Crear `Contact.cGapssaAccountId` (EspoCRM real) | **Ejecutado** (Puerta 1) — mismo patrón verificado que la Puerta 2 |
| 2 | Crear `Meeting.cBookingRequestId` + índice único (EspoCRM real) | **Ejecutado y verificado** (§13) — `varchar(36)` nullable, índice único `UNIQ_C_BOOKING_REQUEST_ID`, 0 registros reales alterados |
| 3 | Crear el API User dedicado (EspoCRM real) + cerrar el hallazgo de ACL de campo sobre `Profesional Gapssa` (Puerta 3B) | **Ejecutado y verificado** (§13) — `portal-gapssa-api` activo con rol dedicado; `Profesional Gapssa` con `cGapssaAccountId`/`cBookingRequestId` en `read:no, edit:no` |
| 4 | **Puerta 4** — metadata+columna, tabla `install.sql`, código servidor (11 PHP individuales), `routes.json`, config de autorización, cliente y ACL de `cMotivoResolucionReserva` — sin crear ni decidir ningún Meeting | Propuesta v2 completa (manifiesto de 21 archivos, orden, rollback, condiciones de parada) en `docs/fase4b-puerta4-propuesta-v2.md` — pendiente de tu aprobación paso a paso |
| 5 | **Puerta 5** — primera escritura end-to-end contra EspoCRM real: crear un `Meeting [PRUEBA]` y decidirlo vía `PutDecide` con `resultReason` | Puerta aparte, no incluida en la propuesta de la Puerta 4; sin proponer todavía |

**Resuelto en esta corrección** (ya no una escritura pendiente ni una
limitación de diseño): dos decisiones humanas genuinamente distintas
compitiendo por el mismo `bookingRequestId` a través del BFF ahora
reconcilian limpiamente contra el 409 `idempotency_key_reused` del
adaptador HTTP (§0, §5) — nunca un 500. **Verificación adicional
completada** (§0.1): la reconciliación se probó con concurrencia HTTP
genuina contra una instancia EspoCRM 10.0.3 desechable real (190 intentos,
0 fallos), no solo contra `FakeEspoServer` + Postgres real — ninguna de las
tres condiciones de bloqueo (500 evitable, resolución divergente, API User
no listado decidiendo) apareció. Bloqueo adicional hallado y corregido
durante ese mismo ensayo: `meetingId` de la ruta interna exigía formato
UUID, incompatible con ids reales de EspoCRM (§0.1.2).

## 11. Confirmación final

- **No se ha escrito ningún registro nuevo en la instancia real de
  EspoCRM** (`gapssa-espocrm-1`) — todas las escrituras de esta revisión
  ocurrieron en `gapssa-decision-rehearsal-*`, una instancia completamente
  desechable, eliminada al terminar (verificado, cero residuos).
- **No se ha creado el campo `cMotivoResolucionReserva` en la instancia
  real** ni ningún otro campo/API User/rol real.
- **No se ha modificado ningún rol real** — los roles/usuarios de prueba
  para los escenarios 9/10 se crearon y destruyeron solo en la instancia
  desechable.
- **No se ha desplegado ningún hook, ruta ni SQL en el contenedor real.**
- **`ESPO_BOOKING_ADAPTER` sigue en `simulated`** en todos los entornos de
  `apps/web` — ninguna suite de pruebas lo cambia; el único uso del
  adaptador HTTP real fue el script de ensayo puntual (§9, escenario 13)
  contra la instancia desechable, nunca contra `localhost:8081`.
- **No se han hecho escrituras de negocio reales** — todos los Contact/Meeting
  creados durante el ensayo llevan sufijo `[PRUEBA]` y vivían en la
  instancia desechable, ya eliminada.
- **No se ha tocado la API Key real** en ningún momento.
- **No se ha hecho ningún commit.**
- Incidente de transparencia registrado y explicado en §7 (migración
  aplicada por error, pero de forma segura, al `gapssa_booking` de
  desarrollo local — no a EspoCRM, no a producción).

### Addendum — corrección de puerta 4 (§0)

- **No se ha escrito ni desplegado nada nuevo contra la instancia real de
  EspoCRM** en esta corrección — `MeetingDecisionAuthorizationPolicy` vive
  únicamente en el árbol de trabajo, probada solo con el arnés PHP puro
  (sin bootstrap, sin contenedor).
- **No se ha creado `cMotivoResolucionReserva` ni ninguna config real** —
  ninguna de las dos claves de autorización (`...ApiUserIds`/`...UserIds`)
  se ha escrito en `data/config.php` real.
- **No se ha modificado la API Key ni se ha activado `ESPO_BOOKING_ADAPTER=http`
  en ningún entorno** — las pruebas nuevas contra el adaptador HTTP usan
  exclusivamente `FakeEspoServer` (en memoria, puerto efímero) o un
  adaptador stub, nunca `localhost:8081` ni ninguna instancia real.
- **La auditoría de migraciones (§7) fue estrictamente de solo lectura**
  contra `gapssa_booking` real — ningún `UPDATE`/`DELETE`/`DROP` ejecutado
  ahí; la única base creada/migrada/destruida para verificar
  idempotencia fue efímera (`gapssa_booking_test_auditcheck<hex>`),
  protegida por `assertEphemeralTestDatabaseUrl()`, eliminada al terminar
  (verificado, cero residuos).
- **No se ha hecho ningún commit.**

## 12. Archivos modificados/creados en esta revisión

**Contratos** (`packages/contracts/src`):
- `booking.ts`: `MEETING_RESOLUTION_REASON_FIELD`, `MEETING_RESOLUTION_REASONS`,
  `MeetingResolutionReason`, `MEETING_RESOLUTION_COMPATIBLE_REASONS`,
  `isMeetingResolutionReasonCompatible`, `isMeetingResolutionNoteAcceptable`,
  `APPROVAL_EXPIRED_TECHNICAL_NOTE`, `buildApprovalExpiryOperationKey`;
  `BOOKING_REASON_CODES` reescrito para reutilizar (`spread`)
  `MEETING_RESOLUTION_REASONS`.

**EspoCRM — PHP** (`extensions/espocrm/custom/Espo/Custom`):
- `Classes/RecordHooks/Meeting/MeetingResolutionReason.php` (nuevo).
- `Classes/RecordHooks/Meeting/MeetingResolutionPolicy.php` (nuevo).
- `Classes/RecordHooks/Meeting/GuardMeetingResolutionReasonConsistency.php` (nuevo).
- `Classes/Api/GapssaMeetingDecision/PutDecide.php`: `resultReason`
  obligatorio y validado, nota obligatoria en rechazo/restringida en
  caducidad, `isAuthorizedToDecide()`, escritura de
  `cMotivoResolucionReserva` en la misma llamada que `cEstadoReserva`.
- `Classes/Api/GapssaMeetingDecision/DecisionIdempotencyStore.php`:
  `hashPayload()` incluye `resultReason`.
- `Resources/metadata/entityDefs/Meeting.json`: campo
  `cMotivoResolucionReserva`.
- `Resources/metadata/recordDefs/Meeting.json`: registro de
  `GuardMeetingResolutionReasonConsistency`.
- `Resources/layouts/Meeting/detail.json`,
  `Resources/i18n/{es_ES,en_US}/Meeting.json`,
  `Resources/metadata/clientDefs/Meeting.json`: campo/labels/mensajes/vista
  nueva.
- `tests/MeetingHooksPureLogicTest.php`: +26 comprobaciones.

**EspoCRM — cliente** (nuevo árbol
`extensions/espocrm/custom/client/custom/src`):
- `views/meeting/record/detail.js`.
- `views/meeting/modals/reject-reason.js`.

**Backend** (`apps/web/src/server/booking`):
- `db/schema.ts`: `meetingResolutionReasonEnum`, `resolutionReason`
  (`sim_espo_meetings`), `decisionOperationKey` (`booking_request_records`)
  + índice único parcial.
- `espoAdapter.ts`: `SimMeeting.resolutionReason`;
  `decideMeeting`/`expireMeeting` con `operationKey` obligatorio y nota
  tipada por decisión; `SimulatedEspoBookingAdapter` actualizado.
- `httpEspoAdapter.ts`: eliminado `writeIfPendingCenterApproval`;
  `decideMeeting`/`expireMeeting` llaman exclusivamente a `putDecide()` →
  `PUT GapssaMeetingDecision`; `EspoApiError.body`;
  `MEETING_SELECT_FIELDS`/`meetingRecordSchema`/`toSimMeeting` incluyen
  `cMotivoResolucionReserva`.
- `decisionRecovery.ts`: `deriveResolutionFromDecidedMeeting` reescrita
  (lee `resolutionReason`, nunca `decidedBy`); `applyOrAdoptBookingDecision`
  asegura `operationKey` vía `ensureDecisionOperationKey` antes de llamar
  al adaptador.
- `reconciliation.ts`: `sweepExpiredApprovals` usa
  `buildApprovalExpiryOperationKey`.
- `repository.ts`: `ensureDecisionOperationKey` (nuevo).

**Rutas**:
- `app/api/booking/v1/internal/decisions/route.ts`: esquema
  discriminado por `decision`, `note` obligatoria en `rejected`,
  `idempotencyKey` opcional (generada si falta).

**Pruebas**:
- `tests/contract/fakeEspoServer.ts`: `handleDecision` (réplica del
  contrato de `PutDecide`), guarda contra `PUT` genérico.
- `src/server/booking/httpEspoAdapter.test.ts`: bloque de decisión
  reescrito (8 pruebas: aprobar, rechazar, caducar, conflicto, nunca PUT
  genérico, replay, reuso de clave con payload distinto, PUT genérico
  bloqueado por el fake).
- `src/server/booking/availability.test.ts`,
  `verificationSteps.test.ts`: fixtures `resolutionReason: null`.
- `tests/integration/booking.simulatedEspoAdapter.contract.int.test.ts`:
  3 pruebas nuevas de motivo durable.
- `tests/integration/booking.decisionRecovery.int.test.ts`: `note`/
  `idempotencyKey` añadidos a todas las llamadas; `resolutionReason`
  explícito en `decideSimEspoMeetingForTesting`.
- `tests/integration/booking.sweepRecovery.int.test.ts`: +2 pruebas
  (`Canceled` sin motivo, `Confirmed` con motivo incompatible → ambas
  `inconsistentMeetings`, nunca adivinadas).
- `tests/integration/booking.approvalSweep.int.test.ts`: nota añadida al
  rechazo de la prueba de conflicto.
- `tests/integration/bookingDb.ts`: `decideSimEspoMeetingForTesting` exige
  `resolutionReason` explícito (antes opcional/implícito).

**Migración**: `apps/web/drizzle/booking/migrations/0006_eminent_mimic.sql`
(+ metadatos de `drizzle-kit`).

**Documentación**: `docs/fase4b-decision-flow-final.md` (este documento).

## 13. Corrección posterior — Puerta 2 ejecutada; incidente de atribución en la comprobación previa a la Puerta 4

Con posterioridad a la revisión anterior (§0–§12) se ejecutó, con tu
autorización explícita y punto por punto, la **Puerta 2**: creación de
`Meeting.cBookingRequestId` (`varchar(36)`, nullable, sin valor por
defecto) con índice único `UNIQ_C_BOOKING_REQUEST_ID`, en la instancia
real de EspoCRM (`gapssa-espocrm-1`), mismo patrón que la Puerta 1
(`Contact.cGapssaAccountId`). Comprobaciones previas de solo lectura
(campo inexistente en metadata viva y en la columna física), escritura
vía `docker compose cp` del fichero de metadata del repositorio (árbol de
trabajo, sin commit) seguida de `bin/command rebuild` + `bin/command
app-check`, y validación posterior: columna física correcta, índice
`UNIQUE` real, los 10 `Meeting` existentes (3 eliminados) conservan el
campo a `NULL`, dos `NULL` conviven sin conflicto, un duplicado ficticio
es rechazado por la restricción, ningún registro real alterado, el campo
no aparece en ningún layout, `make gcs-test` en verde. Puertas 3
(API User dedicado) y 4 (hooks PHP + `cMotivoResolucionReserva` + ACL)
siguen sin ejecutarse. Sin commits.

También con posterioridad a §0–§12, y también con tu autorización explícita
punto por punto, se ejecutaron la **Puerta 3** (API User dedicado) y la
**Puerta 3B** (cierre del hallazgo de ACL de campo detectado durante la
Puerta 3), ambas contra la instancia real de EspoCRM.

**Puerta 3**: creado el rol `Portal GAPSSA API` (id `6a7b345b239b2ed26`,
`isAdmin=false`) con allowlist cerrada de scope y de campo — `Contact`/
`Meeting` con `create/read/edit=yes`, `delete/stream=no`; el resto de
scopes y todos los `*Permission` en `no`; a nivel de campo, únicamente
`firstName, lastName, emailAddress, phoneNumber, cGapssaAccountId, name`
en `Contact`, `dateStart, dateEnd, status, cEstadoReserva, cTratamiento(Id),
cZonaAtencion(Id), assignedUser(Id), contacts(Ids), cBookingRequestId,
description` (+ `modifiedBy(Id)`/`modifiedAt` solo lectura) en `Meeting`, y
solo `name, isActive` en `User`. Usuario `portal-gapssa-api` (id
`6a7b345b2624dbb56`), `type=api`, `authMethod=ApiKey`, activo, vinculado
exclusivamente a ese rol. La `apiKey` se generó con el mismo generador
nativo que usa `POST /UserSecurity/apiKey/generate` y se guardó únicamente
en `.env` local (`git check-ignore` confirma que sigue ignorado;
`.env.example` documenta solo el nombre). 15/15 pruebas positivas/negativas
en verde, sin exponer PII ni la clave. Durante esta puerta se detectó —
pero no se corrigió, por no estar autorizado en su alcance — que el rol
preexistente `Profesional Gapssa` no restringía `cGapssaAccountId` ni
`cBookingRequestId` a nivel de campo (quedaban accesibles por el
`read=all/edit=all` de scope). Quedó documentado como pendiente para una
puerta aparte.

**Puerta 3B**: cerrado ese hallazgo. Mutado exclusivamente
`fieldData.Contact.cGapssaAccountId` y `fieldData.Meeting.cBookingRequestId`
del rol `Profesional Gapssa` (id `6a7361290526f104b`, único en el sistema —
2 roles totales en la instancia, sin copias ni homónimos) a `{read: no,
edit: no}`, vía el mismo mecanismo nativo (`EntityManager`/`saveEntity()`)
usado en la Puerta 3. Diff antes/después: mismas claves de entidad, ningún
otro scope ni permiso del rol tocado. Verificado en vivo para el usuario
`Profesional Gapssa` real: campos ordinarios (`name`, `firstName`,
`dateStart`, `status`, `cTratamiento`) siguen accesibles, permisos de scope
sin cambios, sin acceso nuevo a `User`/`Role`; para `Portal GAPSSA API`,
ambos campos permanecen en `read:yes, edit:yes`. **Re-verificado de forma
independiente en esta misma corrección documental** (consulta directa,
solo lectura, a las columnas `field_data` de la tabla `role` en la base de
datos real): coincide exactamente con lo anterior — `Profesional Gapssa`
→ `cGapssaAccountId {read:no, edit:no}` / `cBookingRequestId {read:no,
edit:no}`; `Portal GAPSSA API` → ambos en `{read:yes, edit:yes}`; el
usuario `portal-gapssa-api` (id `6a7b345b2624dbb56`, `type=api`,
`is_active=1`, `auth_method=ApiKey`) vinculado únicamente al rol `Portal
GAPSSA API` en `role_user`.

Al iniciar la comprobación previa a la Puerta 4, una sesión posterior
interpretó erróneamente que `Meeting.cMotivoResolucionReserva` ya estaba
presente en el archivo de metadata **del contenedor real**, contradiciendo
la precondición de inexistencia previa. Se detuvo correctamente sin
escribir y pidió autorización — la decisión de detenerse fue acertada—,
pero la lectura que la motivó no lo era: dos llamadas de esa misma sesión,
una inmediatamente después de la otra, leyeron rutas distintas (el archivo
**dentro del contenedor real**, sin el campo, y a continuación el archivo
**del repositorio en el host**, con el campo añadido sin commitear para el
diseño de la Puerta 4) y sus resultados se atribuyeron al mismo origen.
Con esa premisa ya asentada, se autorizó continuar y se ejecutó
`bin/command rebuild` (autorización que, dada la premisa, era razonable en
su momento); al releer después el archivo del contenedor, el campo seguía
ausente — coherente con que nunca estuvo, no con una desaparición — y esa
ausencia se interpretó como una anomalía de escritor concurrente sobre la
instancia real.

Una revisión forense posterior, con las salidas completas y sin editar de
las herramientas de ambas sesiones (no la narrativa que generaron), y con
nuevas comprobaciones de solo lectura contra el contenedor real, estableció
lo siguiente:

- La primera lectura real del archivo del contenedor en la sesión que
  originó la alarma **ya mostraba el campo ausente** (`cBookingRequestId`,
  `cTratamiento`, `cZonaAtencion`, `cEstadoReserva` — sin
  `cMotivoResolucionReserva`). La lectura del archivo del host,
  inmediatamente posterior, sí mostraba el campo — y fue esa la que se
  reportó como si perteneciera al contenedor.
- El propietario atípico del archivo dentro del contenedor
  (UID/GID del usuario del host, en vez de `www-data`) y su marca de
  tiempo corresponden exactamente a la escritura de la Puerta 2
  (`docker compose cp` + `rebuild`, mismo día) — no a ninguna escritura
  posterior ni a ningún proceso ajeno a estas sesiones.
- Ninguna sesión de trabajo de ese día ejecutó `docker cp`/`docker compose
  cp` de `entityDefs/Meeting.json` contra `gapssa-espocrm-1` (real) salvo
  la propia Puerta 2. Las escrituras de `cMotivoResolucionReserva`
  registradas ese día se hicieron exclusivamente contra instancias
  desechables (`gapssa-decision-rehearsal2-*`), nunca contra la real.
- El estado del archivo (contenido, propietario, marca de tiempo) no ha
  variado entre la primera lectura de esa sesión y la revisión forense
  posterior.

**Conclusión**: no hubo presencia previa real de
`Meeting.cMotivoResolucionReserva` en la instancia de EspoCRM, no hubo
desaparición, no hubo restauración, no hubo escritor concurrente ni deriva
de despliegue de origen desconocido. Hubo un error de atribución entre dos
lecturas consecutivas de rutas distintas en una única sesión. La
clasificación previa de "deriva de despliegue de origen desconocido" se
retira; no debe conservarse como hecho documentado.

### Estado de control corregido

| Elemento | Estado |
|---|---|
| Puerta 1 (`Contact.cGapssaAccountId`) | Completada (EspoCRM real) |
| Puerta 2 (`Meeting.cBookingRequestId` + índice único) | Completada (EspoCRM real) |
| Puerta 3 (API User dedicado `portal-gapssa-api`) | Completada (EspoCRM real) |
| Puerta 3B (ACL de campo — `Profesional Gapssa` sin acceso a `cGapssaAccountId`/`cBookingRequestId`) | Completada y re-verificada en vivo (EspoCRM real) |
| `Meeting.cMotivoResolucionReserva` | Presente únicamente en el árbol de trabajo del repositorio; **no desplegado** en EspoCRM real |
| ACL del campo `cMotivoResolucionReserva` | No configurada |
| Puerta 4 (hooks PHP + `cMotivoResolucionReserva` + ACL, real) | Pendiente, bloqueada hasta nueva aprobación explícita |
| Puerta 5 (ensayo OCC contra la instancia real) | Pendiente |
| Bloqueo por concurrencia/deriva de metadata sobre la instancia real | **No existe** — descartado con evidencia |

No se ha ejecutado ningún `rebuild`, copia de metadata, cambio de ACL,
despliegue de hooks ni prueba end-to-end contra la instancia real como
parte de esta corrección — es un cambio exclusivamente documental.
