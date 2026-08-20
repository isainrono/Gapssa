# Infraestructura y operación local

Fuentes verificadas directamente en el repo: `compose.yml`, `.env.example`,
`Makefile`, `scripts/backup-espocrm-db.sh`, `.gitignore`, `README.md`.
Marca **[SRC]** = verificado en archivo real del repo, **[DOC]** = objetivo
de producción documentado en `PROJECT_CONTEXT.md`/`PLAN_DESARROLLO_WEB_PORTAL.md`
pero no construido aún.

## 1. Entorno local actual (lo único que corre hoy) [SRC]

Requisitos: Docker Desktop, Docker Compose v2+, `make` (opcional). Todo se
puede ejecutar también con `docker compose` directo.

Servicios definidos en `compose.yml` (proyecto Compose `gapssa` por defecto,
`COMPOSE_PROJECT_NAME`):

| Servicio | Imagen | Rol | Red |
|---|---|---|---|
| `espocrm-db` | `${ESPOCRM_DB_IMAGE}` (MariaDB 11.4) | Base de datos de EspoCRM | `private` (interna, sin salida) |
| `espocrm` | `${ESPOCRM_IMAGE}` (`espocrm/espocrm:10.0.3-apache-trixie`) | App web EspoCRM | `public` + `private` |
| `espocrm-daemon` | misma imagen, `entrypoint: docker-daemon.sh` | Cron/colas de EspoCRM (procesa los jobs `gcs-push`) | `public` + `private` |
| `espocrm-websocket` | misma imagen, `entrypoint: docker-websocket.sh` | WebSocket de EspoCRM (ZeroMQ) | `public` + `private` |

Puertos publicados en el host: EspoCRM HTTP en `${ESPOCRM_HTTP_PORT}`
(por defecto **8081**, ver `.env.example`), WebSocket en
`${ESPOCRM_WEBSOCKET_PORT}` (por defecto **8083**). `espocrm-db` no publica
puerto: solo accesible desde la red `private`, que es `internal: true` (sin
salida a Internet).

Volúmenes nombrados: `espocrm-db`, `espocrm-data`, `espocrm-custom`,
`espocrm-client-custom`. `espocrm-daemon` y `espocrm-websocket` reutilizan los
volúmenes de `espocrm` vía `volumes_from`.

Health checks: `espocrm-db` con `healthcheck.sh --connect --innodb_initialized`;
`espocrm` con `bin/command app-check`. `espocrm-daemon`/`espocrm-websocket`
dependen de que `espocrm` esté `service_healthy`.

Configuración regional fija en `compose.yml`: `ESPOCRM_LANGUAGE: es_ES`,
`ESPOCRM_TIME_ZONE: Europe/Madrid`, `ESPOCRM_DATE_FORMAT: DD/MM/YYYY`,
`ESPOCRM_TIME_FORMAT: HH:mm`, `ESPOCRM_WEEK_START: 1`,
`ESPOCRM_DEFAULT_CURRENCY: EUR`.

## 2. Variables de entorno [SRC]

`.env` (no versionado; copiar desde `.env.example` y sustituir los valores
`change-me-*`). El `.gitignore` excluye `.env` y `.env.*` pero mantiene
`!.env.example`.

```
COMPOSE_PROJECT_NAME=gapssa
ESPOCRM_IMAGE=espocrm/espocrm:10.0.3-apache-trixie
ESPOCRM_HTTP_PORT=8081
ESPOCRM_WEBSOCKET_PORT=8083
ESPOCRM_SITE_URL=http://localhost:8081
ESPOCRM_ADMIN_USERNAME=admin
ESPOCRM_ADMIN_PASSWORD=change-me-admin-password
ESPOCRM_DB_IMAGE=mariadb:11.4
ESPOCRM_DB_NAME=espocrm
ESPOCRM_DB_USER=espocrm
ESPOCRM_DB_PASSWORD=change-me-database-password
ESPOCRM_DB_ROOT_PASSWORD=change-me-root-password
```

No hay hoy variables para n8n, Payload, PostgreSQL, Redis ni FacturaScripts:
esos servicios no están en `compose.yml` todavía [SRC] — son objetivo del
plan de portal ([[04-portal-web-reservas-plan]] §13, Fase 1).

## 3. Comandos Makefile de nivel raíz [SRC]

| Comando | Qué hace |
|---|---|
| `make config` | `docker compose config` (valida el compose) |
| `make up` | `docker compose up -d` |
| `make down` | `docker compose down` (conserva datos; **nunca** usar `--volumes` salvo borrado deliberado) |
| `make restart` | `docker compose restart` |
| `make ps` | `docker compose ps` |
| `make logs` | `docker compose logs --tail=100` (todos los servicios) |
| `make crm-logs` | logs de `espocrm espocrm-daemon espocrm-websocket` |
| `make health` | `docker compose exec espocrm bin/command app-check` |
| `make espocrm-export` | Copia al repo (`extensions/espocrm/custom/Espo/Custom/`) las personalizaciones hechas desde el administrador de EspoCRM |
| `make espocrm-backup` | Ejecuta `scripts/backup-espocrm-db.sh` |

Los comandos `gcs-*` (extensión Google Calendar Sync) están documentados en
[[03-espocrm-modelo-y-extension-gcs]] §5.6 — no los dupliques aquí, son parte
del ciclo de vida de esa extensión, no de la infraestructura general.

## 4. Flujo de arranque típico [SRC/DOC]

```bash
cp .env.example .env        # y sustituir los change-me-*
docker compose config       # validar
docker compose up -d        # descargar e iniciar
docker compose ps           # comprobar estado
docker compose logs --tail=100 espocrm
```

Abrir `http://localhost:8081`. Para detener conservando datos:
`docker compose down` (**no** `--volumes`).

## 5. Copias de seguridad locales [SRC]

`scripts/backup-espocrm-db.sh`: genera `backups/espocrm/espocrm-<timestamp>.sql.gz`
con `mariadb-dump --single-transaction --routines --triggers --events
--default-character-set=utf8mb4` ejecutado dentro del contenedor `espocrm-db`,
comprime con `gzip -9` y verifica con `gzip -t`. Falla si ya existe un backup
con el mismo nombre de archivo (mismo segundo). `backups/` está en
`.gitignore`: estas copias **no** se versionan.

Política de copias en producción (objetivo, no implementado aún) [DOC]:
copias externas independientes de Plesk/VPS, copia diaria cifrada, retención
diaria 14 días / semanal 8 semanas / mensual 12 meses, pruebas periódicas de
restauración. El destino externo definitivo de las copias está **pendiente
de decidir** [ND] — no lo asumas ni lo propongas como si estuviera resuelto.

## 6. Infraestructura de producción (objetivo, no construida) [DOC]

VPS existente con Plesk como proxy inverso y terminación HTTPS. Dominio
`gapssa.es`. Subdominios: `gapssa.es` (web), `crm.gapssa.es` (EspoCRM),
`erp.gapssa.es` (FacturaScripts), `automatiza.gapssa.es` (n8n),
`staging.gapssa.es` (pruebas). Entornos de prueba de CRM/ERP/n8n protegidos y
no indexados. Bases de datos aisladas, credenciales independientes,
comunicación solo por API/eventos. Despliegue mediante contenedores Docker;
`infra/docker` está vacío hoy en el repo.

Seguridad de infraestructura prevista: 2FA obligatorio para usuarios
internos, cuentas personales nunca compartidas, bloqueo tras intentos
fallidos, cierre de sesiones inactivas, auditoría de accesos y cambios
sensibles, secretos fuera del repositorio, n8n con permisos mínimos por API.

Correo: cuenta inicial `reservas@gapssa.es`; más adelante `hola@gapssa.es` y
`administracion@gapssa.es` [ND en cuanto a credenciales concretas].

## 7. Entornos y despliegue (reglas) [DOC]

Entorno de pruebas separado de producción, con datos ficticios o
anonimizados. Cambios sometidos a pruebas automáticas. Despliegue automático
a **pruebas** desde la rama principal; **producción requiere aprobación
manual**. Copia recuperable antes de cambios de datos o plataformas.
Procedimiento de reversión si falla la verificación posterior.

## 8. Repositorio [DOC]

Repositorio privado en GitHub. Monorepositorio modular para: Web/CMS,
integraciones, módulos de EspoCRM, plugins de FacturaScripts, contratos de
datos, infraestructura, pruebas y documentación — de ahí la estructura
`apps/`, `integrations/`, `extensions/`, `packages/`, `infra/`, `tests/`,
`docs/` que ya existe como esqueleto (mayormente vacío salvo
`extensions/espocrm-google-calendar-sync`).

## 9. Calendario orientativo de la V1 del portal [DOC]

| Periodo (agosto 2026) | Objetivo |
|---|---|
| 5–9 | Arquitectura, contratos y base del entorno |
| 10–16 | Web pública, Payload, idiomas, catálogo y SEO |
| 17–23 | Autenticación, portal y reservas |
| 24–27 | Cuestionarios, consentimientos y seguridad |
| 28–30 | Pruebas, accesibilidad y correcciones |
| 31 | Validación local y paquete de despliegue |
| 1 de septiembre | V1 local operativa controlada |

Nota aparte, no del portal: el **primer lanzamiento de EspoCRM** (agenda
central, sin web) tenía fecha objetivo **10 de agosto de 2026**, con pruebas
de aceptación de usuario los días 8–9 de agosto — ver
[[01-fuentes-de-verdad-y-reglas-negocio]] §15 y §17 de `PROJECT_CONTEXT.md`
para el detalle de alcance incluido/excluido de ese primer lanzamiento.

## 10. Gotchas operativos caros

- **Nunca** `docker compose down --volumes` salvo que se quiera borrar
  deliberadamente toda la instalación y la base de datos local — no hay forma
  de deshacerlo sin un backup previo.
- `espocrm-daemon` es el que procesa la cola `gcs-push`: si las citas no se
  sincronizan con Google, comprueba primero que ese contenedor está
  `running` y sano (`make crm-logs`), antes de sospechar de la extensión.
- `make health` y `make gcs-status` consultan cosas distintas: el primero es
  el health check general de EspoCRM (`app-check`); el segundo es específico
  de la extensión GCS y consulta la BD directamente.
- La red `private` de `compose.yml` es `internal: true`: un contenedor
  conectado únicamente a `private` no tiene salida a Internet ni acceso desde
  el host. Si añades un servicio nuevo (n8n, Postgres, Redis) que necesite
  salir a Internet o ser accesible, decide con qué redes conectarlo — no
  asumas que `private` le basta.
