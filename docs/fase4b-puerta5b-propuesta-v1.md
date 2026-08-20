# Puerta 5B — v1: propuesta de conexión Web → BFF → EspoCRM real

**Estado**: propuesta documental únicamente. **No ejecutada, no iniciada.**
Requiere tu autorización explícita y separada, subpuerta por subpuerta
(§16) — aprobar este documento no autoriza ninguna de las tres subpuertas
por sí sola.

## 1. Estado actual y alcance exacto

- Puerta 5A (`docs/fase4b-puerta5-propuesta-v3.md`) validó `PutDecide`
  directamente contra EspoCRM real, vía `portal-gapssa-api`, **sin pasar
  por `apps/web`**. `ESPO_BOOKING_ADAPTER` permanece en `simulated` en
  todos los entornos (confirmado en la auditoría de cierre de
  2026-08-13, raíz `.env:126`).
- `HttpEspoBookingAdapter` (`apps/web/src/server/booking/httpEspoAdapter.ts`)
  existe, está probado (47/47 pruebas contractuales, Puerta 3D) y ya
  incorpora las correcciones de las Puertas 3C/3D (`name` fijo sin PII,
  `assignedUserId` vía allowlist), pero **nunca se ha ejecutado contra
  `gapssa-espocrm-1` real** — solo contra instancias desechables.
- Esta puerta es exclusivamente conectar ese adaptador ya existente al
  EspoCRM real, en tres pasos independientes y auditables (§16). No
  incluye reescribir el adaptador, ni cambiar el contrato de
  `EspoBookingAdapter`, ni tocar la Puerta 5A ya cerrada.

## 2. Variables necesarias

| Variable | Valor propuesto | Notas |
|---|---|---|
| `ESPO_BOOKING_ADAPTER` | `http` | Único interruptor que activa `HttpEspoBookingAdapter` (`apps/web/src/server/booking/adapterSelector.ts`) |
| `ESPOCRM_API_BASE_URL` | `http://espocrm` (interna, red Docker Compose) o `http://localhost:8081` (dev local fuera de Compose) | **Nunca** la URL pública de producción para los ensayos de 5B-1/5B-2 — evita cualquier exposición accidental a internet mientras se prueba |
| `ESPOCRM_API_KEY` | API Key **ya existente** de `portal-gapssa-api` | Mismo usuario/credencial que ejecutó la Puerta 5A — no se crea ninguna credencial nueva. Se lee desde secreto (variable de entorno gestionada, nunca en texto plano en el repo ni en logs) |
| `ESPOCRM_API_TIMEOUT_MS` | `8000` (default de `env.ts:394`) | Sin cambios respecto al default ya validado por pruebas |
| `ESPOCRM_API_MAX_RETRIES` | `2` (default) | Sin cambios |
| `ESPOCRM_API_RETRY_BASE_DELAY_MS` | `200` (default) | Sin cambios |
| `ESPOCRM_API_MAX_RESPONSE_BYTES` | `2_000_000` (default) | Sin cambios |
| `ESPOCRM_PROFESSIONAL_USER_IDS` | Lista real de profesionales, ya definida en la allowlist de EspoCRM | Obligatoria cuando `ESPO_BOOKING_ADAPTER=http` (`env.ts:460-464`) — sin ella, `parseServerEnv` falla al arrancar, por diseño (falla segura, no cae a `simulated`) |

**La API Key nunca se muestra** en ningún paso de esta puerta — ni en
comandos, ni en logs, ni en la entrega. Se referencia como
"`ESPOCRM_API_KEY` (secreto ya existente)".

## 3. Lectura efectiva de configuración y estrategia reversible

- Al igual que el incidente de §0.2 de `fase4b-puerta5-propuesta-v3.md`,
  cualquier verificación de configuración de esta puerta debe leer el
  valor efectivo tal como lo ve el proceso Node/Next.js en ejecución
  (`serverEnv` de `apps/web/src/server/env.ts`, ya parseado y validado por
  Zod), nunca asumir el contenido de un `.env` en disco sin confirmar que
  el proceso lo cargó.
- **Reversión a `simulated`**: cambiar `ESPO_BOOKING_ADAPTER=http` de
  vuelta a `simulated` en la variable de entorno del proceso y reiniciar
  `apps/web` — sin ninguna migración de datos, porque el adaptador
  simulado y el HTTP implementan la misma interfaz `EspoBookingAdapter`
  sin estado compartido en Postgres más allá de lo que ya gestiona
  `apps/web` (tablas de Fase 3/4A, no de EspoCRM). Reversión de un solo
  paso, sin ventana de indisponibilidad más allá del reinicio del proceso.
- Cada subpuerta (§16) debe confirmar, como primer paso, el valor
  efectivo de `ESPO_BOOKING_ADAPTER` antes de continuar — no se asume que
  sigue en el valor de la subpuerta anterior sin releerlo.

## 4. Health check de solo lectura

Debe distinguir explícitamente cuatro fallos posibles, sin mezclarlos en
un único booleano, y **sin ninguna escritura**:

1. **BFF sano**: `apps/web` arranca, `parseServerEnv` no lanza excepción
   con `ESPO_BOOKING_ADAPTER=http` — confirma que las 3 variables
   obligatorias (§2) están presentes y bien formadas.
2. **EspoCRM alcanzable**: `GET /api/v1/App/user` (o `GET /api/v1/Metadata`,
   ambos de solo lectura y estándar de EspoCRM) contra
   `ESPOCRM_API_BASE_URL`, sin credenciales de escritura — distingue
   "red/DNS/TLS falla" (excepción de conexión) de "EspoCRM responde".
3. **Autenticación válida**: la misma llamada, ahora con `X-Api-Key`, debe
   devolver `200`, no `401`. Un `401` aquí es un fallo de credencial, no
   de red — debe reportarse de forma distinguible del punto 2.
4. **Permisos suficientes**: `GET /api/v1/Meeting?maxSize=1` (lectura
   mínima, ya cubierta por el ACL que dejó la Puerta 3) debe devolver
   `200`, no `403`. Un `403` aquí indica que el ACL de `portal-gapssa-api`
   cambió respecto a lo que la Puerta 3/3C/3D dejaron — debe detener el
   avance a 5B-2 hasta investigarse, no asumirse como "probablemente
   sigue bien".

Los cuatro puntos se ejecutan y reportan por separado — un fallo en
cualquiera detiene el avance a la siguiente subpuerta, no se continúa
"total o parcialmente sano".

## 5. Primera prueba autenticada de solo lectura

- `GET /api/v1/Meeting/{id}` sobre un Meeting ya conocido y ya público en
  los documentos de cierre de la Puerta 5A — el Fixture A
  (`6a7cf117522f19bcf`) o el Fixture B (`6a7cf18e8d7531711`), ambos sin
  contactos ni PII (confirmado en la auditoría de 2026-08-13).
- **Actualización de línea base (2026-08-13, cierre de la limpieza de la
  Puerta 5A)**: los dos Fixtures A (nuevo y antiguo) y el Fixture B están
  ahora `soft-deleted` — ver `docs/fase4b-puerta5a-limpieza-propuesta.md`
  §12/§13. Un `GET` estándar contra la API REST los excluye por defecto
  (`404`), igual que el ORM (`BaseQueryComposer`, sin `withDeleted()`). Si
  esta subpuerta necesita seguir usando alguno de los tres como objeto de
  la primera prueba de lectura, deberá decidir explícitamente entre (a)
  usar un parámetro/mecanismo que incluya eliminados si la API lo expone, o
  (b) crear un Meeting de prueba nuevo específico para 5B-1 — ninguna de
  las dos opciones está decidida ni autorizada aquí.
- Objetivo: confirmar que `HttpEspoBookingAdapter` (o una llamada HTTP
  directa equivalente, antes de invocar el adaptador completo) puede leer
  un registro real y deserializar la respuesta sin error — sin usar
  ningún dato de un cliente real para esta primera prueba.
- No se leen Meetings reales de clientes en esta prueba — exclusivamente
  los dos Fixtures ya usados en la Puerta 5A, que ya son de prueba por
  diseño.

## 6. Primera reserva real desde la web

### 6.1 Cuenta local de prueba

- Cuenta de prueba en el sistema de autenticación de `apps/web` (Fase 3),
  nunca una cuenta de un cliente real. Creada por el mecanismo estándar de
  registro/OTP del propio portal — no una fila insertada a mano en
  Postgres.

### 6.2 Meeting real y `cBookingRequestId`

- El flujo estándar de `apps/web` (`guestFlow.ts`/`authenticatedFlow.ts`)
  genera `cBookingRequestId` de forma interna — esta puerta no cambia ese
  mecanismo, solo lo ejecuta contra `HttpEspoBookingAdapter` en vez del
  simulado. El `Meeting` resultante es real en `gapssa-espocrm-1`, con
  `cEstadoReserva=PendingCenterApproval` (mismo mapeo que valida
  `SyncEstadoReservaToStatus`, ya confirmado en la Puerta 5A).

### 6.3 Contact matching

- `HttpEspoBookingAdapter` ya implementa `findOrCreateContact`
  (`espoAdapter.ts` interfaz, `ContactMatchResult`) — esta puerta ejecuta
  ese camino ya probado contra EspoCRM real por primera vez. Si la cuenta
  de prueba (§6.1) usa un email/teléfono que no coincide con ningún
  `Contact` real, se espera creación de un `Contact` nuevo, marcado
  claramente como prueba en su `name` (mismo patrón `[PRUEBA PUERTA5B]`
  usado en Puertas anteriores) para poder identificarlo y limpiarlo
  después.

### 6.4 `PendingCenterApproval`

- Estado inicial esperado, igual que en la Puerta 5A — verificado por
  `GET /api/v1/Meeting/{id}` tras la creación, antes de continuar.

### 6.5 Aislamiento GCS explícito para el ensayo

- El `Meeting` de esta primera reserva real debe nacer con
  `cExcluirGoogleCalendarSync=true` — **el cliente nunca controla este
  campo** (ACL de `Portal GAPSSA API` para ese campo es `read:yes,
  edit:no`, confirmado en la auditoría de 2026-08-13; no cambia en esta
  puerta). El valor se fija server-side, en el propio `apps/web`, antes
  de construir el payload — nunca a partir de un parámetro que el
  navegador pueda influir.
- Cómo se logra sin que `portal-gapssa-api` tenga `edit=yes` permanente
  sobre ese campo: ver §7 — ventana ACL separada y mínima, exclusiva para
  esta subpuerta.

## 7. Ventana ACL mínima para `cExcluirGoogleCalendarSync=true` en la primera prueba integral

Este es el punto más sensible de la puerta — requiere su propio
procedimiento, análogo en rigor al de la activación del flag en la
Puerta 5A (§4.1/§4.6 de `fase4b-puerta5-propuesta-v3.md`):

1. **Backup** de `role.field_data` de `Portal GAPSSA API` antes de tocarlo
   (mismo mecanismo que la Puerta 3C — `docs/fase4b-puerta3c-meeting-name-acl.md`).
2. `field_data.Meeting.cExcluirGoogleCalendarSync` → `{read: yes, edit:
   yes}`, vía `EntityManager`/`saveEntity()` sobre el rol — nunca edición
   manual de tablas.
3. **El cliente nunca controla el valor** ni siquiera durante la ventana:
   el código de `apps/web` que construye el payload de creación fija
   `cExcluirGoogleCalendarSync=true` como constante para este ensayo — la
   ventana ACL abierta permite que `portal-gapssa-api` pueda escribirlo,
   pero no expone ningún control al usuario final del portal. El único
   riesgo que la ventana ACL introduce es que la propia credencial
   `portal-gapssa-api` **podría** escribir ese campo en cualquier otro
   Meeting mientras la ventana está abierta — de ahí que deba ser mínima
   en el tiempo.
4. **Restauración inmediata a `edit: no`** en cuanto el Meeting de prueba
   se ha creado y verificado (§6.4/§6.5) — nunca se deja la ventana
   abierta esperando el resto del recorrido de aprobación/rechazo (§8).
5. **Pausa si la restauración falla**: si el `saveEntity()` de vuelta a
   `edit: no` no puede confirmarse (excepción, o relectura posterior que
   siga mostrando `edit: yes`), la puerta se detiene de inmediato, se
   reporta como bloqueo, y no se continúa con ninguna reserva adicional
   hasta restaurar el ACL manualmente y confirmarlo — mismo principio que
   el invariante del flag en la Puerta 5A (§5 de
   `fase4b-puerta5-propuesta-v3.md`): nunca queda una ventana sensible
   abierta a la espera de una intervención posterior.

## 8. Flujo de aprobación

- **Decisión desde EspoCRM**: el equipo del centro decide
  Confirmar/Rechazar desde la vista nativa de `Meeting` en EspoCRM
  (mismos botones ya auditados en la pausa humana de la Puerta 5A,
  `detail.js:96-108`) — esta puerta no cambia ese mecanismo.
- **Mecanismo para que el BFF conozca la decisión**: aquí es donde esta
  puerta encuentra un bloqueo real — ver §9.
- **Actualización de "Próximas citas"**: la vista del portal lee el
  estado actual de la reserva desde Postgres (tablas de Fase 3/4A), no
  directamente de EspoCRM en cada carga de página — por lo que depende
  por completo de que algún mecanismo mantenga esa copia local
  sincronizada con la decisión tomada en EspoCRM.

## 9. Webhook o polling — bloqueo funcional concreto

**No existe ningún mecanismo que informe automáticamente a `apps/web` de
una decisión tomada en EspoCRM.** Evidencia concreta, no una suposición:

- `apps/web/src/server/booking/reconciliation.ts` implementa
  `runBookingReconciliationSweep()`, que sí sabe **cómo** derivar una
  resolución a partir de un `Meeting` ya decidido
  (`deriveResolutionFromDecidedMeeting` en `decisionRecovery.ts`) — la
  lógica de negocio existe y está probada.
- Ese barrido se expone vía
  `apps/web/src/app/api/booking/v1/internal/sweep/route.ts`, protegido
  por `X-Internal-Api-Secret`. El propio comentario del archivo lo dice
  explícitamente: *"pensado para invocarse desde un scheduler externo
  (cron/worker) — el propio scheduler queda fuera de alcance de esta
  fase"*.
- **No hay ningún cron, worker, ni workflow de `integrations/n8n` que
  invoque esta ruta hoy** (confirmado por lectura de
  `integrations/n8n/` y de `compose.yml` — no hay ningún servicio
  programado que la llame).
- Tampoco existe ningún webhook saliente de EspoCRM hacia `apps/web` — no
  hay ninguna ruta pública en `apps/web/src/app/api` diseñada para recibir
  una notificación push de EspoCRM, ni ninguna suscripción configurada en
  la extensión Google Calendar Sync o en EspoCRM core para ese propósito.

**Conclusión — no se inventa que el portal conocerá automáticamente la
decisión.** Sin uno de los dos mecanismos operativo, "Próximas citas"
solo se actualizaría si alguien invoca `/api/booking/v1/internal/sweep`
manualmente, lo cual no es una experiencia de portal aceptable para un
cliente real esperando saber si su cita fue aprobada. Esta puerta
**no puede alcanzar un recorrido integral end-to-end (5B-3, §16) sin
resolver esto primero** — dos caminos posibles, ninguno elegido aquí:

- **Polling programado**: dar de alta un scheduler (cron del propio
  Compose, o un workflow de `integrations/n8n` ya presente en el
  monorepo) que llame a `/api/booking/v1/internal/sweep` cada N minutos.
  Coherente con el propio comentario del código, que ya lo anticipa como
  el pendiente operativo natural.
- **Webhook desde EspoCRM**: un hook adicional (patrón ya usado por
  `GcsPush.php`) que, al guardar una decisión de `Meeting`, llame a una
  ruta nueva de `apps/web` — requeriría diseñar esa ruta, su
  autenticación, y su idempotencia, ninguno de los cuales existe hoy.

Ninguna de las dos opciones se implementa en esta propuesta — se deja
como decisión de arquitectura explícita para antes de autorizar 5B-3.

## 10. Reconciliación, idempotencia y fallos parciales

- `runBookingReconciliationSweep()` ya está diseñado para ser idempotente
  y recuperable (comentario del archivo: "basado en fechas de Postgres,
  nunca dependiendo solamente del TTL de Redis") — esta puerta reutiliza
  ese diseño ya existente, no propone uno nuevo.
- Fallos parciales durante la creación de la primera reserva real (§6):
  si `HttpEspoBookingAdapter.createMeeting()` falla tras crear el
  `Contact` pero antes de crear el `Meeting` (o viceversa), el
  comportamiento ya está definido por las pruebas contractuales
  existentes (`httpEspoAdapter.test.ts`) — esta puerta no cambia esa
  lógica, solo la ejecuta contra el EspoCRM real por primera vez y
  verifica que el resultado coincide con lo que las pruebas ya predicen.
- Cualquier discrepancia entre el comportamiento esperado (probado) y el
  observado contra `gapssa-espocrm-1` real es una condición de parada
  (§15), igual que en la Puerta 5A.

## 11. Datos personales temporales y purga

- La cuenta de prueba (§6.1) y el `Contact` que pueda crearse (§6.3) son
  datos personales de prueba, no de un cliente real — pero deben tratarse
  con la misma disciplina de purga que exige `apps/web` para datos reales
  (`reconcileOrphanedPendingPii`, `purgePendingGuestIdentity` en
  `repository.ts`/`reconciliation.ts`, ya existentes).
- Recomendación: usar un email/teléfono de prueba claramente distinguible
  (dominio reservado, p. ej. `+prueba-puerta5b@`) para poder identificar y
  purgar manualmente el `Contact` de EspoCRM y las filas de Postgres al
  cerrar la subpuerta 5B-2/5B-3 — purga que sería, igual que en la
  Propuesta A, una autorización separada, no automática.

## 12. Correos/OTP en entorno local

- El flujo de OTP de Fase 3 (`otpOutbox.ts`) ya soporta un modo no-envío
  real en entorno local (mismo mecanismo usado en todas las pruebas E2E
  previas de `apps/web`) — esta puerta no necesita configurar un SMTP
  real para las pruebas de navegador de §13, reutiliza ese outbox local
  ya existente.

## 13. Pruebas desde navegador (solo en 5B-3, tras resolver §9)

- Reserva completa desde el formulario del portal.
- Verificación del `Meeting` resultante en EspoCRM (vista nativa,
  inspección humana — mismo patrón que la pausa humana de la Puerta 5A).
- Aprobación desde EspoCRM por el equipo del centro.
- Portal actualizado — depende de que §9 esté resuelto; sin eso, este
  punto no es alcanzable de forma realista para un usuario real.
- Rechazo desde EspoCRM, mismo patrón de verificación.
- Caducidad (expiry) de una solicitud no decidida a tiempo — usando el
  mecanismo ya existente de `listExpiredApprovals`/`SYSTEM_EXPIRY_DECIDED_BY`
  en `decisionRecovery.ts`.
- Duplicados: reenvío del mismo formulario dos veces — debe comportarse
  igual que ya prueban los tests de idempotencia de Fase 4A, ahora contra
  el adaptador HTTP real.

## 14. Rollback inmediato a `simulated`

- Un solo cambio de variable de entorno (§3) — sin migración de datos.
- Si el rollback ocurre con la ventana ACL de §7 todavía abierta, la
  restauración del ACL (§7.4) tiene prioridad y se ejecuta primero, antes
  o junto con el cambio de adaptador — nunca se deja la ventana ACL
  abierta "porque ya se volvió a `simulated`".

## 15. Condiciones de parada

- Cualquier punto del health check (§4) que no dé el resultado esperado.
- La restauración del ACL de §7.4 no puede confirmarse (§7.5).
- Cualquier discrepancia entre el comportamiento observado y lo que
  predicen las 47 pruebas contractuales existentes de
  `httpEspoAdapter.test.ts`.
- Un `Contact` o `Meeting` de prueba que no pueda distinguirse
  claramente de un registro real (nombre sin el marcador `[PRUEBA
  PUERTA5B]` o equivalente).
- Cualquier tráfico hacia Google Calendar no explicado por la exclusión
  GCS de §6.5 — mismo criterio que la Puerta 5A.
- Llegar a 5B-3 sin que §9 esté resuelto y aprobado por separado.

## 16. Separación en subpuertas — cada una requiere autorización explícita propia

```
5B-1 ──► [tu autorización] ──► 5B-2 ──► [tu autorización] ──► 5B-3
```

- **5B-1 — configuración y health check de solo lectura** (§2–§5): fija
  las variables, ejecuta el health check de 4 puntos, hace la primera
  lectura autenticada sobre los Fixtures ya conocidos. **Cero
  escrituras.** Es la subpuerta de menor riesgo y la única candidata a
  autorizarse junto con esta propuesta, si así lo decides — pero sigue
  requiriendo tu confirmación explícita, no se ejecuta solo por aprobar
  este documento.
- **5B-2 — primera escritura controlada** (§6–§7, §10–§12): primera
  reserva real desde una cuenta de prueba, ventana ACL mínima, aislamiento
  GCS. Requiere 5B-1 ya cerrado y aprobado.
- **5B-3 — recorrido integral desde navegador** (§8–§9, §13): requiere que
  el bloqueo de §9 (webhook/polling) esté resuelto y desplegado como su
  propia puerta, además de 5B-2 ya cerrado.

---

## Resumen de bloqueos reales antes de poder ejecutar cualquier subpuerta

1. Ninguna variable de `ESPOCRM_API_*` está configurada en ningún entorno
   activo todavía — 5B-1 empieza por definirlas, no asume que ya existen.
2. **§9 — sin webhook ni polling operativo, 5B-3 no es alcanzable** tal
   como está el repositorio hoy. Esto es un bloqueo funcional real, no
   una formalidad — requiere una decisión de arquitectura y su propia
   implementación antes de poder autorizar 5B-3.
3. La ventana ACL de §7 necesita tu conformidad explícita sobre el
   mecanismo antes de 5B-2, dado que toca `role.field_data` de
   `Portal GAPSSA API` — mismo nivel de sensibilidad que la Puerta 3C.

**Queda a la espera de tu autorización explícita y separada, subpuerta
por subpuerta.** Para producir este documento solo se ha leído el
repositorio y se han hecho lecturas de solo lectura contra
`gapssa-espocrm-1` real como parte de la auditoría de cierre de
2026-08-13 (Fixtures A/B, ACL, config) — cero llamadas nuevas a EspoCRM
específicas para esta propuesta, cero cambios de `ESPO_BOOKING_ADAPTER`,
cero cambios de ACL, cero commits.

---

## 17. Ejecución real de la Subpuerta 5B-1 — bloqueada tras el health check (2026-08-13)

**Estado: EJECUTADA PARCIALMENTE, BLOQUEADA.** Autorizada explícitamente
el 2026-08-13, con precisiones de seguridad adicionales sobre este mismo
documento (proceso aislado, secretos nunca mostrados, select cerrado en
la capa de permisos). Construcción, health de 4 capas (3 de 4 en verde) y
validación de `parseServerEnv` completados; la capa de permisos reveló
una divergencia real que detiene el avance más allá de lo ya hecho aquí.

### 17.1 Precondiciones

Las 15 precondiciones se revalidaron en verde inmediatamente antes de
preparar la conexión: `app-check` verde, `maintenanceMode` ausente/NULL,
`gapssaBookingDecisionEnabled=false`, extensión GCS 1.2.0 con el hash
corregido de la Puerta 6C, `gcsSyncStartAt` intacto (vía el servicio
`Config` real), rol `Portal GAPSSA API` activo con
`cExcluirGoogleCalendarSync={read:yes,edit:no}` sin cambio, usuario y
equipo técnico intactos, `Meeting` activos `7`/soft-deleted `6`/histórico
`13`, 4 filas de idempotencia, `gcs_event_link=4`, ningún Fixture activo,
cero jobs GCS pendientes/reintentables, documentos y estado de git
reflejando el cierre de la Puerta 5A.

**Proceso principal (`apps/web`, `next dev`, puerto 3000)**: confirmado
`ESPO_BOOKING_ADAPTER=simulated` **mediante runtime, no solo `.env`** —
evidencia objetiva: el proceso arrancó el 2026-08-12 01:30:46 UTC (mismo
PID durante toda esta subpuerta) y el `.env` raíz no se ha modificado
desde el 2026-08-11 16:40:50 (mtime anterior al arranque del proceso), la
única fuente de configuración del proceso (`dotenv -e .env`, sin
`apps/web/.env*` que lo sobrescriba) — imposible que el proceso en marcha
haya cargado un valor distinto del que el archivo tiene hoy.

### 17.2 Topología descubierta

- `apps/web` corre en el **host** (`next dev`, no en contenedor) — mismo
  hecho ya documentado en el comentario de `server/env.ts:390`.
- Redes Docker de `gapssa-espocrm-1`: `gapssa_private`, `gapssa_public`
  (alias DNS `espocrm`/`gapssa-espocrm-1`), sin uso en esta subpuerta
  porque el proceso temporal también corre en el host.
- URL correcta desde el host: `http://localhost:8081` (confirmado con
  `GET /api/v1/App/user` sin credenciales → `401`, servidor responde).
- Mecanismo de configuración del proceso principal: `dotenv -e .env --
  npm run dev -w @gapssa/web` (script raíz `dev`), único archivo `.env`
  (no existe `apps/web/.env*`).
- Proceso temporal: `next dev --port <puerto libre>` con
  `NEXT_DIST_DIR=.next-puerta5b1-probe` — mismo patrón ya usado y
  auditado por `tests/integration/global-setup.ts` (puerto libre vía
  `net.createServer().listen(0, ...)`, `distDir` aislado para no competir
  por el mismo caché de build que el `next dev` de desarrollo).
- Aislamiento de tráfico de navegador: el proceso temporal escuchó
  únicamente en `127.0.0.1:<puerto efímero>`, nunca en una interfaz
  pública, y se detuvo (`SIGTERM`) inmediatamente al terminar la sonda —
  ninguna pestaña de navegador pudo alcanzarlo por no conocer el puerto
  ni persistir este más allá de la propia ejecución.

### 17.3 Secretos

- `ESPOCRM_API_KEY` del `User` `portal-gapssa-api`
  (`6a7b345b2624dbb56`, `type=api`, activo) localizada por lectura directa
  de MariaDB, redirigida a un archivo (nunca impresa en ninguna salida de
  esta sesión) y copiada a `.env.puerta5b1-probe` (raíz del repo), cubierto
  por el patrón `.env.*` de `.gitignore` (confirmado con `git check-ignore
  -v`), modo `600`.
- `ESPOCRM_PROFESSIONAL_USER_IDS`: no existe todavía ninguna decisión de
  negocio real sobre qué `User.id` cuentan como "profesional reservable"
  (confirmado: cero usuarios con el rol `Profesional Gapssa` asignado
  directamente vía `role_user`) — se usó un valor placeholder
  explícitamente no real (`puerta5b1-placeholder-not-a-real-user`) solo
  para satisfacer la validación de Zod (`ESPOCRM_PROFESSIONAL_USER_IDS`
  no vacío), sin invocar `listProfessionals()`/`getProfessional()` en
  ningún momento — esta subpuerta no decide ni usa esa lista.
- Archivo de secretos eliminado al cerrar la subpuerta (§17.6) — no forma
  parte de la configuración local permanente todavía.
- No se creó ni rotó ninguna credencial. No se leyó ni mostró OAuth,
  tokens de Google ni contraseñas.

### 17.4 Configuración del proceso aislado

- `ESPO_BOOKING_ADAPTER=http`, `ESPOCRM_API_BASE_URL=http://localhost:8081`,
  `ESPOCRM_API_KEY` (secreto ya existente), `ESPOCRM_PROFESSIONAL_USER_IDS`
  (placeholder, §17.3) — resto de variables (`ESPOCRM_API_TIMEOUT_MS`,
  `ESPOCRM_API_MAX_RETRIES`, `ESPOCRM_API_RETRY_BASE_DELAY_MS`,
  `ESPOCRM_API_MAX_RESPONSE_BYTES`) en sus defaults documentados (§2 de
  este documento) — nunca sobrescritas.
- Nunca se modificó `.env` ni ningún archivo cargado por el proceso
  principal — el hijo temporal recibió su entorno exclusivamente vía el
  objeto `env` de `child_process.spawn()`, nunca escrito a disco salvo el
  propio `.env.puerta5b1-probe` (secretos), ya eliminado.
- `parseServerEnv` (función pura, `server/env.ts:474`) verificado
  directamente, sin red, vía una sonda temporal de Vitest (`vitest run`
  sobre un único archivo, eliminado al terminar): falla con
  `ESPOCRM_API_BASE_URL` ausente, falla con `ESPOCRM_API_KEY` ausente,
  falla con `ESPOCRM_PROFESSIONAL_USER_IDS` ausente, resuelve a `http` con
  la configuración completa, y por defecto (sin `ESPO_BOOKING_ADAPTER`)
  sigue siendo `simulated` — nunca cae en silencio al simulado cuando se
  pide `http` incompleto. 6/6 aserciones en verde.
- Construcción real de `HttpEspoBookingAdapter` con la forma exacta de
  configuración que usa `adapterSelector.ts` (los mismos 7 campos):
  construcción sin excepción, sin ninguna llamada de red (el constructor
  solo asigna `this.config`, confirmado leyendo el código fuente).
  `getEspoBookingAdapter()` no se reejecutó en vivo (evita un falso
  resultado por el singleton `serverEnv` ya cacheado por otra prueba en el
  mismo proceso de Vitest) — su lógica de selección (`serverEnv.ESPO_BOOKING_ADAPTER
  === 'simulated' ? Simulated : new HttpEspoBookingAdapter(...)`) se
  verificó por lectura directa del código fuente, no por ejecución.

### 17.5 Health de cuatro capas

| Capa | Resultado | Detalle |
|---|---|---|
| 1. BFF | **OK** | Proceso temporal arrancado (`next dev`, `NEXT_DIST_DIR` aislado), `GET /api/health/live` → `200 {"status":"ok"}`. Detenido con `SIGTERM`, `exitCode=0`. |
| 2. Red | **OK** | `GET http://localhost:8081/api/v1/App/user` sin credenciales → `401` en 45ms — servidor responde, no es fallo de red (distinguido explícitamente de una excepción de conexión). |
| 3. Autenticación | **OK** | Misma llamada con `X-Api-Key` → `200`. Identidad devuelta por ID/tipo únicamente: `id=6a7b345b2624dbb56`, `type=api` — coincide exactamente con el `User` `portal-gapssa-api` localizado en §17.3. Sin nombre, correo ni otros datos mostrados. |
| 4. Permisos | **BLOQUEADO** | `GET /api/v1/Meeting?maxSize=1&select=id,cBookingRequestId,cEstadoReserva,status,cExcluirGoogleCalendarSync` → `200`, `total=7` (coincide con el conteo real de Meetings activos). **Pero la fila devuelta incluyó 3 campos no solicitados**: `dateStart`, `dateEnd`, `assignedUserId` — este último explícitamente prohibido por el encargo de esta subpuerta para esta comprobación. Cero campos de `Contact`/`User` (nombre, correo, teléfono), cero `description`/notas — no es un incidente de PII equivalente al de `docs/fase4b-integracion-http.md` §1, pero sí incumple el cierre exacto de campos pedido. |

**Condición de parada activada**: "una consulta segura no puede limitar
campos" (una de las condiciones de parada explícitas del encargo). Esta
sesión se detuvo en este punto — no se intentó ninguna otra consulta
en vivo contra `Meeting`, `Contact` ni `User` después de esta
observación, y no se ejecutó la prueba de lectura de catálogo
(`listTreatments()`/`listZones()`, §17.6) que sí estaba disponible como
alternativa segura, precisamente para no seguir avanzando tras el
disparo de la condición de parada.

**Causa probable, no confirmada**: EspoCRM 10.0.3 puede estar incluyendo
determinados campos "siempre presentes" en las respuestas de `Meeting`
(p. ej. campos usados internamente por el propio framework para
enlaces/permisos) independientemente del parámetro `select`, en vez de
respetarlo de forma estrictamente cerrada. **No confirmado por qué
exactamente estos tres campos** — requeriría inspección del core de
EspoCRM o de la documentación oficial de la API v1, fuera del alcance de
esta subpuerta de solo lectura.

**Nota de contexto, no una justificación para continuar**: los tres
campos observados (`dateStart`, `dateEnd`, `assignedUserId`) ya forman
parte de `MEETING_SELECT_FIELDS`, el select real y ya auditado que usa
`HttpEspoBookingAdapter` en operación normal (Fase 4B) — son campos que
el adaptador real está autorizado a leer en su funcionamiento habitual.
La divergencia es exclusivamente respecto al conjunto MÁS ESTRECHO que
esta comprobación de salud concreta pedía, no una fuga hacia datos que el
adaptador no debería ver nunca.

### 17.6 Máximo de lectura segura alcanzado

Por la condición de parada de §17.5, esta subpuerta **no ejecutó**
`listTreatments()`/`listZones()` (la lectura seguía disponible como
opción — catálogo de tratamientos/zonas, sin relación con `Meeting`,
`Contact` ni `User` — pero no se usó, para no ampliar el alcance tras el
bloqueo). El máximo alcanzado es: **construcción de
`HttpEspoBookingAdapter` + validación de `parseServerEnv` (sin red) +
health de red/autenticación en verde**, exactamente la alternativa que
este mismo documento (§5, actualización de línea base) preveía si ningún
otro camino resultaba seguro.

### 17.7 Evidencia de cero escrituras

- `Meeting`: activos `7`, soft-deleted `6`, total `13` — idénticos antes
  y después (comparado contra la línea base de la Puerta 5A, revalidada
  como precondición en §17.1 y releída de nuevo al cerrar).
- `Contact` activos: `1` (sin cambio — cero llamadas a
  `findOrCreateContact`/`POST /api/v1/Contact` en ningún momento).
- `User` activos: `5` (sin cambio — cero `User` creados).
- `gapssa_meeting_decision_operation`: `4` filas, sin cambio.
- `gcs_event_link`: `4`, sin cambio.
- Jobs de clase `GoogleCalendarSync`: cero filas nuevas desde el cierre de
  la Puerta 5A.
- `GcsAccount`: `status`, hash de `lastError`, `lastSyncAt`,
  `tokenExpiresAt`, `modifiedAt` — los cinco idénticos antes y después.
- Postgres `gapssa_booking` (9 tablas): ninguna tocada — el proceso
  temporal solo recibió una petición (`GET /api/health/live`), que no
  importa `env.ts`, Payload ni ningún repositorio de `booking/`; ningún
  otro código con capacidad de escritura llegó a ejecutarse. No se creó
  ninguna base de datos `_test_*` nueva (a diferencia del arnés de
  integración) — `psql -l` muestra únicamente `gapssa_auth`,
  `gapssa_booking`, `gapssa_cms` reales, sin ninguna adicional.
- ACL/configuración real de EspoCRM: sin cambio (todas las llamadas de
  esta subpuerta fueron `GET`).
- Cero OAuth, cero tráfico hacia Google Calendar (esta subpuerta nunca
  invoca la extensión GCS).

### 17.8 Rollback y cierre

1. Proceso temporal detenido con `SIGTERM`, `exitCode=0`, puerto liberado
   (confirmado: sin procesos escuchando en el puerto efímero usado tras
   el cierre).
2. Artefactos temporales eliminados: archivo de prueba de Vitest
   (`src/server/booking/__puerta5b1Probe.test.ts`), directorio de build
   aislado (`apps/web/.next-puerta5b1-probe`), archivo de secretos
   (`.env.puerta5b1-probe`), scripts de la sonda en el scratchpad de la
   sesión.
3. Secretos: confirmado que `.env.puerta5b1-probe` ya no existe;
   `git status`/`git check-ignore` no muestran ningún rastro.
4. Proceso principal: mismo PID (`45721`) durante toda la subpuerta,
   nunca reiniciado, `ESPO_BOOKING_ADAPTER=simulated` confirmado por
   runtime (§17.1).
5. `localhost:3000` operativo: `GET /api/health/live` → `200
   {"status":"ok"}` tras el cierre de la subpuerta.
6. `app-check` final de EspoCRM: verde en las 4 comprobaciones.
7. Conteos críticos repetidos al cierre: idénticos a §17.7.

### 17.9 Corrección explícita — `assignedUserId` no está prohibido con carácter general

La entrega previa de esta subpuerta afirmó, de forma imprecisa, que
`assignedUserId` estaba "prohibido". Queda corregido:

- Lo que el encargo prohibía era **mostrar su valor procedente de una cita
  real** durante ese health check concreto de permisos, con un `select`
  deliberadamente más estrecho que el habitual.
- `assignedUserId` **forma parte legítima** del modelo técnico de
  `Meeting` y de `MEETING_SELECT_FIELDS`, el select ya auditado que
  `HttpEspoBookingAdapter` usa en su operación normal (Fase 4B) — el
  adaptador real está autorizado a leerlo siempre.
- Dentro del servidor puede tratarse como un identificador opaco (un
  `User.id` de referencia, no un dato de identidad en sí mismo).
- Lo que sigue sin ser aceptable es exponerlo **innecesariamente** en
  informes o respuestas dirigidas fuera del propio servidor cuando no
  aporta valor a esa respuesta concreta — el criterio es la necesidad de
  la salida, no el campo en abstracto.

## 18. Reanudación de 5B-1 — diagnóstico, health sin filas reales y cierre (2026-08-13)

**Estado: 5B-1 CERRADA.** Autorizada explícitamente para retomarse con un
alcance exacto de 4 pasos (diagnóstico, health sin filas reales,
comprobación del adaptador, cierre) — completados los 4, todas las
garantías se cumplieron.

### 18.1 Fase 1 — diagnóstico de la proyección ampliada, por lectura del código vivo

Diagnóstico exclusivamente por lectura de código y metadata en vivo
(`gapssa-espocrm-1` real) — ninguna llamada a la API en esta fase, cero
filas de `Meeting` leídas.

**Mecanismo central**: `application/Espo/Core/Select/Select/Applier.php`
(núcleo de EspoCRM 10.0.3, no la extensión GCS ni código custom de
GAPSSA) — la clase que traduce el parámetro `select` en la lista final de
atributos de la consulta ORM. Añade atributos por 3 rutas independientes,
**después** de procesar el `select` solicitado:

| Campo | Componente que lo añade | Motivo | ¿Evitable? | Impacto de seguridad |
|---|---|---|---|---|
| `assignedUserId` | `Applier::getAclAttributeList()` — lista hardcodeada `['assignedUserId', 'createdById']` en el propio núcleo (activa porque `selectDefs.Meeting.aclAttributeList` no está personalizado, confirmado `NULL` vía `Metadata::get()`) | EspoCRM necesita este atributo, en el propio proceso PHP, para que la capa de ACL de fila (`scopes.Meeting.acl=true`, ACL de tipo asignado/equipo) pueda evaluar si el usuario puede ver el registro — se añade a **cualquier** entidad con ACL de fila, para **cualquier** `select` restringido, no solo para `Meeting` ni para GAPSSA | No mediante `select=` — solo personalizando `selectDefs.Meeting.aclAttributeList` en metadata para excluirlo, lo cual rompería la comprobación de ACL de fila para esa entidad (desaconsejado) | Bajo: es un ID de referencia, no PII; el rol `Portal GAPSSA API` ya tiene `assignedUser.read=yes` explícito (confirmado en `role.field_data`); mismo campo que `MEETING_SELECT_FIELDS` ya usa legítimamente |
| `dateStart` | `Applier::getSelectAttributeList()`, rama de `orderBy` — `$searchParams->getOrderBy() ?? $metadataProvider->getDefaultOrderBy('Meeting')` | La comprobación de la sesión anterior no pasó ningún `orderBy` explícito; EspoCRM aplicó el orden por defecto de la colección (`entityDefs.Meeting.collection.orderBy = "dateStart"`, valor de núcleo, no de GAPSSA) y añadió los atributos que ese orden necesita | **Sí** — pasando un `orderBy` explícito distinto (p. ej. `orderBy=id`) se evita el fallback | Bajo: `dateStart.read=yes` ya explícito para este rol; mismo campo de `MEETING_SELECT_FIELDS` |
| `dateEnd` | `Applier::getSelectAttributeList()`, rama `selectAttributesDependencyMap` — `selectDefs.Meeting.selectAttributesDependencyMap` (núcleo) declara `"dateStart": ["dateEnd"]` (y `"duration"`/`"dateStartDate"` dependen de ambos) | Consecuencia directa de que `dateStart` quedó seleccionado (fila anterior) — dependencia declarada para no servir nunca un rango de fechas incompleto | Sí, indirectamente — evitando que `dateStart` se seleccione (ver fila anterior) | Igual que `dateStart` |

**Respuestas directas a las preguntas del encargo**:

- **¿La API añade estos campos a toda respuesta `Meeting`?** `assignedUserId` (o `createdById`, si tuviera `read:yes`): sí, a cualquier respuesta con `select` restringido para un usuario/rol con ACL de fila sobre `Meeting` — mecanismo incondicional del núcleo. `dateStart`/`dateEnd`: no a *toda* respuesta, solo cuando no se pasa `orderBy` explícito (o cuando `dateStart` ya quedó seleccionado por otra vía).
- **¿Solo ocurre en listados?** No — `Select\Select\Applier` es el mismo componente que usa tanto `GET /Meeting` (listado) como `GET /Meeting/{id}` (registro único); ambos pasan por el mismo `SelectBuilder`. Confirmado por lectura del código, no probado en vivo contra `GET /Meeting/{id}` (no autorizado, no necesario para el diagnóstico).
- **¿Depende del ordenamiento predeterminado?** `dateStart` sí (rama `orderBy`); `dateEnd` depende transitivamente (dependencia declarada de `dateStart`); `assignedUserId` no depende del ordenamiento — es incondicional vía ACL.
- **¿`assignedUserId` es necesario por alguna relación/campo enlazado?** Es necesario porque el tipo de ACL de `Meeting` usa el propio valor de `assignedUserId` como discriminador de visibilidad de fila — EspoCRM lo necesita en el proceso PHP para evaluar la ACL, no por un JOIN adicional.
- **¿Puede evitarse con otro endpoint o parámetros documentados?** `dateStart`/`dateEnd`: sí, con `orderBy` explícito (verificado en Fase 2, §18.2). `assignedUserId`: no hay ningún parámetro documentado que lo suprima — es un atributo de ACL de núcleo.
- **¿El API User puede leer otros campos no solicitados además de estos tres?** Solo si un campo estuviera simultáneamente en `aclAttributeList`/la cadena `orderBy`+`selectAttributesDependencyMap` **y** tuviera `read:yes` en el ACL del rol. Confirmado con el `field_data` completo del rol `Portal GAPSSA API`: `createdBy` (→ `createdById`) tiene `read:no` y, en efecto, **no apareció** en la respuesta observada — prueba directa de que el filtro de ACL de campo sí actúa sobre la salida JSON incluso cuando el atributo se recuperó internamente para la comprobación de ACL de fila. Ningún otro atributo de `selectAttributesDependencyMap` se dispara sin que su atributo raíz ya esté seleccionado.

**Conclusión de la Fase 1**: no es un fallo de ACL ni una fuga hacia datos
no autorizados — es el mecanismo de ACL de fila de EspoCRM funcionando
como está diseñado, combinado con un `orderBy` por defecto no solicitado
explícitamente en la comprobación anterior. `createdById` es la prueba
de control: el mismo mecanismo lo intentó incluir y el ACL de campo lo
bloqueó correctamente antes de servirlo.

### 18.2 Fase 2 — health de permisos sin filas reales

1. Identificador generado con `crypto.randomBytes(16)` (CSPRNG):
   `health-5b1-188370f83fb113ae54ff8df145f87eb7`.
2. **Confirmación previa a su uso**, por consulta directa de conteo contra
   MariaDB (`SELECT COUNT(*) FROM meeting WHERE c_booking_request_id=...`):
   `0` — no coincide con ningún `Meeting` real.
3. `GET /api/v1/Meeting` con `select=id,cBookingRequestId,cEstadoReserva,status,cExcluirGoogleCalendarSync`,
   `maxSize=1`, `orderBy=id` (explícito, para no depender del orden por
   defecto — ver Fase 1), `where[0]` = `equals cBookingRequestId
   health-5b1-188370f83fb113ae54ff8df145f87eb7`.
4. **Resultado**: `HTTP 200`, `total=0`, `list=[]` (array vacío,
   confirmado). Ninguna fila devuelta — imposible que se materializara
   ningún `dateStart`/`dateEnd`/`assignedUserId` real, con independencia
   de la ampliación de proyección diagnosticada en la Fase 1.
5. Certificado por esta consulta: conectividad, autenticación, permiso de
   lectura de `Meeting`, capacidad de filtrar por `cBookingRequestId`,
   respuesta paginada válida — sin exponer ningún dato real.

### 18.3 Fase 3 — comprobación del adaptador

Sonda temporal de Vitest (`src/server/booking/__puerta5b1Fase3.test.ts`,
eliminada al cerrar), sin proceso `next dev` esta vez (innecesario para
esta fase — construcción directa + llamadas de red vía `fetch`, sin
servir ningún endpoint propio):

1. `parseServerEnv` con la configuración aislada completa
   (`ESPO_BOOKING_ADAPTER=http`, URL real, API Key real vía variable de
   entorno del proceso hijo únicamente, allowlist placeholder) → resuelve
   exactamente a `ESPO_BOOKING_ADAPTER: 'http'`. **PASS**.
2. `adapterSelector.ts` construye `HttpEspoBookingAdapter` — verificado
   por lectura de código en la sesión anterior (§17.4) más, en esta
   sesión, construcción directa exitosa del mismo tipo con la misma forma
   de configuración. **PASS**.
3. `HttpEspoBookingAdapter.findMeetingByBookingRequestId('health-5b1-188370f83fb113ae54ff8df145f87eb7')`
   → `{ outcome: 'not_found' }`. Internamente usa `MEETING_SELECT_FIELDS`
   (autorizado explícitamente para este caso porque el filtro garantiza
   cero filas — nunca usado con un identificador real). **PASS**.
4. Cero filas reales obtenidas ni registradas (`outcome: 'not_found'` no
   contiene ningún dato de `Meeting`). **PASS**.
5. Operación puramente de lectura (`GET` interno) — cero escritura.
   **PASS**.
6. Ningún fallback silencioso a `simulated`: `parseServerEnv` resolvió
   `http` explícitamente (punto 1) y el adaptador construido fue
   `HttpEspoBookingAdapter`, nunca `SimulatedEspoBookingAdapter`. **PASS**.

2/2 archivos de prueba, 3/3 aserciones en verde (1 de `parseServerEnv` +
2 de `findMeetingByBookingRequestId`).

### 18.4 Fase 4 — cero escrituras (repetido al cierre)

| Comprobación | Antes de esta reanudación | Después | Coincide |
|---|---|---|---|
| `Meeting` activos / soft-deleted / total | `7` / `6` / `13` | `7` / `6` / `13` | Sí |
| `Meeting` con `cBookingRequestId=health-5b1-...` | — | `0` | Sí (nunca se creó ninguno) |
| `Contact` activos | `1` | `1` | Sí |
| `User` activos | `5` | `5` | Sí |
| `gapssa_meeting_decision_operation` | `4` | `4` | Sí |
| `gcs_event_link` | `4` | `4` | Sí |
| Jobs `GoogleCalendarSync` nuevos | `0` | `0` | Sí |
| `GcsAccount` (`status`, hash `lastError`, `lastSyncAt`, `tokenExpiresAt`, `modifiedAt`) | sin cambio | idéntico | Sí |
| Postgres `gapssa_booking` (6 tablas verificadas) | `4/0/1/0/1/1` | `4/0/1/0/1/1` | Sí |
| ACL `Portal GAPSSA API` / `Profesional Gapssa` | sin tocar | sin tocar | Sí |

- **Cero OAuth, cero Calendar**: `data/logs/espo-2026-08-13.log` sin
  ninguna línea nueva de OAuth/Calendar tras el marcador de esta
  reanudación — las únicas presentes siguen siendo las dos del incidente
  de la Puerta 5A (08:00:39/08:00:49).
- **Cero PII en logs**: barrido del log de la ventana horaria de esta
  reanudación sin coincidencias de patrones de correo/nombre/teléfono.
- **Cero secretos persistidos**: `.env.puerta5b1-probe` eliminado;
  `git status`/`git diff --stat` sin ninguna mención a la clave ni al
  archivo.

### 18.5 Cierre

1. Ningún proceso temporal que detener en esta reanudación (Fase 2/3 no
   necesitaron `next dev`, solo `fetch` directo y Vitest) — nada que
   liberar en cuanto a puertos.
2. Artefactos eliminados: `apps/web/src/server/booking/__puerta5b1Fase3.test.ts`,
   `.env.puerta5b1-probe`, scripts de la sonda en el scratchpad de la
   sesión.
3. `ESPOCRM_API_KEY`: confirmado ausente de `git status`, `git diff
   --stat`, y de esta documentación — nunca impresa en ninguna salida de
   herramienta de esta sesión.
4. Proceso principal: mismo PID (`45721`), nunca reiniciado,
   `ESPO_BOOKING_ADAPTER=simulated` confirmado por runtime (mismo método
   de §17.1: `.env` sin modificar desde antes del arranque del proceso).
5. `localhost:3000/api/health/live` → `200 {"status":"ok"}`.
6. `app-check` final: verde en las 4 comprobaciones.

### 18.6 Bloqueos para 5B-2

Ninguno nuevo introducido por esta reanudación. Los ya conocidos siguen
vigentes sin cambio: la ventana ACL mínima de `cExcluirGoogleCalendarSync`
(§7) sigue sin abrirse; el mecanismo de webhook/polling (§9) sigue sin
resolver, bloqueando 5B-3 más adelante. **5B-2 no se ha iniciado.**
`ESPO_BOOKING_ADAPTER` permanece en `simulated` en el proceso principal.
No se ha creado ninguna reserva real. Cero commits.

---

**Puerta 5B-1: cerrada.** Diagnóstico de la proyección ampliada
completado por lectura de código (§18.1), health de permisos certificado
sin exponer ninguna fila real (§18.2), adaptador construido y verificado
con resultado `not_found` (§18.3), cero escrituras confirmadas (§18.4).
5B-2 permanece sin autorizar.

## 19. Subpuerta 5B-2A — modo de ensayo controlado, implementada y probada (2026-08-13)

**Estado: 5B-2A cerrada. 5B-2B sigue sin autorizar.** Autorizada
explícitamente el 2026-08-13 con alcance exacto de 7 puntos: auditar el
flujo real de creación desde `apps/web`, diseñar e implementar un modo
server-only para que la primera reserva de 5B-2 nazca con
`cExcluirGoogleCalendarSync=true` sin que el cliente pueda controlarlo ni
el proceso principal pueda activarlo por accidente, probarlo offline,
preparar (sin ejecutar) el procedimiento real de 5B-2B, y detenerse sin
escribir en `gapssa-espocrm-1`.

Entrega completa (auditoría, diseño, contratos, pruebas, diseño del
proceso aislado, propuesta de procedimiento 5B-2B, auditoría del bloqueo
de reconciliación, verificación del entorno real) en
`docs/fase4b-puerta5b-primera-reserva.md` — no se duplica aquí para no
crear una segunda fuente de verdad; solo se deja constancia del resultado:

- Mecanismo implementado: `ESPOCRM_CONTROLLED_TEST_EXCLUDE_GCS`/
  `ESPOCRM_CONTROLLED_TEST_RUN_ID` (`server/env.ts`), decisión central
  única en `server/booking/controlledTestMode.ts`, consumida por
  `verificationSteps.completeBookingToMeeting` (único llamante real de
  `adapter.createMeeting`, compartido por invitado y autenticado).
  `HttpEspoBookingAdapter` nunca inventa `true`: relee por `select=`
  cerrado tras crear y falla de forma recuperable
  (`ControlledTestExclusionUnverifiedError`) si no puede confirmarlo.
  `SimulatedEspoBookingAdapter` lanza si se le pide honrarlo (defensa en
  profundidad).
- 18/18 puntos del checklist de pruebas del encargo cubiertos; 758/758
  pruebas unitarias en verde; typecheck y lint limpios; build de
  producción exitoso sin fuga al bundle de cliente; pruebas de
  integración directamente relacionadas en verde (28/28, dos archivos +
  el archivo de fixtures ajustado). 4 pruebas de integración NO
  relacionadas con esta subpuerta mostraron fragilidad preexistente no
  determinista — documentado como riesgo pendiente, no investigado por
  estar fuera de alcance.
- Ensayo desechable NO repetido — la Puerta 6 (§9 de
  `fase4b-puerta6-exclusion-gcs.md`) y la propia Puerta 5B-1 (§17–18 de
  este documento) ya demostraron, con EspoCRM real y desechable
  respectivamente, exactamente el comportamiento de ACL que esta
  subpuerta necesitaba verificar.
- Procedimiento real de 5B-2B propuesto en detalle (precondiciones,
  backup, apertura/cierre de ACL, validación, condiciones de parada) —
  **no ejecutado**. Requiere autorización explícita y separada.
- Scheduler/webhook (§9 de este documento) sigue sin resolver — bloqueo
  de 5B-3 sin cambios en esta subpuerta.
- `ESPO_BOOKING_ADAPTER` permanece `simulated` en el proceso principal;
  `gapssa-espocrm-1` intacto (ninguna llamada de esta subpuerta lo
  contactó); cero commits.
