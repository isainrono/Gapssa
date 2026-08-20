# scripts/secrets-rotation/

Herramientas de apoyo para la rotación de secretos fuera del harness de
Claude Code — ver `docs/runbook-rotacion-secretos-externa.md` y
`docs/plan-rotacion-secretos-gapssa-2026-08-13.md`.

**Ningún script de este directorio contiene, imprime ni transporta un
valor secreto fuera del archivo destino que tú mismo indiques.** Todos
exigen:

- una ruta destino fuera de este repositorio (abortan si detectan lo
  contrario);
- confirmación interactiva explícita en una terminal real (abortan si
  stdin/stdout no son una TTY, si `ROTACION_GAPSSA_FUERA_DEL_HARNESS` no
  vale exactamente `SI`, si detectan una variable de entorno o un proceso
  ancestro característico de un editor/agente, o si no escribes la frase
  de confirmación exacta);
- modo `--dry-run` para ver qué harían sin escribir nada.

## Historial de revisión de `rotate-all-interactive.sh`

**La v1 de `rotate-all-interactive.sh` fue revisada y RECHAZADA antes de
ejecutarse ni una sola vez** — la revisión no encontró un fallo aislado,
encontró que el diseño entero necesitaba rehacerse. Se documenta aquí para
que el historial quede, tal como pide la propia revisión.

Bloqueos concretos de la v1 (14 categorías, resumen):

1. **Guardia de harness insuficiente** — solo TTY + frase escrita a mano,
   sin variable de entorno explícita ni detección de proceso ancestro.
2. **Secretos en argumentos de proceso** — `psql -c "... PASSWORD '...'"`,
   `docker ... -e MYSQL_PWD=...`, `redis-cli -a <secreto>`: todos visibles
   en `ps` del host.
3. **S4 (EspoCRM) exigía copiar/pegar a mano** en un editor de texto — el
   objetivo explícito era que el usuario no tuviera que hacerlo.
4/5. **PostgreSQL/MariaDB/Redis** no verificaban por una conexión TCP real
   no privilegiada, no enumeraban cuentas reales antes de rotar, y
   `REDIS_URL` se dejaba como edición manual.
6. **Auditoría de Payload/OTP/rate-limit sin citar código** — una
   afirmación, no una investigación.
7. **S7 (booking)** sustituía/retiraba secretos sin comprobar con una
   consulta real cuántas filas dependían de cada versión, y dejaba la
   retirada de versiones comprometidas como "más adelante si quieres".
8. **S8** se marcaba completada sin inventario ni evidencia.
9. **S9** permitía "continuar de todas formas" con puertas anteriores
   incompletas.
10. **El `.env` comprometido** se quedaba renombrado (`.bak`) DENTRO del
    workspace en vez de en cuarentena fuera de él.
11. **Sin máquina de estados** — una puerta interrumpida a mitad podía
    quedar ambiguamente "ni hecha ni deshecha".
12. **Sin backup/rollback real** pese a mencionarlos.
13. **Sin ninguna prueba más allá de `bash -n`.**
14. Consecuencia de 3/4/5: el usuario SÍ tenía que abrir archivos, copiar
    valores y editar URLs a mano — justo lo que se le pidió evitar.

### Qué corrige la v2 (esta versión)

- **Guardia de harness real** (`lib.sh`): variable de entorno explícita
  (`ROTACION_GAPSSA_FUERA_DEL_HARNESS=SI`) + lista de variables
  delatoras + ancestría de proceso (verificada empíricamente: un proceso
  lanzado desde el CLI de Claude Code en macOS tiene literalmente `claude`
  como ancestro directo) + TTY + frase — con pruebas positivas y
  negativas de cada capa (`lib.test.sh`).
- **Cero secretos en argumentos de proceso**: SQL por stdin, contraseñas
  vía `--env-file` de `docker run` apuntando a un fichero temporal `600`
  fuera del workspace (borrado tras usarse), autenticación HTTP vía
  fichero de configuración de `curl` (`-K`), nunca `-c`/`-e`/`-a`/`-u` con
  un valor real.
- **S4 completamente automatizado, sin editor de texto**: la contraseña de
  `admin` se cambia con `bin/command set-password` (lee por stdin — el
  código fuente real de la imagen `espocrm/espocrm:10.0.3-apache-trixie`
  se inspeccionó para confirmarlo, no se asumió) y la API Key se regenera
  con la API REST nativa de EspoCRM (`POST /api/v1/UserSecurity/apiKey/generate`,
  también verificada contra el código fuente real,
  `application/Espo/Resources/routes.json`).
- **PostgreSQL/MariaDB**: enumeran cuentas/hosts reales antes de tocar
  nada, aplican y verifican por una conexión TCP real (nunca el socket
  local `trust` del contenedor) contra un usuario NO privilegiado, y
  confirman que la contraseña anterior queda rechazada. **Redis**:
  `REDIS_URL` se sincroniza automáticamente con percent-encoding correcto.
- **Auditoría de Payload/OTP/rate-limit con archivo y línea citados** del
  código real (sesión 2026-08-14).
- **S7**: guarda contra `NODE_ENV=production`
  (`apps/web/src/server/booking/rotationSafetyChecks.ts`), consulta con
  código real (no una suposición) cuántas filas dependen de cada versión
  antes de sustituir/retirar nada, y retira las versiones comprometidas
  **dentro de la misma puerta** en cuanto el conteo real llega a cero.
- **S8** produce inventario con evidencia (rutas de archivo comprobadas),
  nunca un "no aplica" sin más.
- **S9 rechaza ejecutarse** si falta cualquier puerta anterior — sin
  opción de "continuar de todas formas" — y verifica automáticamente
  servicios, conexiones, adaptador, ACL, ausencia de secretos sueltos en
  el workspace y retirada de versiones comprometidas.
- **`.env` en cuarentena fuera del workspace** (`~/.gapssa-secrets/env-quarantine/`),
  nunca un `.bak` dentro del repositorio.
- **Máquina de estados cerrada** (`pending/prepared/applying/verifying/done/
  rollback_required/failed`) con `trap` en `SIGINT`/`SIGTERM` — una
  interrupción a mitad nunca se pierde en silencio.
- **Backup cifrado** (`openssl enc -aes-256-cbc -pbkdf2`) del archivo
  externo antes de cada puerta que lo modifica, con restauración guiada.
- **Arnés de pruebas** (`tests/`) con `docker`/`curl`/`npx`/`ps` falsos y
  un driver de pseudo-terminal real (el script exige TTY, no se puede
  probar por una tubería) — 51 aserciones automatizadas en total (32 en
  `lib.test.sh` + 19 de flujo completo en `tests/run_scenarios.py`),
  incluyendo verificar que ningún valor secreto generado aparece jamás en
  el argv registrado de los comandos falsos.

Durante la propia construcción de la v2, las pruebas encontraron y
corrigieron errores reales (no solo del arnés de pruebas): un `heredoc`
combinado con una tubería en la puerta S4 que dejaba a Python sin la
respuesta JSON de la API de EspoCRM (`json.load(sys.stdin)` leía el propio
código fuente del heredoc como "entrada", nunca la respuesta real), y
`gapssa_secrets_shred` ignoraba silenciosamente todos los ficheros
temporales salvo el primero cuando se le pasaba más de uno.

### Qué corrige la v3 (esta versión) — v2 también fue revisada y rechazada

Una revisión directa del código de la v2 encontró 19 bloqueos adicionales,
y una segunda pasada encontró que 15 de las primeras correcciones seguían
siendo insuficientes o inseguras. Resumen de lo que cambia:

- **`--dry-run` nunca cambia el almacén externo**: `state_set()` es ahora
  el único punto de choque de la máquina de estados — si `--dry-run` está
  activo, ninguna puerta escribe jamás en `.rotation-status` (bug real de
  la v2: cada puerta llamaba a `state_set`/`enter_gate`/`leave_gate_*` sin
  que ninguna comprobara `$DRY_RUN`). Probado con identidad byte a byte
  del almacén externo antes/después (`tests/run_scenarios.py::scenario_dry_run_identity_s2`).
- **Modelo de estados ampliado**: `pending/prepared/applying/verifying/
  done/blocked/recovery_required/rollback_required/failed`. `blocked`
  (S7/S8): la puerta no puede completarse de forma segura ahora mismo —
  nunca "done" con una dependencia viva. `recovery_required` (S2–S5):
  se restauró la credencial ANTERIOR al servidor para recuperar
  disponibilidad tras un fallo — nunca cuenta como rotación completa,
  hay que volver a ejecutar la puerta para generar un secreto nuevo.
- **S7 atómica por secreto**: los 5 secretos de booking
  (`BOOKING_FIELD_ENCRYPTION_KEYS`, `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS`,
  `BOOKING_EMAIL_LOOKUP_HMAC_SECRETS`, `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS`
  — ahora TODOS versionados, ver más abajo — y `BOOKING_INTERNAL_API_SECRET`)
  siguen el mismo patrón: generar/activar v3 siempre, migrar/reindexar
  donde aplica, recontar EN FRESCO (nunca reutilizar un conteo de antes de
  migrar), retirar la versión vieja solo si ese conteo fresco es 0. S7
  termina `done` únicamente si los 5 quedan limpios — si no, `blocked`.
- **`BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET` → mapa versionado**: cada
  `booking_request_records` guarda ahora `accessTokenKeyVersion` (con qué
  versión se firmó su token, al crear la fila) — verificar usa SIEMPRE esa
  versión exacta, nunca "probar todas las del mapa". Retirar una versión
  depende de `countLiveBookingRequestsReferencingAccessTokenVersions`,
  nunca de `countLiveBookingRequests` a secas (ese conteo no demuestra qué
  clave firmó el token que un invitado concreto tiene en la mano).
- **`BOOKING_EMAIL_LOOKUP_HMAC_SECRET` → mapa versionado**: nueva columna
  `pending_guest_identities.emailLookupHmacKeyVersion`, búsqueda dual bajo
  todas las versiones del mapa durante convivencia
  (`guestFlow.ts`/`repository.ts::countActivePendingRequestsByEmailHmacCandidates`),
  y nuevo `emailLookupHmacRotation.ts` que reindexa el HMAC desde el
  correo DESCIFRADO (nunca desde el HMAC anterior, que es de un solo
  sentido) — mismo patrón transaccional/idempotente que
  `fieldEncryptionRotation.ts`.
- **Auditoría real de columnas cifradas**: `encryptedColumnsAllowlist.ts`
  compara una allowlist cerrada contra `information_schema.columns` del
  Postgres REAL — nunca solo un análisis de nombres sobre `db/schema.ts`.
- **`BOOKING_INTERNAL_API_SECRET`**: verificación directa de
  `isValidInternalApiSecret` (nuevo aceptado, anterior rechazado, ausente
  rechazado) — nunca el sweep real, el valor anterior solo en memoria del
  proceso.
- **Backups sin material de rollback recuperable sin control adicional**:
  la clave de cifrado de cada backup es una FRASE de recuperación que vive
  solo en memoria del proceso (generada por CSPRNG y mostrada una única
  vez, o introducida a mano) — nunca en disco. Backup con ensayo de
  restauración inmediato, comprobación de espacio libre, y ABORTA la
  puerta si cualquier paso falla (nunca "sigo sin backup"). Recuperar el
  valor ANTERIOR de un secreto ya rotado (para las reverificaciones
  negativas de S9, incluso en un proceso nuevo tras una interrupción) se
  hace en streaming desde el backup cifrado — nunca se crea un
  `.env.gapssa` descifrado completo en disco.
- **S9 estricta**: arranca/detiene apps/web ella misma (comando único, sin
  pedir abrir otra pestaña) con un lanzador Node propio
  (`start-apps-web.mjs`, sin `npx`, sin heredar `process.env` sin filtrar,
  escaneo de fugas EN PROCESO — nunca `grep <secreto>`), pone en cuarentena
  TODOS los `.env*` reales ANTES de cualquier arranque probatorio (nunca
  solo existencia/ruta, nunca abre su contenido), reverifica que las
  credenciales ANTERIORES de S2–S5 quedan rechazadas (recuperadas del
  backup, nunca asumidas), confirma ACL/adaptador/ausencia de versiones
  comprometidas, y promueve S6 de `prepared` a `done` solo tras una
  verificación dinámica real (OTP/rate-limit reales contra Redis, JWT de
  Payload) — nunca antes.
- **S6 sin secretos antiguos persistidos**: los artefactos de prueba
  previos a rotar (reto OTP real, JWT firmado con el `PAYLOAD_SECRET`
  viejo) nunca incluyen ningún secreto criptográfico — solo salidas de un
  solo sentido, de vida corta, fuera del workspace.
- **S8 con enum cerrado**: `not_configured` / `separate_secret_store` /
  `affected_rotated` / `affected_pending` / `unable_to_determine` — nunca
  texto libre persistido, solo existencia/ruta (nunca contenido).
- **Infra de pruebas de integración DESECHABLE**
  (`tests/disposable-infra.sh`): Postgres 18 + Redis 8 propios,
  etiquetados, en un proyecto Docker `gapssa-rotation-v3-tests-<rand>`
  aparte — nunca `compose.yml`, nunca los contenedores reales de GAPSSA.
  `apps/web/vitest.rotation-integration.config.ts` +
  `tests/integration/rotation/global-setup.disposable.ts` (nunca importa
  el `global-setup.ts` normal, que depende de `docker compose up`).
- **Lenguaje sin sobre-afirmar**: ningún texto (código, informe) afirma
  borrado forense — `gapssa_secrets_shred` sigue siendo "mejor esfuerzo",
  nunca una garantía en macOS/APFS (copy-on-write).

### Bloque 6 — cierre integral: ensayo real S1→S9 completo y desechable

Bloque 6 exigió un ensayo real de `rotate-all-interactive.sh` completo, en
orden S1→S9, en una sesión continua, contra infraestructura Docker
DESECHABLE aislada (nunca contra `gapssa-espocrm-1` ni ningún recurso
GAPSSA real) — nunca `fake-bin` para la ejecución principal. Vive en
`tests/s1_s9_full_rehearsal.py`; construye un "repo sombra" (symlinks +
copias reales donde Turbopack lo exige — ver comentarios del propio
fichero) para que `REPO_ROOT` resuelva ahí, nunca al repositorio real,
levanta PostgreSQL 18 + MariaDB 11.4 + Redis 8 + EspoCRM 10.0.3 propios,
instala los campos custom REALES de `Meeting` (los mismos artefactos del
repositorio, nunca metadata ficticia mínima) y arranca `apps/web` real en
un **puerto efímero configurable** (`GAPSSA_APPS_WEB_PORT`, ver más abajo)
para no interferir con ningún proceso que ya esté escuchando en el 3000.

**Auditoría de secretos en procesos (dónde SÍ/NO puede aparecer un
secreto, S1–S9):**

| Superficie | Mecanismo | Dónde |
|---|---|---|
| `argv` (visible por `ps` de cualquier usuario) | Nunca `-u user:pass`, `-H "X-Api-Key: ..."`, `psql -c "...PASSWORD '...'"`, `MYSQL_PWD=...`, `redis-cli -a <secreto>`. Todo REST usa `curl -K <config-temporal>` con el fichero creado en modo `600` desde su primer byte (`gapssa_secrets_mktemp_secure`) | `rotate-all-interactive.sh` (`curl -K "$curl_admin_cfg"` en S4/S9), `lib/dbRecovery.sh` (socket Unix Postgres, `PREPARE`/`EXECUTE` MariaDB) |
| entorno del proceso hijo | Nunca `...process.env` sin filtrar ni `PGPASSWORD`/`MYSQL_PWD`/`REDISCLI_AUTH` como variable de entorno de un contenedor (visible vía `docker inspect`/`/proc/<pid>/environ`) — allowlist cerrada (`BASE_ENV_ALLOWLIST`) + solo las claves de `$SECRETS_FILE` ya validadas | `lib/loadSecretsEnv.mjs::buildChildEnv`, usado por `start-apps-web.mjs` (apps/web real de S9) y `lib/run-tsx.mjs` (sondas de S6/S7) |
| ficheros en disco | Almacén externo modo `700`/`600`; temporales SIEMPRE `gapssa_secrets_mktemp_secure` (CSPRNG, `600` atómico, registro inmediato en la pila global, limpieza `EXIT`/`INT`/`TERM`, mejor-esfuerzo de sobrescritura antes de `unlink` — nunca una garantía forense en APFS); backups cifrados con frase de recuperación que vive solo en memoria del proceso, nunca en disco | `lib.sh`, `01-init-external-store.sh` |
| logs de proceso (`apps-web.log`, etc.) | Escaneo EN PROCESO (nunca `grep <secreto>`) limitado al inventario CERRADO de material realmente secreto — ver clasificación abajo | `start-apps-web.mjs::cmdScanLogForSecrets` |
| informe final | Solo nombres de puerta/estado, booleanos y conteos — nunca un valor, DSN, fragmento, base64 o ruta con secreto (ver estructura fija en el propio generador) | `rotate-all-interactive.sh` (bloque `REPORT_FILE`, gate_s9) |

**Clasificación cerrada de `SECRETS_FILE_KEY_INVENTORY`** — bug real
encontrado por el ensayo integral: el escáner de fugas de S9 comprobaba
las 80 claves del inventario completo, incluyendo parámetros operativos NO
sensibles (`TRUSTED_PROXY_HOP_COUNT`, `OTP_MAX_ATTEMPTS`,
`ARGON2_PARALLELISM`...) cuyos valores cortos y genéricos ("3", "60")
coinciden por pura casualidad con cualquier log real (timestamps, puertos,
duraciones) — la Puerta S9 (y, en cascada, la promoción de S6 a `done`,
que solo ocurre dentro de `gate_s9` tras el escaneo) nunca llegaba a
`done` pese a que ningún secreto real se hubiera filtrado nunca.
Corregido con `lib/loadSecretsEnv.mjs::SECRET_KEY_CLASSIFICATION` — mapa
CERRADO y EXPLÍCITO (nunca por coincidencia parcial del nombre en
runtime) de las 80 claves a `secret` / `sensitive-connection-string` /
`non-secret-configuration`; `SECRET_VALUE_KEYS` (lo que de verdad escanea
S9) se DERIVA de esa clasificación, nunca se mantiene por separado.
`lib/secretClassification.test.mjs` exige cobertura exacta 80/80 — una
clave nueva o desconocida en el inventario hace fallar la prueba hasta
ser clasificada explícitamente. Además, `MIN_SECRET_VALUE_LENGTH=16`: un
valor clasificado `secret`/`sensitive-connection-string` más corto que
eso (todo secreto generado por este sistema usa ≥24 bytes — ver
`02-generate-secret.sh`) hace abortar el escaneo ANTES de comparar nada
— indistinguible de una coincidencia genérica de log, así que "escanearlo
igual" no daría garantías reales.

**Segundo bug real encontrado y corregido — verificación de
`.env.example` silenciosamente ignorada**: en `gate_s9`, un fallo de
`lib/verifyEnvExample.mjs` solo ponía `checks_ok=false`, pero esa variable
ya no se volvía a comprobar en ningún punto posterior del flujo — S9 podía
arrancar `apps/web`, escribir el informe y llamar a `leave_gate_done "S9"`
con normalidad pese a que la verificación de placeholders de
`.env.example` hubiera fallado de verdad. Corregido: ahora falla cerrado
de inmediato (restaura `.env*` desde cuarentena, purga el `curl config`
temporal, `leave_gate_failed "S9"`, `return 1`) exactamente igual que
cualquier otra comprobación de la puerta.

**`GAPSSA_APPS_WEB_PORT`** (variable NO secreta) — permite que S9 (y este
mismo ensayo) arranquen `apps/web` en un puerto distinto de 3000 sin tocar
ningún proceso que ya esté escuchando ahí. Ausente ⇒ comportamiento real
sin cambios (puerto 3000, sin flags `-p`/`-H` al hijo). Presente ⇒ debe
validar como entero 1-65535 (vacío/no numérico/negativo/cero/fuera de
rango aborta ANTES de arrancar nada, nunca cae a `PORT` implícitamente);
`start-apps-web.mjs` resuelve un puerto libre real (`net.createServer`),
con reintento acotado ante `EADDRINUSE` (nunca un puerto fijo alternativo)
y arranca `next dev -p <puerto> -H 127.0.0.1` (solo loopback). El
healthcheck deriva su URL del MISMO puerto validado, y verifica que el
proceso hijo (PID) sigue vivo y es dueño del puerto antes de aceptar un
`200` — un servidor ajeno que responda en ese puerto nunca produce un
falso positivo si el hijo real murió. 25 pruebas dedicadas en
`start-apps-web.test.mjs` (puerto ausente/válido/9 valores inválidos,
arranque/parada real, hijo muerto, servidor ajeno en el puerto deseado,
invocación a través de symlink).

**Hallazgo operativo (no bloqueante para la rotación, mecanismo distinto):
`bin/command rebuild` de EspoCRM con `DivisionByZeroError`** — reproducido
de forma determinista en la instancia desechable: `currencyList` en
`data/config.php` trae por defecto `["USD"]`, mientras `compose.yml` fija
`ESPOCRM_DEFAULT_CURRENCY: EUR` — un `rebuild` con la moneda por defecto
ausente de `currencyList` dispara la excepción. No afecta a ninguna puerta
S1–S9 (ninguna ejecuta `rebuild`), pero si alguna vez se ejecuta
`bin/command rebuild` contra la instancia real, `currencyList` debe
incluir explícitamente `EUR` primero.

**Tercer bug real encontrado y corregido — sin bloqueo de concurrencia
(B6-7)**: no existía NINGÚN mecanismo que impidiera dos sesiones de
`rotate-all-interactive.sh` a la vez contra el MISMO almacén externo — dos
procesos podían leer el mismo estado `pending`, rotar el mismo secreto en
paralelo, o pisarse las escrituras de `$SECRETS_FILE`/`$STATUS_FILE`.
Corregido con `gapssa_secrets_lock_acquire`/`_release` (`lib.sh`): lock
por DIRECTORIO (`$SECRETS_DIR/.rotation.lock`, `mkdir` es atómico en
cualquier POSIX — nunca `flock(1)`, ausente en macOS de fábrica),
adquirido al principio de `main()` y liberado por un `trap ... EXIT`
(cubre fin normal, cualquier `exit` de una puerta, y la interrupción por
señal). Un lock cuyo dueño registrado ya no está vivo se recupera
automáticamente como huérfano — pero SOLO si tiene más de
`grace_seconds=2` de antigüedad: la primera versión de este mecanismo
tenía su propia condición de carrera real (reproducida por
`lib.test.sh`, 5 iteraciones de dos adquisiciones lanzadas exactamente a
la vez): entre el `mkdir` del ganador y la siguiente línea escribiendo su
PID en `owner`, el perdedor podía leer un `owner` vacío, confundirlo con
un huérfano, borrar el lock recién creado del ganador y quedarse él mismo
con el lock — los dos procesos terminaban creyendo tener el lock a la
vez. El margen de gracia cierra la ventana: un huérfano de verdad siempre
es viejo, un lock en plena creación nunca lo es. `gapssa_secrets_lock_release`
nunca borra un lock cuyo PID propietario registrado no coincide con el
propio (protege contra un orden de traps inesperado robándole el lock a
otra sesión).

**Cuarto bug real encontrado y corregido — teardown incompleto
(B6-8)**: tras varias ejecuciones del ensayo integral en la misma sesión,
el inventario Docker del host mostraba NETWORKS y VOLUMES de proyectos
desechables de ejecuciones ANTERIORES todavía presentes — pese a que cada
ejecución había reportado "cero contenedores residuales", la única
comprobación que existía. `docker compose down -v --remove-orphans` no
garantiza por sí solo la retirada de networks/volumes bajo contención de
recursos del host (verificado empíricamente: esta máquina tenía ~50GB de
imágenes/27GB de build cache de OTROS proyectos ajenos a GAPSSA, lo que
ralentiza a `docker compose` visiblemente). Corregido en
`tests/s1_s9_full_rehearsal.py`: igual que con los contenedores,
inventario etiquetado EXACTO (mismo `label={LABEL_KEY}=<proyecto>`, nunca
un prune amplio) que enumera y retira explícitamente cualquier
network/volume residual, con aserciones dedicadas de "cero residuales"
para cada tipo (antes solo existía para contenedores). Además, `compose()`
ahora tiene un `timeout` (180s por defecto) — antes un `docker compose
up`/`down` colgado por contención real bloqueaba el proceso Python
INDEFINIDAMENTE, sin ninguna de las protecciones de timeout que sí
existían a nivel de la sesión PTY (por puerta).

**Checklist saneado por puerta (S1–S9)** — cada fila es un criterio real
verificado por `tests/s1_s9_full_rehearsal.py` contra infraestructura
desechable (nunca solo "el comando no devolvió error"), sin que ningún
valor secreto participe en el propio criterio de éxito/fallo:

| Puerta | Verificación real (fail-closed) |
|---|---|
| S1 | Almacén externo creado; `.env.gapssa` modo `600`; directorio modo `700`. |
| S2 (PostgreSQL) | `POSTGRES_PASSWORD` distinto del original; la contraseña ANTERIOR queda rechazada por TCP real; la NUEVA autentica por TCP real en las 3 bases lógicas (`gapssa_cms`/`gapssa_auth`/`gapssa_booking`); dato canario (schema propio, invisible a Payload) sobrevive. |
| S3 (MariaDB/EspoCRM) | `ESPOCRM_DB_PASSWORD`/`ESPOCRM_DB_ROOT_PASSWORD` rotados; anterior rechazada; nueva autentica por TCP real; dato canario sobrevive; `app-check` de EspoCRM en verde tras rotar. |
| S4 (EspoCRM admin/API) | `ESPOCRM_ADMIN_PASSWORD` rotado; login ANTERIOR rechazado, NUEVO funciona; `portal-gapssa-api` encontrado y `ESPOCRM_API_KEY` rotada (no vacía); la API Key nueva autentica de verdad. |
| S5 (Redis) | `REDIS_PASSWORD` rotado; anterior rechazada; nueva autentica por TCP real (force-recreate real del contenedor); clave canaria conservada. |
| S6 (OTP/rate-limit/Payload) | Queda `prepared` hasta que S9 ejecuta la verificación dinámica REAL (OTP real end-to-end, contador de rate-limit fresco, JWT de Payload antiguo invalidado/nuevo funciona) — solo entonces `done`. |
| S7 (booking, 5 secretos versionados) | Los 5 mapas (`BOOKING_FIELD_ENCRYPTION_KEYS`, `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS`, `BOOKING_EMAIL_LOOKUP_HMAC_SECRETS`, `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS`, `BOOKING_INTERNAL_API_SECRET`) activan versión nueva; retirada de versión vieja solo con reconteo EN FRESCO de filas vivas que la referencian. |
| S8 | Enum cerrado de estado del `.env` comprometido (nunca texto libre persistido). |
| S9 | Reverifica que TODAS las credenciales anteriores (S2–S5) siguen rechazadas; ACL real de `Meeting` (`aclClosed=true`, `adminRuntimeCoreVerified=true`, Portal + ≥1 Profesional efectivo, sin rol heredado/directo permisivo inesperado); adaptador `simulated`; cero versiones comprometidas; arranca `apps/web` real EXCLUSIVAMENTE desde el almacén externo (sin `.env*` en el workspace); healthcheck real; escaneo de fugas limitado a `SECRET_VALUE_KEYS` (nunca el inventario completo); `.env.example` con placeholders; informe saneado único, estructuralmente verificado. |

**Matriz de fallos e interrupciones (B6-6)** — escenarios reales
verificados (`tests/run_scenarios.py`, PTY real contra el script real con
`docker`/`curl`/`npx` falsos — nunca Docker/EspoCRM reales; complementa el
ensayo integral, que verifica el camino feliz completo contra
infraestructura real):

| Escenario | Qué demuestra |
|---|---|
| `ctrl_c_mid_gate` | SIGINT a mitad de una puerta -> `rollback_required` (nunca `done` a medias, nunca estado ambiguo). |
| `resume_after_interrupt` | Relanzar tras una interrupción retoma exactamente donde quedó, sin repetir puertas ya `done`. |
| `unknown_gate` | `--only <puerta-inexistente>` falla limpio, nunca ejecuta nada. |
| `s9_blocked_without_prior_gates` | S9 rechaza arrancar si S1–S8 no están `done` — nunca "continúa de todas formas". |
| `s9_rejects_forward_recovery_required` | Un estado `forward_recovery_required` en cualquier puerta previa bloquea S9 exactamente igual que cualquier otro estado no-`done`. |
| `s3_divergence_root_declined` / `_provided` | Reconciliación real de credenciales root divergentes de MariaDB, con y sin credencial root válida disponible. |
| `dry_run_identity_s2` | `--dry-run` dejа el almacén externo byte a byte idéntico (nunca escribe nada real). |
| `restore_real_backup_success_recovery_required` / `_s3_recovery_required` | Restauración real desde backup cifrado tras una interrupción real (Ctrl-C durante S3) -> `recovery_required`, nunca una rotación completa fingida. |
| `orphan_restore_tmp_not_adopted` | Un temporal huérfano de una restauración interrumpida nunca se adopta/reutiliza en la siguiente ejecución. |
| `backup_rehearsal_no_plaintext_watcher` / `recover_old_secret_value_no_plaintext_watcher` | Ningún secreto en claro queda en disco durante el ciclo completo de backup/recuperación (watcher activo durante todo el escenario). |
| `backup_schema_tagging` | Cada backup queda etiquetado con la versión de esquema REAL detectada en el momento exacto de crearlo (nunca un valor fijo/cacheado — root cause del `DivisionByZeroError` de este mismo Bloque 6). |
| `s6_artifact_reexecution_policy` | Un artefacto de prueba de S6 de una ejecución previa/interrumpida BLOQUEA S6 (nunca se retira en automático); solo se retira tras una verificación dinámica que se completó de verdad. |
| `s6_missing_probe_script_fails_closed` | Si falta el script de sonda de S6, la puerta falla cerrado (nunca continúa sin la verificación). |
| Bloqueo de concurrencia (`lib.test.sh`, 6 pruebas dedicadas) | Segunda sesión con dueño vivo -> rechazada; bloqueo huérfano -> recuperado tras `grace_seconds`; `release` nunca borra un lock ajeno; carrera real de dos adquisiciones simultáneas -> exactamente una gana (5 iteraciones). |
| Reserva atómica de rutas exclusivas (`lib.test.sh`, ~24 pruebas dedicadas — Bloque 6, corrección de colisiones) | `gapssa_secrets_reserve_exclusive_path`/`gapssa_secrets_reserve_with_retry`, usadas por el nombre de cada backup Y por el informe final: primera reserva; nombre/symlink/directorio ya existente -> nunca tocado, nunca adoptado; colisión repetida -> fallo cerrado tras agotar reintentos; dos procesos REALMENTE concurrentes -> exactamente uno gana (5 iteraciones); interrupción entre reserva y escritura -> destino vacío, nunca corrupto. |
| `gapssa_secrets_find_report_for_run_id` (`lib.test.sh`) | Selección del informe final EXCLUSIVAMENTE por `run_id` (identidad de sesión), nunca por fecha de modificación: informe normal; cero informes; informe de formato antiguo (sin `run_id`) coexistente nunca adoptado; dos sesiones en el mismo segundo distinguidas sin ambigüedad; dos informes con el mismo `run_id` -> fallo cerrado (nunca "el más reciente"); informe con contenido corrupto localizado igual (identidad de nombre ≠ validación de contenido). |
| `.env.example` inválido en S9 (Bloque 6, corrección de colisiones) | Escenario PTY REAL dedicado contra el script interactivo real y contra infraestructura desechable real (`tests/s9_env_example_failure_rehearsal.py`) — `.env.example` corrupto (valor sensible sin forma de placeholder): S1–S5/S7/S8 completan `done`, S6 queda `prepared` (correcto — su verificación dinámica ocurre después del punto donde falla S9), S9 NUNCA se promociona a `done`, no se genera ningún informe, `.env*` real queda restaurado desde cuarentena (directorio de cuarentena vacío tras el fallo), teardown limpio, `.env.example`/`.env` reales del repositorio byte a byte intactos. Las variantes ausente/ilegible/incompleto/fallo-del-parser se cubren a nivel de algoritmo en `lib/verifyEnvExample.test.mjs` (15 aserciones). **Última ejecución: 32/32** (tras corregir dos bugs reales que este mismo escenario encontró — guardia de auto-invocación de `verifyEnvExample.mjs` rota contra symlinks, y `restore_env_files_from_quarantine` invocada antes de definirse — ver más abajo). |

Última ejecución (cierre del Bloque 6, corrección de colisiones):
`run_scenarios.py` 73/73; `lib.test.sh` 128/128.

**Resultado del ensayo integral** (última ejecución limpia — cierre del
Bloque 6, corrección de colisiones, 68/68): las nueve puertas terminan
exactamente `done` (incluida S9, tras corregir el bug real de
comparación de rutas — ver más abajo); ACL real verificada con
`aclClosed=true`, `adminRuntimeCoreVerified=true`, Portal GAPSSA API y al
menos un Profesional Gapssa efectivo verificados, sin rol heredado ni
directo permisivo inesperado; ningún secreto ficticio en el log de
`apps/web`; informe saneado ÚNICO por sesión y por `run_id` (nunca
ambiguo, nunca solo por fecha), sin ningún valor/DSN/fragmento de alta
entropía, con la sección "Puertas:" y los campos de resumen verificados
estructuralmente; teardown deja cero contenedores, cero networks y cero
volumes residuales del proyecto desechable, y el inventario Docker de
TODOS los proyectos compose reales (incluyendo `gapssa`) idéntico
antes/después.

### Bloque 6 — corrección final de colisiones (backup/informe) y escenario PTY de `.env.example`

El cierre previo del Bloque 6 dejó tres limitaciones residuales
explícitas: la reserva del nombre de cada backup se basaba solo en
timestamp + 4 bytes aleatorios (sin colisión forzada, sin prueba
dedicada); el informe final se nombraba solo por fecha
(`rotation-report-<fecha>.txt`, sin identidad de sesión); y el escenario
PTY de `.env.example` roto contra el script interactivo real seguía
pendiente. Este ciclo cierra los tres — y, en el proceso, TRES bugs
reales aparecieron, ninguno detectado por ningún nivel de prueba
anterior (unitaria, `run_scenarios.py` con fake-bin, ni el ensayo
integral feliz previo), exactamente por ser el primer ejercicio real de
estas rutas concretas: uno lo encontró el capstone S1→S9 camino feliz al
re-ejecutarse tras los cambios de este bloque (comparación de rutas por
igualdad de cadena en vez de identidad de fichero); los otros dos los
encontró el escenario PTY dedicado de `.env.example` (guardia de
auto-invocación de `verifyEnvExample.mjs` rota contra symlinks, y
`restore_env_files_from_quarantine` invocada antes de definirse) — ver
"Bug real...", "Segundo bug real..." y "Tercer bug real..." más abajo.
Resultado final, contra infraestructura real desechable: capstone S1→S9
camino feliz **68/68** (confirma que las correcciones no rompen la
rotación completa), escenario `.env.example`
roto **32/32** (confirma el contrato de fallo cerrado, incluida la
restauración real de `.env*` desde cuarentena).

**Algoritmo atómico de reserva** (`lib.sh`) — primitiva compartida por el
nombre de cada backup cifrado Y por el informe final:

- `gapssa_secrets_reserve_exclusive_path <ruta>`: nunca "comprueba
  existencia y escribe después" en dos pasos separados. Usa `noclobber`
  de bash para la redirección `>` — el propio shell abre el destino con
  `open(O_CREAT|O_EXCL|O_WRONLY)`, atómico a nivel de kernel, que POSIX
  garantiza que falla con `EEXIST` si el último componente de la ruta ya
  existe (fichero regular, directorio, symlink colgante o no) — nunca
  sigue un symlink existente para crear el destino. Modo `600` desde el
  primer byte (`umask 077` alrededor de la creación, nunca create+chmod
  en dos pasos). Devuelve, en éxito, 3 líneas (ruta, directorio canónico,
  `dev ino uid modo`) — mismo contrato que
  `gapssa_secrets_mktemp_secure_same_dir` — para fijar la identidad con
  `gapssa_secrets_verify_pinned_tmp` antes de escribir y revalidarla justo
  antes de la escritura real.
- `gapssa_secrets_reserve_with_retry <dir> <candidato_fn> [máx=8]`:
  reintento ACOTADO con un nuevo candidato (nuevo componente CSPRNG y/o
  timestamp) por intento, generado por una función inyectada — las
  pruebas suministran candidatos deterministas sin depender del reloj
  real. Agota los intentos -> falla cerrado, sin tocar, adoptar ni borrar
  ningún artefacto preexistente en ningún momento del bucle.
- `gapssa_secrets_find_report_for_run_id <secrets_dir> <run_id>`:
  localiza el informe ACTUAL exclusivamente por su `run_id` — nunca por
  fecha de modificación más reciente. Cero informes -> falla. Más de uno
  -> falla (ambigüedad, nunca "el más reciente"). Un informe de formato
  antiguo (sin `run_id`) o de otro `run_id` nunca se adopta.
- ~24 pruebas dedicadas en `lib.test.sh` (ver tabla de escenarios más
  arriba): primera reserva; nombre/symlink/directorio ya existente;
  colisión repetida hasta agotar reintentos; dos procesos REALMENTE
  concurrentes reservando el mismo candidato (5 iteraciones, exactamente
  uno gana); interrupción entre reserva y escritura (destino vacío,
  nunca corrupto); limpieza que nunca toca artefactos ajenos.

**Identidad de sesión del informe final** (`rotate-all-interactive.sh`) —
`RUN_ID` (CSPRNG, `_gapssa_secrets_random_suffix_hex 8`) se genera una
única vez al arrancar el script, `readonly`. El informe final se nombra
`rotation-report-<timestamp>-<RUN_ID>.txt` (nunca solo la fecha), se
reserva atómicamente, se escribe a un temporal seguro EN EL MISMO
directorio (mismo patrón que la restauración de S2-S5), se hace `fsync`
del fichero (`lib/fsyncPath.mjs`, hasta ahora escrito pero nunca
conectado a ningún flujo real), se revalida la identidad del temporal Y
del destino reservado justo antes del `rename` atómico, y se hace
`fsync` del directorio (mejor esfuerzo — ver comentario de
`fsyncPath.mjs` sobre APFS). S9 termina con una verificación CONTRACTUAL:
`gapssa_secrets_find_report_for_run_id` debe encontrar EXACTAMENTE un
informe para `$RUN_ID`, y debe ser el mismo fichero (`-ef`, identidad
real de dispositivo+inodo — nunca igualdad de cadena de ruta, ver bug
real de abajo) que se acaba de publicar; si no, la puerta falla cerrada
aunque el resto de S9 haya ido bien.

**Bug real encontrado y corregido por el capstone S1→S9 de este mismo
ciclo**: la primera versión de la verificación final comparaba la ruta
devuelta por `find_report_for_run_id` contra `$report_out` con
IGUALDAD DE CADENA (`!=`). `$SECRETS_DIR` (definido desde `$HOME`, sin
canonicalizar) y `$report_out` (canonicalizado con `pwd -P` dentro de la
reserva atómica) pueden referirse al MISMO fichero real con dos cadenas
distintas en cualquier sistema donde `$HOME` atraviese un symlink — en
macOS, `/var` -> `/private/var`, y el propio ensayo integral desechable
crea su `$HOME` de prueba bajo `/var/folders/...`. La comparación de
cadenas marcaba entonces S9 como fallida (`leave_gate_failed`) pese a que
el informe se había escrito, publicado y verificado correctamente — el
capstone real detectó esto (S9 no llegaba a `done` pese a que todas las
demás comprobaciones, incluida la del propio informe, pasaban). Corregido
comparando identidad de fichero (`-ef`, mismo dispositivo+inodo) en vez
de igualdad de cadena.

**Segundo bug real, más severo, encontrado por el escenario PTY dedicado
de `.env.example`** — `lib/verifyEnvExample.mjs` usaba
`if (import.meta.url === \`file://${process.argv[1]}\`)` como guardia de
"¿me están invocando directamente como script?". Node RESUELVE
`import.meta.url` a la ruta REAL del módulo (symlinks seguidos), pero
`process.argv[1]` conserva la ruta TAL CUAL se invocó — si
`rotate-all-interactive.sh` se invoca a través de CUALQUIER ruta con un
symlink de por medio (el propio `$SCRIPT_DIR` del "repo sombra" de los
ensayos desechables, pero también cualquier despliegue real que invoque
el script a través de un symlink), esa comparación literal NUNCA era
verdadera: el bloque que de verdad lee el argumento, valida el fichero e
imprime el resultado JAMÁS se ejecutaba. `node` terminaba con éxito
(exit 0) sin imprimir nada, y `gate_s9` interpretaba silenciosamente esa
salida vacía como ".env.example válido" — **sin haber validado una sola
línea**. El primer intento del escenario PTY dedicado no detectó ningún
fallo (S9 llegaba a `done` incluso con `.env.example` deliberadamente
roto) precisamente por este bug — confirmado reproduciéndolo de forma
aislada (`node <ruta-real>/lib/verifyEnvExample.mjs` falla correctamente;
`node <ruta-symlink>/lib/verifyEnvExample.mjs` con el MISMO fichero
termina en `exit 0` sin imprimir nada). Corregido con el mismo patrón
robusto que YA usaban otros cuatro ficheros de este mismo directorio
(`decideRecoveryPlan.mjs`, `secretValueContract.mjs`,
`validateProbeJson.mjs`, `verifyEspoAclSnapshot.mjs` — comparar
`fileURLToPath(import.meta.url)` contra `realpathSync(process.argv[1])`,
nunca una cadena literal) — `verifyEnvExample.mjs` era la única
excepción a una convención ya establecida en el propio repositorio.
Regresión cubierta con 4 pruebas CLI nuevas en
`lib/verifyEnvExample.test.mjs` (vía ruta real y vía symlink, contenido
válido e inválido, en las cuatro combinaciones) — nunca solo la función
exportada, que ya funcionaba correctamente y por tanto no había
detectado nada.

**Escenario PTY real de `.env.example` roto**
(`tests/s9_env_example_failure_rehearsal.py`) — reutiliza exactamente la
misma infraestructura desechable que `s1_s9_full_rehearsal.py` (mismas
funciones, mismo "repo sombra", Postgres+MariaDB+Redis+EspoCRM+apps/web
reales); la única diferencia deliberada es sustituir el `.env.example`
del repo sombra (por defecto un symlink al real — nunca se lee/escribe a
través de él, se borra el symlink primero) por un fichero REGULAR nuevo
con un valor sensible sin forma de placeholder. Demuestra sobre el script
interactivo real: S1–S5/S7/S8 completan `done` con normalidad (nada
antes de S9 lee `.env.example`), S6 queda `prepared` (correcto — su
verificación dinámica ocurre después del punto donde falla S9); S9 nunca
se promociona a `done`; no se genera ningún informe (el fallo ocurre
antes de reservar/escribir uno); el `.env*` real de la sesión queda
RESTAURADO desde cuarentena (directorio de cuarentena vacío, ver tercer
bug abajo); teardown limpio; el `.env.example`/`.env` REALES del
repositorio quedan byte a byte intactos. Las variantes ausente/ilegible/
incompleto/fallo-del-parser se cubren a nivel de algoritmo, rápido y sin
Docker, en `lib/verifyEnvExample.test.mjs` (15 aserciones) — la
combinación de ambas (no solo la prueba unitaria del helper) es lo que
este bloque exigía cerrar.

**Tercer bug real, encontrado por el mismo escenario** —
`restore_env_files_from_quarantine()` (`rotate-all-interactive.sh`,
`gate_s9`) estaba definida DESPUÉS de su primer punto de uso posible (el
fallo de `.env.example`, la primera de sus 5 rutas de llamada). Bajo
`set -e`, invocar una función dentro de un cuerpo que a su vez se invocó
como condición de un `if` (`if ! "gate_${gate}"; then` en `main()`) NO
aborta el script: "command not found" se limita a imprimirse y la
ejecución sigue con la siguiente línea — así que `leave_gate_failed`/
`return 1` seguían ocurriendo correctamente (S9 fallaba bien, verificado
por las dos primeras ejecuciones del escenario), pero la restauración
REAL de `.env*` desde cuarentena, pese al mensaje que la prometía, nunca
llegaba a ejecutarse en ese camino concreto — el `.env` de la sesión se
quedaba abandonado en `~/.gapssa-secrets/env-quarantine/`. Reproducido
de forma aislada (sin Docker) con un script mínimo que reproduce
exactamente el patrón "función indefinida invocada dentro de un cuerpo
llamado desde la condición de un `if`, bajo `set -euo pipefail`".
Corregido moviendo la definición al principio de la puerta, justo
después de construir `$quarantine_map`, antes de cualquier ruta de
fallo que pueda necesitarla. Regresión cubierta por dos aserciones
nuevas en el propio escenario PTY (fichero restaurado, directorio de
cuarentena vacío).

## Archivos

- `lib.sh` — funciones compartidas: guardas de ruta/harness/permisos,
  ficheros temporales seguros, máquina de estados. Nunca se ejecuta solo,
  lo cargan los demás scripts con `source`.
- `01-init-external-store.sh <ruta-externa> [--dry-run]` — crea el
  directorio externo (modo `700`). Puerta S1 del plan.
- `02-generate-secret.sh <archivo-externo> --set-line VAR [--dry-run]` /
  `02-generate-secret.sh <archivo-externo> --set-json-map VAR VERSION [--dry-run]`
  — genera un secreto CSPRNG y lo escribe directamente en el archivo
  externo indicado (nunca lo imprime). Usar en las puertas S2–S7 según la
  variable.
- `rotate-all-interactive.sh [--dry-run] [--only Sx]` — asistente único que
  encadena las puertas S1–S9 en orden, pidiendo confirmación explícita
  antes de cada una, automatizando todo lo que es seguro automatizar (ver
  "Qué corrige la v2" arriba), y pausando SIN marcar la puerta como
  completada en los pasos que de verdad requieren una acción humana
  irreducible. Recuerda el estado de cada puerta en el propio almacén
  externo (nunca en este repositorio), así que se puede interrumpir y
  relanzar sin repetir trabajo ni perder progreso. Termina con un informe
  saneado (sin ningún valor secreto) y, aparte y con su propia
  confirmación, pone el `.env` comprometido en cuarentena fuera del
  workspace.
- `lib.test.sh` — pruebas de las guardas de seguridad (rutas, harness,
  máquina de estados, ficheros temporales), contra datos desechables, sin
  tocar ningún secreto real. `bash lib.test.sh`.
- `lib/aclRest.sh` — helpers de introspección REST de solo lectura
  (User/Role/Team, `select=` cerrado) y del algoritmo de fusión de roles de
  EspoCRM 10.0.3 usados por la verificación real de ACL de S9 — fichero
  compartido, única fuente de verdad, entre `gate_s9` (en
  `rotate-all-interactive.sh`) y `tests/espo_acl_rehearsal.sh`.
- `lib/verifyEspoAclSnapshot.mjs` (+ `.test.mjs`) — evalúa el permiso ACL
  EFECTIVO de `Meeting` para `portal-gapssa-api` (Portal GAPSSA API) y los
  usuarios profesionales (Profesional Gapssa) a partir de un snapshot REST
  cerrado, replicando el algoritmo exacto del núcleo (roles directos ∪
  roles de equipo, "el más permisivo gana", ausencia de clave = acceso
  completo) — nunca solo "el usuario existe". Contrato de salida cerrado
  (booleanos + enum `yes|no|unknown`, sin IDs/PII). Sustituye la
  comprobación superficial anterior de S9 (Bloque 4).
- `lib/dbRecovery.sh` — aplicación/verificación real de credenciales para
  la RECUPERACIÓN post-restauración de S2 (Postgres, vía la vía
  administrativa de socket Unix — `pg_hba.conf` trae `local all all
  trust` en la imagen auditada, verificado empíricamente, nunca depende
  de conocer la contraseña que se sustituye) y S3 (MariaDB root+espocrm,
  reconciliación idempotente por usuario vía una credencial root que SÍ
  autentica — MariaDB nunca ofrece una vía passwordless, verificado
  empíricamente). Quoting seguro: Postgres vía `format()`/`:'var'` de
  psql; MariaDB vía `FROM_BASE64()`/`QUOTE()`/`PREPARE-EXECUTE` — ambos
  probados con comilla simple, comilla doble, backslash, `$()`, `;`,
  salto de línea embebido y Unicode. Fichero compartido, única fuente de
  verdad, entre `gate_s2`/`gate_s3` y `tests/s2_s5_recovery_rehearsal.sh`
  (Bloque 5).
- `lib/espoRecovery.sh` — recuperación de EspoCRM (S4): contraseña de
  admin (REVERSIBLE, `bin/command set-password` nunca exige la anterior)
  y API Key (IRREVERSIBLE — nunca se reaplica un valor antiguo, solo
  "recuperación hacia delante": generar una NUEVA, aplicarla, y escribir
  solo ESE campo en `$SECRETS_FILE`, nunca una restauración completa).
- `lib/redisVerify.mjs` (+ `.test.mjs`) — verifica, con PING autenticado
  por TCP REAL (cliente `redis` de node_modules, nunca `docker compose
  exec` dentro del propio contenedor), si una contraseña candidata
  autentica en Redis — usado por S5 y por su recuperación.
- `lib/decideRecoveryPlan.mjs` (+ `.test.mjs`, 32 aserciones) — decide el
  ESTADO final de una puerta (`recovery_required` /
  `forward_recovery_required` / `server_coordination_required`) a partir
  de evidencia YA verificada por sub-secreto — función pura, nunca toca
  red/disco, nunca asume "coordinado" sin verificación fresca. Ver
  `_GAPSSA_VALID_STATES` en `lib.sh` para el nuevo estado
  `forward_recovery_required` (Bloque 5) — S9 lo rechaza exactamente
  igual que cualquier otro estado no-`done`.
- `lib/recoveryEvidence.sh` — constructores JSON genéricos del contrato
  de evidencia que exige `decideRecoveryPlan.mjs`, reutilizados por las
  cuatro funciones `_recovery_evidence_sN()` de `rotate-all-interactive.sh`.
- `tests/` — arnés de pruebas de extremo a extremo de
  `rotate-all-interactive.sh`: `fake-bin/` (`docker`/`curl`/`npx`/`ps`
  falsos, nunca tocan servicios reales — extendido en Bloque 5 para
  simular la vía administrativa real de Postgres/MariaDB), `pty_driver.py`
  (el script exige una TTY real, así que las pruebas necesitan una
  pseudo-terminal real, no una tubería), `run_scenarios.py` (los
  escenarios), `espo_acl_rehearsal.sh` (ensayo desechable y reproducible
  de la verificación real de ACL de S9 — ver "Ensayo de ACL de S9"
  abajo), `s2_s5_recovery_rehearsal.sh` (ensayo desechable y reproducible
  de la recuperación real de S2-S5 — PostgreSQL+MariaDB+Redis+EspoCRM
  reales y desechables, ver "Ensayo de recuperación de S2-S5" abajo),
  `s1_s9_full_rehearsal.py` (ensayo integral S1→S9 completo, camino
  feliz, contra infraestructura real desechable — ver "Bloque 6 — cierre
  integral" arriba), `s9_env_example_failure_rehearsal.py` (mismo
  arnés que el anterior, pero con `.env.example` corrupto — Bloque 6,
  corrección de colisiones, ver más arriba). Ver "Ejecutar las pruebas"
  abajo.

## Ejecutar las pruebas

```sh
bash scripts/secrets-rotation/lib.test.sh
python3 scripts/secrets-rotation/tests/run_scenarios.py
scripts/secrets-rotation/run-node-tests.sh
```

**`run-node-tests.sh` es el runner OFICIAL de las 17 pruebas Node**
(`lib/*.test.mjs` + `start-apps-web.test.mjs`) — ejecútalas siempre así,
nunca con `node --test lib/*.test.mjs start-apps-web.test.mjs` en un solo
proceso. Motivo: varias de estas pruebas levantan servidores TCP reales
en localhost (desechables); `node --test` con varios ficheros los corre
EN PARALELO por defecto, y en una máquina con otros procesos ya
escuchando en el rango de puertos elegido (visto en la práctica: puertos
19000–19999 ocupados por herramientas ajenas a este repositorio)
aparecían colisiones intermitentes que no eran un fallo real del código.
`run-node-tests.sh` ejecuta cada fichero en su propio proceso `node
--test <fichero>`, uno detrás de otro, con una pausa breve entre
ficheros para dejar drenar procesos/descriptores del fichero anterior —
sin reintentos aleatorios que oculten una colisión real. Validado con 10
ejecuciones consecutivas en verde (17/17 cada vez) tras corregir dos
pruebas de `start-apps-web.test.mjs` que sorteaban un puerto fijo sin
comprobar antes si estaba libre (`resolveFreeTestPort` ya existía en el
propio fichero para esto — solo faltaba usarlo ahí).

Sale con 0 solo si las 17 pruebas terminan en verde; con 1 y la lista de
ficheros fallidos en caso contrario. Cualquier proceso hijo residual se
termina al salir (trap en el propio script).

**Validación aislada de manifiestos** (`docs/manifests/checkpoint-v1/`):
si vas a copiar este directorio a una raíz temporal para validarlo de
forma aislada, comprueba antes la longitud de esa raíz con
`scripts/checkpoint-validation/check-socket-path-length.sh <raíz>` y usa
siempre una raíz corta bajo `/tmp` directamente (`mktemp -d
/tmp/gapssa-XXXXXX`), nunca una ruta profunda anidada — algunas
herramientas de test usan sockets de dominio Unix, con un límite de
sistema de 104 bytes en `sockaddr_un.sun_path` (macOS/BSD) que una ruta
de ensayo excesivamente larga puede agotar. Usa siempre
`scripts/checkpoint-validation/generate-synthetic-env.sh` para el
`.env` de esa copia — nunca el `.env` real (ver
`docs/incidente-lectura-env-validacion-manifiestos-2026-08-19.md`).

**`shellcheck`**: no está instalado en esta máquina — omitido del barrido
estático hasta que se instale (`brew install shellcheck`). `bash -n` sobre
los 15 ficheros `.sh` de este directorio (incluyendo `tests/`) sigue
ejecutándose siempre y no sustituye a `shellcheck`, solo confirma sintaxis
válida.

Ambas SÍ pueden ejecutarse dentro de cualquier sesión — no tocan Docker,
Postgres, MariaDB, Redis ni EspoCRM reales, no tocan `~/.gapssa-secrets`
real ni el `.env` real. `run_scenarios.py` copia los scripts a un árbol de
fixture temporal (para que `REPO_ROOT` resuelva ahí, no al repositorio
real) y antepone `tests/fake-bin/` al `PATH`.

Última ejecución (cierre del Bloque 6, corrección de colisiones):
`lib.test.sh` 128/128 (incluye las 24 pruebas nuevas de reserva atómica
de rutas — ver más abajo), pruebas Node (`lib/*.test.mjs`, 16 ficheros,
incluyendo `verifyEspoAclSnapshot.test.mjs` con 114 aserciones y el nuevo
`verifyEnvExample.test.mjs` con 15), `run_scenarios.py` 73/73. Además,
`tests/espo_acl_rehearsal.sh` (REST real contra una instancia EspoCRM
10.0.3 desechable, no incluido en los recuentos anteriores porque
requiere Docker) — última evidencia documentada 7/7 casos, teardown
limpio, inventario del proyecto GAPSSA real idéntico antes/después; no
re-ejecutado en esta sesión de cierre porque los cambios de este bloque
(reserva atómica de backup/informe, identidad de sesión) no tocan la
verificación de ACL. Lo mismo aplica a `s2_s5_recovery_rehearsal.sh`
(S2–S5 real, no re-ejecutado por la misma razón — sí se re-ejecutaron
`lib.test.sh`, `run_scenarios.py`, las pruebas Node, la suite de
integración desechable de rotación y el capstone integral S1→S9, ver más
abajo).

### Ensayo de ACL de S9 (EspoCRM real, pero DESECHABLE)

```sh
scripts/secrets-rotation/tests/espo_acl_rehearsal.sh
```

Levanta EspoCRM 10.0.3 + MariaDB en un proyecto/red/volúmenes/puerto
propios (prefijo obligatorio `gapssa-acl-rehearsal-`), instala metadata
FICTICIA mínima de los 3 campos custom de `Meeting` auditados, crea
identidades/roles puramente ficticios vía REST y ejercita, con REST real
(no un mock), los mismos 7 casos que
`lib/verifyEspoAclSnapshot.test.mjs` cubre a nivel de algoritmo: correcto;
Portal con `edit=yes` incorrecto; Profesional con `read=yes` incorrecto;
rol de equipo heredado permisivo (Portal); usuario API ausente;
profesional que hereda un rol permisivo por equipo; profesional con un
rol directo permisivo adicional. Verifica la imagen runtime del propio
contenedor (mismo mecanismo que `gate_s9`), nunca toca `gapssa-espocrm-1`
ni ningún recurso GAPSSA real, nunca imprime credenciales, y termina
siempre con `down -v` + una comprobación de que el inventario Docker del
proyecto GAPSSA real es idéntico antes/después (incluso si algún caso
falla, por el `trap` de teardown registrado desde el principio). Requiere
Docker — no se ejecuta como parte de `run_scenarios.py`.

### Suite de integración de rotación/criptografía (Postgres/Redis reales, pero DESECHABLES)

```sh
PROJECT="$(bash scripts/secrets-rotation/tests/disposable-infra.sh new-project-name)"
bash scripts/secrets-rotation/tests/disposable-infra.sh verify-isolated "$PROJECT"
bash scripts/secrets-rotation/tests/disposable-infra.sh up "$PROJECT"
bash scripts/secrets-rotation/tests/disposable-infra.sh env "$PROJECT" /tmp/mi-env-desechable
set -a; source /tmp/mi-env-desechable; set +a
( cd apps/web && npx vitest run --config vitest.rotation-integration.config.ts )
bash scripts/secrets-rotation/tests/disposable-infra.sh down "$PROJECT"
bash scripts/secrets-rotation/tests/disposable-infra.sh verify-clean "$PROJECT"
```

Nunca usa `compose.yml` ni toca ningún contenedor/red/volumen real de
GAPSSA (`verify-isolated`/`verify-clean` lo demuestran con un inventario
automático — `docker inspect` de todo recurso gestionado por `docker
compose` en la máquina, antes/después, diff automático). Última ejecución:
55/55 (7 ficheros) — `rotationSafetyChecks`, `fieldEncryptionRotation`,
`accessToken.rotation`, `emailLookupHmacRotation`,
`encryptedColumnsAllowlist.rotation`, `s6DynamicChecks.rotation`,
`migration0008AccessTokenBackfill`.

## Lo que este directorio NUNCA hace por sí mismo

- No decide cuándo rotar cada secreto sin preguntar — cada puerta exige tu
  "si" explícito.
- Ningún script imprime, registra ni transporta un valor secreto fuera del
  archivo destino que tú mismo indiques, ni lo deja aparecer en un
  argumento de proceso visible por `ps`.
- No se ejecuta automáticamente ni de forma no interactiva — todos exigen
  `ROTACION_GAPSSA_FUERA_DEL_HARNESS=SI`, una terminal real (TTY), ausencia
  de señales de editor/agente, y la frase de confirmación exacta.
- `lib.sh`, `01-init-external-store.sh` y `02-generate-secret.sh` nunca
  reinician servicios ni tocan el `.env` del repositorio — solo preparan o
  escriben en el almacén externo.
- `rotate-all-interactive.sh` es la excepción deliberada: sí reinicia los
  contenedores necesarios y sí puede mover el `.env` del repositorio a
  cuarentena, porque ese es su propósito (completar la rotación real) —
  pero solo tras tu confirmación puerta por puerta, con máquina de
  estados y backup cifrado antes de cada cambio, y solo cuando tú lo
  ejecutas desde tu propia terminal.
- Ninguna puerta que requiera de verdad una acción humana (hoy: ninguna —
  hasta S4 quedó automatizado en la v2) se marca "completada" solo porque
  pulsaste Enter; se marca completada cuando una verificación automática
  lo confirma.
