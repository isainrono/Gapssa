# Puerta 5B-2A — Modo de ensayo controlado para la primera reserva real (5B-2B)

**Estado: 5B-2A implementada y probada en el repositorio. 5B-2B (ejecución
real contra `gapssa-espocrm-1`) permanece SIN AUTORIZAR — este documento
solo la propone.** Autorizada explícitamente el 2026-08-13, con alcance
exacto de 7 puntos (auditoría del flujo, diseño del modo de ensayo,
contratos, proceso aislado para 5B-2B, pruebas, ensayo desechable si
resultaba necesario, propuesta 5B-2B). Cero escrituras contra
`gapssa-espocrm-1` real en esta sesión — todo el trabajo fue edición de
repositorio, pruebas unitarias y pruebas de integración contra Postgres/
Redis efímeros ya levantados (`gapssa-apps-db-1`, `gapssa-redis-1`) y un
servidor EspoCRM fake en memoria (`tests/contract/fakeEspoServer.ts`).
`ESPO_BOOKING_ADAPTER` permanece `simulated` en el proceso principal.
Cero commits.

## 1. Fase 1 — Auditoría del flujo real

### 1.1 Traza exacta (archivos y funciones)

```
Navegador
  → POST /api/booking/v1/requests                    (invitado)
    apps/web/src/app/api/booking/v1/requests/route.ts
  → POST /api/booking/v1/requests/authenticated       (autenticado)
    apps/web/src/app/api/booking/v1/requests/authenticated/route.ts
      │
      ├─ bodySchema.parse()  (Zod, sin .passthrough() — cualquier campo
      │  no declarado, incluido un cExcluirGoogleCalendarSync/
      │  controlledTestExcludeGcs homónimo, se descarta aquí, antes de
      │  tocar ninguna lógica de negocio — ver §5, prueba 4)
      │
      ▼
  guestFlow.createGuestBooking()             (invitado, tras verificar OTP)
  authenticatedFlow.createAuthenticatedBooking()  (autenticado, síncrono)
      │
      │  AMBOS delegan exclusivamente en:
      ▼
  verificationSteps.completeBookingToMeeting()   ← ÚNICA función central
      │
      ├─ resolveControlledTestGcsExclusion()      (controlledTestMode.ts)
      │     lee EXCLUSIVAMENTE serverEnv.ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS
      │     → true | undefined — nunca lee nada de `record`/`contact`/HTTP
      │
      ├─ [Meeting NO encontrado] adapter.createMeeting({
      │     ...CreateMeetingInput,
      │     controlledTestExcludeGcs: expectedGcsExclusion,
      │   })
      │
      └─ [Meeting SÍ encontrado — recuperación tras timeout]
            comprueba lookup.meeting.cExcluirGoogleCalendarSync
            === expectedGcsExclusion (solo si expectedGcsExclusion
            !== undefined) → si no coincide, abre revisión manual
            (meeting_gcs_exclusion_mismatch), nunca muta el Meeting
      │
      ▼
  EspoBookingAdapter.createMeeting()  (espoAdapter.ts, interfaz)
      │
      ├─ SimulatedEspoBookingAdapter.createMeeting()
      │     — lanza si controlledTestExcludeGcs=true (defensa en
      │       profundidad; inalcanzable por env.ts en el camino real)
      │
      └─ HttpEspoBookingAdapter.createMeeting()
            POST /api/v1/Meeting
              { name, dateStart, dateEnd, cTratamientoId,
                cZonaAtencionId, assignedUserId, cEstadoReserva,
                status, cBookingRequestId,
                ...(controlledTestExcludeGcs ? { cExcluirGoogleCalendarSync: true } : {}) }
            → relateContact()
            → findMeetingByBookingRequestId()  (releer, detectar carrera)
            → [si controlledTestExcludeGcs] getMeetingById()  (RELECTURA
              por select= cerrado, MEETING_SELECT_FIELDS) — si no
              confirma true, lanza ControlledTestExclusionUnverifiedError
              (nunca inventa el resultado)
```

### 1.2 Respuestas a las 11 preguntas del encargo

1. **Qué datos puede enviar el navegador**: `idempotencyKey`, `treatmentId`,
   `professionalId`, `zoneId`, `startAt`, y los datos de contacto
   (`guest.*` o `contact.*`, según el flujo). Ningún campo de exclusión de
   GCS forma parte de `bodySchema` en ninguno de los dos endpoints
   públicos — confirmado por lectura y por prueba (§5, prueba 4).
2. **Qué datos añade exclusivamente el servidor**: `bookingRequestId`
   (`randomUUID()`), `contactId` (resuelto por `findOrCreateContact`),
   `cEstadoReserva`/`status` fijos, `name` fijo sin PII
   (`PORTAL_MEETING_NAME`), y ahora `controlledTestExcludeGcs` —
   exclusivamente vía `resolveControlledTestGcsExclusion()`, que solo lee
   `serverEnv`.
3. **Dónde se construye `CreateMeetingInput`**: en
   `verificationSteps.completeBookingToMeeting()`, único punto de llamada
   a `adapter.createMeeting()` en todo el repositorio (confirmado por
   `grep -rn '\.createMeeting(' src`, un único resultado fuera de
   pruebas).
4. **Si el contrato actual admite un campo de exclusión**: ahora sí —
   `CreateMeetingInput.controlledTestExcludeGcs?: true` (nunca `false`,
   a nivel de tipo) y `SimMeeting.cExcluirGoogleCalendarSync: boolean`
   (espoAdapter.ts). Es un contrato INTERNO (`server/booking/*`), nunca
   parte de `packages/contracts` expuesto a HTTP público — sí se añadió
   un valor nuevo al catálogo cerrado `BookingReviewConflictType`
   (`meeting_gcs_exclusion_mismatch`), que tampoco se expone al cliente
   (`packages/contracts/src/booking.ts`, comentario de cabecera: "la API
   pública... no los expone jamás").
5. **Todos los call sites de `createMeeting`**: uno solo,
   `verificationSteps.ts:268` (ver punto 3).
6. **Cómo evitar duplicar reglas entre invitado y autenticado**: ambos
   flujos ya delegaban en `completeBookingToMeeting` antes de esta
   subpuerta (Fase 4A, punto 7) — la decisión de exclusión se añadió
   DENTRO de esa función compartida, nunca en `guestFlow.ts`/
   `authenticatedFlow.ts` por separado. Probado explícitamente
   (`verificationSteps.test.ts`, "mismo camino para invitado y
   autenticado").
7. **Cómo asegurar que el modo de ensayo no afecta reservas normales**:
   `resolveControlledTestGcsExclusion()` devuelve `undefined` salvo que
   `serverEnv.ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS` sea `true` — y esa
   variable, validada al arrancar el proceso, nunca es `true` en el
   proceso principal (default `false`, y `env.ts` la rechaza salvo con
   `ESPO_BOOKING_ADAPTER=http` + `NODE_ENV!==production` +
   identificador). Todas las suites de pruebas (unitarias e integración)
   pasaron sin activar el modo — 758/758 pruebas unitarias y las
   integraciones de reservas relevantes en verde (§5).
8. **Qué proceso y entorno ejecutará 5B-2B**: un proceso Next.js temporal,
   nunca el de `localhost:3000` — diseño completo en §4.
9. **Cómo impedir que el proceso principal reciba esta configuración**:
   la variable se lee del entorno del proceso (`process.env`, vía
   `serverEnv`) — el proceso principal se arranca hoy con
   `dotenv -e .env -- npm run dev -w @gapssa/web` (`.env` raíz, sin
   `ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS` definida) y no se toca en esta
   subpuerta. El proceso aislado de 5B-2B recibirá su entorno
   exclusivamente vía el objeto `env` de `child_process.spawn()` (mismo
   patrón ya auditado en Puerta 5B-1, §17.4 de
   `fase4b-puerta5b-propuesta-v1.md`), nunca escrito al `.env` compartido.
10. **Qué ocurre en recuperación tras timeout**: `findMeetingByBookingRequestId`
    localiza el Meeting ya creado; `completeBookingToMeeting` lo adopta
    solo si es compatible en horario/tratamiento/profesional/zona
    (`isCompatibleMeeting`, sin cambios) y, dentro de una ejecución de
    prueba controlada, también si su `cExcluirGoogleCalendarSync`
    coincide con lo esperado — si no coincide, abre revisión manual
    (`meeting_gcs_exclusion_mismatch`), nunca lo reintenta ni lo muta.
    Probado en `verificationSteps.test.ts` (§5).
11. **Si el campo de exclusión permanece `true` en todos esos caminos**:
    sí — la decisión se calcula una única vez por invocación de
    `completeBookingToMeeting` (`expectedGcsExclusion`) y se usa
    consistentemente tanto en el camino de creación como en el de
    adopción; nunca se recalcula a mitad de la función ni se deja que un
    camino la ignore.

## 2. Fase 2 — Diseño del modo de ensayo (implementado)

Variables nuevas en `apps/web/src/server/env.ts` (`restEnvSchema`):

| Variable | Default | Regla |
|---|---|---|
| `ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS` | `false` | Solo `"true"` la activa (mismo patrón que `SITE_NOINDEX`/`SMTP_SECURE`). `true` exige simultáneamente `NODE_ENV!==production`, `ESPO_BOOKING_ADAPTER=http`, y `ESPOCRM_CONTROLLED_TEST_RUN_ID` presente — cualquier combinación incompleta hace fallar `parseServerEnv` (arranque del proceso), nunca cae a `false` en silencio. |
| `ESPOCRM_CONTROLLED_TEST_RUN_ID` | ausente | Identificador CSPRNG efímero, formato cerrado `puerta5b2a-<32-64 hex>` (p. ej. `puerta5b2a-` + `crypto.randomBytes(16).toString('hex')`). Nunca una contraseña ni un mecanismo de acceso HTTP. Formato validado incluso fuera del modo de ensayo (falla rápido ante configuración malformada). |

18 pruebas nuevas/actualizadas en `env.test.ts` cubren: default, activación
válida, rechazo en producción, rechazo con adaptador simulado, rechazo sin
identificador, rechazo con identificador malformado, y que el proceso
normal (modo ausente) mantiene exactamente el mismo resultado que antes.

## 3. Fase 3 — Contratos y adaptador (implementado)

- `CreateMeetingInput.controlledTestExcludeGcs?: true` — decidido
  EXCLUSIVAMENTE por `resolveControlledTestGcsExclusion()`
  (`server/booking/controlledTestMode.ts`), nunca por el navegador.
- `SimMeeting.cExcluirGoogleCalendarSync: boolean` — espejo de lectura,
  `false` en cualquier Meeting fuera de una ejecución de prueba.
- `guestFlow`/`authenticatedFlow` reutilizan la misma función central
  (`completeBookingToMeeting`) — nunca duplican la decisión.
- `HttpEspoBookingAdapter.createMeeting()`:
  - omite la clave en funcionamiento normal;
  - envía exactamente `cExcluirGoogleCalendarSync: true` en modo
    controlado, nunca `false` derivado del cliente;
  - **relee por `select=` cerrado** (`MEETING_SELECT_FIELDS`, que ahora
    incluye `cExcluirGoogleCalendarSync`) tras crear, y solo devuelve
    éxito si la relectura confirma `true` — si EspoCRM omite el campo o
    lo devuelve `false` (ACL, extensión no desplegada, o cualquier otra
    causa), lanza `ControlledTestExclusionUnverifiedError` en vez de
    inventar el resultado. El Meeting no se duplica: un reintento lo
    adopta por `cBookingRequestId`.
- `SimulatedEspoBookingAdapter.createMeeting()` lanza si se le pide
  `controlledTestExcludeGcs=true` — defensa en profundidad (el camino
  real ya lo impide en `env.ts`), nunca confunde una reserva simulada con
  una prueba real de GCS.
- Recuperación idempotente: `completeBookingToMeeting` compara
  `cExcluirGoogleCalendarSync` del Meeting adoptado contra lo esperado
  SOLO dentro de una ejecución de prueba controlada; si no coincide, abre
  revisión manual (`meeting_gcs_exclusion_mismatch`, nuevo valor cerrado
  en `BookingReviewConflictType`/`AuditReasonCode`,
  `packages/contracts/src/booking.ts` y `audit.ts`) — nunca muta el
  Meeting para "corregirlo".

Ningún cambio en el contrato HTTP público de reserva
(`packages/contracts` no gana ningún campo aceptado desde el navegador;
`bodySchema` de ambas rutas sigue sin `cExcluirGoogleCalendarSync`/
`controlledTestExcludeGcs` en su forma — cualquier valor homónimo enviado
por un cliente se descarta por el comportamiento por defecto de
`z.object()`, sin `.passthrough()`).

## 4. Fase 4 — Diseño del proceso aislado para 5B-2B (NO ejecutado)

- **Proceso**: `next dev` (o `next start` sobre un build de ensayo)
  temporal, nunca el de `localhost:3000`.
- **Puerto**: distinto de 3000, elegido en el momento (`net.createServer().listen(0, ...)`,
  mismo patrón ya auditado y usado en `tests/integration/global-setup.ts`
  y en la Puerta 5B-1, §17.2).
- **`NEXT_DIST_DIR`** aislado (p. ej. `.next-puerta5b2b`), para no competir
  con el caché de build del `next dev` de desarrollo — mismo patrón que la
  sonda de la Puerta 5B-1.
- **Interfaz de escucha**: exclusivamente `127.0.0.1` — nunca una interfaz
  pública. Puerto no publicado, sin DNS ni proxy inverso apuntando a él.
- **`ESPO_BOOKING_ADAPTER=http`**, `ESPOCRM_API_BASE_URL` local (nunca la
  URL pública de producción — mismo criterio que Puerta 5B, §2 de
  `fase4b-puerta5b-propuesta-v1.md`), `ESPOCRM_API_KEY` existente
  (`portal-gapssa-api`, secreto ya localizado en la Puerta 5B-1, nunca
  rotado ni mostrado), `ESPOCRM_PROFESSIONAL_USER_IDS` con la lista real
  (pendiente de decisión de negocio — bloqueo heredado de Puerta 5B, no
  nuevo aquí).
- **`ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS=true`**, `ESPOCRM_CONTROLLED_TEST_RUN_ID`
  generado con CSPRNG en el momento de arrancar el proceso aislado
  (nunca reutilizado entre ejecuciones).
- **Entorno del proceso**: recibido exclusivamente vía el objeto `env` de
  `child_process.spawn()` — nunca escrito al `.env` raíz compartido con el
  proceso principal (mismo patrón ya auditado y probado en la Puerta
  5B-1, §17.4/§17.8).
- **Postgres/Redis**: los mismos locales que usa `apps/web` hoy
  (`gapssa_auth`, `gapssa_booking` — ya necesarios para el recorrido
  completo: OTP, `BookingRequestRecord`, `PendingGuestIdentity`/
  `PendingAuthenticatedContactDetails`). Ninguna tarea de seed o
  migración destructiva — el proceso aislado usa el mismo esquema ya
  migrado que el proceso principal, sin tocarlo.
- **Cuenta técnica única**: una cuenta de prueba en el sistema de
  autenticación de `apps/web` (Fase 3), creada por el mecanismo estándar
  de registro/OTP (nunca una fila insertada a mano) — email/teléfono
  claramente distinguibles (dominio reservado, mismo patrón que
  `docs/fase4b-puerta5b-propuesta-v1.md` §11). Restringir la reserva a
  esa única cuenta técnica es responsabilidad de quien opera la sesión de
  prueba (una única reserva prevista, §7 de este documento) — no se
  añade ninguna comprobación server-side nueva en el código de esta
  subpuerta porque el proceso aislado en sí mismo, sin publicar su
  puerto, ya es la barrera real (nadie más puede alcanzarlo).
- **Cierre**: `SIGTERM` inmediato tras verificar el `Meeting` creado —
  nunca se deja el proceso temporal corriendo en segundo plano.

## 5. Fase 5 — Pruebas (ejecutadas)

758/758 pruebas unitarias en verde (39 archivos), típecheck limpio
(`apps/web` y `packages/contracts`), lint limpio (`eslint .`, cero
avisos), build de producción exitoso (`npm run build`, confirmando que
ninguna de las dos variables nuevas se filtra al bundle de cliente — no
llevan prefijo `NEXT_PUBLIC_` y `env.ts` mantiene `import 'server-only'`).

Cobertura exacta de los 18 puntos del encargo:

| # | Punto | Dónde |
|---|---|---|
| 1 | Default ausente → sin exclusión en el payload | `httpEspoAdapter.test.ts` |
| 2 | Modo false → sin exclusión (a nivel de tipo, `controlledTestExcludeGcs` nunca es `false`) | `espoAdapter.ts` (tipo), `controlledTestMode.test.ts` |
| 3 | Modo true válido → payload con `cExcluirGoogleCalendarSync=true` | `httpEspoAdapter.test.ts` |
| 4 | Campo homónimo del navegador → descartado por el schema | `route.schema.test.ts` (nuevo) |
| 5 | Modo true + production → arranque falla | `env.test.ts` |
| 6 | Modo true + simulated → falla (validación + defensa en profundidad) | `env.test.ts`, `espoAdapter.test.ts` |
| 7 | Falta identificador → falla | `env.test.ts` |
| 8 | Identificador malformado → falla | `env.test.ts` |
| 9 | Proceso normal sin regresión | Las 758 pruebas preexistentes siguen en verde |
| 10 | Invitado/autenticado comparten la decisión central | `verificationSteps.test.ts` + único call site (`grep`) |
| 11 | Reintento tras timeout adopta sin duplicar | `httpEspoAdapter.test.ts` (preexistente, sigue en verde) + `verificationSteps.test.ts` |
| 12 | Meeting recuperado con exclusión=false cuando se esperaba true → revisión manual | `verificationSteps.test.ts` (nuevo) |
| 13 | Respuesta sin campo verificable → fallo recuperable | `httpEspoAdapter.test.ts` (simulación de ACL `edit:no`, nuevo) |
| 14 | Ningún log con el identificador completo | Nada en el diff registra `ESPOCRM_CONTROLLED_TEST_RUN_ID` — confirmado por lectura |
| 15 | Variable ausente de bundles cliente | `npm run build` exitoso, sin prefijo `NEXT_PUBLIC_` |
| 16 | FakeEspoServer verifica el payload exacto | `httpEspoAdapter.test.ts` + `blockGcsExclusionFieldWrites` (nuevo, `fakeEspoServer.ts`) |
| 17 | ACL edit=no → fallo cerrado, no creación silenciosa con false | `httpEspoAdapter.test.ts` (nuevo) |
| 18 | Restauración de ACL, condición previa para 5B-2B | §7 de este documento (precondiciones) |

Además, pruebas de integración relevantes ejecutadas contra Postgres/Redis
efímeros ya levantados: `booking.decisionRecovery.httpConflict.int.test.ts`
(10/10), `booking.simulatedEspoAdapter.contract.int.test.ts` +
`booking.review.int.test.ts` (18/18). Al ejecutar el lote completo
`tests/integration/booking.*` (107 pruebas), 4 pruebas de 3 archivos NO
relacionados con esta subpuerta (`booking.sweepRecovery`,
`booking.otpOutbox`, `booking.reviewTransactional` — ninguno importa
`controlledTestMode.ts`, ni toca `ESPOCRM_CONTROLLED_TEST_*`, ni pasa por
`HttpEspoBookingAdapter`, que estas pruebas no usan por estar
`ESPO_BOOKING_ADAPTER=simulated`) fallaron de forma no determinista (el
conjunto exacto de fallos varió entre una ejecución en lote y una
ejecución aislada del mismo archivo) — evidencia de fragilidad
preexistente sensible a fecha/concurrencia/orden de ejecución, no una
regresión de esta subpuerta. No se investiga ni se corrige aquí (fuera del
alcance autorizado de 5B-2A); queda anotado como riesgo pendiente (§10).

## 6. Fase 6 — Ensayo desechable: NO ejecutado, justificación

No fue necesario levantar un EspoCRM 10.0.3 desechable nuevo. La Puerta 6
(`docs/fase4b-puerta6-exclusion-gcs.md`, §9) ya ejecutó un ensayo
desechable completo sobre exactamente este mismo campo
(`cExcluirGoogleCalendarSync`), demostrando con EspoCRM real:

- ACL `edit:yes` puede fijar `true` vía API real (escenario 13, §9.4);
- ACL `edit:no`/`read:no` nunca logra persistir `true` (mismo escenario);
- anónimo → `401`;
- Admin → acceso completo estructural.

Y la Puerta 5B-1 (`docs/fase4b-puerta5b-propuesta-v1.md`, §17–18)
confirmó, contra `gapssa-espocrm-1` REAL (no desechable), que el ACL
vigente hoy para `Portal GAPSSA API` es exactamente
`{read: yes, edit: no}` — el mismo estado que produce, en la relectura de
esta subpuerta, un `ControlledTestExclusionUnverifiedError` cerrado (nunca
un `true` inventado). Repetir un ensayo desechable habría demostrado
exactamente lo mismo que ya está demostrado dos veces con evidencia real.
Si 5B-2B decide abrir la ventana ACL (§7, más abajo), esa apertura sigue
siendo una decisión y un procedimiento aparte — no ejecutada aquí.

## 7. Fase 7 — Propuesta de procedimiento real 5B-2B (NO ejecutado)

### 7.1 Precondiciones

1. 5B-2A aceptada como completada (este documento).
2. Health check de 4 capas de Puerta 5B (§4 de
   `fase4b-puerta5b-propuesta-v1.md`) repetido y en verde el mismo día de
   la ejecución — no se reutiliza el resultado de una sesión anterior.
3. `ESPOCRM_PROFESSIONAL_USER_IDS` con al menos un `User.id` real
   confirmado como profesional reservable (bloqueo heredado de Puerta 5B
   — decisión de negocio pendiente, no resuelta por 5B-2A).
4. Backup de `role.field_data` de `Portal GAPSSA API` (mismo mecanismo
   que Puerta 3C).
5. Cuenta técnica de prueba ya creada en `apps/web` (Fase 3), con
   email/teléfono distinguibles.
6. `app-check` verde, `maintenanceMode` ausente/`NULL`,
   `gapssaBookingDecisionEnabled=false`, `ESPO_BOOKING_ADAPTER=simulated`
   en el proceso PRINCIPAL confirmado por runtime (mismo método que
   Puerta 5B-1, §17.1 — nunca solo por `.env`).

### 7.2 Backup

Mismo alcance que Puerta 6 §11.1: archivos vivos, ACL completo de ambos
roles, snapshot técnico no-PII de `Meeting`/`gcs_event_link`, configuración
efectiva de GCS sin secretos — bajo `/var/www/html/data/.backup/gapssa/puerta5b2b/<timestamp-UTC>/`.

### 7.3 Arranque del proceso aislado

Según el diseño de §4 — puerto efímero, `127.0.0.1` únicamente,
`NEXT_DIST_DIR` aislado, `ESPO_BOOKING_ADAPTER=http`,
`ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS=true`,
`ESPOCRM_CONTROLLED_TEST_RUN_ID` nuevo por ejecución.

### 7.4 Apertura temporal de ACL

`Portal GAPSSA API` — `field_data.Meeting.cExcluirGoogleCalendarSync`:
`{read: yes, edit: no}` → `{read: yes, edit: yes}`, vía
`EntityManager`/`saveEntity()` — nunca edición manual de tablas. Mismo
rigor que Puerta 5B §7: ventana mínima, el cliente nunca controla el
valor (lo fija `apps/web`, server-side, como constante para este ensayo).

### 7.5 `clear-cache` y `AclManager`

`bin/command clear-cache` obligatorio tras el cambio de ACL (lección de
Puerta 3C §2.2) — verificación real vía `AclManager::checkField()` antes
de continuar.

### 7.6 Una única reserva desde la cuenta técnica

Reserva real desde el proceso aislado, con la cuenta técnica de §7.1
punto 5 — el flujo estándar de `apps/web` construye
`controlledTestExcludeGcs=true` server-side (§2/§3), sin que la cuenta
técnica ni ninguna sesión de navegador lo controle.

### 7.7 `Meeting` y `Contact` resultantes

Verificación por `GET /api/v1/Meeting/{id}` (lectura, con la API Key
existente) — nombre del `Contact` marcado `[PRUEBA PUERTA5B2B]`, mismo
patrón que puertas anteriores, para poder identificarlo y purgarlo.

### 7.8 Validación

- `cBookingRequestId` coincide con la solicitud origen;
- `cEstadoReserva=PendingCenterApproval`;
- `cExcluirGoogleCalendarSync=true`, confirmado por la propia relectura
  de `HttpEspoBookingAdapter.createMeeting()` (§3) — si no se confirma,
  el proceso aislado ya se detiene solo (`ControlledTestExclusionUnverifiedError`),
  antes de llegar a este paso;
- `assignedUserId` coincide con el profesional de la lista blanca;
- idempotencia: repetir la misma `idempotencyKey` no duplica;
- cero jobs/tráfico GCS: cero filas nuevas en `gcs_event_link`, cero
  líneas nuevas de OAuth/Calendar en los logs de EspoCRM en la ventana de
  la prueba (mismo criterio que Puerta 5A/6).

### 7.9 Cierre inmediato de ACL

`{read: yes, edit: yes}` → `{read: yes, edit: no}` de vuelta, verificado
por relectura — si la restauración no puede confirmarse, condición de
parada inmediata (mismo principio que Puerta 5B §7.5), nunca se continúa
con el resto del procedimiento.

### 7.10 Parada del proceso aislado

`SIGTERM`, puerto liberado, confirmado sin procesos escuchando.

### 7.11 Rollback a la línea base

Solo si algo de lo anterior no puede confirmarse — ACL, `maintenanceMode`
(si se llegó a tocar), ningún dato de EspoCRM real más allá del `Meeting`/
`Contact` de prueba ya creados intencionalmente.

### 7.12 Pausa antes de aprobación

5B-2B se detiene aquí — la decisión de Aprobar/Rechazar desde EspoCRM
(§8 de `fase4b-puerta5b-propuesta-v1.md`) y la actualización de "Próximas
citas" en el portal NO se demuestran en 5B-2B (bloqueadas por §9 de ese
documento — ver §9 de este documento, más abajo).

### 7.13 Limpieza posterior

Purga del `Contact`/`Meeting` de prueba y de las filas de Postgres
asociadas — autorización separada, no automática (mismo criterio que
Puerta 5B §11).

### Condiciones de parada (aplican a todo 7.3–7.12)

- Cualquier `Contact` ambiguo o coincidencia con un `Contact` real;
- PII inesperada en cualquier respuesta;
- `cExcluirGoogleCalendarSync` distinto de `true` tras la creación
  (ya cubierto por la excepción cerrada del adaptador — §3);
- cualquier job o vínculo GCS generado;
- ACL no restaurada exactamente a `{read: yes, edit: no}`;
- `Meeting` duplicado para el mismo `cBookingRequestId`;
- divergencia entre Postgres y EspoCRM;
- proceso principal (`localhost:3000`) alterado en cualquier momento;
- cualquier secreto expuesto (API Key, identificador de ejecución
  completo).

## 8. Auditoría del bloqueo de reconciliación (sin implementar scheduler/webhook)

Sin cambios respecto al diagnóstico ya cerrado en
`fase4b-puerta5b-propuesta-v1.md` §9 — releído en esta sesión,
confirmado sin modificaciones: `apps/web/src/server/booking/reconciliation.ts`
y su ruta `app/api/booking/v1/internal/sweep/route.ts` siguen existiendo
y siendo invocables manualmente; `integrations/n8n/` sigue sin ningún
workflow definido (solo `compose.yml`/`README.md`); `compose.yml` raíz
sigue sin ningún servicio de cron/scheduler.

- **Qué puede probarse manualmente invocando el sweep**: la lógica de
  derivación de resolución (`deriveResolutionFromDecidedMeeting`) y la
  idempotencia del barrido — ya probadas, sin relación con esta subpuerta.
- **Qué queda bloqueado hasta tener scheduler**: que "Próximas citas" en
  el portal refleje automáticamente una decisión tomada en EspoCRM —
  sigue dependiendo de una invocación manual del sweep, inaceptable como
  experiencia de portal real.
- **5B-2B se detiene explícitamente antes de afirmar que "Próximas citas"
  se actualiza automáticamente** — ver §7.12: la pausa antes de
  aprobación es, precisamente, el límite de lo que 5B-2B puede demostrar.
- **5B-3 no puede comenzar** hasta que el mecanismo de webhook/polling
  (§9 de `fase4b-puerta5b-propuesta-v1.md`) esté resuelto y desplegado
  como su propia puerta — sin cambios en esta sesión.

## 9. Archivos modificados (solo repositorio)

| Archivo | Cambio |
|---|---|
| `apps/web/src/server/env.ts` | `ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS`/`ESPOCRM_CONTROLLED_TEST_RUN_ID` + validación |
| `apps/web/src/server/env.test.ts` | 8 pruebas nuevas |
| `apps/web/src/server/booking/controlledTestMode.ts` | Nuevo — decisión central |
| `apps/web/src/server/booking/controlledTestMode.test.ts` | Nuevo — 3 pruebas |
| `apps/web/src/server/booking/espoAdapter.ts` | `SimMeeting.cExcluirGoogleCalendarSync`, `CreateMeetingInput.controlledTestExcludeGcs`, guardia en `SimulatedEspoBookingAdapter` |
| `apps/web/src/server/booking/espoAdapter.test.ts` | 1 prueba nueva |
| `apps/web/src/server/booking/verificationSteps.ts` | Decisión central + comprobación de adopción |
| `apps/web/src/server/booking/verificationSteps.test.ts` | 5 pruebas nuevas |
| `apps/web/src/server/booking/httpEspoAdapter.ts` | `MEETING_SELECT_FIELDS`/esquema/payload/relectura + `ControlledTestExclusionUnverifiedError` |
| `apps/web/src/server/booking/httpEspoAdapter.test.ts` | 5 pruebas nuevas |
| `apps/web/src/server/booking/availability.test.ts` | Ajuste de fixture (campo nuevo obligatorio en `SimMeeting`) |
| `apps/web/src/server/booking/repository.ts` | Nueva entrada en `CONFLICT_TYPE_TO_AUDIT_REASON` |
| `apps/web/src/app/api/booking/v1/requests/route.ts` | `bodySchema` exportado (solo para pruebas) |
| `apps/web/src/app/api/booking/v1/requests/authenticated/route.ts` | `bodySchema` exportado (solo para pruebas) |
| `apps/web/src/app/api/booking/v1/requests/route.schema.test.ts` | Nuevo — 2 pruebas |
| `apps/web/tests/contract/fakeEspoServer.ts` | `blockGcsExclusionFieldWrites` (simula ACL `edit:no`) |
| `apps/web/tests/integration/booking.decisionRecovery.httpConflict.int.test.ts` | Ajuste de fixtures (campo nuevo obligatorio) |
| `packages/contracts/src/booking.ts` | `meeting_gcs_exclusion_mismatch` en `BOOKING_REVIEW_CONFLICT_TYPES` |
| `packages/contracts/src/audit.ts` | `MeetingGcsExclusionMismatch` en `AUDIT_REASON_CODES` |

Ningún archivo de EspoCRM/extensión GCS tocado en esta subpuerta (ya
desplegado por Puerta 6). Ningún `.env` real modificado.

## 10. Riesgos pendientes

1. `ESPOCRM_PROFESSIONAL_USER_IDS` sin decisión de negocio real —
   bloqueo heredado de Puerta 5B, no resuelto aquí, condición previa
   explícita para 5B-2B (§7.1, punto 3).
2. Scheduler/webhook para reconciliación automática — sigue bloqueando
   5B-3 (§8), sin cambios.
3. 4 pruebas de integración no relacionadas con esta subpuerta muestran
   fragilidad preexistente (no determinista entre ejecuciones) — no
   investigado aquí por estar fuera del alcance autorizado; recomendado
   como trabajo aparte antes de apoyarse en la suite de integración
   completa para futuras puertas.
4. La apertura de ACL real de 5B-2B (§7.4) sigue siendo el punto más
   sensible del procedimiento propuesto — requiere aprobación explícita
   propia, separada de la aprobación de este documento.

## 11. Verificación del entorno real (solo lectura, esta sesión)

- Ningún proceso de esta sesión contactó `gapssa-espocrm-1`/`localhost:8081`
  — todas las pruebas de integración usaron `gapssa-apps-db-1`/
  `gapssa-redis-1` (ya levantados, bases de `apps/web`, no de EspoCRM) y
  un `FakeEspoServer` en memoria.
- `docker ps` confirma `gapssa-espocrm-1`/`gapssa-espocrm-db-1` con el
  mismo estado que antes de esta sesión (no reiniciados, no tocados).
- `ESPO_BOOKING_ADAPTER` no se modificó en ningún `.env` real.
- Cero OAuth, cero tráfico Google (esta subpuerta no invoca la extensión
  GCS en ningún momento).
- Cero commits (`git status` sin cambios de índice).

---

**Puerta 5B-2A: implementada, probada, y detenida aquí, según lo
autorizado.** No se abrió ACL real, no se arrancó el proceso aislado
contra EspoCRM real, no se creó ninguna reserva real. 5B-2B queda
propuesta (§7) y pendiente de autorización explícita y separada.
