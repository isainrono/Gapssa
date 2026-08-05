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

namespace {

    use Espo\Modules\GoogleCalendarSync\Classes\EventMapper;

    $root = rtrim($argv[1] ?? '', '/');

    if ($root === '' || !is_dir($root)) {
        fwrite(STDERR, "Uso: php tests/mapper_test.php <ruta-del-modulo>\n");
        exit(2);
    }

    require $root . '/vendor/autoload.php';
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

    $mapper = new EventMapper(new \Espo\Core\Utils\Config(), new \Espo\Core\Utils\Metadata());

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
    check('payload no lleva id al crear', !isset($payload['id']));

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

    check('título por defecto', $mapper->toGoogleEvent($unnamed)->getSummary() === '(sin título)');

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
