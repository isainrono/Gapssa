<?php

/**
 * Impide que el nombre del paquete Composer raíz vuelva a quedar codificado en
 * el tooling.
 *
 * Origen: al renombrar el paquete, `tools/check-dependencies.php` conservó el
 * nombre anterior como literal. El verificador seguía funcionando por
 * casualidad, pero había dejado de excluir el paquete raíz de `installed.php`.
 * La regla es que el nombre se lea de `composer.json` en tiempo de ejecución.
 *
 * Uso:  php tests/no_hardcoded_package_test.php <ruta-de-la-extension>
 *
 * <ruta-de-la-extension> contiene tools/, tests/ y el módulo con composer.json.
 */

declare(strict_types=1);

$root = rtrim($argv[1] ?? '', '/');

if ($root === '' || !is_dir($root)) {
    fwrite(STDERR, "Uso: php tests/no_hardcoded_package_test.php <ruta-de-la-extension>\n");
    exit(2);
}

$composerPath = $root . '/files/custom/Espo/Modules/GoogleCalendarSync/composer.json';

if (!file_exists($composerPath)) {
    fwrite(STDERR, "PAQUETE: FALLA — no se encontró composer.json en $composerPath\n");
    exit(1);
}

$composer = json_decode((string) file_get_contents($composerPath), true, 512, JSON_THROW_ON_ERROR);

$declaredName = $composer['name'] ?? null;

if (!is_string($declaredName) || trim($declaredName) === '') {
    echo "PAQUETE: FALLA\n  ✗ composer.json no declara un 'name' válido.\n";
    exit(1);
}

$declaredName = trim($declaredName);

// Cualquier literal con forma de nombre de paquete Composer (vendor/paquete)
// dentro de una cadena PHP es sospechoso en tools/ y tests/.
$pattern = "/['\"]([a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*)['\"]/i";

$errors = [];
$scanned = 0;

foreach (['tools', 'tests'] as $dir) {
    $path = $root . '/' . $dir;

    if (!is_dir($path)) {
        continue;
    }

    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path));

    foreach ($iterator as $file) {
        /** @var SplFileInfo $file */
        if (!$file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }

        $scanned++;

        $lines = file($file->getPathname(), FILE_IGNORE_NEW_LINES) ?: [];

        foreach ($lines as $number => $line) {
            if (!preg_match_all($pattern, $line, $matches)) {
                continue;
            }

            foreach ($matches[1] as $candidate) {
                // Solo interesan los nombres de paquete de ESTA extensión:
                // 'google/apiclient' y compañía son dependencias legítimas que
                // el verificador debe nombrar.
                $isOwnPackage = str_contains($candidate, 'espocrm-google-calendar-sync');

                if (!$isOwnPackage) {
                    continue;
                }

                $errors[] = sprintf(
                    "%s/%s:%d — nombre de paquete raíz codificado: '%s'. " .
                    "Léelo de composer.json en tiempo de ejecución.",
                    $dir,
                    $file->getFilename(),
                    $number + 1,
                    $candidate
                );
            }
        }
    }
}

if ($errors) {
    echo "PAQUETE: FALLA\n";

    foreach ($errors as $e) {
        echo "  ✗ $e\n";
    }

    exit(1);
}

echo "PAQUETE: OK ($scanned archivos revisados en tools/ y tests/; " .
    "el nombre raíz '$declaredName' no está codificado)\n";

exit(0);
