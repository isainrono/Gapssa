#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")/.."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm tail -n 25 /var/www/html/data/logs/espo-$(date +%Y-%m-%d).log
