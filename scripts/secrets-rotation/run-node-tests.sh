#!/bin/bash
# Runner oficial, único y reproducible de TODAS las pruebas Node del
# asistente de rotación (`lib/*.test.mjs` + `start-apps-web.test.mjs`).
#
# Por qué existe: `node --test lib/*.test.mjs start-apps-web.test.mjs`
# (un solo proceso `node --test` con varios ficheros) ejecuta los
# ficheros EN PARALELO por defecto. Varias de estas pruebas levantan
# servidores TCP/HTTP reales en localhost (desechables, nunca contra
# infraestructura GAPSSA) — cuando dos ficheros distintos corren a la vez
# y alguno usa un puerto fijo en vez de uno efímero asignado por el SO,
# aparecen colisiones intermitentes que no reflejan ningún fallo real del
# código bajo prueba. Este runner ejecuta cada fichero de prueba en su
# propio proceso `node --test <fichero>`, UNO DETRÁS DE OTRO, nunca en
# paralelo — sin reintentos aleatorios que oculten una colisión real.
#
# Uso:
#   scripts/secrets-rotation/run-node-tests.sh
#
# Sale con 0 solo si TODOS los ficheros terminan en verde. Imprime un
# resumen final con el recuento de ficheros y aciertos/fallos.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

FILES="lib/backupSchema.test.mjs
lib/decideRecoveryPlan.test.mjs
lib/digestStream.test.mjs
lib/extractEnvValueFromStdin.test.mjs
lib/extractLiveEnvValueFromStdin.test.mjs
lib/fsyncPath.test.mjs
lib/orphanRestoreTmp.test.mjs
lib/recoverOldSecretValue.test.mjs
lib/redisVerify.test.mjs
lib/secretClassification.test.mjs
lib/secretValueContract.test.mjs
lib/updateRedisSecrets.test.mjs
lib/updateSecretsFileField.test.mjs
lib/validateProbeJson.test.mjs
lib/validateSecretsFileForBackup.test.mjs
lib/verifyEnvExample.test.mjs
lib/verifyEspoAclSnapshot.test.mjs
lib/writeRestorePayload.test.mjs
start-apps-web.test.mjs"

FILE_COUNT=0
FAIL_COUNT=0
FAILED_FILES=""

# Red de seguridad adicional: si algún test dejara un proceso node hijo
# vivo pese a su propio teardown, se termina aquí al salir del runner.
# No mata NADA que no haya arrancado este runner (PGID propio).
cleanup() {
  local rc=$?
  # Best-effort: matar el grupo de procesos de este script. No falla si
  # no hay nada que matar.
  pkill -P $$ 2>/dev/null || true
  exit "$rc"
}
trap cleanup EXIT

for f in $FILES; do
  FILE_COUNT=$((FILE_COUNT + 1))
  echo "=== $f ==="
  if node --test "$f"; then
    echo "--- $f: OK"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    FAILED_FILES="$FAILED_FILES $f"
    echo "--- $f: FALLÓ"
  fi
  echo ""
  # Deja drenar cualquier proceso hijo/descriptor todavía cerrándose del
  # fichero anterior antes de lanzar el siguiente subproceso node --test
  # pesado en subprocesos (openssl, servidores TCP desechables) — evita
  # presión de recursos acumulada entre ficheros consecutivos, no oculta
  # ningún fallo (cada fichero sigue evaluándose por su propio resultado).
  sleep 0.3
done

echo "============================================"
echo "RESUMEN: $FILE_COUNT ficheros ejecutados, $((FILE_COUNT - FAIL_COUNT)) OK, $FAIL_COUNT fallidos"
if [ "$FAIL_COUNT" -ne 0 ]; then
  echo "Ficheros fallidos:$FAILED_FILES"
  exit 1
fi
exit 0
