# Fase 4B — Revisión 4 (propiedad del lease y conciliación posterior al éxito)

Revisión **muy acotada** a los 5 puntos de consistencia señalados sobre la
revisión 3 de Fase 4B (`docs/fase4b-revision-3.md`), más el reloj
autoritativo y las pruebas correspondientes. **No se ha escrito ningún
registro nuevo en la instancia real de EspoCRM. No se ha creado ningún
campo/API User/rol/índice real en EspoCRM. No se ha desplegado ningún hook.
No se ha hecho ningún commit.** Todo el trabajo vive en el árbol de trabajo,
pendiente de revisión.

Complementa, no sustituye, `docs/fase4b-revision-3.md` (ni, transitivamente,
`docs/fase4b-integracion-http.md`/`docs/fase4a-reservas.md`/
`docs/fase4a-revision-3.md`).

**El ensayo OCC del guard PHP en una copia desechable de EspoCRM (punto 8 del
encargo original de Fase 4B) sigue diferido** — no se ha tocado ningún
fichero PHP en esta revisión. Sigue siendo una puerta obligatoria antes de
desplegar `GuardMeetingDecisionTransition` o de autorizar decisiones reales
(§8).

## 1. `replaces` protegido por `claimToken` — nunca solo `reviewId`

**Bug corregido**: `repository.ts::openBookingReviewAtomic` (revisión 3)
aceptaba `replacesReviewId` y marcaba `replaced` la revisión activa que
coincidía con ese id **sin comprobar en absoluto quién la tenía reclamada**.
Un worker A cuyo lease hubiera vencido (recuperado o reclamado de nuevo por
un worker B) podía, si su propia llamada a `completeBookingToMeeting` seguía
en vuelo, reemplazar la revisión de B con una revisión nueva — B perdía su
trabajo sin ningún error, y una fila que ya no era de A se modificaba con su
autorización obsoleta.

**Corrección**: `OpenBookingReviewInput.replaces` pasa de `reviewId?:
string` a `{ reviewId: string; claimToken: string }` — el reemplazo solo se
autoriza mediante un **CAS** (`UPDATE ... WHERE id = ? AND status =
'processing' AND claim_token = ? AND lease_expires_at > now()`) evaluado
contra el reloj autoritativo DE POSTGRES (§5). Si el CAS no gana ninguna
fila (id ya no es el activo, ya no `processing`, `claimToken` distinto, o
lease vencido): `outcome: 'lease_lost'`, **ninguna fila se modifica** — ni la
revisión vieja, ni `BookingRequestRecord`, ni se crea ninguna revisión
nueva.

**Propagación exacta** del `claimToken` obtenido por
`review.ts::claimBookingReview`:

```
resolveBookingReview → completeBookingToMeeting(options.replaces)
                      → verificationSteps.ts::openReview(replaces)
                      → repository.ts::openBookingReviewAtomic(input.replaces)
```

Nunca por HTTP (`resolutionContactId`/`resolvedBy` son los únicos campos del
cuerpo de la petición de `/resolve`) ni por auditoría (`recordRawBookingAuditEvent`
solo recibe `entity`/`field`/`previousValue`/`newValue`/`reasonCode`/
`actor`/`channel` — el `claimToken` nunca llega a esa función).

**`ReviewLeaseLostError`** (`verificationSteps.ts`, nueva) — lanzada por
`openReview` cuando `openBookingReviewAtomic` devuelve `lease_lost` durante
una reanudación que topa con OTRO conflicto (`meeting_contact_missing/
mismatch/multiple`, `meeting_duplicate`). `resolveBookingReview` la captura
por separado del resto de errores transitorios: **nunca** llama a
`releaseBookingReviewToPending` en este caso — ya no hay nada que liberar
(sería un no-op seguro contra el mismo CAS, pero además engañoso: podría
sugerir que esta llamada seguía siendo propietaria de algo). Devuelve
`{ outcome: 'review_lease_lost' }`, mapeado a `409 review_lease_lost` en
`resolve/route.ts`.

El caso `IncompatibleMeetingError` (Meeting encontrado ya no compatible en
horario/tratamiento/profesional/zona) usa el mismo `replaces` y comprueba
explícitamente el outcome de `openBookingReviewAtomic` — antes lo ignoraba
por completo.

## 2. Barrido cierra revisiones huérfanas tras un resultado durable de éxito

Ventana real e inevitable: `completeBookingToMeeting` escribe
`meetingId`/`pending_approval` (`writeMeetingIdAndPendingApproval`) y purga
la PII (`purgePendingGuestIdentity`/`purgePendingAuthenticatedContactDetails`)
en **dos llamadas separadas, cada una su propia transacción** — nunca una
transacción distribuida con EspoCRM. Si el proceso cae o pierde el lease
entre ese resultado durable y `resolveBookingReview::closeBookingReviewResolved`,
la revisión queda activa indefinidamente aunque el resultado real ya sea
correcto.

**`repository.ts::listActiveBookingReviewsForLinkedRequests`** — revisiones
activas (`pending`/`processing`) cuya `BookingRequestRecord` tiene
`meetingId` escrito Y `status` en `pending_approval` o `resolved`.

**`repository.ts::closeOrphanedBookingReviewAfterLinkedRequest`** — CAS puro,
sin exigir ningún `claimToken` (el barrido no es su propietario):

- `pending` → cierre directo.
- `processing` con lease **vencido** (reloj de Postgres) → se recupera y
  cierra en la misma operación.
- `processing` con lease **vigente** → `skipped_active_lease`, nunca se le
  arrebata la fila a un worker activo.

Nunca vuelve a elegir Contact, nunca llama a `findOrCreateContact`, nunca
crea otro Meeting, nunca requiere que la PII ya esté purgada — el resultado
durable YA demuestra que el flujo terminó; esto es bookkeeping puro de
`BookingReviewRecord` (`status → 'resolved'`, `resolvedBy`/
`resolutionContactId` quedan `null` — nunca se inventa qué operador o qué
Contact "decidió" esto). Auditado con el reasonCode nuevo cerrado
`ContactReviewReconciledAfterBookingLinked`.

**`review.ts::reconcileReviewsForLinkedBookings`** orquesta lista + cierre;
integrado en `reconciliation.ts::runBookingReconciliationSweep` ANTES de
`countReviewInconsistencies` (para que lo reconciliado aquí no se cuente
también como huérfano). Contador nuevo:
`BookingReconciliationReport.reconciledCompletedReviews`.

## 3. `lease_lost` tras el cierre nunca es éxito ciego

**Bug corregido**: `resolveBookingReview` (revisión 3) trataba
`closeBookingReviewResolved(...) === 'lease_lost'` exactamente igual que
`'closed'` — asumía sin comprobar que "otro worker ya lo cerró", cuando en
realidad podía seguir `pending`/`processing` bajo otro propietario legítimo
(sin ningún cierre real todavía).

**Corrección**: tras `lease_lost`, se relee `BookingReviewRecord`
(`findBookingReviewById`) antes de decidir:

- `resolved`/`replaced` → éxito real (`{ outcome: 'resolved', meetingId }`) —
  compatible con un cierre/reemplazo legítimo de otro propietario mientras
  esta llamada terminaba.
- `pending`/`processing`/`rejected`/`expired`/inexistente-imposible → **nunca**
  se afirma que la revisión está resuelta: `{ outcome:
  'resolved_review_reconciliation_pending', meetingId }`.

En ambos casos la reserva en sí YA es un éxito real (el Meeting se creó y
`BookingRequestRecord` confirmó `pending_approval` **antes** de este punto,
requisito ya vigente desde la revisión 3) — la diferencia es exclusivamente
si el bookkeeping de la revisión quedó también confirmado o si queda
pendiente de conciliación (§2). `resolve/route.ts` responde `200 {status:
"resolved", meetingId, reviewReconciliationPending: true}` en el segundo
caso — nunca un error para el operador, la reserva es real.

## 4. Purga segura de PII heredada en solicitudes ya resueltas

**Bug corregido**: `repository.ts::closeBookingReviewAndResolveRequestTransactionally`
(rechazo/caducidad transaccional, revisión 3), cuando
`resolveBookingRequestWithinTx` devolvía `already_resolved` (la solicitud ya
estaba `resolved` por otra vía), asumía sin comprobar que la PII ya se había
purgado y devolvía `'closed'` sin más.

**Corrección**: dentro de la MISMA transacción, se relee el estado real de
`BookingRequestRecord` (`status`/`resolution`/`meetingId`/`clientAccountId`)
y se decide el disparador de purga con la MISMA función pura ya usada en el
resto del módulo — `decidePendingGuestIdentityPurgeTrigger`
(`packages/contracts/src/booking.ts`) — nunca una regla nueva ad-hoc:

- `meetingId` no nulo → `meeting_linked` (pase lo que pase con la resolución
  final).
- `resolved` + `resolution` en `{verification_expired,
  contact_review_rejected, contact_review_expired}` → el disparador que
  corresponde exactamente a esa resolución REAL — nunca el que el llamante
  (rechazo/caducidad de la revisión) pedía.
- Cualquier otra combinación → `null`: no se purga, se deja para el barrido
  (abajo).

Purga idempotente (`purgePending*WithinTx` ya no-opea si la fila no está
`active`), así que es seguro llamarla aunque la purga real ya hubiera
ocurrido por otra vía.

**Barrido complementario** — `repository.ts::listRequestsWithOrphanedActivePii`
+ `review.ts::reconcileOrphanedPendingPii`: mismo criterio
(`decidePendingGuestIdentityPurgeTrigger`) aplicado a TODAS las solicitudes
con `meetingId` no nulo o `status = 'resolved'` cuya PII sigue `active` —
cubre la ventana entre `writeMeetingIdAndPendingApproval` y la purga (dos
escrituras separadas, §2) igual que cualquier resolución heredada de una vía
ajena a este módulo. Integrado en el barrido; los disparadores exitosos se
suman a `purgedGuestIdentities` (mismo contador que el resto del módulo,
nunca uno nuevo paralelo); lo indeterminable cuenta en el contador nuevo
`orphanedPiiInconsistencies` — **nunca se purga a ciegas**.

## 5. Reloj autoritativo

Las dos comprobaciones de lease nuevas de esta revisión usan `now()` DE
POSTGRES en el propio `WHERE`/CAS, nunca un `Date` de Node capturado antes:

- `openBookingReviewAtomic`: `gt(bookingReviewRecords.leaseExpiresAt,
  sql\`now()\`)` en el `UPDATE` de reemplazo.
- `closeOrphanedBookingReviewAfterLinkedRequest`: `lt(bookingReviewRecords.leaseExpiresAt,
  sql\`now()\`)` en la rama de recuperación de un `processing` abandonado.

Mismo principio ya establecido en `linkOtpChallengeIfPending` (revisión 3 de
Fase 4A). El `now: Date` que sigue recibiendo `openBookingReviewAtomic` como
parámetro se seguirá usando SOLO para timestamps informativos
(`resolvedAt`, `expiresAt` de la revisión nueva) — nunca para decidir
propiedad del lease.

## 6. Migraciones

Migración nueva — `apps/web/drizzle/booking/migrations/0005_useful_frightful_four.sql`
(generada con `drizzle-kit generate`, nunca escrita a mano):

```sql
ALTER TYPE "public"."booking_audit_reason_code" ADD VALUE 'ContactReviewReconciledAfterBookingLinked' BEFORE 'AccountRegistered';
```

Único cambio de esquema de esta revisión — el resto de los puntos son de
lógica de aplicación (nuevas funciones de `repository.ts`/`review.ts`,
nuevos campos en memoria de `BookingReconciliationReport`), sin nuevas
columnas ni índices.

**Verificado contra una base efímera** (`gapssa_booking_migtest_rev4`,
creada y destruida solo para esta comprobación — `gapssa_booking` real nunca
se tocó):

1. Primera aplicación sobre base vacía → `gapssa_booking: migraciones
   aplicadas.`
2. Segunda aplicación inmediata sobre la base ya migrada → mismo mensaje,
   ningún cambio de esquema en la segunda pasada (drizzle-kit rastrea qué
   migraciones ya se aplicaron).
3. `enum_range(NULL::booking_audit_reason_code)` inspeccionado — incluye
   `ContactReviewReconciledAfterBookingLinked`.

Además, cada ejecución de `npm run test:integration` recrea
`gapssa_booking_test_<random>` desde cero y aplica las 6 migraciones antes
de arrancar el servidor de pruebas — **251/251 pruebas en verde** (26
ficheros).

## 7. Pruebas y resultados exactos

| Comando | Resultado |
|---|---|
| `npm run typecheck` (raíz, todos los workspaces) | limpio |
| `npm run lint -w @gapssa/web` | limpio, 0 errores/avisos |
| `npx vitest run` (`apps/web`, unitarias) | **713/713**, 37 ficheros — incluye `review.test.ts` (nuevo, 9 pruebas) |
| `npm run test:integration` (raíz) | **251/251**, 26 ficheros — incluye `booking.reviewReconciliation.int.test.ts` (nuevo, 10 pruebas), 241 ya existentes sin cambios de comportamiento |
| `npm run build` (`next build`, Turbopack) | compila limpio; mismos endpoints `internal/reviews/**`/`internal/sweep` en el manifiesto de rutas |
| `npx playwright test` (`test:e2e`) | **43/43** — sin cambios de comportamiento visible (endpoints tocados son `internal/**`, nunca alcanzados por la UI) |
| `docker compose config` | válido (código de salida 0) |
| Migraciones desde base vacía + reaplicación segura | verificado (§6) |
| `php -l` sobre los 6 ficheros PHP existentes (`RecordHooks/Meeting/*.php`) | sin errores de sintaxis — ningún fichero PHP se tocó en esta revisión |
| **Ningún acceso a EspoCRM real durante las suites** | verificado por inspección — ninguna suite define `ESPO_BOOKING_ADAPTER=http`; el adaptador simulado sigue intacto |

**Pruebas nuevas exactas**:

- `src/server/booking/review.test.ts` (nuevo, 9 pruebas, mocks puros —
  `resolveBookingReview` sin Postgres real): punto 3 — `lease_lost` en el
  cierre + revisión releída `resolved`/`replaced`/`processing` bajo otro
  dueño/`closed` directo (4 pruebas); punto 1 — `IncompatibleMeetingError` +
  `openBookingReviewAtomic` `lease_lost` (nunca libera un claim ajeno),
  reemplazo válido, `ReviewLeaseLostError` propagada, propagación exacta del
  `claimToken` a `completeBookingToMeeting`, fallo transitorio genérico
  sigue liberando el claim (5 pruebas).
- `tests/integration/booking.reviewReconciliation.int.test.ts` (nuevo, 10
  pruebas, contra Postgres real + adaptador simulado):
  - Punto 1 (CAS contra Postgres real, reproduciendo el `WHERE` exacto —
    mismo principio que `attemptGuestVerificationOtpJobCompleteWithToken`/
    `attemptLinkOtpChallenge` ya establecido en la suite, necesario porque el
    servidor bajo prueba es un proceso `next dev` aparte sin memoria
    compartida, así que no se puede pausar una reanudación real a mitad de
    camino): token+lease vigentes → reemplaza; token OBSOLETO (otro worker ya
    reclamó con uno nuevo) → `lease_lost`, la revisión ajena no se toca;
    token correcto pero lease vencido → `lease_lost` (3 pruebas).
  - Punto 1 (end-to-end HTTP real, sin mocks): una reanudación real topa con
    un conflicto `meeting_contact_mismatch` genuino (Meeting ya vinculado a
    un Contact ajeno) y reemplaza atómicamente la revisión original con su
    propio `claimToken` vigente — revisión vieja `replaced`, exactamente una
    activa, solicitud sigue `contact_review_pending`, auditoría sin PII ni
    `claimToken` (1 prueba).
  - Punto 2: crash entre `pending_approval` y el cierre de la revisión (PII
    todavía activa) → el barrido resuelve la revisión Y purga la PII en la
    misma pasada, ninguna revisión activa queda tras el Meeting vinculado;
    crash tras la decisión final (`resolved`) → el barrido cierra la
    revisión igualmente, sin exigir que la PII ya esté purgada; `processing`
    con lease vigente → nunca se arrebata a un worker activo aunque el
    Meeting ya esté vinculado; barridos concurrentes → convergen, nunca
    duplica el cierre ni la auditoría (4 pruebas).
  - Punto 4: solicitud `resolved` heredada (`contact_review_rejected`) con
    PII activa y sin revisión vinculada a un Meeting → el barrido la purga
    con el disparador real, auditada en `PendingGuestIdentity`; rechazo
    manual de una revisión cuya solicitud YA estaba `resolved` por otra vía
    (`verification_expired`) → la revisión se cierra igualmente, la
    resolución REAL nunca se sobrescribe, la PII se purga con el disparador
    que corresponde al estado real (nunca al que el rechazo pedía) (2
    pruebas).

Más los ajustes menores de propagación en pruebas ya existentes:
`verificationSteps.test.ts` no requirió cambios (usa
`expect.objectContaining`, no afectado por el campo `replaces` nuevo).

## 8. Lista de puertas pendientes antes de la primera escritura real

Sin cambios respecto a `docs/fase4b-revision-3.md` §11/§12 — los 5 puntos de
escritura real siguen sin ejecutarse, ninguno se ha tocado en esta revisión:

| # | Puerta | Estado |
|---|---|---|
| 1 | Crear `Contact.cGapssaAccountId` (EspoCRM real) | Sin cambios |
| 2 | Crear `Meeting.cBookingRequestId` + índice único (EspoCRM real) | Sin cambios |
| 3 | Crear el API User dedicado (EspoCRM real) | Sin cambios |
| 4 | Copiar los hooks PHP al contenedor + `rebuild` | Sin cambios — sigue sin desplegarse ninguno |
| 5 | **Ensayo OCC del guard PHP en una copia desechable de EspoCRM** (punto 8 del encargo original) | Sin cambios — sigue diferido, sin empezar |
| 6 | Primera prueba de escritura end-to-end contra EspoCRM real | Sin cambios |

**Ninguno de estos puntos se ejecuta sin tu aprobación expresa y punto por
punto** — esta revisión tampoco la sustituye.

## 9. Archivos modificados/creados

**Contratos** (`packages/contracts/src`):
- `audit.ts`: `AUDIT_REASON_CODES` +`ContactReviewReconciledAfterBookingLinked`.
- `booking.ts`: `BookingReconciliationReport`
  +`reconciledCompletedReviews`/`orphanedPiiInconsistencies`.

**Backend** (`apps/web/src/server`):
- `booking/repository.ts`: `openBookingReviewAtomic` (`replaces` con
  `claimToken`, CAS con reloj de Postgres, outcome `lease_lost`),
  `closeBookingReviewAndResolveRequestTransactionally` (purga segura tras
  `already_resolved`), `listActiveBookingReviewsForLinkedRequests` +
  `closeOrphanedBookingReviewAfterLinkedRequest` (nuevas, punto 2),
  `listRequestsWithOrphanedActivePii` (nueva, punto 4).
- `booking/review.ts`: `resolveBookingReview` (propaga `replaces` con
  `claimToken`, captura `ReviewLeaseLostError`, relee tras `lease_lost` en
  el cierre — outcomes nuevos `review_lease_lost`/
  `resolved_review_reconciliation_pending`), `reconcileReviewsForLinkedBookings`
  + `reconcileOrphanedPendingPii` (nuevas).
- `booking/verificationSteps.ts`: `ReviewLeaseLostError` (nueva);
  `CompleteBookingToMeetingOptions.replaces`/`openReview` propagan
  `{reviewId, claimToken}` en vez de solo `replacesReviewId`.
- `booking/reconciliation.ts`: integra `reconcileReviewsForLinkedBookings` +
  `reconcileOrphanedPendingPii` en `runBookingReconciliationSweep`, antes de
  `countReviewInconsistencies`.

**Rutas** (`apps/web/src/app/api/booking/v1/internal/reviews/[id]/resolve`):
- `route.ts`: outcomes nuevos `review_lease_lost` (409) y
  `resolved_review_reconciliation_pending` (200, `reviewReconciliationPending: true`).

**Pruebas**:
- `apps/web/src/server/booking/review.test.ts` (nuevo, 9 pruebas, mocks).
- `apps/web/tests/integration/booking.reviewReconciliation.int.test.ts`
  (nuevo, 10 pruebas).
- `apps/web/tests/integration/bookingDb.ts`:
  `attemptReplaceBookingReviewWithToken`, `insertSimEspoMeetingForTesting`,
  `forceBookingRequestLinkedForTesting`, `forceBookingRequestResolvedForTesting`
  (nuevos helpers, solo pruebas).

**Migración**: `apps/web/drizzle/booking/migrations/0005_useful_frightful_four.sql`
(+ `meta/_journal.json`, `meta/0005_snapshot.json`, generados por
`drizzle-kit`).

**Documentación**: `docs/fase4b-revision-4.md` (este documento).

## 10. Confirmación final

- **No se ha escrito ningún registro nuevo en la instancia real de
  EspoCRM** — el adaptador simulado sigue intacto; ninguna suite define
  `ESPO_BOOKING_ADAPTER=http`.
- **No se ha creado ningún campo/API User/rol/índice real** en EspoCRM.
- **No se ha desplegado ningún hook PHP** — ningún fichero `.php` se ha
  tocado en esta revisión (verificado con `php -l`, sin cambios de
  contenido respecto a la revisión 2).
- **No se ha ejecutado el ensayo OCC en EspoCRM desechable (punto 8)** —
  sigue diferido, sin empezar.
- **No se ha hecho ningún commit** en ningún momento de esta revisión —
  todo el trabajo queda en el árbol de trabajo, pendiente de revisión (la
  base de comprobación de migraciones, `gapssa_booking_migtest_rev4`, fue
  efímera, creada y destruida solo para verificar; `gapssa_booking` real
  nunca se tocó).
- Los cambios existentes del árbol de trabajo previos a esta revisión
  (Fases 1-4A, Fase 4B revisiones 2-3) se han conservado intactos —
  verificado con la suite completa de integración en verde (251/251).
