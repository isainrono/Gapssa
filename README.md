# Gapssa

Monorepositorio para la web, CRM, ERP e integraciones de Gapssa. Las decisiones
funcionales y técnicas validadas se encuentran en `PROJECT_CONTEXT.md`.

## Requisitos locales

- Docker Desktop
- Docker Compose v2 o posterior
- `make` (opcional; todos los comandos se pueden ejecutar con Docker Compose)
- Node.js ≥20.9 (probado con 24.13.1) y npm ≥11, para `apps/web` y
  `packages/contracts` (Fase 1)

## Inicio rápido: EspoCRM

1. Copiar `.env.example` como `.env` y sustituir las contraseñas de ejemplo.
2. Validar la configuración:

   ```bash
   docker compose config
   ```

3. Descargar e iniciar los servicios:

   ```bash
   docker compose up -d
   ```

4. Comprobar el estado:

   ```bash
   docker compose ps
   docker compose logs --tail=100 espocrm
   ```

5. Abrir <http://localhost:8081>.

Para detener el entorno conservando todos los datos:

```bash
docker compose down
```

> No ejecutar `docker compose down --volumes` salvo que se quiera borrar de
> forma deliberada toda la instalación y la base de datos local.

## Servicios actuales

| Servicio | Acceso desde macOS | Persistencia |
|---|---|---|
| EspoCRM | <http://localhost:8081> | Volúmenes Docker |
| WebSocket de EspoCRM | `ws://localhost:8083` | Comparte datos con EspoCRM |
| MariaDB | Solo red privada Docker | Volumen Docker |

## Extensión Google Calendar Sync

Extensión instalable de EspoCRM para sincronizar las citas con Google Calendar
(fase 1: espejo de salida hacia el calendario Business). Código y documentación
en `extensions/espocrm-google-calendar-sync/`; instalación con
`make gcs-install`.

## Fase 1 — base de plataforma del portal (`apps/web`, Payload, Postgres, Redis)

Aprobada en `docs/contratos-portal-v1.md` (revisión 4). Sin flujos de
negocio reales todavía: solo la base técnica del portal, en paralelo a
EspoCRM (que sigue siendo la única fuente de verdad operativa).

### Instalación

```bash
npm install                    # instala todos los workspaces (apps/web, packages/contracts)
docker compose up -d apps-db redis   # Postgres + Redis (no toca los servicios de EspoCRM)
```

### Arranque

```bash
npm run dev                    # next dev, con el .env de la raíz ya cargado
```

Abrir <http://localhost:3000> (redirige a `/es`), <http://localhost:3000/admin>
(panel de Payload — pide crear el primer usuario la primera vez) y
<http://localhost:3000/api/health>.

### Parada sin borrar datos

```bash
docker compose down            # o: npm run docker:down
```

`down` **no** borra los volúmenes (`apps-db-data`, `redis-data`, y los de
EspoCRM). No ejecutar `docker compose down --volumes` salvo que se quiera
borrar deliberadamente todos los datos locales, incluidos los de EspoCRM.

### Health checks

- App + Postgres (`gapssa_cms`) + Redis: `GET /api/health` — responde
  `{"status":"ok","checks":{"app":"ok","postgresCms":"ok","redis":"ok"}}`.
- Contenedores: `docker compose ps` (columna `STATUS`, `healthy` cuando
  corresponde) — incluye `apps-db` y `redis` además de los servicios de
  EspoCRM ya existentes.

### Migraciones

- **Payload** (`gapssa_cms`): en desarrollo, Payload sincroniza el esquema
  automáticamente al arrancar (`push` activado por defecto en modo dev). Para
  entornos donde no se quiera ese comportamiento, `npm run payload -w @gapssa/web -- migrate`.
- **`gapssa_auth`/`gapssa_booking`**: sin ORM decidido todavía — ninguna
  tabla ni migración creada a propósito (`docs/contratos-portal-v1.md` §10).
  Las bases ya existen (`infra/postgres/init/`), vacías.

### Estructura del monorepo (ampliada en Fase 1)

```
apps/
  web/        Next.js + Payload CMS embebido (BFF) — ver apps/web/README.md
  cms/        Vacía a propósito — ver apps/cms/README.md
packages/
  contracts/  Tipos y funciones puras compartidas (@gapssa/contracts)
infra/
  postgres/   Script de inicialización de bases de datos + README
```

### Redes Docker

- `public`: servicios HTTP-facing de EspoCRM (sin cambios).
- `private` (`internal: true`, sin salida a Internet): `espocrm-db`, como
  hasta ahora.
- `apps-private` (nueva, Fase 1): `apps-db` (Postgres) y `redis`. Nunca se
  une a `public`. A diferencia de `private`, no es `internal`: Docker no
  aplica la publicación de puertos al host en redes `internal` (comprobado
  al levantar los servicios — ver `compose.yml`), y `apps/web` corre con
  `next dev` en el host durante el desarrollo, no en un contenedor. El
  puerto se ata solo a `127.0.0.1`, nunca a `0.0.0.0`.

### Variables de entorno

Ver `.env.example` (una sola fuente para todo el monorepo, incluido
`apps/web`). Nuevas en Fase 1: `POSTGRES_*`, `DATABASE_URL_CMS`/`_AUTH`/`_BOOKING`,
`REDIS_*`, `PAYLOAD_SECRET`, `NEXT_PUBLIC_SITE_URL`. Validadas al arrancar
en `apps/web/src/server/env.ts` (zod) — el proceso falla rápido y con
mensaje claro si falta alguna.

### Lint, type-check y tests

```bash
npm run lint             # eslint sobre apps/web
npm run typecheck        # tsc --noEmit en apps/web y packages/contracts
npm run test              # vitest (apps/web) + node --test (packages/contracts, 45 pruebas)
npm run test:integration  # servidor Next/Payload real + Postgres/Redis reales — ver detalle abajo
npm run test:e2e          # playwright (requiere `npx playwright install chromium` una vez)
npm run build             # next build (incluye Payload)
```

`test:integration` arranca su propio `next dev` contra una base de datos
Postgres **aislada y efímera** (nunca `gapssa_cms`), creada y borrada por
la propia suite en cada ejecución — nunca toca EspoCRM ni el admin manual
de desarrollo. Requiere `docker compose up -d apps-db redis` ya levantado
y ejecutarse desde la raíz (`npm run test:integration`, no dentro de
`apps/web` directamente, para que cargue `.env`). Cubre el bootstrap del
primer administrador, la política de roles (`admin`/`editor`, ningún
`role` inválido cuenta como autorizado), y la protección del último
administrador bajo concurrencia real. Detalle completo, incluida la
limitación conocida de esa protección, en `apps/web/README.md`.

### Problemas conocidos

- `jsdom` no quedaba resuelto por Vitest en este monorepo con npm
  workspaces (hoisting asimétrico: `vitest` se hoistea a la raíz,
  `jsdom` no). Solución aplicada: `jsdom` también como devDependency en el
  `package.json` raíz.
- `npm audit` reporta una vulnerabilidad "high" en `undici@7.28.0`,
  dependencia directa (versión exacta fijada) de `payload@3.87.0`. Ficha
  completa, cadena de dependencia, severidad, impacto real en este entorno
  e intento de mitigación probado (y revertido) en
  `docs/dependencias-vulnerabilidad-undici.md`. Pendiente de una
  actualización de Payload que suba su propia dependencia de `undici`; no
  se ha aplicado ningún workaround que la sustituya.
- `@gapssa/contracts` se ejecuta como TypeScript fuente sin compilar
  (`noEmit` + `allowImportingTsExtensions`, imports internos con extensión
  `.ts`). Next.js lo transpila vía `transpilePackages`. Si en el futuro
  gana consumidores fuera de Next.js/Node, revisar si compensa compilarlo a
  `dist/` — ver `apps/web/README.md`.

### Reversión de esta fase

Todo lo de Fase 1 es aditivo y no toca EspoCRM. Para revertir sin perder el
trabajo de EspoCRM:

```bash
docker compose down            # detiene todos los contenedores, conserva volúmenes
docker compose rm -f apps-db redis   # si se quiere quitar solo los contenedores nuevos
docker volume rm gapssa_apps-db-data gapssa_redis-data   # solo si se quiere borrar sus datos (irreversible)
```

`apps/web`, `packages/contracts` e `infra/postgres` son directorios nuevos:
basta con no ejecutarlos si no se quiere continuar por este camino; no
modifican nada fuera de sí mismos ni de `compose.yml`/`.env(.example)`
(cambios aditivos, revisables con `git diff`).

