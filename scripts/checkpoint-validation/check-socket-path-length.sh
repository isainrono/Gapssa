#!/bin/bash
# Comprueba, ANTES de crear una copia aislada de un manifiesto, que la
# raíz temporal elegida deja margen suficiente para cualquier ruta de
# socket de dominio Unix que puedan crear las pruebas (algunas
# herramientas de test usan sockets Unix bajo el temporal, aunque el
# asistente de rotación en sí use sockets TCP en localhost — ver
# docs/manifests/checkpoint-v1/README.md, sección de estabilización del
# harness de Commit 5). No cambia ninguna lógica de producción: es una
# comprobación previa que hace fallar RÁPIDO y con mensaje saneado un
# directorio de ensayo con una ruta excesiva, en vez de dejar que un
# `bind()` falle más tarde con un error críptico de sistema operativo.
#
# Límite de `sockaddr_un.sun_path`: 104 bytes en macOS/BSD (incluido el
# terminador NUL -> 103 usables), 108 bytes en Linux (107 usables). Se
# usa 104 como límite conservador en cualquier plataforma.
#
# Uso:
#   check-socket-path-length.sh <ruta-raiz-candidata> [longitud-max-nombre-socket]
#
# Sale con 0 y no imprime nada si la ruta cabe con margen. Sale con 1 y un
# mensaje saneado (nunca imprime el contenido de la ruta si esta
# incluyera algo sensible — en la práctica solo son rutas de `$TMPDIR`,
# nunca secretos) si no cabe.
set -euo pipefail

# Límite duro del sistema (bytes, incluye terminador NUL).
readonly SUN_PATH_LIMIT=104

# Margen que dejamos para el propio nombre del socket que cree cualquier
# prueba dentro de esa raíz (p. ej. "redis.sock", más separadores de
# subdirectorios intermedios como "scripts/secrets-rotation/.tmp/"). Si
# una prueba futura necesitara un nombre de socket más largo, se pasa
# como segundo argumento.
DEFAULT_SOCKET_NAME_MARGIN=40

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "ERROR: uso: check-socket-path-length.sh <ruta-raiz-candidata> [longitud-max-nombre-socket]" >&2
  exit 1
fi

CANDIDATE_ROOT="$1"
SOCKET_NAME_MARGIN="${2:-$DEFAULT_SOCKET_NAME_MARGIN}"

root_len=${#CANDIDATE_ROOT}
max_allowed=$((SUN_PATH_LIMIT - SOCKET_NAME_MARGIN - 1))

if [ "$root_len" -gt "$max_allowed" ]; then
  echo "ERROR: la raíz temporal elegida es demasiado larga para dejar margen a un socket Unix (longitud=$root_len, máximo permitido=$max_allowed con margen=$SOCKET_NAME_MARGIN, límite de sistema sun_path=$SUN_PATH_LIMIT). Usa una raíz más corta, p. ej. bajo /tmp directamente (mktemp -d /tmp/gapssa-XXXXXX)." >&2
  exit 1
fi

echo "check-socket-path-length: ruta raíz válida (longitud=$root_len, margen restante=$((max_allowed - root_len)) bytes)."
exit 0
