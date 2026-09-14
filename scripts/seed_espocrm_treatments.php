<?php
/**
 * Script de siembra (seed) del catálogo oficial de tratamientos en EspoCRM.
 * Ejecución segura e idempotente a través del EntityManager de EspoCRM.
 */

if (file_exists(__DIR__ . '/../bootstrap.php')) {
    require_once __DIR__ . '/../bootstrap.php';
} elseif (file_exists('/var/www/html/bootstrap.php')) {
    require_once '/var/www/html/bootstrap.php';
} else {
    require_once 'bootstrap.php';
}

$app = new \Espo\Core\Application();
$container = $app->getContainer();
$em = $container->get('entityManager');

$user = $em->getRDBRepository('User')->where(['userName' => 'admin'])->findOne();
if ($user) {
    $container->set('user', $user);
}

$treatments = [
    // ── 1. Masajes ──────────────────────────────────────────────────────────
    ['name' => 'Masaje relajante 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 40.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje relajante 60 min', 'familia' => 'Masajes', 'duracionMinutos' => 60, 'precioOrientativo' => 75.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje descontracturante 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 37.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje descontracturante 60 min', 'familia' => 'Masajes', 'duracionMinutos' => 60, 'precioOrientativo' => 70.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje deportivo 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 40.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje deportivo 60 min', 'familia' => 'Masajes', 'duracionMinutos' => 60, 'precioOrientativo' => 80.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje prenatal 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 40.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje prenatal 60 min', 'familia' => 'Masajes', 'duracionMinutos' => 60, 'precioOrientativo' => 70.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje de aromaterapia 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 37.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje de aromaterapia 60 min', 'familia' => 'Masajes', 'duracionMinutos' => 60, 'precioOrientativo' => 62.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje craneofacial 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 30.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje facial 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 37.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje piernas cansadas 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 37.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje relajante de pies 15 min', 'familia' => 'Masajes', 'duracionMinutos' => 15, 'precioOrientativo' => 20.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Reflexología podal 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 35.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Drenaje linfático manual 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 40.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Drenaje linfático manual 60 min', 'familia' => 'Masajes', 'duracionMinutos' => 60, 'precioOrientativo' => 69.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje con piedras calientes 30 min', 'familia' => 'Masajes', 'duracionMinutos' => 30, 'precioOrientativo' => 44.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Masaje con piedras calientes 60 min', 'familia' => 'Masajes', 'duracionMinutos' => 60, 'precioOrientativo' => 78.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Exfoliación corporal 45 min', 'familia' => 'Masajes', 'duracionMinutos' => 45, 'precioOrientativo' => 55.0, 'estadoPrecio' => 'Fijo'],

    // ── 2. Aparatología ──────────────────────────────────────────────────────
    ['name' => 'Presoterapia 45 min', 'familia' => 'Aparatología', 'duracionMinutos' => 45, 'precioOrientativo' => 50.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Presoterapia + masaje 50 min', 'familia' => 'Aparatología', 'duracionMinutos' => 50, 'precioOrientativo' => 60.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Sesión Lipoláser + Radiofrecuencia 60 min', 'familia' => 'Aparatología', 'duracionMinutos' => 60, 'precioOrientativo' => 100.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Reafirmante glúteos (Vacum) 30 min', 'familia' => 'Aparatología', 'duracionMinutos' => 30, 'precioOrientativo' => 50.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser fisio (dolor) 30 min', 'familia' => 'Aparatología', 'duracionMinutos' => 30, 'precioOrientativo' => 30.0, 'estadoPrecio' => 'Fijo'],

    // ── 3. Depilación ────────────────────────────────────────────────────────
    ['name' => 'Pinzas diseño 20 min', 'familia' => 'Depilación', 'duracionMinutos' => 20, 'precioOrientativo' => 20.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Pinzas cejas 15 min', 'familia' => 'Depilación', 'duracionMinutos' => 15, 'precioOrientativo' => 11.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Hilo cejas 15 min', 'familia' => 'Depilación', 'duracionMinutos' => 15, 'precioOrientativo' => 16.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Diseño hilo cejas 25 min', 'familia' => 'Depilación', 'duracionMinutos' => 25, 'precioOrientativo' => 25.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Hilo labio superior 10 min', 'familia' => 'Depilación', 'duracionMinutos' => 10, 'precioOrientativo' => 12.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Hilo mentón 10 min', 'familia' => 'Depilación', 'duracionMinutos' => 10, 'precioOrientativo' => 11.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Hilo rostro completo 30 min', 'familia' => 'Depilación', 'duracionMinutos' => 30, 'precioOrientativo' => 32.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera labio superior 10 min', 'familia' => 'Depilación', 'duracionMinutos' => 10, 'precioOrientativo' => 10.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera axilas 15 min', 'familia' => 'Depilación', 'duracionMinutos' => 15, 'precioOrientativo' => 15.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera abdomen 20 min', 'familia' => 'Depilación', 'duracionMinutos' => 20, 'precioOrientativo' => 20.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera brazos 30 min', 'familia' => 'Depilación', 'duracionMinutos' => 30, 'precioOrientativo' => 20.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera mentón 10 min', 'familia' => 'Depilación', 'duracionMinutos' => 10, 'precioOrientativo' => 10.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera espalda 30 min', 'familia' => 'Depilación', 'duracionMinutos' => 30, 'precioOrientativo' => 30.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera glúteos 20 min', 'familia' => 'Depilación', 'duracionMinutos' => 20, 'precioOrientativo' => 25.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera ingles brasileñas 25 min', 'familia' => 'Depilación', 'duracionMinutos' => 25, 'precioOrientativo' => 20.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera ingles normales 15 min', 'familia' => 'Depilación', 'duracionMinutos' => 15, 'precioOrientativo' => 16.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera ingles integrales 30 min', 'familia' => 'Depilación', 'duracionMinutos' => 30, 'precioOrientativo' => 30.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera pecho 25 min', 'familia' => 'Depilación', 'duracionMinutos' => 25, 'precioOrientativo' => 30.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera medias piernas 30 min', 'familia' => 'Depilación', 'duracionMinutos' => 30, 'precioOrientativo' => 20.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera piernas completas 45 min', 'familia' => 'Depilación', 'duracionMinutos' => 45, 'precioOrientativo' => 28.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera medios brazos 20 min', 'familia' => 'Depilación', 'duracionMinutos' => 20, 'precioOrientativo' => 15.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Cera perianal 15 min', 'familia' => 'Depilación', 'duracionMinutos' => 15, 'precioOrientativo' => 12.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser patillas 15 min', 'familia' => 'Depilación', 'duracionMinutos' => 15, 'precioOrientativo' => 11.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser mentón 15 min', 'familia' => 'Depilación', 'duracionMinutos' => 15, 'precioOrientativo' => 15.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser axilas 15 min', 'familia' => 'Depilación', 'duracionMinutos' => 15, 'precioOrientativo' => 20.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser espalda completa 30 min', 'familia' => 'Depilación', 'duracionMinutos' => 30, 'precioOrientativo' => 48.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser ingles integrales 30 min', 'familia' => 'Depilación', 'duracionMinutos' => 30, 'precioOrientativo' => 40.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser labio superior 10 min', 'familia' => 'Depilación', 'duracionMinutos' => 10, 'precioOrientativo' => 10.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser medias piernas 30 min', 'familia' => 'Depilación', 'duracionMinutos' => 30, 'precioOrientativo' => 30.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser piernas completas 45 min', 'familia' => 'Depilación', 'duracionMinutos' => 45, 'precioOrientativo' => 50.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser pecho 30 min', 'familia' => 'Depilación', 'duracionMinutos' => 30, 'precioOrientativo' => 40.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser ingles brasileñas 25 min', 'familia' => 'Depilación', 'duracionMinutos' => 25, 'precioOrientativo' => 30.0, 'estadoPrecio' => 'Fijo'],

    // ── 4. Tratamientos faciales ─────────────────────────────────────────────
    ['name' => 'Hidratación - Luz LED (Limpieza express) 30 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 30, 'precioOrientativo' => 40.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Limpieza + Radiofrecuencia 60 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 60, 'precioOrientativo' => 85.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Limpieza básica 45 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 45, 'precioOrientativo' => 62.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Limpieza profunda 60 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 60, 'precioOrientativo' => 72.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Limpieza + Láser carbono activo 90 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 90, 'precioOrientativo' => 185.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Mesoterapia facial 45 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 45, 'precioOrientativo' => 45.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Microneedling facial 60 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 60, 'precioOrientativo' => 120.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Dermapen 60 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 60, 'precioOrientativo' => 95.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Radiofrecuencia facial 45 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 45, 'precioOrientativo' => 55.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Peeling PRX 45 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 45, 'precioOrientativo' => 100.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Rejuvenecimiento facial Skin Pen 60 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 60, 'precioOrientativo' => 350.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Láser carbono activo (Hollywood Peel) 60 min', 'familia' => 'Tratamientos faciales', 'duracionMinutos' => 60, 'precioOrientativo' => 110.0, 'estadoPrecio' => 'Fijo'],

    // ── 5. Uñas ─────────────────────────────────────────────────────────────
    ['name' => 'Manicura normal 40 min', 'familia' => 'Uñas', 'duracionMinutos' => 40, 'precioOrientativo' => 25.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Manicura semipermanente 50 min', 'familia' => 'Uñas', 'duracionMinutos' => 50, 'precioOrientativo' => 30.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Manicura express 25 min', 'familia' => 'Uñas', 'duracionMinutos' => 25, 'precioOrientativo' => 20.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Parafina manos 20 min', 'familia' => 'Uñas', 'duracionMinutos' => 20, 'precioOrientativo' => 20.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Pedicura normal 45 min', 'familia' => 'Uñas', 'duracionMinutos' => 45, 'precioOrientativo' => 30.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Pedicura semipermanente 60 min', 'familia' => 'Uñas', 'duracionMinutos' => 60, 'precioOrientativo' => 35.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Pedicura express 30 min', 'familia' => 'Uñas', 'duracionMinutos' => 30, 'precioOrientativo' => 25.0, 'estadoPrecio' => 'Fijo'],

    // ── 6. Pestañas y cejas ────────────────────────────────────────────────
    ['name' => 'Lifting de pestañas 45 min', 'familia' => 'Pestañas y cejas', 'duracionMinutos' => 45, 'precioOrientativo' => 50.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Lifting + tinte 60 min', 'familia' => 'Pestañas y cejas', 'duracionMinutos' => 60, 'precioOrientativo' => 60.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Tinte de pestañas 20 min', 'familia' => 'Pestañas y cejas', 'duracionMinutos' => 20, 'precioOrientativo' => 15.0, 'estadoPrecio' => 'Fijo'],
    ['name' => 'Laminado de cejas 45 min', 'familia' => 'Pestañas y cejas', 'duracionMinutos' => 45, 'precioOrientativo' => 50.0, 'estadoPrecio' => 'Fijo'],
];

// 1. Eliminar (soft-delete) registro de prueba antiguo si existe
$prueba = $em->getRDBRepository('CTratamiento')->where(['name' => 'Masaje relajante 60 min [PRUEBA]'])->findOne();
if ($prueba) {
    $em->removeEntity($prueba);
    echo "Eliminado registro de prueba antiguo.\n";
}

$createdCount = 0;
$updatedCount = 0;

foreach ($treatments as $data) {
    $existing = $em->getRDBRepository('CTratamiento')->where(['name' => $data['name']])->findOne();
    if ($existing) {
        $existing->set('familia', $data['familia']);
        $existing->set('duracionMinutos', $data['duracionMinutos']);
        $existing->set('precioOrientativo', $data['precioOrientativo']);
        $existing->set('estadoPrecio', $data['estadoPrecio']);
        $existing->set('activo', true);
        $em->saveEntity($existing);
        $updatedCount++;
    } else {
        $treatment = $em->createEntity('CTratamiento', array_merge($data, ['activo' => true]));
        $createdCount++;
    }
}

echo "Proceso completado con éxito:\n";
echo "- Creados: $createdCount\n";
echo "- Actualizados: $updatedCount\n";
