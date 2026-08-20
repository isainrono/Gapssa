# Manifiestos del checkpoint V1

## Propósito

Estos seis ficheros (`commit-1.txt` … `commit-6.txt`) son la lista exacta,
revisable y versionable de qué ruta va en cada uno de los seis commits
acordados para cerrar el trabajo pendiente en el árbol de trabajo a fecha
de este checkpoint. Sustituyen a cualquier plan de commits que solo
existiera en el contexto de una conversación anterior — la clasificación
vive en disco, se puede auditar con herramientas de línea de comandos y
no depende de la memoria de ninguna sesión.

Cada `.txt` contiene una ruta relativa a la raíz del repositorio por
línea, ordenada alfabéticamente, sin patrones glob ni comodines — cada
línea es una ruta de fichero exacta (o, en el caso de
`integrations/n8n/.gitkeep` en `commit-1.txt`, una eliminación
intencional: el fichero ya no existe en el árbol de trabajo porque su
directorio pasó a tener contenido real).

**Revisión 2026-08-20**: reclasificación completa a petición explícita
del propietario del proyecto — la primera versión de este checkpoint
metía 29 documentos de `docs/` dentro de Commit 2 y dejaba Commit 6 con
solo 15 rutas. La separación quedó corregida (ver tabla más abajo) y se
añadieron tres piezas nuevas de tooling (generador de entorno sintético,
comprobador de longitud de socket, runner Node oficial de Commit 5) tras
un incidente de lectura indebida de `.env` real durante la validación
aislada anterior — ver
`docs/incidente-lectura-env-validacion-manifiestos-2026-08-19.md`.

## HEAD base

`6bd2111ad72bdff57b3f8b6fc48231bad3b50a58` ("Amplía tratamientos y zonas
de atención", 2026-08-05T18:06:20+02:00) — el último commit real de la
rama `main` en el momento de generar estos manifiestos. Todas las rutas
listadas son cambios (creación, modificación o eliminación) respecto a
ese HEAD, todavía sin `git add` ni commit.

## Fecha

Generados el 2026-08-20; reclasificados el 2026-08-20 (misma fecha,
misma sesión de checkpoint).

## Reglas de clasificación (definitivas)

| Commit | Contenido | Regla de ruta |
|---|---|---|
| **1 — Higiene, workspace e infraestructura base** | Config raíz del monorepo, infraestructura compartida (Postgres del portal, integraciones futuras sin construir) | `.env.example`, `.gitignore`, `compose.yml`, `package.json`, `package-lock.json`, `infra/postgres/**`, `infra/facturascripts/**`, `integrations/n8n/**` |
| **2 — Portal GAPSSA V1** | La app Next.js/Payload completa, su dependencia de contratos y su documentación interna propia | `packages/contracts/**`, `apps/web/**` (incluye migraciones Drizzle, las 10 imágenes categoría A + `ATTRIBUTION.md`, `logo.webp`, y la documentación interna `apps/web/README.md`/`AGENTS.md`/`CLAUDE.md`), `apps/cms/README.md`. **Ningún documento raíz de `docs/**` vive aquí.** |
| **3 — Integración EspoCRM** | Personalizaciones del EspoCRM real | `extensions/espocrm/custom/**` únicamente. Sin documentos raíz de `docs/**` (`docs/espocrm-modelo-inicial.md` vive en Commit 6, no aquí, porque no está dentro del subárbol de la extensión) |
| **4 — Google Calendar Sync** | La extensión reutilizable de sincronización de calendario | `extensions/espocrm-google-calendar-sync/**`. Sin `build/` ni ZIP (ignorados por Git, nunca candidatos) |
| **5 — Asistente seguro de rotación S1–S9** | Herramienta de rotación de secretos, su documentación operativa estricta, y el cierre documental del incidente de esta misma validación | `scripts/secrets-rotation/**` (incluye `run-node-tests.sh`, el runner oficial nuevo), `docs/runbook-rotacion-secretos-externa.md`, `docs/plan-rotacion-secretos-gapssa-2026-08-13.md`, `docs/incidente-*-2026-08-13.md` (los 3 incidentes previos), `docs/incidente-lectura-env-validacion-manifiestos-2026-08-19.md` (el nuevo) |
| **6 — Documentación y tooling del proyecto** | Configuración de asistencia IA, tooling de validación de checkpoints, estos manifiestos, y el resto de `docs/**` | `.claude/**` (excepto lo ignorado), `scripts/checkpoint-validation/**` (generador de entorno sintético, guard, comprobador de socket), `docs/manifests/checkpoint-v1/**`, `README.md` raíz, `PROJECT_CONTEXT.md`, y todo `docs/**` que no esté explícitamente en Commit 5 (incluye `docs/espocrm-modelo-inicial.md`, `docs/contratos-portal-v1.md`, `docs/dependencias-vulnerabilidad-undici.md`, `docs/deuda-imagenes-stock.md`, `docs/deuda-tecnica-orden-tests-integracion.md`, `docs/fase3-*.md`, `docs/fase4a-*.md`, `docs/fase4b-*.md`) |

Verificado programáticamente: las 578 rutas candidatas (todo lo
modificado/eliminado respecto a HEAD, más todo lo nuevo no ignorado) se
reparten en exactamente un commit cada una — 0 sin clasificar, 0
duplicadas entre ficheros.

### Conteo por commit (revisión 2026-08-20)

| Commit | Rutas |
|---|---|
| 1 — Higiene, workspace e infraestructura base | 14 |
| 2 — Portal GAPSSA V1 | 396 |
| 3 — Integración EspoCRM | 24 |
| 4 — Google Calendar Sync | 13 |
| 5 — Asistente rotación S1–S9 | 81 |
| 6 — Documentación y tooling | 50 |
| **Total** | **578** |

## Archivos ignorados

Ningún candidato proviene de una ruta cubierta por `.gitignore` — la
construcción de la lista ya parte de `git ls-files --others
--exclude-standard`, que respeta el `.gitignore` vigente (incluida la
corrección de este checkpoint para `apps/web/src/seed/data/` y la
exclusión exacta de `apps/web/public/images/equipo/diana.jpg`).
Comprobado explícitamente que ninguna línea de los seis `.txt` coincide
con: `.env`, `.claude/settings.local.json`, `.claude/scheduled_tasks.lock`,
`backups/`, `node_modules/`, `.next/`, `coverage/`, `test-results/`,
`*.zip`, `__pycache__/`, `*.pyc`, `gapssa1/`, `apps/web/media/`
(incluida la cuarentena de imágenes categoría B), ni
`apps/web/public/images/equipo/diana.jpg`.

## Secretos

Estos manifiestos son listas de **rutas**, nunca de contenido. Ninguno de
los seis `.txt` ni este `README.md` contiene valores de variables de
entorno, claves, contraseñas ni tokens. El `.env` real del repositorio no
se lee ni se modifica para generar ni validar este checkpoint — la
validación aislada usa exclusivamente
`scripts/checkpoint-validation/generate-synthetic-env.sh`, que nunca abre
`.env` real (ver "Validación aislada" más abajo y
`docs/incidente-lectura-env-validacion-manifiestos-2026-08-19.md`). La
migración del `.env` real al formato de secretos versionado queda
bloqueada hasta que se ejecute el asistente de rotación S1–S9 (Commit 5),
fuera del alcance de este checkpoint.

## Validación aislada — reglas obligatorias

1. **Nunca copiar `.env` real.** Usar siempre
   `scripts/checkpoint-validation/generate-synthetic-env.sh <directorio>`
   para generar un `.env` sintético dentro de la copia temporal — parte
   únicamente de `.env.example`, valores ficticios cerrados, modo 600,
   nunca imprime valores, y aborta si por cualquier motivo su origen
   resolviera al `.env` real. Prueba guard:
   `scripts/checkpoint-validation/generate-synthetic-env.guard-test.sh`.
2. **Raíz temporal corta.** Comprobar antes con
   `scripts/checkpoint-validation/check-socket-path-length.sh <raíz>` y
   usar siempre `mktemp -d /tmp/gapssa-XXXXXX` (nunca una ruta anidada
   profunda) — algunas pruebas usan sockets de dominio Unix, con un
   límite de sistema de 104 bytes en `sockaddr_un.sun_path`.
3. **Pruebas Node de Commit 5**: siempre con
   `scripts/secrets-rotation/run-node-tests.sh` (runner oficial,
   secuencial) — nunca `node --test lib/*.test.mjs ...` en un solo
   proceso (corren en paralelo por defecto y pueden colisionar en
   puertos con otros procesos de la máquina).
4. **Teardown completo** siempre: `.env` sintético borrado, contenedores
   Postgres efímeros eliminados, procesos hijo terminados, directorio
   temporal borrado.

## Pruebas asociadas

- **Commit 2 (Portal GAPSSA V1)**: `npm ci`, `typecheck`, `lint`, tests de
  `@gapssa/contracts` y `@gapssa/web` (incluye `media.test.ts`),
  migraciones Drizzle de `auth`/`booking` desde una base vacía, seed
  contra Postgres/Payload efímeros ejecutado dos veces (idempotencia),
  `next build`, arranque real y comprobación de rutas públicas — con el
  entorno sintético del punto 1, nunca `.env` real.
- **Commit 3**: suite PHP de lógica pura (`MeetingHooksPureLogicTest.php`)
  con sus dependencias declaradas.
- **Commit 4**: suite completa de tests PHP de la extensión (10 ficheros)
  + prueba de seguridad de symlinks, con `composer install` (dependencia
  declarada en `composer.json`) — sin ZIP persistido.
- **Commit 5**: `bash -n` sobre los `.sh`, guard de compatibilidad Bash
  3.2, `lib.test.sh`, `run-node-tests.sh` (runner oficial, validado con
  10 ejecuciones consecutivas en verde), `tests/run_scenarios.py` —
  pruebas proporcionales sin infraestructura real, teardown limpio.
- **Commit 1 y 6**: validación de existencia/eliminación intencional y
  ausencia de solapamientos, sin ejecución de build (son configuración,
  infraestructura declarativa y documentación, no código de aplicación).

## Orden de aplicación

1. Commit 1 — Higiene, workspace e infraestructura base.
2. Commit 2 — Portal GAPSSA V1.
3. Commit 3 — Integración EspoCRM GAPSSA.
4. Commit 4 — Google Calendar Sync.
5. Commit 5 — Asistente seguro de rotación S1–S9.
6. Commit 6 — Documentación y tooling del proyecto (incluye estos
   manifiestos, que por tanto solo pueden aplicarse al final, una vez
   existen).

## Alcance

Estos manifiestos describen el **checkpoint previo a la rotación real de
secretos**. La ejecución real de la rotación S1–S9 (más allá de dejar
listo el asistente en el commit 5) es un paso posterior, deliberadamente
fuera del alcance de este checkpoint y de esta sesión — no autorizado
todavía.
