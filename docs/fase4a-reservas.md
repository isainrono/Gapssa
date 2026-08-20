# Fase 4A — Base transaccional de reservas (`gapssa_booking`)

Entregable de cierre de la Fase 4A (sistema de reservas V1, primera mitad:
persistencia, cifrado, disponibilidad, flujo de invitado y de cliente
autenticado, aprobación del centro, conciliación). Redactado el 7 de agosto
de 2026, tras la aprobación explícita de la revisión 5 de Fase 3.

Complementa, no sustituye, `PROJECT_CONTEXT.md`, `PLAN_DESARROLLO_WEB_PORTAL.md`,
`docs/contratos-portal-v1.md` y `docs/fase3-autenticacion.md`: ante cualquier
contradicción, esos documentos mandan. **No se ha modificado la instancia
real de EspoCRM ni la extensión Google Calendar Sync en ningún momento de
esta fase.** No se han implementado pagos, FacturaScripts, WhatsApp,
credenciales reales del API User de EspoCRM, ni cancelaciones/reprogramación
(fuera de alcance explícito). **No se ha hecho ningún commit** — todo el
trabajo queda en el árbol de trabajo, pendiente de revisión.

## 0. Comprobación defensiva previa (Fase 3, cierre)

Antes de empezar Fase 4A se revisó `apps/web/src/app/api/auth/password/reset/route.ts`
y `completePasswordReset` (`repository.ts`) según lo pedido. Se encontraron
y corrigieron dos huecos reales:

1. **`finishPasswordReset` ignoraba el resultado de `completePasswordReset`**
   y devolvía `{status:'ok'}` incondicionalmente — un resultado
   `'request_not_found'` (la solicitud verificada por OTP no tiene fila
   `password_reset_requests` correspondiente, p. ej. por una caída de
   proceso entre `requestOtp` y `replacePendingPasswordResetRequest`)
   respondía exactamente igual que una rotación real. Ahora solo
   `'completed'`/`'already_completed'` responden éxito; cualquier otro
   resultado devuelve el mismo error genérico `expired` que ya usa el resto
   del endpoint — nunca confirma un cambio que no ocurrió, nunca revela el
   motivo exacto (mantiene la política antienumeración).
2. **`completePasswordReset` no comprobaba que la credencial existiera ni
   que la `UPDATE` afectara a alguna fila** antes de consumir la solicitud
   — nuevo resultado `'credential_missing'`, defensivo (no alcanzable por
   construcción, pero comprobado explícitamente en vez de asumido).

Ambos corregidos en la misma transacción existente (`authDb.transaction`),
con pruebas de integración nuevas que fuerzan ambos estados a mano
(`tests/integration/authDb.ts`: `setPasswordResetRequestChallengeIdForTesting`,
`deleteCredentialForTesting`) — 8/8 en
`auth.passwordReset.int.test.ts`, 158/158 en la suite completa de
integración de Fase 3 antes de tocar nada de Fase 4A.

## 1. Resumen de arquitectura

```text
Navegador
   |  cookies de sesión (invitado: ninguna) + X-Booking-Access-Token (invitado)
   v
Next.js (apps/web) — única capa BFF, igual que Fase 3
   |
   |------------> Postgres: gapssa_booking (Drizzle) — BookingRequestRecord,
   |               PendingGuestIdentity, booking_audit_log
   |------------> Postgres: gapssa_booking — sim_espo_contacts/sim_espo_meetings
   |               (SIMULACIÓN del lado EspoCRM, ver §4)
   |------------> Redis: BookingLock (exclusión mutua), OtpChallenge
   |               (reutiliza otpService.ts de Fase 3, purpose
   |               "guest_email_verification"), rate limiting
   |------------> Correo real o transporte de desarrollo (mailer.ts, Fase 3,
   |               reutilizado sin cambios)
   `------------> gapssa_auth (solo lectura: findAccountById, para el
                   flujo autenticado)
```

Módulos nuevos, todos bajo `apps/web/src/server/booking/`:

| Módulo | Responsabilidad |
|---|---|
| `db/schema.ts`, `db/client.ts`, `db/migrate.ts` | Esquema y acceso Drizzle de `gapssa_booking` |
| `repository.ts` | CRUD/transiciones CAS de `BookingRequestRecord`/`PendingGuestIdentity` |
| `audit.ts` | Única puerta de escritura a `booking_audit_log` |
| `catalog.ts` | Fixtures validados de tratamientos/zonas/profesionales (adaptador simulado) |
| `availabilityConfig.ts` | Horario de apertura, granularidad, topes — configuración centralizada |
| `timezone.ts` | Conversión hora local (Europe/Madrid) ↔ UTC sin dependencias nuevas |
| `espoAdapter.ts` | `EspoBookingAdapter` (interfaz) + `SimulatedEspoBookingAdapter` |
| `slotValidation.ts` | Validación compartida tratamiento/zona/profesional/horario |
| `availability.ts` | Algoritmo de búsqueda de huecos + recomprobación puntual |
| `bookingLock.ts` | `BookingLock` en Redis, adquisición atómica vía Lua |
| `accessToken.ts` | Token opaco de acceso a una solicitud de invitado |
| `internalAuth.ts` | Autenticación de los endpoints internos (secreto compartido) |
| `verificationSteps.ts` | Pasos 5-10 del flujo recuperable — compartido invitado/autenticado |
| `guestFlow.ts` | Orquestación completa del invitado (pasos 1-4 + creación) |
| `authenticatedFlow.ts` | Orquestación del cliente autenticado (reutiliza `verificationSteps.ts`) |
| `reconciliation.ts` | Barrido de conciliación (`BookingReconciliationReport`) |

Endpoints nuevos (`apps/web/src/app/api/booking/v1/`):

| Ruta | Método | Propósito |
|---|---|---|
| `/availability` | GET | Disponibilidad (público, sin CSRF, límite por IP) |
| `/treatments` | GET | Catálogo de tratamientos (público) |
| `/requests` | POST | Crear solicitud de invitado |
| `/requests/:id` | GET | Estado opaco (invitado con token, o sesión propietaria) |
| `/requests/:id/verify` | POST | Verificar OTP de invitado |
| `/requests/authenticated` | POST | Crear (y completar) solicitud de cliente autenticado |
| `/internal/decisions` | POST | Decisión de aprobación/rechazo (protegido, sustituye al mecanismo real EspoCRM→BFF pendiente de diseño) |
| `/internal/sweep` | POST | Dispara el barrido de conciliación (protegido) |

UI mínima: `/[locale]/reservar` reescrita (antes, página informativa de
Fase 2 sin formulario) — `BookingWizard.tsx`, un único componente cliente
con máquina de estados `search → slots → details → otp? → success`, 6
idiomas, reutiliza `AuthForm.module.css`/`authFetch` de Fase 3.

## 2. Flujo exacto de reserva

### 2.1 Invitado

1. `GET /availability?treatmentId&date` → huecos, combinando ocupación
   "asentada" (`sim_espo_meetings`, vía adaptador) y "en vuelo"
   (`booking_request_records` sin Meeting, Postgres).
2. `POST /requests` (idempotencyKey, tratamiento/zona/profesional/horario,
   datos de contacto) → valida existencia + antelación/horizonte, cuenta
   solicitudes activas por `emailLookupHmac` (`MAX_PENDING_REQUESTS_PER_CLIENT`),
   recomprueba el hueco puntual, adquiere `BookingLock` fase "verification"
   (Redis, atómico), cifra la identidad (AES-256-GCM), crea
   `BookingRequestRecord` (`pending_verification`) + `PendingGuestIdentity`
   en una transacción, emite OTP (`guest_email_verification`, reutiliza
   `otpService.ts`), envía correo. Responde 202 con `requestId` +
   `accessToken` opaco (nunca hay sesión de invitado).
3. `POST /requests/:id/verify` (código + `X-Booking-Access-Token`) → pasos
   1-10 del flujo recuperable (docs/contratos-portal-v1.md §3.4): consume
   el OTP de forma atómica, `pending_verification → verification_processing`
   (CAS), recupera y descifra `PendingGuestIdentity`, busca Meeting
   existente por `cBookingRequestId` (idempotente), si no existe crea
   Contact + Meeting (`cEstadoReserva=PendingCenterApproval`), escribe
   `meetingId` + `pending_approval` en Postgres, **solo entonces** purga la
   identidad (marca `consumed`, audita, borra físicamente), renueva el
   `BookingLock` a fase "approval" (best-effort). Responde con `meetingId`.
4. `GET /requests/:id` (con el mismo token) → estado opaco.

### 2.2 Cliente autenticado

1. `POST /requests/authenticated` (con sesión) — rechaza cualquier cuenta
   que no sea `active` (en la práctica, `getActiveSessionFromCookies` de
   Fase 3 ya invalida la sesión de una cuenta suspendida/eliminada antes de
   llegar aquí; la comprobación propia es una red de seguridad redundante
   para llamantes futuros que no pasen por la capa de sesión HTTP).
2. Sin OTP: la solicitud se crea directamente en `verification_processing`
   y la misma petición completa, síncronamente, los pasos 5-10
   (`verificationSteps.completeBookingToMeeting`, la MISMA función que usa
   el invitado — cero lógica de negocio duplicada). Recuperable: si el
   proceso cae a mitad, un reintento con la misma `idempotencyKey` retoma
   desde `completeBookingToMeeting`, que es idempotente por diseño (paso 5:
   búsqueda antes de crear).
3. `ClientAccount` no guarda nombre/teléfono (Fase 3: "nunca duplica la
   ficha completa") — se piden en la propia solicitud; el correo es
   siempre el de la cuenta, nunca reintroducido.

## 3. Modelo y migraciones creadas

Base `gapssa_booking`, Drizzle, config propia (`drizzle.booking.config.ts`),
migraciones propias (`drizzle/booking/migrations/`), scripts
`booking:db:generate`/`booking:db:migrate` — mismo patrón exacto que
`gapssa_auth` (Fase 3). Una migración (`0000_shiny_enchantress.sql`), 5
tablas:

- **`booking_request_records`** — fuente de verdad del estado de la
  solicitud (`BookingRequestRecord`). `idempotency_key` único,
  `payload_hash` para detectar conflicto, `otp_challenge_id` (solo
  invitado), índices por estado/cuenta/meeting y por solape
  profesional+tiempo / zona+tiempo, e índices para el barrido
  (`verification_expires_at`, `approval_expires_at`).
- **`pending_guest_identities`** — 1:1 con la anterior, cuatro campos
  (`firstName`/`lastName`/`email`/`phone`) × 3 columnas cada uno
  (ciphertext/nonce/keyVersion) + `email_lookup_hmac`. Nunca texto plano.
- **`booking_audit_log`** — mismo esquema exacto que `auth_audit_log`
  (Fase 3), en base física separada.
- **`sim_espo_contacts`** / **`sim_espo_meetings`** — backend real del
  adaptador EspoCRM SIMULADO (§4). Explícitamente documentado en el propio
  esquema como simulación, nunca la fuente de verdad de un Contact/Meeting
  real.

Verificado: migraciones aplicadas y reaplicadas de forma idempotente contra
la base de desarrollo real (`gapssa_booking`, vacía antes de esta fase); la
suite de integración crea y destruye una base `gapssa_booking_test_<random>`
aislada en cada ejecución (nunca `gapssa_booking` real),
`tests/integration/global-setup.ts` extendido para ello.

## 4. Uso de Postgres, Redis y adaptador EspoCRM

- **Postgres** (`gapssa_booking`) es la fuente duradera de todo el flujo
  previo a la creación del Meeting — nunca Redis.
- **Redis** se usa exclusivamente como bloqueo temporal reconstruible
  (`BookingLock`) y como almacén del `OtpChallenge` (ya existente, Fase 3).
  Adquisición atómica vía script Lua (`bookingLock.ts`): lee con `KEYS
  <patrón>` todas las claves vivas de la profesional/zona, decide
  solape+capacidad y escribe, todo en una sola operación monohilo de
  Redis — aceptable dado el volumen de este negocio (un centro, un puñado
  de profesionales/zonas); un volumen mayor exigiría rediseñar sin `KEYS`.
  Reconstruible: `reconciliation.ts` reconstruye el lock de cualquier
  solicitud activa a partir de `BookingRequestRecord` si Redis lo pierde.
- **Adaptador EspoCRM**: `EspoBookingAdapter` (interfaz) +
  `SimulatedEspoBookingAdapter` (implementación real sobre
  `sim_espo_contacts`/`sim_espo_meetings`, mismo patrón que `EspoLinkAdapter`
  de Fase 3). Sustituir por llamadas HTTP reales (Fase 4+, requiere
  autorización explícita — `docs/fase3-autenticacion.md` §6.1) no toca
  ningún llamante.

## 5. Política de cifrado y eliminación de PII

- **AES-256-GCM** (`server/crypto/fieldCrypto.ts`, `node:crypto`, nunca Web
  Crypto: solo se ejecuta en rutas API Node). Nonce de 12 bytes único por
  cifrado, tag de autenticación de GCM concatenado al ciphertext. Rechaza
  con `FieldCryptoError` (nunca una excepción críptica de `node:crypto`)
  ante manipulación, clave incorrecta o `keyVersion` desconocida.
- **Versionado real**: `BOOKING_FIELD_ENCRYPTION_KEYS` (mapa JSON
  `{"keyVersion":"claveBase64DE32Bytes"}`) + `BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION`.
  Descifrar acepta cualquier versión del mapa; cifrar siempre usa la activa
  — rotar es añadir versión nueva, cambiar la activa, y retirar la antigua
  del mapa cuando ya no quede ningún dato cifrado con ella (ventana corta:
  `PendingGuestIdentity` se purga en minutos/horas por diseño).
- **`emailLookupHmac`**: HMAC-SHA-256 (reutiliza `hmacSubjectId` de
  `packages/contracts/src/security.ts`, dominio `"booking-guest-email"`,
  secreto propio `BOOKING_EMAIL_LOOKUP_HMAC_SECRET`) — único uso: contar
  solicitudes activas por correo (`MAX_PENDING_REQUESTS_PER_CLIENT`), nunca
  invertible, nunca sustituye el cifrado del campo `email`.
- **Purga**: `repository.purgePendingGuestIdentity` marca la transición
  auditada (`active → consumed|discarded`, según el disparador de
  `decidePendingGuestIdentityPurgeTrigger`, reutilizado literalmente del
  contrato) y borra físicamente en la misma transacción — nunca se retiene
  una fila ya marcada. Disparadores cubiertos: `meeting_linked` (tras
  confirmar `meetingId` persistido), `verification_expired`,
  `recovery_window_exceeded` (barrido). `request_canceled` no aplica: esta
  fase no implementa cancelaciones.
- **Nunca PII/OTP en auditoría ni logs**: `booking_audit_log` solo registra
  transiciones de `BookingRequestRecord.status`/`.resolution` y
  `PendingGuestIdentity.status` (validadas contra los enums cerrados de
  `packages/contracts/src/audit.ts`) — nunca `Meeting.cEstadoReserva`
  (pertenece al log nativo de EspoCRM, nunca al nuestro — ver §8). Ninguna
  nota humana (motivo de rechazo del centro) se copia a la auditoría: vive
  únicamente en `sim_espo_meetings.note` (equivalente simulado del propio
  Meeting en EspoCRM). Verificado con una prueba de integración dedicada
  que serializa todas las filas de auditoría de un flujo completo (creación
  → verificación → aprobación con nota) y comprueba que no contienen el
  nombre, correo, teléfono ni el código OTP del invitado.

## 6. Pruebas y resultados exactos

- `npm run typecheck` (raíz, todos los workspaces): limpio.
- `npm run lint -w @gapssa/web`: limpio, 0 errores/avisos.
- `npm run test -w @gapssa/contracts`: 95/95 (sin cambios — Fase 4A reutiliza
  el contrato existente sin modificarlo).
- `npm run test -w @gapssa/web` (unitarias, Vitest): **596/596**, incluidas
  8 pruebas nuevas de `fieldCrypto.ts`, 5 de `accessToken.ts`, 5 de
  `timezone.ts` (regresión real, ver más abajo) y 20 de `env.test.ts`
  (extendido con los nuevos secretos/validaciones de Fase 4A).
- `npm run test:integration` (raíz, contra bases `gapssa_auth_test_*`/
  `gapssa_booking_test_*` aisladas): **180/180**, 17 ficheros. Nuevos:
  `booking.guestFlow.int.test.ts` (7), `booking.approvalSweep.int.test.ts`
  (6), `booking.authenticatedFlow.int.test.ts` (3),
  `booking.concurrency.int.test.ts` (6) — detalle de concurrencia/
  recuperación en la tabla de abajo. Los 158 tests de Fase 3 siguen en
  verde sin cambios de comportamiento salvo la corrección de §0.
- `npx playwright test` (e2e): **43/43**. Un test existente
  (`navigation.spec.ts`, CTA de reserva) actualizado deliberadamente: antes
  afirmaba que `/reservar` no tenía formulario (decisión de Fase 2, ya
  obsoleta); ahora confirma que el formulario real está presente.
- `npm run build`: compila limpio, todas las rutas nuevas aparecen en el
  manifiesto (`/api/booking/v1/**`, `/[locale]/reservar`).
- `docker compose config`: válido.
- `/api/health` y `/api/health/live`: `{"status":"ok"}`, sin tocar EspoCRM.
- Migraciones: aplicadas desde una base `gapssa_booking` vacía y
  reaplicadas de forma idempotente (segunda ejecución, cero cambios);
  la suite de integración repite esto en cada ejecución contra una base
  efímera.

### Escenarios de concurrencia/recuperación (encargo, punto 10)

| Escenario | Cubierto en |
|---|---|
| Dos clientes bloqueando el mismo horario | `booking.concurrency.int.test.ts` — Promise.all, exactamente un 202 y un 409 `slot_unavailable` |
| Misma idempotency key, mismo payload | `booking.guestFlow.int.test.ts` — reintento devuelve el mismo `requestId`/`accessToken`; `booking.authenticatedFlow.int.test.ts` — mismo `meetingId` |
| Misma key, payload distinto | `booking.guestFlow.int.test.ts` — 409 `idempotency_conflict` |
| Dos verificaciones simultáneas | `booking.concurrency.int.test.ts` — ambas 200, un único Meeting, una única transición auditada |
| Fallo de EspoCRM ANTES de crear el Meeting | `booking.concurrency.int.test.ts` — trigger de Postgres inyecta el fallo en `sim_espo_meetings`; primer intento falla sin purgar nada, reintento con el mismo código completa sin duplicar |
| Fallo DESPUÉS de crear el Meeting (antes de escribir `meetingId`) | `booking.concurrency.int.test.ts` — trigger en `booking_request_records`; el reintento adopta el Meeting ya creado (búsqueda idempotente, paso 5), nunca crea un segundo |
| Caída/pérdida del BookingLock en Redis | `booking.concurrency.int.test.ts` — borrado directo de las claves; el barrido de conciliación (`/internal/sweep`) lo reconstruye desde Postgres |
| Reintento tras `verification_processing` | Cubierto por los dos casos de fallo de EspoCRM de arriba (el registro queda en `verification_processing` entre intentos) |
| Caducidad de verificación | `booking.approvalSweep.int.test.ts` — `verification_expired`/`VerificationExpired`, identidad purgada |
| Caducidad de aprobación | `booking.approvalSweep.int.test.ts` — `approval_expired`/`ApprovalExpired`, Meeting a `Canceled` |
| Limpieza segura de `PendingGuestIdentity` | Verificado en creación→verificación (purga inmediata) y en ambos barridos de expiración |
| Ausencia de duplicados | Implícito en todos los anteriores (índice único `sim_espo_meetings.booking_request_id`, `booking_request_records.idempotency_key`) — confirmado explícitamente contando filas |
| Reserva rechazada por cuenta no activa | `booking.authenticatedFlow.int.test.ts` — cuenta suspendida a mitad de sesión, 401 (la capa de sesión de Fase 3 ya la invalida antes de llegar al servicio; la comprobación `account_not_active` del propio servicio queda como red de seguridad redundante, documentada) |
| No exposición de PII/OTP en logs o auditoría | `booking.concurrency.int.test.ts` — serialización completa de `booking_audit_log` tras un flujo completo, sin nombre/correo/teléfono/código |

### Bug real encontrado y corregido durante las pruebas

`zonedTimeToUtc` (`server/booking/timezone.ts`) tenía un fallo de
convergencia: cada iteración de corrección restaba el desfase horario
sobre el `guess` de la iteración ANTERIOR en vez de sobre el objetivo fijo
original, duplicando la corrección y produciendo un desfase de 2h en
horario de verano (09:00 Madrid se convertía a 05:00 UTC en vez de 07:00
UTC). Detectado ejecutando la interfaz real contra el servidor de
desarrollo (`npm run dev`) y comparando el primer hueco devuelto por
`/api/booking/v1/availability` con el horario de apertura esperado — no
por una prueba escrita de antemano. Corregido y cubierto con
`timezone.test.ts` (5 casos: CEST/CET, ida y vuelta con `getZonedWeekday`).

## 7. Archivos modificados/creados

Resumen por área (lista exhaustiva en el árbol de trabajo real):

- **Fase 3 (corrección de cierre)**: `apps/web/src/server/auth/repository.ts`,
  `apps/web/src/app/api/auth/password/reset/route.ts`,
  `apps/web/tests/integration/authDb.ts`,
  `apps/web/tests/integration/auth.passwordReset.int.test.ts`.
- **`apps/web/src/server/booking/**` (nuevo)**: los 16 módulos listados en §1,
  más `db/schema.ts`/`client.ts`/`migrate.ts`.
- **`apps/web/src/server/crypto/fieldCrypto.ts` (+ test)**: nuevo.
- **`apps/web/src/app/api/booking/v1/**` (nuevo)**: los 8 endpoints de §1.
- **`apps/web/src/components/client/booking/BookingWizard.tsx`**: nuevo.
- **`apps/web/src/app/(frontend)/[locale]/reservar/page.tsx`**: reescrita;
  `Reservar.module.css` eliminado (ya no se usa).
- **`apps/web/src/lib/i18n/dictionaries/{es,ca,en,it,fr,pt}.ts`**: namespace
  `reservar` ampliado (de 4 a 30 claves), traducido a los 6 idiomas.
- **`apps/web/src/server/env.ts` (+ test)**: 14 variables nuevas de Fase 4A,
  validación cruzada (versión activa ∈ mapa de claves, cierre > apertura).
- **`apps/web/drizzle.booking.config.ts`, `apps/web/drizzle/booking/migrations/**`**: nuevo.
- **`apps/web/package.json`**: scripts `booking:db:generate`/`booking:db:migrate`.
- **`apps/web/tests/integration/global-setup.ts`**: base `gapssa_booking_test_*`
  aislada, límites de frecuencia de reservas elevados para la suite.
- **`apps/web/tests/integration/{bookingDb,bookingClient}.ts` (nuevo)**,
  **`redisTestHelper.ts`** (extendido), **`provided-context.d.ts`** (extendido).
- **`apps/web/tests/integration/booking.*.int.test.ts` (nuevo, 4 ficheros, 22 pruebas)**.
- **`apps/web/tests/e2e/navigation.spec.ts`**: una prueba actualizada (§6).
- **`apps/web/README.md`**: documentación de los comandos `booking:db:*`.
- **`.env.example`, `.env`** (local, nunca commiteado): 14 variables nuevas.
- **`docs/fase4a-reservas.md`**: este documento.

## 8. Desviaciones justificadas

- **`verificationExpiresAt` como ancla de la ventana de recuperación**: el
  contrato define `VERIFICATION_RECOVERY_WINDOW_MINUTES` como el plazo
  "tras entrar en verification_processing", pero `BookingRequestRecord` no
  tiene un campo propio para ese instante — añadirlo habría extendido la
  forma del contrato ya aprobado sin autorización. Se reutiliza
  `verificationExpiresAt` (nunca reescrito al transicionar) como ancla:
  `recoveryDeadline = verificationExpiresAt + BOOKING_VERIFICATION_RECOVERY_WINDOW_MINUTES`.
  Documentado en `repository.ts`.
- **Flujo autenticado sin `PendingGuestIdentity`**: `ClientAccount` no
  guarda nombre/teléfono (decisión ya fijada en Fase 3). Se piden en la
  propia solicitud en vez de inventar un nuevo campo de perfil — decisión
  técnica reversible, sin impacto de seguridad (el correo nunca se
  reintroduce, siempre el de la cuenta).
- **`MAX_PENDING_REQUESTS_PER_CLIENT` deja de contar en cuanto se purga la
  identidad** (disparador `meeting_linked`, antes de la resolución final) —
  consecuencia directa del propio disparador de purga del contrato, no una
  limitación añadida: el límite protege contra acumular solicitudes SIN
  verificar, no contra tener varias citas ya vinculadas pendientes de
  aprobación.
- **Endpoints internos con secreto compartido** (`/internal/decisions`,
  `/internal/sweep`): sustituyen, en esta fase, dos mecanismos que
  `docs/contratos-portal-v1.md` §10 deja explícitamente pendientes de
  diseño (webhook-vs-sondeo EspoCRM→BFF; scheduler del barrido) — nunca
  expuestos al navegador, protegidos por `X-Internal-Api-Secret`,
  documentados como provisionales en el propio código.
- **`KEYS` (no `SCAN`) en el script Lua del `BookingLock`**: aceptable dado
  el volumen de este negocio (documentado en `bookingLock.ts`); un volumen
  mayor exigiría rediseñar sin escaneo de todo el espacio de claves.
- **Catálogo de tratamientos/zonas/profesionales como fixtures en código**
  (`catalog.ts`), no tablas nuevas de Postgres: representan lo que en
  producción se leería en vivo de EspoCRM (`CTratamiento`/`CZonaAtencion`/
  profesionales) — mantenerlos como datos de solo lectura, validados una
  vez al arrancar, evita crear una copia persistente que habría que
  sincronizar con el adaptador real más adelante.

## 9. Decisiones todavía pendientes

Heredadas de Fase 0/3, sin resolver en esta fase (todas requieren
autorización explícita antes de avanzar):

- Vinculación/lectura real con EspoCRM (API User, campo `cGapssaAccountId`,
  permisos) — `docs/fase3-autenticacion.md` §6.1.
- Mecanismo real webhook-vs-sondeo para que el BFF conozca las decisiones
  tomadas en EspoCRM — sustituido provisionalmente por
  `/internal/decisions`.
- Scheduler real del barrido de conciliación (cron/worker) — sustituido
  provisionalmente por `/internal/sweep`, invocable manualmente.
- Runner periódico del outbox de Fase 3 (`evaluate_espo_link`) — sigue
  pendiente, sin relación directa con Fase 4A.
- Reglas concretas de "coincidencia dudosa" al buscar/crear `Contact` real
  (hoy, en el adaptador simulado: por `gapssaAccountId`, luego correo,
  luego teléfono, primer resultado) — a definir cuando exista adaptador
  real, según `PROJECT_CONTEXT.md` §7.1.
- Valores técnicos sugeridos de esta fase (horario de apertura,
  granularidad de huecos, tope de resultados, ventana de recuperación,
  límites de frecuencia) — configurables, no confirmados como definitivos.
- Panel de administración de reservas para el centro — explícitamente
  fuera de alcance de esta fase.
- Cancelaciones/reprogramación (`CancellationRequest`, `RescheduleRequest`,
  ya diseñados en `packages/contracts/src/booking.ts`) — no implementados.
- Rotación real de `BOOKING_FIELD_ENCRYPTION_KEYS` en producción (mecanismo
  de despliegue del secreto, procedimiento operativo) — el código ya
  soporta múltiples versiones simultáneas, falta el procedimiento.

## 10. Confirmación final

- **No se ha hecho ningún commit** en ningún momento de esta fase.
- **No se ha modificado la instancia real de EspoCRM** (ni su base de
  datos, ni sus extensiones, ni `extensions/espocrm-google-calendar-sync`)
  en ningún momento — el adaptador `SimulatedEspoBookingAdapter` nunca
  realiza una llamada de red a EspoCRM; verificado además por inspección
  (sin referencias a `ESPOCRM_SITE_URL` ni a los puertos reales en el
  código nuevo).
- No se ha tocado `editor@gapssa.test` ni ningún contenido aprobado de
  Fases 1-3, verificado como parte de la validación final (suite completa
  de Fase 3 en verde, 158/158, sin cambios de comportamiento salvo la
  corrección explícitamente solicitada en §0).
- Todos los cambios existentes del árbol de trabajo previos a esta fase se
  han conservado intactos.
