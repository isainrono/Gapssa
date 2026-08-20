# Fase 4B — Revisión 3 (consistencia transaccional y operativa de `BookingReviewRecord`)

Revisión acotada a los 7 problemas de consistencia transaccional/operativa
señalados sobre la revisión 2 de Fase 4B (`docs/fase4b-integracion-http.md`
§14), más conciliación y pruebas. **No se ha escrito ningún registro nuevo
en la instancia real de EspoCRM. No se ha creado ningún campo/API
User/rol/índice real en EspoCRM. No se ha desplegado ningún hook (ni los ya
preparados en revisión 2, ni ninguno nuevo). No se ha hecho ningún commit.**
Todo el trabajo vive en el árbol de trabajo, pendiente de revisión.

Complementa, no sustituye, `docs/fase4b-integracion-http.md` (incluida su
§14, revisión 2) ni `docs/fase4a-reservas.md`/`docs/fase4a-revision-3.md`.

**El punto 8 del encargo (ensayo OCC del guard PHP en una copia desechable
de EspoCRM) queda deliberadamente FUERA de esta entrega**, por decisión
explícita tomada contigo al empezar esta revisión: levantar una pila
EspoCRM+MariaDB desechable completa (instalación, copia de los hooks,
`PUT`s concurrentes) es sustancialmente más pesado en tiempo/recursos que
el resto de los puntos combinados, y preferiste que esta entrega cubriera
primero el modelo transaccional/de datos (puntos 1-7, 9-10) para que lo
revisaras antes de invertir ese tiempo. Queda como seguimiento aparte —
ver §12.

## 1. Modelo transaccional definitivo de revisión

Antes de esta revisión, la apertura de una revisión manual era una
secuencia de DOS transacciones separadas
(`transitionToContactReviewPending` + `createBookingReview`,
`repository.ts`), cada una confirmándose por su cuenta. Un fallo del
proceso justo entre ambas dejaba `BookingRequestRecord.status =
"contact_review_pending"` **sin ninguna revisión detrás** — exactamente el
"nunca dejar `contact_review_pending` sin revisión" que este encargo pedía
corregir.

**`repository.ts::openBookingReviewAtomic`** sustituye esa secuencia por
UNA única transacción de `gapssa_booking`:

1. Bloquea la fila de `BookingRequestRecord` (`SELECT ... FOR UPDATE`) —
   serializa cualquier apertura concurrente para el MISMO
   `bookingRequestId` contra esta misma puerta.
2. Comprueba que sigue en `verification_processing` (primera apertura) o
   ya en `contact_review_pending` (reentrada durante una reanudación, ver
   §3) — cualquier otro estado es `invalid_state`, nunca se abre una
   revisión "flotante".
3. Comprueba si ya existe una revisión ACTIVA (`pending`/`processing`)
   para esta solicitud:
   - Si coincide con `replacesReviewId` (reanudación que topó con OTRO
     conflicto, §3): se marca `replaced` y se continúa.
   - Si es otra revisión activa **compatible** (mismo `conflictType` +
     mismos candidatos — el caso real de dos aperturas concurrentes que
     calculan el MISMO conflicto de forma independiente): se devuelve
     idempotentemente, sin crear una segunda.
   - Si es otra revisión activa **incompatible**: `conflict_existing_review`
     — nunca se crea una segunda revisión activa ni se sobrescribe la
     existente.
4. Crea el `BookingReviewRecord` (`pending`) + transiciona
   `BookingRequestRecord` a `contact_review_pending` si venía de
   `verification_processing` + ambas auditorías — todo confirmado o
   revertido junto.

**Índice único parcial** (`booking_review_records_active_booking_request_id_key`,
`db/schema.ts`, migración `0004_blue_lyja.sql`):

```sql
CREATE UNIQUE INDEX "booking_review_records_active_booking_request_id_key"
  ON "booking_review_records" USING btree ("booking_request_id")
  WHERE "booking_review_records"."status" IN ('pending', 'processing');
```

Defensa en profundidad: el bloqueo `FOR UPDATE` del paso 1 ya serializa las
aperturas reales del propio flujo; este índice protege contra cualquier vía
futura que escriba en la tabla sin pasar por `openBookingReviewAtomic`.
Verificado contra Postgres real (`\d booking_review_records`, §9).

**Probado con dos aperturas concurrentes reales** —
`tests/integration/booking.reviewTransactional.int.test.ts`, "dos
verificaciones simultáneas del mismo invitado ambiguo convergen en UNA sola
revisión activa, nunca dos": dos peticiones HTTP `POST
/requests/{id}/verify` genuinamente concurrentes (`Promise.all`, mismo
código OTP correcto — mismo mecanismo que
`booking.concurrency.int.test.ts`) contra un invitado con señales
contradictorias (correo/teléfono a Contacts distintos). Ambas responden
`200 {status: "contact_review_pending"}`; solo existe UNA fila activa en
`booking_review_records` al final.

## 2. Estados y leases

`BOOKING_REVIEW_STATUSES` (`packages/contracts/src/booking.ts`) gana dos
valores:

```
pending -> processing -> resolved
                       -> pending   (fallo transitorio, retryable)
                       -> replaced  (otro conflicto durante la reanudación)
pending | processing -> rejected | expired (transaccional con la solicitud, §3)
```

`booking_review_records` gana `claim_token`/`claimed_at`/`lease_expires_at`
(`db/schema.ts`) — mismo patrón EXACTO que el lease de `booking_outbox_jobs`
(revisión 3 de Fase 4A, punto 1): nunca en el contrato público
`BookingReviewRecord` (detalle de bookkeeping interno, igual que
`booking_outbox_jobs` nunca tuvo un tipo público propio).

**`repository.ts::claimBookingReview`** — única `UPDATE ... WHERE ...
RETURNING`, mono-fila, SIN transacción envolvente:

```sql
UPDATE booking_review_records
SET status='processing', claim_token=<nuevo>, claimed_at=now(), lease_expires_at=now()+5min
WHERE id = $1
  AND (status = 'pending' OR (status = 'processing' AND lease_expires_at < now()))
RETURNING *;
```

Reclama un `pending`, o un `processing` cuyo lease ya venció (reanudación
abandonada). Lease de **5 minutos** (`REVIEW_LEASE_DURATION_MINUTES`) —
una reanudación cruza I/O real (adaptador de EspoCRM, HTTP en producción)
con latencia impredecible, igual que el razonamiento del lease de 2 min del
outbox pero con más margen porque aquí el I/O es sobre EspoCRM, no
SMTP/Redis.

`releaseBookingReviewToPending(reviewId, claimToken)` y
`closeBookingReviewResolved(reviewId, claimToken, ...)` solo escriben
mediante `id = ? AND status = 'processing' AND claim_token = ?` — el mismo
predicado que decide el reclamo. Un worker cuyo lease fue recuperado por
otro nunca puede modificar la fila ni para devolverla a `pending` ni para
cerrarla — verificado con las pruebas de §9.

**Nunca se mantiene una transacción de Postgres abierta mientras se llama
al adaptador de EspoCRM**: el claim es una operación corta y aislada; la
llamada a `completeBookingToMeeting` (que en producción hace HTTP real)
ocurre FUERA de cualquier transacción; el cierre final es otra operación
corta y separada, condicionada al mismo `claimToken`. Esto es claim/lease +
reconciliación (barrido, §9), nunca una transacción distribuida ficticia.

## 3. Apertura, resolución, rechazo y caducidad — exactos

### Apertura

Ver §1. `verificationSteps.ts::openReview` (llamado desde
`completeBookingToMeeting` en los 4 puntos donde puede surgir un conflicto)
ahora llama a `openBookingReviewAtomic` con
`holdHours: serverEnv.BOOKING_CONTACT_REVIEW_HOLD_HOURS` (§6) y propaga
`options.replacesReviewId` — nunca lanza salvo `not_found`/`invalid_state`
(errores de llamante genuinos).

### Resolución (`review.ts::resolveBookingReview`)

1. `claimBookingReview` — `not_found`/`already_closed`/`in_progress`
   (`processing` con lease vigente de otra reanudación) se devuelven tal
   cual, sin tocar nada más.
2. Releída la solicitud: si ya no está `contact_review_pending`, libera el
   claim (`releaseBookingReviewToPending`) y `not_found`.
3. **Punto 4** — valida `resolutionContactId` (ver §4). Cualquier fallo de
   validación libera el claim y devuelve el motivo exacto — la revisión
   NUNCA queda `processing` colgada por un intento inválido del operador.
4. Reconstruye el Contact (invitado/autenticado) — si no está disponible,
   libera el claim, `contact_details_unavailable`.
5. Llama a `completeBookingToMeeting(..., resolvedContactId,
   replacesReviewId: review.id)`:
   - `IncompatibleMeetingError` → abre/reemplaza atómicamente una revisión
     `meeting_incompatible` (nunca cierra sin salida, ver más abajo).
   - Cualquier otro error (transitorio: red, EspoCRM caído) → libera el
     claim a `pending`, `transient_failure`. Nunca se pierde la revisión.
   - `outcome: "contact_review_pending"` → la propia reanudación topó con
     OTRO conflicto; `completeBookingToMeeting` ya abrió/reemplazó la
     revisión correspondiente (mismo mecanismo de `replacesReviewId` que
     la apertura); `still_pending_review`.
   - `outcome: "meeting_created"` → sigue al paso 6.
6. **Solo entonces** relee `BookingRequestRecord` y confirma
   `status === "pending_approval"` — requisito explícito del encargo: NUNCA
   se cierra la revisión como `resolved` antes de confirmar la reanudación.
   Si no confirma, libera el claim (`transient_failure`) en vez de cerrar a
   ciegas.
7. `closeBookingReviewResolved` — cierre final, condicionado al
   `claimToken` (§2). `lease_lost` aquí (otro propietario ya cerró/recuperó
   la fila mientras esta llamada terminaba) sigue tratándose como éxito
   para quien llamó: el Meeting y la solicitud YA están correctos
   (confirmado en el paso 6).

**`IncompatibleMeetingError` durante la reanudación** — nuevo
`conflictType` cerrado `meeting_incompatible`
(`BOOKING_REVIEW_CONFLICT_TYPES`, `packages/contracts/src/booking.ts`):
cuando el Meeting encontrado ya no coincide en horario/tratamiento/
profesional/zona (edición manual en EspoCRM mientras la revisión estaba
abierta), `resolveBookingReview` abre/reemplaza atómicamente una revisión
de este tipo (`openBookingReviewAtomic` con `replacesReviewId`) en vez de
dejar la revisión vieja cerrada sin salida o lanzar un error que un
operador no puede resolver desde aquí — queda pending, trazable,
accionable (rechazable o, si el Meeting se corrige, reintentable).

### Rechazo y caducidad (`review.ts::rejectBookingReview`/`expireBookingReview`)

**Punto 3** — antes eran 3 operaciones separadas (`closeBookingReview` +
`resolveBookingRequest` + purga PII, cada una su propia transacción).
`repository.ts::closeBookingReviewAndResolveRequestTransactionally` las
combina en UNA:

1. Bloquea y cierra la revisión (`rejected`/`expired`) — exige
   `claimToken` si estaba `processing` (nunca se rechaza/caduca una
   revisión que otra petición tiene reclamada — `in_progress`).
2. `resolveBookingRequestWithinTx` (misma tx) — reutiliza el cuerpo ya
   existente de `resolveBookingRequest`, ahora también invocable dentro de
   una transacción ajena.
3. Marca/purga (DELETE físico) `PendingGuestIdentity` o
   `PendingAuthenticatedContactDetails` — **dentro de la MISMA transacción**
   (`purgePendingGuestIdentityWithinTx`/`purgePendingAuthenticatedContactDetailsWithinTx`,
   nuevas — mismo cuerpo que las versiones públicas, ahora aceptan `tx`).

Todo — cambio de estado de la revisión, auditoría, resolución de la
solicitud, auditoría, marcado y DELETE de la identidad pendiente — se
confirma o revierte junto. Nada vive fuera de `gapssa_booking` en este
camino (todas las tablas implicadas son de esa misma base física).

**Rollback demostrado con fallo inyectado en dos puntos distintos de la
transacción** (`tests/integration/booking.reviewTransactional.int.test.ts`,
reutilizando el mecanismo de trigger+tabla marcadora ya existente,
`installBookingAuditFailureInjection`):

- Fallo en la auditoría de `BookingRequestRecord` (paso 2, a mitad de la
  transacción): la revisión sigue `pending`, la solicitud sigue
  `contact_review_pending`, la identidad sigue `active` — nada quedó a
  medias. Reintentar sin el fallo converge con normalidad.
- Fallo en la auditoría de `PendingGuestIdentity` (paso 3, el ÚLTIMO paso):
  demuestra que el rollback deshace también los pasos YA ejecutados
  (cierre de revisión, resolución de la solicitud), no solo el paso que
  falló.

## 4. Validación de `resolutionContactId`

`review.ts::validateResolutionContactId` — nunca se acepta un id de
confianza ciega del cuerpo de la petición:

1. **Formato** — `OPAQUE_ESPO_ID_PATTERN` (`/^[A-Za-z0-9-]{1,64}$/`):
   alfabeto compartido por un id real de EspoCRM (alfanumérico, sin
   guiones, `Espo\Core\Utils\Util::generateId()`) y por un UUID del
   adaptador simulado (`sim_espo_contacts.id`) — un formato demasiado
   estricto (solo el patrón real de EspoCRM) rompería el adaptador
   simulado, que usa UUIDs reales de Postgres; este patrón cubre ambos sin
   aceptar espacios/control/caracteres de inyección. Rechazado ANTES de
   tocar el adaptador.
2. **Existencia real** — `EspoBookingAdapter.getContactById` (nuevo método
   del contrato, implementado en `SimulatedEspoBookingAdapter` y
   `HttpEspoBookingAdapter` — este último reutiliza `getById` +
   `espoQuerySafety.ts`, mismo `select=` obligatorio y allowlist que el
   resto de consultas a `Contact`). `null` → `contact_not_found`. Nunca se
   asume que un id con buen formato existe.
3. **Pertenencia** — SOLO para conflictos de CANDIDATOS de Contact
   (`contact_multiple_matches`/`contact_conflicting_signals`):
   `resolutionContactId` debe pertenecer a `candidateContactIds`; si no,
   `contact_not_a_candidate`. Los conflictos relacionados con Meeting
   (`meeting_contact_missing`/`meeting_contact_mismatch`/
   `meeting_multiple_contacts`/`meeting_duplicate`/`meeting_incompatible`)
   no tienen una lista de Contact candidatos que exigir — la coherencia con
   el Meeting la valida `evaluateContactAdoption` dentro de la propia
   reanudación (`completeBookingToMeeting`), con el mismo rigor que la
   primera vez.

Nunca se relaciona automáticamente un Contact que el operador no haya
seleccionado explícitamente. Solo se registran IDs opacos en cualquier
auditoría — nunca nombre/correo/teléfono del Contact consultado (sin
cambios respecto a la política ya vigente de `booking_audit_log`).

**Pruebas equivalentes simulated/HTTP**: `getContactById` cubierto en
`espoAdapter.test.ts` (simulado) y `httpEspoAdapter.test.ts` (fake server,
exige `select=` igual que el resto de `getById`); los 3 casos de rechazo
(formato/inexistente/ajeno a candidatos) probados end-to-end contra el
adaptador simulado en `booking.reviewTransactional.int.test.ts`.

## 5. Endpoint interno de detalle

**`GET /api/booking/v1/internal/reviews/{id}`** (nuevo,
`app/api/booking/v1/internal/reviews/[id]/route.ts`) — protegido por
`X-Internal-Api-Secret`, devuelve EXCLUSIVAMENTE:

```json
{
  "review": {
    "reviewId": "...",
    "bookingRequestId": "...",
    "conflictType": "contact_conflicting_signals",
    "candidateContactIds": ["...", "..."],
    "candidateMeetingIds": null,
    "status": "pending",
    "createdAt": "...",
    "resolvedAt": null,
    "expiresAt": "..."
  }
}
```

Nunca nombre, correo, teléfono ni datos clínicos — los candidatos son
siempre IDs opacos de EspoCRM. El operador usa esos IDs para abrir las
fichas directamente en EspoCRM (donde ya tiene permisos y puede comparar
los datos reales) — la API BFF no duplica PII. `404` si el id no existe.

**Listado paginado** — `GET /internal/reviews?limit=&offset=` (existente,
extendido): `limit`/`offset` validados (enteros no negativos, `limit`
acotado a 200; valores inválidos caen al valor por defecto en vez de
propagarse sin validar a la consulta de Postgres), respuesta
`{reviews, total, limit, offset}`. Sigue sin exponer
`candidateContactIds`/`candidateMeetingIds` (eso solo en el detalle de UNA
revisión).

## 6. Política de 5 horas

`CONTACT_REVIEW_HOLD_HOURS` (`packages/contracts/src/booking.ts`) pasa de
72h a `APPROVAL_HOLD_HOURS` (5h) — las 72h nunca fueron una decisión de
negocio aprobada y bloqueaban el horario del profesional/zona tres días
completos por una sola solicitud en revisión manual
(`listUnresolvedOverlapping` ya cuenta `contact_review_pending` como
ocupación real desde la revisión 2).

**Configurable sin desplegar código nuevo**:
`BOOKING_CONTACT_REVIEW_HOLD_HOURS` (`server/env.ts`), con un tope
explícito en el propio esquema (`z.coerce.number().max(APPROVAL_HOLD_HOURS,
...)`) que impide configurarlo por encima de `APPROVAL_HOLD_HOURS` sin
tocar esa constante del contrato — nunca solo la variable de entorno. Si
existe un motivo técnico real para una ventana más larga que 5h, sigue
siendo una decisión de negocio pendiente de confirmar, no impuesta aquí.

**Pruebas**:

- `env.test.ts`: valor por defecto (5h), overridable dentro del tope,
  rechaza 6h/72h.
- `booking.reviewTransactional.int.test.ts`, "BookingReviewRecord.expiresAt
  queda a ~5h de createdAt, nunca 72h": verificado end-to-end contra
  Postgres real.
- "una solicitud en `contact_review_pending` sigue ocupando su horario"
  (ya cubierto desde la revisión 2, `booking.review.int.test.ts`) — sin
  cambios de comportamiento, sigue en verde.
- Caducidad exacta y liberación atómica del lock+PII: cubierto por el test
  ya existente "el barrido de conciliación caduca una revisión vencida..."
  (purga verificada) — la ventana de 5h en sí se prueba por separado arriba
  (medir el límite exacto de un barrido en tiempo real añadiría
  temporización frágil sin aportar más garantía que la combinación de
  ambas pruebas).

## 7. Auditoría corregida

**Bug encontrado**: `purgePendingAuthenticatedContactDetails`
(`repository.ts`) auditaba SIEMPRE `entity: "PendingGuestIdentity"`, incluso
para el flujo de cliente AUTENTICADO — mezclando dos entidades reales
distintas de `booking_audit_log` bajo el mismo nombre.

**Corrección**:

- `entity: "PendingAuthenticatedContactDetails"` en
  `purgePendingAuthenticatedContactDetailsWithinTx` (repository.ts).
- `RAW_VALUE_VALIDATORS["PendingAuthenticatedContactDetails.status"]`
  (`packages/contracts/src/audit.ts`) — nuevo, mismo dominio
  (`PENDING_GUEST_IDENTITY_STATUSES`) que `PendingGuestIdentity.status`,
  pero entidad propia a efectos de auditoría.

**Verificado**: invitado audita `PendingGuestIdentity.status`
(`purgePendingGuestIdentityWithinTx`, sin cambios); autenticado audita
`PendingAuthenticatedContactDetails.status`; ninguna auditoría del módulo
de reservas contiene datos cifrados, `candidateContactIds`, nombres, correo
ni teléfono — sin cambios respecto a la política ya vigente (nunca se pasó
PII a `recordRawBookingAuditEvent` en ningún punto de este módulo, solo
enums de estado e IDs opacos).

## 8. Ensayo OCC en EspoCRM desechable

**No ejecutado en esta entrega** — ver nota de apertura y §12. El guard
(`GuardMeetingDecisionTransition.php`/`MeetingDecisionTransitionPolicy.php`/
`EstadoReservaStatusMap.php`, `extensions/espocrm/custom/...`) y su arnés
de lógica pura (`MeetingHooksPureLogicTest.php`) siguen exactamente como
quedaron en la revisión 2 — sin cambios, sin desplegar.

## 9. Migraciones

Migración nueva — `apps/web/drizzle/booking/migrations/0004_blue_lyja.sql`
(generada con `drizzle-kit generate`, nunca escrita a mano):

```sql
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'MeetingIncompatibleDuringResume' BEFORE 'AccountRegistered';
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'ContactReviewReplaced' BEFORE 'AccountRegistered';
ALTER TYPE "public"."booking_review_conflict_type" ADD VALUE 'meeting_incompatible';
ALTER TYPE "public"."booking_review_status" ADD VALUE 'processing' BEFORE 'resolved';
ALTER TYPE "public"."booking_review_status" ADD VALUE 'replaced';
ALTER TABLE "booking_review_records" ADD COLUMN "claim_token" uuid;
ALTER TABLE "booking_review_records" ADD COLUMN "claimed_at" timestamp with time zone;
ALTER TABLE "booking_review_records" ADD COLUMN "lease_expires_at" timestamp with time zone;
CREATE INDEX "booking_review_records_status_lease_expires_at_idx" ON "booking_review_records" USING btree ("status","lease_expires_at");
CREATE UNIQUE INDEX "booking_review_records_active_booking_request_id_key" ON "booking_review_records" USING btree ("booking_request_id") WHERE "booking_review_records"."status" IN ('pending', 'processing');
```

**Verificado dos veces, contra `gapssa_booking_migtest` efímera (creada y
destruida solo para esta comprobación, nunca `gapssa_booking` real)**:

1. Cada ejecución de `npm run test:integration` recrea
   `gapssa_booking_test_<random>` desde cero y aplica las 5 migraciones
   antes de arrancar el servidor de pruebas — **241/241 pruebas en verde**
   (25 ficheros, ver §10).
2. Comprobación aislada adicional: primera aplicación sobre base vacía
   (`gapssa_booking: migraciones aplicadas.`) + segunda aplicación
   inmediata sobre la base ya migrada (mismo mensaje, drizzle-kit rastrea
   qué migraciones ya se aplicaron — ningún cambio de esquema en la
   segunda pasada). Esquema resultante inspeccionado (`\d
   booking_review_records`, `enum_range` de `booking_review_status`) —
   coincide exactamente con el diseño de §1/§2.

## 10. Pruebas y resultados exactos

| Comando | Resultado |
|---|---|
| `npm run typecheck` (raíz, todos los workspaces) | limpio |
| `npm run lint -w @gapssa/web` | limpio, 0 errores/avisos |
| `npm run test -w @gapssa/contracts` | **98/98** (node:test) |
| `npx vitest run` (`apps/web`, unitarias) | **704/704**, 36 ficheros — incluye `env.test.ts` extendido (+4 pruebas: `BOOKING_CONTACT_REVIEW_HOLD_HOURS` por defecto/override/tope) |
| `npm run test:integration` (raíz) | **241/241**, 25 ficheros — incluye 12 pruebas nuevas (`booking.reviewTransactional.int.test.ts`), 208+ ya existentes sin cambios de comportamiento |
| `npm run build` (`next build`, Turbopack) | compila limpio; `internal/reviews/[id]` (nuevo) en el manifiesto de rutas junto a los 3 endpoints ya existentes |
| `npx playwright test` (`test:e2e`) | **43/43** — sin cambios de comportamiento visible (endpoints tocados son `internal/**`, nunca alcanzados por la UI) |
| `docker compose config` | válido (código de salida 0) |
| Migraciones desde base vacía + reaplicación segura | verificado (§9) |
| `/api/health`/`/api/health/live` | no se relanzó un `next dev` real aparte para esta comprobación puntual — el arranque exitoso del servidor real dentro de `npm run test:integration` (25 ficheros, incluye un `next dev` completo por fichero contra las 3 bases efímeras) ya demuestra que la aplicación arranca sana con todos los cambios de esta revisión; mismo criterio que revisiones anteriores |
| **Ningún acceso a EspoCRM real durante las suites** | verificado por inspección — ninguna suite define `ESPO_BOOKING_ADAPTER=http`; el adaptador simulado (`SimulatedEspoBookingAdapter`) sigue intacto |

**Pruebas nuevas exactas** (`tests/integration/booking.reviewTransactional.int.test.ts`,
12 pruebas, contra el adaptador simulado):

- Punto 1: dos verificaciones concurrentes del mismo invitado ambiguo → UNA
  sola revisión activa.
- Punto 7: `expiresAt` ≈ createdAt + 5h.
- Punto 5: detalle expone candidatos, listado no; paginación; 404 en id
  inexistente.
- Punto 4: formato inválido (400); id inexistente en EspoCRM (409); id real
  pero ajeno a los candidatos (409) — 3 pruebas.
- Punto 2: revisión `processing` con lease vigente → `in_progress` en
  resolve Y reject; lease vencido → reclamable de nuevo, converge.
- Punto 9: barrido recupera un claim `processing` con lease vencido
  (`recoveredStaleReviewClaims`), la revisión vuelve a `pending` y es
  resoluble con normalidad.
- Punto 3: fallo inyectado en dos puntos distintos de la transacción de
  rechazo → rollback completo demostrado, reintento converge — 2 pruebas.

Más los ajustes menores en pruebas ya existentes: `verificationSteps.test.ts`
(mock de `openBookingReviewAtomic` en vez de
`transitionToContactReviewPending`+`createBookingReview`, mismas 12
pruebas, mismas aserciones de forma), `availability.test.ts` (fixture con
`getContactById`).

## 11. Lista de escrituras reales todavía pendientes

Sin cambios respecto a `docs/fase4b-integracion-http.md` §10/§14.11 — los 5
puntos siguen sin ejecutarse, ninguno se ha tocado en esta revisión:

| # | Escritura | Estado |
|---|---|---|
| 1 | Crear `Contact.cGapssaAccountId` | Sin cambios |
| 2 | Crear `Meeting.cBookingRequestId` + índice único | Sin cambios |
| 3 | Crear el API User dedicado | Sin cambios |
| 4 | Copiar los hooks PHP al contenedor + `rebuild` | Sin cambios — sigue sin desplegarse ninguno |
| 5 | Primera prueba de escritura end-to-end | Sin cambios |

**Ninguno de estos puntos se ejecuta sin tu aprobación expresa y punto por
punto** — esta revisión tampoco la sustituye.

## 12. Decisiones que debes aprobar / seguimiento

1. Los 5 puntos de escritura real de §11.
2. **Punto 8 del encargo original (ensayo OCC en EspoCRM desechable)** —
   decidiste explícitamente diferirlo a un seguimiento aparte por su coste
   de tiempo/recursos (spin-up de una pila EspoCRM+MariaDB completa,
   instalación, copia de hooks, `PUT`s concurrentes, teardown). Sigue
   pendiente, sin empezar.
3. Si existe un motivo técnico real para una ventana de revisión mayor a
   5h (§6), es una decisión de negocio que sigue sin confirmar — no se ha
   impuesto por cuenta propia.

## 13. Archivos modificados/creados

**Contratos** (`packages/contracts/src`):
- `booking.ts`: `CONTACT_REVIEW_HOLD_HOURS` = `APPROVAL_HOLD_HOURS` (5h,
  antes 72h); `BOOKING_REVIEW_CONFLICT_TYPES` +`meeting_incompatible`;
  `BOOKING_REVIEW_STATUSES` +`processing`/`replaced`;
  `BookingReconciliationReport` +`recoveredStaleReviewClaims`/`reviewInconsistencies`.
- `audit.ts`: `AUDIT_REASON_CODES`
  +`MeetingIncompatibleDuringResume`/`ContactReviewReplaced`;
  `RAW_VALUE_VALIDATORS["PendingAuthenticatedContactDetails.status"]`
  (nuevo).

**Backend** (`apps/web/src/server`):
- `booking/db/schema.ts`: `booking_review_records` +`claim_token`/
  `claimed_at`/`lease_expires_at` + índice de lease + índice único parcial
  activo.
- `booking/repository.ts`: `openBookingReviewAtomic` (sustituye
  `transitionToContactReviewPending`+`createBookingReview`),
  `claimBookingReview`, `releaseBookingReviewToPending`,
  `closeBookingReviewResolved`,
  `closeBookingReviewAndResolveRequestTransactionally` (sustituye
  `closeBookingReview` + la orquestación separada de
  rechazo/caducidad+purga), `listStaleProcessingBookingReviews`,
  `findActiveBookingReviewByBookingRequestId`, `countPendingBookingReviews`,
  `listPendingBookingReviews` (+paginación),
  `purgePendingGuestIdentityWithinTx`/`purgePendingAuthenticatedContactDetailsWithinTx`
  (nuevas, reutilizadas por el cierre transaccional),
  `listContactReviewPendingRequestsWithoutActiveReview`/
  `listOrphanedActiveBookingReviews`/`listDuplicateActiveBookingReviewGroups`
  (conciliación, punto 9).
- `booking/review.ts`: reescrito — `resolveBookingReview` con
  claim/validación/confirmación de `pending_approval` antes de cerrar;
  `rejectBookingReview`/`expireBookingReview` transaccionales;
  `validateResolutionContactId`; `getBookingReviewDetailForOperators`;
  `recoverStaleProcessingReviews`; `countReviewInconsistencies`.
- `booking/verificationSteps.ts`: `openReview` usa
  `openBookingReviewAtomic`; `CompleteBookingToMeetingOptions`
  +`replacesReviewId`; `IncompatibleMeetingError` expone
  `bookingRequestId`/`meetingId` como propiedades públicas.
- `booking/espoAdapter.ts`: `EspoBookingAdapter.getContactById` (nuevo) +
  implementación simulada.
- `booking/httpEspoAdapter.ts`: `getContactById` (reutiliza `getById` +
  `espoQuerySafety`).
- `booking/reconciliation.ts`: `recoverStaleProcessingReviews` +
  `countReviewInconsistencies` integrados en el barrido; contadores nuevos
  en el informe.
- `env.ts`: `BOOKING_CONTACT_REVIEW_HOLD_HOURS` (nuevo, tope en
  `APPROVAL_HOLD_HOURS`).

**Rutas** (`apps/web/src/app/api/booking/v1/internal/reviews`):
- `route.ts`: paginación (`limit`/`offset`/`total`).
- `[id]/route.ts` (nuevo): detalle con candidatos.
- `[id]/resolve/route.ts`: outcomes nuevos (`in_progress`,
  `invalid_contact_id_format`, `contact_not_found`,
  `contact_not_a_candidate`, `transient_failure`).
- `[id]/reject/route.ts`: outcome `in_progress`.

**Pruebas**:
- `apps/web/tests/integration/booking.reviewTransactional.int.test.ts`
  (nuevo, 12 pruebas).
- `apps/web/tests/integration/bookingDb.ts`: `findBookingReviewRowById`,
  `listBookingReviewRowsForRequest`, `forceBookingReviewProcessing`
  (nuevos helpers, solo pruebas).
- `apps/web/src/server/env.test.ts`: `FASE4B_DEFAULTS`
  +`BOOKING_CONTACT_REVIEW_HOLD_HOURS`; +2 pruebas nuevas.
- `apps/web/src/server/booking/verificationSteps.test.ts`: mock
  actualizado (`openBookingReviewAtomic`), fixture con `getContactById`.
- `apps/web/src/server/booking/availability.test.ts`: fixture con
  `getContactById`.

**Migración**: `apps/web/drizzle/booking/migrations/0004_blue_lyja.sql` (+
`meta/_journal.json`, `meta/0004_snapshot.json`, generados por
`drizzle-kit`).

**Documentación**: `docs/fase4b-revision-3.md` (este documento).

## 14. Confirmación final

- **No se ha escrito ningún registro nuevo en la instancia real de
  EspoCRM** — el adaptador simulado (`SimulatedEspoBookingAdapter`) sigue
  intacto; ninguna suite define `ESPO_BOOKING_ADAPTER=http`.
- **No se ha creado ningún campo/API User/rol/índice real** en EspoCRM.
- **No se ha desplegado ningún hook PHP** — ni los ya preparados en
  revisión 2 (`SyncEstadoReservaToStatus.php`,
  `GuardMeetingDecisionTransition.php`), ni ninguno nuevo (esta revisión no
  toca ningún fichero PHP).
- **No se ha ejecutado el ensayo OCC en EspoCRM desechable (punto 8)** —
  diferido a un seguimiento aparte, por decisión tuya explícita al inicio
  de esta revisión (§12).
- **No se ha hecho ningún commit** en ningún momento de esta revisión —
  todo el trabajo queda en el árbol de trabajo, pendiente de revisión (la
  base de comprobación de migraciones, `gapssa_booking_migtest`, fue
  efímera, creada y destruida solo para verificar; `gapssa_booking` real
  nunca se tocó).
- Los cambios existentes del árbol de trabajo previos a esta revisión
  (Fases 1-4A, Fase 4B revisión 2) se han conservado intactos — verificado
  con la suite completa de integración en verde (241/241).
