# Incidente — exposición y rotación de `POSTGRES_PASSWORD` (entorno local, 2026-08-13)

**Fecha**: 2026-08-13 (UTC, ventana aproximada 12:40–17:00).
**Credencial afectada**: contraseña del rol PostgreSQL local `gapssa_apps`
(variable `POSTGRES_PASSWORD` y las tres cadenas `DATABASE_URL_AUTH` /
`DATABASE_URL_BOOKING` / `DATABASE_URL_CMS` que la incorporan).
**Clasificación**: credencial de entorno de desarrollo local, nunca
publicada, nunca de producción, nunca de un sistema de terceros.

> **ACTUALIZACIÓN (2026-08-13, más tarde la misma sesión) — CIERRE
> SUPERSEDED.** La contraseña rotada en este documento quedó ella misma
> expuesta de nuevo por una notificación automática del harness al editar
> `.env` para un incidente posterior — ver
> `docs/incidente-exposicion-env-completo-2026-08-13.md`. El análisis y la
> rotación descritos aquí siguen siendo correctos y válidos como
> referencia técnica, pero **no bastan como cierre**: la credencial actual
> vuelve a estar comprometida y requiere una rotación adicional siguiendo
> la puerta **S2** de `docs/plan-rotacion-secretos-gapssa-2026-08-13.md`,
> ejecutada fuera del harness. Este historial no se modifica ni se borra.

## 1. Qué ocurrió

Durante una sesión de trabajo sobre la Puerta 5B-2B (no relacionada con
esta credencial), una serie de comandos de inspección de `.env` y de
`.claude/settings.local.json` imprimieron el valor en texto plano en la
transcripción de la conversación:

1. `grep -iE "DATABASE_URL|POSTGRES" .env` — sin excluir la línea
   `POSTGRES_PASSWORD`.
2. Un intento de redacción con `sed` mal construido sobre
   `.claude/settings.local.json`, que en vez de ocultar el valor lo
   imprimió 7 veces adicionales.
3. Un barrido de verificación (`grep -rEno` sobre el patrón `PGPASSWORD=`)
   que imprimió el valor una vez más en bruto en lugar de compararlo por
   hash.

En total, la contraseña anterior apareció **tres veces** en la
transcripción de esta conversación, todas por errores de comandos de
inspección, ninguna por diseño.

## 2. Alcance real confirmado

- **Consumidores en `.env`** (4 líneas): `POSTGRES_PASSWORD`,
  `DATABASE_URL_AUTH`, `DATABASE_URL_BOOKING`, `DATABASE_URL_CMS` — las
  tres bases (`gapssa_auth`, `gapssa_booking`, `gapssa_cms`) comparten el
  mismo rol y la misma contraseña (rol único a nivel de clúster
  PostgreSQL, no por base).
- **Apariciones históricas en `.claude/settings.local.json`**: 7 entradas
  de permisos con la credencial incrustada en texto plano (6 en forma de
  URL `postgresql://gapssa_apps:<credencial>@...` dentro de comandos
  `psql`/`migrate.ts` de sesiones de depuración anteriores, 1 en forma de
  prefijo `PGPASSWORD=<credencial>`). Confirmado por conteo exacto tras
  análisis interno del JSON, sin imprimir valores.
- **Git e historial**: `.env` y `.claude/settings.local.json` nunca
  estuvieron trackeados (`git ls-files` vacío para ambos) y la credencial
  anterior no aparece en ningún commit de ningún branch
  (`git log --all -p` sin coincidencias). Cero exposición en el
  repositorio remoto.
- **Fuera de GAPSSA**: sin reutilización — la credencial no aparece en
  `infra/facturascripts/.env`, `integrations/n8n/.env` ni en ningún
  `.env.example`. EspoCRM/MariaDB, Redis, Google OAuth, SMTP, n8n y
  FacturaScripts usan credenciales independientes, no tocadas.

## 3. Rotación ejecutada

- Backup estructural (solo esquema, sin datos ni `.env`) en
  `backups/postgres-rotation/20260813T124649Z/` (ruta ignorada por Git):
  volcado `--schema-only` de las tres bases, lista de roles, lista de
  bases, conteos de filas por tabla.
- Contraseña nueva generada con `openssl rand -hex 32` (256 bits de
  entropía, CSPRNG), nunca impresa ni registrada en ningún archivo salvo
  `.env`.
- `ALTER ROLE gapssa_apps WITH PASSWORD ...` ejecutado vía conexión local
  por socket Unix dentro del contenedor `gapssa-apps-db-1` (el propio rol
  es superusuario, confirmado antes de rotar) — sin necesidad de una
  credencial administrativa distinta. Confirmado por la respuesta literal
  `ALTER ROLE` del servidor.
- `.env` actualizado (4 líneas) y verificado internamente coherente: la
  misma contraseña nueva en las 4 variables, tras decodificar cada
  `DATABASE_URL_*` y comparar usuario/host/puerto/base/contraseña
  componente a componente.

## 4. Eliminación de secretos de `.claude/settings.local.json`

No se sustituyó la contraseña anterior por la nueva dentro de las reglas
de permisos (habría dejado un secreto nuevo incrustado). Se eliminaron
las **7 entradas** que contenían credenciales literales:

- 6 entradas de tipo URL PostgreSQL con credencial (`postgresql://gapssa_apps:...@...`).
- 1 entrada de tipo `PGPASSWORD=...`.

No existía una sustitución segura razonable (el mecanismo de permisos de
Claude Code no admite inyección de credenciales en tiempo de ejecución sin
literal), así que se optó por eliminar en vez de conservar un secreto.
JSON validado como sintácticamente correcto tras la edición
(210 → 203 entradas). Verificación posterior (análisis interno, sin
imprimir valores): 0 ocurrencias de contraseña anterior, 0 de contraseña
nueva, 0 de patrón URL con credencial, 0 de `PGPASSWORD` literal.

## 5. Verificación positiva real

Dado que el host no tiene `psql` instalado, un primer intento de
verificación (contra `localhost:5433` desde el host) falló de forma
silenciosa por binario inexistente, no por una prueba de autenticación
real — ese resultado se descartó explícitamente por inválido.

Verificación válida ejecutada mediante un contenedor `postgres:18-alpine`
efímero (`docker run --rm --network gapssa_apps-private`), conectando al
servicio `apps-db` por su nombre de red Docker (no por `127.0.0.1`, ya que
`pg_hba.conf` tiene una regla `trust` explícita para conexiones desde
`127.0.0.1/32` y `::1/128` — usar esa ruta habría dado un falso positivo).
Esa ruta de red no-loopback cae bajo la regla `host all all all
scram-sha-256`, que exige contraseña real.

- Credencial inyectada mediante archivo `.pgpass` temporal, modo `600`,
  nunca como argumento visible ni variable de entorno con el valor
  literal en la línea de comandos.
- `gapssa_auth`: conexión autenticada válida, `current_user = gapssa_apps`.
- `gapssa_booking`: ídem.
- `gapssa_cms`: ídem.
- Archivo `.pgpass` temporal eliminado y su ausencia confirmada tras la
  prueba.

## 6. Estado de la comprobación directa de la contraseña anterior

`old_credential_direct_retest = not_performed`.

No se conservó ninguna copia segura de la contraseña anterior antes de
rotar (no se guardó en ningún archivo temporal para este fin), y esta
sesión decidió explícitamente **no reconstruirla desde la transcripción**
para no volver a introducirla en ningún sistema. En su lugar, la evidencia
de que ya no es válida es indirecta pero completa:

- `ALTER ROLE` se confirmó ejecutado con éxito — por construcción,
  PostgreSQL sustituye el hash de la contraseña de forma atómica, por lo
  que la anterior deja de poder autenticar desde ese momento.
- La contraseña nueva es estructuralmente distinta (64 caracteres
  hexadecimales en minúscula, generada por `openssl rand -hex 32`) de la
  anterior (32 caracteres alfanuméricos de un generador distinto).
- La autenticación TCP con la contraseña nueva funcionó correctamente
  contra las tres bases, por la ruta de red real (no loopback) que exige
  `scram-sha-256`.
- Se confirmó que no existe una segunda regla `trust` que invalide esa
  prueba (la única regla `trust` aplica a `127.0.0.1`/`::1`/socket local,
  deliberadamente evitada).
- Cero consumidores conservan la contraseña anterior en disco (barrido de
  residuos, §8).

## 7. Reinicio de consumidores

Único consumidor de larga duración identificado: el proceso `next dev` de
`apps/web` (árbol de procesos raíz `npm run dev`, PID previo `45671`,
adjunto a la terminal interactiva `ttys002` del usuario, puerto `3000`,
directorio de trabajo `/Users/isainrodrigueznorena/Isain/Gapssa`).

- `SIGTERM` al proceso raíz — salida limpia confirmada, puerto `3000`
  liberado, sin necesidad de escalar a `SIGKILL`.
- Reiniciado con el mismo comando (`npm run dev` desde la raíz del repo,
  que internamente ejecuta `dotenv -e .env -- npm run dev -w
  @gapssa/web`), mismo directorio de trabajo, mismo puerto — ahora como
  proceso desacoplado de la terminal original (huérfano bajo `PPID=1`),
  sin ninguna variable mostrada.
- Ningún seed ni migración ejecutados. `ESPO_BOOKING_ADAPTER` no se tocó
  en ningún momento (permanece `simulated`, confirmado tras el reinicio).
- No se reinició ni afectó ningún proceso ni contenedor de EspoCRM.

## 8. Salud final

| Comprobación | Resultado |
|---|---|
| Proceso principal nuevo activo | Sí (`next-server`, puerto 3000 en LISTEN) |
| `GET /api/health/live` | `200` |
| `GET /api/health` | `200`, `{"checks":{"app":"ok","postgresCms":"ok","redis":"ok"},"status":"ok"}` |
| `ESPO_BOOKING_ADAPTER` runtime | `simulated` (sin cambio) |
| Conexión app → `gapssa_cms` | Confirmada por `/api/health` |
| Conexión app → `gapssa_auth`/`gapssa_booking` | No hay endpoint de salud dedicado para estas dos bases; confirmado indirectamente (arranque sin fallo de `parseServerEnv`/conexión, mismo rol verificado directamente en §5) — no se realizó login con cuenta real para evitar PII |
| Payload CMS | Accesible (log de arranque: "Pulling schema from database... ✓") |
| Redis | `ok` (vía `/api/health`) |
| `app-check` EspoCRM | 4/4 verde (migración, base de datos, sin mantenimiento, cron activo) |
| `Meeting` (activos/soft-deleted/total) | `7`/`6`/`13` — sin cambio |
| `Contact` activos | `1` — sin cambio |
| ACL `Portal GAPSSA API` (`Meeting.create/delete`) | `yes`/`no` — sin cambio, sin ventana abierta |
| Proceso temporal de 5B-2B | Ninguno (nunca se llegó a iniciar) |
| Reserva/Contact/Meeting de prueba creados | Ninguno |

## 9. Impacto en datos

Ninguno. Ninguna migración, ninguna escritura de esquema, ninguna fila
modificada en `gapssa_auth`/`gapssa_booking`/`gapssa_cms` ni en EspoCRM.
Todas las consultas de verificación fueron de solo lectura
(`SELECT 1`/`SELECT current_user`).

## 10. Estado de 5B-2B

**No iniciada.** Esta sesión se limitó exclusivamente a la contención y
cierre del incidente de la contraseña. Ningún paso de 5B-2B (cuenta
ficticia, proceso HTTP aislado, ventana ACL, reserva real) se ejecutó.
Queda pendiente de una autorización explícita y separada, como ya estaba
antes del incidente.

## 11. Medidas preventivas

- Prohibido `grep`/`rg`/`cat` directo (sin redacción garantizada) sobre
  archivos que puedan contener secretos (`.env`, `.claude/settings*.json`,
  cualquier archivo con `PASSWORD`/`_KEY`/`_SECRET`/`_TOKEN` en sus
  variables). Usar exclusivamente scripts que lean el contenido
  internamente y emitan solo nombres de archivo, conteos o booleanos.
- No incluir credenciales literales en reglas de permisos de
  `.claude/settings*.json` — si un comando concreto necesita
  autorizarse, debe hacerlo sin incrustar el valor (o no incrustarse en
  absoluto si no hay una forma segura de acotarlo).
- No aceptar el resultado de una prueba de autenticación cuyo binario no
  existe (verificar el código de salida y, si es "comando no encontrado",
  tratarlo como prueba no realizada, nunca como éxito o fracaso de la
  autenticación).
- Al probar credenciales rotadas contra PostgreSQL, verificar primero
  `pg_hba.conf` para descartar reglas `trust` que invaliden la prueba por
  la ruta de red usada.
- Rotación obligatoria e inmediata ante cualquier exposición confirmada de
  un secreto, incluso en un entorno estrictamente local.

## 12bis. Endurecimiento de permisos de `.env` (2026-08-13, continuación)

Antes de reanudar cualquier trabajo de 5B-2B se corrigió el permiso
inseguro señalado en §2 de este documento:

- Confirmado por script interno (sin imprimir contenido): `.env` es un
  archivo regular (no symlink), propiedad del usuario esperado, ignorado
  por Git.
- Modo cambiado `644` → `600` (`os.chmod`, sin tocar contenido).
- Hash SHA-256 del contenido idéntico antes y después del cambio de
  permiso (confirma que ninguna escritura alteró el archivo).
- Proceso principal (`apps/web`) re-verificado sano tras el cambio (§ ver
  Fase 1 de la reanudación de 5B-2B, mismo día) — un cambio de permisos de
  archivo no requiere reiniciar el proceso que ya lo tiene abierto.

## 12. Archivos modificados (sin valores)

| Archivo | Cambio |
|---|---|
| `.env` | `POSTGRES_PASSWORD` y las 3 `DATABASE_URL_*` rotados a la nueva credencial; permiso endurecido `644`→`600` (contenido byte-idéntico, confirmado por SHA-256) |
| `.claude/settings.local.json` | 7 entradas de permisos con credenciales literales eliminadas (210 → 203) |
| `backups/postgres-rotation/20260813T124649Z/*.sql`, `roles.txt`, `databases.txt`, `table-counts.txt` | Backup estructural nuevo (solo esquema/metadatos, sin secretos, ruta ignorada por Git) |
| `docs/incidente-postgres-password-local-2026-08-13.md` | Este documento (nuevo) |

Ningún archivo de EspoCRM, extensión GCS, `apps/web` (código), n8n ni
FacturaScripts modificado. Cero commits.
