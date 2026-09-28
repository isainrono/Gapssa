#!/usr/bin/env bash

set -u

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

echo "=== 1. COMPROBACIÓN DE PUERTOS PÚBLICOS Y LOCALES ==="
echo "--- A. Petición HTTPS pública a crm.gapssa.es ---"
curl -k -ILs -m 5 https://crm.gapssa.es | head -n 10 || echo "❌ Falló https://crm.gapssa.es"

echo "--- B. Petición HTTPS pública a gapssa.es ---"
curl -k -ILs -m 5 https://gapssa.es | head -n 10 || echo "❌ Falló https://gapssa.es"

echo "--- C. Petición local a Web Next.js (127.0.0.1:3050) ---"
curl -ILs -m 5 http://127.0.0.1:3050 | head -n 10 || echo "❌ Falló 127.0.0.1:3050"

echo "--- D. Petición local a EspoCRM (127.0.0.1:8081) ---"
curl -ILs -m 5 http://127.0.0.1:8081 | head -n 10 || echo "❌ Falló 127.0.0.1:8081"

echo -e "\n=== 2. ESTADO DEL SERVIDOR WEB DEL HOST (Nginx / Apache / Plesk) ==="
systemctl is-active nginx 2>/dev/null && echo "Nginx host: ACTIVO" || echo "Nginx host: INACTIVO o no instalado"
systemctl is-active apache2 2>/dev/null && echo "Apache host: ACTIVO" || echo "Apache host: INACTIVO o no instalado"

echo -e "\n=== 3. PUERTOS EN ESCUCHA EN EL HOST ==="
ss -tulpn | grep -E ':(80|443|8081|3050)\b' || netstat -tulpn 2>/dev/null | grep -E ':(80|443|8081|3050)\b'

echo -e "\n=== 4. FAIL2BAN (IPs bloqueadas) ==="
if command -v fail2ban-client &>/dev/null; then
    fail2ban-client status 2>/dev/null || echo "fail2ban no responde"
else
    echo "fail2ban no está instalado"
fi

echo -e "\n=== 5. ÚLTIMOS LOGS DE ESPOCRM HOY ==="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm tail -n 25 /var/www/html/data/logs/espo-$(date +%Y-%m-%d).log

echo -e "\n=== 6. ÚLTIMOS LOGS DE LA WEB (Next.js) ==="
docker compose --env-file .env.production -f compose.prod.yml logs --tail 25 web
