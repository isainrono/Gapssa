<?php

namespace Espo\Modules\GoogleCalendarSync\Classes;

use DateInterval;
use DateTime;
use DateTimeZone;
use Espo\Core\Utils\Config;
use Espo\Core\Utils\Metadata;
use Espo\ORM\Entity;
use Google\Service\Calendar\Event;
use Google\Service\Calendar\EventDateTime;
use Google\Service\Calendar\EventExtendedProperties;

/**
 * Convierte una cita (Meeting) en un evento de Google Calendar.
 */
class EventMapper
{
    /** Respaldo neutro: solo se usa si la instancia no tuviera zona configurada. */
    private const DEFAULT_TIME_ZONE = 'UTC';

    /** Propiedad privada que empareja evento ↔ cita. */
    public const MEETING_ID_PROPERTY = 'espoMeetingId';

    public function __construct(
        private Config $config,
        private Metadata $metadata,
        private Messages $messages
    ) {}

    /**
     * @param string[] $contactNames Nombres de los contactos de la cita, ya
     *        obtenidos por ContactNameResolver. El mapper no consulta la base
     *        de datos: es una función pura de sus argumentos.
     */
    public function toGoogleEvent(Entity $meeting, array $contactNames = []): Event
    {
        $event = new Event();

        $event->setSummary($this->buildSummary($meeting->get('name'), $contactNames));
        $event->setDescription($meeting->get('description') ?? '');

        $extendedProperties = new EventExtendedProperties();

        $extendedProperties->setPrivate([
            self::MEETING_ID_PROPERTY => $meeting->getId(),
        ]);

        $event->setExtendedProperties($extendedProperties);

        $timeZone = $this->getTimeZone();

        if ($meeting->get('isAllDay') && $meeting->get('dateStartDate')) {
            $endDate = $meeting->get('dateEndDate') ?? $meeting->get('dateStartDate');

            // En Google la fecha de fin de un evento de día completo es exclusiva.
            $endExclusive = (new DateTime($endDate))
                ->add(new DateInterval('P1D'))
                ->format('Y-m-d');

            $start = new EventDateTime();
            $start->setDate($meeting->get('dateStartDate'));

            $end = new EventDateTime();
            $end->setDate($endExclusive);

            $event->setStart($start);
            $event->setEnd($end);

            return $event;
        }

        $start = new EventDateTime();
        $start->setDateTime($this->toRfc3339($meeting->get('dateStart'), $timeZone));
        $start->setTimeZone($timeZone);

        $end = new EventDateTime();
        $end->setDateTime(
            $this->toRfc3339($meeting->get('dateEnd') ?? $meeting->get('dateStart'), $timeZone)
        );
        $end->setTimeZone($timeZone);

        $event->setStart($start);
        $event->setEnd($end);

        return $event;
    }

    /**
     * Título del evento: asunto de la cita más, entre paréntesis, los nombres
     * de los contactos relacionados.
     *
     *   Asunto + 1 contacto   -> "Asunto (María García)"
     *   Asunto + N contactos  -> "Asunto (María García, Ana López)"
     *   Asunto sin contactos  -> "Asunto"
     *   Sin asunto + contacto -> "Cita (María García)"
     *   Sin asunto ni nada    -> "Cita"
     *
     * Solo se incluye el nombre: nunca correo, teléfono ni identificadores.
     *
     * @param string[] $contactNames
     */
    public function buildSummary(?string $subject, array $contactNames = []): string
    {
        $subject = trim((string) $subject);

        $names = $this->cleanNames($contactNames);

        $fallback = $this->messages->getLabel('defaultEventTitle', 'Meeting');

        if ($names === []) {
            return $subject !== '' ? $subject : $fallback;
        }

        $suffix = ' (' . implode(', ', $names) . ')';

        return ($subject !== '' ? $subject : $fallback) . $suffix;
    }

    /**
     * Quita vacíos y duplicados conservando el orden recibido, que ya es
     * determinista (ContactNameResolver ordena por nombre).
     *
     * @param string[] $names
     * @return string[]
     */
    private function cleanNames(array $names): array
    {
        $clean = [];

        foreach ($names as $name) {
            $name = trim((string) $name);

            if ($name === '' || in_array($name, $clean, true)) {
                continue;
            }

            $clean[] = $name;
        }

        return $clean;
    }

    /**
     * Estados de Meeting considerados cancelados (leídos de metadata,
     * respeta personalizaciones de la instancia).
     *
     * @return string[]
     */
    public function getCanceledStatusList(): array
    {
        $list = $this->metadata->get(['scopes', 'Meeting', 'canceledStatusList']);

        return is_array($list) && $list !== [] ? $list : ['Not Held'];
    }

    public function isCanceled(Entity $meeting): bool
    {
        return in_array($meeting->get('status'), $this->getCanceledStatusList(), true);
    }

    public function getTimeZone(): string
    {
        return $this->config->get('timeZone') ?: self::DEFAULT_TIME_ZONE;
    }

    /**
     * Convierte un datetime UTC de EspoCRM ('Y-m-d H:i:s') a RFC3339 en la zona configurada.
     */
    private function toRfc3339(?string $utcDateTime, string $timeZone): string
    {
        $dateTime = new DateTime($utcDateTime ?? 'now', new DateTimeZone('UTC'));

        $dateTime->setTimezone(new DateTimeZone($timeZone));

        return $dateTime->format(DateTime::RFC3339);
    }
}
