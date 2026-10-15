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
echo "==> 4.5. Actualizando tarifa de SkinPen (250 €) en EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF' || true
<?php
try {
    require_once "/var/www/html/bootstrap.php";
    $app = new \Espo\Core\Application();
    $container = $app->getContainer();
    $em = $container->get("entityManager");

    $user = $em->getRDBRepository('User')->where(['userName' => 'admin'])->findOne();
    if ($user) {
        $container->set('user', $user);
    }

    $treatments = $em->getRDBRepository('CTratamiento')->find();
    foreach ($treatments as $t) {
        $name = $t->get('name');
        if (stripos($name, 'Skin') !== false) {
            $t->set('precioOrientativo', 250.0);
            $em->saveEntity($t);
            echo "✔ EspoCRM: " . $name . " actualizado a 250 €\n";
        }
    }
} catch (\Throwable $e) {
    echo "Aviso EspoCRM: " . $e->getMessage() . "\n";
}
PHP_EOF

echo ""
echo "==> 5. Verificando imágenes asignadas en la base de datos de Payload (Postgres)..."
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_cms -c "
SELECT 
    t.slug,
    m.filename
FROM tratamientos t
JOIN tratamientos_rels r ON r.parent_id = t.id AND r.path = 'imagenes'
JOIN media m ON m.id = r.media_id
WHERE t.slug IN ('presoterapia', 'vacum', 'lipolaser-radiofrecuencia', 'masaje-relajante-pies', 'reflexologia-podal', 'mesoterapia-estetica', 'skinpen', 'limpieza-facial-profunda', 'depilacion-ingles-normales')
ORDER BY t.slug;
" || true

echo ""
echo "==> 6. Verificando portadas de familias en Payload..."
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_cms -c "
SELECT 
    f.slug,
    m.filename AS portada_filename
FROM familias_tratamiento f
LEFT JOIN familias_tratamiento_rels fr ON fr.parent_id = f.id AND fr.path = 'imagen'
LEFT JOIN media m ON m.id = fr.media_id
ORDER BY f.orden;
" || true

echo ""
echo "==> 7. Verificando fotos de la Galería en Payload..."
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_cms -c "
SELECT 
    g.orden,
    g.categoria,
    m.filename AS imagen_filename
FROM galeria g
LEFT JOIN media m ON m.id = g.imagen_id
ORDER BY g.orden;
" || true

echo ""
echo "==> 8. Verificando Términos y Condiciones en Payload..."
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_cms -c "
SELECT tipo, version, estado, seo_no_index FROM paginas_legales WHERE tipo = 'condiciones-reserva';
" || true

echo ""
echo "=========================================================="
echo "    ¡ACTUALIZACIÓN COMPLETADA CON ÉXITO!                  "
echo "=========================================================="
