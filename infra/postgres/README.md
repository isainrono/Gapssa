# PostgreSQL local (`apps-db`)

Un único servidor Postgres 18 en local (contenedor `apps-db`) aloja tres
bases de datos separadas, para mantener la separación lógica exigida en
`docs/contratos-portal-v1.md` sin levantar tres contenedores en Fase 1:

| Base de datos | Propósito | Consumidor |
|---|---|---|
| `gapssa_cms` (`POSTGRES_DB`) | Contenido y traducciones | `apps/web` (Payload embebido) |
| `gapssa_auth` (`POSTGRES_AUTH_DB`) | Cuentas de cliente, credenciales, sesiones, verificación, tutores, independencia, auditoría | `apps/web` (Fase 3, implementado — ver `apps/web/src/server/auth/`) |
| `gapssa_booking` (`POSTGRES_BOOKING_DB`) | `BookingRequestRecord`/`PendingGuestIdentity` | BFF (Fase 4, no implementado todavía) |

`gapssa_cms` la crea automáticamente la imagen oficial de Postgres a partir
de `POSTGRES_DB`. `gapssa_auth` y `gapssa_booking` las crea
`init/001-create-databases.sh` (script de shell, no SQL puro: los nombres
son configurables por variable de entorno — `POSTGRES_AUTH_DB`,
`POSTGRES_BOOKING_DB`, ver `.env.example` —, no están hardcodeados). El
script valida cada nombre contra un patrón estricto de identificador
(`^[A-Za-z_][A-Za-z0-9_]{0,62}$`) antes de interpolarlo en cualquier
sentencia SQL, y solo crea la base si todavía no existe (`SELECT ... FROM
pg_database` antes del `CREATE DATABASE`), de forma que ejecutarlo dos
veces sobre el mismo volumen no falla.

Montado en `/docker-entrypoint-initdb.d/` — **solo se ejecuta la primera
vez** que se inicializa un volumen (comportamiento estándar de la imagen
oficial de Postgres: los scripts `.sh`/`.sql` de esa carpeta solo corren
cuando el volumen de datos está vacío; si `apps-db-data` ya tiene datos,
como en este entorno, cambiar este script **no** lo vuelve a ejecutar).

### Verificación aislada (sin tocar el volumen real)

El script se probó contra un contenedor y un volumen Postgres temporales,
nunca contra `apps-db-data`:

```bash
docker volume create gapssa-init-script-test-volume
docker run -d --name gapssa-init-script-test \
  -e POSTGRES_DB=gapssa_cms -e POSTGRES_USER=gapssa_apps -e POSTGRES_PASSWORD=test-password \
  -e POSTGRES_AUTH_DB=custom_auth_name -e POSTGRES_BOOKING_DB=custom_booking_name \
  -v gapssa-init-script-test-volume:/var/lib/postgresql \
  -v "$(pwd)/infra/postgres/init":/docker-entrypoint-initdb.d:ro \
  postgres:18-alpine
# ... verificar con psql -c "\l", volver a ejecutar el script a mano para
# comprobar idempotencia, probar un nombre malicioso (debe rechazarse) ...
docker rm -f gapssa-init-script-test
docker volume rm gapssa-init-script-test-volume
```

Confirmado: nombres personalizados respetados, segunda ejecución
idempotente ("ya existía; no se toca"), e identificador con `; DROP
DATABASE ...` rechazado antes de tocar la base de datos.

## Migraciones

- **`gapssa_cms`**: gestionadas por Payload (`payload migrate`, ver
  `apps/web/README.md`). No se tocan a mano.
- **`gapssa_auth`** (Fase 3, decidido y en uso): **Drizzle ORM +
  drizzle-kit** — ya dependencia transitiva de `@payloadcms/db-postgres`
  (mismo `drizzle-orm`), sin añadir un ORM nuevo al proyecto. Esquema en
  `apps/web/src/server/auth/db/schema.ts`, migraciones versionadas en
  `apps/web/drizzle/auth/migrations/` (una config propia,
  `apps/web/drizzle.auth.config.ts` — nunca comparte carpeta con la futura
  `gapssa_booking`). Comandos, desde la raíz del monorepo:
  - `npm run auth:db:generate -w @gapssa/web` — genera una migración SQL a
    partir del esquema de Drizzle (no toca ninguna base de datos).
  - `npm run auth:db:migrate -w @gapssa/web` — aplica las migraciones
    pendientes contra `DATABASE_URL_AUTH`. Idempotente: Drizzle registra
    cada migración aplicada en su propia tabla de control
    (`drizzle.__drizzle_migrations`), así que repetir el comando sobre una
    base ya migrada es un no-op verificado.
  - Ver `docs/fase3-autenticacion.md` §2 para el esquema completo (8
    tablas) y el razonamiento de cada decisión.
- **`gapssa_booking`**: **sin ORM decidido todavía**
  (`docs/contratos-portal-v1.md` §10) — decisión de Fase 4.

## Acceso desde el host durante desarrollo

El puerto de Postgres se publica **solo en `127.0.0.1`**
(`127.0.0.1:${POSTGRES_HOST_PORT}:5432`), nunca en todas las interfaces:
es la excepción documentada a "sin puerto publicado al host", necesaria
porque `apps/web` corre con `next dev` en el host (no en Docker) durante
el desarrollo local y necesita alcanzar Postgres. No es una exposición
pública: sigue sin ser accesible desde fuera de la propia máquina.
