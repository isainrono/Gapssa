# Fase 4A — Revisión 3 (outbox OTP + sesgo de `maxSlotsPerQuery`)

Revisión 3, pequeña y limitada al alcance pedido: leases seguros del
outbox de OTP de invitado (`booking_outbox_jobs`), disparador durable del
barrido, cierre de solicitudes caducadas antes de enviar, y sesgo de orden
de profesionales en `computeAvailability`. Redactada tras la revisión 2
(bloqueos de disponibilidad, PII/idempotencia, auditoría y reconciliación,
ya cerrados). **No se ha avanzado a EspoCRM real, cancelaciones, pagos,
FacturaScripts, WhatsApp ni Fase 5. No se ha hecho ningún commit.**

Complementa, no sustituye, `docs/fase4a-reservas.md` (Fase 4A original) ni
`docs/contratos-portal-v1.md`.

## 1. Modelo final del lease

`booking_outbox_jobs` gana tres columnas nuevas (migración
`0002_revision3_outbox_lease.sql`):

- `claim_token uuid` — token aleatorio (`crypto.randomUUID()`) generado en
  cada reclamo ganado. Identifica sin ambigüedad al worker que posee la
  fila mientras está `processing`. `null` salvo durante `processing`.
- `claimed_at timestamptz` — cuándo se generó ese token.
- `lease_expires_at timestamptz` — hasta cuándo es válido ese reclamo; un
  job `processing` cuyo lease venció se trata como abandonado y vuelve a
  ser reclamable por cualquier worker (dirigido o de barrido).

`claimGuestVerificationOtpJob` (`repository.ts`) es un único
`UPDATE ... WHERE ... RETURNING` — nunca mantiene una transacción de
Postgres abierta mientras se llama a Redis/SMTP. Elegibilidad exacta:

| Estado actual | Reclamable si |
|---|---|
| `pending` | siempre |
| `failed_retryable` | `next_attempt_at <= now()` |
| `processing` | `lease_expires_at < now()` |
| `completed` | nunca |

`markGuestVerificationOtpJobCompleted`/`...FailedRetryable` solo escriben
mediante `id = jobId AND status = 'processing' AND claim_token = claimToken`
— el mismo predicado que decide el reclamo. Devuelven `'updated'` o
`'lease_lost'` (nunca lanzan una excepción por perder el lease: ver §4). Un
worker cuyo lease fue recuperado por otro nunca puede modificar la fila,
tanto para `completed` como para `failed_retryable` — verificado
directamente contra Postgres real en
`tests/integration/booking.outboxLease.int.test.ts` (§8).

## 2. Semántica exacta de `attempts`, `nextAttemptAt` y `leaseExpiresAt`

- **`attempts`**: cuenta ÚNICAMENTE intentos de ENTREGA FALLIDOS
  confirmados. Se incrementa exclusivamente en
  `markGuestVerificationOtpJobFailedRetryable`; ningún otro camino
  (reclamo, éxito) la toca. Semántica única y documentada en el propio
  esquema (`db/schema.ts`) — nunca se mezcla con "número de reclamos".
- **`nextAttemptAt`**: cuándo vuelve a ser elegible un job
  `failed_retryable` — fijado a `now + 5 min`
  (`OUTBOX_RETRY_BACKOFF_MINUTES`) en cada fallo. El reclamo (dirigido y de
  barrido) exige `nextAttemptAt <= now`, nunca antes. Se limpia (`null`) al
  completar.
- **`leaseExpiresAt`**: fijado a `now + 2 min` (`LEASE_DURATION_MINUTES`)
  en cada reclamo ganado; se limpia (`null`) al completar o al fallar. Rige
  únicamente la recuperación de un `processing` abandonado.

No queda ninguna columna/constante sin efecto real: `nextAttemptAt` ya no
está "reservado para un futuro runner" (comentario retirado del esquema) —
tanto el reclamo dirigido como el disparador de barrido lo consultan hoy.

## 3. Cómo se recuperan jobs sin que el cliente repita `POST /requests`

Dos caminos, independientes:

1. **Replay idempotente** (sin cambios de mecanismo, corregido en punto 3
   del encargo): `guestFlow.ts` ya NO comprueba
   `hasPendingGuestVerificationOtpJob` (eliminada — tenía una definición
   más estrecha que el propio reclamo: nunca sabía de un `processing`
   abandonado) antes de invocar `processGuestVerificationOtpJob`. Llama
   directamente; el reclamo atómico decide por sí solo si hay trabajo
   elegible (`'no_eligible_job'` si no lo hay, barato y no-op).
2. **Disparador durable del barrido** (nuevo, punto 4):
   `reconciliation.ts::sweepOutboxJobs`, integrado como primer paso de
   `runBookingReconciliationSweep` (`POST /internal/sweep`, protegido por
   `X-Internal-Api-Secret`, sin cambios de protección). Lista hasta 25
   candidatos elegibles (`repository.ts::listEligibleGuestVerificationOtpJobs`
   — `SELECT` simple, sin bloqueo de filas) y reclama cada uno por
   separado con la MISMA operación atómica mono-fila que el camino
   dirigido; ningún `SELECT ... FOR UPDATE SKIP LOCKED` explícito hace
   falta porque el `UPDATE ... WHERE ...` ya es, por sí mismo, la
   serialización atómica (documentado en `repository.ts`). Un fallo al
   procesar un candidato no aborta el resto del lote (`try`/`catch` por
   candidato). Nunca mantiene una transacción abierta durante Redis/SMTP.

   `BookingReconciliationReport.outboxJobs` reporta `sent`, `retryable`,
   `notProcessable` y `abandonedRecovered` (este último, señal adicional
   sobre cuántos de los anteriores partían de un `processing` abandonado —
   nunca una partición aparte a sumar).

   **Sin cron real del VPS todavía** (decisión operativa explícita
   pendiente antes de producción, ya recogida en `docs/fase4a-reservas.md`
   §9). Documentado en `reconciliation.ts`: comando/endpoint
   `POST /api/booking/v1/internal/sweep`, frecuencia recomendada 1-2
   minutos cuando se programe (coherente con el lease de 2 min y el
   backoff de 5 min — un intervalo más corto no gana nada, uno mucho más
   largo retrasa la recuperación).

Verificado en `booking.outboxLease.int.test.ts`: un job `processing` con
lease vencido se recupera y envía el correo llamando ÚNICAMENTE a
`POST /internal/sweep`, sin ningún `POST /requests` adicional.

## 4. Comportamiento ante SMTP incierto

Sin cambios de postura respecto a la revisión 2, documentado ahora también
en el esquema (`db/schema.ts`) y en `otpOutbox.ts`: **no existe
"exactly-once" sobre SMTP**. Un reintento tras un fallo incierto (el
proceso cae justo después de que SMTP aceptara el mensaje pero antes de
marcar `completed`) puede reenviar un SEGUNDO correo con un código nuevo —
seguro porque `requestOtp` invalida el reto anterior antes de publicar el
nuevo puntero (nunca coexisten dos códigos vivos).

El lease de esta revisión resuelve un problema DISTINTO: evita que dos
workers se pisen el BOOKKEEPING del mismo job (`completed`/`failed_retryable`
escritos por el worker equivocado). Si `markGuestVerificationOtpJobCompleted`
devuelve `'lease_lost'` (otro worker ya recuperó el lease), `otpOutbox.ts`
nunca lo trata como error: el correo, si se envió, ya salió; el nuevo
propietario decide el destino final de la fila. Un fallo genuino e
inesperado de Postgres justo en esa escritura (no un `'lease_lost'`, una
excepción real) SÍ se propaga — nunca se convierte en un éxito o pérdida
silenciosos (cubierto en `otpOutbox.test.ts`).

## 5. Política para evitar códigos enviados tras caducidad

`processGuestVerificationOtpJob` (`otpOutbox.ts`) añade una comprobación
ANTES de crear/rotar el reto OTP: `BookingRequestRecord` debe seguir
`pending_verification` y `verificationExpiresAt > now`; si no, el job se
cierra `completed` sin enviar (`'expired'`) — nunca se decripta la
identidad ni se llama a Redis/SMTP para nada.

Esa comprobación previa es solo la salida rápida. La comprobación
AUTORITATIVA y libre de carreras es `linkOtpChallengeIfPending`
(`repository.ts`), reescrita como transición CAS atómica única en Postgres:
`UPDATE booking_request_records SET otp_challenge_id = ... WHERE id = ...
AND status = 'pending_verification' AND verification_expires_at > now()`.
Vincular el reto y validar estado/plazo son la MISMA operación de
Postgres — ninguna solicitud puede caducar en el hueco entre "se comprobó"
y "se vinculó". Si el CAS no gana, el job se cierra `completed` sin enviar;
el reto ya creado en Redis (si llegó a crearse) queda huérfano y seguro
(nunca se envía).

## 6. Política neutral de orden de profesionales

`computeAvailability` (`availability.ts`) recorre, para cada horario
candidato, la lista de profesionales activas en el mismo orden y corta en
`maxSlotsPerQuery` — un orden fijo por id (única regla antes de esta
revisión) sesgaba sistemáticamente: si el tope cortaba a mitad de la franja
horaria más temprana (caso típico cuando el número de profesionales activas
≥ tope), las de id "menor" ocupaban SIEMPRE las primeras posiciones, sin
importar la fecha consultada.

**Política elegida: rotación determinista basada en la fecha consultada**
(`rotateProfessionalsForDate`, una de las opciones aceptadas por el
encargo). Desplazamiento = número ordinal de días UTC de la fecha
consultada (`Date.UTC(year, month-1, day) / MS_PER_DAY`, nunca `now`) módulo
el número de profesionales activas, aplicado sobre la lista ya ordenada por
id. Determinista para una fecha dada (dos consultas al mismo día devuelven
el mismo orden — nunca aleatorio), pero quién ocupa la primera posición
cambia de un día a otro, así que ninguna profesional monopoliza
sistemáticamente el resultado a lo largo de varias fechas. Documentada en
el propio código (`availability.ts`).

## 7. Migraciones

Una migración nueva, `apps/web/drizzle/booking/migrations/0002_revision3_outbox_lease.sql`:

```sql
DROP INDEX "booking_outbox_jobs_status_idx";
ALTER TABLE "booking_outbox_jobs" ADD COLUMN "claim_token" uuid;
ALTER TABLE "booking_outbox_jobs" ADD COLUMN "claimed_at" timestamp with time zone;
ALTER TABLE "booking_outbox_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;
CREATE INDEX "booking_outbox_jobs_status_next_attempt_at_idx" ON "booking_outbox_jobs" USING btree ("status","next_attempt_at");
CREATE INDEX "booking_outbox_jobs_status_lease_expires_at_idx" ON "booking_outbox_jobs" USING btree ("status","lease_expires_at");
```

El índice `status_idx` (solo `status`) se retira por redundante: ambos
índices compuestos nuevos empiezan por `status` y cubren igual de bien el
predicado `status = 'pending'` sin componente temporal.

**Verificado** contra una base `gapssa_booking_migtest_<random>` efímera
(creada y destruida solo para esta comprobación, nunca `gapssa_booking`
real): migraciones aplicadas desde vacío (`booking:db:migrate`), reaplicadas
una segunda vez de forma idempotente (cero cambios), y esquema resultante
inspeccionado (`\d booking_outbox_jobs`) — columnas e índices coinciden
exactamente con el diseño de arriba.

## 8. Pruebas nuevas y resultados exactos

- **`apps/web/src/server/booking/otpOutbox.test.ts`** (unitarias, Vitest,
  reescrito): 15 pruebas — cubren `no_eligible_job` (claim vacío),
  `expired` (registro inexistente, estado avanzado, plazo vencido —
  comprobado ANTES de tocar Redis/SMTP), identidad purgada, fallo de
  emisión OTP, `rate_limited`, CAS de `linkOtpChallengeIfPending` perdido,
  fallo SMTP, ausencia de OTP en claro en cualquier llamada, camino feliz
  con `claimToken` exacto, fallo incierto tras envío (propaga), y DOS
  pruebas nuevas de `'lease_lost'` (tras enviar con éxito / tras registrar
  un fallo) que nunca lanzan excepción.
- **`apps/web/src/server/booking/availability.test.ts`** (extendido): +1
  prueba — `maxSlotsPerQuery` menor que el total de alternativas, recorrido
  de 6 fechas consecutivas, exactamente 1 slot cada vez, mismo resultado
  ante repetición de la MISMA fecha (determinismo), y al menos dos
  profesionales distintas ganan a lo largo del rango (no monopolio).
- **`apps/web/tests/integration/booking.outboxLease.int.test.ts`** (nuevo,
  9 pruebas, contra Postgres real de la suite de integración): `failed_retryable`
  antes/después de `nextAttemptAt`; `processing` con lease fresco (no
  reclamable) / vencido (recuperado, `abandonedRecovered >= 1`, sin repetir
  `POST /requests`); dos barridos concurrentes nunca procesan el mismo job
  dos veces; un `claimToken` obsoleto nunca puede escribir `completed` ni
  `failed_retryable` una vez que otro worker tiene el lease vigente (CAS
  verificado contra Postgres real); una solicitud caducada o ya resuelta
  cierra el job sin crear un reto nuevo ni enviar correo.
- **`apps/web/tests/integration/bookingDb.ts`**: 5 helpers nuevos, solo
  para pruebas (`forceGuestVerificationOtpJobProcessing`/`...FailedRetryable`,
  `attemptGuestVerificationOtpJobCompleteWithToken`/`...FailRetryableWithToken`).

Resultados exactos de esta revisión (raíz del monorepo, todo en verde):

| Comando | Resultado |
|---|---|
| `npm run typecheck` | limpio (todos los workspaces) |
| `npm run lint -w @gapssa/web` | limpio, 0 errores/avisos |
| `npm run test -w @gapssa/contracts` | 95/95 |
| `npm run test -w @gapssa/web` | **643/643** (32 ficheros) |
| `npm run test:integration` | **208/208** (22 ficheros) |
| `npm run build` | compila limpio, todas las rutas en el manifiesto |
| `npx playwright test` | **43/43** |
| Migraciones `gapssa_booking` | aplicadas desde vacío + reaplicadas idempotentes (base efímera, verificado §7) |
| `docker compose config` | válido |
| `/api/health` | `{"status":"ok"}` (`app`/`postgresCms`/`redis` en `ok`) |
| `/api/health/live` | `{"status":"ok"}` |

Único punto explícitamente NO cubierto a nivel de integración, por el mismo
motivo ya documentado en `booking.otpOutbox.int.test.ts` (el proceso de
pruebas no comparte memoria con el servidor `next dev` real bajo prueba):
forzar un fallo SMTP REAL para un solo fichero sin afectar al resto de la
suite. El valor exacto de `nextAttemptAt` tras un fallo (`now + 5 min`)
está cubierto a nivel unitario (`otpOutbox.test.ts`, vía los mocks de
`markGuestVerificationOtpJobFailedRetryable`) y su aplicación real
(reclamable solo a partir de ese instante) está cubierta end-to-end en
`booking.outboxLease.int.test.ts`.

## 9. Archivos modificados

- **`packages/contracts/src/booking.ts`**: `BookingOutboxSweepReport` +
  campo `outboxJobs` en `BookingReconciliationReport`.
- **`packages/contracts/src/bookingOutbox.ts`**: comentario de cabecera
  actualizado (lease, `nextAttemptAt`/`leaseExpiresAt` ya no reservados).
- **`apps/web/src/server/booking/db/schema.ts`**: columnas de lease +
  índices nuevos en `booking_outbox_jobs`.
- **`apps/web/drizzle/booking/migrations/0002_revision3_outbox_lease.sql`**
  (+ `meta/_journal.json` actualizado, `meta/0002_snapshot.json` generado
  por drizzle-kit): nuevo.
- **`apps/web/src/server/booking/repository.ts`**: reclamo con lease
  (`claimGuestVerificationOtpJob`), `mark*` condicionados a `claimToken`,
  `linkOtpChallengeIfPending` como CAS atómico (+ `now`),
  `listEligibleGuestVerificationOtpJobs` (nuevo), `hasPendingGuestVerificationOtpJob`
  eliminada.
- **`apps/web/src/server/booking/otpOutbox.ts`**: pre-comprobación de
  expiración/resolución, `claimToken` propagado, nuevo tipo de resultado
  (`sent | rate_limited | failed_retryable | expired | no_eligible_job`).
- **`apps/web/src/server/booking/guestFlow.ts`**: los dos caminos de
  replay llaman a `processGuestVerificationOtpJob` directamente, sin la
  comprobación previa eliminada.
- **`apps/web/src/server/booking/reconciliation.ts`**: `sweepOutboxJobs`
  (nuevo, primer paso del barrido), contador `outboxJobs` en el informe.
- **`apps/web/src/server/booking/availability.ts`**: `rotateProfessionalsForDate`
  (nuevo) aplicado antes del bucle principal.
- **`apps/web/src/server/booking/otpOutbox.test.ts`**: reescrito (15
  pruebas).
- **`apps/web/src/server/booking/availability.test.ts`**: +1 prueba.
- **`apps/web/tests/integration/bookingDb.ts`**: 5 helpers de prueba
  nuevos.
- **`apps/web/tests/integration/booking.outboxLease.int.test.ts`**: nuevo
  (9 pruebas).
- **`docs/fase4a-revision-3.md`**: este documento.

## 10. Confirmación final

- **No se ha tocado la instancia real de EspoCRM** (ni su base de datos,
  ni sus extensiones, ni `extensions/espocrm-google-calendar-sync`) en
  ningún momento de esta revisión — ningún módulo tocado hace referencia a
  `ESPOCRM_SITE_URL` ni a los puertos reales; el adaptador simulado
  (`SimulatedEspoBookingAdapter`) sigue intacto.
- **No se ha eliminado `editor@gapssa.test`** ni ningún contenido aprobado
  de fases anteriores.
- **No se ha hecho ningún commit** en ningún momento de esta revisión —
  todo el trabajo queda en el árbol de trabajo, pendiente de revisión (la
  migración de la base de comprobación §7 fue efímera, creada y destruida
  solo para verificar; `gapssa_booking` real nunca se tocó).
- No se ha avanzado a EspoCRM real, cancelaciones, pagos, FacturaScripts,
  WhatsApp ni Fase 5 — fuera de alcance explícito de esta revisión.
