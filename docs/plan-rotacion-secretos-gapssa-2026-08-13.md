# Plan de rotación global de secretos — GAPSSA (2026-08-13)

**Estado: diseño y preparación únicamente. Ningún secreto se ha rotado, generado
ni escrito por Claude en esta sesión más allá de lo ya hecho (rotación de
`POSTGRES_PASSWORD` y adición de versiones `v2` a dos secretos de `booking`,
ambas ahora también comprometidas — ver §0).** Este documento no contiene
ningún valor secreto, fragmento, prefijo, sufijo ni DSN.

## 0.bis Estado tras el cierre del Bloque 6

- Los **Bloques 1–6** de `scripts/secrets-rotation/` (guardas, máquina de
  estados, backup/recuperación, ACL de S9, ensayo integral S1→S9) están
  completos **únicamente contra infraestructura Docker desechable**
  (proyectos `gapssa-*-tests-<rand>`/`gapssa-acl-rehearsal-*`, nunca
  `gapssa-espocrm-1` ni ningún recurso GAPSSA real). **La rotación real de
  este `.env` sigue sin ejecutarse.**
- La **Puerta 5B-2B** (`docs/fase4b-puerta5b-primera-reserva.md`) —
  primera reserva real contra `gapssa-espocrm-1` — **sigue sin autorizar**
  y es independiente de esta rotación; cerrar el Bloque 6 no la desbloquea.
- El procedimiento operativo completo (ejecución desde `Terminal.app` con
  Claude Code cerrado, `--dry-run` primero, significado de cada estado,
  bloqueo de concurrencia, reanudación tras interrupción, timeouts, puerto
  configurable de S9, informe saneado con identidad de sesión (`run_id`
  CSPRNG único por ejecución, reserva atómica del nombre del informe,
  S9 exige exactamente un informe para su propio `run_id`), clasificación
  cerrada de claves, condiciones de parada, comandos que nunca deben
  copiarse al chat, teardown) está en
  `docs/runbook-rotacion-secretos-externa.md` §"Estado tras el cierre del
  Bloque 6" — este plan no lo duplica, es el documento de inventario/
  diseño, no el de ejecución.
- **Completar esta rotación, aunque termine en verde, no implica que la V1
  del proyecto esté terminada** — son alcances independientes.

## 0. Por qué existe este documento

El 2026-08-13, durante esta misma sesión de trabajo, ocurrieron tres
incidentes encadenados:

1. **`POSTGRES_PASSWORD` expuesto en el transcript** (comandos de inspección
   no seguros) — rotado y documentado en
   `docs/incidente-postgres-password-local-2026-08-13.md`. **Cierre
   superseded por este documento** (ver §9, S9).
2. **Cinco secretos de `booking` expuestos en el transcript**
   (`BOOKING_FIELD_ENCRYPTION_KEYS`, `BOOKING_EMAIL_LOOKUP_HMAC_SECRET`,
   `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS`,
   `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET`, `BOOKING_INTERNAL_API_SECRET`)
   por un `grep` de prefijo amplio — documentado en
   `docs/incidente-booking-secrets-local-2026-08-13.md`. **Cierre superseded
   por este documento** (ver §9, S9). Durante la contención de este segundo
   incidente se añadieron versiones `v2` a `BOOKING_FIELD_ENCRYPTION_KEYS`
   y `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS` (nunca activadas para
   escritura) — ver el punto 3.
3. **El `.env` completo expuesto en el transcript por una notificación
   automática del harness** (no por un comando ejecutado por Claude): al
   editar `.env` para añadir las versiones `v2` del punto 2, el propio
   mecanismo de notificación de cambios de archivo del harness volcó el
   contenido íntegro del archivo en la conversación — **cada secreto que
   vivía en `.env` en ese instante, no solo los cinco de `booking`**. Este
   es el incidente que motiva este documento.

**Consecuencia directa**: las versiones `v2` de `BOOKING_FIELD_ENCRYPTION_KEYS`
y `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS` generadas durante el punto 2
quedaron expuestas por el punto 3 **antes de activarse nunca para
escritura** — deben descartarse igual que la `v1` original, nunca
activarse. La rotación real debe generar versiones `v3` (o el nombre que
el operador prefiera) completamente nuevas, fuera de este entorno.

**Causa estructural**: no fue un error de comando de inspección esta vez —
fue el propio harness informando de una edición de archivo. La mitigación
correcta no es "tener más cuidado con los comandos", es **nunca almacenar
secretos reales dentro de un archivo que un agente pueda editar** (§2).

## 1. Inventario por nombre de variable (sin leer `.env` real)

Construido exclusivamente desde `.env.example`, `apps/web/src/server/env.ts`,
`apps/web/src/payload.env.ts`, `compose.yml`, `infra/postgres/README.md` y el
código fuente de cada consumidor — nunca desde el `.env` real.

### 1.1 PostgreSQL (rol `gapssa_apps`, tres bases lógicas)

| Variable | Consumidor | Almacenamiento servidor | Reinicio necesario | Efecto de rotación | Múltiples versiones |
|---|---|---|---|---|---|
| `POSTGRES_PASSWORD` | Contenedor `apps-db` (valor de `initdb`, no se re-lee tras el primer arranque) | Rol PostgreSQL (`pg_authid`, hash) | Sí — `ALTER ROLE` + todo consumidor que abra una conexión nueva | Invalida inmediatamente cualquier conexión nueva con la contraseña anterior; conexiones ya abiertas no se cortan solas | No — un único valor activo por rol |
| `DATABASE_URL_AUTH`/`_BOOKING`/`_CMS` | `apps/web` (Drizzle, Payload), `drizzle.*.config.ts`, `tests/integration/global-setup.ts` | Ninguno propio — deriva de `POSTGRES_PASSWORD` | Sí, junto con el rol | Debe cambiar exactamente junto con `POSTGRES_PASSWORD` (mismo valor embebido) | No |

Ya rotado una vez el 2026-08-13 (ver incidente 1) — **debe rotarse de nuevo**
porque el valor rotado también quedó expuesto por el incidente 3.

### 1.2 EspoCRM / MariaDB

| Variable | Consumidor | Almacenamiento servidor | Reinicio necesario | Efecto de rotación | Múltiples versiones |
|---|---|---|---|---|---|
| `ESPOCRM_ADMIN_PASSWORD` | Login de `admin` en EspoCRM (uso manual/`bin/command`) | Tabla `user` de MariaDB (hash) | No — solo afecta a logins futuros | Cierra sesiones de `admin` existentes en próximo control de token | No |
| `ESPOCRM_DB_PASSWORD` | Contenedor `espocrm`/`espocrm-daemon`/`espocrm-websocket` → conexión a `espocrm-db` | Usuario MariaDB `espocrm` | Sí — los tres contenedores EspoCRM | Rompe la conexión de EspoCRM a su base hasta reiniciar con el nuevo valor | No |
| `ESPOCRM_DB_ROOT_PASSWORD` | Solo administración directa de MariaDB (`root`) | Usuario MariaDB `root` | No para la app (EspoCRM no usa `root` en operación normal) | Ninguno sobre el tráfico de aplicación | No |
| `ESPOCRM_API_KEY` | `apps/web` (`HttpEspoBookingAdapter`, cuando `ESPO_BOOKING_ADAPTER=http`) + cualquier proceso aislado de prueba | `User` `portal-gapssa-api` (`type=api`) en EspoCRM | Solo si algún proceso está usando `ESPO_BOOKING_ADAPTER=http` (hoy el proceso principal usa `simulated`, no lo consume) | Genera una key nueva vía EspoCRM Admin (nunca reutiliza la anterior); revocar la anterior en el propio `User` | No — EspoCRM no versiona claves de un mismo `User`, pero se puede crear un `User` API nuevo en paralelo si se necesita ventana de solape |

### 1.3 Redis

| Variable | Consumidor | Almacenamiento servidor | Reinicio necesario | Efecto de rotación | Múltiples versiones |
|---|---|---|---|---|---|
| `REDIS_PASSWORD` | Contenedor `redis` (`requirepass`) + `apps/web` (locks, OTP, idempotencia, rate limiting) | `redis.conf`/`CONFIG SET requirepass` | Sí — servidor y `apps/web` a la vez (o `CONFIG SET` en caliente + `.env` coordinados) | Invalida conexiones nuevas con la contraseña anterior; **datos efímeros** (locks/OTP/rate-limit) — perderlos al reiniciar Redis es aceptable por diseño (documentado como recuperable) | No |
| `REDIS_URL` | Igual que arriba | Deriva de `REDIS_PASSWORD` | Junto con `REDIS_PASSWORD` | Igual | No |

### 1.4 Payload CMS

| Variable | Consumidor | Almacenamiento servidor | Reinicio necesario | Efecto de rotación | Múltiples versiones |
|---|---|---|---|---|---|
| `PAYLOAD_SECRET` | `apps/web` (Payload — firma de sesiones/tokens internos de Payload) | Ninguno propio (deriva las firmas en caliente) | Sí | Invalida sesiones/tokens de administración de Payload ya emitidos | No |

### 1.5 Auth (`gapssa_auth`)

| Variable | Consumidor | Almacenamiento servidor | Reinicio necesario | Efecto de rotación | Múltiples versiones |
|---|---|---|---|---|---|
| `OTP_HMAC_SECRET` | `apps/web` (`server/auth/otpService.ts` y equivalentes) | Ninguno propio — los retos OTP viven en Redis con TTL corto | Sí | Invalida cualquier reto OTP pendiente en el instante de rotar (usuario debe volver a solicitar código) — impacto bajo, TTL ya corto por diseño | No |
| `AUTH_RATE_LIMIT_HMAC_SECRET` | `apps/web` (claves de Redis de límite de frecuencia) | Ninguno propio | Sí | "Olvida" cualquier ventana de límite de frecuencia activa — efecto documentado como aceptable, no un fallo | No |
| Sesiones/cookies (`gapssa_auth.sessions` o equivalente) | No dependen de una variable de entorno propia — el identificador de sesión es aleatorio, no derivado de un secreto de firma | — | — | — | — |

### 1.6 Booking (`gapssa_booking`)

Ver también `docs/incidente-booking-secrets-local-2026-08-13.md` para el
análisis detallado ya hecho de cada uno (consumidores exactos, tablas
dependientes, código de rotación ya escrito y probado en ensayo efímero).

| Variable | Consumidor | Datos dependientes reales (2026-08-13) | Múltiples versiones |
|---|---|---|---|
| `BOOKING_FIELD_ENCRYPTION_KEYS` | `server/crypto/fieldCrypto.ts` | 0 filas cifradas en `pending_guest_identities`/`pending_authenticated_contact_details` (tablas vacías) | Sí, por diseño (mapa `{version: clave}`) |
| `BOOKING_EMAIL_LOOKUP_HMAC_SECRET` | `server/booking/guestFlow.ts` | 0 filas (`pending_guest_identities` vacía) | No |
| `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS` | `server/booking/identityFingerprint.ts` | 1 `BookingRequestRecord` con `status=resolved` (terminal) referenciando `v1` | Sí, por diseño |
| `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET` | `server/booking/accessToken.ts` | Estateless — sin filas propias; el único `BookingRequestRecord` existente ya está `resolved` (ningún acceso de invitado pendiente que dependa de un token vivo) | No |
| `BOOKING_INTERNAL_API_SECRET` | `server/booking/internalAuth.ts` | Sin scheduler real configurado — solo invocación manual/pruebas | No |

### 1.7 Otros dominios de credenciales (fuera de este `.env`)

| Dominio | Archivo | ¿Expuesto por el incidente 3? |
|---|---|---|
| n8n (`N8N_ENCRYPTION_KEY`, Postgres propio de n8n) | `integrations/n8n/.env` | **No** — archivo distinto, no editado ni notificado en esta sesión |
| FacturaScripts (`MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, `FACTURASCRIPTS_ADMIN_PASSWORD`) | `infra/facturascripts/.env` | **No** — archivo distinto, no editado ni notificado en esta sesión |
| Google OAuth (`gcsClientSecret`, tokens) | `data/config-internal.php` dentro del contenedor `espocrm`, gestionado por la extensión Google Calendar Sync — nunca en el `.env` de `apps/web` | **No** — dominio de credenciales completamente separado |
| SMTP operativo (`SMTP_*`) | `.env` raíz | Sí, expuesto (aunque hoy vacío en desarrollo — sin credenciales reales configuradas, "change-me" nunca se rellenó) |

## 2. Diseño del almacén externo de secretos (no creado todavía)

**Objetivo**: ningún secreto real vuelve a residir en un archivo que un
agente de este harness pueda leer, editar o cuyo cambio pueda notificarse
automáticamente.

### 2.1 Ubicación

```
~/.gapssa-secrets/
├── .env.gapssa          # equivalente al .env raíz actual — TODAS las variables
├── .env.facturascripts   # opcional, si también se saca ese dominio
└── .env.n8n              # opcional, ídem
```

- Fuera de `/Users/isainrodrigueznorena/Isain/Gapssa` (el workspace) — ninguna
  herramienta de este harness tiene motivo para tocar `$HOME` fuera del
  proyecto.
- **Nunca** dentro de `~/Desktop`, `~/Documents` ni `~/Library/Mobile
  Documents` si iCloud Drive sincroniza "Escritorio y Documentos" en esta
  Mac — confirmar en Ajustes del Sistema → ID de Apple → iCloud antes de
  crear el directorio; `~/.gapssa-secrets` (oculto, bajo `$HOME` directo) no
  entra en esa sincronización por defecto, pero **debe verificarse**, no
  asumirse.
- Directorio: modo `700` (`drwx------`), propietario el usuario actual.
- Cada archivo dentro: modo `600` (`-rw-------`).
- Nunca bajo control de Git (ni siquiera con `.gitignore` — directamente
  fuera del árbol de cualquier repositorio).

### 2.2 Cómo lo consume cada componente

- **Docker Compose**: `docker compose --env-file ~/.gapssa-secrets/.env.gapssa up -d`
  — mismo `compose.yml`, sin cambios; solo cambia el flag con el que se
  invoca. El `Makefile`/scripts de conveniencia deben actualizarse para
  incluir `--env-file "$$HOME/.gapssa-secrets/.env.gapssa"` en vez de
  depender del `.env` implícito del directorio de trabajo.
- **Proceso `next dev` (`apps/web`)**: en vez de
  `dotenv -e .env -- npm run dev -w @gapssa/web` (script `dev` de
  `package.json` raíz), pasar a
  `dotenv -e "$HOME/.gapssa-secrets/.env.gapssa" -- npm run dev -w @gapssa/web`.
  Cambio de una línea en `package.json`, sin secretos en el propio cambio.
- **Suite de integración** (`vitest.integration.config.ts`,
  `global-setup.ts`): ya crea bases de datos/mailbox efímeros con datos
  sintéticos — solo necesita las credenciales de **conexión** al servidor
  Postgres/Redis local (host/puerto/usuario/contraseña), que deben leerse
  del mismo archivo externo, nunca de un `.env` del repo.
- **Suite unitaria** (`vitest.setup.ts`): hoy carga `.env` real vía
  `dotenv`. Debe cambiar a una de estas dos estrategias (a decidir en la
  ejecución real, no aquí):
  1. Cargar el mismo archivo externo (`~/.gapssa-secrets/.env.gapssa`), o
  2. **Preferible**: generar sus propios secretos CSPRNG efímeros en
     memoria al arrancar la suite para todo lo que sea puramente
     criptográfico (`BOOKING_FIELD_ENCRYPTION_KEYS`, `OTP_HMAC_SECRET`,
     etc. — un test unitario no necesita "el" secreto real, solo *un*
     secreto válido), reservando el archivo externo únicamente para lo que
     sí requiere una conexión real (Postgres/Redis).
- **`.env.example`**: sin cambios — sigue siendo solo placeholders,
  documentación de qué variables existen.
- **`.claude/settings.local.json`**: nunca debe volver a contener un
  fragmento de comando con un secreto embebido (ver medida preventiva ya
  aplicada en el incidente 2 — entradas eliminadas, no sustituidas).

### 2.3 Qué NO cambia

- `compose.yml`, `apps/web/src/server/env.ts`, el resto del código de
  consumo — todos siguen leyendo de `process.env`, exactamente igual;
  cambia únicamente **de dónde** se puebla `process.env` antes de arrancar
  cada proceso.

## 3. Matriz de rotación (S1–S9)

Cada puerta es independiente y debe ejecutarse en orden — una puerta
posterior asume que la anterior ya cerró en verde.

| Puerta | Secreto(s) | Estrategia | Interrupción del servicio | Invalidación | Rollback | Verificación |
|---|---|---|---|---|---|---|
| **S1** | Ninguno (migración de almacén) | Crear `~/.gapssa-secrets/`, copiar el `.env` actual **desde una terminal externa, nunca desde esta sesión** | Ninguna todavía — solo prepara la ruta | N/A | Borrar el directorio externo si algo falla, el `.env` del repo sigue existiendo hasta S9 | Directorio con modo `700`, archivo con modo `600`, fuera de iCloud (confirmado manualmente) |
| **S2** | `POSTGRES_PASSWORD`, `DATABASE_URL_*` | `ALTER ROLE` (igual que el incidente 1, ya probado y documentado) + actualizar el archivo externo | Reinicio de `apps/web` | Conexiones nuevas con el valor anterior fallan de inmediato | `ALTER ROLE` de vuelta al valor anterior si se conservó una copia segura fuera del harness | Conexión real a las tres bases con el valor nuevo (mismo método ya validado: contenedor efímero en la red Docker, nunca vía `127.0.0.1` por la regla `trust`) |
| **S3** | `ESPOCRM_DB_PASSWORD`, `ESPOCRM_DB_ROOT_PASSWORD` | Cambiar el usuario/rol MariaDB dentro del contenedor `espocrm-db` (`ALTER USER`), actualizar archivo externo, reiniciar `espocrm`/`espocrm-daemon`/`espocrm-websocket` | Los tres contenedores EspoCRM | Conexiones nuevas de EspoCRM a MariaDB con el valor anterior fallan | Revertir `ALTER USER` | `app-check` de EspoCRM en verde tras el reinicio |
| **S4** | `ESPOCRM_ADMIN_PASSWORD`, `ESPOCRM_API_KEY` | Cambiar contraseña de `admin` vía UI/`bin/command`; generar una `ESPOCRM_API_KEY` nueva para el `User` `portal-gapssa-api` (nunca reutilizar), revocar la anterior en el propio `User` | Ninguna sobre el proceso principal (usa `simulated`) — solo afecta a un futuro proceso con `ESPO_BOOKING_ADAPTER=http` | Login de `admin` con la contraseña anterior deja de funcionar de inmediato; la API Key anterior deja de autenticar en cuanto se revoca en el `User` | Ninguno necesario salvo volver a generar si se revocó por error | Login de `admin` con la contraseña nueva; `GET /api/v1/App/user` con la API Key nueva → `200` |
| **S5** | `REDIS_PASSWORD`, `REDIS_URL` | `CONFIG SET requirepass` en el servidor + actualizar archivo externo + reiniciar `apps/web` | `apps/web` (reconexión) | Locks/OTP/rate-limit en vuelo se pierden — documentado como aceptable | `CONFIG SET requirepass` de vuelta | `PING` autenticado con la contraseña nueva desde un cliente separado del proceso principal |
| **S6** | `PAYLOAD_SECRET`, `OTP_HMAC_SECRET`, `AUTH_RATE_LIMIT_HMAC_SECRET` | Sustitución directa (ninguno tiene datos persistentes dependientes — sesiones de Payload/retos OTP/ventanas de rate-limit son todos de vida corta) | `apps/web` | Sesiones de administración de Payload activas, cualquier reto OTP pendiente, y cualquier ventana de rate-limit activa quedan invalidadas | Ninguno necesario — impacto ya aceptado por diseño | Login de Payload admin nuevo funciona; flujo de registro/login del portal emite y verifica un OTP nuevo correctamente |
| **S7** | Los cinco secretos de `booking` | Ver `docs/incidente-booking-secrets-local-2026-08-13.md` §5 (estrategia ya detallada por secreto) — **usar versiones `v3` nuevas, nunca las `v2` generadas en esta sesión** (también comprometidas). Ejecutar `rotatePendingGuestIdentities`/`rotatePendingAuthenticatedContactDetails` (`apps/web/src/server/booking/fieldEncryptionRotation.ts`, ya escrito y probado en ensayo efímero — ver §5 de este documento) | `apps/web` | Igual que en el incidente 2 — 0 filas dependientes reales en este momento, impacto mínimo confirmado | El propio módulo de rotación es idempotente y reanudable — reintentar es seguro | Suite `apps/web/tests/integration/fieldEncryptionRotation.int.test.ts` en verde + `countRowsStillOnVersion` en `0` para la versión retirada |
| **S8** | n8n / FacturaScripts / Google | **No aplican a este incidente** — archivos separados, no expuestos (§1.7). Rotar solo si el operador decide hacerlo por higiene general, fuera del alcance de este incidente | — | — | — | — |
| **S9** | Verificación integral + retirada del `.env` comprometido | Tras S2–S7 en verde: confirmar que el proceso principal y todos los servicios operan exclusivamente con el archivo externo, luego **eliminar el `.env` del repo desde una terminal externa** (nunca desde esta sesión) | Ninguna adicional | El `.env` comprometido deja de ser el que carga ningún proceso | Si algo falla, el `.env` original puede recrearse desde el backup local que el operador conserve fuera del harness | `docker compose config` (sin `--env-file` apuntando al repo) debe fallar por variables ausentes — confirma que ya no hay fallback accidental al `.env` del repo |

## 4. Requisitos especiales ya confirmados

- **AES (`BOOKING_FIELD_ENCRYPTION_KEYS`)**: la `v1` original sigue siendo
  necesaria únicamente para poder **descifrar** durante la ventana de
  migración — nunca para cifrar datos nuevos una vez rotada. Las `v2`
  generadas en esta sesión están comprometidas igual que la `v1` y no deben
  activarse nunca; el operador debe generar `v3` en la terminal externa.
- **Email HMAC**: sin dato dependiente hoy (`pending_guest_identities`
  vacía) — sustitución directa, sin necesidad de doble-lookup. Si en el
  futuro hay filas activas al rotar, usar la estrategia de columna
  dual/recalculado descrita en el incidente 2 §5.B.
- **Fingerprint HMAC**: igual patrón que AES — la `v1` se conserva para
  poder recalcular la huella del único `BookingRequestRecord` existente
  (`status=resolved`) si algún camino de código llegara a necesitarlo; la
  `v2` de esta sesión se descarta igual que la de AES.
- **Access token**: sin tokens vivos reales que preservar (el único
  `BookingRequestRecord` está `resolved`) — invalidación directa aceptable,
  documentar igualmente.
- **Internal API**: sin scheduler real — rotar y actualizar el único
  consumidor real (el propio proceso principal, para pruebas manuales).
- **Payload/Auth/OTP**: documentar que rotar invalida sesiones de Payload y
  retos OTP en vuelo — impacto ya aceptado, ambos de vida corta por diseño.
- **Redis**: coordinar servidor (`CONFIG SET`) y clientes (`.env` externo +
  reinicio de `apps/web`) en la misma ventana, para no dejar al servidor
  esperando una contraseña que ningún cliente todavía envía.
- **API Key de EspoCRM**: crear la nueva ANTES de revocar la anterior
  (ventana de solape breve), verificar la nueva funciona, solo entonces
  revocar.
- **MariaDB/Postgres**: cambiar el rol/usuario REAL dentro del motor
  (`ALTER ROLE`/`ALTER USER`), nunca solo el archivo de configuración —
  mismo principio ya aplicado y verificado en el incidente 1.

## 5. Herramientas ya preparadas (sin secretos, no ejecutadas)

- `apps/web/src/server/booking/fieldEncryptionRotation.ts` — módulo de
  recifrado versionado (`rotatePendingGuestIdentities`,
  `rotatePendingAuthenticatedContactDetails`, `countRowsStillOnVersion`),
  transaccional por fila, idempotente, reanudable, sin registrar PII.
  Escrito y probado en esta sesión contra la base efímera de pruebas
  (`apps/web/tests/integration/fieldEncryptionRotation.int.test.ts`, 9
  pruebas: recifrado completo, idempotencia, reanudación tras interrupción
  simulada, `dry-run`, tabla de invitado y de autenticado, conteo por
  versión, fila ya en destino, clave desconocida → error claro). **No
  ejecutado contra ningún dato real** — la base real tiene 0 filas
  dependientes hoy, así que ejecutarlo allí sería un no-op seguro, pero
  esa ejecución queda para la puerta S7, fuera de esta sesión.
- `apps/web/src/server/crypto/fieldCrypto.ts` — adición no disruptiva de
  `encryptFieldWithVersion(plaintext, keyVersion)` (además de la ya
  existente `encryptField`), necesaria para que la rotación pueda cifrar
  con la versión destino sin depender de cuál sea la versión "activa" en
  el momento exacto de ejecutar la migración.
- Scripts de generación/aplicación para el almacén externo — ver
  `scripts/secrets-rotation/` (§ runbook, `docs/runbook-rotacion-secretos-externa.md`).
