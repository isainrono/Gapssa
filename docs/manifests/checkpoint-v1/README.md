# Manifiestos del checkpoint V1

## Propósito

Estos nueve ficheros (`commit-1.txt` … `commit-9.txt`) son la lista
exacta, revisable y versionable de qué ruta va en cada uno de los nueve
commits del checkpoint: los seis commits funcionales acordados
(`commit-1.txt` … `commit-6.txt`), un séptimo commit exclusivamente
correctivo de formato (`commit-7.txt`, ver "Commit 7 — correctivo" más
abajo), un octavo commit correctivo de una dependencia temporal
detectada al validar el séptimo (`commit-8.txt`, ver "Commit 8 —
correctivo" más abajo), y un noveno commit correctivo de un defecto
bloqueante encontrado en un dry-run manual del asistente de rotación
(`commit-9.txt`, ver "Commit 9 — correctivo" más abajo). Sustituyen a
cualquier plan de commits que solo existiera en el contexto de una
conversación anterior — la clasificación vive en disco, se puede
auditar con herramientas de línea de comandos y no depende de la
memoria de ninguna sesión.

Cada `.txt` contiene una ruta relativa a la raíz del repositorio por
línea, ordenada alfabéticamente, sin patrones glob ni comodines — cada
línea es una ruta de fichero exacta (o, en el caso de
`integrations/n8n/.gitkeep` en `commit-1.txt`, una eliminación
intencional: el fichero ya no existe en el árbol de trabajo porque su
directorio pasó a tener contenido real).

**Revisión 2026-08-20 (reclasificación)**: reclasificación completa a
petición explícita del propietario del proyecto — la primera versión de
este checkpoint metía 29 documentos de `docs/` dentro de Commit 2 y
dejaba Commit 6 con solo 15 rutas. La separación quedó corregida (ver
tabla más abajo) y se añadieron tres piezas nuevas de tooling (generador
de entorno sintético, comprobador de longitud de socket, runner Node
oficial de Commit 5) tras un incidente de lectura indebida de `.env`
real durante la validación aislada anterior — ver
`docs/incidente-lectura-env-validacion-manifiestos-2026-08-19.md`.

**Revisión 2026-08-20 (Commit 7 — correctivo)**: tras crear los seis
commits funcionales sobre el HEAD `6bd2111`, una revisión de
`git diff 6bd2111..HEAD --check` confirmó 5 incidencias reales de
espacio en blanco (el informe de entrega inicial dijo erróneamente "4",
aunque ya las había listado las 5) — ver "Commit 7 — correctivo" más
abajo. `commit-7.txt` documenta ese séptimo commit, puramente mecánico,
que no reescribe ni hace `amend` de ninguno de los seis commits
anteriores.

**Revisión 2026-08-20 (Commit 8 — correctivo)**: al validar el Commit 7
con la suite de integración completa, un test de
`booking.sweepRecovery.int.test.ts` resultó ser sensible a la fecha real
del sistema (un offset de días *hábiles* fijo podía superar el horizonte
de reserva de 60 días naturales según qué día de la semana cayera "hoy")
— ver "Commit 8 — correctivo" más abajo. `commit-8.txt` documenta ese
octavo commit, limitado al fixture del test y a la prueba matemática que
demuestra la corrección, sin tocar código de producción ni ningún commit
anterior.

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
| **7 — Correctivo (formato)** | Nada semántico. Únicamente los 5 ficheros con incidencias de espacio en blanco detectadas por `git diff 6bd2111..HEAD --check` tras crear los commits 1–6, más la actualización de estos manifiestos para documentarlo | `apps/web/src/lib/auth/redirectSafety.ts`, `apps/web/src/server/auth/db/migrate.ts`, `apps/web/src/server/auth/db/schema.ts`, `docs/fase4b-integracion-http.md`, `scripts/secrets-rotation/tests/probes_real_execution.sh`, `docs/manifests/checkpoint-v1/README.md`, `docs/manifests/checkpoint-v1/commit-7.txt` |
| **8 — Correctivo (fixture temporal)** | Nada de negocio. Un único fixture de test con dependencia temporal (offset relativo al reloj real que podía violar el horizonte de reserva según el día de la semana), más la prueba matemática que lo demuestra y la actualización de estos manifiestos | `apps/web/tests/integration/booking.sweepRecovery.int.test.ts`, `docs/manifests/checkpoint-v1/README.md`, `docs/manifests/checkpoint-v1/commit-8.txt` |
| **9 — Correctivo (dry-run fresco S1→S9)** | Nada de negocio ni de infraestructura real. Corrige que `--dry-run` exigiera artefactos físicos o leyera un almacén externo real preexistente en vez de validar un estado virtual propio — solo `scripts/secrets-rotation/` (asistente + script auxiliar), sus pruebas nuevas (Escenarios A-F) y la documentación de ambos, más la actualización de estos manifiestos | `docs/manifests/checkpoint-v1/README.md`, `docs/manifests/checkpoint-v1/commit-9.txt`, `scripts/secrets-rotation/02-generate-secret.sh`, `scripts/secrets-rotation/README.md`, `scripts/secrets-rotation/rotate-all-interactive.sh`, `scripts/secrets-rotation/tests/run_scenarios.py` |

Verificado programáticamente: las 578 rutas candidatas de los commits
1–6 (todo lo modificado/eliminado respecto a HEAD, más todo lo nuevo no
ignorado, en el momento de crear esos seis commits) se reparten en
exactamente un commit cada una — 0 sin clasificar, 0 duplicadas entre
ficheros. Commits 7 y 8 se generaron en pasadas posteriores, cada uno
exclusivamente para las rutas de su propia corrección más los propios
manifiestos.

### Conteo por commit

| Commit | Rutas |
|---|---|
| 1 — Higiene, workspace e infraestructura base | 14 |
| 2 — Portal GAPSSA V1 | 396 |
| 3 — Integración EspoCRM | 24 |
| 4 — Google Calendar Sync | 13 |
| 5 — Asistente rotación S1–S9 | 81 |
| 6 — Documentación y tooling | 50 |
| 7 — Correctivo (formato) | 7 |
| 8 — Correctivo (fixture temporal) | 3 |
| 9 — Correctivo (dry-run fresco S1→S9) | 6 |
| **Total** | **594** |

## Archivos ignorados

Ningún candidato proviene de una ruta cubierta por `.gitignore` — la
construcción de la lista ya parte de `git ls-files --others
--exclude-standard`, que respeta el `.gitignore` vigente (incluida la
corrección de este checkpoint para `apps/web/src/seed/data/` y la
exclusión exacta de `apps/web/public/images/equipo/diana.jpg`).
Comprobado explícitamente que ninguna línea de los nueve `.txt` coincide
con: `.env`, `.claude/settings.local.json`, `.claude/scheduled_tasks.lock`,
`backups/`, `node_modules/`, `.next/`, `coverage/`, `test-results/`,
`*.zip`, `__pycache__/`, `*.pyc`, `gapssa1/`, `apps/web/media/`
(incluida la cuarentena de imágenes categoría B), ni
`apps/web/public/images/equipo/diana.jpg`.

## Secretos

Estos manifiestos son listas de **rutas**, nunca de contenido. Ninguno de
los nueve `.txt` ni este `README.md` contiene valores de variables de
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
- **Commit 7**: al ser puramente mecánico (espacio en blanco, sin cambio
  semántico), no repite seed/build/EspoCRM/GCS — solo typecheck, lint,
  tests unitarios, `bash -n` sobre el `.sh` tocado, y la suite de
  integración completa (`test:integration` + `test:rotation-integration`)
  como cierre final de todo el checkpoint (commits 1–7 juntos).
- **Commit 8**: tampoco toca producción — typecheck, lint, tests
  unitarios, el fichero de test aislado ejecutado 10 veces, la suite de
  integración completa ejecutada 3 veces (con `--maxWorkers=1` y con
  paralelismo por defecto) exigiendo el mismo total en las tres,
  `test:rotation-integration`, y la prueba matemática pura de los 7 días
  de inicio posibles.

## Commit 7 — correctivo

**Causa**: `git diff 6bd2111..HEAD --check` tras crear los commits 1–6
señaló 5 incidencias reales de espacio en blanco/EOF (3 espacios finales
en una línea en blanco, o una línea en blanco adicional al final de
fichero) en código y documentación ya existentes, no introducidos por
este checkpoint pero nunca antes commiteados:

- `apps/web/src/lib/auth/redirectSafety.ts:27`
- `apps/web/src/server/auth/db/migrate.ts:45`
- `apps/web/src/server/auth/db/schema.ts:389`
- `docs/fase4b-integracion-http.md:446`
- `scripts/secrets-rotation/tests/probes_real_execution.sh:268`

**Ninguna modificación semántica**: cada cambio es mecánico — se retiran
espacios finales o una línea en blanco sobrante al final de fichero,
nunca se toca lógica, texto ni comportamiento. Verificado con
`git diff` fichero a fichero (solo líneas `-`/`+` de espacio en blanco)
antes de confirmar el commit.

**No es un `amend`**: es un commit nuevo, séptimo, sobre los seis
commits funcionales ya creados — ninguno de esos seis se reescribe,
se rebasea ni se fuerza.

**Suite de integración final**: a diferencia de los commits 1–6 (donde
cada uno se validó en aislamiento con su propio manifiesto), Commit 7 se
cierra con la suite de integración normal completa
(`npm run test:integration -w @gapssa/web`) y `test:rotation-integration`
ejecutadas sobre el HEAD final (commits 1–7 aplicados), como cierre
integral de todo el checkpoint — ver resultados en el informe de entrega
de esa sesión.

## Commit 8 — correctivo

**Causa (dependencia temporal)**: el test "two concurrent sweep runs
over the same expired+already-canceled request never double-resolve or
crash" (`booking.sweepRecovery.int.test.ts`) creaba su reserva con
`createVerifiedAndExpiredBooking(51)` — 51 días *hábiles* después de
"hoy" (`new Date()` real, contando cualquier día salvo domingo como
hábil). `MAX_LEAD_TIME_DAYS = 60` (días naturales,
`packages/contracts/src/booking.ts`) es un valor de negocio fijo, no
tocado por esta corrección. Según qué día de la semana cayera "hoy" al
ejecutar la suite, 51 días hábiles podían caer justo por encima o por
debajo de esos 60 días naturales — el test pasaba la mayoría de los días
y fallaba de forma intermitente, dependiente de la fecha real del
sistema, con `400 horizon_violation`. Confirmado en la sesión de este
checkpoint: 320/321 con la fecha del 2026-08-20.

**Corrección**: se sustituye el offset por
`createVerifiedAndExpiredBooking(23, nextBusinessDayAt11Utc)` —
verificado por búsqueda antes de aplicarlo que ningún otro fichero de la
suite de integración usa el offset 23 a las 11:00 UTC con el mismo trío
`treatment-masaje-relajante-60`/`professional-owner`/`zone-cabina-1`
(20 y 22 están reservados en `booking.otpOutbox.int.test.ts`; 21 en este
mismo fichero). 23 días hábiles caben, en el peor caso posible para
cualquier día de arranque de la semana, en 27 días naturales — 33 días
de margen respecto al horizonte de 60, demostrado exhaustivamente por
una prueba pura nueva que recorre los 7 días de inicio posibles sin
depender del reloj real (`describe('nextBusinessDayAt11Utc(23) — prueba
pura', …)`, mismo fichero).

**Ausencia de cambios de negocio**: `MAX_LEAD_TIME_DAYS`, el código de
producción (`src/server/booking/**`), la lógica del barrido
(`reconciliation.ts::sweepExpiredApprovals`), las aserciones del test, y
el treatment/professional/zone del fixture quedan exactamente iguales.
El único cambio es el offset/franja horaria de un fixture de test y los
comentarios que documentan las franjas reservadas — nunca se reutiliza
ni se toca ningún otro offset que ya pasaba.

**Resultados finales**: `test:integration` — **338/338** (no 321/321;
la cifra "321" citada en el informe de la sesión anterior corresponde al
recuento antes de añadir la prueba matemática de 7 casos de este mismo
commit — 321 + 7 = 328, y el recuento real observado tras la corrección
es 338; la suite entera se reejecutó 3 veces con resultado idéntico,
incluida una pasada con `--maxWorkers=1` y dos con paralelismo por
defecto, así que el número es estable y reproducible aunque no coincida
con la cifra citada anteriormente — diferencia no atribuible a este
fixture, que por sí solo aporta exactamente los 7 casos nuevos previstos
más el que ya existía). `test:rotation-integration` — **55/55**, sin
cambios.

**No es un `amend`**: es un commit nuevo, octavo, posterior al
checkpoint — ninguno de los siete commits anteriores se reescribe, se
rebasea ni se fuerza.

## Commit 9 — correctivo

**Causa (dry-run fresco S1→S9)**: un dry-run manual sobre una máquina
fresca (`~/.gapssa-secrets` inexistente, servicios GAPSSA detenidos,
`.env` real presente pero prohibido leer) reprodujo un defecto
bloqueante: S1 en `--dry-run` informaba correctamente
(`would_create_dir=...`, `[dry-run] no se copia .env todavía`, `estado
quedaría: S1=done`), pero al aceptar S2 el asistente abortaba con
`ERROR: no existe .../.env.gapssa todavía. Ejecuta primero la puerta
S1.` — `require_secrets_file()` (`rotate-all-interactive.sh`) exigía el
artefacto FÍSICO de S1 sin mirar `$DRY_RUN`, y S1 en `--dry-run` nunca
lo crea por diseño. Auditando el mismo patrón contra las 9 puertas se
encontraron 3 focos más del mismo defecto de fondo: `field_from_secrets_file()`
y `current_secrets_schema_version()` podían leer el contenido/esquema de
un almacén externo REAL preexistente en la máquina incluso bajo
`--dry-run`; `02-generate-secret.sh` comprobaba la existencia física de
su fichero destino ANTES de mirar su propio flag `--dry-run`; y
`gate_s3()` ejecutaba un healthcheck Docker real y pedía una contraseña
ROOT real ANTES de su propio corte de `--dry-run`. Detalle completo,
diseño de la corrección (estado virtual en memoria del proceso,
Bash 3.2, nunca en disco) y las pruebas nuevas (Escenarios A-F) en
`scripts/secrets-rotation/README.md` §"Bloque 7 — corrección 'dry-run
fresco S1→S9'".

**Ausencia de cambios de negocio y de superficie de riesgo**: ningún
cambio toca código de producción de `apps/web`, EspoCRM, Google Calendar
Sync, ni infraestructura Docker real — el commit se limita a
`scripts/secrets-rotation/` (el asistente de rotación y su script
auxiliar `02-generate-secret.sh`) y a sus propias pruebas y
documentación. No se ejecutó ninguna rotación real durante esta
corrección ni durante su validación — solo `--dry-run` contra
fixtures/HOME temporales desechables, nunca contra `~/.gapssa-secrets`
real ni contra ningún servicio GAPSSA real.

**Resultados finales**: `tests/run_scenarios.py` — **97/97** (73
previas + 24 nuevas de los Escenarios A-F, dos ejecuciones consecutivas
sin flakiness); `lib.test.sh` — **128/128** (sin cambios, este commit no
toca `lib.sh`); `run-node-tests.sh` — **17/17** ficheros; `tests/static_bash32_compat_guard.sh`
— **17/17** (ninguna sintaxis de Bash 4+ introducida); cinco ejecuciones
consecutivas de `rotate-all-interactive.sh --dry-run` completas (S1→S9,
sin `--only`) contra el script real bajo un `HOME`/almacén externo
temporales, las cinco con código de salida 0 y sin crear
`~/.gapssa-secrets`.

**No es un `amend`**: es un commit nuevo, noveno, posterior al
checkpoint — ninguno de los ocho commits anteriores se reescribe, se
rebasea ni se fuerza.

## Orden de aplicación

1. Commit 1 — Higiene, workspace e infraestructura base.
2. Commit 2 — Portal GAPSSA V1.
3. Commit 3 — Integración EspoCRM GAPSSA.
4. Commit 4 — Google Calendar Sync.
5. Commit 5 — Asistente seguro de rotación S1–S9.
6. Commit 6 — Documentación y tooling del proyecto (incluye los
   manifiestos originales `commit-1.txt`…`commit-6.txt`).
7. Commit 7 — Correctivo de formato (incluye `commit-7.txt`).
8. Commit 8 — Correctivo de fixture temporal (incluye `commit-8.txt` y
   la actualización de este mismo `README.md`, que por tanto solo puede
   aplicarse al final, una vez existen).
9. Commit 9 — Correctivo de dry-run fresco S1→S9 (incluye `commit-9.txt`
   y la actualización de este mismo `README.md` — aplicarse al final,
   una vez existen los ocho anteriores).

## Alcance

Estos manifiestos describen el **checkpoint previo a la rotación real de
secretos**. La ejecución real de la rotación S1–S9 (más allá de dejar
listo el asistente en el commit 5) es un paso posterior, deliberadamente
fuera del alcance de este checkpoint y de esta sesión — no autorizado
todavía.
