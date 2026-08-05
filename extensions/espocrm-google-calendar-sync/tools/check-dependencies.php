<?php

/**
 * Comprueba que un árbol vendor está completo, coincide exactamente con
 * composer.lock y es autónomo (no necesita librerías de EspoCRM).
 *
 * Uso:  php tools/check-dependencies.php <ruta-del-modulo>
 *
 * <ruta-del-modulo> es el directorio que contiene composer.json, composer.lock
 * y vendor/. Sirve tanto para el módulo del repositorio como para el contenido
 * extraído del ZIP.
 */

declare(strict_types=1);

$root = rtrim($argv[1] ?? '', '/');

if ($root === '' || !is_dir($root)) {
    fwrite(STDERR, "Uso: php tools/check-dependencies.php <ruta-del-modulo>\n");
    exit(2);
}

$errors = [];
$notes = [];

function fail(string $message): void
{
    global $errors;
    $errors[] = $message;
}

function note(string $message): void
{
    global $notes;
    $notes[] = $message;
}

// ---------------------------------------------------------------- 1. Archivos
$lockPath = $root . '/composer.lock';
$jsonPath = $root . '/composer.json';
$vendorPath = $root . '/vendor';
$autoloadPath = $vendorPath . '/autoload.php';
$installedPath = $vendorPath . '/composer/installed.php';

foreach ([$jsonPath, $lockPath, $autoloadPath, $installedPath] as $required) {
    if (!file_exists($required)) {
        fail('Falta ' . str_replace($root . '/', '', $required) .
            ' — ejecuta `make gcs-deps`.');
    }
}

if ($errors) {
    report($errors, $notes);
}

$lock = json_decode((string) file_get_contents($lockPath), true, 512, JSON_THROW_ON_ERROR);
$json = json_decode((string) file_get_contents($jsonPath), true, 512, JSON_THROW_ON_ERROR);

// El nombre del paquete raíz se lee de composer.json, nunca se codifica: así
// renombrar el paquete no deja atrás una constante obsoleta en el verificador.
$rootName = $json['name'] ?? null;

if (!is_string($rootName) || trim($rootName) === '') {
    fail('composer.json no declara un "name" válido; es necesario para excluir ' .
        'el paquete raíz de installed.php.');
    report($errors, $notes);
}

$rootName = trim($rootName);

note("paquete raíz: $rootName");

/** @var array<string, string> $lockedPackages */
$lockedPackages = [];

foreach ($lock['packages'] ?? [] as $package) {
    $lockedPackages[$package['name']] = $package['version'];
}

if ($lockedPackages === []) {
    fail('composer.lock no contiene paquetes.');
    report($errors, $notes);
}

note(count($lockedPackages) . ' paquetes en composer.lock');

if (!empty($lock['packages-dev'])) {
    fail('composer.lock contiene paquetes de desarrollo; instala con --no-dev.');
}

// -------------------------------------------- 2. Lock ↔ vendor instalado
$installed = require $installedPath;

/** @var array<string, string> $installedPackages */
$installedPackages = [];

foreach ($installed['versions'] ?? [] as $name => $info) {
    if (($info['type'] ?? '') === 'metapackage' || !isset($info['install_path'])) {
        continue;
    }

    if ($name === $rootName) {
        continue;
    }

    $installedPackages[$name] = $info['pretty_version'] ?? ($info['version'] ?? '?');
}

foreach ($lockedPackages as $name => $version) {
    if (!isset($installedPackages[$name])) {
        fail("El paquete '$name' está en composer.lock pero no en vendor/.");

        continue;
    }

    if ($installedPackages[$name] !== $version) {
        fail("Versión distinta para '$name': lock=$version, vendor={$installedPackages[$name]}.");
    }
}

foreach ($installedPackages as $name => $version) {
    if (!isset($lockedPackages[$name]) && $name !== $rootName) {
        fail("El paquete '$name' ($version) está en vendor/ pero no en composer.lock.");
    }
}

// ------------------------------------- 3. Directorios de paquete presentes
foreach (array_keys($lockedPackages) as $name) {
    if (!is_dir($vendorPath . '/' . $name)) {
        fail("Falta el directorio vendor/$name.");
    }
}

// ---------------------------- 4. Autonomía: nada depende del vendor de Espo
// Estas clases deben resolverse SOLO con nuestro vendor. Si alguna falta, el
// ZIP dependería de que EspoCRM la aporte.
$requiredClasses = [
    // Nuestra dependencia directa
    'Google\Client',
    'Google\Service\Calendar',
    'Google\Service\Calendar\Event',
    'Google\Service\Calendar\EventDateTime',
    'Google\Service\Calendar\EventExtendedProperties',
    'Google\Service\Calendar\CalendarListEntry',
    'Google\Service\Exception',
    'Google\Service\Resource',
    'Google\Auth\OAuth2',
    'Google\Auth\Cache\MemoryCacheItemPool',
    'Firebase\JWT\JWT',
    // Librerías que EspoCRM también trae: deben venir de NUESTRO vendor
    'GuzzleHttp\Client',
    'GuzzleHttp\Psr7\Request',
    'GuzzleHttp\Promise\Promise',
    'Monolog\Logger',
    'Psr\Log\LoggerInterface',
    'Psr\Cache\CacheItemPoolInterface',
    'Psr\Http\Message\RequestInterface',
    'Psr\Http\Client\ClientInterface',
    // phpseclib: google/apiclient v2.19 lo quitó de sus require y google/auth
    // solo lo "sugiere", pero AccessToken.php y ServiceAccountSignerTrait.php
    // lo usan de verdad. Se declara como dependencia directa para que el ZIP
    // no falle en esos caminos. Estas son las clases que la librería referencia.
    'phpseclib3\Crypt\RSA',
    'phpseclib3\Crypt\PublicKeyLoader',
    'phpseclib3\Math\BigInteger',
];

require $autoloadPath;

$missing = [];

foreach ($requiredClasses as $class) {
    if (!class_exists($class) && !interface_exists($class)) {
        $missing[] = $class;
    }
}

if ($missing) {
    fail('No se resuelven sin EspoCRM (el ZIP no sería autónomo): ' .
        implode(', ', $missing));
} else {
    note(count($requiredClasses) . ' clases críticas resueltas solo con el vendor del ZIP');
}

// ------------------- 5. apiclient-services recortado al servicio Calendar
$servicesDir = $vendorPath . '/google/apiclient-services/src';

if (is_dir($servicesDir)) {
    $services = [];

    foreach ((array) scandir($servicesDir) as $entry) {
        if ($entry === '.' || $entry === '..') {
            continue;
        }

        if (is_dir($servicesDir . '/' . $entry)) {
            $services[] = $entry;
        }
    }

    if ($services !== ['Calendar']) {
        fail('google/apiclient-services no está recortado a Calendar. Servicios: ' .
            implode(', ', array_slice($services, 0, 10)) .
            (count($services) > 10 ? '…' : '') .
            ' — revisa extra."google/apiclient-services" y el script de cleanup.');
    } else {
        note('google/apiclient-services recortado correctamente (solo Calendar)');
    }
}

// --------------------------------------------------- 6. Higiene del paquete
foreach (['tests', 'Tests', 'docs', '.github'] as $junk) {
    $found = glob($vendorPath . '/*/*/' . $junk, GLOB_ONLYDIR) ?: [];

    if ($found) {
        note('Aviso: hay ' . count($found) . " directorios '$junk' en vendor/ " .
            '(instala con --prefer-dist para reducir el ZIP)');
    }
}

$size = 0;
$files = 0;

$iterator = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator($vendorPath, FilesystemIterator::SKIP_DOTS)
);

foreach ($iterator as $file) {
    /** @var SplFileInfo $file */
    if ($file->isFile()) {
        $size += $file->getSize();
        $files++;
    }
}

note(sprintf('vendor/: %d archivos, %.1f MB', $files, $size / 1048576));

report($errors, $notes);

/**
 * @param string[] $errors
 * @param string[] $notes
 */
function report(array $errors, array $notes): never
{
    foreach ($notes as $n) {
        echo "  · $n\n";
    }

    if ($errors) {
        echo "\nCOMPROBACIÓN DE DEPENDENCIAS: FALLA\n";

        foreach ($errors as $e) {
            echo "  ✗ $e\n";
        }

        exit(1);
    }

    echo "\nCOMPROBACIÓN DE DEPENDENCIAS: OK (vendor completo, exacto y autónomo)\n";

    exit(0);
}
