<?php

namespace Espo\Modules\GoogleCalendarSync\Classes;

use Espo\Modules\Crm\Entities\Meeting;
use Espo\ORM\Entity;
use Espo\ORM\EntityManager;

/**
 * Obtiene los nombres de los contactos relacionados con una cita.
 *
 * Aísla el acceso a la base de datos para que EventMapper siga siendo una
 * función pura y fácil de probar: el mapper recibe un array de nombres y no
 * consulta nada.
 *
 * Se usa la relación **contacts** de Meeting —la misma que EspoCRM emplea para
 * las invitaciones por correo—, nunca el campo `parent`.
 *
 * **No se capturan errores del ORM.** Una relación mal declarada, una consulta
 * incompatible o un fallo de base de datos deben propagarse: SyncService los
 * registra en la cuenta, marca la sincronización como fallida y deja que el
 * sistema de trabajos reintente. Devolver un array vacío escondería el fallo y
 * guardaría en Google un título sin cliente como si fuera correcto.
 */
class ContactNameResolver
{
    /**
     * Máximo de nombres que llegan al título.
     */
    private const MAX_NAMES = 10;

    /**
     * Tope de filas leídas. Superior a MAX_NAMES a propósito: entre los
     * contactos puede haber nombres vacíos o repetidos, que se descartan
     * después. Con este margen se siguen obteniendo diez nombres válidos aunque
     * cuarenta de los leídos no sirvan.
     *
     * Consecuencia documentada: una cita con más de 50 contactos podría dejar
     * fuera alguno. Es un escenario ajeno a la agenda de un negocio y el coste
     * de paginar indefinidamente no se justifica.
     */
    private const FETCH_LIMIT = 50;

    public function __construct(private EntityManager $entityManager)
    {}

    /**
     * Nombres de los contactos de la cita: sin vacíos, sin duplicados, en orden
     * determinista y como mucho diez.
     *
     * El orden de las operaciones importa: el máximo se aplica **al final**,
     * sobre nombres ya válidos, no sobre las filas leídas.
     *
     * @return string[]
     */
    public function getNames(Entity $meeting): array
    {
        $collection = $this->entityManager
            ->getRDBRepository(Meeting::ENTITY_TYPE)
            ->getRelation($meeting, Meeting::LINK_CONTACTS)
            ->limit(0, self::FETCH_LIMIT)
            ->find();

        // 1. Extraer nombres · 2. descartar vacíos · 3. quitar duplicados
        $names = [];

        foreach ($collection as $contact) {
            $name = $this->extractName($contact);

            if ($name === '' || in_array($name, $names, true)) {
                continue;
            }

            $names[] = $name;
        }

        // 4. Orden determinista, independiente del locale del servidor.
        usort($names, static function (string $a, string $b): int {
            $comparison = strcmp(mb_strtolower($a), mb_strtolower($b));

            // Desempate estable si dos nombres solo difieren en mayúsculas.
            return $comparison !== 0 ? $comparison : strcmp($a, $b);
        });

        // 5. Máximo, ya sobre nombres válidos.
        return array_slice($names, 0, self::MAX_NAMES);
    }

    /**
     * `name` de un Contact es de tipo personName: una expresión de selección,
     * no una columna. Si llegara vacío se compone con los atributos reales que
     * EspoCRM usa para formarlo (ver `FieldConverters\PersonName`).
     */
    private function extractName(Entity $contact): string
    {
        $name = trim((string) ($contact->get('name') ?? ''));

        if ($name !== '') {
            return $name;
        }

        $parts = [];

        foreach (['firstName', 'middleName', 'lastName'] as $attribute) {
            $value = trim((string) ($contact->get($attribute) ?? ''));

            if ($value !== '') {
                $parts[] = $value;
            }
        }

        return implode(' ', $parts);
    }
}
