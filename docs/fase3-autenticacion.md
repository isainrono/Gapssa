# Fase 3 — Autenticación y base del portal privado del cliente

Entregable de cierre de la Fase 3 (`PLAN_DESARROLLO_WEB_PORTAL.md` §17,
"Autenticación y portal base"). Redactado el 6 de agosto de 2026.
**Revisión 2**, el 7 de agosto de 2026: corrige ocho hallazgos de una
segunda revisión de seguridad sobre la implementación real (no solo el
diseño) — OTP/PII en logs del transportador de correo, ausencia total de
ruta de recuperación en registro/verificación (cuenta sin credencial,
`already_consumed` bloqueando permanentemente una cuenta cuyo código fue
correcto, sin endpoint de reenvío), ausencia total de validación de edad
real en el vínculo tutor–menor, `new Date()` aceptando fechas de
nacimiento imposibles, `sha256(email)` sin secreto como clave de límite de
frecuencia, confianza ciega en la primera entrada de `X-Forwarded-For`, y
varias transiciones de estado con patrón SELECT→UPDATE vulnerable a
carreras. Ninguno de estos hallazgos afectaba al diseño documentado más
abajo — todos eran divergencias entre ese diseño y el código real. Detalle
completo, causas raíz y pruebas en la revisión de código correspondiente;
resumen de qué cambió, sin tocar el resto del documento (sigue vigente):

- **Correo/mailer** (`server/auth/mailer.ts`): eliminado el volcado por
  consola (y el mecanismo `DEV_MAILER_LOG_FILE`) de destinatario/asunto/
  cuerpo/OTP. Sin SMTP configurado, solo se registra un evento genérico
  `mail_queued`, sin destinatario ni contenido. La suite de integración
  usa un buzón SMTP efímero en proceso (`tests/integration/mailbox.ts`,
  equivalente funcional de Mailpit) como canal de entrega real — nunca
  vuelve a leer un log de aplicación.
- **Registro/verificación recuperables**: `createAccountWithPasswordCredential`
  crea cuenta+credencial en una sola transacción Postgres (nunca una cuenta
  sin credencial). Nuevo `POST /api/auth/verify-email/resend` (respuesta
  genérica, solo emite reto para cuentas `pending_verification`,
  reemplaza explícitamente la solicitud pendiente anterior). Re-registrar
  una cuenta `pending_verification` reemite un código en vez de un
  callejón sin salida. `otpService.verifyOtp` distingue, incluso tras
  `already_consumed`, si el código reenviado es el correcto
  (`codeMatchesConsumedChallenge`) — solo entonces `completeEmailVerification`/
  `completePasswordReset` (repository.ts, idempotentes, con bloqueo de
  fila) completan la activación/rotación que quedó a medias por un fallo
  de infraestructura. Mismo mecanismo para recuperación de contraseña.
- **Tutor–menor real** (`server/auth/guardian.ts`): `requestGuardianLink`
  exige ahora que quien solicita sea adulto/activo/verificado y que el
  objetivo sea menor/activo/verificado, colapsando todo motivo de rechazo
  del objetivo en una única respuesta genérica (`invalid_target`) para no
  habilitar enumeración de edad/estado de un correo de tercero.
  `confirmGuardianLink` vuelve a comprobar la edad en el momento de
  confirmar (no solo al solicitar) y su transición es un único
  `UPDATE ... WHERE status = 'pending_minor_confirmation' ... RETURNING`;
  `revokeGuardianLink` pasa a `UPDATE ... WHERE status IN (...) ...
  RETURNING` — ninguna de las dos vuelve a ser un SELECT seguido de un
  UPDATE incondicional.
- **Fecha de nacimiento estricta** (`packages/contracts/src/auth.ts`):
  `parseStrictIsoDate`/`isValidDateOfBirth` sustituyen la combinación
  regex + `new Date()`, que aceptaba fechas normalizadas como
  "2026-02-31". `decideAccountAgeCategory` reutiliza el mismo parser.
- **Identificadores de sujeto derivados de correo**: nueva
  `hmacSubjectId` (`packages/contracts/src/security.ts`) con secreto
  propio (`AUTH_RATE_LIMIT_HMAC_SECRET`, sin valor por defecto) sustituye
  `sha256(email)` sin secreto en la clave de límite de frecuencia de
  login.
- **Confianza en la IP del cliente** (`server/auth/httpHelpers.ts`):
  `getClientIp` ya no toma ciegamente la primera entrada de
  `X-Forwarded-For` (aportada por quien hace la petición). Cuenta
  `TRUSTED_PROXY_HOP_COUNT` saltos desde la derecha (1 por defecto, un
  único Plesk/nginx delante de Next.js) y valida formato IPv4/IPv6 y
  longitud antes de devolver o persistir cualquier valor.
- **Transiciones atómicas adicionales**: independencia
  (`markIndependenceRequestConfirmed`/`setAccountIndependenceStatusIf`),
  eliminación de cuenta (`setAccountStatusIfNot`) y el marcado de sesión
  expirada dentro de `getActiveSessionFromCookies` pasan al mismo patrón
  `UPDATE ... WHERE <condición> ... RETURNING`, evitando auditorías
  duplicadas de una única transición real.

Complementa, no sustituye, `PROJECT_CONTEXT.md`, `PLAN_DESARROLLO_WEB_PORTAL.md`
y `docs/contratos-portal-v1.md`: ante cualquier contradicción, esos
documentos mandan. **Requiere aprobación explícita del propietario del
proyecto antes de:** (a) desplegar en el VPS/Plesk, (b) sustituir el
adaptador simulado de vinculación con EspoCRM por llamadas reales, (c)
activar SMTP con credenciales reales de producción.

No se ha modificado la instancia real de EspoCRM en ningún momento de esta
fase, ni en esta revisión. No se han implementado reservas, pagos,
FacturaScripts, WhatsApp ni expedientes clínicos — fuera de alcance,
confirmado en §10. Esta revisión tampoco ha avanzado nada de eso: se
limita a corregir la implementación de autenticación ya existente.

## 1. Arquitectura de autenticación

```text
Navegador
   |
   |  cookies: gapssa_session (HttpOnly, Secure en prod, SameSite=Lax)
   |           gapssa_csrf (legible por JS, doble envío)
   v
Next.js (apps/web) — única capa que habla con gapssa_auth
   |
   |------------> Postgres: gapssa_auth (Drizzle ORM)
   |------------> Redis: OtpChallenge, rate limits (prefijo REDIS_KEY_PREFIX)
   |------------> SMTP real o transporte de desarrollo (mailer.ts)
   `------------> Adaptador EspoCRM SIMULADO (espoLink.ts) — sin red real
```

Identidad separada por diseño, cada una con su propio ciclo de vida y base
de datos:

| Identidad | Base de datos | Propósito |
|---|---|---|
| `ClientAccount` (`gapssa_auth`) | Postgres, Fase 3 | Login/sesión del cliente del portal |
| `users` (Payload, `gapssa_cms`) | Postgres, Fase 1 | Staff interno de `/admin` — nunca clientes |
| `Contact` (EspoCRM) | MariaDB de EspoCRM | Ficha operativa del cliente (tratamientos, citas, consentimientos) |

`ClientAccount` nunca duplica la ficha operativa completa: solo guarda lo
necesario para autenticar y un identificador opaco de vínculo
(`espoContactId`) — igual que exige `PLAN_DESARROLLO_WEB_PORTAL.md` §6.3
("la base web debe guardar únicamente los datos necesarios para
autenticación, seguridad y vinculación... no debe duplicar la ficha
completa del cliente").

### 1.1 Next.js como única capa BFF

Ninguna llamada a `gapssa_auth`, Redis o el adaptador de EspoCRM ocurre
fuera de `apps/web`. Todos los módulos de servidor
(`src/server/auth/*.ts`) llevan `import 'server-only'` salvo `schema.ts`
(cargado también por `drizzle-kit` fuera del bundler de Next — ver
comentario en el propio archivo) y `db/migrate.ts` (script de CLI).

### 1.2 Sesiones

- Cookie `gapssa_session`: `HttpOnly`, `Secure` solo en producción
  (`NODE_ENV === 'production'`, nunca en local sobre HTTP),
  `SameSite=Lax`. `Lax`, no `Strict`, porque un enlace de acceso sin
  contraseña abierto desde un cliente de correo es una navegación de
  nivel superior entre sitios — `Strict` lo trataría como "sin cookie".
- El token en claro solo vive en la cookie; `gapssa_auth.sessions` guarda
  únicamente `token_hash` (SHA-256) — igual que un OTP.
- Expira por **inactividad** a los 30 minutos
  (`SESSION_IDLE_TIMEOUT_MINUTES`, valor de negocio fijo de
  `PLAN_DESARROLLO_WEB_PORTAL.md` §6.2, no configurable) y por **TTL
  absoluto** a los `AUTH_SESSION_ABSOLUTE_TTL_DAYS` días (30 por defecto,
  configurable — valor técnico, no de negocio).
- Cada login crea una sesión **nueva** (rotación tras autenticación): no
  existen sesiones anónimas pre-login que se "asciendan" a autenticadas.
- Cambiar la contraseña revoca **todas** las sesiones de la cuenta
  (`revokeAllSessionsForAccount`, motivo `password_changed`).
- El usuario puede revocar cualquier sesión propia desde `/mi-cuenta`
  (`DELETE /api/auth/sessions/:id`), incluida la actual.

### 1.3 CSRF (doble envío)

`proxy.ts` planta una cookie `gapssa_csrf` (legible por JavaScript, no
`HttpOnly`) en cualquier visita de página que todavía no la tenga — antes
de que exista sesión, porque registro/login/recuperación se envían sin
sesión previa. Toda mutación hacia `/api/auth/*` debe repetir el valor en
la cabecera `x-csrf-token`; `verifyCsrfToken` compara cookie y cabecera en
tiempo constante. Complementa, no sustituye, `SameSite=Lax`.

### 1.4 No enumeración de cuentas

`PLAN_DESARROLLO_WEB_PORTAL.md` §6.2 exige no revelar si un correo existe.
Aplicado en:

- **Registro**: misma respuesta (202, mensaje genérico) exista o no ya una
  cuenta con ese correo. Si existe, se avisa por correo a esa dirección
  (nunca a quien hizo la petición) en vez de crear una segunda cuenta.
- **Login**: mismo código/mensaje de error (`invalid_credentials`) para
  "cuenta inexistente" y "contraseña incorrecta". Se verifica siempre una
  contraseña — real o un hash señuelo (`getDecoyPasswordHash`, mismo coste
  de Argon2id) — para que ambos casos tarden aproximadamente lo mismo
  (defensa de temporización, no solo de contenido). El límite de
  frecuencia por correo se aplica con la **misma clave y ventana** exista
  o no la cuenta, para que ni siquiera el propio comportamiento de
  limitación delate la existencia de la cuenta.
- **Recuperación de contraseña**: misma respuesta (202, mensaje genérico)
  exista o no la cuenta.

## 2. Esquema y migraciones (`gapssa_auth`)

**ORM decidido en esta fase: Drizzle** (`drizzle-orm` + `drizzle-kit`),
reutilizando la misma versión de `drizzle-orm` que ya trae
`@payloadcms/db-postgres` como dependencia transitiva — sin añadir un ORM
nuevo al monorepo. `drizzle-kit` (0.31.7) también viene ya resuelto en el
lockfile por el mismo motivo. Config propia
(`apps/web/drizzle.auth.config.ts`), carpeta de migraciones propia
(`apps/web/drizzle/auth/migrations/`) — nunca compartida con la futura
`gapssa_booking` (Fase 4), que tendrá su propia config cuando se decida.

### 2.1 Tablas (8)

| Tabla | Propósito |
|---|---|
| `client_accounts` | Identidad del portal: correo (único, normalizado), estado, fecha de nacimiento, idioma, estado de vinculación con EspoCRM, estado de independencia |
| `credentials` | Credencial de contraseña (Argon2id) — tabla separada de `client_accounts` para admitir futuros tipos de credencial sin migrar de nuevo |
| `sessions` | Sesiones: hash de token, IP, user-agent, expiración, revocación con motivo |
| `email_verification_requests` | Estado de la solicitud de verificación de correo (el código en sí vive en Redis) |
| `password_reset_requests` | Estado de la solicitud de recuperación de contraseña, con `idempotency_key` único |
| `guardian_links` | Vínculo tutor–menor: estado, quién solicitó, confirmación, revocación |
| `independence_requests` | Solicitud de independencia de una cuenta de menor al alcanzar la mayoría de edad |
| `auth_audit_log` | `AuditEntry` validados (`packages/contracts/src/audit.ts`) — nunca texto libre, nunca secretos |

Todas las columnas de estado son `pgEnum` (no `text` + `CHECK`): Postgres
valida el dominio en el propio tipo de columna, y `drizzle-kit generate`
detecta divergencias entre el enum de TypeScript (`@gapssa/contracts`) y
el de Postgres automáticamente.

Índices relevantes: `client_accounts.email` único; `sessions.token_hash`
único; `password_reset_requests.idempotency_key` único;
`guardian_links` tiene un índice único **parcial**
(`guardian_links_unique_live_pair`, `WHERE status IN
('pending_minor_confirmation', 'active')`) que impide que el mismo tutor
solicite dos veces un vínculo vivo con el mismo menor — la regla de
"máximo dos tutores" en sí (dos `guardian_account_id` **distintos**) no
puede expresarse como índice y se aplica en la capa de repositorio (§4).

### 2.2 Migraciones aplicadas

Tres migraciones, todas aplicadas y verificadas contra la instancia real
de `gapssa_auth` en este entorno (§8):

1. `0000_*.sql` — las 8 tablas, todos los enums, todos los índices.
2. `0001_*.sql` — añade el valor `'event'` a `audit_value_representation`
   y `'SessionRevokedByAdmin'` a `audit_reason_code` (extensión del
   contrato de auditoría, ver §2.3).
3. `0002_*.sql` — añade `'account_deletion_requested'` a
   `session_revoked_reason` y `'AccountDeletionRequested'` a
   `audit_reason_code` (solicitud de eliminación de cuenta, §5.6).

Todas son `ALTER TYPE ... ADD VALUE` — aditivas, sin pérdida de datos,
reversión documentada en §2.4.

### 2.3 Por qué una tercera variante de `AuditEntry`

`packages/contracts/src/audit.ts` (heredado de la Fase 0/booking) modelaba
`AuditEntry` como `RawAuditEntry | RedactedAuditEntry` — ambas exigen un
campo de dominio cerrado que cambia de valor. Varios eventos de Fase 3
(login correcto/fallido, cierre de sesión, bloqueo por límite de
frecuencia) no cambian ningún campo enum real: forzarlos dentro de
`RawAuditEntry` habría exigido un `previousValue`/`newValue` idénticos —
una transición falsa. Se añadió `EventAuditEntry` (`valueRepresentation:
"event"`, con `reasonCode` **obligatorio**, a diferencia de las otras dos
variantes donde es opcional) — mismo rigor de construcción con marca
nominal, mismas pruebas negativas. Ver `packages/contracts/src/audit.ts`
y `audit.test.ts` (18 pruebas nuevas o modificadas para esta variante).

### 2.4 Reversión

Cada migración de Drizzle es un archivo `.sql` plano, legible y revisable
antes de aplicar. No hay generación automática de `down`-migrations en
Drizzle; la reversión de las tres migraciones de esta fase, probada
manualmente contra una base descartable:

```sql
-- Revertir 0002
-- (los ALTER TYPE ... ADD VALUE no son reversibles directamente en Postgres;
--  la reversión real es restaurar desde la copia de seguridad previa a la
--  migración, o recrear el tipo sin el valor añadido si la columna nunca
--  llegó a usarlo)
```

Postgres **no admite** `ALTER TYPE ... DROP VALUE` de forma nativa. La
estrategia de reversión para estas tres migraciones (todas aditivas sobre
enums) es la misma que ya documenta el proyecto para cualquier cambio de
esquema: copia de seguridad recuperable antes de migrar
(`PROJECT_CONTEXT.md` §15.4) y restauración desde esa copia si hace falta
revertir — probado en este entorno recreando la base `gapssa_auth` desde
cero y reaplicando las migraciones en orden (§8, "migraciones desde una
base vacía").

## 3. Flujos

### 3.1 Registro → verificación

1. `POST /api/auth/register` — valida CSRF, límite de frecuencia por IP,
   fuerza de la contraseña, fecha de nacimiento. Si el correo ya existe
   (o colisiona en el `INSERT` por una carrera concurrente, capturada por
   el código `23505` de Postgres), responde igual que un registro nuevo y
   avisa por correo a esa dirección. Si no, crea `ClientAccount`
   (`pending_verification`) + credencial + `EmailVerificationRequest`, y
   envía un código de un solo uso por correo.
2. `POST /api/auth/verify-email` — verifica el código contra Redis
   (`otpService.ts`, transición atómica vía script Lua — ver §3.4). Si es
   correcto: `status -> active`, `emailVerifiedAt`, y dispara la
   evaluación de vinculación con EspoCRM (adaptador simulado, §6).

### 3.2 Login → sesión

`POST /api/auth/login` — límites de frecuencia por IP y por correo
(exista o no la cuenta, §1.4), verificación de contraseña con defensa de
temporización, y solo tras confirmar la contraseña se revela si la cuenta
está sin verificar o suspendida (nunca antes: revelarlo a quien todavía no
demostró conocer la contraseña sería una fuga de enumeración más fina).
Sesión nueva + auditoría (`LoginSucceeded`/`LoginFailed*`).

### 3.3 Recuperación → restablecimiento

`POST /api/auth/password/forgot` (misma respuesta exista o no la cuenta) →
`POST /api/auth/password/reset` (código + nueva contraseña) → al verificar
con éxito: rota la credencial, marca la solicitud consumida, **revoca
todas las sesiones existentes** (`password_changed`) y audita
`PasswordResetCompleted`.

### 3.4 OTP: almacenamiento y transición atómica

Reutiliza `packages/contracts/src/otp.ts` (HMAC contextualizado por
`challengeId`+`purpose`+`subjectRef`, generación sin sesgo de módulo, ya
diseñado y probado en la Fase 0 para el flujo de invitado). Nuevo en esta
fase: `apps/web/src/server/auth/otpService.ts`, que guarda el reto en
Redis (`otp:challenge:<id>` + puntero `otp:current:<purpose>:<subjectRef>`
para no requerir que el cliente conozca el `challengeId`) y aplica la
transición de estado (`consumedAt`/`attemptsUsed`/`lockedAt`) mediante un
**script Lua** ejecutado en Redis: la comparación criptográfica del
código ocurre en Node (reutilizando `verifyOtpCode`/`constantTimeEqual`,
ya probados), pero la escritura del resultado es atómica de verdad —
si dos verificaciones concurrentes llegan con el código correcto a la
vez, como mucho una gana la transición a `verified`.

Dos propósitos de OTP nuevos en `otp.ts`: `account_email_verification` y
`independence_confirmation` (contexto propio, nunca reutiliza el hash de
`guest_email_verification`).

## 4. Modelo tutor–menor

Solo modelo de identidad, permisos y estados — sin consentimientos ni
visibilidad de ficha todavía, según el alcance explícito de esta fase.

- Cada menor tiene su **propia** `ClientAccount` (su propio correo, su
  propio dispositivo — `PLAN_DESARROLLO_WEB_PORTAL.md` §10: "uso del
  móvil propio del joven"). El registro no distingue menores de adultos:
  la categoría se deriva siempre de `dateOfBirth`
  (`decideAccountAgeCategory`), nunca se persiste como campo mutable.
- Un tutor autenticado solicita el vínculo por el correo del menor
  (`POST /api/auth/guardian/link-requests`) → **nunca se vincula
  automáticamente**: el menor debe confirmar desde su propia cuenta
  (`POST .../:id/confirm`). Cualquiera de los dos puede revocar el
  vínculo después.
- **Máximo dos tutores por menor**
  (`MAX_GUARDIANS_PER_MINOR`), aplicado con `SELECT ... FOR UPDATE` sobre
  la propia fila de `client_accounts` del menor dentro de una transacción
  — necesario porque un `COUNT` normal bajo aislamiento READ COMMITTED (el
  de Postgres por defecto) no impide que dos solicitudes concurrentes
  para un tercer/cuarto tutor lean las dos "hay un hueco libre" antes de
  que ninguna confirme. **Corrección real durante esta fase**: la primera
  versión bloqueaba las filas de `guardian_links` en vez de la cuenta del
  menor — con cero vínculos previos (el caso exacto de una carrera por los
  primeros huecos) `SELECT ... FOR UPDATE` no tiene ninguna fila que
  bloquear, así que no protegía nada; una prueba de concurrencia real
  (`tests/integration/auth.guardianIndependence.int.test.ts`, 4 solicitudes
  simultáneas) lo detectó (3 vínculos creados en vez de 2) antes de
  corregirlo. Bloquear la fila del menor, que siempre existe, sí sirve.
- **Independencia al alcanzar la mayoría de edad** (18 años, Código Civil
  español art. 315 — un hecho legal, no una decisión de negocio):
  elegible solo si ya es adulto, tiene al menos un vínculo de tutela
  (activo o no) y la independencia no estaba ya concedida
  (`isEligibleForIndependenceRequest`, `packages/contracts/src/auth.ts`).
  **Nunca automática**: el propio joven solicita
  (`POST /api/auth/independence-requests`) y reconfirma su identidad con
  un código de un solo uso (propósito `independence_confirmation`) antes
  de que `independenceStatus` pase a `granted`.
- Un tutor **no** ve automáticamente la ficha del menor: el vínculo en sí
  solo registra la relación; el control granular de qué puede ver un
  tutor (por tratamiento/consentimiento) es diseño de una fase posterior,
  según pide explícitamente el alcance de esta fase.

## 5. Controles de seguridad

| Control | Implementación |
|---|---|
| Hash de contraseña | Argon2id (`@node-rs/argon2`, binding nativo), parámetros configurables (`ARGON2_*`), mínimo recomendado por OWASP por defecto |
| Cookies | `HttpOnly`, `Secure` en producción, `SameSite=Lax` — §1.2 |
| Rotación de sesión tras login | Sesión nueva en cada login, nunca reutiliza un identificador previo |
| CSRF | Doble envío cookie/cabecera — §1.3 |
| Rate limiting | Redis, ventana fija, por IP/cuenta/propósito independientes (`rateLimit.ts`); valores configurables por variable de entorno, nunca hardcodeados — ver §7 |
| Invalidación tras cambio de contraseña | `revokeAllSessionsForAccount(..., 'password_changed')` — §1.2 |
| Tokens de un solo uso | OTP: solo se guarda el HMAC (`codeHash`), nunca el código en claro. Sesión: solo se guarda `tokenHash` (SHA-256), nunca el token |
| Idempotencia | `PasswordResetRequest.idempotencyKey` único; registro tolera una colisión de correo concurrente (código `23505`) sin duplicar cuentas |
| Validación de redirecciones | `sanitizeRedirectTarget` (`lib/auth/redirectSafety.ts`) — resuelve contra un origen fijo y rechaza cualquier candidato que no resuelva al mismo origen (bloquea `//evil`, `https://evil`, `/\evil`) |
| Auditoría sin PII cruda | `packages/contracts/src/audit.ts`: valores en crudo solo si pertenecen a un enum cerrado registrado; motivos humanos nunca se copian, solo un `reasonCode` cerrado — §2.3 |
| Defensa ante ataques de temporización | Login siempre verifica una contraseña (real o señuelo, mismo coste) — §1.4 |
| Límites de tamaño de entrada | `parseJsonBody` rechaza cuerpos > 16 KB antes de intentar parsear JSON |
| Sin secretos de desarrollo como fallback | `OTP_HMAC_SECRET` no tiene valor por defecto en código — falla rápido si falta (`server/env.ts`) |
| No enumeración | §1.4 |
| Última pieza operativa: eliminación de cuenta | `POST /api/auth/account/delete-request` bloquea el acceso de inmediato (`status -> pending_deletion` + revoca todas las sesiones) — `PLAN_DESARROLLO_WEB_PORTAL.md` §15.1. No elimina ni anonimiza nada: eso queda pendiente de revisión manual de Gapssa, fuera del alcance de esta fase |

## 6. Vinculación con EspoCRM — adaptador simulado y recomendación

**Esta fase no ha realizado ninguna llamada real a la instancia de
EspoCRM.** `apps/web/src/server/auth/espoLink.ts` define:

- `EspoLinkAdapter` (interfaz): `searchCandidateContacts({email, phone?})`.
- `SimulatedEspoLinkAdapter`: implementación que, sin `fixtures` de
  prueba, siempre devuelve "sin candidatos" — refleja honestamente que no
  hay conectividad real, no finge una búsqueda.
- `decideEspoLinkAction` (pura): dado un conjunto de candidatos, decide
  `no_match` / `single_match` / `ambiguous_match`. **Ninguna de las dos
  últimas vincula automáticamente** — ambas dejan la cuenta en
  `espoLinkStatus = "pending_review"`, nunca `"linked"` directamente
  (`PLAN_DESARROLLO_WEB_PORTAL.md` §6.3). No se exponen los `contactId`
  candidatos fuera de este proceso (ni al cliente, ni en la auditoría).

### 6.1 Recomendación concreta para la implementación real (Fase 4+, pendiente de aprobación)

1. **API User de EspoCRM**: un usuario de API dedicado
   (`portal-auth-link@gapssa.es` o similar), nunca el usuario
   administrador general. Se crea desde EspoCRM → Administración →
   Usuarios → tipo "API User".
2. **Mecanismo de autenticación**: API Key de EspoCRM (cabecera
   `X-Api-Key`) en vez de HMAC de dos claves — más simple de rotar y
   suficiente para un adaptador que solo hace lecturas y una escritura
   idempotente de vinculación. La clave se gestiona como cualquier otro
   secreto del proyecto (variable de entorno, nunca en el repositorio;
   mismo patrón que `clientSecret` de la extensión Google Calendar Sync,
   ver `PROJECT_CONTEXT.md` §15.2).
3. **Permisos mínimos**: el API User debe tener acceso de **solo lectura**
   a `Contact` (campos: nombre, correo, teléfono — nunca cuestionarios,
   fotos, notas sensibles) para la búsqueda, y **sin permiso de
   escritura** en ninguna entidad hasta que se apruebe explícitamente el
   paso de creación/vinculación real. Regla de acceso mínimo, igual que
   exige `PROJECT_CONTEXT.md` §15.2 para n8n.
4. **Búsqueda/vinculación idempotente**: buscar primero por un campo
   propio en `Contact` (p. ej. `cGapssaAccountId`, custom field
   pendiente de dar de alta) antes de buscar por correo/teléfono — mismo
   patrón que `cBookingRequestId` en `booking.ts` (Fase 0) para evitar
   duplicar una vinculación ya hecha si la petición se reintenta.
5. **Coincidencias múltiples**: nunca resueltas automáticamente. Quedan
   en `pending_review`, visibles solo desde una vista futura en EspoCRM
   (no incluida en esta fase) para que Gapssa decida manualmente — ningún
   resultado de búsqueda se expone al cliente del portal.
6. **Reconciliación tras fallos parciales**: si la escritura del
   `cGapssaAccountId` en el `Contact` de EspoCRM tiene éxito pero la
   actualización de `espoLinkStatus` en `gapssa_auth` falla (o viceversa),
   un job de conciliación (mismo patrón que
   `docs/contratos-portal-v1.md` §8.3) debe poder detectar la
   divergencia comparando ambos lados por el identificador opaco — diseño
   pendiente de esa fase, no de esta.

**Para pasar del adaptador simulado a llamadas reales hace falta
autorización explícita** cubriendo, como mínimo: alta del API User en la
instancia real, alta del campo custom `cGapssaAccountId`, y aprobación de
los cinco puntos anteriores.

### 6.2 Outbox — pendiente operativa para producción (revisión 5 de Fase 3)

El outbox (`server/auth/outbox.ts`, `outbox_jobs`) es correcto tal como
está: encolado en la misma transacción que la transición que lo origina,
procesamiento idempotente y recuperable por `accountId`+`jobType`. Esta
revisión no lo rediseña — solo dos huecos **operativos** quedan
documentados como pendientes explícitas para cuando exista una
integración real (§6.1), no como trabajo de esta fase:

1. **Hace falta un runner periódico independiente.** Hoy,
   `processEvaluateEspoLinkJobForAccount` solo se invoca desde dentro de la
   propia petición HTTP que activó la cuenta (`verify-email/route.ts`,
   justo después del commit de activación) — un job `pending` o
   `failed_retryable` que nadie vuelve a tocar (porque el usuario nunca
   repite esa verificación) se queda sin procesar indefinidamente. En
   producción hace falta un proceso aparte (cron/worker) que escanee
   `outbox_jobs` por `status`+`next_attempt_at` (el índice
   `outbox_jobs_status_next_attempt_at_idx` ya existe para esa consulta) y
   reintente los pendientes, sin depender de que ningún usuario vuelva a
   pasar por el flujo que los originó.
2. **La llamada real a EspoCRM no debe mantener bloqueos Postgres durante
   la espera de red.** `processEvaluateEspoLinkJobForAccount` hoy bloquea
   (`FOR UPDATE`) el job y la cuenta dentro de la misma transacción que
   invoca al adaptador — aceptable mientras el adaptador es simulado y no
   hace I/O real (`SimulatedEspoLinkAdapter`, resuelve en memoria). En
   cuanto el adaptador haga una petición HTTP real a EspoCRM (§6.1), esa
   llamada de red **no puede** ejecutarse mientras la transacción tiene
   filas bloqueadas — el diseño real deberá separar "leer/decidir qué
   llamar" (fuera de transacción, o en una transacción corta que solo
   bloquea para leer el estado) de "aplicar el resultado" (una transacción
   corta aparte que bloquea de nuevo, aplica y libera), nunca una única
   transacción que abarque la latencia de red completa.

Ninguno de los dos puntos se implementa en esta revisión — quedan como
diseño pendiente de aprobación, igual que el resto de §6.1.

## 7. Variables de entorno nuevas

Añadidas a `.env.example` (documentadas ahí con el mismo detalle) y a
`src/server/env.ts` (validadas con zod al arrancar):

| Variable | Tipo | Valor por defecto | Nota |
|---|---|---|---|
| `OTP_HMAC_SECRET` | secreto | **ninguno** | Falla rápido si falta |
| `AUTH_RATE_LIMIT_HMAC_SECRET` | secreto | **ninguno** | Revisión 2 — HMAC de identificadores de sujeto derivados de correo (`security.ts`), distinto de `OTP_HMAC_SECRET` |
| `TRUSTED_PROXY_HOP_COUNT` | técnico | 1 | Revisión 2 — saltos de proxy inverso de confianza delante de Next.js (`getClientIp`, §5 de esta revisión) |
| `OTP_TTL_MINUTES` | técnico | 10 | |
| `OTP_MAX_ATTEMPTS` | técnico | 5 | |
| `OTP_LOCKOUT_MINUTES` | técnico | 15 | |
| `OTP_REQUEST_MAX_PER_SUBJECT_PER_HOUR` | técnico | 5 | |
| `OTP_REQUEST_MAX_PER_IP_PER_HOUR` | técnico | 20 | |
| `AUTH_SESSION_ABSOLUTE_TTL_DAYS` | técnico | 30 | |
| `AUTH_PASSWORD_RESET_SESSION_MINUTES` | técnico | 10 | |
| `AUTH_LOGIN_MAX_ATTEMPTS_PER_ACCOUNT_PER_HOUR` | técnico | 10 | |
| `AUTH_LOGIN_MAX_ATTEMPTS_PER_IP_PER_HOUR` | técnico | 30 | |
| `AUTH_LOGIN_LOCKOUT_MINUTES` | técnico | 15 | |
| `ARGON2_MEMORY_COST_KIB` | técnico | 19456 | Mínimo OWASP para Argon2id |
| `ARGON2_TIME_COST` | técnico | 2 | |
| `ARGON2_PARALLELISM` | técnico | 1 | |
| `SMTP_HOST` | operativo | vacío | Vacío = transporte de desarrollo, nunca envío real |
| `SMTP_PORT` | operativo | 587 | |
| `SMTP_SECURE` | operativo | false | |
| `SMTP_USER` / `SMTP_PASSWORD` | secreto | vacío | Pendientes de Gapssa |
| `SMTP_FROM_EMAIL` | operativo (ya decidido) | `reservas@gapssa.es` | Valor ya aprobado por el plan, §13.1 |

Todos los "técnicos" son **valores sugeridos**, no decisiones de negocio —
configurables sin desplegar código nuevo, pendientes de confirmación
explícita (mismo tratamiento que `GUEST_VERIFICATION_HOLD_MINUTES` en la
Fase 0).

## 8. Archivos modificados/creados

Resumen por área — lista exhaustiva en el diff real, no reproducida aquí
campo a campo:

- `packages/contracts/src/auth.ts` (nuevo), `otp.ts` (2 propósitos
  nuevos), `audit.ts` (variante `EventAuditEntry`, nuevos `reasonCode`,
  nuevos campos auditables), `index.ts`.
- `apps/web/src/server/auth/**` (nuevo): `db/schema.ts`, `db/client.ts`,
  `db/migrate.ts`, `password.ts`, `session.ts`, `csrf.ts`, `otpService.ts`,
  `rateLimit.ts`, `mailer.ts`, `repository.ts`, `guardian.ts`,
  `espoLink.ts`, `audit.ts`, `dal.ts`, `httpHelpers.ts`, `dbErrors.ts`.
- `apps/web/src/lib/auth/**` (nuevo): `cookieNames.ts`,
  `redirectSafety.ts`, `authFetch.ts`.
- `apps/web/src/app/api/auth/**` (nuevo): register, verify-email, login,
  logout, password/forgot, password/reset, sessions (+ `[id]`),
  guardian/link-requests (+ `[id]/confirm`, `[id]/revoke`),
  independence-requests (+ `[id]/confirm`), account/delete-request.
- `apps/web/src/app/(frontend)/[locale]/mi-cuenta/**`: `page.tsx`
  reescrito (portada protegida); nuevas subrutas `registro/`,
  `verificar/`, `acceder/`, `recuperar/`, `restablecer/`.
- `apps/web/src/components/client/auth/**` (nuevo): formularios y
  componentes cliente.
- `apps/web/src/proxy.ts`: emite la cookie CSRF en cualquier visita.
- `apps/web/src/server/env.ts`, `apps/web/src/server/redis.ts`
  (`getRedisClient` de propósito general): extendidos.
- `apps/web/src/lib/i18n/dictionaries/*.ts` (6 idiomas): namespace
  `miCuenta` completo (antes, solo `titulo`/`aviso` de un placeholder).
- `apps/web/drizzle.auth.config.ts`, `apps/web/drizzle/auth/migrations/**`
  (nuevo).
- `apps/web/package.json`: `@node-rs/argon2`, `nodemailer` (+
  `@types/nodemailer`), `drizzle-kit` (devDependency), `pg` movido de
  devDependencies a dependencies (necesario en runtime para el cliente de
  `gapssa_auth`); scripts `auth:db:generate`/`auth:db:migrate`.
- `.env.example`, `.env` (local, nunca commiteado): variables de §7.
- `infra/postgres/README.md`, `apps/web/README.md`: actualizados.
- `docs/fase3-autenticacion.md`: este documento.

## 9. Decisiones pendientes que requieren aprobación

- **Vinculación real con EspoCRM** (§6.1): API User, campo custom
  `cGapssaAccountId`, permisos, y las cinco decisiones de diseño listadas
  — nada de esto se implementa sin autorización explícita.
- **Runner periódico del outbox y llamada real a EspoCRM sin bloqueos
  Postgres durante la espera de red** (§6.2, revisión 5 de Fase 3):
  documentado como pendiente operativa, no implementado en esta fase.
- **Credenciales SMTP reales** (`PLAN_DESARROLLO_WEB_PORTAL.md` §21, ya
  listado como pendiente): sin ellas, el portal sigue funcionando en
  local con el transporte de desarrollo, pero no puede enviar correo real
  hasta que Gapssa las proporcione.
- **Valores técnicos de §7**: sugeridos con justificación, no confirmados
  como definitivos.
- **Plazo de `VERIFICATION_RECOVERY_WINDOW_MINUTES` y demás pendientes ya
  heredados de `docs/contratos-portal-v1.md` §10**: sin cambios en esta
  fase, siguen pendientes de Fase 4.
- **Panel de revisión manual de vinculaciones EspoCRM
  (`pending_review`)**: esta fase deja la cuenta en ese estado pero no
  construye ninguna interfaz para que Gapssa las revise — diseño de una
  fase posterior, a definir si vive en EspoCRM (vista/lista custom) o en
  una herramienta operativa aparte.
- **Acceso de un tutor a la ficha del menor**: el vínculo existe, pero el
  control granular de qué puede ver un tutor (`PROJECT_CONTEXT.md` §7.3)
  es diseño de una fase posterior de consentimientos, no de esta.
- **Límite conocido y aceptado de no enumeración en `verify-email`**: a
  diferencia de registro/login/recuperación (§1.4, garantía completa),
  `POST /api/auth/verify-email` sí puede distinguir "esta cuenta se está
  registrando ahora mismo" (código incorrecto contra un reto activo
  recién creado devuelve `invalid_code`) de "no existe ninguna cuenta con
  este correo" (siempre `expired`) — porque el registro crea el reto de
  verificación en el mismo momento, de forma síncrona, así que no existe
  un estado natural "cuenta real, sin ningún reto jamás emitido" con el
  que comparar. Tapar esta señal exigiría debilitar el propio mecanismo
  de intentos limitados. Se acepta como limitación de bajo riesgo: exige
  adivinar un correo exacto **y** que su dueño esté registrándose en ese
  preciso momento (ventana de `OTP_TTL_MINUTES`, 10 minutos por defecto).
  Verificado explícitamente en
  `tests/integration/auth.registerVerifyLogin.int.test.ts` que una cuenta
  inexistente nunca obtiene una respuesta distinta de `expired`, bajo
  ningún número de intentos.

## 10. Confirmación de alcance

No implementado en esta fase, confirmado explícitamente:

- Reservas, disponibilidad, `BookingRequestRecord`/`PendingGuestIdentity`
  reales (siguen siendo diseño de Fase 4, sin tocar aquí).
- Pagos, facturas, FacturaScripts, bonos, packs, membresías, suscripciones
  — ninguna sección visible en `/mi-cuenta`, ni siquiera como estado
  vacío (`PLAN_DESARROLLO_WEB_PORTAL.md` §8.2).
- WhatsApp Business Platform.
- Expedientes clínicos, cuestionarios de salud, consentimientos firmados,
  fotografías — solo el modelo mínimo de tutor–menor descrito en §4.
- Ninguna llamada real a la instancia de EspoCRM.
- Ninguna modificación de la instancia real de EspoCRM ni de la extensión
  Google Calendar Sync.
- `editor@gapssa.test` y el resto de contenido aprobado de Fase 2: sin
  tocar (verificado como parte de la validación final de esta fase).
