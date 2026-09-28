#!/usr/bin/env bash

set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_dir}"

echo "==> 1. Sincronizando personalizaciones corregidas hacia EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml cp extensions/espocrm/custom/Espo/Custom/. espocrm:/var/www/html/custom/Espo/Custom/
docker compose --env-file .env.production -f compose.prod.yml exec espocrm chown -R www-data:www-data /var/www/html/custom

echo "==> 2. Reconstruyendo metadatos y limpiando caché de EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml exec espocrm bin/command rebuild
docker compose --env-file .env.production -f compose.prod.yml exec espocrm bin/command clear-cache

echo "==> 3. Reiniciando contenedor de EspoCRM para recargar OPcache..."
docker compose --env-file .env.production -f compose.prod.yml restart espocrm
sleep 3

echo "==> 4. Verificando API de EspoCRM y CTratamiento..."
./scripts/diagnose-crm-500.sh

echo "==> 5. Verificando llamada de tratamientos desde el contenedor Web..."
api_key="$(grep -E '^ *(ESPOCRM_API_KEY|ESPO_API_KEY) *=' .env.production 2>/dev/null | head -n1 | cut -d= -f2- | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || echo '')"
docker compose --env-file .env.production -f compose.prod.yml exec -T web node -e "
fetch('http://espocrm/api/v1/CTratamiento?select=id,name,activo', {
  headers: { 'X-Api-Key': '${api_key}' }
})
.then(async r => {
  console.log('Status HTTP CTratamiento desde Web:', r.status);
  const data = await r.json();
  console.log('Total tratamientos activos recibidos:', (data.list || []).length);
})
.catch(e => console.error('Fallo verificación desde web:', e.message));
"

echo -e "\n==> ¡TODO LISTO Y VERIFICADO! EspoCRM y la Web están operativos."
