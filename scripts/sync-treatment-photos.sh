#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=========================================================="
echo "    SINCRONIZACIÓN DE FOTOS DE TRATAMIENTOS (GAPSSA)      "
echo "=========================================================="
echo ""

echo "==> 1. Recompilando contenedor Web con los nuevos activos optimizados..."
docker compose --env-file .env.production -f compose.prod.yml build web

echo ""
echo "==> 2. Levantando contenedor Web actualizado..."
docker compose --env-file .env.production -f compose.prod.yml up -d web

echo ""
echo "==> 3. Esperando que el servicio Web esté listo..."
sleep 6

echo ""
echo "==> 4. Ejecutando seed de Media y Tratamientos en Payload CMS..."
docker compose --env-file .env.production -f compose.prod.yml exec -T -e ALLOW_SEED_IN_PRODUCTION=true web npm run seed -w @gapssa/web

echo ""
echo "==> 5. Verificando imágenes asignadas en la base de datos de Payload (Postgres)..."
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_cms -c "
SELECT 
    t.slug,
    COUNT(ti.media_id) AS num_imagenes,
    m.filename
FROM tratamientos t
LEFT JOIN tratamientos_imagenes ti ON ti._parent_id = t.id
LEFT JOIN media m ON m.id = ti.media_id
WHERE t.slug IN ('presoterapia', 'vacum', 'lipolaser-radiofrecuencia', 'masaje-relajante-pies', 'reflexologia-podal', 'mesoterapia-estetica', 'skinpen')
GROUP BY t.slug, m.filename
ORDER BY t.slug;
"

echo ""
echo "==> 6. Verificando portadas de familias en Payload..."
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_cms -c "
SELECT 
    f.slug,
    m.filename AS portada_filename
FROM familias_tratamiento f
LEFT JOIN media m ON m.id = f.imagen_id
ORDER BY f.orden;
"

echo ""
echo "=========================================================="
echo "    ¡FOTOS ACTUALIZADAS Y SINCRONIZADAS CON ÉXITO!        "
echo "=========================================================="
