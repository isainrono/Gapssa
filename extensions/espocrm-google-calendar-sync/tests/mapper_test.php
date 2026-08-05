<?php

/**
 * Pruebas de EventMapper contra objetos reales de google/apiclient.
 *
 * Uso:  php tests/mapper_test.php <ruta-del-modulo>
 */

declare(strict_types=1);

namespace Espo\Core\Utils {
    class Config
    {
        public function get(string $key): mixed
        {
            return $key === 'timeZone' ? 'Europe/Madrid' : null;
        }
    }

    class Metadata
    {
        public function get(mixed $path): mixed
        {
            return ['Not Held'];
        }
    }
}

namespace Espo\ORM {
    interface Entity
    {
    }
}

namespace Espo\Core\Utils {
    class Language
    {
        public function translateLabel(string $label, string $category = 'labels', string $scope = 'Global'): string
        {
            // Simula una instancia sin traducción cargada: Messages usará el
            // respaldo en inglés que le pasa cada llamada.
            return $label;
        }
    }
}

namespace {

    use Espo\Modules\GoogleCalendarSync\Classes\EventMapper;

    $root = rtrim($argv[1] ?? '', '/');

    if ($root === '' || !is_dir($root)) {
        fwrite(STDERR, "Uso: php tests/mapper_test.php <ruta-del-modulo>\n");
        exit(2);
    }

    require $root . '/vendor/autoload.php';
    require $root . '/Classes/Messages.php';
    require $root . '/Classes/EventMapper.php';

    final class FakeMeeting implements \Espo\ORM\Entity
    {
        /** @param array<string, mixed> $data */
        public function __construct(private array $data)
        {
        }

        public function get(string $key): mixed
        {
            return $this->data[$key] ?? null;
        }

        public function getId(): string
        {
            return $this->data['id'];
        }
    }

    $assertions = 0;
    $failures = [];

    function check(string $what, bool $condition): void
    {
        global $assertions, $failures;

        $assertions++;

        if (!$condition) {
            $failures[] = $what;
        }
    }

    $messages = new \Espo\Modules\GoogleCalendarSync\Classes\Messages(
        new \Espo\Core\Utils\Language()
    );

    $mapper = new EventMapper(
        new \Espo\Core\Utils\Config(),
        new \Espo\Core\Utils\Metadata(),
        $messages
    );

    // 1. Cita normal en horario de verano: 10:00 UTC -> 12:00 +02:00
    $meeting = new FakeMeeting([
        'id' => 'abc123',
        'name' => 'Cita Uñas',
        'description' => 'Manicura',
        'dateStart' => '2026-08-10 10:00:00',
        'dateEnd' => '2026-08-10 11:00:00',
        'status' => 'Planned',
    ]);

    $event = $mapper->toGoogleEvent($meeting);

    check('devuelve Google\Service\Calendar\Event', $event instanceof Google\Service\Calendar\Event);
    check('summary', $event->getSummary() === 'Cita Uñas');
    check('description', $event->getDescription() === 'Manicura');
    check('inicio en hora de Madrid (verano)', $event->getStart()->getDateTime() === '2026-08-10T12:00:00+02:00');
    check('fin en hora de Madrid (verano)', $event->getEnd()->getDateTime() === '2026-08-10T13:00:00+02:00');
    check('timeZone', $event->getStart()->getTimeZone() === 'Europe/Madrid');
    check('espoMeetingId', $event->getExtendedProperties()->getPrivate() === ['espoMeetingId' => 'abc123']);
    check('cita planificada no es cancelada', $mapper->isCanceled($meeting) === false);

    // Serialización real que viajaría a Google
    $payload = json_decode((string) json_encode($event->toSimpleObject()), true);

    check('payload lleva espoMeetingId', ($payload['extendedProperties']['private']['espoMeetingId'] ?? null) === 'abc123');
    check('payload lleva dateTime correcto', ($payload['start']['dateTime'] ?? null) === '2026-08-10T12:00:00+02:00');
    // La ausencia de `id` NO es lo que evita duplicados: eso lo garantizan
    // GcsEventLink, la propiedad espoMeetingId, la búsqueda previa con
    // findEventByMeetingId y la idempotencia de SyncService. Aquí solo se
    // comprueba que el payload de creación tiene la forma esperada.
    check('el payload de creación no incluye id', !isset($payload['id']));

    // 2. Cita cancelada (estado leído de metadata)
    $canceled = new FakeMeeting([
        'id' => 'x', 'name' => 'X', 'status' => 'Not Held', 'dateStart' => '2026-08-10 10:00:00',
    ]);

    check('detecta estado cancelado', $mapper->isCanceled($canceled) === true);

    // 3. Día completo: la fecha de fin en Google es exclusiva (+1 día)
    $allDay = new FakeMeeting([
        'id' => 'y', 'name' => 'Y', 'status' => 'Planned', 'isAllDay' => true,
        'dateStartDate' => '2026-08-10', 'dateEndDate' => '2026-08-11',
    ]);

    $allDayEvent = $mapper->toGoogleEvent($allDay);

    check('día completo: fecha de inicio', $allDayEvent->getStart()->getDate() === '2026-08-10');
    check('día completo: fin exclusivo +1 día', $allDayEvent->getEnd()->getDate() === '2026-08-12');
    check('día completo sin dateTime', $allDayEvent->getStart()->getDateTime() === null);

    // 4. Horario de invierno: 10:00 UTC -> 11:00 +01:00
    $winter = new FakeMeeting([
        'id' => 'z', 'name' => 'Z', 'status' => 'Planned',
        'dateStart' => '2026-01-15 10:00:00', 'dateEnd' => '2026-01-15 10:30:00',
    ]);

    check(
        'inicio en hora de Madrid (invierno)',
        $mapper->toGoogleEvent($winter)->getStart()->getDateTime() === '2026-01-15T11:00:00+01:00'
    );

    // 5. Cita sin nombre
    $unnamed = new FakeMeeting(['id' => 'n', 'status' => 'Planned', 'dateStart' => '2026-08-10 10:00:00']);

    check('título por defecto sin contactos', $mapper->toGoogleEvent($unnamed)->getSummary() === 'Meeting');

    // ---- Título con contactos (v1.1.1) ----

    check('1 · asunto + un contacto',
        $mapper->buildSummary('Cita para uñas y pies', ['María García'])
            === 'Cita para uñas y pies (María García)');

    check('2 · asunto + varios contactos',
        $mapper->buildSummary('Cita', ['María García', 'Ana López'])
            === 'Cita (María García, Ana López)');

    check('3 · asunto sin contactos',
        $mapper->buildSummary('Cita para uñas y pies', []) === 'Cita para uñas y pies');

    check('4 · sin asunto con contacto',
        $mapper->buildSummary('', ['María García']) === 'Meeting (María García)');

    check('4b · asunto nulo con contacto',
        $mapper->buildSummary(null, ['María García']) === 'Meeting (María García)');

    check('5 · sin asunto ni contactos', $mapper->buildSummary('', []) === 'Meeting');

    check('6 · nombres vacíos se ignoran',
        $mapper->buildSummary('Cita', ['', '  ', 'María García']) === 'Cita (María García)');

    check('6b · solo nombres vacíos = como sin contactos',
        $mapper->buildSummary('Cita', ['', '   ']) === 'Cita');

    check('7 · duplicados eliminados conservando orden',
        $mapper->buildSummary('Cita', ['María García', 'Ana López', 'María García'])
            === 'Cita (María García, Ana López)');

    check('7b · duplicados con espacios sobrantes',
        $mapper->buildSummary('Cita', ['María García', ' María García '])
            === 'Cita (María García)');

    check('determinista: misma entrada, misma salida',
        $mapper->buildSummary('Cita', ['Ana', 'Bea']) === $mapper->buildSummary('Cita', ['Ana', 'Bea']));

    check('asunto con espacios sobrantes se recorta',
        $mapper->buildSummary('  Cita  ', ['Ana']) === 'Cita (Ana)');

    // 8 · Serialización real con contactos + 9 · espoMeetingId conservado
    $withContact = new FakeMeeting([
        'id' => 'm-777', 'name' => 'Cita para uñas y pies', 'description' => 'Semipermanente',
        'dateStart' => '2026-08-10 10:00:00', 'dateEnd' => '2026-08-10 11:00:00', 'status' => 'Planned',
    ]);

    $ev = $mapper->toGoogleEvent($withContact, ['María García']);
    $pl = json_decode((string) json_encode($ev->toSimpleObject()), true);

    check('8 · summary serializado con contacto',
        ($pl['summary'] ?? null) === 'Cita para uñas y pies (María García)');
    check('8b · descripción intacta', ($pl['description'] ?? null) === 'Semipermanente');
    check('9 · espoMeetingId conservado',
        ($pl['extendedProperties']['private']['espoMeetingId'] ?? null) === 'm-777');
    check('9b · fechas intactas con contactos',
        ($pl['start']['dateTime'] ?? null) === '2026-08-10T12:00:00+02:00');

    // 11 · quitar el último contacto deja solo el asunto
    check('11 · sin contactos vuelve al asunto solo',
        $mapper->toGoogleEvent($withContact, [])->getSummary() === 'Cita para uñas y pies');

    // 12 · Forma del payload de creación. La protección contra duplicados no
    // vive aquí sino en GcsEventLink + espoMeetingId + findEventByMeetingId +
    // la idempotencia de SyncService; se verifica en relation_hook_test.php y
    // en las pruebas de aceptación sobre la instancia.
    check('12 · el payload de creación no incluye id', !isset($pl['id']));

    if ($failures) {
        echo "MAPPER: FALLA (" . count($failures) . '/' . $assertions . ")\n";

        foreach ($failures as $f) {
            echo "  ✗ $f\n";
        }

        exit(1);
    }

    echo "MAPPER: OK ($assertions aserciones sobre objetos Google\\Service\\Calendar\\Event)\n";

    exit(0);
}
