# Runbook — rotación de secretos GAPSSA fuera del harness (ejecución manual)

**Léelo entero antes de empezar. Ninguno de estos pasos se ejecuta desde
Claude Code.** El incidente que motiva este runbook
(`docs/incidente-exposicion-env-completo-2026-08-13.md`) demostró que
cualquier edición de `.env` hecha desde una sesión de agente puede acabar
publicando el archivo completo en la conversación — la única mitigación
fiable es que ningún agente vuelva a tocar el archivo de secretos real.

**Alternativa recomendada para quien no quiera ejecutar cada comando de
este runbook a mano**: `scripts/secrets-rotation/rotate-all-interactive.sh`
encadena las mismas puertas S1–S9 en un único asistente interactivo, sin
que tengas que abrir un editor de texto ni copiar/pegar ningún valor. Su
primera versión fue revisada y **rechazada antes de ejecutarse** por
bloqueos de seguridad reales (secretos visibles en argumentos de proceso,
guardia de harness insuficiente, S9 permitía continuar con puertas
pendientes, entre otros); la versión corregida y el porqué de cada
corrección están documentados en `scripts/secrets-rotation/README.md`
§"Historial de revisión". Este runbook sigue siendo válido como
referencia paso a paso — el script automatiza exactamente estos mismos
pasos, nunca algo distinto.

## Estado tras el cierre del Bloque 6 (léelo antes de ejecutar nada real)

- **Los Bloques 1–6 están completos ÚNICAMENTE contra infraestructura
  Docker desechable** (proyectos `gapssa-*-tests-<rand>`/
  `gapssa-acl-rehearsal-*`/`gapssa-rotation-v3-tests-*`, nunca
  `gapssa-espocrm-1` ni ningún otro recurso GAPSSA real). **La rotación
  real de los secretos de este repositorio (`.env` raíz) todavía NO se ha
  ejecutado.** Este runbook sigue siendo un procedimiento a ejecutar, no
  un registro de algo ya hecho.
- **La Puerta 5B-2B (primera reserva real contra `gapssa-espocrm-1`,
  ver `docs/fase4b-puerta5b-primera-reserva.md`) sigue SIN AUTORIZAR y es
  un trabajo completamente distinto de esta rotación.** Cerrar el Bloque 6
  de este runbook no autoriza, no adelanta ni depende de 5B-2B — son dos
  puertas independientes.
- **Ejecuta siempre primero con `--dry-run`** (`rotate-all-interactive.sh
  --dry-run`, o cada script suelto con `--dry-run`) para ver exactamente
  qué puerta tocaría qué, sin escribir nada en el almacén externo ni en
  ningún servicio — solo después, si el `--dry-run` se ve correcto, repite
  el mismo comando sin el flag.
- **Significado de cada estado** (máquina de estados por puerta, guardada
  en el propio almacén externo, nunca en este repositorio):
  - `pending` — la puerta todavía no ha empezado.
  - `prepared` — precondiciones verificadas, nada aplicado todavía.
  - `applying` — escribiendo el secreto nuevo / aplicándolo al servicio.
  - `verifying` — comprobando que el valor nuevo funciona y el anterior ya
    no.
  - `done` — puerta completa y verificada; nunca se marca por "el comando
    no devolvió error", solo por una verificación automática real.
  - `blocked` — no puede completarse de forma segura ahora mismo (p. ej.
    S7/S8 con una dependencia todavía viva); nunca cuenta como rotación
    hecha.
  - `recovery_required` — se restauró la credencial ANTERIOR al servidor
    para recuperar disponibilidad tras un fallo a mitad; **no es una
    rotación completa** — hay que volver a ejecutar la puerta.
  - `forward_recovery_required` — igual que `recovery_required`, pero para
    secretos irreversibles (p. ej. la API Key de EspoCRM): la única
    recuperación posible es generar un valor NUEVO hacia delante, nunca
    reaplicar el anterior.
  - `server_coordination_required` — el servidor y los clientes quedaron
    con credenciales distintas y necesitan una acción de coordinación
    manual antes de continuar.
  - `rollback_required` — una interrupción (p. ej. `Ctrl-C`) dejó la
    puerta a mitad; nunca se interpreta como `done`, hay que resolverlo
    (relanzar el script) antes de avanzar.
  - `failed` — la puerta falló y no quedó en ningún estado recuperable
    automáticamente; requiere revisión manual antes de reintentar.
  - S9 rechaza arrancar si cualquier puerta anterior no está en `done` —
    sin excepción, sin "continuar de todas formas".
- **Bloqueo de concurrencia**: el script toma un lock exclusivo sobre el
  almacén externo (`$SECRETS_DIR/.rotation.lock`) al arrancar. Si abres
  una segunda terminal e intentas lanzar otra sesión sobre el mismo
  almacén, la segunda sesión se rechaza mientras la primera esté viva. Si
  una sesión murió sin liberar el lock, se recupera automáticamente como
  huérfano solo si tiene más de 2 segundos de antigüedad — no necesitas
  borrarlo tú mismo a mano.
- **Reanudación tras interrupción**: si cierras la terminal, pierdes la
  conexión o pulsas `Ctrl-C` a mitad de una puerta, simplemente vuelve a
  ejecutar el mismo comando (`rotate-all-interactive.sh`) — retoma
  exactamente donde quedó, sin repetir puertas ya `done`, nunca pide que
  reconstruyas el estado a mano.
- **Timeouts**: cada espera de salud de un servicio (`_gapssa_wait_healthy`)
  tiene un límite de 90 segundos por defecto — si un contenedor no
  responde a tiempo, la puerta falla cerrado (nunca se queda esperando
  indefinidamente) en vez de asumir éxito. El lock de concurrencia usa un
  margen de gracia de 2 segundos para distinguir un lock huérfano real de
  uno en plena creación.
- **Puerto de S9**: por defecto S9 arranca `apps/web` en el puerto real
  `3000`. La variable `GAPSSA_APPS_WEB_PORT` (no secreta) permite forzar
  otro puerto si `3000` ya está ocupado por el proceso preexistente que se
  conserva deliberadamente en esta máquina — ausente, el comportamiento es
  exactamente el de siempre (puerto 3000); presente, debe ser un entero
  1–65535 válido o el arranque aborta antes de tocar nada.
- **Informe saneado único, con identidad de sesión**: cada ejecución
  genera un `run_id` CSPRNG una única vez y produce un único informe
  final nombrado `rotation-report-<timestamp>-<run_id>.txt` (reserva
  atómica, nunca sobrescribe uno existente), con nombres de puerta/
  estado, booleanos y conteos — nunca un valor, DSN, fragmento o hash de
  secreto. S9 verifica al final que existe exactamente un informe para
  su propio `run_id`; si no, falla cerrada. Ver §7 más abajo.
- **Clasificación cerrada de claves**: las 80 claves de
  `SECRETS_FILE_KEY_INVENTORY` están clasificadas explícitamente como
  `secret` / `sensitive-connection-string` / `non-secret-configuration`
  (`lib/loadSecretsEnv.mjs::SECRET_KEY_CLASSIFICATION`, cobertura exacta
  80/80 verificada por `lib/secretClassification.test.mjs`) — el escaneo
  de fugas de S9 solo compara contra las clasificadas como secreto o
  cadena de conexión sensible, nunca contra parámetros operativos no
  sensibles.
- **Condiciones de parada** — detén la ejecución (no continúes, no fuerces
  nada) si ocurre cualquiera de estas:
  - una puerta termina en `blocked`, `failed`, `recovery_required`,
    `forward_recovery_required`, `server_coordination_required` o
    `rollback_required` y no entiendes por qué;
  - el `--dry-run` de una puerta muestra algo distinto de lo que
    esperabas;
  - `docker compose ps` o `lsof -nP -iTCP:3000 -sTCP:LISTEN` muestran algo
    que no reconoces antes de empezar (§0);
  - necesitas copiar un valor, comando o log fuera de la terminal para
    pedir ayuda — no lo hagas (siguiente punto); en su lugar, describe el
    problema en palabras.
  - cualquier verificación de S9 (ACL, adaptador, ausencia de versiones
    comprometidas, `.env.example`) no queda en verde.
- **Comandos que nunca deben copiarse al chat**: ver §6 más abajo — ningún
  comando que contenga un valor de `.env.gapssa`, ninguna salida de
  `cat`/`grep`/`env` sin redactar sobre ese archivo, ningún argumento con
  una contraseña o clave real.
- **Teardown**: este runbook no crea infraestructura desechable — la
  crean las suites de prueba (ver
  `scripts/secrets-rotation/README.md` §"Suite de integración" y
  §"Ensayo de ACL de S9"), que se autolimpian (`down -v` + verificación de
  inventario idéntico antes/después). El único "teardown" de este runbook
  es el propio §8 (poner el `.env` comprometido en cuarentena) — nunca
  antes de que TODO lo anterior esté verificado en verde.
- **La rotación real, aunque termine en verde, NO cierra la V1 del
  proyecto.** Rotar secretos es una tarea de higiene de seguridad
  puntual, independiente del alcance funcional de la V1 (portal, reservas,
  CRM) — no declares la V1 terminada como consecuencia de esta rotación,
  ni uses su cierre como criterio de "V1 lista".

## 0. Antes de empezar

1. **Cierra completamente Claude Code** (la app/CLI, no solo esta pestaña
   de tarea) y la tarea/sesión en la que se generó este runbook.
2. Abre `Terminal.app` (o tu terminal habitual) — verifica que no es una
   terminal integrada de un editor con un agente activo.
3. Confirma que los servicios de GAPSSA están detenidos (ya deberían
   estarlo — la sesión que preparó este runbook ejecutó
   `docker compose stop` y detuvo el proceso principal con `SIGTERM`):

   ```sh
   cd /Users/isainrodrigueznorena/Isain/Gapssa
   docker compose ps
   lsof -nP -iTCP:3000 -sTCP:LISTEN
   ```

   Ambos deberían no mostrar nada en ejecución. Si algo sigue vivo,
   detenlo tú mismo (`docker compose stop`, o `kill` del proceso de
   `next dev`) antes de continuar.

## 1. Crear el almacén externo

```sh
cd /Users/isainrodrigueznorena/Isain/Gapssa
bash scripts/secrets-rotation/01-init-external-store.sh "$HOME/.gapssa-secrets"
```

Confirma la frase que te pide (`confirmo fuera de claude code`). El
script crea `$HOME/.gapssa-secrets` con modo `700`.

Antes de continuar, **verifica manualmente** que esa ruta no está
sincronizada con iCloud Drive: Ajustes del Sistema → tu Apple ID →
iCloud → "Sincronizar este Mac" → confirma que "Escritorio y Documentos"
no incluye `$HOME` completo (por defecto no lo hace; `~/.gapssa-secrets`
al estar directamente bajo `$HOME`, oculto, no bajo Escritorio/Documentos,
normalmente queda fuera).

## 2. Copiar el `.env` actual al almacén externo

**Esto lo haces tú directamente en la terminal, sin ningún script de este
repositorio** — es la única copia del `.env` comprometido que necesitas
conservar temporalmente, solo para poder generar el `.env.gapssa` externo
con la misma forma (mismas variables) antes de sustituir cada valor:

```sh
cp /Users/isainrodrigueznorena/Isain/Gapssa/.env "$HOME/.gapssa-secrets/.env.gapssa"
chmod 600 "$HOME/.gapssa-secrets/.env.gapssa"
```

En este punto, `.env.gapssa` contiene los mismos valores comprometidos
que el `.env` del repo — es un punto de partida temporal, no un estado
final. Cada puerta de la sección 4 sustituye sus variables por valores
nuevos.

## 3. Verificar acceso administrativo antes de rotar

```sh
# PostgreSQL — confirma que puedes conectar como gapssa_apps (superusuario)
docker exec gapssa-apps-db-1 pg_isready -U gapssa_apps

# MariaDB de EspoCRM
docker compose exec espocrm-db mariadb -u root -p -e "SELECT 1;"

# EspoCRM — confirma acceso admin en http://localhost:8081
```

Si necesitas arrancar los contenedores para esto (`docker compose up -d
apps-db espocrm-db espocrm`), hazlo — el objetivo de esta sección es solo
confirmar que tienes las vías de recuperación antes de rotar, no ejecutar
la rotación todavía.

## 4. Ejecutar cada puerta (S2–S7)

Sigue el orden y el detalle exacto de
`docs/plan-rotacion-secretos-gapssa-2026-08-13.md` §3. Resumen operativo
por puerta — usa `scripts/secrets-rotation/02-generate-secret.sh` para
generar cada valor nuevo directamente en `"$HOME/.gapssa-secrets/.env.gapssa"`:

### S2 — PostgreSQL

```sh
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line POSTGRES_PASSWORD --format hex --bytes 32
```

Luego actualiza `DATABASE_URL_AUTH`/`DATABASE_URL_BOOKING`/`DATABASE_URL_CMS`
con el mismo valor nuevo (edítalos tú mismo en un editor de texto normal,
fuera de Claude Code — son tres líneas, el valor ya está en
`POSTGRES_PASSWORD` en el mismo archivo). Después:

```sh
docker compose up -d apps-db
docker exec gapssa-apps-db-1 psql -U gapssa_apps -d postgres \
  -c "ALTER ROLE gapssa_apps WITH PASSWORD '<pega aquí el mismo valor que escribiste arriba>';"
```

(Pegar el valor en este único comando interactivo es aceptable — nunca
queda en un archivo del repositorio ni en un historial de shell si usas
`HISTCONTROL=ignorespace` con un espacio inicial, o borras la línea del
historial después.)

### S3 — MariaDB / EspoCRM (usuario de aplicación y root)

```sh
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line ESPOCRM_DB_PASSWORD --format hex --bytes 32
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line ESPOCRM_DB_ROOT_PASSWORD --format hex --bytes 32
```

Aplica ambos con `ALTER USER` dentro de `espocrm-db`, luego
`docker compose up -d espocrm-db espocrm espocrm-daemon espocrm-websocket`.

### S4 — EspoCRM admin + API Key

```sh
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line ESPOCRM_ADMIN_PASSWORD --format base64 --bytes 24
```

Cambia la contraseña de `admin` desde la UI de EspoCRM. Genera una API
Key **nueva** para el `User` `portal-gapssa-api` desde la propia UI de
EspoCRM (Administración → Usuarios → portal-gapssa-api → generar nueva
API Key) — EspoCRM no permite generarla por script sin pasar por su
propia UI/API admin, así que este paso es manual. Copia el valor nuevo a
mano en `ESPOCRM_API_KEY` dentro de `.env.gapssa`. Solo entonces revoca/
regenera la anterior desde la misma pantalla.

### S5 — Redis

```sh
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line REDIS_PASSWORD --format base64 --bytes 24
```

Actualiza `REDIS_URL` a mano con el mismo valor. Aplica con
`docker compose up -d redis` (la imagen `redis:8-alpine` de este proyecto
toma `REDIS_PASSWORD` como variable de arranque — confirma en
`compose.yml` si prefieres `CONFIG SET requirepass` en caliente en su
lugar).

### S6 — Payload / Auth / OTP

```sh
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line PAYLOAD_SECRET --format base64 --bytes 32
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line OTP_HMAC_SECRET --format base64 --bytes 32
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line AUTH_RATE_LIMIT_HMAC_SECRET --format base64 --bytes 32
```

### S7 — Booking (los cinco secretos)

**Nunca reutilices las versiones `v2` que ya existen hoy en el `.env` del
repo — están comprometidas igual que la `v1`.** Genera `v3` directamente:

```sh
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-json-map BOOKING_FIELD_ENCRYPTION_KEYS v3 --format base64 --bytes 32
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-json-map BOOKING_IDENTITY_FINGERPRINT_HMAC_SECRETS v3 --format base64 --bytes 32
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line BOOKING_EMAIL_LOOKUP_HMAC_SECRET --format base64 --bytes 32
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line BOOKING_REQUEST_ACCESS_TOKEN_HMAC_SECRET --format base64 --bytes 32
bash scripts/secrets-rotation/02-generate-secret.sh \
  "$HOME/.gapssa-secrets/.env.gapssa" --set-line BOOKING_INTERNAL_API_SECRET --format base64 --bytes 32
```

Después, a mano en un editor: cambia
`BOOKING_FIELD_ENCRYPTION_ACTIVE_KEY_VERSION=v1` a `v3`, y
`BOOKING_IDENTITY_FINGERPRINT_ACTIVE_KEY_VERSION=v1` a `v3` (deja `v1` y
`v2` todavía en cada mapa JSON — la migración de la puerta S7 los necesita
para leer antes de recifrar).

Arranca `apps/web` apuntando al archivo externo (ver §5) y ejecuta la
migración ya escrita y probada:

```sh
cd apps/web
npx tsx -e "
import('./src/server/booking/fieldEncryptionRotation.ts').then(async (m) => {
  const { bookingDb } = await import('./src/server/booking/db/client.ts')
  const guest = await m.rotatePendingGuestIdentities(bookingDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
  const auth = await m.rotatePendingAuthenticatedContactDetails(bookingDb, { fromVersion: 'v1', toVersion: 'v3', dryRun: false })
  console.log(JSON.stringify({ guest, auth }))
})
"
```

Repite con `fromVersion: 'v2'` (las filas que pudieran haber quedado en la
`v2` comprometida, si alguna vez llegó a usarse — no debería haber ninguna,
pero repetirlo es idempotente y barato).

Verifica `countRowsStillOnVersion(bookingDb, 'v1')` y `'v2'` en `0` antes
de retirarlas del mapa JSON.

## 5. Arrancar los servicios con el archivo externo

```sh
cd /Users/isainrodrigueznorena/Isain/Gapssa
docker compose --env-file "$HOME/.gapssa-secrets/.env.gapssa" up -d
dotenv -e "$HOME/.gapssa-secrets/.env.gapssa" -- npm run dev -w @gapssa/web
```

## 6. No copiar resultados al chat

Si vuelves a abrir Claude Code después de esto, **no pegues ningún valor
de `.env.gapssa`, ninguna línea de log con contraseñas, ningún comando que
las contenga.** Si necesitas que un agente confirme que la rotación
funcionó, comparte solo el informe sanitizado (paso 7) o descripciones en
palabras ("la rotación S2 terminó, health en verde"), nunca el archivo ni
comandos que lo referencien con `cat`/`grep` sin redactar.

## 7. Informe sanitizado

Si usas `rotate-all-interactive.sh`, el informe final se genera solo, con
**identidad de sesión** (Bloque 6, corrección de colisiones): un `run_id`
CSPRNG se genera una única vez al arrancar el script y forma parte del
nombre del fichero — `rotation-report-<timestamp>-<run_id>.txt`, nunca
solo la fecha — con reserva atómica del nombre (nunca sobrescribe un
informe existente), escritura a un temporal seguro en el mismo
directorio, `fsync`, y `rename` atómico. La puerta S9 verifica al
final que existe **exactamente un** informe asociado a su propio
`run_id` — si encuentra cero o más de uno, la puerta falla cerrada en
vez de darse por completa con un informe ambiguo o ausente.

Si generas el resumen a mano (o con un script propio) en vez de usar el
asistente, que contenga **únicamente**:

- qué puertas (S1–S9) se completaron;
- booleano de éxito por puerta;
- conteos (filas migradas, servicios reiniciados);
- qué pruebas pasaron;
- **cero valores, cero DSN, cero fragmentos**.

## 8. Retirar el `.env` comprometido

Solo después de que TODO lo anterior esté verificado y en verde:

```sh
cd /Users/isainrodrigueznorena/Isain/Gapssa
mv .env ".env.compromised-2026-08-13.bak"
chmod 600 ".env.compromised-2026-08-13.bak"
```

Consérvalo fuera del árbol de Git (ya está en `.gitignore` como `.env*`)
únicamente como referencia de qué variables existían, hasta que confirmes
que ya no lo necesitas — o muévelo fuera del repo, al mismo almacén
externo, si prefieres no dejarlo ni siquiera ahí.

## 9. Abrir una tarea nueva

Solo después del health final en verde (servicios arriba con el archivo
externo, EspoCRM `app-check` verde, `apps/web` respondiendo en
`/api/health`), abre una tarea nueva de Claude Code si quieres continuar
con 5B-2B o cualquier otro trabajo. La tarea que generó este runbook debe
darse por cerrada sin reanudar nada.
