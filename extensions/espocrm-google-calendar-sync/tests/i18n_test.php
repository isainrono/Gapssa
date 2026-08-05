<?php

/**
 * Comprueba que las traducciones están completas y en paridad entre idiomas.
 *
 * Una extensión distribuible no puede tener claves presentes en un idioma y
 * ausentes en otro: EspoCRM mostraría la clave en crudo al usuario.
 *
 * Comprueba además que las claves de error usadas desde PHP existen en los
 * archivos i18n, para que `Messages::get()` no acabe cayendo siempre al
 * respaldo en inglés sin que nadie se entere.
 *
 * Uso:  php tests/i18n_test.php <ruta-del-modulo>
 */

declare(strict_types=1);

$root = rtrim($argv[1] ?? '', '/');

if ($root === '' || !is_dir($root)) {
    fwrite(STDERR, "Uso: php tests/i18n_test.php <ruta-del-modulo>\n");
    exit(2);
}

const REFERENCE_LANGUAGE = 'en_US';

$errors = [];
$checks = 0;

$i18nDir = $root . '/Resources/i18n';

$languages = array_values(array_filter(
    scandir($i18nDir) ?: [],
    fn(string $e): bool => $e !== '.' && $e !== '..' && is_dir($i18nDir . '/' . $e)
));

if (!in_array(REFERENCE_LANGUAGE, $languages, true)) {
    fwrite(STDERR, 'I18N: FALLA — falta el idioma de referencia ' . REFERENCE_LANGUAGE . "\n");
    exit(1);
}

/**
 * Aplana un array anidado en claves "a.b.c".
 *
 * @param array<string, mixed> $data
 * @return string[]
 */
function flatten(array $data, string $prefix = ''): array
{
    $keys = [];

    foreach ($data as $key => $value) {
        $path = $prefix === '' ? (string) $key : $prefix . '.' . $key;

        if (is_array($value)) {
            $keys = array_merge($keys, flatten($value, $path));

            continue;
        }

        $keys[] = $path;
    }

    return $keys;
}

/** @var array<string, array<string, string[]>> $byLanguage */
$byLanguage = [];

foreach ($languages as $language) {
    foreach (glob($i18nDir . '/' . $language . '/*.json') ?: [] as $file) {
        $data = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);

        $byLanguage[$language][basename($file)] = flatten($data);
    }
}

$referenceFiles = $byLanguage[REFERENCE_LANGUAGE];

foreach ($languages as $language) {
    if ($language === REFERENCE_LANGUAGE) {
        continue;
    }

    foreach ($referenceFiles as $file => $referenceKeys) {
        $checks++;

        if (!isset($byLanguage[$language][$file])) {
            $errors[] = "$language: falta el archivo $file.";

            continue;
        }

        $missing = array_diff($referenceKeys, $byLanguage[$language][$file]);
        $extra = array_diff($byLanguage[$language][$file], $referenceKeys);

        if ($missing) {
            $errors[] = "$language/$file: faltan claves: " . implode(', ', $missing);
        }

        if ($extra) {
            $errors[] = "$language/$file: claves que no existen en " .
                REFERENCE_LANGUAGE . ': ' . implode(', ', $extra);
        }
    }

    foreach ($byLanguage[$language] as $file => $_) {
        if (!isset($referenceFiles[$file])) {
            $errors[] = "$language: $file no existe en " . REFERENCE_LANGUAGE . '.';
        }
    }
}

// Claves de error referenciadas desde PHP: deben existir en los i18n.
$declared = $referenceFiles['GcsAccount.json'] ?? [];

$errorKeys = [];

foreach (['Classes', 'Api', 'EntryPoints', 'Hooks', 'Jobs'] as $dir) {
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

        if (preg_match_all(
            "/messages->get\(\s*'([a-zA-Z0-9_]+)'/",
            (string) file_get_contents($file->getPathname()),
            $matches
        )) {
            foreach ($matches[1] as $key) {
                $errorKeys[$key] = true;
            }
        }
    }
}

foreach (array_keys($errorKeys) as $key) {
    $checks++;

    if (!in_array('errors.' . $key, $declared, true)) {
        $errors[] = "La clave 'errors.$key' se usa en PHP pero no está en " .
            REFERENCE_LANGUAGE . '/GcsAccount.json.';
    }
}

if ($errors) {
    echo "I18N: FALLA\n";

    foreach ($errors as $e) {
        echo "  ✗ $e\n";
    }

    exit(1);
}

echo 'I18N: OK (' . $checks . ' comprobaciones, idiomas: ' . implode(', ', $languages) .
    ', ' . count($errorKeys) . " claves de error usadas en PHP verificadas)\n";

exit(0);
