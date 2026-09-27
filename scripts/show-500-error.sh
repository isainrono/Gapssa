#!/usr/bin/env bash

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=== 1. Últimas líneas del log de EspoCRM (Error 500 exacto) ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm sh -c '
log_file=$(ls -t /var/www/html/data/logs/*.log 2>/dev/null | head -n1)
if [ -n "$log_file" ]; then
    echo "Archivo de log: $log_file"
    tail -n 60 "$log_file"
else
    echo "No hay archivos de log en data/logs"
fi
'

echo -e "\n=== 2. Últimas líneas del log de Apache en EspoCRM ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm tail -n 40 /var/log/apache2/error.log 2>/dev/null || true
