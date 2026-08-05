<?php

/**
 * Comprueba que el autoload declarado en Resources/autoload.json resuelve todas
 * las clases de Google que usa la extensión, sin ayuda del vendor de EspoCRM.
 *
 * Uso:  php tests/autoload_test.php <ruta-del-modulo>
 */

declare(strict_types=1);

$root = rtrim($argv[1] ?? '', '/');

if ($root === '' || !is_dir($root)) {
    fwrite(STDERR, "Uso: php tests/autoload_test.php <ruta-del-modulo>\n");
    exit(2);
}

$autoloadJson = json_decode(
    (string) file_get_contents($root . '/Resources/autoload.json'),
    true,
    512,
    JSON_THROW_ON_ERROR
);

// Se cargan exactamente los archivos que declara autoload.json, resolviendo la
// ruta relativa a la raíz de EspoCRM contra la ubicación real del módulo.
foreach ($autoloadJson['autoloadFileList'] ?? [] as $file) {
    $path = preg_replace('#^custom/Espo/Modules/GoogleCalendarSync#', $root, $file);

    if (!file_exists($path)) {
        fwrite(STDERR, "FALLA: autoload.json apunta a un archivo inexistente: $file\n");
        exit(1);
    }

    require $path;
}

// Prefijos PSR-4 declarados a mano (si los hubiera).
foreach ($autoloadJson['psr-4'] ?? [] as $prefix => $dir) {
    $base = preg_replace('#^custom/Espo/Modules/GoogleCalendarSync#', $root, $dir);

    spl_autoload_register(function (string $class) use ($prefix, $base): void {
        if (!str_starts_with($class, $prefix)) {
            return;
        }

        $rel = str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';

        if (file_exists($file = $base . '/' . $rel)) {
            require $file;
        }
    });
}

$classes = [
    'Google\Client',
    'Google\Service',
    'Google\Model',
    'Google\Collection',
    'Google\Exception',
    'Google\Service\Exception',
    'Google\Service\Resource',
    'Google\Service\Calendar',
    'Google\Service\Calendar\Event',
    'Google\Service\Calendar\EventDateTime',
    'Google\Service\Calendar\EventExtendedProperties',
    'Google\Service\Calendar\CalendarListEntry',
    'Google\Service\Calendar\Events',
    'Google\Service\Calendar\Resource\Events',
    'Google\Service\Calendar\Resource\CalendarList',
    'Google\Auth\OAuth2',
    'Google\Auth\Cache\MemoryCacheItemPool',
    'Google\AuthHandler\AuthHandlerFactory',
    'Google\Http\REST',
    'Google\Task\Runner',
    'Firebase\JWT\JWT',
];

$missing = [];

foreach ($classes as $class) {
    if (!class_exists($class) && !interface_exists($class)) {
        $missing[] = $class;
    }
}

if ($missing) {
    echo "AUTOLOAD: FALLA — no resuelven: " . implode(', ', $missing) . "\n";
    exit(1);
}

// Los scopes deben salir de las constantes reales del servicio, no de literales.
$events = Google\Service\Calendar::CALENDAR_EVENTS;
$list = Google\Service\Calendar::CALENDAR_CALENDARLIST_READONLY;

if ($events !== 'https://www.googleapis.com/auth/calendar.events') {
    echo "AUTOLOAD: FALLA — scope de eventos inesperado: $events\n";
    exit(1);
}

if ($list !== 'https://www.googleapis.com/auth/calendar.calendarlist.readonly') {
    echo "AUTOLOAD: FALLA — scope de calendarList inesperado: $list\n";
    exit(1);
}

echo 'AUTOLOAD: OK (' . count($classes) . " clases resueltas, scopes verificados)\n";

exit(0);
