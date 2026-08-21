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

### Bloque 7 — corrección "dry-run fresco S1→S9"

Un dry-run manual sobre una máquina fresca (`~/.gapssa-secrets`
inexistente, servicios GAPSSA detenidos) reprodujo un defecto
bloqueante: S1 en `--dry-run` informaba correctamente
(`would_create_dir=...`, `[dry-run] no se copia .env todavía`,
`estado quedaría: S1=done`), pero al aceptar S2 el asistente abortaba con
`ERROR: no existe .../.env.gapssa todavía. Ejecuta primero la puerta S1.`
— S2 exigía el artefacto FÍSICO de S1 incluso bajo `--dry-run`, pese a
que S1 en `--dry-run` nunca lo crea por diseño.

**Causa exacta**: `require_secrets_file()` comprobaba `[ ! -f
"$SECRETS_FILE" ]` sin mirar `$DRY_RUN` en absoluto. Auditando el mismo
patrón contra las 9 puertas se encontraron 3 focos más del mismo defecto
de fondo ("una puerta dry-run no crea su salida; la siguiente exige
físicamente esa salida, o lee estado/secretos que en dry-run no deben
existir"):

1. `field_from_secrets_file()` leía `$SECRETS_FILE` con `grep`
   incondicionalmente — si un almacén externo REAL ya existía en esa
   máquina (de una rotación real anterior), un `--dry-run` posterior
   leía su contenido de verdad.
2. `current_secrets_schema_version()` invocaba
   `lib/detectSecretsSchemaVersion.mjs` sobre `$SECRETS_FILE` real en
   cuanto este existía físicamente, sin mirar `$DRY_RUN` — llamada desde
   `enter_gate()`, en el camino de TODAS las puertas.
3. `02-generate-secret.sh` comprobaba `[ ! -f "$TARGET_FILE" ]` ANTES de
   su propio flag `--dry-run` — pasarle `--dry-run` sobre un archivo
   destino inexistente abortaba igual con un error físico.
4. `gate_s3()`: el healthcheck real (`_gapssa_wait_healthy`, `docker
   compose ps`/`docker inspect` reales) y el prompt de la contraseña
   ROOT actual de MariaDB vivían ANTES del corte de `--dry-run` de esa
   puerta — bajo dry-run, `docker compose up -d` de la línea anterior
   nunca arranca nada real (`run_cmd`), así que el healthcheck fallaba
   de verdad contra un contenedor inexistente y bloqueaba la puerta, y
   además se pedía una credencial real sin necesidad.

**Diseño del estado virtual**: `state_set()`/`state_get()` — ya
documentado como el único punto de choque de la máquina de estados desde
el Bloque anterior (nunca escriben `.rotation-status` bajo `--dry-run`)
— ahora también son la única fuente de verdad de LECTURA bajo
`--dry-run`: en memoria del proceso, con variables indirectas Bash 3.2
(`GAPSSA_DRY_VSTATE_<gate>`, nunca un array asociativo — sintaxis de
Bash 4+ prohibida en este directorio por
`tests/static_bash32_compat_guard.sh`), nunca en disco. `require_secrets_file()`
y `backup_secrets_file()` preguntan `state_get S1` (virtual) en vez de
`-f "$SECRETS_FILE"` (real). `field_from_secrets_file()` sirve, bajo
`--dry-run`, valores puramente sintéticos derivados ÚNICAMENTE de
`.env.example` — reutiliza
`scripts/checkpoint-validation/generate-synthetic-env.sh` (ya auditado,
con su propio guard-test: nunca abre `.env` real), cargados una única
vez en variables de proceso indirectas y con el temporal que los
contuvo triturado y borrado de inmediato. `current_secrets_schema_version()`
devuelve un `active` fijo bajo `--dry-run` (el único esquema consistente
con un S1 fresco, que es lo único que `--dry-run` puede simular).
`02-generate-secret.sh` corta en `--dry-run` ANTES de cualquier
comprobación física. `gate_s3()` mueve su corte de `--dry-run` antes del
healthcheck y del prompt de contraseña.

Consecuencia intencional de este diseño: `--only <puerta> --dry-run` en
AISLAMIENTO (proceso nuevo, sin que las puertas anteriores hayan corrido
—ni siquiera de forma simulada— en ESE MISMO proceso) sigue rechazando
igual que antes exigía el artefacto físico — la diferencia es que ahora
nunca "hace trampa" leyendo un almacén externo real preexistente en esa
máquina para simular esa precondición en su lugar. El recorrido continuo
`rotate-all-interactive.sh --dry-run` (sin `--only`, el caso que reporta
el defecto original) no se ve afectado: las 9 puertas corren en el mismo
proceso, así que el estado virtual se propaga de una a la siguiente
exactamente igual que antes se esperaba que lo hiciera el estado real.

**Resumen saneado de cierre**: al terminar (con o sin `--only`) bajo
`--dry-run`, el asistente imprime un bloque final con `dry_run=true`,
`S1`..`S9=simulated_ok` (o `simulated_<estado>` si alguna quedó
pendiente/omitida — nunca `done` sin calificar), `real_writes=0`,
`real_services_touched=0`, `real_secrets_generated=0`,
`real_secrets_read=0`, `external_store_created=false`,
`ready_for_real_run=true/false` y la lista de puertas pendientes si
aplica — nunca puede confundirse con el informe final de una rotación
real (`gate_s9`, formato completamente distinto).

**Pruebas nuevas** (`tests/run_scenarios.py`, Escenarios A-F): fixture
propio con `.env` TRAMPA (valor centinela, nunca el `.env` real) y
`scripts/checkpoint-validation/` copiado (necesario para servir valores
sintéticos). A — usuario fresco, S1→S9 completo respondiendo `si`, cero
artefactos, centinela nunca en stdout/stderr, ningún fichero preexistente
del repo (incluido `.env`) se modifica. B — `--only S2 --dry-run` sin S1
previo en esa sesión falla por estado virtual ausente. C — S1 aceptada
en la misma sesión, S2 continúa sin exigir `.env.gapssa` físico. D — las
9 puertas `simulated_ok`, cero invocaciones a `docker`/`curl`
(`fake-bin`, transcript de argv vacío). E — responder `salir` termina
limpiamente, cero residuos (incluido el temporal sintético bajo
`TMPDIR`). F — almacén externo REAL preexistente bajo un `HOME`
temporal (rotación previa completa simulada, `S1`..`S9=done` reales):
centinela propio del almacén nunca aparece, contenido byte a byte
intacto, la sesión simula S1 igual que en una máquina fresca (nunca
adopta el `done` real como sustituto). Límite reconocido: estas pruebas
verifican ausencia del centinela en la salida y unicidad byte a byte del
contenido antes/después (mismo método que el resto de este arnés,
`tests/run_scenarios.py`/`s1_s9_full_rehearsal.py`) — no instrumentan
llamadas `open()`/`read()` a nivel de sistema operativo (`strace`/`dtrace`),
así que no sustituyen una auditoría de syscalls si esa garantía más
fuerte llega a ser necesaria.

Última ejecución (cierre del Bloque 7, corrección de dry-run fresco):
`run_scenarios.py` 97/97 (73 previas + 24 nuevas de los Escenarios A-F),
`lib.test.sh` 128/128 (sin cambios — este bloque no toca `lib.sh`),
`run-node-tests.sh` 17/17 ficheros, `tests/static_bash32_compat_guard.sh`
17/17, cinco ejecuciones consecutivas de
`rotate-all-interactive.sh --dry-run` completas (S1→S9, sin `--only`)
contra el script real, todas con código de salida 0 y sin crear
`~/.gapssa-secrets`.

## S3A — recuperación de ROOT de MariaDB (subpuerta separada)

Existe para un caso concreto y real (no hipotético — motivado por una
ejecución real de S3 que falló en su primera autenticación root con
`ERROR 1045`, antes de generar/aplicar ninguna contraseña nueva): el
valor de `ESPOCRM_DB_ROOT_PASSWORD` en el almacén externo NO coincide
con la contraseña EFECTIVA del volumen real de `espocrm-db`.

**Causa raíz** (confirmada leyendo el ENTRYPOINT REAL de la imagen local
`mariadb:11.4`, nunca inventada): `docker-entrypoint.sh` solo aplica
`MARIADB_ROOT_PASSWORD` al volumen la PRIMERA vez que arranca contra un
`$DATADIR` vacío (`DATABASE_ALREADY_EXISTS` se fija únicamente por
`[ -d "$DATADIR/mysql" ]`). En cualquier arranque posterior contra un
volumen YA inicializado esa variable se IGNORA por completo — si el
valor almacenado cambió alguna vez sin que un `ALTER USER` equivalente
llegara a aplicarse con éxito contra el volumen real (rotación
interrumpida, restauración de un backup más antiguo, edición manual), el
volumen y el almacén quedan desincronizados de forma silenciosa, y
ningún arranque de `docker compose up` lo detecta ni lo corrige. `gate_s3`
por sí solo NO puede recuperarse de esto: MariaDB nunca ofrece una vía
administrativa sin contraseña (a diferencia de Postgres — ver
`lib/dbRecovery.sh`), así que sin NINGUNA credencial que autentique como
root, ningún `ALTER USER` autenticado es posible.

**Mecanismo de recuperación** (`--only S3A`, nunca parte del recorrido
normal S1→S9, autorización explícita e independiente de la de S3): usa
el mecanismo OFICIAL de MariaDB para pérdida de contraseña root
(`--skip-grant-tables --skip-networking`, KB oficial) contra un
contenedor DESECHABLE separado que monta el MISMO volumen — nunca el
contenedor real, nunca reinicializa ni recrea el volumen. Ver
`lib/dbRootRecovery.sh` para la implementación completa y comentada, y
`tests/s3a_root_recovery_rehearsal.sh` para el ensayo desechable que la
valida contra MariaDB 11.4 real (34/34 aserciones, dos ejecuciones
consecutivas reproducibles, ver "Ensayo de recuperación root de S3A"
abajo).

Pasos, en orden, cada uno con su propia condición de parada (si
cualquiera falla, la puerta ABORTA sin continuar al siguiente):

1. Para `espocrm-db` LIMPIAMENTE (`docker compose stop` — nunca
   kill/rm), confirma la parada real (`State.Running=false`), y
   comprueba que NINGÚN OTRO contenedor (de cualquier proyecto Compose,
   no solo el nuestro — Docker no lo impide por defecto) tiene el mismo
   volumen montado — aborta sin tocar nada si encuentra alguno.
2. Backup CIFRADO (mismo algoritmo AES-256-CBC+PBKDF2 que los backups del
   almacén externo) del volumen YA PARADO, en streaming, verificado con
   DOS comprobaciones independientes: estructural (`tar -tf` tras
   descifrar) Y de contenido (digest SHA-256 del flujo original,
   comparado contra el digest del flujo descifrado — necesario porque un
   tar plano con bytes de CONTENIDO corrompidos supera `tar -tf` sin
   error alguno; hallazgo real del ensayo desechable). Si cualquiera de
   las dos falla, la puerta aborta SIN tocar ninguna contraseña.
3. Arranca un contenedor DESECHABLE (`--network none`, cero variables de
   entorno de contraseña, cero puertos) con el mismo volumen, en modo
   `--skip-grant-tables --skip-networking` — solo alcanzable por socket
   local dentro de ese contenedor.
4. Enumera TODAS las filas `root@host` reales (solo lectura,
   `mysql.user`) — nunca asume `root@'%'` como la única.
5. Aplica la MISMA contraseña nueva a TODAS las filas enumeradas, EN UNA
   ÚNICA sesión/conexión (`FLUSH PRIVILEGES` una vez, todos los
   `ALTER USER`, `FLUSH PRIVILEGES` una vez). Esto es obligatorio, no
   cosmético — hallazgo real del ensayo desechable: bajo
   `--skip-grant-tables`, cualquier `FLUSH PRIVILEGES` reactiva la
   comprobación real de autenticación para toda conexión NUEVA a partir
   de ese momento (documentado como advertencia en el KB oficial de
   MariaDB) — abrir una conexión nueva por cada fila (y hacer
   `FLUSH PRIVILEGES` antes/después de cada una, como haría el patrón ya
   usado por `gate_s3` con credenciales reales) rompe la segunda fila en
   adelante con `Access denied ... (using password: NO)`, porque el
   `FLUSH` de la primera fila ya reactivó la autenticación real contra la
   cuenta que ACABABA de cambiar.
6. Retira el contenedor desechable (apagado limpio + `docker rm -f`
   siempre, pase lo que pase).
7. Arranca `espocrm-db` normal y verifica por TCP REAL (nunca solo por
   socket) que la contraseña nueva autentica.
8. Solo ENTONCES actualiza `ESPOCRM_DB_ROOT_PASSWORD` en el almacén
   externo de forma atómica y MÍNIMA (un único campo, el resto del
   documento intacto byte a byte) — la ÚLTIMA acción de la puerta, nunca
   la primera. Si esta escritura falla tras la contraseña YA verificada
   por TCP, la puerta queda `blocked` (nunca reintenta S3A a ciegas, que
   volvería a cambiar la contraseña root sin necesidad) con instrucciones
   explícitas.

**S3 mejorado** (mismo cierre): antes de pedir la contraseña root a mano,
`gate_s3` ahora prueba PRIMERO, en silencio (nunca la imprime, vía
fichero de opciones 600 — el mismo mecanismo que ya usa `mariadb_capture`
para todo lo demás), la contraseña ya almacenada en el archivo externo.
Solo si esa prueba silenciosa falla se pide la contraseña a mano, con un
aviso explícito que apunta a S3A si el problema persiste.

**Nunca hace**: crear/borrar cuentas, tocar `ESPOCRM_DB_PASSWORD` (la
cuenta `espocrm`, que sigue siendo responsabilidad exclusiva de S3),
tocar ninguna base de datos ni tabla de aplicación, ni reinicializar el
volumen. S3A recupera EXCLUSIVAMENTE el acceso root — tras completarse,
sigue haciendo falta volver a lanzar S3 (recorrido completo o
`--only S3`) para la rotación normal de `espocrm`.

## S3B — reconciliación de data/config-internal.php (subpuerta separada)

Existe para un caso concreto y real (no hipotético — detectado con
`probes/dbConfigLayerProbe.sh` contra un despliegue real: `S3` llegó hasta
"sincronizó config-internal.php" y solo falló en el `app-check` final, pero
`data/config-internal.php` se quedó con un valor DISTINTO del que ya
comparten MariaDB y el almacén externo).

**Causa raíz** (confirmada leyendo el código, nunca inventada):
`_espo_sync_config_password` (`lib/dbRecovery.sh`) aceptaba `rename()` como
éxito sin ninguna relectura posterior que confirmara el valor REALMENTE
escrito — ya corregido ahí (fsync antes de rename + relectura obligatoria),
pero un fichero que quedó desincronizado ANTES de ese arreglo no se corrige
solo. S3B existe para reconciliar exactamente ese fichero, sin volver a
rotar ninguna credencial.

**Precondiciones duras** (`--only S3B`, nunca parte del recorrido normal
S1→S9): `S3=failed` y `S3A=done` — S3B se niega a ejecutarse si cualquiera
de las dos no se cumple. La sonda debe además confirmar
`stored_credential_authenticates=true` ANTES de tocar nada: si el almacén
externo tampoco autentica contra MariaDB real, el problema no es de
`config-internal.php` y S3B se niega a escribir.

**Mecanismo** (ver `lib/espoConfigReconcile.sh` para la implementación
completa y comentada): ninguna operación de fichero usa `docker compose
exec` contra el contenedor real de `espocrm` (que puede estar en bucle de
reinicio — un `exec` contra un contenedor que se reinicia cada pocos
segundos es frágil por construcción). Todas las lecturas/escrituras pasan
por un contenedor DESECHABLE de la MISMA imagen que monta el volumen real
`espocrm-data` directamente — el mismo patrón, ya endurecido y probado, que
usa la propia sonda.

Pasos, en orden, cada uno con su propia condición de parada:

1. Verifica con la sonda que la credencial almacenada autentica.
2. Backup CIFRADO byte a byte de `config-internal.php` (AES-256-CBC+PBKDF2,
   mismo algoritmo que el resto del toolkit), con propietario, grupo, modo,
   tamaño y digest SHA-256 capturados ANTES de tocar nada, y un ensayo de
   restauración en streaming que compara el digest descifrado contra el
   original antes de continuar.
3. Para `espocrm`/`espocrm-daemon`/`espocrm-websocket` LIMPIAMENTE
   (`docker compose stop`) — corta el bucle de reinicio ANTES de escribir.
4. Reescribe SOLO `database.password`, vía el contenedor desechable:
   escritura atómica (`O_CREAT|O_EXCL`, nunca sigue un symlink/fichero
   existente; `fstat` verifica un único hard link), `fsync` antes de
   `rename`, y una RELECTURA posterior que compara el valor realmente
   escrito byte a byte — nunca se informa éxito solo porque `rename()` no
   falló. Restaura el propietario/modo originales.
5. `php -l`.
6. Vuelve a ejecutar la sonda y exige `config_internal_matches_store=true`,
   `effective_config_matches_store=true` (verificado con
   `Espo\Core\Utils\Config` REAL, nunca una reimplementación) Y
   `effective_config_authenticates=true` — los tres, ANTES de arrancar nada.
7. Arranca `espocrm` y exige `app-check` verde SOSTENIDO (3 comprobaciones
   consecutivas, no una sola) antes de continuar.
8. Solo ENTONCES arranca `espocrm-daemon`/`espocrm-websocket`, y confirma
   los TRES contenedores sanos.
9. Marca `S3=done` (refleja el estado real) y `S3B=done`.

**Si cualquier paso falla**: restaura `config-internal.php` desde el backup
byte a byte, deja `espocrm` PARADO a propósito (nunca en bucle de reinicio
sin atender), y deja un estado explícito (`failed` si la restauración
funcionó, `blocked` si la restauración TAMBIÉN falló — nunca reintenta
automáticamente).

**Nunca hace**: generar ni aplicar ninguna credencial nueva, tocar MariaDB,
tocar `ESPOCRM_DB_PASSWORD`/`ESPOCRM_DB_ROOT_PASSWORD` en el almacén
externo, ni ejecutar S2 ni S4–S9.

**S3 mejorado** (mismo cierre): `gate_s3` ahora exige una comparación
posterior a la escritura antes de continuar hacia `docker compose up`
(nunca acepta la escritura como éxito solo por su código de salida), y si
el `app-check` final no queda verde, para `espocrm`/`daemon`/`websocket`
limpiamente en vez de dejarlos en un bucle de reinicio indefinido — con un
aviso explícito que apunta a S3B si el fichero quedó desincronizado.

## Archivos

- `lib.sh` — funciones compartidas: guardas de ruta/harness/permisos,
  ficheros temporales seguros, máquina de estados. Nunca se ejecuta solo,
  lo cargan los demás scripts con `source`.
- `01-init-external-store.sh <ruta-externa> [--dry-run]` — crea el
  directorio externo (modo `700`). Puerta S1 del plan.
- `02-generate-secret.sh <archivo-externo> --set-line VAR --schema-version <v> [--dry-run]`
  — genera un secreto CSPRNG y lo escribe directamente en el archivo
  externo indicado (nunca lo imprime), delegando la escritura en
  `lib/atomicSecretsFileMutate.mjs` (Bloque 9 — nunca `os.O_TRUNC`). Usar
  en las puertas S2–S7 según la variable. El modo `--set-json-map`
  (añadir una versión a un mapa) se retiró: su único llamador real,
  `gate_s7()`, ahora invoca `lib/atomicSecretsFileMutate.mjs` directamente
  para añadir v3 a los 4 mapas de booking en una única reescritura
  atómica (ver Bloque 9).
- `lib/atomicSecretsFileMutate.mjs` (+ `.test.mjs`, 46 aserciones) —
  Bloque 9: única herramienta que reescribe `$SECRETS_FILE` con VARIAS
  mutaciones de campo (sustituir una línea, generar+sustituir una línea,
  generar+añadir una versión a un mapa JSON, retirar versiones de un mapa
  JSON) en una sola lectura+reescritura atómica (temporal 600 fijado,
  `O_NOFOLLOW`+`fstat` contra el pin, `fsync`, revalidación, `rename`
  atómico, `fsync` de directorio, relectura completa). La generación de
  una versión ya presente en un mapa (`json-map-generate`) es SIEMPRE un
  no-op — nunca regenera un valor ya usado para recifrar filas reales de
  Postgres. Sustituye los `python3 - <<PYEOF ... os.O_TRUNC ...` que
  `gate_s7()` y `02-generate-secret.sh` usaban antes.
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
- `lib/dbRootRecovery.sh` — subpuerta S3A: recuperación del acceso ROOT
  de MariaDB por el mecanismo OFICIAL (`--skip-grant-tables
  --skip-networking`) contra un contenedor DESECHABLE separado, cuando
  NINGUNA credencial conocida autentica. Ver la sección "S3A" arriba
  para el detalle completo (causa raíz real, pasos, hallazgos empíricos).
- `lib/espoConfigReconcile.sh` — subpuerta S3B: reconciliación de
  `data/config-internal.php` cuando MariaDB y el almacén externo YA
  coinciden pero ese fichero se quedó con un valor distinto. Nunca rota
  credenciales; todas las operaciones de fichero pasan por un contenedor
  desechable que monta `espocrm-data` directamente (nunca `docker compose
  exec` contra el `espocrm` real, que puede estar en bucle de reinicio).
  Ver la sección "S3B" arriba para el detalle completo.
- `probes/dbConfigLayerProbe.sh` / `probes/dbConfigLayerProbe.php` — sonda
  de solo lectura, cerrada y no sensible (9 líneas `key=value` exactas,
  nunca un valor/DSN/excepción cruda) que determina qué capa de
  configuración de EspoCRM (de las 6 fuentes reales de
  `Espo\Core\Utils\Config`, en su orden real de fusión) alimenta la
  credencial de base de datos que usa la app, y si esa credencial
  autentica. Bootstrapea el `Espo\Core\Utils\Config` REAL vía el
  `vendor/autoload.php` de la propia app cuando está disponible — nunca
  una reimplementación, salvo como fallback si el autoloader no está.
  Nunca toca los contenedores reales: monta el volumen real `:ro` dentro
  de un contenedor desechable de la misma imagen.
  Fichero compartido, única fuente de verdad, entre `gate_s3a` (en
  `rotate-all-interactive.sh`) y `tests/s3a_root_recovery_rehearsal.sh`.
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
  `s3a_root_recovery_rehearsal.sh` (ensayo desechable y reproducible de la
  subpuerta S3A — MariaDB 11.4 real y desechable, drift real
  volumen≠almacén reproducido, recuperación oficial, interrupción,
  backup inválido, reejecución/idempotencia — ver "S3A" arriba),
  `s1_s9_full_rehearsal.py` (ensayo integral S1→S9 completo, camino
  feliz, contra infraestructura real desechable — ver "Bloque 6 — cierre
  integral" arriba), `s9_env_example_failure_rehearsal.py` (mismo
  arnés que el anterior, pero con `.env.example` corrupto — Bloque 6,
  corrección de colisiones, ver más arriba), `s7_atomic_rotation_rehearsal.py`
  (validación DEDICADA de `gate_s7()` real contra Postgres/Redis/MariaDB/
  EspoCRM desechables reales — filas de booking sintéticas con funciones
  de producción, corte real en cada frontera de escritura/gate, retiro
  bloqueado y resuelto — ver "Bloque 10" arriba). Ver "Ejecutar las
  pruebas" abajo.
- `probes/s7TestFixtureSeed.mts` / `s7TestFixtureVerify.mts` /
  `s7TestFixtureCounts.mts` / `s7TestFixtureResolve.mts` /
  `s7TestFixtureReset.mts` — herramientas de fixtures del Bloque 10,
  usadas ÚNICAMENTE por `tests/s7_atomic_rotation_rehearsal.py`: siembran/
  verifican/cuentan/resuelven/vacían filas de booking sintéticas con las
  mismas funciones de cifrado/HMAC de producción. Todas exigen
  `GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL` (patrón cerrado de proyecto
  desechable) y abortan si falta — ver "Bloque 10" arriba.

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

### Bloque 8 — esquema TRANSICIONAL antes de S7

Un intento real de S6 contra un almacén externo todavía en formato
anterior al rediseño versionado de S7 (`BOOKING_EMAIL_LOOKUP_HMAC_SECRET`/
`BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET` singulares, sin versión —
"legacy-pre-s7", ver `lib/backupSchema.mjs`) reprodujo el defecto que
motiva este bloque: `lib/loadSecretsEnv.mjs::SECRETS_FILE_KEY_INVENTORY`
es (y sigue siendo) estrictamente "active" — cualquier clave legacy en
`$SECRETS_FILE` hacía que `buildChildEnv`/`parseSecretsFile` la
rechazaran, y `run-tsx.mjs` no capturaba esa excepción: Node terminaba
con una traza de pila sin sanear, sin imprimir ningún JSON, y el
`validateProbeJson.mjs` de aguas abajo (conectado por una tubería) se
quedaba leyendo un stdin vacío. Resultado observado: S6 se detenía de
forma segura **antes** de `enter_gate` (la primera llamada de la puerta,
`s6ArtifactMaintenance.mts inspect`, vive deliberadamente antes de esa
frontera) — ningún backup, ningún cambio de estado, ningún secreto
generado — pero con un mensaje de error que citaba una traza de Node en
vez de un motivo claro.

**Por qué el fallo era esperable, no un accidente**: `.env.example` (y por
tanto todo `$SECRETS_FILE` que S1 crea copiándolo) nace ya en forma
"active" desde el primer commit de este repo — así que el recorrido
S1→S9 normal nunca ejercita el caso legacy. Este solo aparece cuando el
almacén externo procede de una instalación anterior al rediseño
versionado, y en ese caso concreto S6 (que corre siempre ANTES que S7)
no puede exigir un esquema que todavía no existe.

**Diseño del esquema transicional** (`lib/loadSecretsEnv.mjs` —
`allowLegacyPreS7`, `LEGACY_PRE_S7_KEY_INVENTORY`,
`detectSchemaVersionFromKeys`): `SECRETS_FILE_KEY_INVENTORY` NO se amplía
— sigue siendo el inventario "active" puro, y todo llamador que no pase
el flag (incluida `start-apps-web.mjs`, S9) conserva EXACTAMENTE el
comportamiento de siempre: rechaza cualquier clave legacy, sin
excepción. Un segundo inventario cerrado (`LEGACY_PRE_S7_KEY_INVENTORY`
— el activo menos las 4 claves plurales/versionadas de booking-email/
access-token, más las 2 legacy singulares) se activa solo con
`{ allowLegacyPreS7: true }`, y solo tras detectar — por el CONTENIDO
real del archivo, nunca por confianza ciega — que el archivo es
"legacy-pre-s7" y no una mezcla ambigua de ambas formas.

Dos proyecciones MÍNIMAS nuevas, exclusivas de las cuatro sondas de S6
(nunca usadas por S7/S9):

- `buildS6ArtifactProbeEnv` — `s6ArtifactMaintenance.mts`
  (`inspect`/`remove`): esta sonda solo importa su módulo hermano
  `secureArtifact.mts`, nunca `server/env.ts` — no necesita NINGÚN
  secreto. Valida el archivo completo contra el inventario cerrado que
  corresponda, pero no exige ni propaga nada de su contenido. Deliberado:
  exigir aquí las mismas claves "reales" que sí necesitan las sondas
  criptográficas bloquearía la propia inspección del artefacto — que se
  ejecuta ANTES de `enter_gate` precisamente para poder fallar sin tocar
  nada — ante cualquier archivo incompleto, no solo uno legacy (bug real
  encontrado por `tests/run_scenarios.py::scenario_s6_artifact_reexecution_policy`
  durante el desarrollo de este bloque: el fixture de esa prueba nunca
  incluyó `REDIS_KEY_PREFIX`, y una primera versión de este cambio exigía
  esa clave incluso para `inspect`).
- `buildS6CryptoProbeEnv` — `s6PreRotationProbe.mts`/
  `s6PostRotationVerification.mts`: estas sí importan `serverEnv`
  transitivamente (`otpService.ts`/`redis.ts`/`payload.env.ts`), así que
  necesitan que TODO el esquema Zod de `server/env.ts` valide, incluidos
  7 campos de booking (9 variables) que ninguna de las dos sondas lee
  jamás. Reciben los 8 valores REALES que sí usan
  (`PAYLOAD_SECRET`/`OTP_HMAC_SECRET`/`AUTH_RATE_LIMIT_HMAC_SECRET` +
  DSN/Redis) y placeholders opacos generados por CSPRNG en memoria (nunca
  derivados de ningún valor real, legacy o activo) para el resto — el
  valor legacy real de booking-email/access-token, si está presente en el
  archivo, se VALIDA pero JAMÁS llega a ninguna de las cuatro sondas de
  S6.

`run-tsx.mjs` selecciona la proyección vía la variable de entorno del
propio lanzador `GAPSSA_ROTATION_ENV_PROJECTION` (`s6-artifact` /
`s6-crypto` / ausente = `buildChildEnv` de siempre) — nunca reenviada al
proceso hijo. `gate_s6()` (rotate-all-interactive.sh) fija esa variable en
sus 4 llamadas a `run-tsx.mjs`; S7/S9 no la fijan nunca. Construir el
`env` puede lanzar (`SecretsFileParseError`) — se captura explícitamente
en `run-tsx.mjs` para imprimir un único mensaje saneado (nunca una traza
de Node, nunca un valor) y salir con el código 1 de siempre.

**`run_probe_and_validate()`** (nueva función compartida en
`rotate-all-interactive.sh`, sustituye las 6 tuberías
`run-tsx.mjs | validateProbeJson.mjs` que gate_s6/gate_s7 ya tenían):
captura la salida de `run-tsx.mjs` y comprueba su código de salida en un
paso separado — si `run-tsx.mjs` falla, `validateProbeJson.mjs` NUNCA se
invoca (antes sí, sobre un stdin vacío, produciendo el mensaje confuso
"la salida no contiene ningún documento JSON" encima del error real).

**Quién convierte cada clave legacy — precondición explícita S6→S7→S9**:
ninguna puerta migraba el NOMBRE de las claves legacy en el archivo hasta
este bloque (`s7MigrateAndAudit.mts`, la sonda de migración de S7, solo
migra FILAS de la base de datos — asume que el archivo YA tiene forma de
mapa versionado, porque transitivamente importa `serverEnv` igual que las
sondas de S6). Nuevo módulo `lib/migrateLegacySecretsFileToActive.mjs`
— el ÚNICO punto del sistema autorizado a leer las 2 claves legacy, y
solo para migrarlas: `gate_s7()` lo invoca, ANTES de generar/activar
ninguna versión nueva, si (y solo si) `current_secrets_schema_version()`
todavía es "legacy-pre-s7". Preserva el valor legacy EXACTO bajo la
versión `"v1"` del mapa correspondiente (nunca genera un valor nuevo aquí
— cualquier HMAC/ciphertext ya calculado con ese valor sigue siendo
verificable bajo esa misma versión, cero pérdida de verificabilidad
histórica) y reescribe `$SECRETS_FILE` en el sitio, preservando verbatim
cualquier otra línea (orden, comentarios, blancos). Idempotente: sobre un
archivo ya "active" es un no-op que no escribe nada. Tras esto,
`current_secrets_schema_version()` vuelve a ser "active" — S8/S9 nunca ven
una clave legacy: `start-apps-web.mjs` (S9) sigue llamando a
`buildChildEnv`/`parseSecretsFile` SIN `allowLegacyPreS7`, así que un
archivo que todavía tuviera una clave legacy simplemente no arrancaría
`apps/web` real, exactamente como antes de este bloque.

**Pruebas nuevas** (ficheros SINTÉTICOS únicamente — ningún test de este
bloque toca `.env`/`~/.gapssa-secrets` reales ni ejecuta S6/S7 real contra
infraestructura): `lib/loadSecretsEnv.test.mjs` (34 aserciones —
consistencia entre las dos copias independientes de
`LEGACY_PRE_S7_KEY_INVENTORY`/versión de esquema, `detectSchemaVersionFromKeys`
pura, `parseSecretsFile` con/sin `allowLegacyPreS7` incluida la mezcla
plural+singular y la clave desconocida, `buildS6ArtifactProbeEnv` sin
exigir ninguna clave real, `buildS6CryptoProbeEnv` con placeholders que
nunca son el valor real y nunca fijos entre invocaciones);
`lib/migrateLegacySecretsFileToActive.test.mjs` (23 aserciones — función
pura y CLI completo: migración exitosa con preservación exacta del valor
bajo v1, no-op sobre esquema ya activo con el archivo BYTE A BYTE
intacto, legacy incompleta/vacía/mezclada rechazadas sin escribir nada,
stderr saneado sin traza de Node). Nuevo escenario PTY/subproceso REAL
`tests/run_scenarios.py::scenario_s6_s7_s9_transitional_rehearsal` (10
aserciones) — encadena, contra tsx REAL (sin Docker/Postgres/Redis, la
propia sonda de S6 no los necesita) y el CLI real de migración: sonda de
S6 real sobre el archivo TODAVÍA legacy (status=absent, sin fuga del
valor real) → la MISMA sonda sin la proyección de S6 sigue rechazando el
archivo (confirma que la tolerancia es exclusiva de S6) → migración real
con preservación bajo v1 → el archivo migrado satisface la precondición
ESTRICTA de S9 sin ningún flag → repetir la migración es no-op.

**Regresión real encontrada y corregida durante este bloque** (antes de
llegar a verde): una primera versión de `buildS6CryptoProbeEnv` se usó,
por error, para las CUATRO sondas de S6 (incluidas `inspect`/`remove`,
que no necesitan ningún secreto) — `tests/run_scenarios.py::scenario_s6_artifact_reexecution_policy`
(9 de sus aserciones) lo detectó: su fixture nunca incluyó
`REDIS_KEY_PREFIX` (una clave sin relación alguna con legacy/active), y
exigirla incondicionalmente rompía la propia inspección del artefacto —
justo la operación que debe poder fallar SIN tocar nada. Corregido
separando `buildS6ArtifactProbeEnv` (sin exigencias) de
`buildS6CryptoProbeEnv` (exige solo lo que las sondas criptográficas
usan de verdad).

Última ejecución de este bloque: `run-node-tests.sh` 21/21 ficheros
(incluidos los 2 nuevos), `lib.test.sh` 128/128 (sin cambios — este
bloque no toca `lib.sh`), `tests/static_bash32_compat_guard.sh` 24/24,
`tests/run_scenarios.py` 129/129 relevantes al cambio (4 fallos
preexistentes de escenarios MariaDB/S3 reales, reproducidos idénticos
contra el código sin este bloque — no relacionados, fuera del alcance de
este bloque).

**Procedimiento para reintentar ÚNICAMENTE S6** tras este bloque: `bash
rotate-all-interactive.sh --only S6` — la inspección del artefacto (ahora
tolerante a legacy-pre-s7) corre primero; si no hay artefacto pendiente,
`enter_gate "S6"` toma backup (etiquetado con la versión de esquema REAL
del archivo, activa o legacy-pre-s7) y las 3 sondas siguientes generan/
verifican con la proyección mínima. Si el almacén sigue en legacy-pre-s7,
S6 completa igual (nunca exige que S7 ya haya corrido); la migración de
las 2 claves legacy ocurre la primera vez que se lanza `--only S7` (o el
recorrido continuo sin `--only`), antes de generar/activar ninguna
versión nueva.

### Bloque 9 — S7 atómico y reanudable (auditoría y endurecimiento previos a ejecutar S7)

**Hallazgo bloqueante que motivó este bloque**: `gate_s7()`
(`rotate-all-interactive.sh`) contenía SEIS reescrituras `python3 -
<<PYEOF ... os.O_TRUNC ...` independientes del almacén externo (activar
v3 en los 4 mapas; retirar v1/v2 de cada uno de los 4 mapas por
separado), más CINCO llamadas a `02-generate-secret.sh` cuya propia
implementación interna usaba el mismo patrón `os.O_TRUNC` inseguro
(generar v3 para los 4 mapas + rotar `BOOKING_INTERNAL_API_SECRET`), y
`lib/migrateLegacySecretsFileToActive.mjs::writeInPlace` usaba
`openSync(path, 'w')` (equivalente a `O_TRUNC`). Ninguna de estas
escrituras usaba el patrón atómico (temporal 600 fijado, `O_NOFOLLOW`,
`fsync`, `rename`, `fsync` de directorio) que el resto de este
directorio ya exige — hasta 10 puntos de interrupción sin protección
en una sola ejecución de S7. Peor que la falta de atomicidad frente a un
crash: **relanzar `02-generate-secret.sh --set-json-map v3` tras
CUALQUIER interrupción sustituía en silencio el valor v3 por uno
CSPRNG nuevo**, aunque filas reales de Postgres ya se hubieran recifrado
con el v3 anterior — huérfanas para siempre, sin ningún error visible.

**Corrección — una única herramienta atómica y validada**
(`lib/atomicSecretsFileMutate.mjs`, generaliza el patrón ya aceptado de
`updateSecretsFileField.mjs`): aplica VARIAS mutaciones de campo
(`set-line`, `set-line-generate`, `json-map-generate`,
`json-map-retain`) a `$SECRETS_FILE` en una sola lectura+reescritura —
temporal FIJADO por el llamador en bash (`gapssa_secrets_mktemp_secure_same_dir`,
mismo patrón que S5/redis), abierto con `O_NOFOLLOW`, identidad
verificada por `fstat` contra el pin, documento completo validado contra
el inventario/obligatorias de la versión de esquema activa, escritura +
`fsync`, revalidación por `lstat` justo antes del `rename`, `rename`
atómico, verificación del destino, `fsync` del directorio contenedor, y
**relectura completa del documento final** para confirmar que lo escrito
en disco coincide exactamente con lo reconstruido. Propietario/modo
600 se conservan en todo momento (el temporal nace 600, el `rename`
nunca cambia inodo del destino salvo el esperado).

**Idempotencia crítica** (`json-map-generate`): si la versión pedida
(p. ej. `v3`) YA está presente en el mapa, la mutación es un NO-OP —
NUNCA regenera un valor ya usado para recifrar filas reales. Probado
explícitamente en `lib/atomicSecretsFileMutate.test.mjs` ("idempotencia
crítica vía CLI"): generar v3, simular una interrupción y relanzar con un
temporal DISTINTO (como haría bash de verdad) produce exit 20 (no-op) y
el valor v3 es BYTE A BYTE idéntico al de la primera ejecución.

**`gate_s7()` reescrita** para usar exclusivamente esta herramienta, en
el orden exigido (backup → generar+añadir v3 a los 4 mapas EN UNA sola
escritura → verificar convivencia dual real por `grep` antes de seguir →
activar v3 EN UNA sola escritura, SIEMPRE separada de generar/retirar →
migrar/reindexar Postgres + auditar allowlist + recontar EN FRESCO (sin
cambios — ya transaccional por fila y reanudable, ver auditoría abajo) →
verificar descifrado con el mapa final (`aesDecryptOk`, ya existente) →
retirar cada uno de los 4 mapas EN SU PROPIA escritura, solo si su
recuento fresco es 0 → rotar `BOOKING_INTERNAL_API_SECRET` (vía
`02-generate-secret.sh`, ahora también atómico) → verificar
`isValidInternalApiSecret` con el valor nuevo aceptado/anterior
rechazado/ausente rechazado). Nunca se retira una versión vieja en la
misma operación que activa v3 — son escrituras atómicas separadas,
en ese orden.

**Recuperación hacia delante, nunca hacia atrás, para S7**
(`confirm_gate()`): a diferencia de S2–S5 (un solo secreto, sin
dependencia en Postgres), S7 puede haber migrado/reindexado filas REALES
a v3 antes de interrumpirse — restaurar un backup anterior dejaría esas
filas cifradas/firmadas con una versión que el archivo restaurado ya no
contendría. `confirm_gate()` ahora NUNCA ofrece restaurar backup para S7
tras `rollback_required`: informa y devuelve el estado a `applying`,
porque cada paso de escritura es individualmente idempotente y la
migración/reindexado de Postgres ya era transaccional/reanudable —
relanzar `--only S7` siempre es seguro y completo.

**Auditoría de las cinco familias de secretos** (confirmado, sin
cambios necesarios más allá de lo de arriba):
- `BOOKING_FIELD_ENCRYPTION_KEYS` / `BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS`
  / `BOOKING_EMAIL_LOOKUP_HMAC_SECRETS` / `BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRETS`
  (+ sus 4 `*_ACTIVE_KEY_VERSION`): mapas versionados, migración/reindexado
  y recuento en `apps/web/src/server/booking/fieldEncryptionRotation.ts`
  y `emailLookupHmacRotation.ts` — **transaccionales por FILA**
  (`db.transaction(...)` con `SELECT ... FOR UPDATE` que re-lee la fila
  DENTRO de la transacción antes de escribir) e **idempotentes**
  (re-comprueban `keyVersion === fromVersion` desde la fila recién leída
  en la transacción, nunca desde el listado exterior — una fila ya
  migrada se salta en silencio en una reejecución). Los recuentos de
  `rotationSafetyChecks.ts` distinguen correctamente filas vivas
  (`status != 'resolved'`) de históricas/resueltas.
- `BOOKING_INTERNAL_API_SECRET`: consumidores identificados —
  `apps/web/src/server/booking/internalAuth.ts` (`isValidInternalApiSecret`,
  comparación de tiempo constante contra la cabecera
  `x-internal-api-secret`) protege las 6 rutas internas de booking
  (`/api/booking/v1/internal/decisions`, `/reviews`, `/reviews/[id]`,
  `/reviews/[id]/resolve`, `/reviews/[id]/reject`, `/sweep`) — ninguna
  otra ruta ni `integrations/n8n/` lo consume. Rotación coordinada:
  sustitución directa (sin filas dependientes por diseño — es una
  credencial de servicio, no versionada) + verificación real de
  `isValidInternalApiSecret` (nuevo aceptado, anterior rechazado, ausente
  rechazado) vía `probes/s7InternalApiAuthCheck.mts`, con el valor
  ANTERIOR solo en memoria de este proceso (temporal `600` triturado tras
  usarse). Nunca en argv/env/logs. `apps/web` real nunca arranca en S7
  (solo S9 lo arranca).

**Pruebas nuevas**: `lib/atomicSecretsFileMutate.test.mjs` (46
aserciones — pruebas puras de `applyMutations`/`validateMutationsList` +
camino CLI completo con temporal real: cada tipo de mutación, la
idempotencia crítica descrita arriba, no-op completo con el temporal SIN
consumir, preimagen symlink/modo≠600 rechazadas, identidad de temporal
no coincidente, `O_NOFOLLOW` contra un temporal symlink, mutaciones JSON
malformadas/vacías, cero valores en stdout/stderr).
`lib/migrateLegacySecretsFileToActive.test.mjs` actualizado al nuevo
contrato CLI (temporal pre-pinneado; no-op ahora exit 20, temporal sin
consumir). `tests/run_scenarios.py::scenario_s6_s7_s9_transitional_rehearsal`
actualizado igual y sigue en verde (10 aserciones, migración real vía
`tsx`).

**Tres pruebas preexistentes, no relacionadas con este bloque, dejaban
de reflejar el comportamiento real de `gate_s3()`** (encontradas al
correr la regresión completa de `tests/run_scenarios.py`, antes en 0
FAIL tras este bloque): `scenario_s1_s3_mariadb` y las dos ramas de
`_run_s3_divergence_case` (`scenario_s3_divergence_root_declined`/
`_provided`) esperaban el prompt manual "Contraseña ROOT actual de
MariaDB:" incondicionalmente, pero `gate_s3()` prueba primero, EN
SILENCIO, la contraseña ROOT ya almacenada (lógica añadida en un bloque
anterior, "add recoverable MariaDB root reconciliation") — como
`seed_docker_state()` siembra esa contraseña idéntica a la que S1 acaba
de copiar al almacén externo, la comprobación silenciosa SIEMPRE tiene
éxito en estos fixtures y el prompt manual nunca aparece. Estos 3 puntos
de prueba (documentados como "4 fallos preexistentes... no relacionados,
fuera del alcance" en el Bloque 8 anterior) quedan corregidos: se retiró
la expectativa del prompt manual donde el camino silencioso siempre
gana. `tests/run_scenarios.py` 142/142 (antes 133 relevantes + varias
aserciones en cascada fallando por los 3 puntos de arriba).

**Regresión completa de este bloque** (última ejecución limpia):
`run-node-tests.sh` 22/22 ficheros (incluido el nuevo
`atomicSecretsFileMutate.test.mjs`), `lib.test.sh` 128/128 (sin cambios),
`tests/static_bash32_compat_guard.sh` 24/24, `tests/run_scenarios.py`
142/142 (0 fallos, incluidas las 3 correcciones de arriba),
`tests/s1_s9_full_rehearsal.py` — ensayo integral REAL S1→S9 completo
contra Postgres 18 + MariaDB 11.4 + Redis 8 + EspoCRM 10.0.3
DESECHABLES (nunca infraestructura GAPSSA real): las 9 puertas terminan
`done`, los 4 `*_ACTIVE_KEY_VERSION` de booking quedan en `v3`, ACL real
verificada, informe saneado sin secretos, teardown limpio (cero
contenedores/networks/volumes residuales) — `fail_count=0`.

**Límite reconocido de este bloque**: el ensayo integral de arriba
demuestra el camino feliz completo (sin filas de `booking_request`/
`pending_guest_identities` vivas en el fixture, así que las 4 familias
retiran v1/v2 en la misma pasada). Queda como trabajo de seguimiento
recomendado, NO bloqueante para este commit, un ensayo desechable
DEDICADO que siembre filas reales v1/v2 (incluida al menos una fila
"corrupta"/no descifrable y al menos una solicitud viva que mantenga un
recuento distinto de cero) y fuerce una interrupción real (`SIGINT`) en
cada frontera de `gate_s7()` para demostrar en vivo, contra Postgres
desechable real: convivencia dual tras interrupción, reanudación sin
regenerar v3, bloqueo parcial (`blocked`) con recuento distinto de cero
en una familia mientras las demás retiran con normalidad, y recuperación
hacia delante nunca hacia atrás. La atomicidad/idempotencia de cada
escritura individual (la causa raíz del hallazgo bloqueante) SÍ queda
demostrada de forma directa y determinista por
`lib/atomicSecretsFileMutate.test.mjs`, sin depender de Docker.

**Procedimiento para reintentar ÚNICAMENTE S7**: `bash
rotate-all-interactive.sh --only S7`. Precondiciones operativas (no
todas verificadas automáticamente por la propia puerta — S9, no S7, es
la puerta que exige S1-S8 `done`; ver "Quién convierte cada clave
legacy" arriba sobre por qué S7 no duplica esa comprobación): S1-S5
`done` y S6 en `prepared` o `done`, `apps/web` (puerto 3000) DETENIDO
(S7 solo ejecuta sondas `tsx` de un solo uso, nunca el servidor Next.js —
pero una instancia externa ya escuchando podría escribir a la misma BD
concurrentemente), Redis y Postgres reales sanos, y
`current_secrets_schema_version()` en `"active"` o `"legacy-pre-s7"`
(nunca una mezcla — `gate_s7()` migra automáticamente si hace falta,
antes de generar/activar nada). Si una ejecución anterior quedó
`blocked` (alguna familia con dependientes vivos) o se interrumpió
(`rollback_required`, ahora recuperado siempre hacia delante), relanzar
la misma puerta es seguro: cada paso reanuda exactamente donde quedó,
sin regenerar ninguna versión ya activa ni retirar nada fuera de la
comprobación de recuento fresco.

### Bloque 10 — validación dedicada de S7 contra Postgres/Redis desechables reales

El Bloque 9 dejó un hueco reconocido explícitamente: la atomicidad de
cada escritura individual quedaba probada de forma directa
(`lib/atomicSecretsFileMutate.test.mjs`), y el camino feliz completo de
`gate_s7()` quedaba probado end-to-end (`s1_s9_full_rehearsal.py`), pero
ningún ensayo ejercitaba `gate_s7()` REAL contra filas de booking VIVAS
con dependencias reales, ni interrumpía el proceso completo (nunca solo
la escritura) en cada frontera. Este bloque cierra ese hueco con
`tests/s7_atomic_rotation_rehearsal.py` — un ensayo dedicado, desechable
y reproducible, DISTINTO de `s1_s9_full_rehearsal.py` (nunca lo
modifica; reutiliza sus funciones de infraestructura como librería) que
conduce `gate_s7()` REAL, siempre por PTY (`--only S7` contra
`rotate-all-interactive.sh` real — nunca invoca sus helpers bash por
separado), contra Postgres 18 + Redis 8 + MariaDB 11.4 + EspoCRM 10.0.3
DESECHABLES reales.

**Fixtures — datos sintéticos con funciones de producción reales**
(`probes/s7TestFixtureSeed.mts`): siembra filas directamente vía Drizzle
(`bookingDb`) usando el cifrado AES-256-GCM real
(`server/crypto/fieldCrypto.ts::encryptFieldWithVersion`), la huella de
identidad HMAC real (`server/booking/identityFingerprint.ts::computeIdentityFingerprint`,
ambos dominios — invitado y autenticado), la firma de token de acceso
real (`server/booking/accessToken.ts::signBookingRequestAccessTokenWithVersion`)
y el HMAC de email-lookup real (`hmacSubjectId`, `@gapssa/contracts`) —
nunca una reimplementación paralela ni un valor con "forma parecida" a
un `EncryptedField`. Nunca pasa por `createGuestBooking`/
`createAuthenticatedBooking` (exigirían Redis/EspoCRM/OTP reales,
irrelevantes para probar rotación de secretos — la rotación tampoco pasa
por esas rutas). Datos de negocio completamente ficticios (nombres/
teléfonos/correos de prueba), nunca copiados de GAPSSA real. Cubre las
5 familias exigidas: identidades cifradas AES v1 y v2, email-lookup HMAC
v1, fingerprints v1 y v2, `booking_request_records` de invitado
(`accessTokenKeyVersion=v1`) y autenticado (`accessTokenKeyVersion=NULL`,
el valor correcto por diseño para ese flujo — nunca una anomalía), y una
fila deliberadamente corrupta (ciphertext tamperado tras cifrarlo de
verdad, tag de autenticación GCM roto a propósito). Un mapa v1+v2 ya
convivendo se prepara ANTES de cada escenario con
`lib/atomicSecretsFileMutate.mjs` directamente (la misma herramienta de
producción, nunca escrito a mano) — simula un almacén que ya pasó por
una rotación anterior incompleta. `probes/s7TestFixtureVerify.mts`
demuestra equivalencia lógica (mismo plaintext, nunca mismo ciphertext)
y descifrado usando EXCLUSIVAMENTE el mapa que haya en `$SECRETS_FILE`
en cada instante — nunca un mapa "final" simulado aparte.
`probes/s7TestFixtureCounts.mts` exhibe los mismos conteos EN FRESCO que
`gate_s7()` usa internamente, de solo lectura, para poder inspeccionar
el estado real entre pasos sin mutar nada. `probes/s7TestFixtureResolve.mts`
resuelve una solicitud (simula que el negocio ya la completó/expiró).
`probes/s7TestFixtureReset.mts` vacía las 3 tablas de fixtures vía el
MISMO cliente Drizzle (nunca `docker run psql` con el resultado
descartado sin comprobar — ver "bug real" más abajo) y verifica recuento
cero antes de devolver éxito. Las 5 sondas comparten la MISMA guarda
cerrada: exigen `GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL` con el patrón de
un proyecto desechable (`gapssa-*-(rehearsal|tests)-<hex>`) y abortan
(nunca "no aplica, sigo normalmente") si falta o no casa.

**Failpoints de escritura reales** (`GAPSSA_ROTATION_TEST_FAILPOINT`,
`lib/atomicSecretsFileMutate.mjs`): SIGKILL real de ese mismo proceso —
nunca una salida ordenada, que no demostraría nada sobre qué sobrevive a
un corte de corriente real — en 3 puntos EXACTOS de la secuencia de
escritura: `before-fsync`, `after-fsync-before-rename`, `after-rename`.
Deshabilitados por defecto (variable ausente, cero efecto en cualquier
ejecución real). Exigen SIEMPRE `GAPSSA_ROTATION_TEST_DISPOSABLE_LABEL`
(mismo patrón cerrado) Y que `<secretsFilePath>` no resuelva al almacén
externo real por defecto (`$HOME/.gapssa-secrets/.env.gapssa` con el
`$HOME` REAL del proceso) — si el failpoint está pedido pero cualquiera
de las dos guardas falla, el script aborta (exit 1) SIN aplicar ninguna
mutación, nunca en silencio. Un valor de failpoint fuera del conjunto
cerrado también aborta. Probado primero de forma aislada y determinista
(`lib/atomicSecretsFileMutate.test.mjs`, 16 aserciones nuevas: cada
punto de corte deja el destino ORIGINAL byte a byte intacto si el rename
no llegó a ejecutarse, o el documento NUEVO completo si sí — nunca
truncado, nunca a medias, modo 600 conservado en ambos casos), y después
DEMOSTRADO en vivo DENTRO de `gate_s7()` real (Escenario E: SIGKILL real
durante el retiro de la familia de fingerprint, en una reanudación donde
generar/activar/migrar ya son no-op; Escenario F: SIGKILL real justo
tras rotar `BOOKING_INTERNAL_API_SECRET`, antes de verificarlo).

**Pausa de migración real** (`GAPSSA_ROTATION_TEST_MIGRATION_PAUSE`,
`probes/s7MigrateAndAudit.mts`): el bucle `for fromVersion of ['v1','v2']`
se desenrolló en dos fases explícitas para poder insertar 3 puntos de
pausa acotada (`after-aes-v1`, `after-aes-v2`, `after-email-lookup`,
`GAPSSA_ROTATION_TEST_MIGRATION_PAUSE_MS` configurable) — el marcador de
progreso y la propia pausa van SIEMPRE a stderr, nunca a stdout (el
contrato de esta sonda exige stdout limpio para `validateProbeJson.mjs`).
Misma guarda cerrada que los failpoints de escritura. `lib/run-tsx.mjs`
reenvía EXPLÍCITAMENTE estas 3 variables (más la etiqueta desechable) a
la sonda hija — `buildChildEnv` nunca reenvía `process.env` sin filtrar
(`BASE_ENV_ALLOWLIST` es una lista cerrada que deliberadamente NO
incluye esto), así que sin este reenvío la sonda nunca las vería.

**Escenarios obligatorios, todos con `gate_s7()` real vía PTY**:

| Escenario | Qué demuestra |
|---|---|
| A — camino feliz | Añadir v3 sin regenerarlo; activar v3; recifrar/reindexar; las 5 familias retiran limpio (requiere solicitudes YA resueltas — fingerprint/access-token nunca retiran con una solicitud viva, por diseño); recuentos frescos en cero; descifrado/equivalencia lógica con el mapa FINAL (solo v3); `isValidInternalApiSecret` verificado; reejecución sobre `S7=done` no regenera v3 en ningún mapa. |
| B — fila corrupta | La migración falla CERRADA (`S7=failed`, nunca `blocked` ni `done`); ninguna clave antigua se retira (mapa dual permanece); la fila VÁLIDA sigue descifrable y lógicamente equivalente; la fila corrupta sigue sin descifrar (nunca se "arregla" ni se pierde en silencio). |
| C — retiro bloqueado | Una solicitud viva mantiene fingerprint (y, en este fixture, también access-token) en v1; `S7` termina `blocked`; mapa dual permanece; AES SÍ retira (independiente del status); tras resolver la solicitud, reejecutar `S7` termina `done` SIN cambiar el v3 ya activo. |
| D — SIGINT real en 4 fronteras | `after-generar-v3`, `after-activar-v3`, `during-migration` (vía la pausa acotada), `after-migrate-before-retire` — en cada una: la interrupción SÍ se dispara sobre el proceso completo (nunca un helper aislado), `S7` queda `rollback_required`, ningún mapa queda vacío/corrupto, todas las filas siguen descifrables, y relanzar sin interrumpir termina `done` con el MISMO v3 (nunca regenerado). |
| E — SIGKILL durante retiro | Failpoint `after-fsync-before-rename` disparado DENTRO de una reanudación real de `gate_s7()` (generar/activar/migrar ya no-op, el único escrito real es el retiro de fingerprint); la puerta termina en fallo limpio, `S7=failed`, archivo externo BYTE A BYTE intacto (rename nunca se ejecutó), mapa dual conservado; reanudar sin el failpoint termina `done`. |
| F — SIGKILL tras rotar el secreto interno | Failpoint `after-rename` justo después de escribir `BOOKING_INTERNAL_API_SECRET`, antes de verificarlo; la puerta termina en fallo limpio (bash nunca puede distinguir "el rename sí ocurrió" de un corte real, así que siempre trata el hijo muerto como fallo); el valor en disco es COMPLETO (nunca parcial); reanudar rota el secreto DE NUEVO (no-idempotente por diseño — nunca reutiliza un valor que quedó sin verificar) y SÍ lo verifica antes de `done`. |

**Alcance documentado explícitamente de `isValidInternalApiSecret`**
(punto 7 de este bloque): la verificación que `gate_s7()` hace de
`BOOKING_INTERNAL_API_SECRET` es SIEMPRE a nivel de función real
(`s7InternalApiAuthCheck.mts` llama a `isValidInternalApiSecret`
directamente — nuevo aceptado, anterior rechazado, ausente rechazado) —
NUNCA una petición HTTP contra un `apps/web` real, que no arranca hasta
S9. Auditado (sin cambios de código necesarios): los 6 consumidores
reales son las rutas internas de booking
(`/api/booking/v1/internal/decisions`, `/reviews`, `/reviews/[id]`,
`/reviews/[id]/resolve`, `/reviews/[id]/reject`, `/sweep`,
`internalAuth.ts`) — hoy S9 no repite esta verificación contra un
servidor vivo, así que la sonda de S7 es la única que existe; el
Escenario F demuestra además que una interrupción entre rotar y
verificar nunca deja ni el almacén ni esos consumidores desincronizados
(el valor en disco es siempre completo, y siempre se reverifica antes de
`done`, nunca se asume).

**Bug real encontrado y corregido por este mismo bloque** (antes de
llegar a verde): `reset_booking_tables()` usaba inicialmente
`docker run psql` (patrón de `s1_s9_full_rehearsal.py`) con el resultado
DESCARTADO sin comprobar el código de salida — un `TRUNCATE` real que
fallara ahí se ignoraba en silencio, dejando filas de un escenario
anterior (p. ej. la fila deliberadamente corrupta del Escenario B)
contaminando el siguiente y produciendo fallos en cascada sin relación
alguna con lo que cada escenario probaba de verdad. Corregido con
`probes/s7TestFixtureReset.mts` (mismo cliente Drizzle real que el resto
de sondas de este bloque, recuento cero verificado explícitamente antes
de devolver éxito).

**Resultado de la última ejecución limpia**: `tests/s7_atomic_rotation_rehearsal.py`
85/85 (0 fallos) contra infraestructura desechable real, teardown limpio
(cero contenedores/redes/volúmenes residuales, inventario Docker real
idéntico antes/después). Regresión completa tras este bloque:
`run-node-tests.sh` 22/22, `lib.test.sh` 128/128,
`tests/static_bash32_compat_guard.sh` 24/24, `tests/run_scenarios.py`
142/142, `tests/s1_s9_full_rehearsal.py` — ensayo integral REAL S1→S9
completo repetido tras este bloque, sin regresión.

**Procedimiento para ejecutar SOLO esta validación dedicada**: `python3
scripts/secrets-rotation/tests/s7_atomic_rotation_rehearsal.py` — trae su
propia infraestructura desechable (proyecto `gapssa-s1s9-rehearsal-<hex>`,
mismo patrón de aislamiento que `s1_s9_full_rehearsal.py`), nunca toca
`gapssa-espocrm-1`/`gapssa-apps-db-1`/ningún recurso GAPSSA real, y hace
teardown completo pase lo que pase (incluso si el propio ensayo falla a
mitad, verificado por el `finally` que cubre a todos los escenarios).

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
