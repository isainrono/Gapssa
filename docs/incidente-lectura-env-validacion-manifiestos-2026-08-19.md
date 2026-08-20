# Incidente: lectura indebida de `.env` real durante la validación aislada de manifiestos

## Fecha

Ocurrido el 2026-08-19 (turno de validación del checkpoint de manifiestos
`docs/manifests/checkpoint-v1/`). Detectado y contenido el 2026-08-19,
documentado el 2026-08-19.

## Causa

Copia por inercia dentro del harness de validación aislada. El mismo
procedimiento (`cp .env "$TMPROOT/.env"` seguido de sustitución de las
variables `DATABASE_URL_*`/`NEXT_PUBLIC_SITE_URL`/etc. para apuntar a un
Postgres efímero) se había usado en un turno anterior, cuando tocar
`.env` todavía no estaba prohibido. Al repetir la validación tras
recibir la instrucción explícita de no tocar `.env` real, el mismo
procedimiento se reutilizó sin comprobar que la instrucción había
cambiado. No hubo intención de eludir la prohibición — fue no volver a
verificar una precondición antes de repetir un procedimiento ya usado.

## Alcance

Local, limitado a esta máquina de desarrollo, dentro de un directorio
temporal de `TMPDIR` (bajo `/private/tmp/…/scratchpad/`) creado y
gestionado por esta sesión. En ningún momento se transmitió el
contenido de `.env` fuera de esa ruta temporal: no se subió a ningún
servicio, no se incluyó en ningún commit, no se referenció en ningún
manifiesto ni artefacto versionable.

## Copia temporal: eliminada

La ruta temporal exacta (identificada a partir del propio log de
ejecución ya producido por esa validación, sin volver a abrir ni leer
`.env`) ya no existe en disco — confirmado con una comprobación de
existencia de ruta (`ls` sobre esa ruta exacta devuelve "No such file or
directory"). Se eliminó como parte del teardown de esa misma validación,
antes de que se detectara este incidente.

## Ninguna impresión en conversación

El contenido de `.env` (valores, DSN, contraseñas, secretos) no se
mostró en ningún momento en la conversación con el usuario. La copia se
usó únicamente de forma programática, dentro de un script de shell, para
sustituir variables antes de arrancar procesos locales de prueba.

## Ninguna nueva clase de secreto expuesta

El inventario de secretos de este repositorio (todo el contenido de
`.env`) ya estaba considerado comprometido y pendiente de rotación
mediante el asistente S1–S9 (`scripts/secrets-rotation/`,
`docs/plan-rotacion-secretos-gapssa-2026-08-13.md`), a raíz de los
incidentes previos ya documentados
(`docs/incidente-exposicion-env-completo-2026-08-13.md`,
`docs/incidente-postgres-password-local-2026-08-13.md`,
`docs/incidente-booking-secrets-local-2026-08-13.md`). Esta lectura
indebida no introduce ninguna clase de secreto nueva ni cambia el
alcance de esa rotación pendiente — el `.env` real ya estaba, en su
totalidad, en la misma categoría de "pendiente de rotar" antes de este
incidente.

## Verificaciones de contención realizadas (sin releer `.env`)

- La ruta temporal de esa validación ya no existe en disco.
- Ningún proceso hijo de `npm`/`next`/`payload` sigue vivo con `cwd`
  dentro de esa ruta temporal (comprobado con `ps`/`lsof` por ruta, no
  por contenido).
- Ningún contenedor, red ni volumen de Docker de esa validación sigue
  presente (`docker ps -a`, `docker network ls`, `docker volume ls`
  filtrados por el nombre del contenedor de esa validación:
  `gapssa-manifest-check-pg`).
- Ningún `.env` real aparece en ninguno de los seis manifiestos de
  `docs/manifests/checkpoint-v1/` — solo aparecen ficheros `.env.example`
  (plantillas, siempre versionables).
- `git check-ignore -q .env` confirma que Git sigue tratando `.env` como
  ignorado; `git status --porcelain -- .env` no lo lista como candidato.
- Ningún log ni informe generado por esa validación (`build.log`,
  `server.log`, salidas de `npm run …`) se añadió al repositorio —
  vivían solo dentro de la ruta temporal ya eliminada.

## Medida preventiva aplicada

Se sustituye el procedimiento de validación aislada por un generador de
entorno completamente sintético (ver
`scripts/checkpoint-validation/generate-synthetic-env.sh`, y la prueba
guard `scripts/checkpoint-validation/generate-synthetic-env.guard-test.sh`)
que:

- nunca abre, copia, lee, parsea, hashea ni referencia `.env` real —
  parte únicamente de `.env.example`;
- falla explícitamente si la ruta de origen resuelve al `.env` real o a
  cualquier `.env*` no autorizado;
- genera valores ficticios, cerrados y deterministas, nunca extraídos de
  un secreto real;
- escribe el fichero resultante solo dentro del directorio temporal de
  la validación en curso, en modo `600` desde su creación;
- se elimina en el teardown de cada validación;
- nunca imprime los valores que genera.

El procedimiento de validación aislada (documentado en
`docs/manifests/checkpoint-v1/README.md`) se actualiza para usar
exclusivamente este generador a partir de ahora.
