#!/usr/bin/env bash

set -uo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

echo "=========================================================="
echo "=== 1. ESTADO DE CONTENEDORES DOCKER ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml ps

echo -e "\n=========================================================="
echo "=== 2. CHEQUEO DIRECTO DE ESPOCRM (app-check) ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm bin/command app-check || echo "app-check falló"

echo -e "\n=========================================================="
echo "=== 3. PETICIÓN HTTP LOCAL A ESPOCRM (puerto 8081) ==="
echo "=========================================================="
curl -sv -m 5 http://127.0.0.1:8081/api/v1/App/user 2>&1 | head -n 25 || echo "curl a 8081 falló"

echo -e "\n=========================================================="
echo "=== 4. SINTAXIS Y VALIDEZ DE data/config.php ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -l /var/www/html/data/config.php || echo "Error sintaxis config.php"

echo -e "\n=========================================================="
echo "=== 5. ÚLTIMOS ERRORES DE APACHE (error.log) ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm tail -n 30 /var/log/apache2/error.log || echo "No se pudo leer apache error.log"

echo -e "\n=========================================================="
echo "=== 6. ÚLTIMOS LOGS DE ESPOCRM DE HOY ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm tail -n 40 /var/www/html/data/logs/espo-$(date +%Y-%m-%d).log || echo "No se pudo leer log de espo"

echo -e "\n=========================================================="
echo "=== 7. LOGS DEL CONTENEDOR WEB (BFF NEXT.JS) ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml logs --tail 40 web

echo -e "\n=========================================================="
echo "=== 8. PRUEBA DE CARGA DE TRATAMIENTOS DESDE EL WEB ==="
echo "=========================================================="
docker compose --env-file .env.production -f compose.prod.yml exec -T web node -e '
fetch("http://espocrm/api/v1/CTratamiento?select=id,name,activo", {
  headers: { "X-Api-Key": process.env.ESPO_API_KEY || "" }
})
.then(async r => {
  console.log("Status CTratamiento:", r.status);
  const text = await r.text();
  console.log("Respuesta:", text.slice(0, 300));
})
.catch(e => console.error("Fallo fetch a espocrm:", e.message));
' || echo "Prueba desde web falló"
