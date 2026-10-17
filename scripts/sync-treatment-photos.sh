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
echo "==> 4.6. Sincronizando plantillas de correo de confirmación e isotipo en EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml cp extensions/espocrm/custom/Espo/Custom/. espocrm:/var/www/html/custom/Espo/Custom/
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm chown -R www-data:www-data /var/www/html/custom
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php bin/command rebuild || true
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm rm -rf /var/www/html/data/cache/application/ || true

echo ""
echo "==> 4.7. Configurando columnas de recordatorios y tarea programada (24h y 2h) en EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF' || true
<?php
try {
    require_once "/var/www/html/bootstrap.php";
    $app = new \Espo\Core\Application();
    $container = $app->getContainer();
    $em = $container->get("entityManager");
    $pdo = $em->getPDO();

    $user = $em->getRDBRepository('User')->where(['userName' => 'admin'])->findOne();
    if ($user) {
        $container->set('user', $user);
    }

    // 1. Columnas en la tabla meeting
    $pdo->exec("ALTER TABLE meeting ADD COLUMN IF NOT EXISTS c_recordatorio24h_enviado TINYINT(1) NOT NULL DEFAULT 0");
    $pdo->exec("ALTER TABLE meeting ADD COLUMN IF NOT EXISTS c_recordatorio2h_enviado TINYINT(1) NOT NULL DEFAULT 0");
    echo "✔ Columnas c_recordatorio24h_enviado y c_recordatorio2h_enviado verificadas en MariaDB.\n";

    // 2. Reconstruir metadatos de EspoCRM
    if ($container->has('dataManager')) {
        $container->get('dataManager')->rebuild();
        echo "✔ Metadatos de EspoCRM reconstruidos.\n";
    }

    // 3. Crear o activar el ScheduledJob
    $job = $em->getRDBRepository('ScheduledJob')->where(['job' => 'SendAppointmentReminders'])->findOne();
    if (!$job) {
        $job = $em->getNewEntity('ScheduledJob');
        $job->set([
            'name' => 'GAPSSA — Enviar Recordatorios de Citas (24h y 2h)',
            'job' => 'SendAppointmentReminders',
            'status' => 'Active',
            'scheduling' => '*/10 * * * *',
        ]);
        $em->saveEntity($job);
        echo "✔ Tarea programada 'SendAppointmentReminders' creada (cada 10 min).\n";
    } else {
        $job->set('status', 'Active');
        $job->set('scheduling', '*/10 * * * *');
        $em->saveEntity($job);
        echo "✔ Tarea programada 'SendAppointmentReminders' activa (cada 10 min).\n";
    }

    // 4. Ejecución inicial de prueba
    try {
        $jobRunner = new \Espo\Custom\Jobs\SendAppointmentReminders($container);
        $jobRunner->run();
    } catch (\Throwable $ex) {
        echo "Aviso prueba recordatorios: " . $ex->getMessage() . "\n";
    }
} catch (\Throwable $e) {
    echo "Aviso configuración recordatorios: " . $e->getMessage() . "\n";
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
LEFT JOIN media m ON m.id = f.imagen_id
ORDER BY f.orden;
" || true

echo ""
echo "==> 7. Verificando fotos de la Galería en Payload..."
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_cms -c "
SELECT 
    g.orden,
    gl.categoria,
    m.filename AS imagen_filename
FROM galeria g
LEFT JOIN galeria_locales gl ON gl._parent_id = g.id AND gl._locale = 'es'
LEFT JOIN media m ON m.id = g.imagen_id
ORDER BY g.orden;
" || true

echo ""
echo "==> 8. Verificando Páginas Legales (Aviso, Privacidad, Cookies, Condiciones)..."
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_cms -c "
SELECT tipo, version, estado, seo_no_index FROM paginas_legales ORDER BY tipo;
" || true

echo ""
echo "==> 9. Verificando Dirección y Contacto Oficial en Ajustes Globales..."
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_cms -c "
SELECT direccion_calle, contacto_telefono, contacto_whatsapp, contacto_correo_publico FROM ajustes_globales;
" || true

echo ""
echo "=========================================================="
echo "    ¡ACTUALIZACIÓN COMPLETADA CON ÉXITO!                  "
echo "=========================================================="
