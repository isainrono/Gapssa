#!/usr/bin/env bash
set -e

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "=========================================================="
echo "      ACTUALIZACIÓN DE TRATAMIENTOS (ESPOCRM Y WEB)       "
echo "=========================================================="
echo ""

echo "==> 1. Actualizando entidades CTratamiento en EspoCRM..."
docker compose --env-file .env.production -f compose.prod.yml exec -T espocrm php -- << 'PHP_EOF'
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

    // Mapeo de actualizaciones para EspoCRM
    // [buscar_patron_nombre, nueva_duracion_o_null, nuevo_precio_o_null, nuevo_nombre_o_null]
    $configs = [
        // Duraciones
        ['Limpieza básica 45 min', 60, null, 'Limpieza básica 60 min'],
        ['Limpieza profunda 60 min', 80, null, 'Limpieza profunda 80 min'],
        ['Mesoterapia facial 45 min', 30, null, 'Mesoterapia facial 30 min'],
        ['Rejuvenecimiento facial Skin Pen 60 min', 80, null, 'Rejuvenecimiento facial Skin Pen 80 min'],
        ['Lifting de pestañas 45 min', 60, null, 'Lifting de pestañas 60 min'],
        ['Lifting + tinte 60 min', 75, null, 'Lifting + tinte 75 min'],
        ['Cera espalda 30 min', 40, null, 'Cera espalda 40 min'],
        ['Cera piernas completas 45 min', 30, null, 'Cera piernas completas 30 min'],
        ['Cera medias piernas 30 min', 20, null, 'Cera medias piernas 20 min'],
        ['Manicura express 25 min', 30, null, 'Manicura express 30 min'],
        ['Manicura semipermanente 50 min', 60, null, 'Manicura semipermanente 60 min'],
        ['Presoterapia + masaje 50 min', 60, null, 'Presoterapia + masaje 60 min'],

        // Precios
        ['Pinzas diseño 20 min', null, 17.0, null],
        ['Diseño hilo cejas 25 min', null, 17.0, null],
        ['Masaje relajante 60 min', null, 65.0, null],
        ['Masaje descontracturante 60 min', null, 75.0, null],
        ['Masaje con piedras calientes 60 min', null, 75.0, null],
        ['Drenaje linfático manual 60 min', null, 70.0, null],
    ];

    $updated = 0;
    foreach ($configs as $item) {
        [$namePattern, $newDuration, $newPrice, $newName] = $item;
        
        // Buscar por nombre exacto o si ya fue renombrado
        $treatment = $em->getRDBRepository('CTratamiento')->where(['name' => $namePattern])->findOne();
        if (!$treatment && $newName) {
            $treatment = $em->getRDBRepository('CTratamiento')->where(['name' => $newName])->findOne();
        }
        
        if ($treatment) {
            if ($newDuration !== null) {
                $treatment->set('duracionMinutos', $newDuration);
            }
            if ($newPrice !== null) {
                $treatment->set('precioOrientativo', $newPrice);
            }
            if ($newName !== null) {
                $treatment->set('name', $newName);
            }
            $em->saveEntity($treatment);
            echo " ✔ Actualizado CTratamiento: {$treatment->get('name')} | Duración: {$treatment->get('duracionMinutos')} min | Precio: {$treatment->get('precioOrientativo')} €\n";
            $updated++;
        } else {
            echo " ⚠ No se encontró tratamiento para el patrón: $namePattern\n";
        }
    }

    echo "Total actualizados en EspoCRM: $updated\n";
} catch (\Throwable $e) {
    echo "ERROR en EspoCRM: " . $e->getMessage() . "\n" . $e->getTraceAsString() . "\n";
    exit(1);
}
PHP_EOF
echo ""

echo "==> 2. Actualizando descripciones en Postgres (gapssa_cms / Payload CMS)..."
docker compose --env-file .env.production -f compose.prod.yml exec -T apps-db psql -U gapssa_apps -d gapssa_cms -- << 'SQL_EOF'
-- 1. Limpieza facial básica
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Para pieles que necesitan mantenimiento, frescura e hidratación, sin demasiadas impurezas acumuladas.'
    WHEN tl._locale = 'ca' THEN 'Per a pells que necessiten manteniment, frescor i hidratació, sense massa impureses acumulades.'
    WHEN tl._locale = 'en' THEN 'For skin that needs maintenance, freshness and hydration, without excess accumulated impurities.'
    WHEN tl._locale = 'it' THEN 'Per pelli che necessitano di mantenimento, freschezza e idratazione, senza troppe impurità accumulate.'
    WHEN tl._locale = 'fr' THEN 'Pour les peaux nécessitant entretien, fraîcheur et hydratation, sans trop d’impuretés accumulées.'
    WHEN tl._locale = 'pt' THEN 'Para peles que necessitam de manutenção, frescura e hidratação, sem demasiadas impurezas acumuladas.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'limpieza-facial-basica';

-- 2. Limpieza facial profunda
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Tratamiento completo que limpia la piel en profundidad, especialmente cuando hay puntos negros, poros obstruidos o exceso de grasa.'
    WHEN tl._locale = 'ca' THEN 'Tractament complet que neteja la pell en profunditat, especialment quan hi ha punts negres, porus obstruïts o excés de greix.'
    WHEN tl._locale = 'en' THEN 'Comprehensive treatment that deep-cleanses the skin, especially when there are blackheads, clogged pores, or excess oil.'
    WHEN tl._locale = 'it' THEN 'Trattamento completo che pulisce la pelle in profondità, soprattutto in presenza di punti neri, pori ostruiti o eccesso di sebo.'
    WHEN tl._locale = 'fr' THEN 'Soin complet qui nettoie la peau en profondeur, notamment en cas de points noirs, pores obstrués ou excès de sébum.'
    WHEN tl._locale = 'pt' THEN 'Tratamento completo que limpa a pele em profundidade, especialmente quando há pontos negros, poros obstruídos ou excesso de oleosidade.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'limpieza-facial-profunda';

-- 3. Diseño de cejas
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Definición y forma de cejas adaptada a tus facciones, con hilo.'
    WHEN tl._locale = 'ca' THEN 'Definició i forma de celles adaptada als teus trets, amb fil.'
    WHEN tl._locale = 'en' THEN 'Eyebrow definition and shape adapted to your features, with thread.'
    WHEN tl._locale = 'it' THEN 'Definizione e forma delle sopracciglia adattate ai tuoi lineamenti, con filo.'
    WHEN tl._locale = 'fr' THEN 'Une définition et une forme des sourcils adaptées à vos traits, au fil.'
    WHEN tl._locale = 'pt' THEN 'Definição e forma de sobrancelhas adaptada aos seus traços, com linha.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-diseno-cejas';

-- 4. Depilación de cejas
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Mantenimiento de la forma de las cejas con pinza.'
    WHEN tl._locale = 'ca' THEN 'Manteniment de la forma de les celles amb pinça.'
    WHEN tl._locale = 'en' THEN 'Maintaining the shape of your eyebrows with tweezers.'
    WHEN tl._locale = 'it' THEN 'Mantenimento della forma delle sopracciglia con pinzetta.'
    WHEN tl._locale = 'fr' THEN 'Entretien de la forme des sourcils à la pince.'
    WHEN tl._locale = 'pt' THEN 'Manutenção da forma das sobrancelhas com pinça.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-cejas';

-- 5. Depilación labio superior
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Depilación precisa de la zona del labio superior con hilo o cera.'
    WHEN tl._locale = 'ca' THEN 'Depilació precisa de la zona del llavi superior amb fil o cera.'
    WHEN tl._locale = 'en' THEN 'Precise hair removal of the upper lip area with thread or wax.'
    WHEN tl._locale = 'it' THEN 'Depilazione precisa della zona del labbro superiore con filo o cera.'
    WHEN tl._locale = 'fr' THEN 'Une épilation précise de la zone de la lèvre supérieure au fil ou à la cire.'
    WHEN tl._locale = 'pt' THEN 'Depilação precisa da zona do lábio superior com linha ou cera.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-labio-superior';

-- 6. Depilación mentón
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Depilación específica de la zona del mentón con hilo.'
    WHEN tl._locale = 'ca' THEN 'Depilació específica de la zona de la barbeta amb fil.'
    WHEN tl._locale = 'en' THEN 'Specific hair removal of the chin area with thread.'
    WHEN tl._locale = 'it' THEN 'Depilazione specifica della zona del mento con filo.'
    WHEN tl._locale = 'fr' THEN 'Une épilation spécifique de la zone du menton au fil.'
    WHEN tl._locale = 'pt' THEN 'Depilação específica da zona do queixo com linha.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-menton';

-- 7. Depilación de patillas
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Depilación de la zona de las patillas con hilo.'
    WHEN tl._locale = 'ca' THEN 'Depilació de la zona de les patilles amb fil.'
    WHEN tl._locale = 'en' THEN 'Hair removal of the sideburns area with thread.'
    WHEN tl._locale = 'it' THEN 'Depilazione della zona delle basette con filo.'
    WHEN tl._locale = 'fr' THEN 'Une épilation de la zone des favoris au fil.'
    WHEN tl._locale = 'pt' THEN 'Depilação da zona das suíças com linha.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-patillas';

-- 8. Depilación facial completa
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Depilación de todo el rostro en una misma sesión, con hilo.'
    WHEN tl._locale = 'ca' THEN 'Depilació de tot el rostre en una mateixa sessió, amb fil.'
    WHEN tl._locale = 'en' THEN 'Hair removal of the whole face in a single session, with thread.'
    WHEN tl._locale = 'it' THEN 'Depilazione dell’intero viso in un’unica seduta, con filo.'
    WHEN tl._locale = 'fr' THEN 'Une épilation de l’ensemble du visage en une seule séance, au fil.'
    WHEN tl._locale = 'pt' THEN 'Depilação de todo o rosto numa única sessão, com linha.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-facial-completa';

-- 9. Depilación de pecho
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Depilación de la zona del pecho con cera o hilo.'
    WHEN tl._locale = 'ca' THEN 'Depilació de la zona del pit amb cera o fil.'
    WHEN tl._locale = 'en' THEN 'Hair removal of the chest area with wax or thread.'
    WHEN tl._locale = 'it' THEN 'Depilazione della zona del petto con cera o filo.'
    WHEN tl._locale = 'fr' THEN 'Une épilation de la zone du torse à la cire ou au fil.'
    WHEN tl._locale = 'pt' THEN 'Depilação da zona do peito com cera ou linha.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-pecho';

-- 10. Depilación de abdomen
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Depilación de la zona abdominal con cera o hilo.'
    WHEN tl._locale = 'ca' THEN 'Depilació de la zona abdominal amb cera o fil.'
    WHEN tl._locale = 'en' THEN 'Hair removal of the abdominal area with wax or thread.'
    WHEN tl._locale = 'it' THEN 'Depilazione della zona addominale con cera o filo.'
    WHEN tl._locale = 'fr' THEN 'Une épilation de la zone abdominale à la cire ou au fil.'
    WHEN tl._locale = 'pt' THEN 'Depilação da zona abdominal com cera ou linha.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-abdomen';

-- 11. Depilación perianal
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Depilación de la zona perianal con láser o cera.'
    WHEN tl._locale = 'ca' THEN 'Depilació de la zona perianal amb làser o cera.'
    WHEN tl._locale = 'en' THEN 'Hair removal of the perianal area with laser or wax.'
    WHEN tl._locale = 'it' THEN 'Depilazione della zona perianale con laser o cera.'
    WHEN tl._locale = 'fr' THEN 'Une épilation de la zone périanale au laser ou à la cire.'
    WHEN tl._locale = 'pt' THEN 'Depilação da zona perianal com laser ou cera.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-perianal';

-- 12. Depilación de glúteos
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Depilación de la zona de los glúteos con cera.'
    WHEN tl._locale = 'ca' THEN 'Depilació de la zona dels glutis amb cera.'
    WHEN tl._locale = 'en' THEN 'Hair removal of the buttocks area with wax.'
    WHEN tl._locale = 'it' THEN 'Depilazione della zona dei glutei con cera.'
    WHEN tl._locale = 'fr' THEN 'Une épilation de la zone des fessiers à la cire.'
    WHEN tl._locale = 'pt' THEN 'Depilação da zona dos glúteos com cera.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-gluteos';

-- 13. Depilación ingles integrales
UPDATE tratamientos_locales tl
SET descripcion = CASE 
    WHEN tl._locale = 'es' THEN 'Depilación completa de la zona de ingles y perianal.'
    WHEN tl._locale = 'ca' THEN 'Depilació completa de la zona d’engonals i perianal.'
    WHEN tl._locale = 'en' THEN 'Complete hair removal of the bikini and perianal area.'
    WHEN tl._locale = 'it' THEN 'Depilazione completa della zona inguinale e perianale.'
    WHEN tl._locale = 'fr' THEN 'Une épilation complète de la zone du maillot et périanale.'
    WHEN tl._locale = 'pt' THEN 'Depilação completa da zona da virilha e perianal.'
    ELSE tl.descripcion
END
FROM tratamientos t
WHERE tl._parent_id = t.id AND t.slug = 'depilacion-ingles-integrales';

SQL_EOF
echo "✔ Descripciones actualizadas en Postgres."
echo ""

echo "==> 3. Recompilando y reiniciando contenedor Web con las nuevas tarifas oficiales..."
docker compose --env-file .env.production -f compose.prod.yml build web
docker compose --env-file .env.production -f compose.prod.yml up -d web
echo ""

echo "==> 4. Verificación rápida de la API de tratamientos..."
sleep 5
curl -s http://127.0.0.1:3050/api/booking/v1/treatments | grep -o '"name":[^,]*' | head -n 10 || echo "Web iniciando..."

echo ""
echo "=========================================================="
echo "    ¡ACTUALIZACIÓN COMPLETADA CON ÉXITO EN PRODUCCIÓN!    "
echo "=========================================================="
