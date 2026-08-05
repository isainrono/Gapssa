<?php

/**
 * Comprueba que toda entidad expuesta por la API tiene su controlador y que
 * este carga y hereda de la clase correcta.
 *
 * EspoCRM resuelve el controlador por ubicación y no aplica fallback: si falta
 * la clase, la entidad devuelve 404 aunque su tabla y sus metadatos existan.
 * Esta prueba nace del fallo detectado en integración real con GcsAccount.
 *
 * Uso:  php tests/controller_test.php <ruta-del-modulo>
 */

declare(strict_types=1);

$root = rtrim($argv[1] ?? '', '/');

if ($root === '' || !is_dir($root)) {
    fwrite(STDERR, "Uso: php tests/controller_test.php <ruta-del-modulo>\n");
    exit(2);
}

const MODULE_NAMESPACE = 'Espo\\Modules\\GoogleCalendarSync';
const EXPECTED_PARENT = 'Espo\\Core\\Templates\\Controllers\\Base';

// Sustituto de la jerarquía del núcleo, ausente fuera de una instalación real.
if (!class_exists(EXPECTED_PARENT)) {
    eval('namespace Espo\\Core\\Controllers; class Record {}');
    eval('namespace Espo\\Core\\Templates\\Controllers; class Base extends \\Espo\\Core\\Controllers\\Record {}');
}

$errors = [];
$checks = 0;

$scopeFiles = glob($root . '/Resources/metadata/scopes/*.json') ?: [];

if ($scopeFiles === []) {
    fwrite(STDERR, "CONTROLADORES: FALLA — no se encontraron scopes.\n");
    exit(1);
}

foreach ($scopeFiles as $scopeFile) {
    $entity = basename($scopeFile, '.json');

    $scope = json_decode((string) file_get_contents($scopeFile), true, 512, JSON_THROW_ON_ERROR);

    $isEntity = ($scope['entity'] ?? false) === true;
    $isExposed = ($scope['object'] ?? false) === true;

    if (!$isEntity) {
        continue;
    }

    $controllerFile = $root . '/Controllers/' . $entity . '.php';
    $controllerClass = MODULE_NAMESPACE . '\\Controllers\\' . $entity;

    if (!$isExposed) {
        // Entidad interna: no debe exponerse por la API.
        $checks++;

        if (file_exists($controllerFile)) {
            $errors[] = "$entity tiene 'object: false' pero incluye un controlador: " .
                'o se expone de verdad (pon object: true) o sobra el archivo.';
        }

        continue;
    }

    // Entidad expuesta: el controlador es obligatorio.
    $checks++;

    if (!file_exists($controllerFile)) {
        $errors[] = "$entity está expuesta ('object: true') pero falta " .
            "Controllers/$entity.php — la API devolvería 404.";

        continue;
    }

    require_once $controllerFile;

    $checks++;

    if (!class_exists($controllerClass)) {
        $errors[] = "El archivo Controllers/$entity.php no define $controllerClass " .
            '(revisa el namespace o el nombre de la clase).';

        continue;
    }

    $checks++;

    if (!is_subclass_of($controllerClass, EXPECTED_PARENT)) {
        $errors[] = "$controllerClass no hereda de " . EXPECTED_PARENT . '.';
    }
}

if ($errors) {
    echo "CONTROLADORES: FALLA\n";

    foreach ($errors as $e) {
        echo "  ✗ $e\n";
    }

    exit(1);
}

echo "CONTROLADORES: OK ($checks comprobaciones sobre " . count($scopeFiles) . " entidades)\n";

exit(0);
